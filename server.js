const express = require('express');
const path = require('path');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const net = require('net');
const WebSocket = require('ws');
const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const { createAuthRouter } = require('./auth');
const { createDatabase } = require('./db');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const ANALYTICS_FILE = path.join(DATA_DIR, 'analytics.json');
const MAX_SIGNAL_BYTES = 512 * 1024;
const MAX_BROADCAST_FILE_BYTES = 100 * 1024 * 1024;
// 0 means no fixed application-level receiver cap. Real capacity depends on deployed server/network resources.
const CONFIGURED_RECEIVER_LIMIT = Math.max(0, Number.parseInt(process.env.AIRGESTURE_MAX_RECEIVERS || '0', 10) || 0);
const BROADCAST_TTL_MS = 2 * 60 * 60 * 1000;
const BROADCAST_DIR = path.join(DATA_DIR, 'broadcasts');
const TRUST_PROXY = String(process.env.AIRGESTURE_TRUST_PROXY || '').trim() === '1';
const IP_ENRICH_URL_TEMPLATE = String(process.env.AIRGESTURE_IP_ENRICH_URL_TEMPLATE || '').trim();

const ADMIN_EMAILS = new Set(
  String(
    process.env.AIRGESTURE_ADMIN_EMAILS || ''
  )
    .split(',')
    .map((value) =>
      value.trim().toLowerCase()
    )
    .filter(Boolean)
);


fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BROADCAST_DIR, { recursive: true });

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
      action: String(input.action || input.gesture || '').slice(0, 40),
      mode: input.mode === 'broadcast' ? 'broadcast' : 'peer'
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
    reason: input.reason ? String(input.reason).slice(0, 160) : undefined,
    mode: input.mode === 'broadcast' ? 'broadcast' : 'peer',
    receiverCount: Math.max(0, Number(input.receiverCount) || 0)
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
  const broadcastTransfers = transfers.filter((e) => e.mode === 'broadcast');
  const avgBroadcastAudience = avg(broadcastTransfers, 'receiverCount');

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
      gestureUseRate: round(gestureUseRate),
      broadcastTransfers: broadcastTransfers.length,
      avgBroadcastAudience: round(avgBroadcastAudience)
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


function normalizeIp(value) {
  let ip = String(value || '').trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip.includes('%')) ip = ip.split('%')[0];
  return ip;
}

function classifyIp(value) {
  const ip = normalizeIp(value);
  if (!ip) return 'unknown';
  if (ip === '::1' || ip === '127.0.0.1') return 'loopback';
  if (net.isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) return 'private';
    return 'public';
  }
  if (net.isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    if (lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80:')) return 'private';
    return 'public';
  }
  return 'unknown';
}

function maskIp(value) {
  const ip = normalizeIp(value);
  const kind = net.isIP(ip);
  if (kind === 4) {
    const p = ip.split('.');
    if (ip === '127.0.0.1') return '127.xxx.xxx.xxx';
    return `${p[0]}.${p[1]}.xxx.xxx`;
  }
  if (kind === 6) {
    if (ip === '::1') return '::1 (local)';
    const parts = ip.split(':').filter(Boolean);
    return `${parts.slice(0, 3).join(':') || 'IPv6'}:xxxx:xxxx:xxxx`;
  }
  return 'Unavailable';
}

function requestIp(req) {
  if (TRUST_PROXY) {
    const forwarded = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return normalizeIp(forwarded);
  }
  return normalizeIp(req?.socket?.remoteAddress || '');
}

function firstHeader(headers, names) {
  for (const name of names) {
    const value = headers?.[name];
    if (value) {
      try { return decodeURIComponent(String(Array.isArray(value) ? value[0] : value)); }
      catch { return String(Array.isArray(value) ? value[0] : value); }
    }
  }
  return '';
}

function sanitizeClientInfo(input = {}) {
  const clean = (value, max = 80) => String(value || '').replace(/[\\r\\n\\t]/g, ' ').slice(0, max);
  const finite = (value, min, max) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : 0;
  };
  return {
    browser: clean(input.browser),
    os: clean(input.os),
    deviceType: clean(input.deviceType, 32),
    timezone: clean(input.timezone),
    language: clean(input.language, 24),
    connectionType: clean(input.connectionType, 32),
    effectiveType: clean(input.effectiveType, 16),
    downlinkMbps: finite(input.downlinkMbps, 0, 100000),
    rttEstimateMs: finite(input.rttEstimateMs, 0, 120000),
    screen: clean(input.screen, 32),
    cpuCores: finite(input.cpuCores, 0, 512),
    memoryGB: finite(input.memoryGB, 0, 1024)
  };
}

function baseNetworkIdentity(rawIp, headers = {}) {
  const addressClass = classifyIp(rawIp);
  const city = firstHeader(headers, ['x-airgesture-city', 'x-vercel-ip-city', 'cf-ipcity']);
  const region = firstHeader(headers, ['x-airgesture-region', 'x-vercel-ip-country-region', 'cf-region']);
  const country = firstHeader(headers, ['x-airgesture-country', 'x-vercel-ip-country', 'cf-ipcountry']);
  const provider = firstHeader(headers, ['x-airgesture-provider', 'cf-as-organization']);
  const fallbackLocation = addressClass === 'loopback' ? 'Local device'
    : addressClass === 'private' ? 'Private network'
    : 'Approximate location unavailable';
  return {
    maskedIp: maskIp(rawIp),
    addressClass,
    city: city || '',
    region: region || '',
    country: country || '',
    location: [city, region].filter(Boolean).join(', ') || country || fallbackLocation,
    provider: provider || (addressClass === 'loopback' ? 'Localhost' : addressClass === 'private' ? 'LAN' : 'Not enriched')
  };
}

async function enrichNetworkIdentity(rawIp, identity) {
  if (!IP_ENRICH_URL_TEMPLATE || identity.addressClass !== 'public' || !globalThis.fetch) return identity;
  if (!IP_ENRICH_URL_TEMPLATE.includes('{ip}')) return identity;
  const url = IP_ENRICH_URL_TEMPLATE.replace('{ip}', encodeURIComponent(rawIp));
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1800);
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    clearTimeout(timer);
    if (!response.ok) return identity;
    const data = await response.json();
    const city = String(data.city || data.town || '').slice(0, 80);
    const region = String(data.region || data.regionName || data.state || '').slice(0, 80);
    const country = String(data.country_name || data.countryName || data.country || '').slice(0, 80);
    const provider = String(data.org || data.isp || data.provider || data.asn?.name || '').slice(0, 120);
    return {
      ...identity,
      city: city || identity.city,
      region: region || identity.region,
      country: country || identity.country,
      location: [city || identity.city, region || identity.region].filter(Boolean).join(', ') || country || identity.location,
      provider: provider || identity.provider
    };
  } catch {
    return identity;
  }
}

function safeMetric(value, max = 1000000) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0;
}

function receiverIntelligenceRecord(clientId, state = {}) {
  const network = state.network || {};
  const client = state.clientInfo || {};
  const identity = state.identity || {};

  return {
    participantName: String(identity.name || 'Signed-in participant').slice(0, 120),
    participantEmail: String(identity.email || '').slice(0, 180),
    receiverId: `RCV-${String(clientId || '').replace(/-/g, '').slice(0, 6).toUpperCase()}`,
    maskedIp: network.maskedIp || 'Unavailable',
    location: network.location || 'Unavailable',
    provider: network.provider || 'Unavailable',
    addressClass: network.addressClass || 'unknown',
    browser: client.browser || 'Unknown',
    os: client.os || 'Unknown',
    deviceType: client.deviceType || 'Unknown',
    timezone: client.timezone || '',
    connectionType: client.connectionType || client.effectiveType || 'Unknown',
    downlinkMbps: safeMetric(client.downlinkMbps),
    browserRttMs: safeMetric(client.rttEstimateMs, 120000),
    latencyMs: safeMetric(state.latencyMs, 120000),
    transferSpeedMbps: safeMetric(state.transferSpeedMbps),
    downloadTimeSec: safeMetric(state.downloadTimeSec, 86400),
    acceptanceLatencySec: safeMetric(state.acceptanceLatencySec, 86400),
    gestureConfidence: safeMetric(state.gestureConfidence, 1),
    retries: Math.floor(safeMetric(state.retries, 1000)),
    integrityVerified: Boolean(state.integrityVerified),
    result: state.completedAt ? 'SUCCESS' : state.failedAt ? 'FAILED' : state.acceptedAt ? 'RECEIVING' : 'WAITING',
    failureReason: String(state.failureReason || '').slice(0, 160)
  };
}

function createServer() {
  const app = express();
  const database = createDatabase();

  // Integration-test-only authentication bypass.
  // This cannot activate in production because NODE_ENV must equal "test".
  const allowTestAuthBypass =
    process.env.NODE_ENV === 'test' &&
    process.env.AIRGESTURE_TEST_AUTH_BYPASS === '1';

  if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }

  const sessionSecret = String(
    process.env.SESSION_SECRET ||
    (process.env.NODE_ENV === 'production'
      ? ''
      : 'airgesture-local-development-session-secret')
  );

  if (!sessionSecret) {
    throw new Error('SESSION_SECRET is required in production');
  }

  const sessionOptions = {
    name: 'airgesture.sid',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000
    }
  };

  if (database.enabled) {
    const PgSessionStore =
      connectPgSimple(session);

    sessionOptions.store =
      new PgSessionStore({
        pool: database.pool,
        tableName: 'user_sessions',
        createTableIfMissing: true
      });
  }

  const sessionParser =
    session(sessionOptions);

  app.use(sessionParser);

  app.use(
    '/api/auth',
    createAuthRouter({ database })
  );

  const server = http.createServer(app);
  const wss = new WebSocket.Server({
    noServer: true,
    maxPayload: MAX_SIGNAL_BYTES
  });

  // WebSockets are accepted only when the browser has a valid
  // AirGesture Google-authenticated session.
  server.on('upgrade', (req, socket, head) => {
    sessionParser(req, {}, () => {
      if (!req.session?.user?.googleSub && !allowTestAuthBypass) {
        socket.write(
          'HTTP/1.1 401 Unauthorized\r\n' +
          'Connection: close\r\n\r\n'
        );
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    });
  });

  // V5.1 uses one universal server-assisted room model.
  // Legacy peer-room storage is retained only for backward data compatibility; new joins do not use it.
  const rooms = new Map();

  // One Sender uploads once; any number of Receivers supported by server capacity independently Air Paste/download.
  const broadcastRooms = new Map();

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(self)');
    next();
  });
  app.use(express.json({ limit: '128kb' }));
  app.use(express.static(PUBLIC_DIR, { etag: true, maxAge: 0 }));

  function requireAuth(req, res, next) {
    if (allowTestAuthBypass) return next();

    if (!req.session?.user?.googleSub) {
      return res.status(401).json({
        error: 'Google Sign-In required.'
      });
    }

    next();
  }

  async function resolveRequestDatabaseUserId(req) {
    if (!database.enabled) return null;

    const sessionUser =
      req.session?.user || {};

    if (!sessionUser.googleSub) {
      return null;
    }

    if (sessionUser.dbUserId) {
      return sessionUser.dbUserId;
    }

    const dbUser =
      await database.upsertUser({
        googleSub:
          sessionUser.googleSub,

        name:
          sessionUser.name,

        email:
          sessionUser.email,

        picture:
          sessionUser.picture
      });

    const userId =
      dbUser?.id || null;

    if (
      userId &&
      req.session?.user
    ) {
      req.session.user.dbUserId =
        String(userId);
    }

    return userId;
  }


  function requireAdmin(req, res, next) {
    const email =
      String(
        req.session?.user?.email || ''
      )
        .trim()
        .toLowerCase();

    if (
      !email ||
      !ADMIN_EMAILS.has(email)
    ) {
      return res.status(403).json({
        error:
          'AirGesture administrator access required.'
      });
    }

    next();
  }

  // Public: /api/auth/* and /api/health
  // Protected: classroom data, transfer files and telemetry.
  app.use('/api/network/ping', requireAuth);
  app.use('/api/analytics', requireAuth);
  app.use('/api/events', requireAuth);
  app.use('/api/demo-data', requireAuth);
  app.use('/api/broadcast', requireAuth);

  app.get('/api/health', (_req, res) => res.json({
    ok: true,
    version: '5.4.0',
    peerRooms: rooms.size,
    broadcastRooms: broadcastRooms.size,
    receiverLimit: CONFIGURED_RECEIVER_LIMIT || null,
    networkIntelligence: true,
    ipEnrichmentConfigured: Boolean(IP_ENRICH_URL_TEMPLATE),
    database: database.status()
  }));

  app.get('/api/network/ping', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, serverTime: Date.now() });
  });

  app.get(
    '/api/persistence/summary',
    requireAuth,
    async (_req, res) => {
      if (!database.enabled) {
        return res.status(503).json({
          error:
            'PostgreSQL is not configured.'
        });
      }

      try {
        res.setHeader(
          'Cache-Control',
          'no-store'
        );

        res.json({
          ok: true,
          ...(await database.summary())
        });
      } catch (error) {
        databaseError(
          'summary query',
          error
        );

        res.status(500).json({
          error:
            'Could not read persistence summary.'
        });
      }
    }
  );


  app.post(
    '/api/persistence/transfer',
    requireAuth,
    async (req, res) => {
      try {
        if (!database.enabled) {
          return res.status(503).json({
            error:
              'PostgreSQL is not configured.'
          });
        }

        const roomCode = String(
          req.body?.room || ''
        ).trim().toUpperCase();

        const fileId = String(
          req.body?.fileId || ''
        ).trim();

        if (
          !isValidRoomCode(roomCode) ||
          !fileId
        ) {
          return res.status(400).json({
            error:
              'Room code and file ID are required.'
          });
        }

        const sessionUser =
          req.session?.user || {};

        let userId =
          sessionUser.dbUserId || null;

        if (!userId) {
          const dbUser =
            await database.upsertUser({
              googleSub:
                sessionUser.googleSub,
              name:
                sessionUser.name,
              email:
                sessionUser.email,
              picture:
                sessionUser.picture
            });

          userId =
            dbUser?.id || null;

          if (req.session?.user) {
            req.session.user.dbUserId =
              userId;
          }
        }

        if (!userId) {
          throw new Error(
            'Could not resolve PostgreSQL user'
          );
        }

        const activeRoom =
          broadcastRooms.get(roomCode);

        let sessionId =
          activeRoom?.sessionId || null;

        let persistedParticipant = null;

        if (!sessionId) {
          persistedParticipant =
            await database
              .findLatestReceiverSession({
                roomCode,
                userId
              });

          sessionId =
            persistedParticipant
              ?.session_id || null;
        }

        if (!sessionId) {
          return res.status(409).json({
            error:
              'No persisted Receiver classroom session was found.'
          });
        }

        let receiverWs = null;

        if (activeRoom) {
          for (
            const ws
            of activeRoom.receivers.values()
          ) {
            if (
              ws?.user?.googleSub ===
              sessionUser.googleSub
            ) {
              receiverWs = ws;
              break;
            }
          }
        }

        const receiverState =
          receiverWs && activeRoom
            ? activeRoom.receiverStates.get(
                receiverWs.clientId
              ) || {}
            : {};

        if (
          !persistedParticipant &&
          !receiverWs
        ) {
          persistedParticipant =
            await database
              .findLatestReceiverSession({
                roomCode,
                userId
              });
        }

        const activeFile =
          activeRoom?.file?.id === fileId
            ? activeRoom.file
            : null;

        const file = {
          id: fileId,

          name:
            activeFile?.name ||
            String(
              req.body?.fileName || ''
            ).slice(0, 180),

          size:
            activeFile?.size ??
            Number(
              req.body?.fileSize || 0
            ),

          mime:
            activeFile?.mime ||
            String(
              req.body?.fileType ||
              'application/octet-stream'
            ).slice(0, 120)
        };

        const participantClient = {
          browser:
            persistedParticipant?.browser ||
            '',
          os:
            persistedParticipant?.os ||
            '',
          deviceType:
            persistedParticipant
              ?.device_type || '',
          timezone:
            persistedParticipant
              ?.timezone || ''
        };

        const participantNetwork = {
          maskedIp:
            persistedParticipant
              ?.masked_ip || '',
          location:
            persistedParticipant
              ?.location || '',
          provider:
            persistedParticipant
              ?.provider || ''
        };

        const result =
          req.body?.result === 'FAILED'
            ? 'FAILED'
            : 'SUCCESS';

        const record =
          await database.recordTransferEvent({
            sessionId,
            userId,

            receiverId:
              receiverWs
                ? participantId(
                    receiverWs,
                    'receiver'
                  )
                : persistedParticipant
                    ?.receiver_id || '',

            roomCode,
            file,
            result,

            trigger:
              req.body?.trigger === 'gesture'
                ? 'gesture'
                : 'manual',

            latencyMs:
              req.body?.latencyMs ??
              receiverState.latencyMs,

            speedMbps:
              req.body?.speedMbps ??
              receiverState
                .transferSpeedMbps,

            durationSec:
              req.body?.durationSec ??
              receiverState
                .downloadTimeSec,

            acceptanceLatencySec:
              req.body
                ?.acceptanceLatencySec ??
              receiverState
                .acceptanceLatencySec,

            gestureConfidence:
              req.body
                ?.gestureConfidence ??
              receiverState
                .gestureConfidence,

            integrityVerified:
              Boolean(
                req.body
                  ?.integrityVerified
              ),

            retries:
              req.body?.retries || 0,

            failureReason:
              req.body
                ?.failureReason || '',

            clientInfo:
              receiverState.clientInfo ||
              receiverWs?.clientInfo ||
              participantClient,

            network:
              receiverState.network ||
              receiverWs?.network ||
              participantNetwork
          });

        try {
          await database
            .recordCommercialTransfer({
              userId,
              file
            });
        } catch (commercialError) {
          databaseError(
            'commercial transfer aggregation',
            commercialError
          );
        }

        if (result === 'SUCCESS') {
          try {
            const liveConsent =
              await database
                .getConsentPreferences(
                  userId
                );

            await database
              .recordLiveDataEvent({
                sessionId,
                userId,
                roomCode,
                action:
                  'RECEIVE',
                file,
                clientInfo:
                  receiverState.clientInfo ||
                  receiverWs?.clientInfo ||
                  participantClient,
                network:
                  receiverState.network ||
                  receiverWs?.network ||
                  participantNetwork,
                commercialAllowed:
                  Boolean(
                    liveConsent
                      .analyticsConsent
                  )
              });
          } catch (liveError) {
            databaseError(
              'live HTTP RECEIVE persistence',
              liveError
            );
          }
        }

        console.log(
          'PostgreSQL HTTP transfer persisted:',
          result,
          roomCode,
          fileId
        );

        return res.status(201).json({
          ok: true,
          persisted: true,
          result,
          id: record?.id || null,
          sessionId
        });
      } catch (error) {
        databaseError(
          'HTTP transfer persistence',
          error
        );

        return res.status(500).json({
          error:
            'Transfer succeeded, but database persistence failed.'
        });
      }
    }
  );


  app.get(
    '/api/commercial/consent',
    requireAuth,
    async (req, res) => {
      try {
        if (!database.enabled) {
          return res.status(503).json({
            error:
              'PostgreSQL is not configured.'
          });
        }

        const userId =
          await resolveRequestDatabaseUserId(
            req
          );

        if (!userId) {
          return res.status(401).json({
            error:
              'Authenticated database user could not be resolved.'
          });
        }

        const consent =
          await database
            .getConsentPreferences(
              userId
            );

        res.setHeader(
          'Cache-Control',
          'no-store'
        );

        return res.json({
          ok: true,
          ...consent
        });
      } catch (error) {
        databaseError(
          'commercial consent read',
          error
        );

        return res.status(500).json({
          error:
            'Could not read data preferences.'
        });
      }
    }
  );


  app.post(
    '/api/commercial/consent',
    requireAuth,
    async (req, res) => {
      try {
        if (!database.enabled) {
          return res.status(503).json({
            error:
              'PostgreSQL is not configured.'
          });
        }

        const userId =
          await resolveRequestDatabaseUserId(
            req
          );

        if (!userId) {
          return res.status(401).json({
            error:
              'Authenticated database user could not be resolved.'
          });
        }

        await database
          .saveConsentPreferences({
            userId,

            analyticsConsent:
              req.body
                ?.analyticsConsent ===
              true,

            personalizationConsent:
              req.body
                ?.personalizationConsent ===
              true,

            marketingConsent:
              req.body
                ?.marketingConsent ===
              true,

            policyVersion:
              '2026-08-v1',

            source:
              'airgesture-web'
          });

        const consent =
          await database
            .getConsentPreferences(
              userId
            );

        return res.json({
          ok: true,
          ...consent
        });
      } catch (error) {
        databaseError(
          'commercial consent save',
          error
        );

        return res.status(500).json({
          error:
            'Could not save data preferences.'
        });
      }
    }
  );


  app.post(
    '/api/commercial/profile',
    requireAuth,
    async (req, res) => {
      try {
        if (!database.enabled) {
          return res.status(503).json({
            error:
              'PostgreSQL is not configured.'
          });
        }

        const userId =
          await resolveRequestDatabaseUserId(
            req
          );

        if (!userId) {
          return res.status(401).json({
            error:
              'Authenticated database user could not be resolved.'
          });
        }

        const rawIp =
          requestIp(req);

        let network =
          baseNetworkIdentity(
            rawIp,
            req.headers
          );

        network =
          await enrichNetworkIdentity(
            rawIp,
            network
          );

        const profile =
          await database
            .upsertCommercialProfile({
              userId,

              clientInfo:
                sanitizeClientInfo(
                  req.body?.clientInfo ||
                  {}
                ),

              network,

              acquisition:
                req.body?.acquisition ||
                {},

              screenCategory:
                req.body
                  ?.screenCategory,

              touchCapable:
                req.body
                  ?.touchCapable === true,

              memoryTier:
                req.body
                  ?.memoryTier,

              cpuTier:
                req.body
                  ?.cpuTier,

              deviceSegment:
                req.body
                  ?.deviceSegment
            });

        const consent =
          await database
            .getConsentPreferences(
              userId
            );

        return res.json({
          ok: true,

          collected:
            Boolean(profile),

          reason:
            profile
              ? null
              : 'analytics_consent_required',

          consent: {
            analyticsConsent:
              consent
                .analyticsConsent,

            personalizationConsent:
              consent
                .personalizationConsent,

            marketingConsent:
              consent
                .marketingConsent
          }
        });
      } catch (error) {
        databaseError(
          'commercial profile save',
          error
        );

        return res.status(500).json({
          error:
            'Could not save commercial analytics profile.'
        });
      }
    }
  );





  app.get(
    '/api/live-data',
    requireAuth,
    async (req, res) => {
      try {
        if (!database.enabled) {
          return res.status(503).json({
            error:
              'PostgreSQL database is not configured.'
          });
        }

        const data =
          await database
            .liveClassroomData({
              allHistory: true,
              limit: null
            });

        res.setHeader(
          'Cache-Control',
          'no-store'
        );

        return res.json(data);

      } catch (error) {
        console.error(
          'Live classroom database failed:',
          error
        );

        return res.status(500).json({
          error:
            'Could not load classroom database.'
        });
      }
    }
  );

  app.get(
    '/api/admin/database',
    requireAuth,
    requireAdmin,
    async (req, res) => {
      try {
        if (!database.enabled) {
          return res.status(503).json({
            error:
              'PostgreSQL is not configured.'
          });
        }

        const limit =
          Math.max(
            1,
            Math.min(
              1000,
              Number.parseInt(
                req.query?.limit || '250',
                10
              ) || 250
            )
          );

        const data =
          await database.dashboardData({
            limit
          });

        res.setHeader(
          'Cache-Control',
          'no-store'
        );

        return res.json({
          ok: true,
          ...data
        });
      } catch (error) {
        databaseError(
          'admin database dashboard',
          error
        );

        return res.status(500).json({
          error:
            'Could not load database intelligence.'
        });
      }
    }
  );



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

  function isValidRoomCode(room) {
    return /^[A-Z0-9-]{2,12}$/.test(String(room || '').trim().toUpperCase());
  }

  function sendJson(ws, payload) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }

  function databaseError(context, error) {
    console.error(
      `PostgreSQL ${context} failed:`,
      error?.message || error
    );
  }

  function participantId(ws, role) {
    const prefix =
      role === 'receiver' ? 'RCV' : 'SND';

    return `${prefix}-${String(ws?.clientId || '')
      .replace(/-/g, '')
      .slice(0, 6)
      .toUpperCase()}`;
  }

  async function resolveDatabaseUserId(ws) {
    if (
      !database.enabled ||
      !ws?.user?.googleSub
    ) {
      return null;
    }

    if (ws.user.dbUserId) {
      return ws.user.dbUserId;
    }

    const dbUser = await database.upsertUser({
      googleSub: ws.user.googleSub,
      name: ws.user.name,
      email: ws.user.email,
      picture: ''
    });

    ws.user.dbUserId =
      dbUser?.id
        ? String(dbUser.id)
        : null;

    return ws.user.dbUserId;
  }

  async function persistParticipant(room, ws, role) {
    if (
      !database.enabled ||
      !room?.sessionId ||
      !ws?.user?.googleSub
    ) {
      return null;
    }

    const userId =
      await resolveDatabaseUserId(ws);

    if (!userId) {
      throw new Error(
        'Could not resolve participant database user'
      );
    }

    const state =
      role === 'receiver'
        ? room.receiverStates.get(ws.clientId) || {}
        : {};

    return database.upsertParticipant({
      sessionId: room.sessionId,
      userId,
      receiverId: participantId(ws, role),
      role,
      clientInfo:
        state.clientInfo ||
        ws.clientInfo ||
        {},
      network:
        state.network ||
        ws.network ||
        {}
    });
  }

  function ensureClassSession(room) {
    if (
      !database.enabled ||
      !room?.host?.user?.googleSub
    ) {
      return Promise.resolve(null);
    }

    if (room.sessionReady) {
      return room.sessionReady;
    }

    if (!room.sessionId) {
      room.sessionId = crypto.randomUUID();
    }

    const sessionId = room.sessionId;

    room.sessionReady =
      (async () => {
        const hostUserId =
          await resolveDatabaseUserId(
            room.host
          );

        if (!hostUserId) {
          throw new Error(
            'Could not resolve Sender database user'
          );
        }

        await database.createClassSession({
          id: sessionId,
          roomCode: room.code,
          course: 'DBA 802',
          hostUserId
        });

        if (room.host) {
          await persistParticipant(
            room,
            room.host,
            'sender'
          );
        }

        for (
          const receiver
          of room.receivers.values()
        ) {
          if (
            receiver.room === room.code &&
            receiver.mode === 'broadcast'
          ) {
            await persistParticipant(
              room,
              receiver,
              'receiver'
            );
          }
        }

        return sessionId;
      })()
      .catch((error) => {
        databaseError(
          'class session persistence',
          error
        );

        if (room.sessionId === sessionId) {
          room.sessionId = null;
        }

        room.sessionReady = null;
        return null;
      });

    return room.sessionReady;
  }

  async function persistTransferEvent(
    room,
    ws,
    state,
    result
  ) {
    if (!database.enabled) {
      return null;
    }

    if (
      !room?.sessionId ||
      !ws?.user?.googleSub ||
      !room.file
    ) {
      console.warn(
        'PostgreSQL transfer event skipped:',
        {
          hasSession:
            Boolean(room?.sessionId),
          hasGoogleIdentity:
            Boolean(ws?.user?.googleSub),
          hasFile:
            Boolean(room?.file)
        }
      );

      return null;
    }

    const userId =
      await resolveDatabaseUserId(ws);

    if (!userId) {
      throw new Error(
        'Could not resolve Receiver database user'
      );
    }

    const file = {
      id: room.file.id,
      name: room.file.name,
      size: room.file.size,
      mime: room.file.mime
    };

    const sessionId =
      await (
        room.sessionReady ||
        Promise.resolve(room.sessionId)
      );

    if (!sessionId) {
      throw new Error(
        'Class session was not persisted'
      );
    }

    const record =
      await database.recordTransferEvent({
        sessionId,
        userId,
        receiverId:
          participantId(
            ws,
            'receiver'
          ),
        roomCode: room.code,
        file,
        result,
        trigger:
          state.trigger ||
          'manual',
        latencyMs:
          state.latencyMs,
        speedMbps:
          state.transferSpeedMbps,
        durationSec:
          state.downloadTimeSec,
        acceptanceLatencySec:
          state.acceptanceLatencySec,
        gestureConfidence:
          state.gestureConfidence,
        integrityVerified:
          state.integrityVerified,
        retries:
          state.retries,
        failureReason:
          state.failureReason,
        clientInfo:
          state.clientInfo ||
          ws.clientInfo ||
          {},
        network:
          state.network ||
          ws.network ||
          {}
      });

    if (result === 'SUCCESS') {
      try {
        const consent =
          await database
            .getConsentPreferences(
              userId
            );

        await database
          .recordLiveDataEvent({
            sessionId,
            userId,
            roomCode:
              room.code,
            action:
              'RECEIVE',
            file,
            clientInfo:
              state.clientInfo ||
              ws.clientInfo ||
              {},
            network:
              state.network ||
              ws.network ||
              {},
            commercialAllowed:
              Boolean(
                consent
                  .analyticsConsent
              )
          });
      } catch (error) {
        databaseError(
          'live RECEIVE persistence',
          error
        );
      }
    }

    console.log(
      'PostgreSQL transfer event persisted:',
      result,
      room.code,
      participantId(
        ws,
        'receiver'
      )
    );

    return record;
  }

  function persistParticipantLeave(room, ws) {
    if (
      !database.enabled ||
      !room?.sessionId ||
      !ws?.user?.dbUserId
    ) {
      return;
    }

    const waiting =
      room.sessionReady ||
      Promise.resolve(room.sessionId);

    void waiting
      .then((sessionId) => {
        if (!sessionId) return null;

        return database.markParticipantLeft({
          sessionId,
          userId: ws.user.dbUserId,
          role:
            ws.role === 'receiver'
              ? 'receiver'
              : 'sender'
        });
      })
      .catch((error) => {
        databaseError(
          'participant leave persistence',
          error
        );
      });
  }

  function endRoomSession(room) {
    if (
      !database.enabled ||
      !room?.sessionId
    ) {
      return;
    }

    void database
      .endClassSession(room.sessionId)
      .catch((error) => {
        databaseError(
          'class session close',
          error
        );
      });
  }

  // -----------------------------
  // Existing peer-to-peer rooms
  // -----------------------------
  function roomPeers(room) { return rooms.get(room) || new Set(); }

  function broadcastPeerRoom(room, payload, except = null) {
    const encoded = JSON.stringify(payload);
    for (const client of roomPeers(room)) {
      if (client !== except && client.readyState === WebSocket.OPEN) client.send(encoded);
    }
  }

  function roomRoles(room) {
    return [...roomPeers(room)].map((peer) => peer.role).filter(Boolean);
  }

  function leavePeerRoom(ws) {
    if (!ws.room || !rooms.has(ws.room)) return;
    const room = ws.room;
    const peers = rooms.get(room);
    peers.delete(ws);
    ws.room = null;
    broadcastPeerRoom(room, { type: 'peer-left', peers: peers.size, roles: roomRoles(room) });
    if (peers.size === 0) rooms.delete(room);
  }

  // -----------------------------
  // Classroom broadcast rooms
  // -----------------------------
  function sanitizeFilename(name) {
    return String(name || 'broadcast-file')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[\\/]/g, '_')
      .slice(0, 180) || 'broadcast-file';
  }

  function safeDecodeHeader(value) {
    try { return decodeURIComponent(String(value || '')); }
    catch { return String(value || ''); }
  }

  function publicBroadcastFile(file) {
    if (!file) return null;
    return {
      id: file.id,
      name: file.name,
      size: file.size,
      mime: file.mime,
      sha256: file.sha256,
      uploadedAt: file.uploadedAt,
      expiresAt: file.expiresAt
    };
  }

  function getBroadcastRoom(code, create = false) {
    let room = broadcastRooms.get(code);
    if (!room && create) {
      room = {
        code,
        host: null,
        hostToken: crypto.randomBytes(24).toString('hex'),
        receivers: new Map(),
        receiverStates: new Map(),
        file: null,
        sessionId: null,
        sessionReady: null,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      broadcastRooms.set(code, room);
    }
    return room;
  }

  function receiverIntelligence(room) {
    return [...(room?.receivers || new Map())].map(([clientId]) =>
      receiverIntelligenceRecord(clientId, room.receiverStates.get(clientId) || {})
    );
  }

  function emitReceiverIntelligence(room) {
    if (!room?.host) return;
    sendJson(room.host, { type: 'receiver-intelligence', receivers: receiverIntelligence(room) });
  }

  function broadcastStats(room) {
    const total = room?.receivers?.size || 0;
    let accepted = 0;
    let completed = 0;
    let failed = 0;
    for (const [clientId] of room?.receivers || []) {
      const entry = room.receiverStates.get(clientId) || {};
      if (entry.acceptedAt) accepted += 1;
      if (entry.completedAt) completed += 1;
      if (entry.failedAt) failed += 1;
    }
    return {
      connected: total,
      accepted,
      completed,
      failed,
      waiting: Math.max(0, total - accepted),
      completionRate: total ? Math.round((completed / total) * 1000) / 10 : 0
    };
  }

  function emitBroadcastStats(room) {
    const payload = { type: 'broadcast-stats', stats: broadcastStats(room), file: publicBroadcastFile(room.file) };
    sendJson(room.host, payload);
    for (const ws of room.receivers.values()) sendJson(ws, payload);
  }

  function emitBroadcastRoom(room, payload, except = null) {
    if (room.host && room.host !== except) sendJson(room.host, payload);
    for (const ws of room.receivers.values()) {
      if (ws !== except) sendJson(ws, payload);
    }
  }

  function deleteBroadcastFile(room) {
    if (!room?.file) return;
    const target = room.file.path;
    room.file = null;
    try { if (target && fs.existsSync(target)) fs.unlinkSync(target); } catch {}
  }

  function resetReceiverStatesForFile(room) {
    for (const clientId of room.receivers.keys()) {
      const previous = room.receiverStates.get(clientId) || {};

      room.receiverStates.set(clientId, {
        joinedAt: previous.joinedAt || Date.now(),
        identity: previous.identity || {},
        network: previous.network || {},
        clientInfo: previous.clientInfo || {}
      });
    }
  }

  function leaveBroadcastRoom(ws) {
    if (!ws.room || ws.mode !== 'broadcast') return;
    const room = broadcastRooms.get(ws.room);
    if (!room) {
      ws.room = null;
      return;
    }

    persistParticipantLeave(room, ws);

    if (ws.role === 'sender' && room.host === ws) {
      room.host = null;
      emitBroadcastRoom(room, { type: 'broadcast-host-left', room: room.code });
    } else if (ws.role === 'receiver' && ws.clientId) {
      room.receivers.delete(ws.clientId);
      room.receiverStates.delete(ws.clientId);
    }
    room.updatedAt = Date.now();
    ws.room = null;
    emitBroadcastStats(room);
    emitReceiverIntelligence(room);
  }

  function leaveAnyRoom(ws) {
    if (ws.mode === 'broadcast') leaveBroadcastRoom(ws);
    else leavePeerRoom(ws);
    ws.mode = null;
    ws.role = null;
  }

  function joinBroadcast(ws, roomCode, role, clientInfo = {}) {
    const room = getBroadcastRoom(roomCode, true);
    ws.clientInfo = sanitizeClientInfo(clientInfo);

    if (role === 'sender') {
      if (room.host && room.host !== ws && room.host.readyState === WebSocket.OPEN) {
        return sendJson(ws, { type: 'error', message: 'Broadcast room already has a Sender/Host.' });
      }
      room.host = ws;
      ws.clientId = ws.clientId || crypto.randomUUID();
    } else {
      if (!room.receivers.has(ws.clientId) && CONFIGURED_RECEIVER_LIMIT > 0 && room.receivers.size >= CONFIGURED_RECEIVER_LIMIT) {
        return sendJson(ws, { type: 'error', message: `Room reached the configured receiver limit (${CONFIGURED_RECEIVER_LIMIT}).` });
      }
      ws.clientId = ws.clientId || crypto.randomUUID();
      room.receivers.set(ws.clientId, ws);
      const previous = room.receiverStates.get(ws.clientId) || {};
      room.receiverStates.set(ws.clientId, {
        ...previous,
        joinedAt: previous.joinedAt || Date.now(),
        identity: ws.user || previous.identity || {},
        network: ws.network || previous.network || {},
        clientInfo: ws.clientInfo || previous.clientInfo || {}
      });
    }

    ws.room = roomCode;
    ws.mode = 'broadcast';
    ws.role = role;
    room.updatedAt = Date.now();

    if (role === 'sender') {
      void ensureClassSession(room);
    } else if (
      database.enabled &&
      room.sessionId
    ) {
      const waiting =
        room.sessionReady ||
        Promise.resolve(room.sessionId);

      void waiting
        .then(() => {
          if (
            ws.room === room.code &&
            ws.mode === 'broadcast'
          ) {
            return persistParticipant(
              room,
              ws,
              'receiver'
            );
          }

          return null;
        })
        .catch((error) => {
          databaseError(
            'participant join persistence',
            error
          );
        });
    }

    sendJson(ws, {
      type: 'broadcast-joined',
      room: roomCode,
      role,
      clientId: ws.clientId,
      hostToken: role === 'sender' ? room.hostToken : undefined,
      stats: broadcastStats(room),
      file: publicBroadcastFile(room.file),
      receiverLimit: CONFIGURED_RECEIVER_LIMIT || null,
      network: ws.network || {}
    });

    if (role === 'receiver' && room.file) {
      sendJson(ws, { type: 'broadcast-file-ready', file: publicBroadcastFile(room.file), stats: broadcastStats(room) });
    }

    emitBroadcastStats(room);
    emitReceiverIntelligence(room);
  }

  // Upload once from the Host. The file is streamed to temporary server storage;
  // receivers later download independently after Air Paste acceptance.
  app.post('/api/broadcast/:room/upload', (req, res) => {
    const roomCode = String(req.params.room || '').trim().toUpperCase();
    if (!isValidRoomCode(roomCode)) return res.status(400).json({ error: 'Invalid room code' });

    const room = broadcastRooms.get(roomCode);
    const token = String(req.get('x-airgesture-host-token') || '');
    if (!room || !room.host || token !== room.hostToken) {
      return res.status(403).json({ error: 'Valid active broadcast host required' });
    }

    const declaredSize = Number(req.get('x-file-size'));
    if (!Number.isFinite(declaredSize) || declaredSize < 0 || declaredSize > MAX_BROADCAST_FILE_BYTES) {
      return res.status(413).json({ error: 'Broadcast file must be 100 MB or smaller' });
    }

    const name = sanitizeFilename(safeDecodeHeader(req.get('x-file-name')));
    const mime = String(req.get('x-file-type') || 'application/octet-stream').slice(0, 120);
    const fileId = crypto.randomUUID();
    const filePath = path.join(BROADCAST_DIR, `${roomCode}-${fileId}.bin`);
    const output = fs.createWriteStream(filePath, { flags: 'wx' });
    const hash = crypto.createHash('sha256');

    let received = 0;
    let rejected = false;
    let responded = false;

    function cleanupFile() {
      try { output.destroy(); } catch {}
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
    }

    function fail(statusCode, message) {
      if (responded) return;
      responded = true;
      rejected = true;
      cleanupFile();
      res.status(statusCode).json({ error: message });
    }

    output.on('error', (error) => fail(500, `Could not store broadcast file: ${error.message}`));

    req.on('data', (chunk) => {
      if (rejected) return;
      received += chunk.length;
      if (received > declaredSize || received > MAX_BROADCAST_FILE_BYTES) {
        rejected = true;
        return;
      }
      hash.update(chunk);
      if (!output.write(chunk)) {
        req.pause();
        output.once('drain', () => req.resume());
      }
    });

    req.on('aborted', () => fail(400, 'Upload aborted'));

    req.on('end', () => {
      if (responded) return;
      if (rejected || received !== declaredSize) {
        return fail(400, `Upload size mismatch: expected ${declaredSize}, received ${received}`);
      }

      output.end(() => {
        if (responded) return;
        responded = true;

        deleteBroadcastFile(room);
        const now = Date.now();
        room.file = {
          id: fileId,
          name,
          size: received,
          mime,
          sha256: hash.digest('hex'),
          path: filePath,
          uploadedAt: new Date(now).toISOString(),
          expiresAt: new Date(now + BROADCAST_TTL_MS).toISOString()
        };
        room.updatedAt = now;
        resetReceiverStatesForFile(room);

        // The file transfer must never fail just because
        // classroom analytics persistence has a problem.
        void (async () => {
          if (!database.enabled) {
            return;
          }

          const sessionId =
            await ensureClassSession(
              room
            );

          if (
            !sessionId ||
            !room.host
          ) {
            return;
          }

          const userId =
            await resolveDatabaseUserId(
              room.host
            );

          if (!userId) {
            return;
          }

          const consent =
            await database
              .getConsentPreferences(
                userId
              );

          await database
            .recordLiveDataEvent({
              sessionId,
              userId,
              roomCode:
                room.code,
              action:
                'SEND',
              file:
                room.file,
              clientInfo:
                room.host
                  .clientInfo ||
                {},
              network:
                room.host
                  .network ||
                {},
              commercialAllowed:
                Boolean(
                  consent
                    .analyticsConsent
                )
            });
        })().catch((error) => {
          databaseError(
            'live SEND persistence',
            error
          );
        });

        const payload = {
          type: 'broadcast-file-ready',
          file: publicBroadcastFile(room.file),
          stats: broadcastStats(room)
        };
        emitBroadcastRoom(room, payload);
        emitBroadcastStats(room);

        res.status(201).json({
          ok: true,
          file: publicBroadcastFile(room.file),
          stats: broadcastStats(room)
        });
      });
    });
  });

  app.get('/api/broadcast/:room/files/:fileId', (req, res) => {
    const roomCode = String(req.params.room || '').trim().toUpperCase();
    const fileId = String(req.params.fileId || '');
    const room = broadcastRooms.get(roomCode);
    const file = room?.file;

    if (!room || !file || file.id !== fileId || !fs.existsSync(file.path)) {
      return res.status(404).json({ error: 'Broadcast file is no longer available' });
    }

    res.setHeader('Content-Type', file.mime || 'application/octet-stream');
    res.setHeader('Content-Length', String(file.size));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-AirGesture-SHA256', file.sha256);
    const asciiName = file.name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.name)}`);

    const stream = fs.createReadStream(file.path);
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).json({ error: 'Could not read broadcast file' });
      else res.destroy();
    });
    stream.pipe(res);
  });

  app.get('/api/broadcast/:room/status', (req, res) => {
    const roomCode = String(req.params.room || '').trim().toUpperCase();
    const room = broadcastRooms.get(roomCode);
    if (!room) return res.status(404).json({ error: 'Broadcast room not found' });
    res.json({
      room: roomCode,
      hostConnected: Boolean(room.host && room.host.readyState === WebSocket.OPEN),
      file: publicBroadcastFile(room.file),
      stats: broadcastStats(room),
      receiverLimit: CONFIGURED_RECEIVER_LIMIT || null
    });
  });

  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.clientId = crypto.randomUUID();

    const sessionUser = req.session?.user || (
      allowTestAuthBypass
        ? {
            googleSub: 'integration-test-user',
            name: 'Integration Test User',
            email: 'integration@example.test'
          }
        : {}
    );

    ws.user = {
      googleSub:
        String(sessionUser.googleSub || ''),
      dbUserId:
        sessionUser.dbUserId
          ? String(sessionUser.dbUserId)
          : null,
      name:
        String(sessionUser.name || '')
          .slice(0, 120),
      email:
        String(sessionUser.email || '')
          .slice(0, 180)
    };

    if (!ws.user.googleSub) {
      ws.close(4401, 'Authentication required');
      return;
    }

    const rawIp = requestIp(req);
    ws.network = baseNetworkIdentity(rawIp, req.headers || {});
    ws.clientInfo = {};
    if (IP_ENRICH_URL_TEMPLATE && ws.network.addressClass === 'public') {
      enrichNetworkIdentity(rawIp, ws.network).then((enriched) => {
        ws.network = enriched;
        if (ws.mode === 'broadcast' && ws.role === 'receiver' && ws.room) {
          const room = broadcastRooms.get(ws.room);
          const item = room?.receiverStates.get(ws.clientId);
          if (room && item) {
            item.network = enriched;
            room.receiverStates.set(ws.clientId, item);
            emitReceiverIntelligence(room);
          }
        }
      }).catch(() => {});
    }
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      let data;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return sendJson(ws, { type: 'error', message: 'Invalid signaling message' });
      }

      if (data.type === 'join') {
        leaveAnyRoom(ws);
        const room = String(data.room || '').trim().toUpperCase().slice(0, 12);
        const role = data.role === 'receiver' ? 'receiver' : 'sender';

        if (!isValidRoomCode(room)) return sendJson(ws, { type: 'error', message: 'Valid room code required' });

        // Universal workflow: every room is one Sender + N Receivers.
        return joinBroadcast(ws, room, role, data.clientInfo || {});
      }

      if (ws.mode === 'peer' && ['offer', 'answer', 'ice'].includes(data.type) && ws.room) {
        if (data.type === 'offer' && ws.role !== 'sender') return;
        if (data.type === 'answer' && ws.role !== 'receiver') return;
        return broadcastPeerRoom(ws.room, data, ws);
      }

      if (ws.mode === 'broadcast' && ws.room) {
        const room = broadcastRooms.get(ws.room);
        if (!room) return;

        if (data.type === 'broadcast-accept' && ws.role === 'receiver') {
          if (!room.file || data.fileId !== room.file.id) {
            return sendJson(ws, { type: 'error', message: 'Broadcast file is no longer current.' });
          }
          const item = room.receiverStates.get(ws.clientId) || {};
          item.acceptedAt = item.acceptedAt || Date.now();
          item.failedAt = null;
          item.clientInfo = sanitizeClientInfo(data.clientInfo || item.clientInfo || ws.clientInfo || {});
          item.network = ws.network || item.network || {};
          item.latencyMs = safeMetric(data.latencyMs, 120000);
          item.acceptanceLatencySec = safeMetric(data.acceptanceLatencySec, 86400);
          item.gestureConfidence = safeMetric(data.gestureConfidence, 1);
          item.trigger =
            data.trigger === 'gesture'
              ? 'gesture'
              : 'manual';

          room.receiverStates.set(ws.clientId, item);

          void persistParticipant(
            room,
            ws,
            'receiver'
          ).catch((error) => {
            databaseError(
              'participant telemetry persistence',
              error
            );
          });
          room.updatedAt = Date.now();
          sendJson(ws, { type: 'broadcast-accept-confirmed', file: publicBroadcastFile(room.file) });
          emitBroadcastStats(room);
          emitReceiverIntelligence(room);
          return;
        }

        if (data.type === 'broadcast-complete' && ws.role === 'receiver') {
          if (!room.file || data.fileId !== room.file.id) return;
          const item = room.receiverStates.get(ws.clientId) || {};
          item.acceptedAt = item.acceptedAt || Date.now();
          item.completedAt = Date.now();
          item.failedAt = null;
          item.latencyMs = safeMetric(data.latencyMs || item.latencyMs, 120000);
          item.transferSpeedMbps = safeMetric(data.speedMbps);
          item.downloadTimeSec = safeMetric(data.durationSec, 86400);
          item.acceptanceLatencySec = safeMetric(data.acceptanceLatencySec || item.acceptanceLatencySec, 86400);
          item.gestureConfidence = safeMetric(data.gestureConfidence || item.gestureConfidence, 1);
          item.retries = Math.floor(safeMetric(data.retries, 1000));
          item.integrityVerified = Boolean(data.integrityVerified);
          item.clientInfo = sanitizeClientInfo(data.clientInfo || item.clientInfo || ws.clientInfo || {});
          item.network = ws.network || item.network || {};
          room.receiverStates.set(ws.clientId, item);
          room.updatedAt = Date.now();

          void persistTransferEvent(
            room,
            ws,
            item,
            'SUCCESS'
          ).catch((error) => {
            databaseError(
              'transfer event persistence',
              error
            );
          });

          emitBroadcastStats(room);
          emitReceiverIntelligence(room);
          return;
        }

        if (data.type === 'broadcast-failed' && ws.role === 'receiver') {
          if (!room.file || data.fileId !== room.file.id) return;
          const item = room.receiverStates.get(ws.clientId) || {};
          item.failedAt = Date.now();
          item.failureReason = String(data.reason || 'download failed').slice(0, 160);
          item.latencyMs = safeMetric(data.latencyMs || item.latencyMs, 120000);
          item.downloadTimeSec = safeMetric(data.durationSec, 86400);
          item.acceptanceLatencySec = safeMetric(data.acceptanceLatencySec || item.acceptanceLatencySec, 86400);
          item.gestureConfidence = safeMetric(data.gestureConfidence || item.gestureConfidence, 1);
          item.clientInfo = sanitizeClientInfo(data.clientInfo || item.clientInfo || ws.clientInfo || {});
          item.network = ws.network || item.network || {};
          room.receiverStates.set(ws.clientId, item);
          room.updatedAt = Date.now();

          void persistTransferEvent(
            room,
            ws,
            item,
            'FAILED'
          ).catch((error) => {
            databaseError(
              'transfer event persistence',
              error
            );
          });

          emitBroadcastStats(room);
          emitReceiverIntelligence(room);
          return;
        }

        if (data.type === 'broadcast-cancel' && ws.role === 'sender' && room.host === ws) {
          deleteBroadcastFile(room);
          resetReceiverStatesForFile(room);
          room.updatedAt = Date.now();
          emitBroadcastRoom(room, { type: 'broadcast-file-cleared' });
          emitBroadcastStats(room);
        }
      }
    });

    ws.on('close', () => leaveAnyRoom(ws));
    ws.on('error', () => leaveAnyRoom(ws));
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    }
  }, 30000);
  heartbeat.unref?.();

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of broadcastRooms) {
      if (room.file && Date.parse(room.file.expiresAt) <= now) {
        deleteBroadcastFile(room);
        emitBroadcastRoom(room, { type: 'broadcast-file-cleared', reason: 'expired' });
        emitBroadcastStats(room);
      }
      const hostActive = Boolean(room.host && room.host.readyState === WebSocket.OPEN);
      if (!hostActive && room.receivers.size === 0 && now - room.updatedAt > 10 * 60 * 1000) {
        endRoomSession(room);
        deleteBroadcastFile(room);
        broadcastRooms.delete(code);
      }
    }
  }, 5 * 60 * 1000);
  cleanup.unref?.();

  server.on('close', () => {
    clearInterval(heartbeat);
    clearInterval(cleanup);

    const sessionIds = [
      ...broadcastRooms.values()
    ]
      .map((room) => room.sessionId)
      .filter(Boolean);

    for (const room of broadcastRooms.values()) {
      deleteBroadcastFile(room);
    }

    void Promise.all(
      sessionIds.map((sessionId) =>
        database.endClassSession(sessionId)
      )
    )
      .catch((error) => {
        databaseError(
          'shutdown session close',
          error
        );
      })
      .finally(() =>
        database.close().catch((error) => {
          console.error(
            'Database shutdown error:',
            error.message
          );
        })
      );
  });

  return {
    app,
    server,
    wss,
    rooms,
    broadcastRooms,
    database
  };
}

if (require.main === module) {
  const {
    server,
    database
  } = createServer();

  (async () => {
    try {
      const dbStatus =
        await database.initialize();

      server.listen(
        PORT,
        '0.0.0.0',
        () => {
          console.log(
            '\nAirGesture Transfer Intelligence v5.4.0'
          );

          console.log(
            `Local:   http://localhost:${PORT}`
          );

          console.log(
            'Mode:    Universal Room (1 Sender → N Receivers; no fixed app cap)'
          );

          console.log(
            `Database: ${
              dbStatus.ready
                ? 'PostgreSQL ready'
                : 'not configured locally'
            }`
          );

          console.log(
            'Network: use HTTPS for camera access from multiple physical devices.\n'
          );
        }
      );
    } catch (error) {
      console.error(
        'PostgreSQL initialization failed:',
        error.message
      );

      process.exit(1);
    }
  })();
}

module.exports = {
  createServer,
  analyticsSummary,
  sanitizeEvent,
  CONFIGURED_RECEIVER_LIMIT,
  MAX_BROADCAST_FILE_BYTES,
  maskIp,
  classifyIp,
  sanitizeClientInfo,
  receiverIntelligenceRecord
};
