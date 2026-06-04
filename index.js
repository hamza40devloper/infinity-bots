const express = require('express');
const cors = require('cors');
const { createBot, botsStatus, activeBots } = require('./bot.js');

const app = express();
app.use(cors());
app.use(express.json());

// 🔐 برمجية وسيطة (Middleware) لحماية الـ API بمفتاح سري
const validateApiKey = (req, res, next) => {
    const userApiKey = req.headers['x-api-key'];
    // المفتاح الافتراضي إذا لم تقم بتعيينه في بيئة Railway هو 'MySuperSecretKey123'
    const secureKey = process.env.API_SECRET_KEY || 'MySuperSecretKey123'; 
    
    if (!userApiKey || userApiKey !== secureKey) {
        return res.status(401).json({ error: 'غير مصرح لك! مفتاح الـ API غير صحيح.' });
    }
    next();
};

// ⚡ مسار تشغيل البوت (محمي ومعدل لمنع الانهيار الداخلي)
app.post('/api/start-bot', validateApiKey, (req, res) => {
    const { ip, port, username, version, authCommand, broadcastMessage, broadcastInterval, proxy, discordWebhook } = req.body;

    if (!ip || !username) {
        return res.status(400).json({ error: 'الرجاء توفير IP واسم البوت.' });
    }

    if (activeBots && activeBots[username]) {
        return res.status(400).json({ error: `البوت ${username} قيد التشغيل بالفعل!` });
    }

    try {
        // تشغيل البوت وتمرير كافة الخصائص المتقدمة بما فيها البروكسي والويب هوك
        createBot({ 
            ip, 
            port: parseInt(port) || 25565, 
            username, 
            version, 
            authCommand, 
            broadcastMessage, 
            broadcastInterval, 
            proxy, 
            discordWebhook 
        });

        // إرجاع استجابة ناجحة فوراً للواجهة لمنع تعليق الطلب (Timeout)
        res.status(200).json({ message: `تم إرسال أمر التشغيل للبوت ${username} بنجاح وجاري الاتصال...` });
    } catch (error) {
        console.error('[SERVER ERROR]:', error);
        res.status(500).json({ error: `حدث خطأ داخلي في الخادم أثناء تهيئة Mineflayer: ${error.message}` });
    }
});

// 🛑 مسار إيقاف البوت يدوياً من الواجهة (محمي)
app.post('/api/stop-bot', validateApiKey, (req, res) => {
    const { username } = req.body;
    if (activeBots && activeBots[username]) {
        try {
            activeBots[username].quit(); // فصل البوت فوراً
        } catch (e) {
            console.log(`[!] خطأ أثناء محاولة إغلاق سوكيت البوت: ${e.message}`);
        }
        
        delete activeBots[username];
        if (botsStatus[username]) {
            botsStatus[username].status = '⚫ غير متصل (Offline)';
            botsStatus[username].reason = 'تم إيقافه يدوياً من لوحة التحكم';
        }
        return res.status(200).json({ message: `تم إيقاف البوت ${username} بنجاح.` });
    }
    res.status(404).json({ error: 'البوت غير نشط أو تم إيقافه بالفعل.' });
});

// 📊 مسار جلب الحالة الحية والشات والإحداثيات (عام للواجهة)
app.get('/api/status/:username', (req, res) => {
    const username = req.params.username;
    const status = botsStatus[username] || { 
        status: 'مجهول', 
        reason: 'البوت لم يبدأ بعد أو تم حذفه من الذاكرة', 
        coords: { x: 0, y: 0, z: 0 }, 
        chatLogs: [] 
    };
    res.status(200).json(status);
});

// تشغيل السيرفر على المنفذ المحدد بواسطة Railway أو المنفذ المحلي 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[+] Server is running perfectly on port ${PORT}`);
});
