// server.js
// Minimal Node backend for MC keepalive bots using mineflayer + socket.io
// Requires: set environment variable API_KEY before start (or edit default below)

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(bodyParser.json());

const API_KEY = process.env.API_KEY || 'change_this_secret';
const DEFAULT_DURATION_MS = 24 * 60 * 60 * 1000; // 24 ساعة

// sessions map: sessionId -> { bot, timeout, info, ns }
const sessions = new Map();

function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.post('/api/spawn', requireApiKey, (req, res) => {
  const { host, port = 25565, version = '1.20.4', username = null, durationMs } = req.body;
  if (!host) return res.status(400).json({ error: 'host required' });

  const sessionId = uuidv4();
  const botUsername = username || `bot-${sessionId.slice(0,6)}`;
  const dur = (typeof durationMs === 'number') ? durationMs : DEFAULT_DURATION_MS;

  try {
    const bot = mineflayer.createBot({
      host,
      port,
      username: botUsername,
      version
    });

    const nspName = `/session-${sessionId}`;
    const ns = io.of(nspName);

    ns.on('connection', (socket) => {
      console.log('Console client connected for session', sessionId);
      socket.emit('log', `[system] connected to session ${sessionId}`);
      socket.on('send', (msg) => {
        if (!bot) {
          socket.emit('log', '[local] bot not available');
          return;
        }
        if (typeof msg !== 'string') return;
        // send as chat (server will treat /command as command if starts with '/')
        bot.chat(msg);
        socket.emit('log', `[you] ${msg}`);
      });
    });

    // Relay bot events to namespace
    bot.on('login', () => ns.emit('log', `[bot] logged in as ${bot.username}`));
    bot.on('chat', (username, message) => ns.emit('chat', { from: username, text: message }));
    bot.on('message', (jsonMsg) => ns.emit('log', `[msg] ${jsonMsg.toString()}`));
    bot.on('kicked', (reason) => ns.emit('log', `[kicked] ${reason ? reason.toString() : reason}`));
    bot.on('error', (err) => ns.emit('log', `[error] ${err.message || String(err)}`));
    bot.on('end', () => ns.emit('log', `[end] connection closed`));

    // schedule auto-stop
    const to = setTimeout(() => {
      try { bot.end(); } catch(e){}
      ns.emit('log', `[system] session auto-stopped after ${dur}ms`);
      // cleanup after short delay
      setTimeout(() => {
        deleteNamespace(nspName);
      }, 1000);
      sessions.delete(sessionId);
    }, dur);

    sessions.set(sessionId, { bot, timeout: to, info: { host, port, version, username: botUsername }, nsName: nspName });
    console.log('Spawned session', sessionId, '->', host, port, version);

    return res.json({ sessionId, host, port, version, username: botUsername });
  } catch (err) {
    console.error('spawn error', err);
    return res.status(500).json({ error: err.message || 'spawn failed' });
  }
});

app.post('/api/stop/:sessionId', requireApiKey, (req, res) => {
  const { sessionId } = req.params;
  const s = sessions.get(sessionId);
  if (!s) return res.status(404).json({ error: 'session not found' });
  try {
    clearTimeout(s.timeout);
    s.bot.end();
    deleteNamespace(s.nsName);
    sessions.delete(sessionId);
    return res.json({ stopped: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'stop failed' });
  }
});

app.get('/api/sessions', requireApiKey, (req, res) => {
  const all = [];
  for (const [id, val] of sessions.entries()) {
    all.push({ id, info: val.info });
  }
  res.json(all);
});

function deleteNamespace(nsp) {
  try {
    const ns = io.of(nsp);
    // disconnect sockets
    for (const [id, socket] of ns.sockets) {
      socket.disconnect(true);
    }
    // remove namespace from server (internal API — may vary across socket.io versions)
    if (io._nsps && io._nsps.has(nsp)) {
      io._nsps.delete(nsp);
    }
  } catch (e) {
    // ignore cleanup errors
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Bot service listening on ${PORT}`));
