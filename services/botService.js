// services/botService.js
const mineflayer = require('mineflayer');
const monitorService = require('./monitorService');

class BotService {
  constructor() {
    this.sessions = new Map();
    this.maxSessionsPerUser = 3; // حد أقصى 3 جلسات لكل مستخدم
  }

  async createBot(config) {
    const { host, port, version, username, userId } = config;
    
    // التحقق من حد الجلسات
    const userSessions = Array.from(this.sessions.values())
      .filter(session => session.userId === userId);
    
    if (userSessions.length >= this.maxSessionsPerUser) {
      throw new Error(`وصلت إلى الحد الأقصى (${this.maxSessionsPerUser}) من الجلسات`);
    }

    const bot = mineflayer.createBot({
      host,
      port,
      version,
      username,
      auth: 'offline', // أو 'microsoft' حسب الخادم
      hideErrors: true
    });

    const sessionId = this.generateSessionId();
    const session = {
      id: sessionId,
      bot,
      host,
      port,
      version,
      username,
      userId,
      startTime: Date.now(),
      lastActivity: Date.now()
    };

    // إعداد الأحداث
    this.setupBotEvents(bot, sessionId);
    
    // حفظ الجلسة
    this.sessions.set(sessionId, session);
    monitorService.sessions.set(sessionId, session);
    
    return session;
  }

  setupBotEvents(bot, sessionId) {
    bot.on('login', () => {
      console.log(`✅ البوت ${sessionId} متصل`);
    });

    bot.on('message', (message) => {
      // إرسال الرسائل للواجهة
      monitorService.notifyFrontend('chat', { 
        sessionId, 
        message: message.toString() 
      });
    });

    bot.on('end', () => {
      console.log(`❌ البوت ${sessionId} انقطع`);
      // بدء التنظيف التلقائي عند الانقطاع
      setTimeout(() => {
        monitorService.cleanupSession(sessionId);
      }, 5000);
    });

    bot.on('error', (error) => {
      console.error(`خطأ في البوت ${sessionId}:`, error);
    });
  }

  async stopBot(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      await session.bot.end();
      this.sessions.delete(sessionId);
      monitorService.sessions.delete(sessionId);
    }
  }

  generateSessionId() {
    return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

module.exports = new BotService();
