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
const MAX_PLAYERS = 35; // maximum number of players allowed in a game

// Avatars a player may pick. Each is an emoji; the client offers the same set.
// There are at least MAX_PLAYERS of them so every player can have a unique one.
const AVATARS = [
  "👩‍💻",
  "👩‍🔬",
  "👩‍🚀",
  "🦸‍♀️",
  "🧕",
  "👧",
  "👩‍🎨",
  "👩‍🏫",
  "👩‍⚕️",
  "👩‍🌾",
  "🦊",
  "🐱",
  "🐶",
  "🐼",
  "🐨",
  "🦄",
  "🐯",
  "🦁",
  "🐸",
  "🐵",
  "🐧",
  "🦉",
  "🦋",
  "🐢",
  "🐙",
  "🦕",
  "🌸",
  "🌺",
  "🌻",
  "🌈",
  "⭐",
  "⚡",
  "🔥",
  "🚀",
  "🎮",
  "🎨",
  "🧩",
  "💡",
  "👑",
  "💎",
];
const DEFAULT_AVATAR = "👩‍💻";

// Pieces used to build a fun random nickname when a player leaves it blank.
const RANDOM_NAME_ADJ = [
  "Super",
  "Mega",
  "Ultra",
  "Ninja",
  "Cosmic",
  "Pixel",
  "Turbo",
  "Cyber",
  "Astro",
  "Quantum",
  "Electro",
  "Hyper",
];
const RANDOM_NAME_NOUN = [
  "Coder",
  "Dev",
  "Hacker",
  "Byte",
  "Logic",
  "Script",
  "Pixel",
  "Robot",
  "Star",
  "Comet",
  "Fox",
  "Unicorn",
];

// Build a random nickname that is not already taken.
function randomName() {
  const taken = new Set(
    Array.from(game.players.values()).map((p) => p.name.toLowerCase()),
  );
  for (let i = 0; i < 50; i++) {
    const adj =
      RANDOM_NAME_ADJ[Math.floor(Math.random() * RANDOM_NAME_ADJ.length)];
    const noun =
      RANDOM_NAME_NOUN[Math.floor(Math.random() * RANDOM_NAME_NOUN.length)];
    const num = Math.floor(Math.random() * 100);
    const candidate = `${adj}${noun}${num}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  // Fallback: guaranteed-unique name.
  return `Jugadora${Date.now().toString().slice(-5)}`;
}

// Pick an avatar not already in use; fall back to the default set order.
function pickFreeAvatar() {
  const used = new Set(Array.from(game.players.values()).map((p) => p.avatar));
  const free = AVATARS.filter((a) => !used.has(a));
  if (free.length === 0) return DEFAULT_AVATAR;
  return free[Math.floor(Math.random() * free.length)];
}

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

function takenAvatars() {
  return Array.from(game.players.values()).map((p) => p.avatar);
}

function broadcastLobby() {
  io.emit("lobby:update", {
    players: playerList(),
    total: questions.length,
    takenAvatars: takenAvatars(),
    maxPlayers: MAX_PLAYERS,
    full: game.players.size >= MAX_PLAYERS,
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

  // Tally how many players chose each option, and correct vs. incorrect.
  const distribution = new Array(q.options.length).fill(0);
  let correctCount = 0;
  let wrongCount = 0;
  let noAnswerCount = 0;
  for (const p of game.players.values()) {
    const ans = p.answers.get(game.currentIndex);
    if (ans && ans.optionIndex != null) {
      distribution[ans.optionIndex] += 1;
      if (ans.correct) correctCount += 1;
      else wrongCount += 1;
    } else {
      noAnswerCount += 1;
    }
  }

  const board = leaderboard();

  io.emit("game:reveal", {
    index: game.currentIndex,
    correctIndex: q.correctIndex,
    distribution,
    // Correct vs. did-not-accert (wrong + no answer) for the summary graph.
    correctCount,
    wrongCount,
    noAnswerCount,
    incorrectCount: wrongCount + noAnswerCount,
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
      maxPlayers: MAX_PLAYERS,
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
    if (ack)
      ack({
        phase: game.phase,
        avatars: AVATARS,
        takenAvatars: takenAvatars(),
        maxPlayers: MAX_PLAYERS,
        full: game.players.size >= MAX_PLAYERS,
      });
  });

  socket.on("player:join", (payload, ack) => {
    if (game.phase !== "lobby") {
      if (ack) ack({ ok: false, error: "El juego ya comenzó." });
      return;
    }

    // Enforce the player cap (allow a rejoining player to keep their slot).
    if (!game.players.has(socket.id) && game.players.size >= MAX_PLAYERS) {
      if (ack)
        ack({
          ok: false,
          error: `El juego está lleno (máximo ${MAX_PLAYERS} jugadores).`,
        });
      return;
    }

    // Name is optional: generate a fun random nickname when left blank.
    let name = String((payload && payload.name) || "")
      .trim()
      .slice(0, 24);
    if (!name) {
      name = randomName();
    }

    // Prevent duplicate names.
    for (const p of game.players.values()) {
      if (p.name.toLowerCase() === name.toLowerCase()) {
        if (ack) ack({ ok: false, error: "Ese nombre ya está en uso." });
        return;
      }
    }

    // Avatars must be unique. If the requested avatar is invalid or already
    // taken, assign a random free one so every player looks different.
    const requested = payload && payload.avatar;
    const used = new Set(
      Array.from(game.players.values()).map((p) => p.avatar),
    );
    let avatar;
    if (AVATARS.includes(requested) && !used.has(requested)) {
      avatar = requested;
    } else {
      avatar = pickFreeAvatar();
    }

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
