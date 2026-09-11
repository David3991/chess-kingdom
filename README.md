<h1>Chess Kingdom</h1>

<p>Chess Kingdom is a real-time, two-player online chess game built with Express, Socket.IO, chess.js, and chessboard.js.</p>

<h2>Features</h2>
<ul>
  <li>Real-time multiplayer chess with a lobby of open rooms</li>
  <li>Server-authoritative move validation (moves are checked with chess.js on the server, not just relayed)</li>
  <li>Checkmate, stalemate, threefold repetition, and insufficient-material detection</li>
  <li>Resign and draw-offer/accept/decline</li>
  <li>Pawn promotion picker (queen, rook, bishop, knight)</li>
  <li>Move history and captured-pieces panel</li>
  <li>In-game chat</li>
  <li>Reconnection — refreshing the page rejoins your in-progress game instead of losing it</li>
</ul>

<h2>Playing online</h2>
<p>Go to <a href="https://chesskingdom.onrender.com">https://chesskingdom.onrender.com</a>, then either click an open room or "Create Room" to start a game. Moves are made by dragging pieces on the board.</p>

<h2>Running locally</h2>
<pre>
npm install
npm start        # runs the server on http://localhost:3000
npm run dev      # same, but restarts on file changes (Node 18+)
npm test         # runs the integration smoke test
</pre>

<h2>Project structure</h2>
<ul>
  <li><code>app.js</code> — Express + Socket.IO server; owns all game state and validates every move</li>
  <li><code>public/main.js</code> — browser client; renders whatever state the server sends</li>
  <li><code>public/chess.js</code>, <code>public/chessboard</code> — vendored chess-rules and board-rendering libraries</li>
  <li><code>test/smoke-test.js</code> — end-to-end test that plays a full game against a real server instance</li>
</ul>

<h2>Contributions</h2>
<p>We welcome contributions to the project. If you would like to contribute, please fork the repository and make a pull request with your changes.</p>

<h2>License</h2>
<p>Chess Kingdom is licensed under the MIT License. See <a href="https://github.com/David3991/chess-kingdom/blob/main/LICENSE">LICENSE</a> for more information.</p>

<h2>Contact</h2>
<p>If you have any issues or suggestions, please feel free to open an issue on the repository or contact us through email at <a href="mailto:robi46805@gmail.com">robi46805@gmail.com</a>.</p>
