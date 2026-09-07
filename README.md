# KeepAliveMC Pro 🔷

> **Professional 24/7 Minecraft Bot Service** — Anti-AFK, Auto-Reconnect, Real-time Monitoring, and Production-Ready Deployment.

[![Node.js](https://img.shields.io/badge/Node.js-20+-green?logo=node.js)](https://nodejs.org/)
[![Mineflayer](https://img.shields.io/badge/Mineflayer-4.14-blue)](https://github.com/PrismarineJS/mineflayer)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## ✨ What's New in Pro

| Feature | Description |
|---------|-------------|
| **🤖 Anti-AFK Engine** | Bot jumps, looks around, and sneaks automatically every 3 minutes to avoid server kicks |
| **🔄 Auto-Reconnect** | Exponential backoff reconnection (up to 5 attempts) if the bot disconnects |
| **📊 Real-time Stats** | Live health, food, position, and uptime tracking via WebSocket |
| **🛡️ Production Security** | Helmet, Rate Limiting, CORS restrictions, and API Key authentication |
| **🧹 Safe Cleanup** | Graceful shutdown with zero memory leaks and proper namespace disposal |
| **🎨 Pro Dashboard** | Dark-themed, responsive control panel with command history and session management |
| **🏥 Health Checks** | `/health` endpoint for Railway/Render uptime monitoring |
| **📝 Structured Logging** | Winston logger with timestamps, log rotation, and error tracking |

---

## 🚀 Quick Start (Local)

```bash
# 1. Clone & enter directory
cd keepalivemc-pro

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env and set a strong API_KEY

# 4. Start server
npm start

# 5. Open frontend/frontend/index.html in your browser
#    Or serve it via VS Code Live Server / GitHub Pages
```

---

## 🐳 Docker Deployment

```bash
# Build image
docker build -t keepalivemc-pro .

# Run container
docker run -d -p 3000:3000 --env-file .env --name keepalivemc keepalivemc-pro
```

---

## 🚂 Railway Deployment

1. Push this repo to GitHub
2. Create a new Railway project from GitHub repo
3. Add environment variables in Railway Dashboard:
   - `API_KEY` — generate a strong secret
   - `CORS_ORIGINS` — your GitHub Pages URL (e.g., `https://yourname.github.io`)
4. Railway will auto-detect the Dockerfile and deploy
5. Copy the deployed URL and paste it in `frontend/index.html` (`API_BASE` variable)

---

## ⚙️ Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_KEY` | *(required)* | Secret key for API authentication |
| `PORT` | `3000` | Server port (Railway overrides this) |
| `CORS_ORIGINS` | `*` | Comma-separated allowed frontend origins |
| `DEFAULT_DURATION_MS` | `86400000` | Default session lifetime (24h) |
| `ANTI_AFK_INTERVAL_MS` | `180000` | Anti-AFK action interval (3min) |
| `MAX_RECONNECT_ATTEMPTS` | `5` | Max reconnection retries per session |
| `RECONNECT_BASE_DELAY_MS` | `5000` | Base delay before first reconnect |
| `LOG_LEVEL` | `info` | Winston log level |

---

## 🔌 API Endpoints

### `POST /api/spawn`
Spawn a new bot session.

**Headers:** `x-api-key: your_secret`

**Body:**
```json
{
  "host": "play.example.com",
  "port": 25565,
  "version": "1.20.4",
  "username": "MyBot",
  "durationMs": 86400000
}
```

**Response:**
```json
{
  "sessionId": "uuid",
  "host": "play.example.com",
  "port": 25565,
  "version": "1.20.4",
  "username": "MyBot",
  "durationMs": 86400000,
  "expiresAt": "2024-01-01T00:00:00.000Z",
  "wsEndpoint": "/session-uuid"
}
```

### `POST /api/stop/:sessionId`
Stop a running session immediately.

### `GET /api/sessions`
List all active sessions with state and uptime.

### `GET /api/sessions/:sessionId`
Get detailed info for a specific session.

### `GET /health`
Health check for uptime monitors (returns 200 if healthy).

---

## 🎮 Frontend Features

- **🌙 Dark Professional UI** — Built with CSS variables, no heavy frameworks
- **📡 Live Console** — Color-coded logs with timestamps (System, Chat, Error, Success)
- **📊 Real-time Stats** — Health, Food, Position, Uptime cards
- **⌨️ Command History** — Use ↑/↓ arrows to navigate previous commands
- **📋 Session Manager** — View all bots, click to switch between consoles
- **🔔 Toast Notifications** — Non-blocking alerts for all actions
- **📱 Responsive** — Works on desktop, tablet, and mobile

---

## 🔧 Troubleshooting

### Bot connects then disconnects immediately
1. **Check server version** — Must match exactly (e.g., `1.20.4` not `1.20`)
2. **Enable offline mode** — Set `auth: 'offline'` in server.js if server allows cracked clients
3. **Anti-cheat plugins** — Some servers block mineflayer. Try different servers.
4. **Firewall** — Ensure port 25565 (or custom) is open.

### "Unauthorized" errors
- Make sure `x-api-key` header matches your `API_KEY` env variable exactly.

### Socket not connecting
- Update `API_BASE` in `frontend/index.html` to your Railway URL.
- Check browser DevTools → Network → WS for connection errors.

---

## 📁 Project Structure

```
keepalivemc-pro/
├── server.js              # Main backend (Express + Socket.IO + Mineflayer)
├── frontend/
│   └── index.html         # Professional control panel
├── Dockerfile             # Multi-stage production build
├── package.json           # Dependencies & scripts
├── .env.example           # Environment template
├── .gitignore             # Ignore node_modules, logs, .env
├── logs/                  # Auto-created log files
└── README.md              # This file
```

---

## 📜 License

MIT License — Free for personal and commercial use.

---

**Made with 💜 for the Minecraft community.**
