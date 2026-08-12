const express = require('express');
const path = require('path');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const ANALYTICS_FILE = path.join(DATA_DIR, 'analytics.json');
const MAX_SIGNAL_BYTES = 512 * 1024;

fs.mkdirSync(DATA_DIR, { recursive: true });

function safeReadEvents() {
  try {
    if (!fs.existsSync(ANALYTICS_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(ANALYTICS_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Could not read analytics:', error.message);
    return [];
  }
}

function writeEvents(events) {
  const tmp = `${ANALYTICS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(events, null, 2));
  fs.renameSync(tmp, ANALYTICS_FILE);
}

function sanitizeEvent(input = {}) {
  const type = input.type;
  if (!['transfer', 'gesture'].includes(type)) return null;
  if (type === 'gesture') {
    return {
      type,
      gesture: String(input.gesture || '').slice(0, 40),
      confidence: Math.max(0, Math.min(1, Number(input.confidence) || 0)),
      role: input.role === 'receiver' ? 'receiver' : 'sender',
      action: String(input.action || input.gesture || '').slice(0, 40)
    };
  }
  return {
    type,
    success: Boolean(input.success),
    trigger: input.trigger === 'gesture' ? 'gesture' : 'manual',
    room: String(input.room || '').slice(0, 12),
    fileName: String(input.fileName || '').slice(0, 180),
    fileType: String(input.fileType || 'other').slice(0, 32),
    fileSizeMB: Math.max(0, Math.min(100, Number(input.fileSizeMB) || 0)),
    durationSec: Math.max(0, Number(input.durationSec) || 0),
    speedMbps: Math.max(0, Number(input.speedMbps) || 0),
    acceptanceLatencySec: Math.max(0, Number(input.acceptanceLatencySec) || 0),
    reason: input.reason ? String(input.reason).slice(0, 160) : undefined
  };
}

function appendEvent(event) {
  const events = safeReadEvents();
  const record = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), ...event };
  events.push(record);
  writeEvents(events.slice(-2000));
  return record;
}

function round(value, places = 1) {
  const p = 10 ** places;
  return Math.round((Number(value) || 0) * p) / p;
}

function analyticsSummary(events) {
  const transfers = events.filter((e) => e.type === 'transfer');
  const gestures = events.filter((e) => e.type === 'gesture');
  const successful = transfers.filter((e) => e.success);
  const failed = transfers.filter((e) => !e.success);
  const gestureTriggered = transfers.filter((e) => e.trigger === 'gesture');
  const avg = (arr, field) => arr.length ? arr.reduce((sum, item) => sum + (Number(item[field]) || 0), 0) / arr.length : 0;

  const byType = {};
  for (const t of transfers) {
    const key = t.fileType || 'other';
    if (!byType[key]) byType[key] = { total: 0, success: 0, mb: 0 };
    byType[key].total += 1;
    byType[key].success += t.success ? 1 : 0;
    byType[key].mb += Number(t.fileSizeMB) || 0;
  }

  const recent = transfers.slice(-12).reverse();
  const successRate = transfers.length ? (successful.length / transfers.length) * 100 : 0;
  const gestureUseRate = transfers.length ? (gestureTriggered.length / transfers.length) * 100 : 0;
  const avgGestureConfidence = avg(gestures, 'confidence') * 100;
  const avgSpeedMbps = avg(successful, 'speedMbps');
  const avgDurationSec = avg(successful, 'durationSec');
  const avgAcceptanceLatencySec = avg(successful, 'acceptanceLatencySec');
  const senderGestures = gestures.filter((e) => e.role === 'sender');
  const receiverGestures = gestures.filter((e) => e.role === 'receiver');

  const recommendations = [];
  if (!transfers.length) {
    recommendations.push({ level: 'info', title: 'Collect evidence', text: 'Complete several transfers or load classroom demo data before making an executive decision.' });
  } else {
    if (successRate < 90) recommendations.push({ level: 'risk', title: 'Reliability risk', text: `Success rate is ${round(successRate)}%. Improve transfer reliability before an organizational pilot.` });
    else recommendations.push({ level: 'good', title: 'Pilot-ready reliability', text: `Observed success rate is ${round(successRate)}%. Continue testing across devices, networks, lighting, and file sizes.` });
    if (gestures.length && avgGestureConfidence < 80) recommendations.push({ level: 'risk', title: 'Gesture recognition needs improvement', text: `Average gesture confidence is ${round(avgGestureConfidence)}%. Test lighting, camera position, and recognition thresholds.` });
    if (gestureUseRate < 50) recommendations.push({ level: 'info', title: 'Low gesture adoption', text: `Only ${round(gestureUseRate)}% of transfers were gesture-triggered. Investigate usability before deployment.` });
    if (avgSpeedMbps > 0 && avgSpeedMbps < 5) recommendations.push({ level: 'warn', title: 'Performance constraint', text: `Average successful transfer speed is ${round(avgSpeedMbps)} Mbps. Validate performance on the target network.` });
  }

  return {
    generatedAt: new Date().toISOString(),
    kpis: {
      transfers: transfers.length,
      successRate: round(successRate),
      failedTransfers: failed.length,
      avgSpeedMbps: round(avgSpeedMbps),
      avgDurationSec: round(avgDurationSec),
      avgAcceptanceLatencySec: round(avgAcceptanceLatencySec),
      avgGestureConfidence: round(avgGestureConfidence),
      avgSenderGestureConfidence: round(avg(senderGestures, 'confidence') * 100),
      avgReceiverGestureConfidence: round(avg(receiverGestures, 'confidence') * 100),
      gestureUseRate: round(gestureUseRate)
    },
    byType: Object.entries(byType).map(([name, value]) => ({ name, ...value, mb: round(value.mb) })),
    recent,
    recommendations
  };
}

function createDemoData() {
  const fileTypes = ['image', 'pdf', 'video', 'document'];
  const events = [];
  for (let i = 0; i < 28; i += 1) {
    const size = round(1.5 + Math.random() * 48, 2);
    const success = Math.random() > 0.12;
    const duration = round(0.8 + size / (3 + Math.random() * 9), 2);
    const speed = success ? round((size * 8) / duration, 2) : 0;
    const trigger = Math.random() > 0.25 ? 'gesture' : 'manual';
    events.push({
      id: crypto.randomUUID(), timestamp: new Date(Date.now() - (27 - i) * 36e5).toISOString(),
      type: 'transfer', success, trigger, fileName: `classroom-sample-${i + 1}`,
      fileType: fileTypes[i % fileTypes.length], fileSizeMB: size, durationSec: duration,
      speedMbps: speed, room: 'DEMO'
    });
    if (trigger === 'gesture') {
      events.push({
        id: crypto.randomUUID(), timestamp: new Date(Date.now() - (27 - i) * 36e5 + 2000).toISOString(),
        type: 'gesture', gesture: i % 2 === 0 ? 'Air_Copy' : 'Air_Paste', role: i % 2 === 0 ? 'sender' : 'receiver', action: i % 2 === 0 ? 'Air_Copy' : 'Air_Paste', confidence: round(0.68 + Math.random() * 0.31, 3)
      });
    }
  }
  return events;
}

function createServer() {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server, maxPayload: MAX_SIGNAL_BYTES });
  const rooms = new Map();

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(self)');
    next();
  });
  app.use(express.json({ limit: '128kb' }));
  app.use(express.static(PUBLIC_DIR, { etag: true, maxAge: 0 }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, version: '4.2.0', rooms: rooms.size }));
  app.get('/api/analytics', (_req, res) => res.json(analyticsSummary(safeReadEvents())));

  app.post('/api/events', (req, res) => {
    const event = sanitizeEvent(req.body);
    if (!event) return res.status(400).json({ error: 'Unsupported event type' });
    res.status(201).json(appendEvent(event));
  });

  app.post('/api/demo-data', (_req, res) => {
    const events = safeReadEvents();
    events.push(...createDemoData());
    writeEvents(events.slice(-2000));
    res.json(analyticsSummary(events));
  });

  app.delete('/api/analytics', (_req, res) => {
    writeEvents([]);
    res.json({ ok: true });
  });

  function roomPeers(room) { return rooms.get(room) || new Set(); }
  function broadcastRoom(room, payload, except = null) {
    const encoded = JSON.stringify(payload);
    for (const client of roomPeers(room)) {
      if (client !== except && client.readyState === WebSocket.OPEN) client.send(encoded);
    }
  }
  function roomRoles(room) {
    return [...roomPeers(room)].map((peer) => peer.role).filter(Boolean);
  }
  function leaveRoom(ws) {
    if (!ws.room || !rooms.has(ws.room)) return;
    const room = ws.room;
    const peers = rooms.get(room);
    peers.delete(ws);
    ws.room = null;
    broadcastRoom(room, { type: 'peer-left', peers: peers.size, roles: roomRoles(room) });
    if (peers.size === 0) rooms.delete(room);
  }

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      let data;
      try { data = JSON.parse(raw.toString()); } catch { return ws.send(JSON.stringify({ type: 'error', message: 'Invalid signaling message' })); }

      if (data.type === 'join') {
        leaveRoom(ws);
        const room = String(data.room || '').trim().toUpperCase().slice(0, 12);
        const role = data.role === 'receiver' ? 'receiver' : 'sender';
        if (!/^[A-Z0-9-]{2,12}$/.test(room)) return ws.send(JSON.stringify({ type: 'error', message: 'Valid room code required' }));
        const peers = roomPeers(room);
        if (peers.size >= 2) return ws.send(JSON.stringify({ type: 'error', message: 'Room already has two peers' }));
        if ([...peers].some((peer) => peer.role === role)) return ws.send(JSON.stringify({ type: 'error', message: `Room already has a ${role}. Choose the opposite role.` }));

        ws.room = room;
        ws.role = role;
        if (!rooms.has(room)) rooms.set(room, new Set());
        rooms.get(room).add(ws);
        const count = rooms.get(room).size;
        ws.send(JSON.stringify({ type: 'joined', room, peers: count, role, roles: roomRoles(room) }));
        broadcastRoom(room, { type: 'peer-ready', peers: count, roles: roomRoles(room) });
        return;
      }

      if (['offer', 'answer', 'ice'].includes(data.type) && ws.room) {
        if (data.type === 'offer' && ws.role !== 'sender') return;
        if (data.type === 'answer' && ws.role !== 'receiver') return;
        broadcastRoom(ws.room, data, ws);
      }
    });

    ws.on('close', () => leaveRoom(ws));
    ws.on('error', () => leaveRoom(ws));
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    }
  }, 30000);
  heartbeat.unref?.();

  server.on('close', () => clearInterval(heartbeat));
  return { app, server, wss, rooms };
}

if (require.main === module) {
  const { server } = createServer();
  server.listen(PORT, '0.0.0.0', () => {
    console.log('\nAirGesture Transfer Intelligence v4.2');
    console.log(`Local:   http://localhost:${PORT}`);
    console.log('Network: use this Mac\'s LAN IP with the same port for a receiver on the same Wi-Fi.\n');
  });
}

module.exports = { createServer, analyticsSummary, sanitizeEvent };
