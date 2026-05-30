// WebSocket server for real-time room state, chat, reactions, presence
// and WebRTC voice-chat signalling. Layered on top of the existing HTTP
// server so we keep one port and one process.

const { WebSocketServer } = require('ws');
const storage = require('./data/storage');

const clients = new Set();           // all live clients
const byPlayer = new Map();          // playerId -> Set<ws>
const byRoom = new Map();            // roomCode -> Set<ws>

function send(ws, payload) {
  try {
    if (ws.readyState === 1) ws.send(JSON.stringify(payload));
  } catch (_) {}
}

function broadcast(set, payload) {
  if (!set) return;
  for (const ws of set) send(ws, payload);
}

function addToRoom(ws, code) {
  if (!code) return;
  ws.roomCode = code;
  if (!byRoom.has(code)) byRoom.set(code, new Set());
  byRoom.get(code).add(ws);
}

function removeFromRoom(ws) {
  const code = ws.roomCode;
  if (!code) return;
  const set = byRoom.get(code);
  if (set) {
    set.delete(ws);
    if (set.size === 0) byRoom.delete(code);
  }
  // Notify peers in voice channel that this player left
  if (ws.playerId) {
    broadcastToRoom(code, {
      type: 'voice:peer-left',
      playerId: ws.playerId
    }, ws);
  }
  ws.roomCode = null;
}

function broadcastToRoom(code, payload, exclude) {
  const set = byRoom.get(code);
  if (!set) return;
  for (const ws of set) {
    if (ws === exclude) continue;
    send(ws, payload);
  }
}

function broadcastRoom(code, room) {
  broadcastToRoom(code, { type: 'room:update', room });
}

function broadcastChat(code, message) {
  broadcastToRoom(code, { type: 'chat:message', message });
}

function broadcastReaction(code, payload) {
  broadcastToRoom(code, { type: 'chat:reaction', ...payload });
}

function isPlayerOnline(playerId) {
  const set = byPlayer.get(Number(playerId));
  return Boolean(set && set.size > 0);
}

function getOnlineUserIds() {
  return Array.from(byPlayer.keys());
}

function notifyPresence(playerId, online) {
  const id = Number(playerId);
  if (!id) return;
  storage.updateUser(id, (u) => { u.lastSeen = Date.now(); });
  // Notify everyone (friends will filter client-side)
  const payload = { type: 'presence', playerId: id, online };
  for (const ws of clients) {
    if (ws.playerId === id) continue;
    send(ws, payload);
  }
}

function setupWebSocket(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws, req) => {
    clients.add(ws);
    ws.isAlive = true;
    ws.playerId = null;
    ws.roomCode = null;

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
      if (!msg || typeof msg !== 'object') return;
      handleMessage(ws, msg);
    });

    ws.on('close', () => {
      if (ws.playerId) {
        const set = byPlayer.get(ws.playerId);
        if (set) {
          set.delete(ws);
          if (set.size === 0) {
            byPlayer.delete(ws.playerId);
            notifyPresence(ws.playerId, false);
          }
        }
      }
      removeFromRoom(ws);
      clients.delete(ws);
    });

    send(ws, { type: 'hello' });
  });

  // Heartbeat — drop dead sockets every 30s
  const heartbeat = setInterval(() => {
    for (const ws of clients) {
      if (!ws.isAlive) { try { ws.terminate(); } catch (_) {} clients.delete(ws); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch (_) {}
    }
  }, 30000);

  wss.on('close', () => clearInterval(heartbeat));

  return wss;
}

function handleMessage(ws, msg) {
  switch (msg.type) {
    case 'identify': {
      const id = Number(msg.playerId);
      if (!id) return;
      const name = String(msg.name || '').slice(0, 30);
      const username = msg.username ? String(msg.username).slice(0, 32) : null;
      ws.playerId = id;
      if (!byPlayer.has(id)) byPlayer.set(id, new Set());
      const wasOnline = byPlayer.get(id).size > 0;
      byPlayer.get(id).add(ws);
      storage.upsertUser(id, { name: name || `Игрок ${id}`, username });
      if (!wasOnline) notifyPresence(id, true);
      // Send the current set of online friends right away
      const u = storage.getOrCreateUser(id);
      const onlineFriends = (u.friends || []).filter((fid) => isPlayerOnline(fid));
      send(ws, { type: 'presence:initial', onlineFriends, you: storage.publicProfile(u) });
      return;
    }
    case 'room:join': {
      const code = String(msg.code || '').toUpperCase();
      if (!code) return;
      removeFromRoom(ws);
      addToRoom(ws, code);
      // Tell other room peers that a new voice peer is here
      if (ws.playerId) {
        broadcastToRoom(code, { type: 'voice:peer-joined', playerId: ws.playerId }, ws);
      }
      return;
    }
    case 'room:leave': {
      removeFromRoom(ws);
      return;
    }
    case 'chat:typing': {
      if (!ws.roomCode) return;
      broadcastToRoom(ws.roomCode, { type: 'chat:typing', playerId: ws.playerId, name: msg.name }, ws);
      return;
    }
    // WebRTC voice-chat signalling.
    // Clients send `voice:signal` with `to` (target playerId) and `payload`
    // containing { sdp } for offers/answers or { ice } for ICE candidates.
    case 'voice:signal': {
      const to = Number(msg.to);
      if (!to) return;
      const targets = byPlayer.get(to);
      if (!targets) return;
      for (const target of targets) {
        if (!ws.roomCode || target.roomCode !== ws.roomCode) continue;
        send(target, {
          type: 'voice:signal',
          from: ws.playerId,
          payload: msg.payload || {}
        });
      }
      return;
    }
    case 'voice:join': {
      // Player wants to participate in voice. Notify everyone else in room.
      if (!ws.roomCode || !ws.playerId) return;
      ws.voiceOn = true;
      broadcastToRoom(ws.roomCode, {
        type: 'voice:peer-ready',
        playerId: ws.playerId
      }, ws);
      // Also send back the list of currently-active voice peers
      const peers = [];
      const set = byRoom.get(ws.roomCode) || new Set();
      for (const peer of set) {
        if (peer === ws || !peer.playerId || !peer.voiceOn) continue;
        peers.push(peer.playerId);
      }
      send(ws, { type: 'voice:peers', peers });
      return;
    }
    case 'voice:leave': {
      ws.voiceOn = false;
      if (!ws.roomCode || !ws.playerId) return;
      broadcastToRoom(ws.roomCode, {
        type: 'voice:peer-left',
        playerId: ws.playerId
      }, ws);
      return;
    }
    case 'voice:speaking': {
      if (!ws.roomCode || !ws.playerId) return;
      broadcastToRoom(ws.roomCode, {
        type: 'voice:speaking',
        playerId: ws.playerId,
        speaking: Boolean(msg.speaking)
      }, ws);
      return;
    }
    case 'voice:mute': {
      if (!ws.roomCode || !ws.playerId) return;
      broadcastToRoom(ws.roomCode, {
        type: 'voice:mute',
        playerId: ws.playerId,
        muted: Boolean(msg.muted)
      }, ws);
      return;
    }
    case 'ping':
      send(ws, { type: 'pong', ts: Date.now() });
      return;
    default:
      return;
  }
}

// Notify a specific player (e.g. when they receive a friend invite).
function notifyUser(playerId, payload) {
  const set = byPlayer.get(Number(playerId));
  if (!set) return false;
  broadcast(set, payload);
  return true;
}

module.exports = {
  setupWebSocket,
  broadcastRoom,
  broadcastChat,
  broadcastReaction,
  broadcastToRoom,
  notifyUser,
  isPlayerOnline,
  getOnlineUserIds
};
