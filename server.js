const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

const API_KEY = process.env.API_KEY || 'change_this_secret';
const DEFAULT_DURATION_MS = 24 * 60 * 60 * 1000;

const sessions = new Map();

function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.post('/api/spawn', requireApiKey, (req, res) => {
  const { host, port = 25565, version, username, auth = 'offline', durationMs } = req.body;
  if (!host) return res.status(400).json({ error: 'host required' });

  const sessionId = uuidv4();
  const botUsername = username || `bot_${sessionId.slice(0, 5)}`;
  const dur = typeof durationMs === 'number' ? durationMs : DEFAULT_DURATION_MS;

  try {
    const botOptions = {
      host,
      port: Number(port),
      username: botUsername,
      auth,
      checkTimeoutInterval: 60 * 1000
    };
    if (version) botOptions.version = version;

    const bot = mineflayer.createBot(botOptions);
    const nspName = `/session-${sessionId}`;
    const ns = io.of(nspName);

    let afkTimer = null;

    ns.on('connection', (socket) => {
      socket.emit('log', `[system] Connected to session ${sessionId}`);
      socket.on('send', (msg) => {
        if (!bot) return socket.emit('log', '[local] Bot not available');
        if (typeof msg !== 'string') return;
        bot.chat(msg);
        socket.emit('log', `[you] ${msg}`);
      });
    });

    bot.on('login', () => ns.emit('log', `[bot] Logged in as ${bot.username}`));
    
    // حل مشكلة الخروج الفوري: منع الطرد التلقائي (Anti-AFK)
    bot.on('spawn', () => {
      ns.emit('log', '[bot] Spawned in world successfully.');
      afkTimer = setInterval(() => {
        if (bot && bot.entity) {
          bot.setControlState('jump', true);
          setTimeout(() => bot.setControlState('jump', false), 400);
          bot.look(bot.entity.yaw + 0.2, bot.entity.pitch, true);
        }
      }, 15000);
    });

    bot.on('chat', (u, m) => ns.emit('chat', { from: u, text: m }));
    bot.on('message', (jsonMsg) => ns.emit('log', `[msg] ${jsonMsg.toString()}`));
    bot.on('kicked', (reason) => ns.emit('log', `[kicked] ${reason}`));
    bot.on('error', (err) => ns.emit('log', `[error] ${err.message || String(err)}`));
    
    bot.on('end', () => {
      if (afkTimer) clearInterval(afkTimer);
      ns.emit('log', '[end] Connection closed');
    });

    const timeout = setTimeout(() => {
      try { bot.end(); } catch (e) {}
      ns.emit('log', `[system] Session auto-stopped after duration.`);
      sessions.delete(sessionId);
    }, dur);

    sessions.set(sessionId, { bot, timeout, afkTimer, info: { host, port, version, username: botUsername } });

    return res.json({ sessionId, host, port, username: botUsername });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Spawn failed' });
  }
});

app.post('/api/stop/:sessionId', requireApiKey, (req, res) => {
  const { sessionId } = req.params;
  const s = sessions.get(sessionId);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  
  if (s.afkTimer) clearInterval(s.afkTimer);
  clearTimeout(s.timeout);
  try { s.bot.end(); } catch (e) {}
  sessions.delete(sessionId);
  
  return res.json({ stopped: true });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
