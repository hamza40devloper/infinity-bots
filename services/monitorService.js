// services/monitorService.js
const mineflayer = require('mineflayer');
const { logger } = require('../utils/logger');

class MonitorService {
  constructor() {
    this.monitoringInterval = null;
    this.sessions = new Map();
    this.checkInterval = 60000; // 60 ثانية
  }

  startMonitoring() {
    this.monitoringInterval = setInterval(async () => {
      await this.checkAllSessions();
    }, this.checkInterval);
    
    logger.info('✅ بدأت مراقبة الجلسات');
  }

  async checkAllSessions() {
    logger.info(`🔄 فحص ${this.sessions.size} جلسة نشطة`);
    
    for (const [sessionId, session] of this.sessions) {
      try {
        const isAlive = await this.checkServerAlive(session.host, session.port);
        
        if (!isAlive) {
          logger.warn(`⚠️ الخادم ${session.host}:${session.port} غير متصل`);
          await this.cleanupSession(sessionId);
        } else {
          await this.updateSessionStats(sessionId, session);
        }
      } catch (error) {
        logger.error(`خطأ في فحص الجلسة ${sessionId}:`, error);
        await this.cleanupSession(sessionId);
      }
    }
  }

  async checkServerAlive(host, port) {
    return new Promise((resolve) => {
      const bot = mineflayer.createBot({
        host: host,
        port: port,
        username: 'health-checker',
        version: false, // اكتشاف تلقائي للإصدار
        timeout: 5000 // 5 ثواني مهلة
      });

      bot.on('login', () => {
        bot.end();
        resolve(true);
      });

      bot.on('error', () => {
        resolve(false);
      });

      // إضافة مهلة إضافية
      setTimeout(() => {
        bot.end();
        resolve(false);
      }, 5000);
    });
  }

  async cleanupSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      // إيقاف البوت بشكل صحيح
      if (session.bot) {
        await session.bot.end();
      }
      
      // حذف الجلسة من الذاكرة
      this.sessions.delete(sessionId);
      
      logger.info(`🗑️ تم حذف الجلسة ${sessionId} تلقائياً`);
      
      // إشعار الواجهة بالتحديث
      this.notifyFrontend('session-cleaned', { sessionId });
      
    } catch (error) {
      logger.error(`خطأ في تنظيف الجلسة ${sessionId}:`, error);
    }
  }

  async updateSessionStats(sessionId, session) {
    // تحديث الإحصائيات: الصحة، الجوع، الوقت
    const stats = {
      health: session.bot.health,
      food: session.bot.food,
      position: session.bot.entity.position,
      uptime: Date.now() - session.startTime
    };
    
    // إرسال التحديث للواجهة
    this.notifyFrontend('stats-update', { sessionId, stats });
  }
}

module.exports = new MonitorService();
