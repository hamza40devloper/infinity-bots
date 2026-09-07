// KeepAliveMC Pro - Professional Minecraft KeepAlive Bot Service
// Features: Anti-AFK, Auto-Reconnect, Real-time Monitoring, Graceful Shutdown

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const winston = require('winston');

// ─── Configuration ───────────────────────────────────────────────────────────
const CONFIG = {
  PORT: parseInt(process.env.PORT, 10) || 3000,
  API_KEY: process.env.API_KEY || 'CHANGE_THIS_IMMEDIATELY',
  CORS_ORIGINS: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['http://localhost:5500'],
  DEFAULT_DURATION_MS: parseInt(process.env.DEFAULT_DURATION_MS, 10) || 24 * 60 * 60 * 1000,
  ANTI_AFK_INTERVAL_MS: parseInt(process.env.ANTI_AFK_INTERVAL_MS, 10) || 3 * 60 * 1000,
  MAX_RECONNECT_ATTEMPTS: parseInt(process.env.MAX_RECONNECT_ATTEMPTS, 10) || 5,
  RECONNECT_BASE_DELAY_MS: parseInt(process.env.RECONNECT_BASE_DELAY_MS, 10) || 5000,
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
};

// ─── Logger ──────────────────────────────────────────────────────────────────
const logger = winston.createLogger({
  level: CONFIG.LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ level, message, timestamp }) => `[${timestamp}] ${level.toUpperCase()}: ${message}`)
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

// Ensure logs directory exists
const fs = require('fs');
if (!fs.existsSync('logs')) fs.mkdirSync('logs');

// ─── Express & Socket.IO Setup ───────────────────────────────────────────────
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || CONFIG.CORS_ORIGINS.includes(origin) || CONFIG.CORS_ORIGINS.includes('*')) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
});

app.use(helmet({
  contentSecurityPolicy: false, // Allow frontend inline scripts
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: CONFIG.CORS_ORIGINS,
  credentials: true,
}));

app.use(express.json({ limit: '10kb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30,
  message: { error: 'Too many requests, please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// ─── Session Store ───────────────────────────────────────────────────────────
// sessions: Map<sessionId, Session>
// Session: { bot, timeout, info, nsName, state, reconnectCount, antiAfkInterval, startTime }
const sessions = new Map();
const namespaces = new Map(); // nsName -> { sockets: Set, emit: fn }

function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== CONFIG.API_KEY) {
    logger.warn(`Unauthorized API attempt from ${req.ip}`);
    return res.status(401).json({ error: 'Unauthorized. Invalid or missing x-api-key header.' });
  }
  next();
}

// ─── Namespace Manager (Safe Cleanup) ────────────────────────────────────────
function createNamespace(sessionId) {
  const nspName = `/session-${sessionId}`;
  const ns = io.of(nspName);
  const nsData = { sockets: new Set(), emit: (...args) => ns.emit(...args) };
  namespaces.set(nspName, nsData);

  ns.on('connection', (socket) => {
    nsData.sockets.add(socket);
    logger.info(`Console client connected: ${socket.id} for session ${sessionId}`);
    socket.emit('log', { ts: Date.now(), type: 'system', text: `Connected to session ${sessionId}. Waiting for bot events...` });

    socket.on('send', (msg) => {
      const session = sessions.get(sessionId);
      if (!session || !session.bot || session.state !== 'online') {
        socket.emit('log', { ts: Date.now(), type: 'error', text: 'Bot not available or not online.' });
        return;
      }
      if (typeof msg !== 'string' || msg.length > 256) {
        socket.emit('log', { ts: Date.now(), type: 'error', text: 'Invalid message (max 256 chars).' });
        return;
      }
      try {
        session.bot.chat(msg);
        socket.emit('log', { ts: Date.now(), type: 'self', text: msg });
      } catch (err) {
        socket.emit('log', { ts: Date.now(), type: 'error', text: `Send failed: ${err.message}` });
      }
    });

    socket.on('disconnect', () => {
      nsData.sockets.delete(socket);
      logger.info(`Console client disconnected: ${socket.id}`);
    });
  });

  return { nspName, nsData };
}

function deleteNamespace(nspName) {
  try {
    const ns = io.of(nspName);
    if (ns) {
      ns.sockets.forEach((socket) => socket.disconnect(true));
      // Deregister namespace safely
      io._nsps.delete(nspName);
      namespaces.delete(nspName);
      logger.info(`Namespace ${nspName} cleaned up`);
    }
  } catch (e) {
    logger.error(`Namespace cleanup error: ${e.message}`);
  }
}

function emitToSession(sessionId, event, data) {
  const nspName = `/session-${sessionId}`;
  const nsData = namespaces.get(nspName);
  if (nsData) {
    nsData.emit(event, data);
  }
}

// ─── Anti-AFK Engine ─────────────────────────────────────────────────────────
function startAntiAfk(session) {
  if (session.antiAfkInterval) clearInterval(session.antiAfkInterval);

  session.antiAfkInterval = setInterval(() => {
    if (!session.bot || session.state !== 'online') return;
    try {
      const actions = ['jump', 'look', 'sneak'];
      const action = actions[Math.floor(Math.random() * actions.length)];

      switch (action) {
        case 'jump':
          session.bot.setControlState('jump', true);
          setTimeout(() => session.bot.setControlState('jump', false), 500);
          break;
        case 'look':
          session.bot.look(Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.5, true);
          break;
        case 'sneak':
          session.bot.setControlState('sneak', true);
          setTimeout(() => session.bot.setControlState('sneak', false), 1000);
          break;
      }
      emitToSession(session.id, 'log', { ts: Date.now(), type: 'system', text: `[anti-afk] performed ${action}` });
    } catch (err) {
      logger.error(`Anti-AFK error for ${session.id}: ${err.message}`);
    }
  }, CONFIG.ANTI_AFK_INTERVAL_MS);
}

function stopAntiAfk(session) {
  if (session.antiAfkInterval) {
    clearInterval(session.antiAfkInterval);
    session.antiAfkInterval = null;
  }
}

// ─── Bot Lifecycle ───────────────────────────────────────────────────────────
function createBotInstance(session) {
  const { host, port, version, username } = session.info;

  try {
    const bot = mineflayer.createBot({
      host,
      port: parseInt(port, 10),
      username,
      version,
      auth: 'offline', // Change to 'microsoft' if you need premium accounts
      checkTimeoutInterval: 60 * 1000,
      closeTimeout: 10 * 1000,
      keepAlive: true,
      hideErrors: false,
    });

    session.bot = bot;
    session.state = 'connecting';
    session.reconnectCount = 0;

    // ── Event Handlers ──
    bot.on('login', () => {
      session.state = 'online';
      session.reconnectCount = 0;
      logger.info(`Bot logged in: ${bot.username} -> ${host}:${port}`);
      emitToSession(session.id, 'log', { ts: Date.now(), type: 'success', text: `Bot logged in as ${bot.username}` });
      emitToSession(session.id, 'status', { state: 'online', username: bot.username });
    });

    bot.on('spawn', () => {
      logger.info(`Bot spawned in world: ${session.id}`);
      emitToSession(session.id, 'log', { ts: Date.now(), type: 'success', text: 'Bot spawned in world. Anti-AFK activated.' });
      startAntiAfk(session);
      // Initial small movement to register presence
      setTimeout(() => {
        if (bot.entity) bot.look(0, 0, true);
      }, 2000);
    });

    bot.on('chat', (username, message) => {
      if (username === bot.username) return;
      emitToSession(session.id, 'chat', { ts: Date.now(), from: username, text: message });
    });

    bot.on('message', (jsonMsg) => {
      const text = jsonMsg.toString();
      // Filter out keepalive spam
      if (text.includes('keepalive') || text.includes('KeepAlive')) return;
      emitToSession(session.id, 'log', { ts: Date.now(), type: 'message', text });
    });

    bot.on('kicked', (reason) => {
      const reasonText = typeof reason === 'string' ? reason : JSON.stringify(reason);
      logger.warn(`Bot kicked from ${host}: ${reasonText}`);
      emitToSession(session.id, 'log', { ts: Date.now(), type: 'error', text: `Kicked: ${reasonText}` });
      emitToSession(session.id, 'status', { state: 'kicked', reason: reasonText });
      session.state = 'kicked';
      stopAntiAfk(session);
      attemptReconnect(session);
    });

    bot.on('error', (err) => {
      logger.error(`Bot error ${session.id}: ${err.message}`);
      emitToSession(session.id, 'log', { ts: Date.now(), type: 'error', text: `Error: ${err.message}` });
      if (session.state !== 'online') {
        session.state = 'error';
        attemptReconnect(session);
      }
    });

    bot.on('end', () => {
      logger.info(`Bot connection ended: ${session.id}`);
      emitToSession(session.id, 'log', { ts: Date.now(), type: 'warning', text: 'Connection closed by server.' });
      emitToSession(session.id, 'status', { state: 'offline' });
      if (session.state === 'online' || session.state === 'connecting') {
        session.state = 'offline';
        stopAntiAfk(session);
        attemptReconnect(session);
      }
    });

    // Health stats emitter
    const statsInterval = setInterval(() => {
      if (session.state === 'online' && bot.entity) {
        emitToSession(session.id, 'stats', {
          health: bot.health,
          food: bot.food,
          position: bot.entity.position,
          time: bot.time.timeOfDay,
        });
      }
    }, 5000);

    // Store interval for cleanup
    session.statsInterval = statsInterval;

    return bot;
  } catch (err) {
    logger.error(`Failed to create bot ${session.id}: ${err.message}`);
    session.state = 'error';
    emitToSession(session.id, 'log', { ts: Date.now(), type: 'error', text: `Spawn failed: ${err.message}` });
    return null;
  }
}

// ─── Reconnection Logic ──────────────────────────────────────────────────────
function attemptReconnect(session) {
  if (session.reconnectCount >= CONFIG.MAX_RECONNECT_ATTEMPTS) {
    logger.error(`Max reconnections reached for ${session.id}. Stopping session.`);
    emitToSession(session.id, 'log', { ts: Date.now(), type: 'error', text: 'Max reconnection attempts reached. Session terminated.' });
    stopSession(session.id, false);
    return;
  }

  session.reconnectCount++;
  const delay = CONFIG.RECONNECT_BASE_DELAY_MS * Math.pow(2, session.reconnectCount - 1);
  const jitter = Math.random() * 2000;
  const totalDelay = Math.min(delay + jitter, 60000); // Cap at 60s

  logger.info(`Reconnecting ${session.id} in ${Math.round(totalDelay)}ms (attempt ${session.reconnectCount}/${CONFIG.MAX_RECONNECT_ATTEMPTS})`);
  emitToSession(session.id, 'log', { ts: Date.now(), type: 'warning', text: `Reconnecting in ${Math.round(totalDelay / 1000)}s... (attempt ${session.reconnectCount}/${CONFIG.MAX_RECONNECT_ATTEMPTS})` });

  session.reconnectTimeout = setTimeout(() => {
    if (session.state === 'stopped') return;
    // Clean old bot if exists
    if (session.bot) {
      try { session.bot.end(); } catch (e) {}
      session.bot = null;
    }
    createBotInstance(session);
  }, totalDelay);
}

// ─── Session Manager ─────────────────────────────────────────────────────────
function stopSession(sessionId, manual = true) {
  const session = sessions.get(sessionId);
  if (!session) return false;

  logger.info(`Stopping session ${sessionId} (manual=${manual})`);
  session.state = 'stopped';

  // Clear all timers
  if (session.timeout) clearTimeout(session.timeout);
  if (session.reconnectTimeout) clearTimeout(session.reconnectTimeout);
  if (session.statsInterval) clearInterval(session.statsInterval);
  stopAntiAfk(session);

  // End bot
  if (session.bot) {
    try {
      session.bot.end();
      session.bot.removeAllListeners();
    } catch (e) {
      logger.error(`Error ending bot ${sessionId}: ${e.message}`);
    }
    session.bot = null;
  }

  // Notify and cleanup namespace
  emitToSession(sessionId, 'log', { ts: Date.now(), type: 'system', text: manual ? 'Session manually stopped.' : 'Session auto-stopped.' });
  emitToSession(sessionId, 'status', { state: 'stopped' });

  setTimeout(() => {
    deleteNamespace(session.nsName);
    sessions.delete(sessionId);
    logger.info(`Session ${sessionId} fully cleaned up`);
  }, 2000);

  return true;
}

// ─── API Routes ──────────────────────────────────────────────────────────────

// Health Check (for Railway/Render uptime monitoring)
app.get('/health', (req, res) => {
  const uptime = process.uptime();
  const activeSessions = sessions.size;
  res.status(200).json({
    status: 'healthy',
    uptime: Math.floor(uptime),
    activeSessions,
    version: '2.0.0',
    timestamp: new Date().toISOString(),
  });
});

// Spawn Bot
app.post('/api/spawn', requireApiKey, (req, res) => {
  const { host, port = 25565, version = '1.20.4', username = null, durationMs } = req.body;

  if (!host || typeof host !== 'string' || host.length > 253) {
    return res.status(400).json({ error: 'Valid host (domain/IP) is required, max 253 chars.' });
  }
  if (!/^([a-zA-Z0-9][-a-zA-Z0-9]*\.)*[a-zA-Z0-9][-a-zA-Z0-9]*$|^(\d{1,3}\.){3}\d{1,3}$/.test(host) && !host.includes(':')) {
    // Allow any host but warn - Minecraft servers can have unusual hostnames
  }

  const sessionId = uuidv4();
  const botUsername = username || `KeepAlive-${sessionId.slice(0, 6)}`;
  const dur = (typeof durationMs === 'number' && durationMs > 0) ? durationMs : CONFIG.DEFAULT_DURATION_MS;

  const { nspName, nsData } = createNamespace(sessionId);

  const session = {
    id: sessionId,
    bot: null,
    timeout: null,
    info: { host, port, version, username: botUsername, createdAt: new Date().toISOString() },
    nsName: nspName,
    state: 'initializing',
    reconnectCount: 0,
    antiAfkInterval: null,
    reconnectTimeout: null,
    statsInterval: null,
    startTime: Date.now(),
  };

  sessions.set(sessionId, session);

  // Create bot
  const bot = createBotInstance(session);
  if (!bot) {
    sessions.delete(sessionId);
    deleteNamespace(nspName);
    return res.status(500).json({ error: 'Failed to initialize bot instance.' });
  }

  // Schedule auto-stop
  session.timeout = setTimeout(() => {
    logger.info(`Auto-stopping session ${sessionId} after ${dur}ms`);
    stopSession(sessionId, false);
  }, dur);

  logger.info(`Session spawned: ${sessionId} -> ${host}:${port} (v${version})`);
  return res.status(201).json({
    sessionId,
    host,
    port,
    version,
    username: botUsername,
    durationMs: dur,
    expiresAt: new Date(Date.now() + dur).toISOString(),
    wsEndpoint: `/session-${sessionId}`,
  });
});

// Stop Bot
app.post('/api/stop/:sessionId', requireApiKey, (req, res) => {
  const { sessionId } = req.params;
  if (!sessions.has(sessionId)) {
    return res.status(404).json({ error: 'Session not found.' });
  }
  const success = stopSession(sessionId, true);
  return res.json({ stopped: success, sessionId });
});

// List Sessions
app.get('/api/sessions', requireApiKey, (req, res) => {
  const all = [];
  for (const [id, s] of sessions.entries()) {
    all.push({
      id,
      info: s.info,
      state: s.state,
      uptime: Date.now() - s.startTime,
      reconnectCount: s.reconnectCount,
    });
  }
  res.json({ count: all.length, sessions: all });
});

// Get Single Session
app.get('/api/sessions/:sessionId', requireApiKey, (req, res) => {
  const s = sessions.get(req.params.sessionId);
  if (!s) return res.status(404).json({ error: 'Session not found.' });
  res.json({
    id: s.id,
    info: s.info,
    state: s.state,
    uptime: Date.now() - s.startTime,
    reconnectCount: s.reconnectCount,
  });
});

// ─── Graceful Shutdown ───────────────────────────────────────────────────────
function gracefulShutdown(signal) {
  logger.warn(`Received ${signal}. Starting graceful shutdown...`);
  const promises = [];
  for (const [id] of sessions) {
    promises.push(new Promise((resolve) => {
      stopSession(id, false);
      setTimeout(resolve, 3000);
    }));
  }
  Promise.all(promises).then(() => {
    server.close(() => {
      logger.info('Server closed. Goodbye.');
      process.exit(0);
    });
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  logger.error(`Uncaught Exception: ${err.message}\\n${err.stack}`);
  // Don't crash immediately, but log it
});
process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled Rejection: ${reason}`);
});

// ─── Start Server ────────────────────────────────────────────────────────────
server.listen(CONFIG.PORT, () => {
  logger.info(`KeepAliveMC Pro v2.0.0 listening on port ${CONFIG.PORT}`);
  logger.info(`Health check: http://localhost:${CONFIG.PORT}/health`);
  if (CONFIG.API_KEY === 'CHANGE_THIS_IMMEDIATELY') {
    logger.warn('WARNING: Using default API key. Set API_KEY env var for production!');
  }
});
