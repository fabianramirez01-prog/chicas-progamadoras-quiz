const socket = io();

const SHAPES = ["▲", "◆", "●", "■"];

const el = (id) => document.getElementById(id);

const screens = {
  join: el("joinScreen"),
  wait: el("waitScreen"),
  question: el("questionScreen"),
  result: el("resultScreen"),
  end: el("endScreen"),
};

function show(name) {
  Object.values(screens).forEach((s) => s.classList.add("hidden"));
  screens[name].classList.remove("hidden");
}

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

let myName = "";
let myAvatar = AVATARS[0];
let joined = false;
let answered = false;

// Enable/disable the join form depending on the game phase. Players can only
// join during the lobby; otherwise show a "game in progress" notice.
function setJoinLocked(locked) {
  const form = el("joinForm");
  const lockedBox = el("joinLocked");
  if (!form || !lockedBox) return;
  form.classList.toggle("hidden", locked);
  lockedBox.classList.toggle("hidden", !locked);
}
let timerInterval = null;

// ---- Avatar picker ----
function buildAvatarPicker() {
  const grid = el("avatarGrid");
  grid.innerHTML = "";
  AVATARS.forEach((a, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "avatar-option" + (i === 0 ? " selected" : "");
    btn.textContent = a;
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", i === 0 ? "true" : "false");
    btn.addEventListener("click", () => {
      myAvatar = a;
      grid.querySelectorAll(".avatar-option").forEach((b) => {
        b.classList.remove("selected");
        b.setAttribute("aria-checked", "false");
      });
      btn.classList.add("selected");
      btn.setAttribute("aria-checked", "true");
    });
    grid.appendChild(btn);
  });
}
buildAvatarPicker();

// ---- Join ----
el("joinBtn").addEventListener("click", join);
el("nameInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") join();
});

function join() {
  const name = el("nameInput").value.trim();
  if (!name) {
    el("joinStatus").textContent = "Escribe un nombre.";
    return;
  }
  el("joinBtn").disabled = true;
  el("joinStatus").textContent = "Conectando...";
  socket.emit("player:join", { name, avatar: myAvatar }, (res) => {
    el("joinBtn").disabled = false;
    if (res && res.ok) {
      joined = true;
      myName = res.name;
      myAvatar = res.avatar || myAvatar;
      el("playerName").textContent = myName;
      el("waitAvatar").textContent = myAvatar;
      show("wait");
    } else {
      el("joinStatus").textContent = (res && res.error) || "No se pudo entrar.";
    }
  });
}

// ---- Question ----
socket.on("game:question", (q) => {
  answered = false;
  show("question");
  el("qCounter").textContent = `Pregunta ${q.index + 1} / ${q.total}`;
  el("qText").textContent = q.text;
  el("answerStatus").textContent = "";

  const container = el("answers");
  container.innerHTML = "";
  container.classList.toggle("two", q.options.length === 2);

  q.options.forEach((opt, i) => {
    const btn = document.createElement("button");
    btn.className = "answer";
    btn.innerHTML = `<span class="shape">${SHAPES[i] || ""}</span><span>${escapeHtml(
      opt,
    )}</span>`;
    btn.addEventListener("click", () => sendAnswer(i, btn));
    container.appendChild(btn);
  });

  startTimer(q.time);
});

function sendAnswer(optionIndex, btn) {
  if (answered) return;
  answered = true;
  // Dim the others, highlight this one.
  document.querySelectorAll("#answers .answer").forEach((b) => {
    if (b !== btn) b.classList.add("dimmed");
    b.disabled = true;
  });
  el("answerStatus").textContent = "Respuesta enviada. Espera...";
  socket.emit("player:answer", { optionIndex }, (res) => {
    if (res && !res.ok) {
      el("answerStatus").textContent = res.error || "Error al enviar.";
    }
  });
}

function startTimer(seconds) {
  clearInterval(timerInterval);
  let remaining = seconds;
  el("qTimer").textContent = `⏱ ${remaining}s`;
  timerInterval = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      remaining = 0;
      clearInterval(timerInterval);
      if (!answered) {
        el("answerStatus").textContent = "¡Se acabó el tiempo!";
        document
          .querySelectorAll("#answers .answer")
          .forEach((b) => (b.disabled = true));
      }
    }
    el("qTimer").textContent = `⏱ ${remaining}s`;
  }, 1000);
}

// ---- Result ----
socket.on("player:result", (r) => {
  clearInterval(timerInterval);
  show("result");
  el("resultAvatar").textContent = r.avatar || myAvatar;
  if (!r.answered) {
    el("resultTitle").textContent = "Sin respuesta";
    el("resultEmoji").textContent = "😴";
    el("resultPoints").textContent = "No respondiste a tiempo.";
  } else if (r.correct) {
    el("resultTitle").textContent = "¡Correcto!";
    el("resultEmoji").innerHTML =
      '<img class="result-check" src="/check.svg" alt="Respuesta correcta" />';
    el("resultPoints").textContent = `+${r.pointsEarned} puntos`;
  } else {
    el("resultTitle").textContent = "Incorrecto";
    el("resultEmoji").textContent = "❌";
    el("resultPoints").textContent = "Sin puntos esta vez.";
  }
  el("resultScore").textContent = r.score;
  el("resultRank").textContent =
    r.rank > 0
      ? `#${r.rank}${r.totalPlayers ? " / " + r.totalPlayers : ""}`
      : "-";
});

// ---- Game closed by the host ----
// Players are dropped on the server, so reset local state and send them back
// to the (unlocked) join screen to rejoin a future game.
socket.on("game:closed", () => {
  joined = false;
  myName = "";
  answered = false;
  clearInterval(timerInterval);
  setJoinLocked(false);
  el("joinStatus").textContent = "El anfitrión cerró el juego.";
  show("join");
});

// ---- Connection / phase changes ----
// On connect, ask the server what phase we're in so the join screen reflects
// whether joining is currently open.
socket.on("connect", () => {
  socket.emit("player:hello", (res) => {
    if (!joined) setJoinLocked(res && res.phase !== "lobby");
  });
});

socket.on("game:phase", ({ phase }) => {
  if (joined) {
    // A joined player returns to the waiting screen when the host resets.
    if (phase === "lobby") show("wait");
  } else {
    // A player still on the join screen: lock unless we're back in the lobby.
    setJoinLocked(phase !== "lobby");
  }
});

// ---- End ----
socket.on("game:ended", ({ fullBoard }) => {
  show("end");
  const board = fullBoard || [];
  const me = board.find((p) => p.name === myName);
  const place = board.findIndex((p) => p.name === myName) + 1;
  let medal = "🏁";
  if (place === 1) medal = "🥇";
  else if (place === 2) medal = "🥈";
  else if (place === 3) medal = "🥉";
  el("endAvatar").textContent = (me && me.avatar) || myAvatar;
  el("endPlace").textContent =
    place > 0 ? `${medal} Posición #${place}` : medal;
  el("endScore").textContent = me ? me.score : 0;
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
