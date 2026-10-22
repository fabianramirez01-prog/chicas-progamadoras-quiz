# Container image for the Chicas Programadoras Quiz.
# Works on any container host (Fly.io, Railway, Cloud Run, etc.).
FROM node:20-alpine

WORKDIR /app

# Install dependencies first (better layer caching).
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the app.
COPY . .

# The app reads PORT from the environment; default to 3000 locally.
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
