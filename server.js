// ═══════════════════════════════════════════════════════════
//  KeepAliveMC v2.0 - Auto-Cleanup Edition
//  بدون كلمة سر - نظف تلقائي - متاح للجميع
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
const MAX_SESSIONS = 10;           // أقصى عدد جلسات في نفس الوقت
const MAX_SESSIONS_PER_IP = 3;     // أقصى عدد جلسات لكل مستخدم
const CLEANUP_CHECK_INTERVAL = 60 * 1000;  // فحص كل 60 ثانية
const SESSION_TIMEOUT = 24 * 60 * 60 * 1000; // الجلسة تنتهي بعد 24 ساعة
const BOT_CHECK_INTERVAL = 30 * 1000; // فحص البوت كل 30 ثانية

// ═══════════════ تخزين الجلسات ═══════════════
const sessions = new Map(); // sessionId -> sessionData
const ipSessionCount = new Map(); // ip -> count
let totalCleanups = 0;
let totalSpawns = 0;

// ═══════════════ إنشاء الخادم ═══════════════
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// ═══════════════ الوسائط (Middleware) ═══════════════
app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(cors({
  origin: "*"
}));
app.use(express.json());

// حد معدل الطلبات
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// ═══════════════ قائمة الإصدارات المدعومة ═══════════════
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

// ═══════════════ أدوات مساعدة ═══════════════
function log(msg, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const colors = {
    info: '\x1b[36m',
    success: '\x1b[32m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
    cleanup: '\x1b[35m'
  };
  const reset = '\x1b[0m';
  console.log(`${colors[type]}[${timestamp}] ${msg}${reset}`);
  
  // إرسال للواجهة
  io.emit('server-log', {
    timestamp,
    message: msg,
    type
  });
}

function generateSessionId() {
  return `sess_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] || 
         req.headers['x-real-ip'] || 
         req.connection?.remoteAddress || 
         req.socket?.remoteAddress || 
         'unknown';
}

function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

// ═══════════════ نظام التنظيف التلقائي ═══════════════
async function checkServerAlive(host, port) {
  return new Promise((resolve) => {
    const net = require('net');
    const socket = new net.Socket();
    
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 5000);
    
    socket.connect(port, host, () => {
      clearTimeout(timeout);
      socket.destroy();
      resolve(true);
    });
    
    socket.on('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

async function cleanupSession(sessionId, reason = 'server-offline') {
  const session = sessions.get(sessionId);
  if (!session) return;

  try {
    // إيقاف البوت
    if (session.bot) {
      try {
        session.bot.quit();
        session.bot.end();
      } catch (e) {
        // تجاهل أخطاء الإيقاف
      }
      session.bot = null;
    }

    // حذف الجلسة
    sessions.delete(sessionId);

    // تحديث عداد IP
    const ip = session.ip;
    if (ipSessionCount.has(ip)) {
      const count = ipSessionCount.get(ip);
      if (count <= 1) {
        ipSessionCount.delete(ip);
      } else {
        ipSessionCount.set(ip, count - 1);
      }
    }

    totalCleanups++;

    if (reason === 'server-offline') {
      log(`🗑️ CLEANUP: Session ${sessionId} removed - Server ${session.host}:${session.port} is offline`, 'cleanup');
    } else if (reason === 'timeout') {
      log(`🗑️ CLEANUP: Session ${sessionId} removed - Session timeout (24h)`, 'cleanup');
    } else if (reason === 'manual') {
      log(`🗑️ Session ${sessionId} stopped manually`, 'cleanup');
    } else if (reason === 'bot-error') {
      log(`🗑️ CLEANUP: Session ${sessionId} removed - Bot error`, 'cleanup');
    } else {
      log(`🗑️ Session ${sessionId} removed (${reason})`, 'cleanup');
    }

    // إشعار الواجهة
    io.emit('session-removed', {
      sessionId,
      reason,
      message: reason === 'server-offline' 
        ? `تم حذف الجلسة تلقائياً - الخادم ${session.host} غير متصل`
        : `تم حذف الجلسة: ${sessionId}`
    });

    // تحديث الإحصائيات
    broadcastStats();
    
  } catch (error) {
    log(`Error cleaning up session ${sessionId}: ${error.message}`, 'error');
  }
}

async function runCleanupCheck() {
  if (sessions.size === 0) return;

  log(`🔍 Running cleanup check on ${sessions.size} sessions...`, 'cleanup');
  
  const sessionsToCheck = [...sessions.entries()];
  
  for (const [sessionId, session] of sessionsToCheck) {
    try {
      // 1. فحص انتهاء الوقت (24 ساعة)
      const sessionAge = Date.now() - session.startTime;
      if (sessionAge > SESSION_TIMEOUT) {
        await cleanupSession(sessionId, 'timeout');
        continue;
      }

      // 2. فحص حالة البوت
      if (!session.bot || session.bot.state === 'end') {
        await cleanupSession(sessionId, 'bot-dead');
        continue;
      }

      // 3. فحص اتصال الخادم
      const isAlive = await checkServerAlive(session.host, session.port);
      if (!isAlive) {
        await cleanupSession(sessionId, 'server-offline');
        continue;
      }

      // 4. فحص حالة البوت في اللعبة
      if (session.bot && session.bot.state !== 'end') {
        // تحديث آخر نشاط
        session.lastCheck = Date.now();
        
        // إرسال إحصائيات محدثة
        io.emit('session-stats', {
          sessionId,
          health: session.bot.health || 20,
          food: session.bot.food || 20,
          position: session.bot.entity?.position ? {
            x: Math.round(session.bot.entity.position.x),
            y: Math.round(session.bot.entity.position.y),
            z: Math.round(session.bot.entity.position.z)
          } : { x: 0, y: 0, z: 0 },
          uptime: sessionAge,
          ping: session.bot.player?.ping || 0
        });
      }

    } catch (error) {
      log(`Error checking session ${sessionId}: ${error.message}`, 'error');
    }
  }
  
  log(`✅ Cleanup check complete. Active sessions: ${sessions.size}`, 'cleanup');
}

// بدء فحص التنظيف الدوري
setInterval(runCleanupCheck, CLEANUP_CHECK_INTERVAL);

// ═══════════════ نظام Anti-AFK ═══════════════
function startAntiAFK(bot, sessionId) {
  const interval = setInterval(() => {
    if (!sessions.has(sessionId)) {
      clearInterval(interval);
      return;
    }
    
    try {
      if (bot.state === 'end') {
        clearInterval(interval);
        return;
      }

      // القفز
      bot.setControlState('jump', true);
      setTimeout(() => bot.setControlState('jump', false), 500);

      // تدوير الرأس
      const yaw = Math.random() * Math.PI * 2;
      const pitch = (Math.random() - 0.5) * 0.5;
      bot.look(yaw, pitch, false);

      log(`🤖 Anti-AFK: Bot ${sessionId} jumped & looked around`, 'info');
    } catch (error) {
      clearInterval(interval);
    }
  }, 3 * 60 * 1000); // كل 3 دقائق

  return interval;
}

// ═══════════════ نظام Auto-Reconnect ═══════════════
function attemptReconnect(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  session.reconnectAttempts = (session.reconnectAttempts || 0) + 1;
  
  if (session.reconnectAttempts > 5) {
    log(`❌ Session ${sessionId}: Max reconnect attempts reached`, 'error');
    cleanupSession(sessionId, 'max-reconnects');
    return;
  }

  const delay = Math.min(5000 * session.reconnectAttempts, 60000);
  log(`🔄 Session ${sessionId}: Reconnecting in ${delay/1000}s (attempt ${session.reconnectAttempts}/5)...`, 'warn');

  setTimeout(async () => {
    // تحقق أن الخادم ما زال متصلاً قبل إعادة المحاولة
    const isAlive = await checkServerAlive(session.host, session.port);
    if (!isAlive) {
      cleanupSession(sessionId, 'server-offline');
      return;
    }
    createBotSession(sessionId, session);
  }, delay);
}

// ═══════════════ إنشاء البوت ═══════════════
function createBotSession(sessionId, session) {
  try {
    log(`🤖 Creating bot for ${session.host}:${session.port} (v${session.version})...`, 'info');

    const bot = mineflayer.createBot({
      host: session.host,
      port: session.port,
      version: session.version,
      username: session.username,
      auth: 'offline',
      hideErrors: true,
      checkTimeoutInterval: 30 * 1000
    });

    session.bot = bot;
    session.state = 'connecting';

    // ═════ أحداث البوت ═════

    bot.on('login', () => {
      session.state = 'connected';
      session.reconnectAttempts = 0;
      log(`✅ Bot ${session.username} connected to ${session.host}:${session.port}`, 'success');
      
      io.emit('bot-status', {
        sessionId,
        status: 'connected',
        message: `البوت ${session.username} متصل بنجاح!`
      });

      // بدء Anti-AFK
      session.antiAfkInterval = startAntiAFK(bot, sessionId);
    });

    bot.on('spawn', () => {
      session.state = 'spawned';
      log(`🎮 Bot ${session.username} spawned in world`, 'success');
      
      io.emit('bot-status', {
        sessionId,
        status: 'spawned',
        message: `البوت ${session.username} ظهر في العالم!`
      });
    });

    bot.on('message', (message) => {
      const text = message.toString();
      io.emit('bot-chat', {
        sessionId,
        message: text,
        timestamp: new Date().toLocaleTimeString()
      });
    });

    bot.on('health', () => {
      io.emit('session-stats', {
        sessionId,
        health: bot.health,
        food: bot.food,
        position: bot.entity?.position ? {
          x: Math.round(bot.entity.position.x),
          y: Math.round(bot.entity.position.y),
          z: Math.round(bot.entity.position.z)
        } : { x: 0, y: 0, z: 0 },
        uptime: Date.now() - session.startTime
      });
    });

    bot.on('kicked', (reason) => {
      log(`⚠️ Bot ${session.username} kicked: ${reason}`, 'warn');
      io.emit('bot-status', {
        sessionId,
        status: 'kicked',
        message: `تم طرد البوت: ${reason}`
      });
    });

    bot.on('error', (err) => {
      log(`❌ Bot ${session.username} error: ${err.message}`, 'error');
      session.state = 'error';
    });

    bot.on('end', () => {
      log(`🔌 Bot ${session.username} disconnected`, 'warn');
      session.state = 'disconnected';
      
      // مسح Anti-AFK
      if (session.antiAfkInterval) {
        clearInterval(session.antiAfkInterval);
      }

      // محاولة إعادة الاتصال
      attemptReconnect(sessionId);
    });

  } catch (error) {
    log(`Failed to create bot: ${error.message}`, 'error');
    session.state = 'error';
  }
}

// ═══════════════ API Routes ═══════════════

// إنشاء جلسة جديدة (بدون API Key!)
app.post('/api/spawn', async (req, res) => {
  const clientIP = getClientIP(req);
  const { host, port, version, username } = req.body;

  // التحقق من المدخلات
  if (!host || !host.trim()) {
    return res.status(400).json({ error: 'Server address is required' });
  }

  if (!port || port < 1 || port > 65535) {
    return res.status(400).json({ error: 'Valid port is required (1-65535)' });
  }

  if (!version || !SUPPORTED_VERSIONS.includes(version)) {
    return res.status(400).json({ error: `Version not supported. Choose from: ${SUPPORTED_VERSIONS.slice(0, 5).join(', ')}...` });
  }

  // فحص عدد الجلسات الكلي
  if (sessions.size >= MAX_SESSIONS) {
    return res.status(429).json({ 
      error: `Server is full (${MAX_SESSIONS}/${MAX_SESSIONS} sessions). Try again later.` 
    });
  }

  // فحص عدد الجلسات لكل IP
  const userSessions = ipSessionCount.get(clientIP) || 0;
  if (userSessions >= MAX_SESSIONS_PER_IP) {
    return res.status(429).json({ 
      error: `You have reached the maximum of ${MAX_SESSIONS_PER_IP} sessions.` 
    });
  }

  // فحص أن الخادم متصل قبل إنشاء البوت
  const serverAlive = await checkServerAlive(host, parseInt(port));
  if (!serverAlive) {
    return res.status(400).json({ 
      error: `Cannot reach ${host}:${port}. Server appears to be offline.` 
    });
  }

  // إنشاء الجلسة
  const sessionId = generateSessionId();
  const botUsername = username?.trim() || `Bot${Math.floor(Math.random() * 9999)}`;

  const session = {
    id: sessionId,
    host: host.trim(),
    port: parseInt(port),
    version,
    username: botUsername,
    ip: clientIP,
    startTime: Date.now(),
    lastCheck: Date.now(),
    state: 'starting',
    bot: null,
    reconnectAttempts: 0,
    antiAfkInterval: null
  };

  sessions.set(sessionId, session);
  ipSessionCount.set(clientIP, userSessions + 1);
  totalSpawns++;

  // إنشاء البوت
  createBotSession(sessionId, session);

  log(`➕ New session: ${sessionId} | ${botUsername} → ${host}:${port} | IP: ${clientIP}`, 'success');

  broadcastStats();

  res.json({
    success: true,
    sessionId,
    host,
    port,
    version,
    username: botUsername,
    startTime: session.startTime,
    autoCleanup: true,
    message: 'Bot launched! It will auto-cleanup if the server goes offline.'
  });
});

// إيقاف جلسة
app.post('/api/stop/:sessionId', async (req, res) => {
  const sessionId = req.params.sessionId;
  
  if (!sessions.has(sessionId)) {
    return res.status(404).json({ error: 'Session not found' });
  }

  await cleanupSession(sessionId, 'manual');
  res.json({ success: true, message: 'Session stopped and cleaned up' });
});

// إيقاف جميع جلسات المستخدم
app.post('/api/stop-all', (req, res) => {
  const clientIP = getClientIP(req);
  let stopped = 0;

  for (const [sessionId, session] of sessions) {
    if (session.ip === clientIP) {
      cleanupSession(sessionId, 'manual');
      stopped++;
    }
  }

  res.json({ success: true, stopped, message: `Stopped ${stopped} sessions` });
});

// قائمة الجلسات
app.get('/api/sessions', (req, res) => {
  const clientIP = getClientIP(req);
  const sessionList = [];

  for (const [id, s] of sessions) {
    sessionList.push({
      id,
      host: s.host,
      port: s.port,
      version: s.version,
      username: s.username,
      state: s.state,
      startTime: s.startTime,
      uptime: Date.now() - s.startTime,
      uptimeFormatted: formatUptime(Date.now() - s.startTime),
      isOwner: s.ip === clientIP,
      autoCleanup: true
    });
  }

  res.json(sessionList);
});

// إحصائيات
app.get('/api/stats', (req, res) => {
  res.json({
    activeSessions: sessions.size,
    maxSessions: MAX_SESSIONS,
    totalSpawns,
    totalCleanups,
    memoryUsage: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    uptime: process.uptime(),
    nodeVersion: process.version
  });
});

// فحص الصحة
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    sessions: sessions.size,
    maxSessions: MAX_SESSIONS,
    autoCleanup: true,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

// قائمة الإصدارات المدعومة
app.get('/api/versions', (req, res) => {
  res.json(SUPPORTED_VERSIONS);
});

// ═══════════════ إرسال الإحصائيات للواجهة ═══════════════
function broadcastStats() {
  io.emit('stats-update', {
    activeSessions: sessions.size,
    maxSessions: MAX_SESSIONS,
    totalSpawns,
    totalCleanups,
    memoryUsage: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
  });
}

// إرسال الإحصائيات كل 10 ثواني
setInterval(broadcastStats, 10000);

// ═══════════════ WebSocket ═══════════════
io.on('connection', (socket) => {
  log(`🔌 Client connected (${socket.id})`, 'info');
  broadcastStats();

  // إرسال أمر للبوت
  socket.on('send-command', (data) => {
    const session = sessions.get(data.sessionId);
    if (session && session.bot && session.bot.state !== 'end') {
      try {
        session.bot.chat(data.command);
        log(`💬 Command sent to ${session.username}: ${data.command}`, 'info');
      } catch (error) {
        socket.emit('bot-chat', {
          sessionId: data.sessionId,
          message: `Error: ${error.message}`,
          type: 'error'
        });
      }
    }
  });

  socket.on('disconnect', () => {
    log(`🔌 Client disconnected (${socket.id})`, 'info');
  });
});

// ═══════════════ تنظيف عند الإغلاق ═══════════════
process.on('SIGTERM', async () => {
  log('🛑 SIGTERM received. Cleaning up all sessions...', 'cleanup');
  for (const [sessionId] of sessions) {
    await cleanupSession(sessionId, 'shutdown');
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  log('🛑 SIGINT received. Cleaning up all sessions...', 'cleanup');
  for (const [sessionId] of sessions) {
    await cleanupSession(sessionId, 'shutdown');
  }
  process.exit(0);
});

// ═══════════════ بدء الخادم ═══════════════
server.listen(PORT, () => {
  log('═══════════════════════════════════════════', 'success');
  log('  🚀 KeepAliveMC v2.0 Started!', 'success');
  log(`  📡 Port: ${PORT}`, 'info');
  log(`  🤖 Max Sessions: ${MAX_SESSIONS}`, 'info');
  log(`  🧹 Auto-Cleanup: Every ${CLEANUP_CHECK_INTERVAL/1000}s`, 'success');
  log(`  🔓 Authentication: NONE (Public)`, 'success');
  log(`  📋 Versions: ${SUPPORTED_VERSIONS[0]} - ${SUPPORTED_VERSIONS[SUPPORTED_VERSIONS.length-1]}`, 'info');
  log('═══════════════════════════════════════════', 'success');
});
