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

// ===== Background music (host only) =====
// Generated with the Web Audio API so there's no audio file to ship or license.
// A gentle looping chord progression plays while a game is in progress. Audio
// can only start after a user gesture, so it begins when the host clicks
// "Iniciar juego" (or toggles the music button).
const Music = (() => {
  let ctx = null;
  let masterGain = null;
  let loopTimer = null;
  let playing = false;
  let muted = false;

  // A simple, pleasant chord progression (frequencies in Hz).
  // I–V–vi–IV in C major, voiced low so it sits under the gameplay.
  const chords = [
    [130.81, 164.81, 196.0], // C
    [196.0, 246.94, 293.66], // G
    [220.0, 261.63, 329.63], // Am
    [174.61, 220.0, 261.63], // F
  ];
  const beat = 1.6; // seconds per chord
  let step = 0;

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      masterGain = ctx.createGain();
      masterGain.gain.value = 0.0;
      masterGain.connect(ctx.destination);
    }
    return true;
  }

  // Play one chord plus a soft bass note, with gentle attack/release.
  function playChord(freqs, when) {
    const dur = beat * 0.95;
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = f;
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(0.09 / (i + 1), when + 0.08);
      g.gain.linearRampToValueAtTime(0.0001, when + dur);
      osc.connect(g);
      g.connect(masterGain);
      osc.start(when);
      osc.stop(when + dur);
    });
    // Bass note an octave below the root.
    const bass = ctx.createOscillator();
    const bg = ctx.createGain();
    bass.type = "triangle";
    bass.frequency.value = freqs[0] / 2;
    bg.gain.setValueAtTime(0, when);
    bg.gain.linearRampToValueAtTime(0.12, when + 0.1);
    bg.gain.linearRampToValueAtTime(0.0001, when + dur);
    bass.connect(bg);
    bg.connect(masterGain);
    bass.start(when);
    bass.stop(when + dur);
  }

  function scheduleLoop() {
    if (!playing) return;
    const now = ctx.currentTime;
    playChord(chords[step % chords.length], now + 0.02);
    step += 1;
    loopTimer = setTimeout(scheduleLoop, beat * 1000);
  }

  function fadeTo(value, seconds) {
    if (!masterGain) return;
    const now = ctx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(value, now + seconds);
  }

  function start() {
    if (!ensureCtx()) return;
    if (ctx.state === "suspended") ctx.resume();
    if (playing) return;
    playing = true;
    scheduleLoop();
    fadeTo(muted ? 0 : 1, 1.2);
  }

  function stop() {
    playing = false;
    clearTimeout(loopTimer);
    fadeTo(0, 0.6);
  }

  function setMuted(m) {
    muted = m;
    if (playing) fadeTo(muted ? 0 : 1, 0.4);
  }

  return {
    start,
    stop,
    setMuted,
    isMuted: () => muted,
    isPlaying: () => playing,
    context: () => ctx,
  };
})();

// ===== Sound effects (reveal reactions) =====
// Short cues played at reveal: a rising "cheer" arpeggio when most players
// accerted, a descending "aww" when most failed. Reuses the Web Audio context.
const Sfx = (() => {
  function getCtx() {
    let ctx = Music.context();
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  // Play a sequence of notes. notes: [{f, t}] frequency + start offset.
  function playNotes(notes, type, gainPeak) {
    const ctx = getCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    notes.forEach((n) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = n.f;
      const start = now + n.t;
      const dur = n.d || 0.18;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(gainPeak, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur + 0.02);
    });
  }

  // Happy rising major arpeggio (C–E–G–C).
  function success() {
    playNotes(
      [
        { f: 523.25, t: 0 },
        { f: 659.25, t: 0.12 },
        { f: 783.99, t: 0.24 },
        { f: 1046.5, t: 0.36, d: 0.3 },
      ],
      "triangle",
      0.3,
    );
  }

  // Sad descending "trombone" tones.
  function fail() {
    playNotes(
      [
        { f: 392.0, t: 0, d: 0.25 },
        { f: 329.63, t: 0.2, d: 0.25 },
        { f: 261.63, t: 0.4, d: 0.45 },
      ],
      "sawtooth",
      0.22,
    );
  }

  return { success, fail };
})();

socket.emit("host:join");

let maxPlayers = 35;

socket.on("host:state", (state) => {
  el("joinUrl").textContent = state.lanUrl;
  if (state.maxPlayers) maxPlayers = state.maxPlayers;
  renderPlayers(state.players);
  applyPhase(state.phase);
});

socket.on("host:error", ({ message }) => {
  el("hostStatus").textContent = message;
});

socket.on("lobby:update", ({ players, maxPlayers: mp }) => {
  if (mp) maxPlayers = mp;
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
  // The "Volver al inicio" button only makes sense during an active game;
  // hide it while in the lobby (no game started).
  el("resetBtn").classList.toggle("hidden", phase === "lobby");

  // Background music plays during an active game (question/reveal), and stops
  // in the lobby and on the final results screen.
  if (phase === "question" || phase === "reveal") {
    Music.start();
  } else {
    Music.stop();
  }

  // Leaving the reveal cancels any pending "show ranking" timer.
  if (phase !== "reveal") clearTimeout(rankingTimer);
}

// ---- Controls ----
el("startBtn").addEventListener("click", () => {
  el("hostStatus").textContent = "";
  // Starting the game is a user gesture, so we can kick off audio here. The
  // phase change will keep it running; this just unlocks the audio context.
  Music.start();
  socket.emit("host:start");
});

// Music mute/unmute toggle.
el("musicBtn").addEventListener("click", () => {
  const nowMuted = !Music.isMuted();
  Music.setMuted(nowMuted);
  const btn = el("musicBtn");
  btn.setAttribute("aria-pressed", nowMuted ? "true" : "false");
  btn.textContent = nowMuted ? "🔇 Música" : "🔊 Música";
  // If unmuting while a game is active, make sure audio is running.
  if (!nowMuted) Music.start();
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
  Music.stop();
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

  // ---- Stage 1: correct vs. incorrect summary bar graph ----
  const correct = data.correctCount || 0;
  const incorrect =
    data.incorrectCount != null
      ? data.incorrectCount
      : (data.wrongCount || 0) + (data.noAnswerCount || 0);
  renderResultBars(correct, incorrect);

  // Play a crowd-reaction sound: cheer if most accerted, "aww" if most failed.
  if (correct + incorrect > 0) {
    if (correct >= incorrect) Sfx.success();
    else Sfx.fail();
  }

  // Prepare (but hide) the ranking stage.
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

  // Two-stage reveal: show the summary first, then the ranking after a pause.
  el("revealSummary").classList.remove("hidden");
  el("revealRanking").classList.add("hidden");
  clearTimeout(rankingTimer);
  rankingTimer = setTimeout(() => {
    el("revealRanking").classList.remove("hidden");
  }, RANKING_DELAY_MS);
});

const RANKING_DELAY_MS = 3500; // pause before showing the ranking + next button
let rankingTimer = null;

// Build the correct-vs-incorrect summary bar graph with animated bars.
function renderResultBars(correct, incorrect) {
  const total = correct + incorrect || 1;
  const bars = el("resultBars");
  bars.innerHTML = "";

  const rows = [
    { label: "Acertaron", value: correct, cls: "bar-correct", icon: "✅" },
    { label: "No acertaron", value: incorrect, cls: "bar-wrong", icon: "❌" },
  ];

  rows.forEach((r) => {
    const pct = Math.round((r.value / total) * 100);
    const row = document.createElement("div");
    row.className = "result-bar-row";
    row.innerHTML =
      `<span class="result-bar-label">${r.icon} ${r.label}</span>` +
      `<div class="result-bar-track">` +
      `<div class="result-bar-fill ${r.cls}" style="width:0%">` +
      `<span class="result-bar-count">${r.value}</span></div></div>`;
    bars.appendChild(row);
    // Animate the width on the next frame.
    const fill = row.querySelector(".result-bar-fill");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        fill.style.width = Math.max(pct, r.value > 0 ? 8 : 0) + "%";
      });
    });
  });
}

// ---- End ----
socket.on("game:ended", ({ winners, fullBoard }) => {
  show("end");
  renderPodium(winners || []);
  renderLeaderboard(el("finalBoard"), fullBoard || []);
});

// ---- Helpers ----
function renderPlayers(players) {
  el("playerCount").textContent = `${players.length} / ${maxPlayers}`;
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

// Top-3 winners podium shown at the end of the game, with a staggered
// rise-up animation, a crown + confetti for the winner, and click-to-replay.
function renderPodium(winners) {
  const podium = el("podium");
  podium.innerHTML = "";
  if (!winners || winners.length === 0) {
    podium.innerHTML = '<p class="center">Sin jugadores</p>';
    return;
  }

  // Visual order: 2nd, 1st, 3rd so #1 sits in the middle and tallest.
  const order = [1, 0, 2];
  order.forEach((idx) => {
    const p = winners[idx];
    if (!p) return;
    const place = idx + 1;
    const medal = place === 1 ? "🥇" : place === 2 ? "🥈" : "🥉";
    const crown = place === 1 ? '<div class="podium-crown">👑</div>' : "";
    const div = document.createElement("div");
    div.className = `podium-spot place-${place}`;
    div.innerHTML =
      `<div class="podium-head">` +
      crown +
      `<div class="podium-avatar">${p.avatar || "👤"}</div>` +
      `<div class="podium-name">${escapeHtml(p.name)}</div>` +
      `<div class="podium-score">${p.score} pts</div>` +
      `</div>` +
      `<div class="podium-block"><span class="podium-medal">${medal}</span>` +
      `<span class="podium-place">#${place}</span></div>`;
    podium.appendChild(div);
  });

  // Confetti burst once the winner's block has risen.
  setTimeout(() => launchConfetti(podium), 1300);

  // Tap/click the podium to replay the whole animation.
  podium.onclick = () => replayPodium(winners);
}

function replayPodium(winners) {
  const podium = el("podium");
  podium.classList.add("replay");
  // Force reflow so removing the class restarts the animations.
  void podium.offsetWidth;
  renderPodium(winners);
  podium.classList.remove("replay");
}

function launchConfetti(container) {
  const colors = [
    "#ff418b",
    "#5854a4",
    "#73bb3e",
    "#672f91",
    "#ffd700",
    "#ffffff",
  ];
  const count = 70;
  for (let i = 0; i < count; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti";
    piece.style.left = Math.random() * 100 + "%";
    piece.style.background = colors[i % colors.length];
    piece.style.animationDuration = 1.6 + Math.random() * 1.4 + "s";
    piece.style.animationDelay = Math.random() * 0.5 + "s";
    piece.style.transform = `rotate(${Math.random() * 360}deg)`;
    if (Math.random() > 0.5) piece.style.borderRadius = "50%";
    container.appendChild(piece);
    // Clean up after it falls.
    setTimeout(() => piece.remove(), 3600);
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
