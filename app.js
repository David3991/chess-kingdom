const express = require("express");
const http = require("http");
const path = require("path");
const socketIO = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const { Chess } = require("chess.js");

const PORT = process.env.PORT || 3000;
const RECONNECT_GRACE_MS = 2 * 60 * 1000; // 2 minutes to reconnect before the game is abandoned
const CHAT_HISTORY_LIMIT = 50;

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static(path.join(__dirname, "public")));

/**
 * In-memory room store.
 * rooms: Map<roomId, Room>
 *
 * Room shape:
 * {
 *   roomId: string,
 *   label: number,               // display number, e.g. "Board #3"
 *   chess: Chess,                // server-authoritative game state
 *   status: 'waiting' | 'active' | 'over',
 *   players: {
 *     white: { playerId, socketId, connected, disconnectTimer } | null,
 *     black: { playerId, socketId, connected, disconnectTimer } | null,
 *   },
 *   history: [{ san, from, to, promotion, captured, color, moveNumber }],
 *   chat: [{ color, text, ts }],
 *   drawOfferFrom: 'white' | 'black' | null,
 *   result: { reason, winner } | null,
 * }
 */
const rooms = new Map();
let nextRoomLabel = 1;

function publicRoomList() {
  return Array.from(rooms.values())
    .filter((room) => room.status === "waiting")
    .map((room) => ({ roomId: room.roomId, label: room.label }));
}

function broadcastRoomList() {
  io.emit("roomList", publicRoomList());
}

function otherColor(color) {
  return color === "white" ? "black" : "white";
}

function roomStateFor(room, color) {
  return {
    roomId: room.roomId,
    label: room.label,
    color,
    playerId: room.players[color].playerId,
    fen: room.chess.fen(),
    status: room.status,
    history: room.history,
    chat: room.chat,
    turn: room.chess.turn() === "w" ? "white" : "black",
    inCheck: room.chess.in_check(),
    opponentConnected: !!room.players[otherColor(color)]?.connected,
    result: room.result,
  };
}

function clearDisconnectTimer(player) {
  if (player && player.disconnectTimer) {
    clearTimeout(player.disconnectTimer);
    player.disconnectTimer = null;
  }
}

function endGame(room, reason, winner) {
  if (room.status === "over") return;
  room.status = "over";
  room.result = { reason, winner };
  io.to(room.roomId).emit("gameOver", room.result);
}

function removeRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const color of ["white", "black"]) {
    clearDisconnectTimer(room.players[color]);
  }
  rooms.delete(roomId);
  broadcastRoomList();
}

function findRoomByPlayerSocket(socketId) {
  for (const room of rooms.values()) {
    for (const color of ["white", "black"]) {
      if (room.players[color] && room.players[color].socketId === socketId) {
        return { room, color };
      }
    }
  }
  return null;
}

io.on("connection", (socket) => {
  const playerId = uuidv4();
  socket.emit("roomList", publicRoomList());

  socket.on("createRoom", () => {
    const roomId = uuidv4();
    const room = {
      roomId,
      label: nextRoomLabel++,
      chess: new Chess(),
      status: "waiting",
      players: { white: null, black: null },
      history: [],
      chat: [],
      drawOfferFrom: null,
      result: null,
    };
    room.players.white = { playerId, socketId: socket.id, connected: true, disconnectTimer: null };
    rooms.set(roomId, room);

    socket.join(roomId);
    socket.emit("roomJoined", roomStateFor(room, "white"));
    broadcastRoomList();
  });

  socket.on("joinRoom", ({ roomId } = {}) => {
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit("joinError", { message: "That room no longer exists." });
      return;
    }
    if (room.players.black) {
      socket.emit("roomFull", { roomId });
      return;
    }

    room.players.black = { playerId, socketId: socket.id, connected: true, disconnectTimer: null };
    room.status = "active";
    socket.join(roomId);

    socket.emit("roomJoined", roomStateFor(room, "black"));
    io.to(room.players.white.socketId).emit("opponentJoined", roomStateFor(room, "white"));
    broadcastRoomList();
  });

  socket.on("rejoin", ({ roomId, playerId: incomingPlayerId } = {}) => {
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit("rejoinFailed");
      return;
    }
    const color = room.players.white?.playerId === incomingPlayerId
      ? "white"
      : room.players.black?.playerId === incomingPlayerId
        ? "black"
        : null;

    if (!color) {
      socket.emit("rejoinFailed");
      return;
    }

    clearDisconnectTimer(room.players[color]);
    room.players[color].socketId = socket.id;
    room.players[color].connected = true;
    socket.join(roomId);

    socket.emit("roomJoined", roomStateFor(room, color));
    socket.to(roomId).emit("opponentReconnected");
  });

  socket.on("move", ({ roomId, from, to, promotion } = {}) => {
    const room = rooms.get(roomId);
    if (!room || room.status !== "active") return;

    const found = findRoomByPlayerSocket(socket.id);
    if (!found || found.room.roomId !== roomId) return;
    const color = found.color;

    const sideToMove = room.chess.turn() === "w" ? "white" : "black";
    if (sideToMove !== color) {
      socket.emit("invalidMove", { reason: "It's not your turn." });
      return;
    }

    const move = room.chess.move({ from, to, promotion: promotion || "q" });
    if (!move) {
      socket.emit("invalidMove", { reason: "Illegal move." });
      return;
    }

    room.drawOfferFrom = null;

    const entry = {
      san: move.san,
      from: move.from,
      to: move.to,
      promotion: move.promotion || null,
      captured: move.captured || null,
      color,
      moveNumber: room.history.length + 1,
    };
    room.history.push(entry);

    io.to(roomId).emit("moveMade", {
      move: entry,
      fen: room.chess.fen(),
      turn: room.chess.turn() === "w" ? "white" : "black",
      inCheck: room.chess.in_check(),
    });

    if (room.chess.game_over()) {
      let reason = "draw";
      let winner = null;
      if (room.chess.in_checkmate()) {
        reason = "checkmate";
        winner = color; // the player who just moved delivered checkmate
      } else if (room.chess.in_stalemate()) {
        reason = "stalemate";
      } else if (room.chess.in_threefold_repetition()) {
        reason = "threefold repetition";
      } else if (room.chess.insufficient_material()) {
        reason = "insufficient material";
      }
      endGame(room, reason, winner);
    }
  });

  socket.on("resign", ({ roomId } = {}) => {
    const room = rooms.get(roomId);
    if (!room || room.status !== "active") return;
    const found = findRoomByPlayerSocket(socket.id);
    if (!found || found.room.roomId !== roomId) return;
    endGame(room, "resignation", otherColor(found.color));
  });

  socket.on("offerDraw", ({ roomId } = {}) => {
    const room = rooms.get(roomId);
    if (!room || room.status !== "active") return;
    const found = findRoomByPlayerSocket(socket.id);
    if (!found || found.room.roomId !== roomId) return;
    room.drawOfferFrom = found.color;
    socket.to(roomId).emit("drawOffered", { fromColor: found.color });
  });

  socket.on("respondDraw", ({ roomId, accept } = {}) => {
    const room = rooms.get(roomId);
    if (!room || room.status !== "active" || !room.drawOfferFrom) return;
    if (accept) {
      endGame(room, "agreement", null);
    } else {
      socket.to(roomId).emit("drawDeclined");
    }
    room.drawOfferFrom = null;
  });

  socket.on("chatMessage", ({ roomId, text } = {}) => {
    const room = rooms.get(roomId);
    if (!room || typeof text !== "string") return;
    const trimmed = text.trim().slice(0, 300);
    if (!trimmed) return;
    const found = findRoomByPlayerSocket(socket.id);
    if (!found || found.room.roomId !== roomId) return;

    const message = { color: found.color, text: trimmed, ts: Date.now() };
    room.chat.push(message);
    if (room.chat.length > CHAT_HISTORY_LIMIT) room.chat.shift();
    io.to(roomId).emit("chatMessage", message);
  });

  socket.on("leaveRoom", ({ roomId } = {}) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const found = findRoomByPlayerSocket(socket.id);
    if (!found || found.room.roomId !== roomId) return;
    socket.leave(roomId);
    if (room.status === "waiting") {
      removeRoom(roomId);
    } else {
      if (room.status === "active") endGame(room, "abandonment", otherColor(found.color));
      socket.to(roomId).emit("opponentDisconnected", { permanent: true });
    }
  });

  socket.on("disconnect", () => {
    const found = findRoomByPlayerSocket(socket.id);
    if (!found) return;
    const { room, color } = found;
    const player = room.players[color];
    player.connected = false;

    if (room.status === "waiting") {
      // Nobody else is in the room yet, so just clean it up.
      removeRoom(room.roomId);
      return;
    }

    socket.to(room.roomId).emit("opponentDisconnected", { permanent: false });

    clearDisconnectTimer(player);
    player.disconnectTimer = setTimeout(() => {
      if (room.status === "active") {
        endGame(room, "abandonment", otherColor(color));
      }
      io.to(room.roomId).emit("opponentDisconnected", { permanent: true });
    }, RECONNECT_GRACE_MS);
  });
});

// 404 handler — always keep this last
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, "public", "404.html"));
});

server.listen(PORT, () => {
  console.log(`Chess Kingdom server running on port ${PORT}`);
});
