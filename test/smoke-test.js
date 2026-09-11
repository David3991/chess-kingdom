// Lightweight integration smoke test — no test framework dependency.
// Spins up the real server on a scratch port, drives two socket.io
// clients through a full game, and asserts on the outcomes.
const assert = require("assert");
const { spawn } = require("child_process");
const path = require("path");
const io = require("socket.io-client");

const PORT = 3901;
const URL = `http://localhost:${PORT}`;

function startServer() {
  return spawn(process.execPath, [path.join(__dirname, "..", "app.js")], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: "ignore",
  });
}

function waitFor(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

async function run() {
  const server = startServer();
  await new Promise((r) => setTimeout(r, 800)); // let it bind the port

  try {
    const white = io(URL, { forceNew: true, reconnection: false });
    const black = io(URL, { forceNew: true, reconnection: false });

    await Promise.all([waitFor(white, "connect"), waitFor(black, "connect")]);

    white.emit("createRoom");
    const whiteJoined = await waitFor(white, "roomJoined");
    assert.strictEqual(whiteJoined.color, "white");
    assert.strictEqual(whiteJoined.status, "waiting");

    black.emit("joinRoom", { roomId: whiteJoined.roomId });
    const [blackJoined, opponentJoined] = await Promise.all([
      waitFor(black, "roomJoined"),
      waitFor(white, "opponentJoined"),
    ]);
    assert.strictEqual(blackJoined.color, "black");
    assert.strictEqual(opponentJoined.status, "active");

    // Fool's mate — fastest checkmate, good for exercising game-over logic.
    const roomId = whiteJoined.roomId;
    white.emit("move", { roomId, from: "f2", to: "f3" });
    await waitFor(black, "moveMade");
    black.emit("move", { roomId, from: "e7", to: "e5" });
    await waitFor(white, "moveMade");
    white.emit("move", { roomId, from: "g2", to: "g4" });
    await waitFor(black, "moveMade");
    black.emit("move", { roomId, from: "d8", to: "h4" });

    const result = await waitFor(white, "gameOver");
    assert.strictEqual(result.reason, "checkmate");
    assert.strictEqual(result.winner, "black");

    // A move sent after the game is over must be a no-op, not a crash.
    white.emit("move", { roomId, from: "a2", to: "a3" });
    await new Promise((r) => setTimeout(r, 200));

    white.close();
    black.close();
    console.log("✔ smoke test passed");
    process.exitCode = 0;
  } catch (err) {
    console.error("✘ smoke test failed:", err);
    process.exitCode = 1;
  } finally {
    server.kill();
  }
}

run();
