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

// مسار تشغيل البوت (محمي)
app.post('/api/start-bot', validateApiKey, (req, res) => {
    const { ip, port, username, version, authCommand, broadcastMessage, broadcastInterval, proxy, discordWebhook } = req.body;

    if (!ip || !username) {
        return res.status(400).json({ error: 'الرجاء توفير IP واسم البوت.' });
    }

    if (activeBots && activeBots[username]) {
        return res.status(400).json({ error: `البوت ${username} قيد التشغيل بالفعل!` });
    }

    try {
        // تمرير الإعدادات الجديدة للدالة
        createBot({ ip, port, username, version, authCommand, broadcastMessage, broadcastInterval, proxy, discordWebhook });
        res.status(200).json({ message: `تم إرسال أمر التشغيل للبوت ${username}` });
    } catch (error) {
        res.status(500).json({ error: 'حدث خطأ داخلي في الخادم.' });
    }
});

// 🛑 مسار إيقاف البوت يدوياً من الواجهة (محمي)
app.post('/api/stop-bot', validateApiKey, (req, res) => {
    const { username } = req.body;
    if (activeBots && activeBots[username]) {
        activeBots[username].quit(); // فصل البوت فوراً
        delete activeBots[username];
        if(botsStatus[username]) {
            botsStatus[username].status = '⚫ غير متصل (Offline)';
            botsStatus[username].reason = 'تم إيقافه يدوياً من لوحة التحكم';
    
        }
        return res.status(200).json({ message: `تم إيقاف البوت ${username} بنجاح.` });
    }
    res.status(404).json({ error: 'البوت غير نشط أو تم إيقافه بالفعل.' });
});

// مسار جلب الحالة الحية والشات والإحداثيات (عام للواجهة)
app.get('/api/status/:username', (req, res) => {
    const username = req.params.username;
    const status = botsStatus[username] || { status: 'مجهول', reason: 'البوت لم يبدأ بعد', coords: {x:0,y:0,z:0}, chatLogs: [] };
    res.json(status); // تم تصحيح الخطأ المطبعي هنا
});

// مسار جديد لجلب قائمة بكل البوتات النشطة حالياً في الخادم
app.get('/api/active-bots', (req, res) => {
    res.status(200).json(Object.keys(botsStatus));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[+] السيرفر يعمل بامتياز على المنفذ ${PORT}`);
});
