// ═══════════════════════════════════════════════════════════
//  KeepAliveMC v2.1 - Anti-Kick Enhanced Edition (FIXED)
// ═══════════════════════════════════════════════════════════

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mineflayer = require('mineflayer');

// ═══════════════ الإعدادات ═══════════════
const PORT = process.env.PORT || 3000;
const MAX_SESSIONS = 10;
const MAX_SESSIONS_PER_IP = 3;
const CLEANUP_CHECK_INTERVAL = 60 * 1000;
const SESSION_TIMEOUT = 24 * 60 * 60 * 1000;
const RECONNECT_MAX_ATTEMPTS = 15;
const RECONNECT_BASE_DELAY = 10000;
const ANTI_AFK_INTERVAL = 30 * 1000;

// ═══════════════ تخزين ═══════════════
const sessions = new Map();
const ipSessionCount = new Map();
let totalCleanups = 0;
let totalSpawns = 0;

// ═══════════════ الخادم ═══════════════
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// ═══════════════ Middleware ═══════════════
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: "*" }));
app.use(express.json());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests' }
});
app.use('/api/', limiter);

// ═══════════════ الإصدارات المدعومة ═══════════════
const SUPPORTED_VERSIONS = [
  "1.8", "1.8.8", "1.8.9",
  "1.9", "1.9.1", "1.9.2", "1.9.3", "1.9.4",
  "1.10", "1.10.1", "1.10.2",
  "1.11", "1.11.1", "1.11.2",
  "1.12", "1.12.1", "1.12.2",
  "1.13", "1.13.1", "1.13.2",
  "1.14", "1.14.1", "1.14.2", "1.14.3", "1.14.4",
  "1.15", "1.15.1", "1.15.2",
  "1.16", "1.16.1", "1.16.2", "1.16.3", "1.16.4", "1.16.5",
  "1.17", "1.17.1",
  "1.18", "1.18.1", "1.18.2",
  "1.19", "1.19.1", "1.19.2", "1.19.3", "1.19.4",
  "1.20", "1.20.1", "1.20.2", "1.20.3", "1.20.4", "1.20.5", "1.20.6",
  "1.21", "1.21.1", "1.21.2", "1.21.3", "1.21.4"
];

// ═══════════════ أدوات ═══════════════
function log(msg, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const colors = {
    info: '\x1b[36m',
    success: '\x1b[32m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
    cleanup: '\x1b[35m',
    antiafk: '\x1b[90m'
  };
  console.log(`${colors[type] || ''}[${timestamp}] ${msg}\x1b[0m`);
  io.emit('server-log', { timestamp, message: msg, type });
}

function generateSessionId() {
  return `sess_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] || 
         req.headers['x-real-ip'] || 
         req.socket?.remoteAddress || 'unknown';
}

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

// ═══════════════ فحص اتصال الخادم ═══════════════
async function checkServerAlive(host, port) {
  return new Promise((resolve) => {
    const net = require('net');
    const socket = new net.Socket();
    const timeout = setTimeout(() => { socket.destroy(); resolve(false); }, 5000);
    socket.connect(port, host, () => { clearTimeout(timeout); socket.destroy(); resolve(true); });
    socket.on('error', () => { clearTimeout(timeout); resolve(false); });
  });
}

// ═══════════════ ANTI-AFK المحسّن ═══════════════
function startAntiAFK(session) {
  const { bot, id } = session;
  
  const antiAfkInterval = setInterval(() => {
    if (!sessions.has(id) || !session.bot || session.state === 'end') {
      clearInterval(antiAfkInterval);
      return;
    }

    try {
      const moveType = Math.floor(Math.random() * 5);

      switch (moveType) {
        case 0:
          bot.setControlState('jump', true);
          setTimeout(() => { try { bot.setControlState('jump', false); } catch(e){} }, 300);
          break;

        case 1:
          bot.setControlState('forward', true);
          setTimeout(() => { try { bot.setControlState('forward', false); } catch(e){} }, 500);
          break;

        case 2:
          const yaw = Math.random() * Math.PI * 2;
          const pitch = (Math.random() - 0.5) * 1.0;
          bot.look(yaw, pitch, true);
          break;

        case 3:
          bot.setControlState('sneak', true);
          setTimeout(() => { try { bot.setControlState('sneak', false); } catch(e){} }, 1000);
          break;

        case 4:
          bot.setControlState('jump', true);
          const newYaw = Math.random() * Math.PI * 2;
          bot.look(newYaw, 0, true);
          setTimeout(() => { try { bot.setControlState('jump', false); } catch(e){} }, 400);
          break;
      }

      log(`🤖 Anti-AFK: ${session.username} → ${['jump','walk','look','sneak','jump+look'][moveType]}`, 'antiafk');

    } catch (err) {
      // تجاهل
    }
  }, ANTI_AFK_INTERVAL);

  return antiAfkInterval;
}

// ═══════════════ التنظيف الذكي ═══════════════
async function cleanupSession(sessionId, reason = 'unknown') {
  const session = sessions.get(sessionId);
  if (!session) return;

  try {
    if (session.antiAfkInterval) {
      clearInterval(session.antiAfkInterval);
      session.antiAfkInterval = null;
    }

    if (session.reconnectTimer) {
      clearTimeout(session.reconnectTimer);
      session.reconnectTimer = null;
    }

    if (session.bot) {
      try {
        session.bot.removeAllListeners();
        session.bot.quit();
        session.bot.end();
      } catch (e) {}
      session.bot = null;
    }

    sessions.delete(sessionId);

    if (session.ip && ipSessionCount.has(session.ip)) {
      const count = ipSessionCount.get(session.ip);
      if (count <= 1) ipSessionCount.delete(session.ip);
      else ipSessionCount.set(session.ip, count - 1);
    }

    totalCleanups++;

    const reasons = {
      'server-offline': `🗑️ Server ${session.host} went offline - Auto-cleaned`,
      'timeout': `🗑️ Session ${sessionId} expired (24h)`,
      'manual': `🛑 Session ${sessionId} stopped by user`,
      'max-reconnects': `🗑️ Session ${sessionId} - Max reconnect attempts reached`,
      'shutdown': `🛑 Session ${sessionId} - Server shutdown`
    };

    log(reasons[reason] || `🗑️ Session ${sessionId} removed (${reason})`, 'cleanup');

    io.emit('session-removed', {
      sessionId,
      reason,
      message: reason === 'server-offline'
        ? `Auto-cleaned: Server offline`
        : `Session removed`
    });

    broadcastStats();
  } catch (err) {
    log(`Cleanup error: ${err.message}`, 'error');
  }
}

// ═══════════════ الفحص الدوري ═══════════════
async function runCleanupCheck() {
  if (sessions.size === 0) return;

  for (const [sessionId, session] of [...sessions.entries()]) {
    try {
      if (Date.now() - session.startTime > SESSION_TIMEOUT) {
        await cleanupSession(sessionId, 'timeout');
        continue;
      }

      const alive = await checkServerAlive(session.host, session.port);
      if (!alive) {
        await cleanupSession(sessionId, 'server-offline');
        continue;
      }

      if (session.bot && session.state !== 'end') {
        io.emit('session-stats', {
          sessionId,
          health: session.bot.health || 20,
          food: session.bot.food || 20,
          position: session.bot.entity?.position ? {
            x: Math.round(session.bot.entity.position.x),
            y: Math.round(session.bot.entity.position.y),
            z: Math.round(session.bot.entity.position.z)
          } : { x: 0, y: 0, z: 0 },
          uptime: Date.now() - session.startTime
        });
      }
    } catch (err) {
      log(`Check error for ${sessionId}: ${err.message}`, 'error');
    }
  }
}

setInterval(runCleanupCheck, CLEANUP_CHECK_INTERVAL);

// ═══════════════ إعادة الاتصال المحسّنة ═══════════════
function attemptReconnect(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  session.reconnectAttempts = (session.reconnectAttempts || 0) + 1;

  if (session.reconnectAttempts > RECONNECT_MAX_ATTEMPTS) {
    log(`❌ Session ${sessionId}: Max reconnects reached`, 'error');
    cleanupSession(sessionId, 'max-reconnects');
    return;
  }

  const delay = Math.min(RECONNECT_BASE_DELAY * session.reconnectAttempts, 60000);
  
  log(`🔄 Reconnect ${session.reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS} in ${delay/1000}s...`, 'warn');
  
  io.emit('bot-status', {
    sessionId,
    status: 'reconnecting',
    message: `Reconnecting (${session.reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS}) in ${delay/1000}s`
  });

  session.reconnectTimer = setTimeout(async () => {
    if (!sessions.has(sessionId)) return;

    const alive = await checkServerAlive(session.host, session.port);
    if (!alive) {
      cleanupSession(sessionId, 'server-offline');
      return;
    }

    createBotSession(sessionId, session);
  }, delay);
}

// ═══════════════ إنشاء البوت ═══════════════
function createBotSession(sessionId, session) {
  try {
    log(`🤖 Creating bot: ${session.username} → ${session.host}:${session.port} (v${session.version})`, 'info');

    const bot = mineflayer.createBot({
      host: session.host,
      port: session.port,
      version: session.version,
      username: session.username,
      auth: 'offline',
      hideErrors: true,
      checkTimeoutInterval: 30 * 1000,
      keepAlive: true,
      respawn: true,
      defaultChatPatterns: false
    });

    session.bot = bot;
    session.state = 'connecting';

    bot.on('login', () => {
      session.state = 'connected';
      session.reconnectAttempts = 0;
      log(`✅ ${session.username} connected to ${session.host}`, 'success');
      
      io.emit('bot-status', {
        sessionId, status: 'connected',
        message: `Bot ${session.username} connected!`
      });

      session.antiAfkInterval = startAntiAFK(session);
    });

    bot.on('spawn', () => {
      session.state = 'spawned';
      log(`🎮 ${session.username} spawned`, 'success');
      
      io.emit('bot-status', {
        sessionId, status: 'spawned',
        message: `Bot ${session.username} spawned!`
      });

      if (!session.antiAfkInterval) {
        session.antiAfkInterval = startAntiAFK(session);
      }
    });

    bot.on('message', (message) => {
      const text = message.toString();
      
      io.emit('bot-chat', {
        sessionId,
        message: text,
        timestamp: new Date().toLocaleTimeString()
      });

      const kickKeywords = [
        'kicked', 'banned', 'You are AFK', 'idle', 'timeout',
        'moved too quickly', 'flying is not enabled'
      ];
      
      const lowerText = text.toLowerCase();
      if (kickKeywords.some(kw => lowerText.includes(kw))) {
        log(`⚠️ Kick warning: ${text}`, 'warn');
      }
    });

    bot.on('health', () => {
      if (bot.health < 6 && bot.food > 0) {
        const yaw = Math.random() * Math.PI * 2;
        bot.look(yaw, 0, true);
      }
    });

    bot.on('kicked', (reason) => {
      log(`⚠️ ${session.username} KICKED: ${reason}`, 'warn');
      session.state = 'kicked';
      
      io.emit('bot-status', {
        sessionId, status: 'kicked',
        message: `Bot kicked: ${reason.substring(0, 100)}`
      });
    });

    bot.on('error', (err) => {
      log(`❌ Bot error: ${err.message}`, 'error');
      session.state = 'error';
    });

    bot.on('end', (reason) => {
      log(`🔌 ${session.username} disconnected: ${reason || 'unknown'}`, 'warn');
      session.state = 'disconnected';

      if (session.antiAfkInterval) {
        clearInterval(session.antiAfkInterval);
        session.antiAfkInterval = null;
      }

      if (sessions.has(sessionId)) {
        attemptReconnect(sessionId);
      }
    });

    bot.on('time', () => {
      if (bot.player?.ping) {
        session.ping = bot.player.ping;
      }
    });

  } catch (err) {
    log(`Failed to create bot: ${err.message}`, 'error');
    session.state = 'error';
  }
}

// ═══════════════ API ═══════════════

app.post('/api/spawn', async (req, res) => {
  const clientIP = getClientIP(req);
  const { host, port, version, username } = req.body;

  if (!host?.trim()) return res.status(400).json({ error: 'Server address required' });
  if (!port || port < 1 || port > 65535) return res.status(400).json({ error: 'Valid port required' });
  if (!version || !SUPPORTED_VERSIONS.includes(version)) {
    return res.status(400).json({ error: 'Version not supported' });
  }

  if (sessions.size >= MAX_SESSIONS) {
    return res.status(429).json({ error: `Server full (${MAX_SESSIONS} max)` });
  }

  const userCount = ipSessionCount.get(clientIP) || 0;
  if (userCount >= MAX_SESSIONS_PER_IP) {
    return res.status(429).json({ error: `Max ${MAX_SESSIONS_PER_IP} sessions per user` });
  }

  const alive = await checkServerAlive(host.trim(), parseInt(port));
  if (!alive) {
    return res.status(400).json({ error: `Server ${host}:${port} is offline` });
  }

  const sessionId = generateSessionId();
  const botUsername = (username?.trim() || `Bot${Math.floor(Math.random() * 9999)}`).substring(0, 16);

  const session = {
    id: sessionId,
    host: host.trim(),
    port: parseInt(port),
    version,
    username: botUsername,
    ip: clientIP,
    startTime: Date.now(),
    state: 'starting',
    bot: null,
    reconnectAttempts: 0,
    antiAfkInterval: null,
    reconnectTimer: null,
    ping: 0
  };

  sessions.set(sessionId, session);
  ipSessionCount.set(clientIP, userCount + 1);
  totalSpawns++;

  createBotSession(sessionId, session);

  log(`➕ New: ${botUsername} → ${host}:${port}`, 'success');
  broadcastStats();

  res.json({
    success: true,
    sessionId,
    host: session.host,
    port: session.port,
    version,
    username: botUsername,
    autoCleanup: true,
    antiAfk: '30s interval',
    message: 'Bot launched with enhanced Anti-AFK!'
  });
});

app.post('/api/stop/:sessionId', async (req, res) => {
  if (!sessions.has(req.params.sessionId)) {
    return res.status(404).json({ error: 'Not found' });
  }
  await cleanupSession(req.params.sessionId, 'manual');
  res.json({ success: true, message: 'Stopped' });
});

app.get('/api/sessions', (req, res) => {
  const clientIP = getClientIP(req);
  const list = [...sessions.values()].map(s => ({
    id: s.id,
    host: s.host,
    port: s.port,
    version: s.version,
    username: s.username,
    state: s.state,
    uptime: Date.now() - s.startTime,
    uptimeFormatted: formatUptime(Date.now() - s.startTime),
    isOwner: s.ip === clientIP,
    ping: s.ping || 0
  }));
  res.json(list);
});

app.get('/api/stats', (req, res) => {
  res.json({
    activeSessions: sessions.size,
    maxSessions: MAX_SESSIONS,
    totalSpawns,
    totalCleanups,
    memoryUsage: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    uptime: Math.floor(process.uptime())
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', sessions: sessions.size, autoCleanup: true });
});

app.get('/api/versions', (req, res) => {
  res.json(SUPPORTED_VERSIONS);
});

// ═══════════════ إرسال الإحصائيات ═══════════════
function broadcastStats() {
  io.emit('stats-update', {
    activeSessions: sessions.size,
    maxSessions: MAX_SESSIONS,
    totalSpawns,
    totalCleanups,
    memoryUsage: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
  });
}

setInterval(broadcastStats, 10000);

// ═══════════════ WebSocket ═══════════════
io.on('connection', (socket) => {
  broadcastStats();

  socket.on('send-command', (data) => {
    const session = sessions.get(data.sessionId);
    if (session?.bot && session.state !== 'end') {
      try {
        session.bot.chat(data.command);
        log(`💬 ${session.username}: ${data.command}`, 'info');
      } catch (err) {
        socket.emit('bot-chat', {
          sessionId: data.sessionId,
          message: `Error: ${err.message}`
        });
      }
    }
  });
});

// ═══════════════ الإغلاق الآمن ═══════════════
process.on('SIGTERM', async () => {
  for (const [id] of sessions) await cleanupSession(id, 'shutdown');
  process.exit(0);
});

process.on('SIGINT', async () => {
  for (const [id] of sessions) await cleanupSession(id, 'shutdown');
  process.exit(0);
});

// ═══════════════ البدء ═══════════════
server.listen(PORT, () => {
  log('═══════════════════════════════════════', 'success');
  log('  🚀 KeepAliveMC v2.1 Enhanced!', 'success');
  log(`  📡 Port: ${PORT}`, 'info');
  log(`  🤖 Anti-AFK: Every ${ANTI_AFK_INTERVAL/1000}s`, 'success');
  log(`  🔄 Max Reconnects: ${RECONNECT_MAX_ATTEMPTS}`, 'info');
  log(`  🔓 Public Access: YES`, 'success');
  log('═══════════════════════════════════════', 'success');
});
