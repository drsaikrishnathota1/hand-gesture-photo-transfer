const express = require("express");
const path = require("path");
const http = require("http");
const fs = require("fs");
const crypto = require("crypto");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const ANALYTICS_FILE = path.join(DATA_DIR, "analytics.json");
const rooms = new Map();

fs.mkdirSync(DATA_DIR, { recursive: true });

function safeReadEvents() {
  try {
    if (!fs.existsSync(ANALYTICS_FILE)) return [];
    return JSON.parse(fs.readFileSync(ANALYTICS_FILE, "utf8"));
  } catch (error) {
    console.error("Could not read analytics:", error.message);
    return [];
  }
}

function writeEvents(events) {
  const tmp = `${ANALYTICS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(events, null, 2));
  fs.renameSync(tmp, ANALYTICS_FILE);
}

function appendEvent(event) {
  const events = safeReadEvents();
  const record = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...event
  };
  events.push(record);
  writeEvents(events.slice(-2000));
  return record;
}

function round(value, places = 1) {
  const p = 10 ** places;
  return Math.round((Number(value) || 0) * p) / p;
}

function analyticsSummary(events) {
  const transfers = events.filter((e) => e.type === "transfer");
  const gestures = events.filter((e) => e.type === "gesture");
  const successful = transfers.filter((e) => e.success);
  const failed = transfers.filter((e) => !e.success);
  const gestureTriggered = transfers.filter((e) => e.trigger === "gesture");

  const avg = (arr, field) =>
    arr.length ? arr.reduce((sum, item) => sum + (Number(item[field]) || 0), 0) / arr.length : 0;

  const byType = {};
  for (const t of transfers) {
    const key = t.fileType || "other";
    if (!byType[key]) byType[key] = { total: 0, success: 0, mb: 0 };
    byType[key].total += 1;
    byType[key].success += t.success ? 1 : 0;
    byType[key].mb += Number(t.fileSizeMB) || 0;
  }

  const recent = transfers.slice(-12).reverse();
  const successRate = transfers.length ? (successful.length / transfers.length) * 100 : 0;
  const gestureUseRate = transfers.length ? (gestureTriggered.length / transfers.length) * 100 : 0;
  const avgGestureConfidence = avg(gestures, "confidence") * 100;
  const avgSpeedMbps = avg(successful, "speedMbps");
  const avgDurationSec = avg(successful, "durationSec");

  const recommendations = [];
  if (!transfers.length) {
    recommendations.push({ level: "info", title: "Collect evidence", text: "Complete several transfers or load classroom demo data before making an executive decision." });
  } else {
    if (successRate < 90) recommendations.push({ level: "risk", title: "Reliability risk", text: `Success rate is ${round(successRate)}%. Improve transfer reliability before an organizational pilot.` });
    else recommendations.push({ level: "good", title: "Pilot-ready reliability", text: `Observed success rate is ${round(successRate)}%. Continue testing under varied devices, networks, lighting, and file sizes.` });

    if (avgGestureConfidence < 80 && gestures.length) recommendations.push({ level: "risk", title: "Gesture recognition needs improvement", text: `Average gesture confidence is ${round(avgGestureConfidence)}%. Test lighting, camera position, and recognition thresholds.` });
    if (gestureUseRate < 50) recommendations.push({ level: "info", title: "Low gesture adoption", text: `Only ${round(gestureUseRate)}% of transfers were gesture-triggered. Investigate usability and user preference before deployment.` });
    if (avgSpeedMbps > 0 && avgSpeedMbps < 5) recommendations.push({ level: "warn", title: "Performance constraint", text: `Average successful transfer speed is ${round(avgSpeedMbps)} Mbps. Validate performance on the target network environment.` });
  }

  return {
    generatedAt: new Date().toISOString(),
    kpis: {
      transfers: transfers.length,
      successRate: round(successRate),
      failedTransfers: failed.length,
      avgSpeedMbps: round(avgSpeedMbps),
      avgDurationSec: round(avgDurationSec),
      avgGestureConfidence: round(avgGestureConfidence),
      gestureUseRate: round(gestureUseRate)
    },
    byType: Object.entries(byType).map(([name, value]) => ({ name, ...value, mb: round(value.mb) })),
    recent,
    recommendations
  };
}

function createDemoData() {
  const fileTypes = ["image", "pdf", "video", "document"];
  const events = [];
  for (let i = 0; i < 28; i += 1) {
    const size = round(1.5 + Math.random() * 48, 2);
    const success = Math.random() > 0.12;
    const duration = round(0.8 + size / (3 + Math.random() * 9), 2);
    const speed = success ? round((size * 8) / duration, 2) : 0;
    const trigger = Math.random() > 0.25 ? "gesture" : "manual";
    events.push({
      id: crypto.randomUUID(),
      timestamp: new Date(Date.now() - (27 - i) * 36e5).toISOString(),
      type: "transfer",
      success,
      trigger,
      fileName: `classroom-sample-${i + 1}`,
      fileType: fileTypes[i % fileTypes.length],
      fileSizeMB: size,
      durationSec: duration,
      speedMbps: speed,
      room: "DEMO"
    });
    if (trigger === "gesture") {
      events.push({
        id: crypto.randomUUID(),
        timestamp: new Date(Date.now() - (27 - i) * 36e5 + 2000).toISOString(),
        type: "gesture",
        gesture: i % 4 === 0 ? "Open_Palm" : "Victory",
        confidence: round(0.68 + Math.random() * 0.31, 3)
      });
    }
  }
  return events;
}

app.use(express.json({ limit: "1mb" }));
app.use(express.static(PUBLIC_DIR));

app.get("/api/health", (_req, res) => res.json({ ok: true, version: "2.0.0" }));
app.get("/api/analytics", (_req, res) => res.json(analyticsSummary(safeReadEvents())));

app.post("/api/events", (req, res) => {
  const allowedTypes = new Set(["transfer", "gesture"]);
  if (!allowedTypes.has(req.body?.type)) return res.status(400).json({ error: "Unsupported event type" });
  const record = appendEvent(req.body);
  res.status(201).json(record);
});

app.post("/api/demo-data", (_req, res) => {
  const events = safeReadEvents();
  events.push(...createDemoData());
  writeEvents(events.slice(-2000));
  res.json(analyticsSummary(events));
});

app.delete("/api/analytics", (_req, res) => {
  writeEvents([]);
  res.json({ ok: true });
});

function roomPeers(room) {
  return rooms.get(room) || new Set();
}

function broadcastRoom(room, payload, except = null) {
  const encoded = JSON.stringify(payload);
  for (const client of roomPeers(room)) {
    if (client !== except && client.readyState === WebSocket.OPEN) client.send(encoded);
  }
}

function leaveRoom(ws) {
  if (!ws.room || !rooms.has(ws.room)) return;
  const peers = rooms.get(ws.room);
  peers.delete(ws);
  broadcastRoom(ws.room, { type: "peer-left", peers: peers.size });
  if (peers.size === 0) rooms.delete(ws.room);
}

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (data.type === "join") {
      leaveRoom(ws);
      const room = String(data.room || "").trim().toUpperCase().slice(0, 12);
      if (!room) return ws.send(JSON.stringify({ type: "error", message: "Room code required" }));
      const peers = roomPeers(room);
      if (peers.size >= 2) return ws.send(JSON.stringify({ type: "error", message: "Room already has two peers" }));
      ws.room = room;
      ws.role = data.role === "receiver" ? "receiver" : "sender";
      if (!rooms.has(room)) rooms.set(room, new Set());
      rooms.get(room).add(ws);
      const count = rooms.get(room).size;
      ws.send(JSON.stringify({ type: "joined", room, peers: count, role: ws.role }));
      broadcastRoom(room, { type: "peer-ready", peers: count });
      return;
    }

    if (["offer", "answer", "ice"].includes(data.type) && ws.room) {
      broadcastRoom(ws.room, data, ws);
    }
  });

  ws.on("close", () => leaveRoom(ws));
});

server.listen(PORT, () => {
  console.log(`\nAirGesture Transfer Intelligence v2`);
  console.log(`Open http://localhost:${PORT}\n`);
});
