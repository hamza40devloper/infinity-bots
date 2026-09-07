// ═══════════════════════════════════════════════════════════
//  KeepAliveMC v2.1 - Anti-Kick Enhanced Edition
//  إصلاح مشكلة طرد البوت بعد 3 دقائق
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
const CLEANUP_CHECK_INTERVAL = 60 * 1000;       // فحص كل 60 ثانية
const SESSION_TIMEOUT = 24 * 60 * 60 * 1000;    // 24 ساعة
const RECONNECT_MAX_ATTEMPTS = 15;               // زيادة المحاولات
const RECONNECT_BASE_DELAY = 10000;              // 10 ثواني بين المحاولات

// Anti-AFK - كل 30 ثانية (مهم جداً!)
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
    info: '\x1b[36m', success: '\x1b[32m', warn: '\x1b[33m',
    error: '\x1b[31m', cleanup: '\x1b[35m', anti-afk: '\x1b[90m'
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

// ═══════════════ ⭐ ANTI-AFK المحسّن ⭐ ═══════════════
// هذا هو الإصلاح الرئيسي - حركة كل 30 ثانية بدلاً من 3 دقائق
function startAntiAFK(session) {
  const { bot, id } = session;
  
  const antiAfkInterval = setInterval(() => {
    // التحقق من أن البوت ما زال حياً
    if (!sessions.has(id) || !session.bot || session.state === 'end') {
      clearInterval(antiAfkInterval);
      return;
    }

    try {
      // حركة عشوائية واقعية
      const moveType = Math.floor(Math.random() * 5);

      switch (moveType) {
        case 0: // قفز
          bot.setControlState('jump', true);
          setTimeout(() => { try { bot.setControlState('jump', false); } catch(e){} }, 300);
          break;

        case 1: // المشي للأمام قليلاً
          bot.setControlState('forward', true);
          setTimeout(() => { try { bot.setControlState('forward', false); } catch(e){} }, 500);
          break;

        case 2: // الالتفات
          const yaw = Math.random() * Math.PI * 2;
          const pitch = (Math.random() - 0.5) * 1.0;
          bot.look(yaw, pitch, true);
          break;

        case 3: // التخفي (sneak)
          bot.setControlState('sneak', true);
          setTimeout(() => { try { bot.setControlState('sneak', false); } catch(e){} }, 1000);
          break;

        case 4: // قفز + التفات معاً
          bot.setControlState('jump', true);
          const newYaw = Math.random() * Math.PI * 2;
          bot.look(newYaw, 0, true);
          setTimeout(() => { try { bot.setControlState('jump', false); } catch(e){} }, 400);
          break;
      }

      // إرسال حركة (packet) إضافية للتأكيد
      if (bot._client && bot._client.state === 'play') {
        // تجاهل - mineflayer يرسل تلقائياً
      }

      log(`🤖 Anti-AFK: ${session.username} → ${['jump','walk','look','sneak','jump+look'][moveType]}`, 'anti-afk');

    } catch (err) {
      // البوت قد يكون مات - تجاهل
    }
  }, ANTI_AFK_INTERVAL); // كل 30 ثانية!

  return antiAfkInterval;
}

// ═══════════════ ⭐ التنظيف الذكي ⭐ ═══════════════
async function cleanupSession(sessionId, reason = 'unknown') {
  const session = sessions.get(sessionId);
  if (!session) return;

  try {
    // إيقاف Anti-AFK
    if (session.antiAfkInterval) {
      clearInterval(session.antiAfkInterval);
      session.antiAfkInterval = null;
    }

    // إيقاف reconnect timer
    if (session.reconnectTimer) {
      clearTimeout(session.reconnectTimer);
      session.reconnectTimer = null;
    }

    // إنهاء البوت
    if (session.bot) {
      try {
        session.bot.removeAllListeners();
        session.bot.quit();
        session.bot.end();
      } catch (e) {}
      session.bot = null;
    }

    // حذف من الذاكرة
    sessions.delete(sessionId);

    // تحديث عداد IP
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
        ? `تم حذف الجلسة تلقائياً - الخادم غير متصل`
        : `تم حذف الجلسة`
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
      // فحص انتهاء الوقت
      if (Date.now() - session.startTime > SESSION_TIMEOUT) {
        await cleanupSession(sessionId, 'timeout');
        continue;
      }

      // فحص اتصال الخادم
      const alive = await checkServerAlive(session.host, session.port);
      if (!alive) {
        await cleanupSession(sessionId, 'server-offline');
        continue;
      }

      // تحديث إحصائيات
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

// ═══════════════ ⭐ إعادة الاتصال المحسّنة ⭐ ═══════════════
function attemptReconnect(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  session.reconnectAttempts = (session.reconnectAttempts || 0) + 1;

  if (session.reconnectAttempts > RECONNECT_MAX_ATTEMPTS) {
    log(`❌ Session ${sessionId}: Max reconnects (${RECONNECT_MAX_ATTEMPTS}) reached`, 'error');
    cleanupSession(sessionId, 'max-reconnects');
    return;
  }

  // تأخير متزايد: 10s, 20s, 30s, 40s... حتى 60s
  const delay = Math.min(RECONNECT_BASE_DELAY * session.reconnectAttempts, 60000);
  
  log(`🔄 Reconnect ${session.reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS} in ${delay/1000}s...`, 'warn');
  
  io.emit('bot-status', {
    sessionId,
    status: 'reconnecting',
    message: `إعادة اتصال (${session.reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS}) بعد ${delay/1000} ثانية`
  });

  session.reconnectTimer = setTimeout(async () => {
    if (!sessions.has(sessionId)) return; // تم حذفها

    const alive = await checkServerAlive(session.host, session.port);
    if (!alive) {
      // الخادم مات - لا تعيد المحاولة
      cleanupSession(sessionId, 'server-offline');
      return;
    }

    createBotSession(sessionId, session);
  }, delay);
}

// ═══════════════ ⭐ إنشاء البوت المحسّن ⭐ ═══════════════
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
      keepAlive: true,           // مهم! إبقاء الاتصال حي
      respawn: true,             // إعادة الظهور تلقائياً عند الموت
      defaultChatPatterns: false // لا ترسل رسائل تلقائية
    });

    session.bot = bot;
    session.state = 'connecting';

    // ═════ أحداث البوت ═════

    bot.on('login', () => {
      session.state = 'connected';
      session.reconnectAttempts = 0;
      log(`✅ ${session.username} connected to ${session.host}`, 'success');
      
      io.emit('bot-status', {
        sessionId, status: 'connected',
        message: `البوت ${session.username} متصل بنجاح!`
      });

      // ⭐ بدء Anti-AFK فوراً بعد الاتصال
      session.antiAfkInterval = startAntiAFK(session);
    });

    bot.on('spawn', () => {
      session.state = 'spawned';
      log(`🎮 ${session.username} spawned`, 'success');
      
      io.emit('bot-status', {
        sessionId, status: 'spawned',
        message: `البوت ${session.username} ظهر في العالم!`
      });

      // ⭐ تأكد من Anti-AFK يعمل
      if (!session.antiAfkInterval) {
        session.antiAfkInterval = startAntiAFK(session);
      }
    });

    // ⭐ مراقبة رسائل الخادم لاكتشاف الطرد
    bot.on('message', (message) => {
      const text = message.toString();
      
      io.emit('bot-chat', {
        sessionId,
        message: text,
        timestamp: new Date().toLocaleTimeString()
      });

      // ⭐ اكتشاف رسائل الطرد
      const kickKeywords = [
        'kicked', 'banned', 'You are AFK', 'idle', 'timeout',
        'moved too quickly', 'flying is not enabled', 'You died'
      ];
      
      const lowerText = text.toLowerCase();
      if (kickKeywords.some(kw => lowerText.includes(kw))) {
        log(`⚠️ Kick detected: ${text}`, 'warn');
      }
    });

    bot.on('health', () => {
      // ⭐ إذا كانت الصحة منخفضة، تحرك للب
