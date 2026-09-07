// server.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const botService = require('./services/botService');
const monitorService = require('./services/monitorService');
const { logger } = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

// الأمان
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(',') || '*',
  credentials: true
}));

// حدود معدل الطلب
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: 100 // حد أقصى 100 طلب لكل IP
});
app.use(limiter);

app.use(express.json());

// بدء المراقبة
monitorService.startMonitoring();

// Routes
app.post('/api/spawn', async (req, res) => {
  try {
    const { host, port, version, username, userId } = req.body;
    
    if (!host || !port || !version) {
      return res.status(400).json({ error: 'بيانات ناقصة' });
    }

    const session = await botService.createBot({
      host,
      port,
      version,
      username: username || `Bot_${Math.random().toString(36).substr(2, 6)}`,
      userId: userId || 'anonymous'
    });

    res.json({
      sessionId: session.id,
      message: 'تم إنشاء البوت بنجاح',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 ساعة
    });

  } catch (error) {
    logger.error('خطأ في إنشاء البوت:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/stop/:sessionId', async (req, res) => {
  try {
    await botService.stopBot(req.params.sessionId);
    res.json({ message: 'تم إيقاف البوت بنجاح' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/sessions', (req, res) => {
  const sessions = Array.from(botService.sessions.values()).map(session => ({
    id: session.id,
    host: session.host,
    port: session.port,
    version: session.version,
    username: session.username,
    startTime: session.startTime,
    uptime: Date.now() - session.startTime
  }));
  
  res.json(sessions);
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    sessions: botService.sessions.size,
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// WebSocket للإحصائيات المباشرة
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: {
    origin: process.env.CORS_ORIGINS?.split(',') || '*',
    methods: ["GET", "POST"]
  }
});

monitorService.notifyFrontend = (event, data) => {
  io.emit(event, data);
};

io.on('connection', (socket) => {
  logger.info('🔌 عميل متصل عبر WebSocket');
  
  socket.on('disconnect', () => {
    logger.info('🔌 عميل مفصول');
  });
});

http.listen(PORT, () => {
  logger.info(`🚀 الخادم يعمل على المنفذ ${PORT}`);
  logger.info(`📊 لوحة التحكم: http://localhost:${PORT}`);
});
