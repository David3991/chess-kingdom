game = new Chess();
var socket = io();

var color = "white";
var players;
var roomId;
var play = true;
var moveSound = new Audio('./sounds/move-self.mp3');
var captureSound = new Audio('./sounds/capture.mp3');

var state = document.getElementById("state");

const createRoomBtn = document.getElementById("createRoomBtn")

var createRoom = () => {
  socket.emit('createRoom')
}

socket.on('showRooms', (games) => {
  const container = document.getElementsByClassName("container")
  const boards = document.getElementById("boards")
  for (let board of boards.children) {
    board.remove()
  }
  for (let i = 0; i < games.length; i++) {
    const boardSq = document.createElement("a");
    boardSq.classList.add("boardSq");

    const boardDraw = document.createElement("div");
    boardDraw.classList.add("boardDraw");

    const boardText = document.createElement("p");
    boardText.classList.add("boardText");
    boardText.textContent = `Board #${i + 1}`;

    boardSq.addEventListener("click", function () {
      socket.emit("joined", games[i].roomId)
      for (let board of boards.children) {
        board.remove()
      }
      createRoomBtn.remove()
      for (let board of boards.children) {
        board.remove()
      }
    });

    boardSq.appendChild(boardDraw);
    boardSq.appendChild(boardText);
    boards.appendChild(boardSq);

  }
})

socket.on("full", function (msg) {
  if (roomId == msg) window.location.assign(window.location.href + "full.html");
});

socket.on("play", function (msg) {
  if (msg == roomId) {
    play = false;
    state.innerHTML = "Game in Progress";
  }
  // console.log(msg)
});

socket.on("move", function (msg) {
  if (msg.room == roomId) {
    game.move(msg.move);
    board.position(game.fen());
    moveSound.play();
    console.log("moved");
  }
});

var removeGreySquares = function () {
  $("#board .square-55d63").css("background", "");
};

var greySquare = function (square) {
  var squareEl = $("#board .square-" + square);

  var background = "#a9a9a9";
  if (squareEl.hasClass("black-3c85d") === true) {
    background = "#696969";
  }

  squareEl.css("background", background);
};

var onDragStart = function (source, piece) {
  // do not pick up pieces if the game is over
  // or if it's not that side's turn
  if (
    game.game_over() === true ||
    play ||
    (game.turn() === "w" && piece.search(/^b/) !== -1) ||
    (game.turn() === "b" && piece.search(/^w/) !== -1) ||
    (game.turn() === "w" && color === "black") ||
    (game.turn() === "b" && color === "white")
  ) {
    return false;
  }
  // console.log({play, players});
};

var onDrop = function (source, target) {
  removeGreySquares();

  // see if the move is legal
  var move = game.move({
    from: source,
    to: target,
    promotion: "q", // NOTE: always promote to a queen for example simplicity
  });
  if (game.game_over()) {
    state.innerHTML = "GAME OVER";
    socket.emit("gameOver", roomId);
  }

  // illegal move
  if (move === null) return "snapback";
  else if (move.captured) captureSound.play()
  else moveSound.play(); socket.emit("move", { move: move, board: game.fen(), room: roomId });
};

var onMouseoverSquare = function (square, piece) {
  // get list of possible moves for this square
  var moves = game.moves({
    square: square,
    verbose: true,
  });

  // exit if there are no moves available for this square
  if (moves.length === 0) return;

  // highlight the square they moused over
  greySquare(square);

  // highlight the possible squares for this piece
  for (var i = 0; i < moves.length; i++) {
    greySquare(moves[i].to);
  }
};

var onMouseoutSquare = function (square, piece) {
  removeGreySquares();
};

var onSnapEnd = function () {
  board.position(game.fen());
};

socket.on('gameOver', (dRoomId) => {
  if (dRoomId === roomId) {
    state.innerHTML = "GAME OVER";
  }
})

socket.on("player", (msg) => {
  var plno = document.getElementById("player");
  color = msg.color;

  plno.innerHTML = "Player " + msg.players + " : " + color;
  players = msg.players;

  if (players == 2) {
    play = false;
    socket.emit("play", msg.roomId);
    state.innerHTML = "Game in Progress";
  } else state.innerHTML = "Waiting for Second player";

  var cfg = {
    orientation: color,
    draggable: true,
    position: "start",
    onDragStart: onDragStart,
    onDrop: onDrop,
    onMouseoutSquare: onMouseoutSquare,
    onMouseoverSquare: onMouseoverSquare,
    onSnapEnd: onSnapEnd,
  };
  board = ChessBoard("board", cfg);
});
// console.log(color)

var board;
