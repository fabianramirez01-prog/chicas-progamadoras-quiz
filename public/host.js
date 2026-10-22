const socket = io();

const SHAPES = ["▲", "◆", "●", "■"];
const el = (id) => document.getElementById(id);

const screens = {
  lobby: el("lobbyScreen"),
  question: el("questionScreen"),
  reveal: el("revealScreen"),
  end: el("endScreen"),
};

function show(name) {
  Object.values(screens).forEach((s) => s.classList.add("hidden"));
  screens[name].classList.remove("hidden");
}

let currentQuestion = null;
let timerInterval = null;

socket.emit("host:join");

socket.on("host:state", (state) => {
  el("joinUrl").textContent = state.lanUrl;
  renderPlayers(state.players);
  applyPhase(state.phase);
});

socket.on("host:error", ({ message }) => {
  el("hostStatus").textContent = message;
});

socket.on("lobby:update", ({ players }) => {
  renderPlayers(players);
});

socket.on("host:answered", ({ answered, total }) => {
  el("answeredCount").textContent = `Respondieron ${answered} / ${total}`;
});

socket.on("game:phase", ({ phase }) => applyPhase(phase));

function applyPhase(phase) {
  if (phase === "lobby") show("lobby");
  else if (phase === "ended") {
    // leaderboard filled by game:ended
  }
}

// ---- Controls ----
el("startBtn").addEventListener("click", () => {
  el("hostStatus").textContent = "";
  socket.emit("host:start");
});
el("revealBtn").addEventListener("click", () => socket.emit("host:next"));
el("nextBtn").addEventListener("click", () => socket.emit("host:next"));
el("restartBtn").addEventListener("click", () => socket.emit("host:reset"));
el("resetBtn").addEventListener("click", () => {
  if (confirm("¿Volver al lobby? Esto reinicia la partida actual.")) {
    socket.emit("host:reset");
  }
});
el("closeBtn").addEventListener("click", () => {
  if (confirm("¿Cerrar el juego? Se desconectará a todos los jugadores.")) {
    socket.emit("host:close");
  }
});

// The game was closed: return the host to a clean, empty lobby.
socket.on("game:closed", () => {
  show("lobby");
});

// ---- Question ----
socket.on("game:question", (q) => {
  currentQuestion = q;
  show("question");
  el("qCounter").textContent = `Pregunta ${q.index + 1} / ${q.total}`;
  el("answeredCount").textContent = `Respondieron 0`;
  el("qText").textContent = q.text;

  const container = el("answers");
  container.innerHTML = "";
  container.classList.toggle("two", q.options.length === 2);
  q.options.forEach((opt, i) => {
    const div = document.createElement("div");
    div.className = "answer";
    div.innerHTML = `<span class="shape">${SHAPES[i] || ""}</span><span>${escapeHtml(
      opt,
    )}</span>`;
    container.appendChild(div);
  });

  startTimer(q.time);
});

function startTimer(seconds) {
  clearInterval(timerInterval);
  let remaining = seconds;
  el("qTimer").textContent = `${remaining}`;
  timerInterval = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      remaining = 0;
      clearInterval(timerInterval);
    }
    el("qTimer").textContent = `${remaining}`;
  }, 1000);
}

// ---- Reveal ----
socket.on("game:reveal", (data) => {
  clearInterval(timerInterval);
  show("reveal");
  el("revealQText").textContent = currentQuestion ? currentQuestion.text : "";

  const totalVotes = data.distribution.reduce((a, b) => a + b, 0) || 1;
  const container = el("revealAnswers");
  container.innerHTML = "";
  const opts = currentQuestion ? currentQuestion.options : [];
  container.classList.toggle("two", opts.length === 2);

  opts.forEach((opt, i) => {
    const div = document.createElement("div");
    div.className = "answer";
    const isCorrect = i === data.correctIndex;
    if (isCorrect) div.classList.add("is-correct");
    else div.classList.add("is-wrong");
    const votes = data.distribution[i] || 0;
    const pct = Math.round((votes / totalVotes) * 100);
    const badge = isCorrect
      ? '<img class="check-badge" src="/check.svg" alt="Respuesta correcta" />'
      : "";
    div.innerHTML = `<span class="shape">${SHAPES[i] || ""}</span><span>${escapeHtml(
      opt,
    )} — ${votes} (${pct}%)</span>${badge}`;
    container.appendChild(div);
  });

  const shown = data.leaderboard ? data.leaderboard.length : 0;
  el("leaderboardTitle").textContent =
    data.totalPlayers && data.totalPlayers > shown
      ? `Top ${shown} de ${data.totalPlayers}`
      : "Tabla de posiciones";
  renderLeaderboard(el("leaderboard"), data.leaderboard);

  el("nextBtn").textContent =
    currentQuestion && currentQuestion.index + 1 >= currentQuestion.total
      ? "Ver ganadores"
      : "Siguiente pregunta";
});

// ---- End ----
socket.on("game:ended", ({ winners, fullBoard }) => {
  show("end");
  renderPodium(winners || []);
  renderLeaderboard(el("finalBoard"), fullBoard || []);
});

// ---- Helpers ----
function renderPlayers(players) {
  el("playerCount").textContent = players.length;
  const chips = el("playerChips");
  chips.innerHTML = "";
  players.forEach((p) => {
    const span = document.createElement("span");
    span.className = "chip";
    span.innerHTML = `<span class="chip-avatar">${p.avatar || "👤"}</span>${escapeHtml(
      p.name,
    )}`;
    chips.appendChild(span);
  });
}

function renderLeaderboard(listEl, board) {
  listEl.innerHTML = "";
  board.forEach((p, i) => {
    const li = document.createElement("li");
    if (i === 0) li.classList.add("top1");
    else if (i === 1) li.classList.add("top2");
    else if (i === 2) li.classList.add("top3");
    const correct =
      typeof p.correctCount === "number"
        ? `<span class="sub">${p.correctCount} correctas</span>`
        : "";
    li.innerHTML =
      `<span class="lb-player"><span class="rank">#${i + 1}</span>` +
      `<span class="lb-avatar">${p.avatar || "👤"}</span>` +
      `<span class="lb-name">${escapeHtml(p.name)}${correct}</span></span>` +
      `<span class="lb-score">${p.score}</span>`;
    listEl.appendChild(li);
  });
  if (board.length === 0) {
    const li = document.createElement("li");
    li.textContent = "Sin jugadores";
    listEl.appendChild(li);
  }
}

// Top-3 winners podium shown at the end of the game.
function renderPodium(winners) {
  const podium = el("podium");
  podium.innerHTML = "";
  // Visual order: 2nd, 1st, 3rd so #1 sits in the middle and tallest.
  const order = [1, 0, 2];
  order.forEach((idx) => {
    const p = winners[idx];
    if (!p) return;
    const place = idx + 1;
    const medal = place === 1 ? "🥇" : place === 2 ? "🥈" : "🥉";
    const div = document.createElement("div");
    div.className = `podium-spot place-${place}`;
    div.innerHTML =
      `<div class="podium-avatar">${p.avatar || "👤"}</div>` +
      `<div class="podium-name">${escapeHtml(p.name)}</div>` +
      `<div class="podium-score">${p.score} pts</div>` +
      `<div class="podium-block"><span class="podium-medal">${medal}</span>` +
      `<span class="podium-place">#${place}</span></div>`;
    podium.appendChild(div);
  });
  if (winners.length === 0) {
    podium.innerHTML = '<p class="center">Sin jugadores</p>';
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
