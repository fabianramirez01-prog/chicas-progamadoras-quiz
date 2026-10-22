# Chicas Programadoras Quiz

A Kahoot-style, real-time quiz you can run on your own machine over a local
network (LAN). The host shows questions on a big screen (projector / shared
display), and players join from their phones or laptops on the same Wi-Fi to
answer. Scores reward both **correct answers** and **how fast** players respond.
After every round the host sees the **top 5**, and at the end a **top 3 winners
podium** is shown.

Questions are read from [`questionsAndAnswers.md`](./questionsAndAnswers.md),
so you can edit the quiz without touching any code.

---

## Features

- Real-time play over the local network using WebSockets (Socket.IO).
- Host (projector) view and separate player (phone) view.
- Players pick a **nickname** and an **avatar** when joining.
- Speed-based scoring: faster correct answers earn more points, plus a small
  streak bonus for consecutive correct answers.
- **Top 5** leaderboard after each question.
- **Top 3** winners podium at the end.
- A green "mark done" check highlights the correct answer on reveal.
- Host controls: start, reveal/advance, return to lobby, play again, and
  **close game** (disconnects everyone and resets to an empty lobby).
- Branded with the Chicas Programadoras color palette.

---

## Requirements

- [Node.js](https://nodejs.org/) version 16 or newer (tested on Node 22).
- A host device and one or more player devices on the **same Wi-Fi / LAN**.

Check your Node version with:

```bash
node -v
```

---

## Setup

From the project folder:

```bash
npm install
```

This installs the two dependencies (`express` and `socket.io`).

---

## Running the app

Start the server:

```bash
npm start
```

You will see output like:

```
  Chicas Programadoras Quiz is running!

  Host screen (projector):  http://localhost:3000/host.html
  Players join at:          http://192.168.1.42:3000

  20 questions loaded. 20s per question.
```

1. **Host:** open `http://localhost:3000/host.html` on the computer connected to
   the projector / shared screen.
2. **Players:** on each phone or laptop (same network), open the "Players join
   at" URL shown in the console — for example `http://192.168.1.42:3000`.
   The exact IP depends on your network; always use the one printed by the
   server, not the example above.

> Tip: the join URL is also displayed large on the host's lobby screen so
> players can read it off the projector.

---

## How to play

1. Players open the join URL, type a nickname, pick an avatar, and tap **Entrar**.
   They appear as chips in the host lobby.
2. When everyone is in, the host clicks **Iniciar juego**.
3. Each question runs for a fixed time (default 20 seconds). Players tap an
   answer; faster correct answers score more.
4. On reveal, the correct answer is marked and the host sees the **top 5** with
   avatars, scores, and number of correct answers.
5. The host clicks **Siguiente pregunta** to continue.
6. After the last question, the host sees the **🏆 top 3 winners podium**
   (full ranking available behind "Ver tabla completa").
7. From the end screen the host can **Jugar de nuevo** (same players, scores
   reset) or **Cerrar juego** (disconnect everyone, back to an empty lobby).

A player can only join while the game is in the **lobby**. If a game is already
in progress, the join screen shows a "game in progress" notice until the host
returns to the lobby. The host can return to the lobby at any time with the
**↺ Volver al inicio** button.

---

## Editing the questions

Open [`questionsAndAnswers.md`](./questionsAndAnswers.md) and follow this format.
Each question is a list item; each option is an indented `a.`/`b.`/... line, and
the correct one is marked with `(correct)`:

```markdown
- What does HTML stand for?
  a. HyperText Markup Language (correct)
  b. Holistic Model Language
  c. Huge Model Language

- Is JavaScript used to make web pages interactive?
  a. True (correct)
  b. False
```

Notes:

- The first option on the question's own line marks a new question.
- The option containing `(correct)` is the right answer (the marker is hidden
  from players).
- Questions can have 2 options (True/False) or more.
- Restart the server after editing so changes take effect.

You can sanity-check parsing without starting the server:

```bash
node parseQuestions.js
```

This prints every parsed question with its correct answer marked.

---

## Configuration

Settings are read from environment variables at startup:

| Variable        | Default | Description                   |
| --------------- | ------- | ----------------------------- |
| `PORT`          | `3000`  | Port the server listens on.   |
| `QUESTION_TIME` | `20`    | Seconds allowed per question. |

Examples:

```bash
# Run on port 8080
PORT=8080 npm start

# Give players 30 seconds per question
QUESTION_TIME=30 npm start
```

---

## Deploying online

> **GitHub Pages will not work for this app.** Pages serves only static files,
> but this is a Node.js + Socket.IO server with live WebSocket connections. Use
> a host that runs Node. The server already reads `process.env.PORT`, so no code
> changes are needed.

Config files are included for several platforms:

### Render (`render.yaml`)

1. Push the repo to GitHub.
2. On [Render](https://render.com): **New + → Blueprint**, connect the repo.
   Render reads `render.yaml` automatically (free plan, build `npm install`,
   start `npm start`).
3. Open the generated `*.onrender.com` URL. The host screen is at
   `/host.html`; players use the root URL.

### Railway / Heroku (`Procfile`)

- **Railway:** create a project from the GitHub repo; it detects Node and uses
  the `Procfile` (`web: node server.js`).
- **Heroku:** `heroku create` then `git push heroku main`.

### Fly.io / any container host (`Dockerfile` + `fly.toml`)

```bash
fly auth login
fly launch --copy-config --name chicas-programadoras-quiz
fly deploy
```

The `Dockerfile` also works on Railway, Google Cloud Run, and other container
platforms. Build locally with:

```bash
docker build -t cpquiz .
docker run -p 3000:3000 cpquiz
```

Once deployed, everyone connects over the internet (no shared Wi-Fi needed) —
just share the public host and player URLs.

---

## Troubleshooting

- **Players can't reach the join URL:** make sure every device is on the same
  Wi-Fi, and that your computer's firewall allows incoming connections on the
  port (3000 by default). Use the exact IP the server prints.
- **"El juego ya comenzó" when trying to join:** a game is already running.
  Wait for it to finish, or have the host click **↺ Volver al inicio** /
  **Cerrar juego** to return to the lobby.
- **No LAN IP shown (falls back to `localhost`):** the server couldn't detect a
  non-internal IPv4 address. Players on other devices won't be able to connect;
  check that you're connected to a network.
- **Avatars show as boxes:** the device/browser lacks emoji support; the game
  still works, only the avatar glyph is affected.

---

## Project structure

```
QuizApp/
├── server.js             # HTTP + Socket.IO server and game state machine
├── parseQuestions.js     # Parses questionsAndAnswers.md into question data
├── questionsAndAnswers.md# The quiz content (edit this)
├── package.json
├── render.yaml           # Render deployment config
├── Procfile              # Railway / Heroku process definition
├── Dockerfile            # Container image (Fly.io, Cloud Run, etc.)
├── fly.toml              # Fly.io deployment config
├── .dockerignore
└── public/               # Client assets served to browsers
    ├── index.html        # Player (phone) view
    ├── player.js
    ├── host.html         # Host (projector) view
    ├── host.js
    ├── style.css         # Shared styles / brand palette
    ├── logo.jpg          # Club logo (corner + favicon)
    └── check.svg         # "Correct answer" check asset
```

---

## Tech stack

- **Node.js** + **Express** for the HTTP server and static file serving.
- **Socket.IO** for real-time host/player communication.
- Vanilla HTML/CSS/JavaScript on the client (no build step).
