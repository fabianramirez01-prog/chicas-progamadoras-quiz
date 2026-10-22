const path = require("path");
const os = require("os");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const { parseQuestions } = require("./parseQuestions");

const PORT = process.env.PORT || 3000;
const QUESTION_TIME = Number(process.env.QUESTION_TIME || 20); // seconds per question
const MAX_POINTS = 1000; // points for an instant correct answer
const MIN_POINTS = 500; // points for a correct answer at the buzzer
const TOP_ROUND = 5; // players shown on the per-round leaderboard
const TOP_WINNERS = 3; // players shown on the final winners podium

// Avatars a player may pick. Each is an emoji; the client offers the same set.
const AVATARS = [
  "👩‍💻",
  "👩‍🔬",
  "👩‍🚀",
  "🦸‍♀️",
  "🧕",
  "👧",
  "🐱",
  "🦊",
  "🐼",
  "🦄",
  "🌸",
  "⭐",
];
const DEFAULT_AVATAR = "👩‍💻";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const questions = parseQuestions(
  path.join(__dirname, "questionsAndAnswers.md"),
);
if (questions.length === 0) {
  console.error("No questions parsed from questionsAndAnswers.md. Exiting.");
  process.exit(1);
}

/**
 * Game state machine.
 * phase: 'lobby' | 'question' | 'reveal' | 'ended'
 */
const game = {
  phase: "lobby",
  currentIndex: -1,
  questionStartedAt: 0,
  timer: null,
  // socketId -> { id, name, score, streak, answers: Map(qIndex -> {optionIndex, correct, points, at}) }
  players: new Map(),
  // socketId of the host
  hostId: null,
};

function lanAddress() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}

function playerList() {
  return Array.from(game.players.values()).map((p) => ({
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    score: p.score,
    correctCount: p.correctCount,
  }));
}

function leaderboard() {
  // Rank by total score (score already rewards correctness + speed).
  // Tie-break by number of correct answers, then alphabetically.
  return playerList().sort(
    (a, b) =>
      b.score - a.score ||
      b.correctCount - a.correctCount ||
      a.name.localeCompare(b.name),
  );
}

function publicQuestion(index) {
  const q = questions[index];
  return {
    index,
    total: questions.length,
    text: q.text,
    options: q.options,
    time: QUESTION_TIME,
  };
}

function broadcastLobby() {
  io.emit("lobby:update", {
    players: playerList(),
    total: questions.length,
  });
}

function startQuestion(index) {
  if (index >= questions.length) {
    endGame();
    return;
  }
  clearTimeout(game.timer);

  game.phase = "question";
  game.currentIndex = index;
  game.questionStartedAt = Date.now();

  // Reset per-question answered flags are tracked via player.answers map.
  io.emit("game:question", publicQuestion(index));
  io.emit("game:phase", { phase: "question" });

  game.timer = setTimeout(() => {
    revealAnswer();
  }, QUESTION_TIME * 1000);
}

function revealAnswer() {
  clearTimeout(game.timer);
  game.phase = "reveal";

  const q = questions[game.currentIndex];

  // Tally how many players chose each option for this question.
  const distribution = new Array(q.options.length).fill(0);
  for (const p of game.players.values()) {
    const ans = p.answers.get(game.currentIndex);
    if (ans && ans.optionIndex != null) {
      distribution[ans.optionIndex] += 1;
    }
  }

  const board = leaderboard();

  io.emit("game:reveal", {
    index: game.currentIndex,
    correctIndex: q.correctIndex,
    distribution,
    leaderboard: board.slice(0, TOP_ROUND),
    totalPlayers: board.length,
  });
  io.emit("game:phase", { phase: "reveal" });

  // Tell each player their own result for this question.
  for (const p of game.players.values()) {
    const ans = p.answers.get(game.currentIndex);
    io.to(p.id).emit("player:result", {
      answered: !!ans,
      correct: ans ? ans.correct : false,
      pointsEarned: ans ? ans.points : 0,
      score: p.score,
      avatar: p.avatar,
      name: p.name,
      rank: rankOf(p.id),
      totalPlayers: board.length,
    });
  }
}

function rankOf(socketId) {
  const board = leaderboard();
  return board.findIndex((p) => p.id === socketId) + 1;
}

function endGame() {
  clearTimeout(game.timer);
  game.phase = "ended";
  const board = leaderboard();
  io.emit("game:ended", {
    winners: board.slice(0, TOP_WINNERS),
    fullBoard: board,
  });
  io.emit("game:phase", { phase: "ended" });
}

function resetGame() {
  clearTimeout(game.timer);
  game.phase = "lobby";
  game.currentIndex = -1;
  for (const p of game.players.values()) {
    p.score = 0;
    p.streak = 0;
    p.correctCount = 0;
    p.answers = new Map();
  }
  broadcastLobby();
  io.emit("game:phase", { phase: "lobby" });
}

// Fully close the current game: tell every client the game is over, drop all
// players, and return the host to a clean, empty lobby.
function closeGame() {
  clearTimeout(game.timer);
  io.emit("game:closed");
  game.players.clear();
  game.phase = "lobby";
  game.currentIndex = -1;
  broadcastLobby();
  io.emit("game:phase", { phase: "lobby" });
}

function scoreFor(elapsedMs) {
  // Linear decay from MAX_POINTS at t=0 to MIN_POINTS at t=QUESTION_TIME.
  const fraction = Math.min(elapsedMs / (QUESTION_TIME * 1000), 1);
  return Math.round(MAX_POINTS - (MAX_POINTS - MIN_POINTS) * fraction);
}

io.on("connection", (socket) => {
  // ---- Host events ----
  socket.on("host:join", () => {
    game.hostId = socket.id;
    socket.join("hosts");
    socket.emit("host:state", {
      phase: game.phase,
      players: playerList(),
      total: questions.length,
      lanUrl: `http://${lanAddress()}:${PORT}`,
    });
  });

  socket.on("host:start", () => {
    if (game.players.size === 0) {
      socket.emit("host:error", {
        message: "No hay jugadores conectados todavía.",
      });
      return;
    }
    startQuestion(0);
  });

  socket.on("host:next", () => {
    if (game.phase === "reveal") {
      startQuestion(game.currentIndex + 1);
    } else if (game.phase === "question") {
      revealAnswer();
    }
  });

  socket.on("host:reset", () => {
    resetGame();
  });

  socket.on("host:close", () => {
    closeGame();
  });

  // ---- Player events ----
  // A newly connected client asks for the current phase so the join screen
  // can show the right state (open vs. game in progress).
  socket.on("player:hello", (ack) => {
    if (ack) ack({ phase: game.phase });
  });

  socket.on("player:join", (payload, ack) => {
    const name = String((payload && payload.name) || "")
      .trim()
      .slice(0, 24);
    if (!name) {
      if (ack) ack({ ok: false, error: "Nombre vacío" });
      return;
    }
    if (game.phase !== "lobby") {
      if (ack) ack({ ok: false, error: "El juego ya comenzó." });
      return;
    }
    // Prevent duplicate names.
    for (const p of game.players.values()) {
      if (p.name.toLowerCase() === name.toLowerCase()) {
        if (ack) ack({ ok: false, error: "Ese nombre ya está en uso." });
        return;
      }
    }

    // Validate the chosen avatar against the allowed set.
    const requested = payload && payload.avatar;
    const avatar = AVATARS.includes(requested) ? requested : DEFAULT_AVATAR;

    game.players.set(socket.id, {
      id: socket.id,
      name,
      avatar,
      score: 0,
      streak: 0,
      correctCount: 0,
      answers: new Map(),
    });

    if (ack) ack({ ok: true, name, avatar });
    broadcastLobby();
  });

  socket.on("player:answer", (payload, ack) => {
    const player = game.players.get(socket.id);
    if (!player) {
      if (ack) ack({ ok: false, error: "No estás registrado." });
      return;
    }
    if (game.phase !== "question") {
      if (ack) ack({ ok: false, error: "No hay pregunta activa." });
      return;
    }
    if (player.answers.has(game.currentIndex)) {
      if (ack) ack({ ok: false, error: "Ya respondiste." });
      return;
    }

    const optionIndex = Number(payload && payload.optionIndex);
    const q = questions[game.currentIndex];
    if (
      !Number.isInteger(optionIndex) ||
      optionIndex < 0 ||
      optionIndex >= q.options.length
    ) {
      if (ack) ack({ ok: false, error: "Opción inválida." });
      return;
    }

    const elapsedMs = Date.now() - game.questionStartedAt;
    const correct = optionIndex === q.correctIndex;
    let points = 0;
    if (correct) {
      player.streak += 1;
      player.correctCount += 1;
      const base = scoreFor(elapsedMs);
      const streakBonus = Math.min(player.streak - 1, 5) * 50; // up to +250
      points = base + streakBonus;
    } else {
      player.streak = 0;
    }
    player.score += points;

    player.answers.set(game.currentIndex, {
      optionIndex,
      correct,
      points,
      at: Date.now(),
    });

    if (ack) ack({ ok: true, locked: true });

    // Let the host know how many players have answered.
    const answered = Array.from(game.players.values()).filter((p) =>
      p.answers.has(game.currentIndex),
    ).length;
    io.to("hosts").emit("host:answered", {
      answered,
      total: game.players.size,
    });

    // If everyone answered, reveal early.
    if (answered === game.players.size) {
      revealAnswer();
    }
  });

  socket.on("disconnect", () => {
    if (socket.id === game.hostId) {
      game.hostId = null;
    }
    if (game.players.has(socket.id)) {
      game.players.delete(socket.id);
      broadcastLobby();
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  const url = `http://${lanAddress()}:${PORT}`;
  console.log("\n  Chicas Programadoras Quiz is running!\n");
  console.log(`  Host screen (projector):  http://localhost:${PORT}/host.html`);
  console.log(`  Players join at:          ${url}`);
  console.log(
    `\n  ${questions.length} questions loaded. ${QUESTION_TIME}s per question.\n`,
  );
});
