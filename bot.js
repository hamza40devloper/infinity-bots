const mineflayer = require('mineflayer');
const { SocksClient } = require('socks');
const axios = require('axios');

const botsStatus = {};
const activeBots = {}; 
const broadcastIntervals = {}; 
const afkIntervals = {}; // لتخزين موقتات الحركة التلقائية

// دالة إرسال تنبيهات ديسكورد
function sendDiscordAlert(webhookUrl, username, status, reason = "") {
    if (!webhookUrl) return; // تجاهل إذا لم يضع المستخدم رابط الويب هوك

    const color = status === '🟢 متصل (Online)' ? 65280 : 16711680; // أخضر للاتصال، أحمر للفصل
    const embed = {
        title: `🤖 تحديث حالة العميل: ${username}`,
        color: color,
        fields: [{ name: "الحالة", value: status, inline: true }],
        timestamp: new Date().toISOString()
    };

    if (reason) embed.fields.push({ name: "السبب / التفاصيل", value: reason, inline: false });

    axios.post(webhookUrl, { embeds: [embed] }).catch(() => {
        console.log(`[!] فشل إرسال تنبيه الديسكورد للبوت ${username}`);
    });
}

function createBot(options, retries = 0) {
    if (activeBots[options.username] && botsStatus[options.username].status === '🟢 متصل (Online)') {
        return;
    }

    const maxRetries = 5;
    botsStatus[options.username] = { 
        status: '⏳ جاري الاتصال...', 
        reason: options.proxy ? 'عبر البروكسي' : 'اتصال مباشر',
        coords: { x: 0, y: 0, z: 0 },
        chatLogs: [] 
    };

    let botConfig = {
        host: options.ip,
        port: parseInt(options.port) || 25565,
        username: options.username,
        version: options.version || false,
        hideErrors: true
    };

    // 🌐 [1] تفعيل نظام الوكلاء (Proxies) إذا تم توفيرها
    if (options.proxy) {
        const proxyParts = options.proxy.split(':');
        if (proxyParts.length === 2) {
            botConfig.connect = client => {
                SocksClient.createConnection({
                    proxy: { host: proxyParts[0], port: parseInt(proxyParts[1]), type: 5 },
                    command: 'connect',
                    destination: { host: options.ip, port: botConfig.port }
                }, (err, info) => {
                    if (err) {
                        botsStatus[options.username].status = '❌ خطأ في البروكسي';
                        botsStatus[options.username].reason = err.message;
                        return;
                    }
                    client.setSocket(info.socket);
                    client.emit('connect');
                });
            };
        }
    }

    const bot = mineflayer.createBot(botConfig);
    activeBots[options.username] = bot;

    bot.on('spawn', () => {
        console.log(`[+] البوت ${options.username} دخل السيرفر.`);
        botsStatus[options.username].status = '🟢 متصل (Online)';
        botsStatus[options.username].reason = 'يعمل بشكل سليم';
        retries = 0;

        sendDiscordAlert(options.discordWebhook, options.username, '🟢 متصل (Online)', `تم الدخول بنجاح إلى السيرفر ${options.ip}`);

        if (options.authCommand) {
            setTimeout(() => bot.chat(options.authCommand), 2000);
        }

        if (options.broadcastMessage && options.broadcastInterval) {
            if (broadcastIntervals[options.username]) clearInterval(broadcastIntervals[options.username]);
            const intervalMs = parseInt(options.broadcastInterval) * 1000;
            broadcastIntervals[options.username] = setInterval(() => {
                if (activeBots[options.username]) bot.chat(options.broadcastMessage);
            }, intervalMs);
        }

        // 🛡️ [2] تفعيل نظام Anti-AFK الآمن (الالتفاف والقفز كل 30 ثانية)
        if (afkIntervals[options.username]) clearInterval(afkIntervals[options.username]);
        afkIntervals[options.username] = setInterval(() => {
            if (activeBots[options.username]) {
                const yaw = Math.random() * Math.PI * 2;
                const pitch = (Math.random() * Math.PI) - (Math.PI / 2);
                bot.look(yaw, pitch, true);
                bot.setControlState('jump', true);
                setTimeout(() => bot.setControlState('jump', false), 500);
            }
        }, 30000);
    });

    bot.on('move', () => {
        if (bot.entity && bot.entity.position) {
            botsStatus[options.username].coords = {
                x: Math.round(bot.entity.position.x),
                y: Math.round(bot.entity.position.y),
                z: Math.round(bot.entity.position.z)
            };
        }
    });

    bot.on('message', (jsonMsg) => {
        const plainText = jsonMsg.toString().trim();
        if (plainText) {
            const logs = botsStatus[options.username].chatLogs;
            logs.push(plainText);
            if (logs.length > 15) logs.shift();
        }
    });

    function cleanUpBot(username) {
        delete activeBots[username];
        if (broadcastIntervals[username]) clearInterval(broadcastIntervals[username]);
        if (afkIntervals[username]) clearInterval(afkIntervals[username]);
    }

    bot.on('kicked', (reason) => {
        let kickReason = typeof reason === 'object' ? JSON.stringify(reason) : String(reason);
        botsStatus[options.username].status = '🔴 تم الطرد (Kicked)';
        botsStatus[options.username].reason = kickReason;
        sendDiscordAlert(options.discordWebhook, options.username, '🔴 تم الطرد', kickReason);
        cleanUpBot(options.username);
    });

    bot.on('end', (reason) => {
        let endReason = String(reason);
        cleanUpBot(options.username);
        
        if (botsStatus[options.username].status !== '🔴 تم الطرد (Kicked)') {
            botsStatus[options.username].status = '⚫ غير متصل (Offline)';
            botsStatus[options.username].reason = endReason;
            sendDiscordAlert(options.discordWebhook, options.username, '⚫ غير متصل', endReason);

            // إعادة الاتصال التلقائي
            if (retries < maxRetries) {
                const delay = 15000 + (retries * 5000);
                setTimeout(() => createBot(options, retries + 1), delay);
            } else {
                botsStatus[options.username].status = '❌ تم الإيقاف';
                botsStatus[options.username].reason = 'تم تجاوز حد المحاولات';
            }
        }
    });

    bot.on('error', (err) => {
        botsStatus[options.username].status = '❌ خطأ برمجي';
        botsStatus[options.username].reason = err.message;
        cleanUpBot(options.username);
    });

    return bot;
}

module.exports = { createBot, botsStatus, activeBots };
