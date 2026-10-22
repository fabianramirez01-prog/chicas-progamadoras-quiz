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

// Avatar list and taken set are provided by the server (player:hello /
// lobby:update) so the picker always reflects the real options and which ones
// are already in use. A small fallback is used until the server replies.
let AVATARS = ["👩‍💻", "👩‍🔬", "👩‍🚀", "🦊", "🦄", "🌸", "⭐"];
let takenAvatars = [];

let myName = "";
let myAvatar = null; // chosen avatar, or null to let the server pick a free one
let joined = false;
let answered = false;
let timerInterval = null;

// A random nickname shown as the input placeholder. If the player leaves the
// field blank, this exact name is sent to the server, so what they see is what
// they get. Mirrors the server's naming style.
const NAME_ADJ = [
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
const NAME_NOUN = [
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

function makeRandomName() {
  const adj = NAME_ADJ[Math.floor(Math.random() * NAME_ADJ.length)];
  const noun = NAME_NOUN[Math.floor(Math.random() * NAME_NOUN.length)];
  const num = Math.floor(Math.random() * 100);
  return `${adj}${noun}${num}`;
}

let suggestedName = makeRandomName();

// Enable/disable the join form depending on the game phase. Players can only
// join during the lobby; otherwise show a "game in progress" notice.
function setJoinLocked(locked) {
  const form = el("joinForm");
  const lockedBox = el("joinLocked");
  if (!form || !lockedBox) return;
  form.classList.toggle("hidden", locked);
  lockedBox.classList.toggle("hidden", !locked);
}

// ---- Avatar picker ----
function buildAvatarPicker() {
  const grid = el("avatarGrid");
  if (!grid) return;
  const taken = new Set(takenAvatars);
  grid.innerHTML = "";

  // If the currently selected avatar got taken by someone else, clear it.
  if (myAvatar && taken.has(myAvatar)) myAvatar = null;

  AVATARS.forEach((a) => {
    const btn = document.createElement("button");
    btn.type = "button";
    const isTaken = taken.has(a);
    const isSelected = a === myAvatar;
    btn.className =
      "avatar-option" +
      (isSelected ? " selected" : "") +
      (isTaken ? " taken" : "");
    btn.textContent = a;
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", isSelected ? "true" : "false");
    if (isTaken) {
      btn.disabled = true;
      btn.title = "Ya elegido por otra jugadora";
    } else {
      btn.addEventListener("click", () => {
        myAvatar = a;
        buildAvatarPicker();
      });
    }
    grid.appendChild(btn);
  });
}
buildAvatarPicker();

// ---- Join ----
// Show the random suggestion as the field's placeholder.
el("nameInput").placeholder = suggestedName;

el("joinBtn").addEventListener("click", join);
el("nameInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") join();
});

function join() {
  // Name is optional — if the field is blank, use the suggested random name
  // shown in the placeholder so the player gets exactly what they saw.
  const typed = el("nameInput").value.trim();
  const name = typed || suggestedName;
  el("joinBtn").disabled = true;
  el("joinStatus").textContent = "Conectando...";
  // Send the chosen avatar if any; otherwise let the server assign a free one.
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
      // If the suggested random name collided with a taken one, generate a
      // fresh suggestion and update the placeholder so the next try works.
      if (!typed) {
        suggestedName = makeRandomName();
        el("nameInput").placeholder = suggestedName;
      }
      el("joinStatus").textContent = (res && res.error) || "No se pudo entrar.";
    }
  });
}

// Keep the avatar picker in sync as other players join/leave.
socket.on("lobby:update", (data) => {
  if (joined) return;
  if (data && Array.isArray(data.takenAvatars)) {
    takenAvatars = data.takenAvatars;
    buildAvatarPicker();
  }
  if (data && data.full) {
    el("joinBtn").disabled = true;
    el("joinStatus").textContent =
      `El juego está lleno (máx. ${data.maxPlayers}).`;
  } else {
    el("joinBtn").disabled = false;
    if (el("joinStatus").textContent.startsWith("El juego está lleno")) {
      el("joinStatus").textContent = "";
    }
  }
});

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
    if (!res) return;
    if (Array.isArray(res.avatars) && res.avatars.length) {
      AVATARS = res.avatars;
    }
    if (Array.isArray(res.takenAvatars)) {
      takenAvatars = res.takenAvatars;
    }
    buildAvatarPicker();
    if (!joined) {
      setJoinLocked(res.phase !== "lobby");
      if (res.full && res.phase === "lobby") {
        el("joinBtn").disabled = true;
        el("joinStatus").textContent =
          `El juego está lleno (máx. ${res.maxPlayers}).`;
      }
    }
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
