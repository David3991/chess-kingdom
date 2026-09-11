// ---------------------------------------------------------------------------
// Chess Kingdom client
// The server is authoritative: this client renders whatever fen/state the
// server sends and only *proposes* moves. `game` (chess.js) is used locally
// purely as a read-only helper for legal-move highlighting and promotion
// detection — it is never mutated with .move() on this side.
// ---------------------------------------------------------------------------

const socket = io();
const game = new Chess();

const STORAGE_ROOM_KEY = "chessKingdom.roomId";
const STORAGE_PLAYER_KEY = "chessKingdom.playerId";

let board = null;
let roomId = null;
let myColor = null;
let myPlayerId = null;
let status = "lobby"; // lobby | waiting | active | over
let capturedByWhite = [];
let capturedByBlack = [];

const moveSound = new Audio("./sounds/move-self.mp3");
const captureSound = new Audio("./sounds/capture.mp3");

// --- DOM refs ---------------------------------------------------------------
const el = {
  banner: document.getElementById("banner"),
  lobby: document.getElementById("lobby"),
  boards: document.getElementById("boards"),
  lobbyEmpty: document.getElementById("lobbyEmpty"),
  createRoomBtn: document.getElementById("createRoomBtn"),
  game: document.getElementById("game"),
  player: document.getElementById("player"),
  opponentStatus: document.getElementById("opponentStatus"),
  state: document.getElementById("state"),
  turnIndicator: document.getElementById("turnIndicator"),
  offerDrawBtn: document.getElementById("offerDrawBtn"),
  resignBtn: document.getElementById("resignBtn"),
  leaveBtn: document.getElementById("leaveBtn"),
  moveList: document.getElementById("moveList"),
  capturedByWhite: document.getElementById("capturedByWhite"),
  capturedByBlack: document.getElementById("capturedByBlack"),
  chatLog: document.getElementById("chatLog"),
  chatForm: document.getElementById("chatForm"),
  chatInput: document.getElementById("chatInput"),
  promotionOverlay: document.getElementById("promotionOverlay"),
  drawOfferBox: document.getElementById("drawOfferBox"),
  drawAcceptBtn: document.getElementById("drawAcceptBtn"),
  drawDeclineBtn: document.getElementById("drawDeclineBtn"),
};

// --- small helpers -----------------------------------------------------------
function showBanner(text, tone = "info") {
  el.banner.textContent = text;
  el.banner.className = `banner banner-${tone}`;
  clearTimeout(showBanner._t);
  showBanner._t = setTimeout(() => el.banner.classList.add("d-none"), 4000);
}

function showLobby() {
  status = "lobby";
  el.lobby.classList.remove("d-none");
  el.game.classList.add("d-none");
  el.leaveBtn.classList.add("d-none");
}

function showGame() {
  el.lobby.classList.add("d-none");
  el.game.classList.remove("d-none");
}

function persistSession() {
  if (roomId && myPlayerId) {
    localStorage.setItem(STORAGE_ROOM_KEY, roomId);
    localStorage.setItem(STORAGE_PLAYER_KEY, myPlayerId);
  }
}

function clearSession() {
  localStorage.removeItem(STORAGE_ROOM_KEY);
  localStorage.removeItem(STORAGE_PLAYER_KEY);
}

const PIECE_NAME = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen" };
const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };

function renderCaptured() {
  const render = (list, container) => {
    container.innerHTML = "";
    for (const piece of list) {
      const span = document.createElement("span");
      span.className = "captured-piece";
      span.textContent = piece.toUpperCase();
      span.title = PIECE_NAME[piece] || piece;
      container.appendChild(span);
    }
  };
  render(capturedByWhite, el.capturedByWhite);
  render(capturedByBlack, el.capturedByBlack);
}

function renderMove(entry) {
  // Group into "1. e4 e5" style rows.
  let row;
  if (entry.color === "white") {
    row = document.createElement("li");
    row.className = "move-row";
    row.dataset.moveNumber = entry.moveNumber;
    const whiteSpan = document.createElement("span");
    whiteSpan.className = "move-white";
    whiteSpan.textContent = entry.san;
    row.appendChild(whiteSpan);
    el.moveList.appendChild(row);
  } else {
    row = el.moveList.lastElementChild;
    if (!row) {
      row = document.createElement("li");
      row.className = "move-row";
      el.moveList.appendChild(row);
    }
    const blackSpan = document.createElement("span");
    blackSpan.className = "move-black";
    blackSpan.textContent = entry.san;
    row.appendChild(blackSpan);
  }
  el.moveList.scrollTop = el.moveList.scrollHeight;
}

function renderChatMessage(msg) {
  const line = document.createElement("div");
  line.className = `chat-line chat-${msg.color}`;
  const label = msg.color === myColor ? "You" : "Opponent";
  line.innerHTML = `<strong>${label}:</strong> `;
  line.appendChild(document.createTextNode(msg.text));
  el.chatLog.appendChild(line);
  el.chatLog.scrollTop = el.chatLog.scrollHeight;
}

function updateTurnIndicator(turn, inCheck) {
  if (status !== "active") return;
  const youMove = turn === myColor;
  el.turnIndicator.textContent = youMove
    ? inCheck ? "Your move — you're in check!" : "Your move"
    : inCheck ? "Opponent's move — check!" : "Opponent's move";
  el.turnIndicator.className = `badge ${youMove ? "bg-success" : "bg-secondary"}`;
}

function applyState(state) {
  roomId = state.roomId;
  myColor = state.color;
  myPlayerId = state.playerId;
  status = state.status;
  persistSession();

  game.load(state.fen);
  showGame();

  el.player.textContent = `You are playing ${myColor}`;
  el.opponentStatus.textContent =
    state.status === "waiting"
      ? "Waiting for an opponent to join..."
      : state.opponentConnected
        ? ""
        : "Opponent disconnected — waiting for them to reconnect...";

  // Rebuild move list & captured pieces from history.
  el.moveList.innerHTML = "";
  capturedByWhite = [];
  capturedByBlack = [];
  for (const entry of state.history) {
    renderMove(entry);
    if (entry.captured) {
      // entry.color is who made the capturing move; the trophy goes in their row.
      if (entry.color === "white") capturedByWhite.push(entry.captured);
      else capturedByBlack.push(entry.captured);
    }
  }
  renderCaptured();

  el.chatLog.innerHTML = "";
  for (const msg of state.chat) renderChatMessage(msg);

  if (state.status === "over" && state.result) {
    describeGameOver(state.result);
  } else {
    el.state.textContent = state.status === "waiting" ? "Waiting for a second player..." : "Game in progress";
    updateTurnIndicator(state.turn, state.inCheck);
  }

  const cfg = {
    orientation: myColor,
    draggable: true,
    position: state.fen,
    onDragStart,
    onDrop,
    onMouseoutSquare,
    onMouseoverSquare,
    onSnapEnd,
  };
  board = Chessboard("board", cfg);
}

function describeGameOver(result) {
  status = "over";
  let text;
  if (result.reason === "checkmate") {
    text = `Checkmate — ${capitalize(result.winner)} wins!`;
  } else if (result.reason === "resignation") {
    text = `${capitalize(otherColor(result.winner))} resigned — ${capitalize(result.winner)} wins!`;
  } else if (result.reason === "abandonment") {
    text = `Opponent left the game — ${capitalize(result.winner)} wins!`;
  } else if (result.reason === "agreement") {
    text = "Draw by agreement.";
  } else {
    text = `Draw by ${result.reason}.`;
  }
  el.state.textContent = text;
  el.turnIndicator.textContent = "Game over";
  el.turnIndicator.className = "badge bg-dark";
  el.leaveBtn.classList.remove("d-none");
  el.offerDrawBtn.disabled = true;
  el.resignBtn.disabled = true;
}

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
function otherColor(c) {
  return c === "white" ? "black" : "white";
}

// --- lobby --------------------------------------------------------------
el.createRoomBtn.addEventListener("click", () => socket.emit("createRoom"));

socket.on("roomList", (games) => {
  if (status !== "lobby") return;
  el.boards.innerHTML = "";
  el.lobbyEmpty.classList.toggle("d-none", games.length > 0);
  games.forEach((g) => {
    const boardSq = document.createElement("a");
    boardSq.classList.add("boardSq");

    const boardDraw = document.createElement("div");
    boardDraw.classList.add("boardDraw");

    const boardText = document.createElement("p");
    boardText.classList.add("boardText");
    boardText.textContent = `Board #${g.label}`;

    boardSq.addEventListener("click", () => socket.emit("joinRoom", { roomId: g.roomId }));

    boardSq.appendChild(boardDraw);
    boardSq.appendChild(boardText);
    el.boards.appendChild(boardSq);
  });
});

socket.on("roomJoined", (state) => applyState(state));
socket.on("opponentJoined", (state) => applyState(state));

socket.on("joinError", ({ message }) => showBanner(message, "warn"));
socket.on("roomFull", () => showBanner("That room just filled up.", "warn"));
socket.on("rejoinFailed", () => {
  clearSession();
  showLobby();
});

// --- gameplay --------------------------------------------------------------
socket.on("moveMade", ({ move, fen, turn, inCheck }) => {
  game.load(fen);
  board.position(fen);

  if (move.captured) {
    captureSound.play();
    if (move.color === "white") capturedByWhite.push(move.captured);
    else capturedByBlack.push(move.captured);
    renderCaptured();
  } else {
    moveSound.play();
  }

  renderMove(move);
  updateTurnIndicator(turn, inCheck);
  el.drawOfferBox.classList.add("d-none");
});

socket.on("invalidMove", ({ reason }) => {
  showBanner(reason || "That move isn't legal.", "warn");
  board.position(game.fen());
});

socket.on("gameOver", (result) => describeGameOver(result));

socket.on("opponentDisconnected", ({ permanent }) => {
  el.opponentStatus.textContent = permanent
    ? "Opponent left the game."
    : "Opponent disconnected — waiting for them to reconnect...";
});

socket.on("opponentReconnected", () => {
  el.opponentStatus.textContent = "";
  showBanner("Opponent reconnected.", "info");
});

socket.on("drawOffered", () => el.drawOfferBox.classList.remove("d-none"));
socket.on("drawDeclined", () => showBanner("Draw declined.", "info"));

el.resignBtn.addEventListener("click", () => {
  if (status !== "active") return;
  if (confirm("Are you sure you want to resign?")) socket.emit("resign", { roomId });
});

el.offerDrawBtn.addEventListener("click", () => {
  if (status !== "active") return;
  socket.emit("offerDraw", { roomId });
  showBanner("Draw offer sent.", "info");
});

el.drawAcceptBtn.addEventListener("click", () => {
  socket.emit("respondDraw", { roomId, accept: true });
  el.drawOfferBox.classList.add("d-none");
});
el.drawDeclineBtn.addEventListener("click", () => {
  socket.emit("respondDraw", { roomId, accept: false });
  el.drawOfferBox.classList.add("d-none");
});

el.leaveBtn.addEventListener("click", () => {
  if (roomId) socket.emit("leaveRoom", { roomId });
  clearSession();
  roomId = null;
  showLobby();
});

// --- chat --------------------------------------------------------------
el.chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = el.chatInput.value.trim();
  if (!text || !roomId) return;
  socket.emit("chatMessage", { roomId, text });
  el.chatInput.value = "";
});

// --- promotion --------------------------------------------------------------
let pendingPromotion = null;

function needsPromotion(source, target) {
  const legal = game.moves({ square: source, verbose: true });
  return legal.some((m) => m.to === target && m.flags.includes("p"));
}

function openPromotionPicker(source, target) {
  pendingPromotion = { source, target };
  el.promotionOverlay.classList.remove("d-none");
}

document.querySelectorAll(".promo-choice").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!pendingPromotion) return;
    const { source, target } = pendingPromotion;
    pendingPromotion = null;
    el.promotionOverlay.classList.add("d-none");
    socket.emit("move", { roomId, from: source, to: target, promotion: btn.dataset.piece });
  });
});

// --- chessboard.js handlers --------------------------------------------------------------
function onDragStart(source, piece) {
  if (status !== "active") return false;
  if (game.game_over()) return false;
  if (game.turn() !== myColor[0]) return false;
  if ((myColor === "white" && piece.search(/^b/) !== -1) ||
      (myColor === "black" && piece.search(/^w/) !== -1)) {
    return false;
  }
}

function onDrop(source, target) {
  removeGreySquares();
  if (source === target) return "snapback";

  const legalMoves = game.moves({ square: source, verbose: true });
  const isLegal = legalMoves.some((m) => m.to === target);
  if (!isLegal) return "snapback";

  if (needsPromotion(source, target)) {
    openPromotionPicker(source, target);
    return; // accept the visual drop; server move is sent once a piece is chosen
  }

  socket.emit("move", { roomId, from: source, to: target });
}

function onMouseoverSquare(square) {
  if (status !== "active") return;
  const moves = game.moves({ square, verbose: true });
  if (moves.length === 0) return;
  greySquare(square);
  moves.forEach((m) => greySquare(m.to));
}

function onMouseoutSquare() {
  removeGreySquares();
}

function onSnapEnd() {
  board.position(game.fen());
}

function removeGreySquares() {
  $("#board .square-55d63").css("background", "");
}

function greySquare(square) {
  const squareEl = $("#board .square-" + square);
  let background = "#a9a9a9";
  if (squareEl.hasClass("black-3c85d")) background = "#696969";
  squareEl.css("background", background);
}

// --- boot --------------------------------------------------------------
(function boot() {
  const savedRoom = localStorage.getItem(STORAGE_ROOM_KEY);
  const savedPlayer = localStorage.getItem(STORAGE_PLAYER_KEY);
  if (savedRoom && savedPlayer) {
    socket.emit("rejoin", { roomId: savedRoom, playerId: savedPlayer });
  } else {
    showLobby();
  }
})();
