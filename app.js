const express = require("express");
const http = require("http");
const socket = require("socket.io");
const { v4: uuidv4 } = require('uuid');

const port = process.env.PORT || 3000;

var app = express();
const server = http.createServer(app);
const io = socket(server);
var players;

app.use(express.static(__dirname + "/public"));

var games = []

io.on("connection", function (socket) {
  // console.log(players);
  var color;
  var playerId = uuidv4();

  console.log(playerId + " connected");
  socket.emit("showRooms", games)
  socket.on("joined", function (roomId) {
    // games[roomId] = {}
    if (games.find(game => game.roomId === roomId).players < 2) {
      games.find(game => game.roomId === roomId).players++;
      games.find(game => game.roomId === roomId).pid[games.find(game => game.roomId === roomId).players - 1] = playerId;
    } else {
      socket.emit("full", games.find(game => game.roomId === roomId).roomId);
      return;
    }

    console.log(games.find(game => game.roomId === roomId));
    players = games.find(game => game.roomId === roomId).players;

    if (players % 2 == 0) color = "black";
    else color = "white";

    let roomId2 = games.find(game => game.roomId === roomId).roomId;

    socket.emit("player", { playerId, players, color, roomId2 });
    // players--;
  });

  socket.on('createRoom', () => {
    let roomId = uuidv4()
    games.push({
      roomId: `${roomId}`,
      players: 0,
      pid: [0, 0]
    })
    socket.emit("showRooms", games)
  })

  socket.on("move", function (msg) {
    socket.broadcast.emit("move", msg);
    // console.log(msg);
  });

  socket.on("gameOver", function (roomId) {
    socket.broadcast.emit("gameOver", roomId);
  });

  socket.on("play", function (msg) {
    socket.broadcast.emit("play", msg);
    console.log("ready " + msg);
  });

  socket.on("disconnect", function () {
    for (let i = 0; i < games.length; i++) {
      if (games[i].pid[0] == playerId || games[i].pid[1] == playerId)
        games[i].players--;
    }
    console.log(playerId + " disconnected");
  });
});

//The 404 Route (ALWAYS Keep this as the last route)
app.get('*', function (req, res) {
  res.redirect('404.html');
});

server.listen(port, () => {
  console.log("Server running on port", port);
})