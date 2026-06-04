const mineflayer = require('mineflayer');

// كائنات تخزين البيانات الحية في ذاكرة السيرفر
const botsStatus = {};
const activeBots = {}; 
const broadcastIntervals = {}; 

/**
 * دالة إنشاء وتشغيل البوت بـ ماين كرافت مع معالجة ذكية للأخطاء والبروكسي
 */
function createBot(options, retries = 0) {
    const maxRetries = 5;
    const username = options.username;

    if (activeBots[username] && botsStatus[username].status === '🟢 متصل (Online)') {
        console.log(`[!] البوت ${username} متصل بالفعل.`);
        return;
    }

    // تهيئة هيكل الحالة الحية في الذاكرة لمنع أخطاء القراءة من الواجهة
    botsStatus[username] = { 
        status: '⏳ جاري الاتصال...', 
        reason: 'يتم الآن فتح سوكيت الاتصال بسيرفر ماين كرافت',
        coords: { x: 0, y: 0, z: 0 },
        chatLogs: [] 
    };

    // 🔧 إصلاح خطأ الإصدار: إذا كانت القيمة المرسلة false كـ string أو غير موجودة، نجعلها false كـ Boolean لتفعيل الكشف التلقائي
    let parsedVersion = options.version;
    if (parsedVersion === 'false' || !parsedVersion) {
        parsedVersion = false; 
    }

    // إعدادات إنشاء البوت الأساسية
    const botOptions = {
        host: options.ip,
        port: parseInt(options.port) || 25565,
        username: username,
        version: parsedVersion
    };

    // دمج إعدادات البروكسي (Proxy) إذا تم تمريرها بشكل صحيح من واجهة بلوجر
    if (options.proxy && options.proxy.trim() !== "") {
        const proxyParts = options.proxy.split(':');
        if (proxyParts.length === 2) {
            botOptions.proxy = {
                host: proxyParts[0].trim(),
                port: parseInt(proxyParts[1])
            };
            console.log(`[Proxy] تفعيل نفق SOCKS5 للبوت ${username} عبر: ${options.proxy}`);
        }
    }

    console.log(`[~] جاري محاولة حقن البوت ${username} في الإصدار: ${parsedVersion || 'Auto-Detect'}`);

    let bot;
    try {
        bot = mineflayer.createBot(botOptions);
        activeBots[username] = bot;
    } catch (initError) {
        console.error(`[-] فشل كلي أثناء تهيئة كائن Mineflayer:`, initError.message);
        botsStatus[username].status = '❌ خطأ في التهيئة';
        botsStatus[username].reason = initError.message;
        return;
    }

    // حدث الدخول الناجح وعمل الـ Spawn داخل العالم
    bot.on('spawn', () => {
        console.log(`[+] البوت ${username} استقر داخل العالم بنجاح.`);
        botsStatus[username].status = '🟢 متصل (Online)';
        botsStatus[username].reason = 'يعمل بكفاءة عالية داخل السيرفر';
        retries = 0; // تصفير العداد عند نجاح الاتصال

        // تنفيذ أمر التسجيل التلقائي AuthCommand
        if (options.authCommand && options.authCommand.trim() !== "") {
            setTimeout(() => {
                bot.chat(options.authCommand);
                console.log(`[Auth] تم إرسال أمر الدخول للبوت ${username}`);
            }, 2000);
        }

        // إعداد البث الدوري للإعلانات والرسائل التلقائية (Anti-AFK Broadcast)
        if (options.broadcastMessage && options.broadcastMessage.trim() !== "") {
            if (broadcastIntervals[username]) clearInterval(broadcastIntervals[username]);
            
            const intervalTime = (parseInt(options.broadcastInterval) || 30) * 1000;
            broadcastIntervals[username] = setInterval(() => {
                if (activeBots[username]) {
                    bot.chat(options.broadcastMessage);
                }
            }, intervalTime);
        }
    });

    // تحديث الإحداثيات الحية للبوت وإرسالها للواجهة فور تحركه
    bot.on('move', () => {
        if (bot.entity && bot.entity.position) {
            botsStatus[username].coords = {
                x: Math.round(bot.entity.position.x),
                y: Math.round(bot.entity.position.y),
                z: Math.round(bot.entity.position.z)
            };
        }
    });

    // استقبال الشات الحي وحفظ السجلات لعرضها في الـ Matrix Logs ببلوجر
    bot.on('chat', (usernameFromChat, message) => {
        const cleanMsg = `<${usernameFromChat}> ${message}`;
        if (botsStatus[username].chatLogs.length > 50) {
            botsStatus[username].chatLogs.shift(); // حذف السجلات القديمة لتوفير الذاكرة
        }
        botsStatus[username].chatLogs.push(cleanMsg);
    });

    // تنظيف الذاكرة عند انتهاء الجلسة أو الطرد
    function cleanUpBot(bName) {
        if (activeBots[bName]) delete activeBots[bName];
        if (broadcastIntervals[bName]) {
            clearInterval(broadcastIntervals[bName]);
            delete broadcastIntervals[bName];
        }
    }

    // التعامل الآمن مع الطرد من السيرفر (Kicked)
    bot.on('kicked', (reason) => {
        let kickReason = typeof reason === 'object' ? JSON.stringify(reason) : String(reason);
        console.log(`[-] البوت ${username} تم طرده. السبب: ${kickReason}`);
        botsStatus[username].status = '🔴 تم الطرد (Kicked)';
        botsStatus[username].reason = kickReason;
        cleanUpBot(username);
    });

    // التعامل مع انتهاء الاتصال وإعادة المحاولة الذكية (Reconnection Loop)
    bot.on('end', (reason) => {
        let endReason = String(reason);
        console.log(`[!] انتهى اتصال البوت ${username}. السبب الحالي: ${endReason}`);
        cleanUpBot(username);
        
        if (botsStatus[username].status !== '🔴 تم الطرد (Kicked)') {
            botsStatus[username].status = '⚫ غير متصل (Offline)';
            botsStatus[username].reason = `تم فصل الاتصال (${endReason}). جاري إعادة المحاولة...`;

            if (retries < maxRetries) {
                const delay = 10000 + (retries * 5000); // وقت انتظار ديناميكي يتصاعد تدريجياً
                setTimeout(() => createBot(options, retries + 1), delay);
            } else {
                botsStatus[username].status = '❌ فشل الاتصال النهائي';
                botsStatus[username].reason = 'تم استنفاد جميع محاولات الاتصال بالسيرفر، تأكد من الـ IP';
            }
        }
    });

    // 🛡️ صمام الأمان الأهم: منع انهيار السيرفر الخلفي بالكامل عند حدوث أخطاء شبكية عشوائية
    bot.on('error', (err) => {
        console.error(`[Mineflayer Error - ${username}]:`, err.message);
        botsStatus[username].status = '❌ خطأ في الاتصال';
        botsStatus[username].reason = `خطأ شبكي داخلي: ${err.message}`;
        cleanUpBot(username);
    });
}

module.exports = { createBot, botsStatus, activeBots };
