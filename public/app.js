const $ = (id) => document.getElementById(id);
const state = {
  mode: "broadcast",
  role: "sender",
  ws: null,
  room: "",
  pc: null,
  channel: null,
  selectedFile: null,
  sending: false,
  senderWaitingAcceptance: false,
  transferRequestStart: 0,
  acceptanceLatencySec: 0,
  cancelled: false,
  transferStart: 0,
  transferTrigger: "manual",
  awaitingAck: false,
  cameraStream: null,
  recognizer: null,
  drawingUtils: null,
  visionModule: null,
  cameraRunning: false,
  aiReady: false,
  aiLoading: false,
  cameraStartToken: 0,
  animationFrameId: null,
  pendingIce: [],
  activeTransferId: null,
  ackTimer: null,
  lastVideoTime: -1,
  gestureCandidate: "",
  gestureSince: 0,
  gestureActionFired: false,
  gestureCandidateFrames: 0,
  gestureCooldownUntil: 0,
  gestureSequencePhase: "waiting-open",
  gestureSequenceExpiresAt: 0,
  gestureOpenConfidence: 0,
  pendingRequest: null,
  acceptedTransferId: null,
  received: null,
  receivedFiles: 0,

  // Universal Room (1 Sender -> N Receivers; no fixed application cap)
  broadcastHostToken: "",
  broadcastClientId: "",
  broadcastFileId: "",
  broadcastUploadInProgress: false,
  broadcastDownloadInProgress: false,
  broadcastXHR: null,
  broadcastAbortController: null,
  broadcastStats: { connected: 0, accepted: 0, completed: 0, failed: 0, waiting: 0, completionRate: 0 },
  networkLatencyMs: 0,
  lastGestureConfidence: 0,

  lastHandAnchor: {
    x: 0.5,
    y: 0.5
  },
  ownNetwork: {},
  receiverIntelligence: [],
  authUser: null,
  myTransfer: null,

  commercialConsent: {
    analyticsConsent: false,
    personalizationConsent: false,
    marketingConsent: false
  },

  commercialProfileSynced: false,

  adminDatabaseLoaded: false,
  adminDatabaseDenied: false,
  adminDatabase: null,

  charts: { trend: null, type: null }
};

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const CHUNK_SIZE = 16 * 1024; // Conservative WebRTC message size for broad browser compatibility.
const GESTURE_SEQUENCE_TIMEOUT_MS = 12000; // Very relaxed: open once, then close naturally within 12 seconds.
const GESTURE_COOLDOWN_MS = 350; // Tiny visual cooldown only; the state machine itself prevents duplicate firing.

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2600);
}

function status(message, mode = "info") {
  $("statusText").textContent = message;
  $("systemStatus").textContent = mode === "error" ? "Action Needed" : "System Ready";
}

function setBadge(el, text, tone = "neutral") {
  el.textContent = text;
  el.className = `status-badge ${tone}`;
}

function bytesToMB(bytes) {
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
}


function detectBrowser() {
  const ua = navigator.userAgent || '';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'Safari';
  return 'Other';
}

function detectOS() {
  const ua = navigator.userAgent || '';
  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  if (/Windows/i.test(platform) || /Windows NT/i.test(ua)) return 'Windows';
  if (/Mac/i.test(platform) || /Mac OS X/i.test(ua)) return 'macOS';
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS/iPadOS';
  if (/Linux/i.test(platform) || /Linux/i.test(ua)) return 'Linux';
  return 'Other';
}

function detectDeviceType() {
  const ua = navigator.userAgent || '';
  if (/iPad|Tablet/i.test(ua)) return 'Tablet';
  if (/Mobi|Android|iPhone|iPod/i.test(ua)) return 'Mobile';
  return 'Laptop/Desktop';
}

function collectClientInfo() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || {};
  return {
    browser: detectBrowser(),
    os: detectOS(),
    deviceType: detectDeviceType(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    language: navigator.language || '',
    connectionType: connection.type || '',
    effectiveType: connection.effectiveType || '',
    downlinkMbps: Number(connection.downlink) || 0,
    rttEstimateMs: Number(connection.rtt) || 0,
    screen: `${screen.width || 0}x${screen.height || 0}`,
    cpuCores: Number(navigator.hardwareConcurrency) || 0,
    memoryGB: Number(navigator.deviceMemory) || 0
  };
}


function commercialDeviceSegment(client) {
  const os =
    String(client.os || '');

  const device =
    String(client.deviceType || '');

  if (
    os === 'macOS' &&
    device === 'Laptop/Desktop'
  ) {
    return 'APPLE_DESKTOP';
  }

  if (os === 'iOS/iPadOS') {
    return 'APPLE_MOBILE';
  }

  if (
    os === 'Windows' &&
    device === 'Laptop/Desktop'
  ) {
    return 'WINDOWS_DESKTOP';
  }

  if (os === 'Android') {
    return 'ANDROID_MOBILE';
  }

  if (
    os === 'Linux' &&
    device === 'Laptop/Desktop'
  ) {
    return 'LINUX_DESKTOP';
  }

  if (device === 'Mobile') {
    return 'MOBILE_USER';
  }

  if (device === 'Tablet') {
    return 'TABLET_USER';
  }

  return 'GENERAL_DESKTOP';
}


function commercialSignals() {
  const client =
    collectClientInfo();

  const width =
    Math.max(
      Number(screen.width) || 0,
      Number(screen.height) || 0
    );

  let screenCategory =
    'UNKNOWN';

  if (width > 0 && width < 768) {
    screenCategory =
      'SMALL';
  } else if (width < 1200) {
    screenCategory =
      'MEDIUM';
  } else if (width < 1800) {
    screenCategory =
      'LARGE';
  } else if (width >= 1800) {
    screenCategory =
      'XLARGE';
  }


  const memory =
    Number(client.memoryGB) || 0;

  let memoryTier =
    'UNKNOWN';

  if (memory >= 16) {
    memoryTier = 'HIGH';
  } else if (memory >= 8) {
    memoryTier = 'STANDARD';
  } else if (memory > 0) {
    memoryTier = 'BASIC';
  }


  const cores =
    Number(client.cpuCores) || 0;

  let cpuTier =
    'UNKNOWN';

  if (cores >= 12) {
    cpuTier = 'HIGH';
  } else if (cores >= 6) {
    cpuTier = 'STANDARD';
  } else if (cores > 0) {
    cpuTier = 'BASIC';
  }


  let referrerHost = '';

  if (document.referrer) {
    try {
      referrerHost =
        new URL(
          document.referrer
        ).hostname;
    } catch {}
  }


  const params =
    new URLSearchParams(
      window.location.search
    );


  return {
    clientInfo: client,

    screenCategory,

    touchCapable:
      Number(
        navigator.maxTouchPoints
      ) > 0,

    memoryTier,

    cpuTier,

    deviceSegment:
      commercialDeviceSegment(
        client
      ),

    acquisition: {
      referrerHost,

      landingPath:
        window.location.pathname,

      utmSource:
        params.get(
          'utm_source'
        ) || '',

      utmMedium:
        params.get(
          'utm_medium'
        ) || '',

      utmCampaign:
        params.get(
          'utm_campaign'
        ) || ''
    }
  };
}


function renderCommercialConsent() {
  const consent =
    state.commercialConsent || {};

  if ($('analyticsConsent')) {
    $('analyticsConsent').checked =
      Boolean(
        consent.analyticsConsent
      );
  }

  if ($('personalizationConsent')) {
    $('personalizationConsent').checked =
      Boolean(
        consent.personalizationConsent
      );
  }

  if ($('marketingConsent')) {
    $('marketingConsent').checked =
      Boolean(
        consent.marketingConsent
      );
  }

  if ($('consentStatus')) {
    $('consentStatus').textContent =
      consent.analyticsConsent
        ? 'Commercial analytics collection enabled'
        : 'Commercial analytics collection disabled';
  }
}


async function syncCommercialProfile() {
  if (
    state.commercialProfileSynced
  ) {
    return;
  }

  try {
    const response =
      await fetch(
        '/api/commercial/profile',
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json'
          },

          body:
            JSON.stringify(
              commercialSignals()
            )
        }
      );

    if (!response.ok) {
      return;
    }

    const data =
      await response.json();

    if (data.collected) {
      state.commercialProfileSynced =
        true;

      if ($('consentStatus')) {
        $('consentStatus').textContent =
          'Commercial analytics profile active';
      }
    }
  } catch (error) {
    console.error(
      'Commercial profile sync failed:',
      error
    );
  }
}


async function loadCommercialConsent() {
  if (
    !state.authUser &&
    !window.AirGestureAuthUser
  ) {
    return;
  }

  try {
    const response =
      await fetch(
        '/api/commercial/consent',
        {
          cache: 'no-store'
        }
      );

    if (!response.ok) {
      await syncCommercialProfile();
      return;
    }

    const data =
      await response.json();

    state.commercialConsent = {
      analyticsConsent:
        Boolean(
          data.analyticsConsent
        ),

      personalizationConsent:
        Boolean(
          data.personalizationConsent
        ),

      marketingConsent:
        Boolean(
          data.marketingConsent
        )
    };

    renderCommercialConsent();

    await syncCommercialProfile();
  } catch (error) {
    console.error(
      'Could not load data preferences:',
      error
    );
  }
}


async function saveCommercialConsent() {
  const button =
    $('saveConsentBtn');

  if (button) {
    button.disabled = true;
  }

  try {
    const preferences = {
      analyticsConsent:
        Boolean(
          $('analyticsConsent')
            ?.checked
        ),

      personalizationConsent:
        Boolean(
          $('personalizationConsent')
            ?.checked
        ),

      marketingConsent:
        Boolean(
          $('marketingConsent')
            ?.checked
        )
    };

    const response =
      await fetch(
        '/api/commercial/consent',
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json'
          },

          body:
            JSON.stringify(
              preferences
            )
        }
      );

    const data =
      await response
        .json()
        .catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error ||
        'Could not save preferences.'
      );
    }

    state.commercialConsent = {
      analyticsConsent:
        Boolean(
          data.analyticsConsent
        ),

      personalizationConsent:
        Boolean(
          data.personalizationConsent
        ),

      marketingConsent:
        Boolean(
          data.marketingConsent
        )
    };

    renderCommercialConsent();

    if (
      state.commercialConsent
        .analyticsConsent
    ) {
      await syncCommercialProfile();
    }

    toast(
      'Data preferences saved'
    );
  } catch (error) {
    console.error(
      'Consent save failed:',
      error
    );

    if ($('consentStatus')) {
      $('consentStatus').textContent =
        'Could not save preferences';
    }

    toast(
      'Could not save data preferences'
    );
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}


async function measureServerLatency(samples = 3) {
  const values = [];
  for (let i = 0; i < samples; i += 1) {
    const started = performance.now();
    try {
      const response = await fetch(`/api/network/ping?t=${Date.now()}-${i}`, { cache: 'no-store' });
      if (response.ok) values.push(performance.now() - started);
    } catch {}
  }
  if (!values.length) return 0;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

function networkQuality(latencyMs, speedMbps) {
  if (speedMbps >= 15 && latencyMs > 0 && latencyMs <= 50) return 'EXCELLENT';
  if (speedMbps >= 5 && (latencyMs === 0 || latencyMs <= 120)) return 'GOOD';
  if (speedMbps > 0 || latencyMs > 0) return 'FAIR';
  return 'WAITING';
}

function renderOwnNetwork(network = {}) {
  state.ownNetwork = network || {};

  if ($('ownNetworkIp')) $('ownNetworkIp').textContent = network.maskedIp || 'Unavailable';
  if ($('ownNetworkLocation')) $('ownNetworkLocation').textContent = network.location || 'Unavailable';
  if ($('ownNetworkProvider')) $('ownNetworkProvider').textContent = network.provider || 'Unavailable';
  if ($('ownNetworkDevice')) $('ownNetworkDevice').textContent = `${detectDeviceType()} · ${detectBrowser()} · ${detectOS()}`;
  if ($('ownNetworkLatency')) $('ownNetworkLatency').textContent =
    state.networkLatencyMs ? `${state.networkLatencyMs.toFixed(1)} ms` : 'Measuring…';

  if (state.role === 'receiver') renderMyIntelligence();
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function setStatusPill(id, text, tone = 'neutral') {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = `status-badge ${tone}`;
}

function currentAuthUser() {
  const user = state.authUser || window.AirGestureAuthUser || {};

  return {
    name: String(user.name || 'Signed-in participant'),
    email: String(user.email || ''),
    picture: String(user.picture || '')
  };
}

function receiverDisplayId() {
  if (!state.broadcastClientId) return 'Not joined';

  const compact = String(state.broadcastClientId)
    .replace(/-/g, '')
    .slice(0, 6)
    .toUpperCase();

  return compact ? `RCV-${compact}` : 'Receiver';
}

function personalRecommendation(result, quality) {
  if (result === 'SUCCESS') {
    if (quality === 'EXCELLENT' || quality === 'GOOD') {
      return 'Transfer verified successfully. Your current conditions are ready for normal AirGesture use.';
    }

    return 'Transfer succeeded, but network performance could be improved for a faster experience.';
  }

  if (result === 'FAILED') {
    return 'Retry Air Paste. If the problem continues, change network conditions or reconnect to the room.';
  }

  if (result === 'CANCELLED') {
    return 'The transfer was cancelled. Air Paste again when you are ready.';
  }

  if (result === 'RECEIVING') {
    return 'Keep this tab open until byte-count and SHA-256 verification complete.';
  }

  if (result === 'READY') {
    return 'The Sender file is ready. Use ✋ → ✊ or the Air Paste button to receive it.';
  }

  return 'Join the Sender room and complete an Air Paste to generate your evidence.';
}

function renderMyIntelligence() {
  if (state.role !== 'receiver') return;

  const user = currentAuthUser();
  const network = state.ownNetwork || {};
  const transfer = state.myTransfer || {};
  const client = collectClientInfo();

  const latencyMs =
    Number(transfer.latencyMs) ||
    Number(state.networkLatencyMs) ||
    0;

  const speedMbps = Number(transfer.speedMbps) || 0;
  const quality = networkQuality(latencyMs, speedMbps);

  const result =
    transfer.result ||
    (state.pendingRequest ? 'READY' : 'WAITING');

  const transferSize =
    Number(transfer.fileSize) ||
    Number(state.pendingRequest?.size) ||
    0;

  const transferName =
    transfer.fileName ||
    state.pendingRequest?.name ||
    'Waiting for Sender';

  const gestureConfidence =
    Number(transfer.gestureConfidence) ||
    Number(state.lastGestureConfidence) ||
    0;

  const trigger = transfer.trigger || '';

  setText('myIdentityName', user.name);
  setText('myIdentityEmail', user.email || 'Google account');
  setText('myReceiverId', receiverDisplayId());
  setText('myRoomCode', state.room || 'Not joined');

  const picture = $('myProfilePicture');
  if (picture) {
    if (user.picture) {
      picture.src = user.picture;
      picture.hidden = false;
    } else {
      picture.hidden = true;
    }
  }

  setText(
    'myDevice',
    `${client.deviceType} · ${client.browser} · ${client.os}`
  );

  setText('myMaskedIp', network.maskedIp || 'Unavailable');
  setText('myLocation', network.location || 'Unavailable');
  setText('myProvider', network.provider || 'Unavailable');
  setText(
    'myLatency',
    latencyMs ? `${latencyMs.toFixed(1)} ms` : 'Measuring…'
  );

  setText('myTransferFile', transferName);
  setText('myTransferSize', transferSize ? formatBytes(transferSize) : '--');
  setText(
    'myTransferSpeed',
    speedMbps ? `${speedMbps.toFixed(2)} Mbps` : '--'
  );
  setText(
    'myTransferDuration',
    Number(transfer.durationSec)
      ? `${Number(transfer.durationSec).toFixed(2)} s`
      : '--'
  );

  setText(
    'myTransferIntegrity',
    transfer.integrityVerified === true
      ? 'SHA-256 VERIFIED'
      : result === 'FAILED'
        ? 'NOT VERIFIED'
        : 'WAITING'
  );

  setText(
    'myGestureAction',
    trigger === 'gesture'
      ? 'Air Paste · Gesture'
      : trigger === 'manual'
        ? 'Air Paste · Manual'
        : 'Waiting for Air Paste'
  );

  setText(
    'myGestureConfidence',
    trigger === 'gesture' && gestureConfidence
      ? `${(gestureConfidence * 100).toFixed(1)}%`
      : trigger === 'manual'
        ? 'Manual control'
        : '--'
  );

  setText('myNetworkQuality', quality);

  const dataQuality =
    result === 'SUCCESS' && transfer.integrityVerified
      ? 'COMPLETE'
      : result === 'FAILED'
        ? 'ATTENTION'
        : result === 'CANCELLED'
          ? 'INCOMPLETE'
          : result === 'RECEIVING' || result === 'READY'
            ? 'COLLECTING'
            : 'WAITING';

  setText('myDataQuality', dataQuality);

  if (result === 'SUCCESS') {
    setText(
      'myDescriptiveInsight',
      `${transferName} was received in ${
        Number(transfer.durationSec || 0).toFixed(2)
      } s at ${
        speedMbps.toFixed(2)
      } Mbps with SHA-256 integrity verified.`
    );
  } else if (result === 'FAILED') {
    setText(
      'myDescriptiveInsight',
      `Your transfer failed${
        transfer.failureReason ? `: ${transfer.failureReason}` : '.'
      }`
    );
  } else if (result === 'RECEIVING') {
    setText(
      'myDescriptiveInsight',
      `${transferName} is currently being received and verified.`
    );
  } else if (result === 'READY') {
    setText(
      'myDescriptiveInsight',
      `${transferName} is available from the Sender and waiting for your Air Paste.`
    );
  } else {
    setText(
      'myDescriptiveInsight',
      'Complete an Air Paste to generate your personal transfer evidence.'
    );
  }

  setText(
    'myRecommendation',
    personalRecommendation(result, quality)
  );

  const tone =
    result === 'SUCCESS'
      ? 'good'
      : result === 'FAILED'
        ? 'warn'
        : result === 'RECEIVING' || result === 'READY'
          ? 'warn'
          : 'neutral';

  setStatusPill('myTransferResult', result, tone);
}

function renderRoleIntelligence() {
  const isReceiver = state.role === 'receiver';

  if ($('myIntelligencePanel')) {
    $('myIntelligencePanel').hidden = !isReceiver;
  }

  if ($('senderIntelligencePanel')) {
    $('senderIntelligencePanel').hidden = isReceiver;
  }

  // Receiver does not need classroom-wide completion counters.
  if ($('broadcastStatsPanel')) {
    $('broadcastStatsPanel').hidden = isReceiver;
  }

  document.body.classList.toggle('receiver-role', isReceiver);
  document.body.classList.toggle('sender-role', !isReceiver);

  if (isReceiver) renderMyIntelligence();
}

function renderReceiverIntelligence(receivers = []) {
  state.receiverIntelligence = Array.isArray(receivers) ? receivers : [];
  const body = $('receiverIntelligenceBody');
  const count = $('receiverIntelligenceCount');
  if (count) count.textContent = String(state.receiverIntelligence.length);
  if (!body) return;
  if (!state.receiverIntelligence.length) {
    body.innerHTML = '<tr><td colspan="10" class="table-empty">No authenticated receiver evidence yet.</td></tr>';
    return;
  }
  body.innerHTML = '';
  for (const row of state.receiverIntelligence) {
    const tr = document.createElement('tr');
    const quality = networkQuality(Number(row.latencyMs) || Number(row.browserRttMs) || 0, Number(row.transferSpeedMbps) || 0);
    const result = row.result || 'WAITING';

    const participant = row.participantEmail
      ? `${row.participantName || 'Signed-in participant'} · ${row.participantEmail}`
      : (row.participantName || 'Signed-in participant');

    const values = [
      participant,
      row.receiverId || 'Receiver',
      row.maskedIp || 'Unavailable',
      row.location || 'Unavailable',
      row.provider || 'Unavailable',
      `${row.deviceType || 'Unknown'} · ${row.browser || 'Unknown'} / ${row.os || 'Unknown'}`,
      row.latencyMs ? `${Number(row.latencyMs).toFixed(1)} ms` : row.browserRttMs ? `~${Number(row.browserRttMs).toFixed(0)} ms` : '--',
      row.transferSpeedMbps ? `${Number(row.transferSpeedMbps).toFixed(1)} Mbps` : '--',
      quality,
      result
    ];
    values.forEach((value, index) => {
      const td = document.createElement('td');
      td.textContent = value;
      if (index === 9) td.className = `network-result ${String(result).toLowerCase()}`;
      tr.appendChild(td);
    });
    body.appendChild(tr);
  }
}

function fileType(file) {
  const mime = file?.type || "";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "pdf";
  if (mime.includes("word") || mime.includes("document") || /\.(docx?|txt|rtf)$/i.test(file?.name || "")) return "document";
  if (mime.includes("sheet") || /\.(xlsx?|csv)$/i.test(file?.name || "")) return "spreadsheet";
  return "other";
}

function randomRoom() {
  const words = ["NOVA", "PULSE", "NEXUS", "ORBIT", "VISION", "VECTOR", "AERO", "QUANT"];
  return `${words[Math.floor(Math.random() * words.length)]}-${Math.floor(100 + Math.random() * 900)}`;
}

function setProgress(percent, speed = 0) {
  const safe = Math.max(0, Math.min(100, Number(percent) || 0));
  $("transferProgress").style.width = `${safe}%`;
  $("progressLabel").textContent = `${Math.round(safe)}%`;
  $("speedLabel").textContent = `${speed ? speed.toFixed(1) : "0"} Mbps`;
}

function setTransferState(value) {
  $("transferState").textContent = value.toUpperCase();
}

function updateActionButtons() {
  const isSender = state.role === "sender";

  $("copyBtn").style.display = isSender ? "block" : "none";
  $("pasteBtn").style.display = isSender ? "none" : "block";

  if (state.mode === "broadcast") {
    const roomReady = Boolean(state.ws && state.ws.readyState === WebSocket.OPEN && state.room);
    $("copyBtn").disabled = !isSender || !state.selectedFile || !roomReady || !state.broadcastHostToken || state.broadcastUploadInProgress;
    $("pasteBtn").disabled = isSender || !state.pendingRequest || !roomReady || state.broadcastDownloadInProgress;
    $("cancelBtn").disabled = isSender
      ? !(state.broadcastFileId || state.broadcastUploadInProgress)
      : !(state.pendingRequest || state.broadcastDownloadInProgress);
    return;
  }

  const channelReady = Boolean(state.channel && state.channel.readyState === "open");
  const senderBusy = state.sending || state.senderWaitingAcceptance || state.awaitingAck;
  const receiverBusy = Boolean(state.acceptedTransferId || state.received);
  $("copyBtn").disabled = !isSender || !state.selectedFile || !channelReady || senderBusy;
  $("pasteBtn").disabled = isSender || !state.pendingRequest || !channelReady || receiverBusy;
  $("cancelBtn").disabled = isSender
    ? !(state.senderWaitingAcceptance || state.sending || state.awaitingAck)
    : !(state.pendingRequest || state.acceptedTransferId || state.received);
}

function gestureExperienceFile() {
  if (state.role === 'sender') {
    return state.selectedFile
      ? {
          name:
            state.selectedFile.name,

          type:
            state.selectedFile.type || '',

          size:
            state.selectedFile.size || 0
        }
      : null;
  }

  return state.pendingRequest
    ? {
        name:
          state.pendingRequest.name,

        type:
          state.pendingRequest.mime || '',

        size:
          state.pendingRequest.size || 0
      }
    : null;
}


function gestureFileIcon(file = {}) {
  const type =
    String(
      file.type || ''
    ).toLowerCase();

  const name =
    String(
      file.name || ''
    ).toLowerCase();

  if (
    type.startsWith('image/') ||
    /\.(png|jpg|jpeg|gif|webp|heic)$/i.test(
      name
    )
  ) {
    return '🖼️';
  }

  if (
    type.startsWith('video/') ||
    /\.(mp4|mov|webm)$/i.test(
      name
    )
  ) {
    return '🎬';
  }

  if (
    type === 'application/pdf' ||
    name.endsWith('.pdf')
  ) {
    return '📕';
  }

  return '📄';
}


function setGestureExperience(
  mode,
  title,
  hint,
  hand
) {
  const root =
    $('gestureExperience');

  if (!root) return;

  root.className =
    `gesture-experience ${mode}`;

  setText(
    'gestureExperienceTitle',
    title
  );

  setText(
    'gestureExperienceHint',
    hint
  );

  setText(
    'gestureExperienceHand',
    hand
  );

  const file =
    gestureExperienceFile();

  setText(
    'gestureFileName',
    file?.name ||
      (
        state.role === 'sender'
          ? 'No file selected'
          : 'Waiting for Sender'
      )
  );

  setText(
    'gestureFileLabel',
    file?.size
      ? formatBytes(
          Number(file.size)
        )
      : 'AIR FILE'
  );

  setText(
    'gestureFileIcon',
    gestureFileIcon(
      file || {}
    )
  );
}


function syncGestureExperience() {
  if (
    state.role === 'receiver'
  ) {
    if (state.pendingRequest) {
      setGestureExperience(
        'incoming',
        'INCOMING AIR FILE',
        'Make a fist ✊ to catch the file.',
        '✊'
      );
    } else {
      setGestureExperience(
        'waiting',
        'WAITING FOR FILE',
        'Stay connected. The screen will pulse when a file arrives.',
        '✋'
      );
    }

    return;
  }


  if (state.selectedFile) {
    setGestureExperience(
      'ready',
      'READY TO GRAB',
      'Show your open palm ✋, then close your fist.',
      '✋'
    );
  } else {
    setGestureExperience(
      'idle',
      'CHOOSE A FILE',
      'Select a file, connect the room and start Vision AI.',
      '✋'
    );
  }
}


function updateGestureHandAnchor(
  landmarks = []
) {
  if (!landmarks.length) return;

  const average =
    landmarks.reduce(
      (result, point) => ({
        x:
          result.x +
          Number(point.x || 0),

        y:
          result.y +
          Number(point.y || 0)
      }),
      {
        x: 0,
        y: 0
      }
    );

  const count =
    landmarks.length || 1;

  state.lastHandAnchor = {
    // Front-facing webcam feels natural
    // when the interaction follows the mirror.
    x:
      Math.max(
        0,
        Math.min(
          1,
          1 -
            average.x /
              count
        )
      ),

    y:
      Math.max(
        0,
        Math.min(
          1,
          average.y /
            count
        )
      )
  };


  const root =
    $('gestureExperience');

  if (!root) return;

  root.style.setProperty(
    '--hand-x',
    `${
      state.lastHandAnchor.x *
      100
    }%`
  );

  root.style.setProperty(
    '--hand-y',
    `${
      state.lastHandAnchor.y *
      100
    }%`
  );
}


function animateAirFile(
  direction = 'grab'
) {
  const card =
    $('gestureFileCard');

  const stage =
    card?.closest(
      '.camera-stage'
    );

  if (
    !card ||
    !stage ||
    typeof card.animate !==
      'function'
  ) {
    return Promise.resolve();
  }

  const stageRect =
    stage.getBoundingClientRect();

  const cardRect =
    card.getBoundingClientRect();

  const anchor =
    state.lastHandAnchor || {
      x: 0.5,
      y: 0.5
    };

  const targetX =
    stageRect.left +
    stageRect.width *
      anchor.x;

  const targetY =
    stageRect.top +
    stageRect.height *
      anchor.y;

  const cardX =
    cardRect.left +
    cardRect.width / 2;

  const cardY =
    cardRect.top +
    cardRect.height / 2;

  const dx =
    targetX - cardX;

  const dy =
    targetY - cardY;


  const grabFrames = [
    {
      transform:
        'translate(0, 0) scale(1)',
      opacity: 1,
      filter:
        'blur(0px)'
    },

    {
      transform:
        `translate(${dx * 0.65}px, ${dy * 0.65}px) scale(.45)`,
      opacity: 0.9,
      filter:
        'blur(0px)',
      offset: 0.72
    },

    {
      transform:
        `translate(${dx}px, ${dy}px) scale(.05)`,
      opacity: 0,
      filter:
        'blur(3px)'
    }
  ];


  const releaseFrames = [
    {
      transform:
        `translate(${dx}px, ${dy}px) scale(.05)`,
      opacity: 0,
      filter:
        'blur(3px)'
    },

    {
      transform:
        `translate(${dx * 0.42}px, ${dy * 0.42}px) scale(.58)`,
      opacity: 0.9,
      filter:
        'blur(0px)',
      offset: 0.55
    },

    {
      transform:
        'translate(0, 0) scale(1)',
      opacity: 1,
      filter:
        'blur(0px)'
    }
  ];


  const animation =
    card.animate(
      direction === 'release'
        ? releaseFrames
        : grabFrames,
      {
        duration: 560,

        easing:
          'cubic-bezier(.2,.8,.2,1)',

        fill:
          'both'
      }
    );


  return new Promise(
    (resolve) => {
      const done = () => {
        try {
          animation.cancel();
        } catch {}

        resolve();
      };

      animation.addEventListener(
        'finish',
        done,
        {
          once: true
        }
      );

      animation.addEventListener(
        'cancel',
        resolve,
        {
          once: true
        }
      );
    }
  );
}


async function playGestureSuccessAnimation(
  role
) {
  if (role === 'sender') {

    setGestureExperience(
      'grabbed',
      'COPIED',
      'File grabbed. Sending through AirGesture…',
      '✊'
    );

    await animateAirFile(
      'grab'
    );

    return;
  }


  setGestureExperience(
    'released',
    'RELEASED',
    'File released from your hand. Receiving now…',
    '✋'
  );

  await animateAirFile(
    'release'
  );
}


function resetGestureSequence() {
  state.gestureSequencePhase =
    state.role === 'receiver'
      ? 'waiting-fist'
      : 'waiting-open';

  state.gestureSequenceExpiresAt =
    0;

  state.gestureOpenConfidence =
    0;
}

function renderRoleFilePanel() {
  const broadcast = state.mode === "broadcast";

  if (state.role === "sender") {
    $("dropZone").style.opacity = "1";
    $("dropZone").style.pointerEvents = "auto";
    if (state.selectedFile) {
      $("fileTitle").textContent = state.selectedFile.name;
      $("fileMeta").textContent = `${formatBytes(state.selectedFile.size)} · ${state.selectedFile.type || "unknown type"}`;
    } else {
      $("fileTitle").textContent = broadcast ? "Choose a file to Air Send" : "Choose a file to Air Copy";
      $("fileMeta").textContent = broadcast
        ? "Upload once · up to 100 MB · distribute to all receivers in the room"
        : "Click or drag & drop · up to 100 MB";
    }
  } else {
    $("dropZone").style.opacity = ".75";
    $("dropZone").style.pointerEvents = "none";
    if (state.pendingRequest) {
      $("fileTitle").textContent = `Incoming: ${state.pendingRequest.name}`;
      $("fileMeta").textContent = `${formatBytes(state.pendingRequest.size)} · show ✊ → ✋ to Air Paste`;
    } else {
      $("fileTitle").textContent = broadcast ? "Waiting for the universal room file" : "Waiting for an incoming Air Copy";
      $("fileMeta").textContent = broadcast
        ? "Join the Sender's universal room and wait for the file"
        : "Connect to the Sender room, then start Vision AI";
    }
  }
}


function renderBroadcastStats(stats = {}) {
  state.broadcastStats = {
    connected: Number(stats.connected) || 0,
    accepted: Number(stats.accepted) || 0,
    completed: Number(stats.completed) || 0,
    failed: Number(stats.failed) || 0,
    waiting: Number(stats.waiting) || 0,
    completionRate: Number(stats.completionRate) || 0
  };

  $("broadcastConnected").textContent = String(state.broadcastStats.connected);
  $("broadcastAccepted").textContent = String(state.broadcastStats.accepted);
  $("broadcastCompleted").textContent = String(state.broadcastStats.completed);
  $("broadcastWaiting").textContent = String(state.broadcastStats.waiting);
  $("broadcastFailed").textContent = String(state.broadcastStats.failed);
  $("broadcastCompletion").textContent = `${state.broadcastStats.completionRate.toFixed(1)}%`;
}

function resetBroadcastState({ keepStats = false } = {}) {
  state.broadcastHostToken = "";
  state.broadcastClientId = "";
  state.broadcastFileId = "";
  state.broadcastUploadInProgress = false;
  state.broadcastDownloadInProgress = false;
  state.broadcastXHR = null;
  state.broadcastAbortController = null;
  if (!keepStats) renderBroadcastStats({});
}

function setMode() {
  // V5.1 uses one universal distribution workflow only.
  // Internally the proven server-assisted broadcast transport remains the implementation.
  state.mode = "broadcast";
  $("connectionTitle").textContent = "Universal Room";
  $("connectionKicker").textContent = "02 · UNIVERSAL CONNECTION";
  $("broadcastStatsPanel").hidden = state.role === "receiver";
  $("modeHint").textContent = "1 Sender uploads once · Receivers join the same room code · no fixed application participant cap.";

  resetGestureSequence();
  renderRoleFilePanel();
  syncGestureExperience();
  updateActionButtons();
  status(state.role === "sender"
    ? "Sender ready. Join a universal room, choose a file, then show ✋ → ✊ to Air Send it to every connected Receiver."
    : "Receiver ready. Join the Sender's universal room, start Vision AI, and wait for the incoming file.");
}

function setRole(role) {
  if (!["sender", "receiver"].includes(role)) return;
  const changed = state.role !== role;
  state.role = role;
  document.querySelectorAll(".role-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.role === role));

  if (changed) state.myTransfer = null;
  renderRoleIntelligence();

  if (changed && state.ws?.readyState === WebSocket.OPEN) {
    try { state.ws.close(); } catch {}
    state.ws = null;
    closePeerConnection();
    resetBroadcastState();
    state.pendingRequest = null;
    state.acceptedTransferId = null;
    state.received = null;
    setBadge($("peerBadge"), "Disconnected", "neutral");
  }

  resetGestureSequence();
  renderRoleFilePanel();
  syncGestureExperience();
  $("startCameraBtn").disabled = state.cameraRunning || state.aiLoading;
  $("stopCameraBtn").disabled = !state.cameraRunning;

  if (state.mode === "broadcast") {
    status(role === "sender"
      ? "Sender ready. Join the universal room, choose a file, then show ✋ → ✊ to Air Send."
      : "Receiver ready. Join the universal room, start Vision AI, and wait for the Sender file.");
  } else {
    status(role === "sender"
      ? "Sender ready. Choose a file, connect the Receiver, then show ✋ Open Hand → ✊ Closed Fist to Air Copy."
      : "Receiver ready. Connect to the same room, start Vision AI, then use ✊ Closed Fist → ✋ Open Hand when an incoming file appears.");
  }
  updateActionButtons();
}

function selectFile(file) {
  if (!file) return;
  if (file.size > MAX_FILE_SIZE) {
    toast("For this classroom build, select a file smaller than 100 MB.");
    return;
  }
  state.selectedFile = file;

  syncGestureExperience();
  $("fileTitle").textContent = file.name;
  $("fileMeta").textContent = `${formatBytes(file.size)} · ${file.type || "unknown type"}`;
  state.senderWaitingAcceptance = false;
  state.activeTransferId = null;
  setTransferState("file selected");
  setProgress(0);
  updateActionButtons();
  status(state.mode === "broadcast"
    ? `File selected: ${file.name}. Show ✋ → ✊ to upload it once for all connected receivers, or use Air Copy.`
    : `File selected: ${file.name}. Show ✋ Open Hand → ✊ Closed Fist to Air Copy, or use the manual Air Copy button.`);
}

async function logEvent(payload) {
  try {
    await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.warn("Analytics event not recorded:", error);
  }
}

function webSocketURL() {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
}


function connectRoom() {
  return connectBroadcastRoom();
}

function applyBroadcastFile(file) {
  if (!file) {
    state.broadcastFileId = "";
    state.pendingRequest = null;
    renderRoleFilePanel();
    syncGestureExperience();
    return;
  }

  state.broadcastFileId = file.id || "";
  if (state.role === "receiver") {
    state.pendingRequest = {
      transferId: file.id,
      fileId: file.id,
      name: String(file.name || "broadcast-file").slice(0, 180),
      size: Number(file.size) || 0,
      mime: file.mime || "application/octet-stream",
      sha256: file.sha256 || "",
      requestedAt: performance.now()
    };

    state.myTransfer = {
      result: 'READY',
      fileName: state.pendingRequest.name,
      fileSize: state.pendingRequest.size,
      latencyMs: state.networkLatencyMs,
      integrityVerified: false
    };

    renderRoleFilePanel();
    renderMyIntelligence();

    resetGestureSequence();
    syncGestureExperience();

    setTransferState("incoming broadcast");
    setProgress(0);

    status(
      `Incoming Air File: ${state.pendingRequest.name}. Make a fist ✊ to catch it, then open your hand ✋ to receive.`
    );

    toast(
      "Incoming Air File — make a fist ✊"
    );
  }
}

function connectBroadcastRoom() {
  const room = $("roomInput").value.trim().toUpperCase();
  if (!room) return toast("Enter or generate a room code first.");
  if (!window.AirGestureCore?.isValidRoom(room)) return toast("Room code may contain only letters, numbers, and hyphens.");

  if (state.ws) {
    try { state.ws.close(); } catch {}
  }
  state.ws = null;
  closePeerConnection();
  resetBroadcastState();
  state.pendingRequest = null;
  state.room = room;
  setBadge($("peerBadge"), "Joining Room…", "warn");
  status(`Joining universal room ${room} as ${state.role === "sender" ? "Sender/Host" : "Receiver"}…`);

  const ws = new WebSocket(webSocketURL());
  state.ws = ws;

  ws.onopen = async () => {
    state.networkLatencyMs = await measureServerLatency();
    ws.send(JSON.stringify({ type: "join", room, role: state.role, mode: "universal", clientInfo: collectClientInfo() }));
  };

  ws.onmessage = async (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    if (msg.type === "broadcast-joined") {
      state.broadcastClientId = msg.clientId || "";
      if (state.role === "sender") state.broadcastHostToken = msg.hostToken || "";
      renderOwnNetwork(msg.network || {});
      renderBroadcastStats(msg.stats || {});
      applyBroadcastFile(msg.file);
      renderRoleIntelligence();
      setBadge($("peerBadge"), state.role === "sender" ? "Sender Ready" : "Room Joined", "good");
      status(state.role === "sender"
        ? `Universal room ${msg.room} ready. ${msg.stats?.connected || 0} receiver(s) connected. Choose a file and use ✋ → ✊ to Air Send.`
        : `Joined universal room ${msg.room}. Waiting for the Sender file.`);
      updateActionButtons();
      return;
    }

    if (msg.type === "receiver-intelligence") {
      renderReceiverIntelligence(msg.receivers || []);
      return;
    }

    if (msg.type === "broadcast-stats") {
      renderBroadcastStats(msg.stats || {});
      if (state.role === "sender" && state.broadcastFileId) {
        const s = state.broadcastStats;
        status(`Broadcast live: ${s.connected} connected · ${s.accepted} accepted · ${s.completed} completed · ${s.failed} failed.`);
      }
      return;
    }

    if (msg.type === "broadcast-file-ready") {
      renderBroadcastStats(msg.stats || {});
      applyBroadcastFile(msg.file);
      if (state.role === "sender") {
        setTransferState("waiting receivers");
        status(`File uploaded once. ${state.broadcastStats.connected} receiver(s) can now use ✊ → ✋ to Air Paste.`);
      }
      updateActionButtons();
      return;
    }

    if (msg.type === "broadcast-file-cleared") {
      state.broadcastFileId = "";
      state.pendingRequest = null;
      state.broadcastDownloadInProgress = false;
      renderRoleFilePanel();
      setTransferState("idle");
      setProgress(0);
      status(msg.reason === "expired" ? "Broadcast file expired. Ask the Sender to broadcast it again." : "Broadcast file was cleared.");
      updateActionButtons();
      return;
    }

    if (msg.type === "broadcast-host-left") {
      setBadge($("peerBadge"), "Host Left", "warn");
      status("The Sender left the room. The current file may remain available temporarily.", "error");
      return;
    }

    if (msg.type === "error") {
      setBadge($("peerBadge"), "Room Error", "warn");
      status(msg.message, "error");
      toast(msg.message);
    }
  };

  ws.onerror = () => {
    setBadge($("peerBadge"), "Server Error", "warn");
    status("Could not connect to the universal room server.", "error");
  };

  ws.onclose = () => {
    if (state.ws === ws) {
      setBadge($("peerBadge"), "Disconnected", "neutral");
      updateActionButtons();
    }
  };
}

function connectPeerRoom() {
  const room = $('roomInput').value.trim().toUpperCase();
  if (!room) return toast('Enter or generate a room code first.');
  if (!window.AirGestureCore?.isValidRoom(room)) return toast('Room code may contain only letters, numbers, and hyphens.');

  if (state.ws) {
    try { state.ws.close(); } catch {}
  }
  closePeerConnection();
  state.room = room;
  setBadge($('peerBadge'), 'Connecting…', 'warn');
  status(`Connecting as ${state.role} to room ${room}…`);

  const ws = new WebSocket(webSocketURL());
  state.ws = ws;

  ws.onopen = () => ws.send(JSON.stringify({ type: 'join', room, role: state.role, mode: 'peer' }));
  ws.onmessage = async (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    try {
      if (msg.type === 'joined') {
        setBadge($('peerBadge'), msg.peers === 2 ? 'Peer Found' : 'Waiting for Peer', msg.peers === 2 ? 'good' : 'warn');
        status(`Joined room ${msg.room} as ${msg.role}. ${msg.peers === 1 ? 'Waiting for the opposite role.' : 'Peer detected.'}`);
      }
      if (msg.type === 'peer-ready' && msg.peers === 2) {
        setBadge($('peerBadge'), 'Negotiating P2P', 'warn');
        if (state.role === 'sender' && !state.pc) await createOffer();
      }
      if (msg.type === 'offer' && state.role === 'receiver') await receiveOffer(msg.sdp);
      if (msg.type === 'answer' && state.pc) {
        await state.pc.setRemoteDescription(msg.sdp);
        await flushPendingIce();
      }
      if (msg.type === 'ice' && msg.candidate) await acceptIceCandidate(msg.candidate);
      if (msg.type === 'peer-left') {
        setBadge($('peerBadge'), 'Peer Left', 'warn');
        status('The other peer disconnected. Reconnect the room to continue.', 'error');
        closePeerConnection();
      }
      if (msg.type === 'error') {
        setBadge($('peerBadge'), 'Room Error', 'warn');
        status(msg.message, 'error');
        toast(msg.message);
      }
    } catch (error) {
      console.error('Signaling error:', error);
      setBadge($('peerBadge'), 'Negotiation Error', 'warn');
      status('Peer negotiation failed. Disconnect and reconnect both tabs/devices.', 'error');
    }
  };
  ws.onerror = () => {
    setBadge($('peerBadge'), 'Server Error', 'warn');
    status('Could not connect to the signaling server.', 'error');
  };
  ws.onclose = () => {
    if (state.ws === ws && !state.pc) setBadge($('peerBadge'), 'Disconnected', 'neutral');
  };
}

async function acceptIceCandidate(candidate) {
  if (!state.pc) {
    state.pendingIce.push(candidate);
    return;
  }
  if (!state.pc.remoteDescription) {
    state.pendingIce.push(candidate);
    return;
  }
  try {
    await state.pc.addIceCandidate(candidate);
  } catch (error) {
    console.warn('ICE candidate rejected:', error);
  }
}

async function flushPendingIce() {
  if (!state.pc?.remoteDescription || !state.pendingIce.length) return;
  const pending = state.pendingIce.splice(0);
  for (const candidate of pending) await acceptIceCandidate(candidate);
}

function sendSignal(message) {
  if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(message));
}

function buildPeerConnection() {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });
  state.pc = pc;
  state.pendingIce = [];
  pc.onicecandidate = (event) => event.candidate && sendSignal({ type: 'ice', candidate: event.candidate });
  pc.onconnectionstatechange = () => {
    const current = pc.connectionState;
    if (current === 'connected') {
      setBadge($('peerBadge'), 'P2P Ready', 'good');
      status(state.role === 'sender'
        ? 'Encrypted peer-to-peer channel ready. Choose and arm a file.'
        : 'Encrypted peer-to-peer channel ready. Waiting for a file.');
    } else if (current === 'failed') {
      setBadge($('peerBadge'), 'P2P Failed', 'warn');
      status('Direct peer connection failed. Reconnect; strict networks may require a TURN server.', 'error');
    } else if (current === 'disconnected') {
      setBadge($('peerBadge'), 'Reconnecting…', 'warn');
    } else if (current === 'closed') {
      setBadge($('peerBadge'), 'Disconnected', 'neutral');
    }
    updateActionButtons();
  };
  pc.ondatachannel = (event) => configureDataChannel(event.channel);
  return pc;
}

async function createOffer() {
  closePeerConnection();
  const pc = buildPeerConnection();
  configureDataChannel(pc.createDataChannel('airgesture-file', { ordered: true }));
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  sendSignal({ type: 'offer', sdp: pc.localDescription });
}

async function receiveOffer(sdp) {
  // ICE can arrive before the offer because gathering may begin during setLocalDescription().
  // Preserve those early candidates across peer-connection initialization.
  const earlyIce = state.pendingIce.splice(0);
  closePeerConnection();
  const pc = buildPeerConnection();
  state.pendingIce.push(...earlyIce);
  await pc.setRemoteDescription(sdp);
  await flushPendingIce();
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  sendSignal({ type: 'answer', sdp: pc.localDescription });
}

function closePeerConnection() {
  clearTimeout(state.ackTimer);
  state.ackTimer = null;
  state.awaitingAck = false;
  try { state.channel?.close(); } catch {}
  try { state.pc?.close(); } catch {}
  state.channel = null;
  state.pc = null;
  state.pendingIce = [];
  updateActionButtons();
}

function configureDataChannel(channel) {
  state.channel = channel;
  channel.binaryType = "arraybuffer";
  channel.bufferedAmountLowThreshold = 512 * 1024;
  channel.onopen = () => {
    setBadge($("peerBadge"), "P2P Ready", "good");
    status(state.role === "sender" ? "P2P ready. Choose a file and show ✋ → ✊ to Air Copy." : "P2P ready. Start Vision AI and wait for an incoming Air Copy.");
    updateActionButtons();
  };
  channel.onclose = () => {
    setBadge($("peerBadge"), "Channel Closed", "warn");
    updateActionButtons();
  };
  channel.onerror = () => status("A peer-to-peer channel error occurred.", "error");
  channel.onmessage = handleDataMessage;
}

async function handleDataMessage(event) {
  if (typeof event.data === "string") {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    if (msg.type === "transfer-request") {
      if (state.role !== "receiver") return;
      if (!msg.transferId || !Number.isFinite(msg.size) || msg.size < 0 || msg.size > MAX_FILE_SIZE) {
        state.channel?.send(JSON.stringify({ type: "nack", transferId: msg.transferId || null, reason: "Invalid transfer request" }));
        return;
      }
      if (state.received || state.acceptedTransferId) {
        state.channel?.send(JSON.stringify({ type: "nack", transferId: msg.transferId, reason: "Receiver is busy" }));
        return;
      }
      state.pendingRequest = {
        transferId: msg.transferId,
        name: String(msg.name || "received-file").slice(0, 180),
        size: msg.size,
        mime: msg.mime || "application/octet-stream",
        fileType: msg.fileType || "other",
        requestedAt: performance.now()
      };
      renderRoleFilePanel();
      setTransferState("incoming request");
      setProgress(0);
      status(`Incoming ${state.pendingRequest.name}. Show ✋ Open Hand → ✊ Closed Fist to Air Paste and accept.`);
      updateActionButtons();
      toast("Incoming Air Copy — use ✋ → ✊ to accept");
      return;
    }

    if (msg.type === "transfer-accept") {
      if (state.role !== "sender" || !state.senderWaitingAcceptance || msg.transferId !== state.activeTransferId) return;
      state.senderWaitingAcceptance = false;
      state.acceptanceLatencySec = state.transferRequestStart ? Math.round(((performance.now() - state.transferRequestStart) / 1000) * 100) / 100 : 0;
      status("Receiver Air Paste confirmed. Starting encrypted peer-to-peer transfer…");
      updateActionButtons();
      await sendFilePayload();
      return;
    }

    if (msg.type === "meta") {
      if (state.role !== "receiver") return;
      if (!state.acceptedTransferId || msg.transferId !== state.acceptedTransferId) {
        state.channel?.send(JSON.stringify({ type: "nack", transferId: msg.transferId || null, reason: "Transfer was not accepted by receiver" }));
        return;
      }
      if (!msg.transferId || !Number.isFinite(msg.size) || msg.size < 0 || msg.size > MAX_FILE_SIZE) {
        state.channel?.send(JSON.stringify({ type: "nack", transferId: msg.transferId || null, reason: "Invalid transfer metadata" }));
        return;
      }
      state.received = {
        transferId: msg.transferId,
        name: String(msg.name || "received-file").slice(0, 180),
        size: msg.size,
        mime: msg.mime || "application/octet-stream",
        chunks: [],
        received: 0,
        started: performance.now()
      };
      state.pendingRequest = null;
      renderRoleFilePanel();
      setTransferState("receiving");
      setProgress(0);
      status(`Air Paste accepted. Receiving ${state.received.name}…`);
      updateActionButtons();
      return;
    }

    if (msg.type === "end" && state.received) {
      const item = state.received;
      if (msg.transferId !== item.transferId) return;
      const complete = item.received === item.size;
      if (!complete) {
        state.channel?.send(JSON.stringify({ type: "nack", transferId: item.transferId, reason: `Size mismatch: expected ${item.size}, received ${item.received}` }));
        state.received = null;
        state.acceptedTransferId = null;
        setTransferState("failed");
        status("Transfer verification failed because the received byte count did not match.", "error");
        updateActionButtons();
        toast("File verification failed");
        return;
      }

      const blob = new Blob(item.chunks, { type: item.mime });
      if (blob.size !== item.size) {
        state.channel?.send(JSON.stringify({ type: "nack", transferId: item.transferId, reason: "Blob size mismatch" }));
        state.received = null;
        state.acceptedTransferId = null;
        setTransferState("failed");
        status("Transfer verification failed after file reconstruction.", "error");
        updateActionButtons();
        return;
      }

      const url = URL.createObjectURL(blob);
      addReceivedFile(item.name, blob.size, url);
      const durationSec = (performance.now() - item.started) / 1000;
      const speed = durationSec > 0 ? (blob.size * 8) / 1_000_000 / durationSec : 0;
      setProgress(100, speed);
      setTransferState("received");
      status(`${item.name} Air Pasted successfully and byte-count verified.`);
      state.channel?.send(JSON.stringify({ type: "ack", transferId: item.transferId, name: item.name, bytes: blob.size }));
      state.received = null;
      state.acceptedTransferId = null;
      renderRoleFilePanel();
      updateActionButtons();
      toast("File received successfully");
      return;
    }

    if (msg.type === "cancel") {
      const matchesSender = state.role === "sender" && (!msg.transferId || msg.transferId === state.activeTransferId);
      if (matchesSender) {
        state.cancelled = true;
        clearTimeout(state.ackTimer);
        state.ackTimer = null;
        state.awaitingAck = false;
        state.sending = false;
        state.senderWaitingAcceptance = false;
        state.activeTransferId = null;
        setProgress(0);
        setTransferState("cancelled");
        status("Receiver cancelled or declined the transfer.", "error");
        updateActionButtons();
        return;
      }
      if (state.role === "receiver" && (!msg.transferId || msg.transferId === state.pendingRequest?.transferId || msg.transferId === state.acceptedTransferId || msg.transferId === state.received?.transferId)) {
        state.pendingRequest = null;
        state.acceptedTransferId = null;
        state.received = null;
        renderRoleFilePanel();
        setProgress(0);
        setTransferState("cancelled");
        status("Sender cancelled the transfer.");
        updateActionButtons();
      }
      return;
    }

    if (msg.type === "ack" && state.awaitingAck && msg.transferId === state.activeTransferId) {
      await finishSuccessfulTransfer();
      return;
    }

    if (msg.type === "nack" && state.role === "sender" && msg.transferId === state.activeTransferId) {
      await failActiveTransfer(msg.reason || "Receiver verification failed");
    }
    return;
  }

  if (state.role === "receiver" && state.received && event.data instanceof ArrayBuffer) {
    const nextSize = state.received.received + event.data.byteLength;
    if (nextSize > state.received.size) {
      const id = state.received.transferId;
      state.received = null;
      state.acceptedTransferId = null;
      state.channel?.send(JSON.stringify({ type: "nack", transferId: id, reason: "Received more bytes than declared" }));
      setTransferState("failed");
      status("Incoming transfer exceeded its declared size.", "error");
      updateActionButtons();
      return;
    }
    state.received.chunks.push(event.data);
    state.received.received = nextSize;
    const pct = state.received.size ? (state.received.received / state.received.size) * 100 : 100;
    const duration = (performance.now() - state.received.started) / 1000;
    const speed = duration > 0 ? (state.received.received * 8) / 1_000_000 / duration : 0;
    setProgress(pct, speed);
  }
}

function addReceivedFile(name, size, url) {
  state.receivedFiles += 1;
  $("receivedCount").textContent = String(state.receivedFiles);
  const list = $("receivedFiles");
  if (list.classList.contains("empty-state")) {
    list.className = "received-list";
    list.innerHTML = "";
  }
  const item = document.createElement("div");
  item.className = "received-item";
  const ext = (name.split(".").pop() || "FILE").slice(0, 4).toUpperCase();
  item.innerHTML = `<span class="file-token">${ext}</span><div><strong></strong><small>${formatBytes(size)} · received now</small></div><a class="download-link" download>Download</a>`;
  item.querySelector("strong").textContent = name;
  const link = item.querySelector("a");
  link.href = url;
  link.download = name;
  list.prepend(item);
}

async function failActiveTransfer(reason) {
  const file = state.selectedFile;
  clearTimeout(state.ackTimer);
  state.ackTimer = null;
  state.awaitingAck = false;
  state.sending = false;
  state.senderWaitingAcceptance = false;
  setTransferState("failed");
  status(`Transfer failed: ${reason}`, "error");
  if (file) {
    await logEvent({
      type: "transfer", success: false, trigger: state.transferTrigger, room: state.room, mode: "peer",
      fileName: file.name, fileType: fileType(file), fileSizeMB: bytesToMB(file.size),
      durationSec: state.transferStart ? Math.round(((performance.now() - state.transferStart) / 1000) * 100) / 100 : 0,
      speedMbps: 0, acceptanceLatencySec: state.acceptanceLatencySec, reason: String(reason).slice(0, 160)
    });
  }
  state.activeTransferId = null;
  state.acceptanceLatencySec = 0;
  updateActionButtons();
  toast("Transfer failed — retry Air Copy when ready");
}

function newTransferId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}


function uploadBroadcastFile(file) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    state.broadcastXHR = xhr;
    xhr.open("POST", `/api/broadcast/${encodeURIComponent(state.room)}/upload`);
    xhr.responseType = "json";

    // Capture the actual Sender device at the moment
    // this file is uploaded. Do not depend only on the
    // WebSocket copy of the client telemetry.
    const senderClientInfo = collectClientInfo();

    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("X-AirGesture-Host-Token", state.broadcastHostToken);
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    xhr.setRequestHeader("X-File-Size", String(file.size));
    xhr.setRequestHeader("X-File-Type", file.type || "application/octet-stream");

    xhr.setRequestHeader(
      "X-AirGesture-Client-Browser",
      encodeURIComponent(senderClientInfo.browser || "")
    );

    xhr.setRequestHeader(
      "X-AirGesture-Client-OS",
      encodeURIComponent(senderClientInfo.os || "")
    );

    xhr.setRequestHeader(
      "X-AirGesture-Client-Device",
      encodeURIComponent(senderClientInfo.deviceType || "")
    );

    xhr.setRequestHeader(
      "X-AirGesture-Client-Timezone",
      encodeURIComponent(senderClientInfo.timezone || "")
    );

    xhr.setRequestHeader(
      "X-AirGesture-Client-Language",
      encodeURIComponent(senderClientInfo.language || "")
    );

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const pct = event.total ? (event.loaded / event.total) * 100 : 0;
      const elapsed = (performance.now() - state.transferStart) / 1000;
      const speed = elapsed > 0 ? (event.loaded * 8) / 1_000_000 / elapsed : 0;
      setProgress(pct, speed);
    };

    xhr.onload = () => {
      state.broadcastXHR = null;
      const body = xhr.response || (() => {
        try { return JSON.parse(xhr.responseText || "{}"); } catch { return {}; }
      })();
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error(body?.error || `Broadcast upload failed (${xhr.status})`));
    };
    xhr.onerror = () => {
      state.broadcastXHR = null;
      reject(new Error("Broadcast upload failed because the server could not be reached."));
    };
    xhr.onabort = () => {
      state.broadcastXHR = null;
      reject(new DOMException("Broadcast upload cancelled", "AbortError"));
    };

    xhr.send(file);
  });
}

async function prepareBroadcastAirCopy(trigger = "manual") {
  if (state.role !== "sender") return;
  if (!state.selectedFile) return toast("Choose a file before Air Send.");
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN || !state.broadcastHostToken) {
    return toast("Join the universal room as Sender first.");
  }
  if (state.broadcastUploadInProgress) return;

  state.transferTrigger = trigger;
  state.broadcastUploadInProgress = true;
  state.transferStart = performance.now();
  setTransferState("uploading once");
  setProgress(0);
  status(`Air Copy confirmed. Uploading ${state.selectedFile.name} once to the universal distribution server…`);
  updateActionButtons();

  try {
    const result = await uploadBroadcastFile(state.selectedFile);
    state.broadcastFileId = result.file?.id || "";
    renderBroadcastStats(result.stats || {});
    setProgress(100);
    setTransferState("waiting receivers");
    status(`Broadcast ready. ${state.broadcastStats.connected} receiver(s) can now show ✊ → ✋ to Air Paste ${state.selectedFile.name}.`);
    toast("Air Send ready for the classroom");

    setGestureExperience(
      'sent',
      'SENT',
      'File is in the AirGesture room and ready for receivers.',
      '✓'
    );
  } catch (error) {
    if (error?.name === "AbortError") {
      setTransferState("cancelled");
      setProgress(0);
      status("Broadcast upload cancelled.");
    } else {
      console.error("Broadcast upload error:", error);
      setTransferState("failed");
      setProgress(0);
      status(`Broadcast upload failed: ${error.message}`, "error");
      toast("Broadcast upload failed");
    }
  } finally {
    state.broadcastUploadInProgress = false;
    state.broadcastXHR = null;
    updateActionButtons();
  }
}

async function sha256Hex(blob) {
  if (!globalThis.crypto?.subtle) return "";
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function acceptBroadcastAirPaste(trigger = "manual") {
  if (state.role !== "receiver") return;
  if (!state.pendingRequest?.fileId) return toast("No room file is waiting to be Air Pasted.");
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return toast("Join the classroom room first.");
  if (state.broadcastDownloadInProgress) return;

  const request = { ...state.pendingRequest };
  const controller = new AbortController();
  state.broadcastAbortController = controller;
  state.broadcastDownloadInProgress = true;
  state.transferTrigger = trigger;
  const started = performance.now();
  const acceptanceLatencySec = request.requestedAt
    ? Math.round(((started - request.requestedAt) / 1000) * 100) / 100
    : 0;

  state.ws.send(JSON.stringify({
    type: "broadcast-accept",
    fileId: request.fileId,
    trigger,
    acceptanceLatencySec,
    latencyMs: state.networkLatencyMs,
    gestureConfidence: state.lastGestureConfidence,
    clientInfo: collectClientInfo()
  }));
  state.myTransfer = {
    result: 'RECEIVING',
    fileName: request.name,
    fileSize: request.size,
    trigger,
    gestureConfidence: state.lastGestureConfidence,
    acceptanceLatencySec,
    latencyMs: state.networkLatencyMs,
    integrityVerified: false
  };

  renderMyIntelligence();

  setTransferState("receiving broadcast");
  setProgress(0);
  status(`Air Paste accepted. Downloading ${request.name} from the universal room…`);
  updateActionButtons();

  let receivedBytes = 0;
  try {
    const response = await fetch(`/api/broadcast/${encodeURIComponent(state.room)}/files/${encodeURIComponent(request.fileId)}`, {
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) {
      let detail = "";
      try { detail = (await response.json()).error || ""; } catch {}
      throw new Error(detail || `Download failed (${response.status})`);
    }

    const expected = Number(response.headers.get("content-length")) || request.size;
    const serverHash = response.headers.get("x-airgesture-sha256") || request.sha256 || "";
    const reader = response.body?.getReader();
    const chunks = [];

    if (reader) {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
        receivedBytes += value.byteLength;
        if (receivedBytes > expected) throw new Error("Received more bytes than expected");
        const elapsed = (performance.now() - started) / 1000;
        const speed = elapsed > 0 ? (receivedBytes * 8) / 1_000_000 / elapsed : 0;
        setProgress(expected ? (receivedBytes / expected) * 100 : 0, speed);
      }
    } else {
      const buffer = await response.arrayBuffer();
      chunks.push(new Uint8Array(buffer));
      receivedBytes = buffer.byteLength;
    }

    if (receivedBytes !== expected || (request.size && receivedBytes !== request.size)) {
      throw new Error(`Byte verification failed: expected ${request.size || expected}, received ${receivedBytes}`);
    }

    const blob = new Blob(chunks, { type: request.mime || "application/octet-stream" });
    if (blob.size !== receivedBytes) throw new Error("File reconstruction size mismatch");

    // SHA-256 verifies that the server-distributed bytes are exactly the bytes uploaded by the Sender.
    if (serverHash && blob.size <= MAX_FILE_SIZE) {
      const localHash = await sha256Hex(blob);
      if (localHash && localHash !== serverHash) throw new Error("SHA-256 integrity verification failed");
    }

    const durationSec = (performance.now() - started) / 1000;
    const speedMbps = durationSec > 0 ? (receivedBytes * 8) / 1_000_000 / durationSec : 0;
    const url = URL.createObjectURL(blob);
    addReceivedFile(request.name, blob.size, url);

    state.myTransfer = {
      result: 'SUCCESS',
      fileName: request.name,
      fileSize: blob.size,
      trigger,
      gestureConfidence: state.lastGestureConfidence,
      acceptanceLatencySec,
      latencyMs: state.networkLatencyMs,
      speedMbps: Math.round(speedMbps * 100) / 100,
      durationSec: Math.round(durationSec * 100) / 100,
      integrityVerified: true
    };

    renderMyIntelligence();

    const persistenceResponse = await fetch(
      "/api/persistence/transfer",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          room: state.room,
          fileId: request.fileId,
          fileName: request.name,
          fileSize: request.size,
          fileType:
            request.mime ||
            "application/octet-stream",
          result: "SUCCESS",
          trigger,
          latencyMs: state.networkLatencyMs,
          speedMbps:
            Math.round(speedMbps * 100) / 100,
          durationSec:
            Math.round(durationSec * 100) / 100,
          acceptanceLatencySec,
          gestureConfidence:
            state.lastGestureConfidence,
          integrityVerified: true,
          retries: 0
        })
      }
    );

    if (!persistenceResponse.ok) {
      const persistenceError =
        await persistenceResponse
          .json()
          .catch(() => ({}));

      console.error(
        "PostgreSQL persistence failed:",
        persistenceError
      );
    }

    state.ws.send(JSON.stringify({
      type: "broadcast-complete",
      fileId: request.fileId,
      latencyMs: state.networkLatencyMs,
      speedMbps: Math.round(speedMbps * 100) / 100,
      durationSec: Math.round(durationSec * 100) / 100,
      acceptanceLatencySec,
      gestureConfidence: state.lastGestureConfidence,
      retries: 0,
      integrityVerified: true,
      clientInfo: collectClientInfo()
    }));
    setProgress(100, speedMbps);
    setTransferState("received");
    status(`${request.name} received from the universal room and integrity verified.`);
    toast("Classroom file received successfully");

    setGestureExperience(
      'received',
      'RECEIVED',
      'Transfer complete ✓',
      '✓'
    );

    await logEvent({
      type: "transfer",
      success: true,
      trigger,
      room: state.room,
      mode: "broadcast",
      receiverCount: state.broadcastStats.connected,
      fileName: request.name,
      fileType: fileType({ name: request.name, type: request.mime }),
      fileSizeMB: bytesToMB(blob.size),
      durationSec: Math.round(durationSec * 100) / 100,
      speedMbps: Math.round(speedMbps * 100) / 100,
      acceptanceLatencySec
    });

    state.pendingRequest = null;
    renderRoleFilePanel();
  } catch (error) {
    const cancelled = error?.name === "AbortError";
    try {
      if (state.ws?.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({
          type: "broadcast-failed",
          fileId: request.fileId,
          reason: cancelled ? "cancelled" : String(error.message || "download failed"),
          latencyMs: state.networkLatencyMs,
          durationSec: Math.round(((performance.now() - started) / 1000) * 100) / 100,
          acceptanceLatencySec,
          gestureConfidence: state.lastGestureConfidence,
          clientInfo: collectClientInfo()
        }));
      }
    } catch {}

    state.myTransfer = {
      result: cancelled ? 'CANCELLED' : 'FAILED',
      fileName: request.name,
      fileSize: request.size,
      trigger,
      gestureConfidence: state.lastGestureConfidence,
      acceptanceLatencySec,
      latencyMs: state.networkLatencyMs,
      durationSec: Math.round(
        ((performance.now() - started) / 1000) * 100
      ) / 100,
      integrityVerified: false,
      failureReason: cancelled
        ? 'Transfer cancelled'
        : String(error.message || 'Download failed').slice(0, 160)
    };

    renderMyIntelligence();

    setProgress(0);
    setTransferState(cancelled ? "cancelled" : "failed");
    status(cancelled ? "Broadcast download cancelled." : `Broadcast download failed: ${error.message}`, cancelled ? "info" : "error");
    if (!cancelled) {
      await logEvent({
        type: "transfer",
        success: false,
        trigger,
        room: state.room,
        mode: "broadcast",
        receiverCount: state.broadcastStats.connected,
        fileName: request.name,
        fileType: fileType({ name: request.name, type: request.mime }),
        fileSizeMB: bytesToMB(request.size),
        durationSec: Math.round(((performance.now() - started) / 1000) * 100) / 100,
        speedMbps: 0,
        acceptanceLatencySec,
        reason: String(error.message || "download failed").slice(0, 160)
      });
      toast("Download failed");
    }
  } finally {
    state.broadcastDownloadInProgress = false;
    state.broadcastAbortController = null;
    updateActionButtons();
  }
}

async function cancelBroadcastTransfer() {
  if (state.role === "sender") {
    if (state.broadcastXHR) {
      try { state.broadcastXHR.abort(); } catch {}
    }
    if (state.ws?.readyState === WebSocket.OPEN && state.broadcastFileId) {
      state.ws.send(JSON.stringify({ type: "broadcast-cancel", fileId: state.broadcastFileId }));
    }
    state.broadcastFileId = "";
    state.broadcastUploadInProgress = false;
    setProgress(0);
    setTransferState("cancelled");
    status("Universal room send cancelled.");
  } else {
    if (state.broadcastAbortController) {
      try { state.broadcastAbortController.abort(); } catch {}
    }
    if (state.pendingRequest?.fileId && state.ws?.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ type: "broadcast-failed", fileId: state.pendingRequest.fileId, reason: "receiver cancelled" }));
    }
    state.pendingRequest = null;
    state.broadcastDownloadInProgress = false;
    renderRoleFilePanel();
    setProgress(0);
    setTransferState("cancelled");
    status("Receiver cancelled the Air Paste.");
  }
  updateActionButtons();
  toast("Action cancelled");
}

function prepareAirCopy(trigger = "manual") {
  return prepareBroadcastAirCopy(trigger);
  /* Legacy peer-transfer implementation retained below for migration safety, but is unreachable in V5.1. */
  if (state.role !== "sender") return;
  if (!state.selectedFile) return toast("Choose a file before Air Copy.");
  if (!state.channel || state.channel.readyState !== "open") return toast("Connect a receiver and wait for P2P Ready.");
  if (state.sending || state.senderWaitingAcceptance || state.awaitingAck) return;

  state.transferTrigger = trigger;
  state.cancelled = false;
  state.activeTransferId = newTransferId();
  state.senderWaitingAcceptance = true;
  state.transferRequestStart = performance.now();
  state.acceptanceLatencySec = 0;
  const file = state.selectedFile;

  state.channel.send(JSON.stringify({
    type: "transfer-request",
    transferId: state.activeTransferId,
    name: file.name,
    size: file.size,
    mime: file.type,
    fileType: fileType(file)
  }));

  setTransferState("waiting receiver");
  setProgress(0);
  status(`Air Copy ready: ${file.name}. Waiting for Receiver to show ✋ → ✊ and Air Paste.`);
  updateActionButtons();
  toast("Air Copy confirmed — waiting for Receiver");
}

function acceptAirPaste(trigger = "manual") {
  return acceptBroadcastAirPaste(trigger);
  /* Legacy peer-transfer implementation retained below for migration safety, but is unreachable in V5.1. */
  if (state.role !== "receiver") return;
  if (!state.pendingRequest) return toast("No incoming file is waiting to be Air Pasted.");
  if (!state.channel || state.channel.readyState !== "open") return toast("Peer-to-peer channel is not ready.");
  if (state.acceptedTransferId || state.received) return;

  state.acceptedTransferId = state.pendingRequest.transferId;
  state.channel.send(JSON.stringify({ type: "transfer-accept", transferId: state.acceptedTransferId, trigger }));
  setTransferState("accepted");
  status(`Air Paste confirmed for ${state.pendingRequest.name}. Waiting for the Sender payload…`);
  updateActionButtons();
  toast("Air Paste accepted");
}

async function waitForBuffer(channel) {
  if (channel.bufferedAmount < 4 * 1024 * 1024) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 120);
    channel.addEventListener("bufferedamountlow", () => { clearTimeout(timeout); resolve(); }, { once: true });
  });
}

async function sendFilePayload() {
  if (state.role !== "sender" || !state.selectedFile || !state.activeTransferId || state.sending) return;
  const channel = state.channel;
  if (!channel || channel.readyState !== "open") return failActiveTransfer("Peer-to-peer channel is not ready");

  state.sending = true;
  state.cancelled = false;
  state.awaitingAck = true;
  state.transferStart = performance.now();
  updateActionButtons();
  setTransferState("sending");
  setProgress(0);
  status(`Receiver accepted. Sending ${state.selectedFile.name} peer-to-peer…`);

  const file = state.selectedFile;
  const transferId = state.activeTransferId;

  try {
    channel.send(JSON.stringify({ type: "meta", transferId, name: file.name, size: file.size, mime: file.type }));
    let offset = 0;
    while (offset < file.size) {
      if (state.cancelled) return;
      if (channel.readyState !== "open") throw new Error("Peer channel closed during transfer");
      await waitForBuffer(channel);
      if (state.cancelled) return;
      if (channel.readyState !== "open") throw new Error("Peer channel closed during transfer");
      const chunk = await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
      channel.send(chunk);
      offset += chunk.byteLength;
      const elapsed = (performance.now() - state.transferStart) / 1000;
      const speed = elapsed > 0 ? (offset * 8) / 1_000_000 / elapsed : 0;
      setProgress(file.size ? (offset / file.size) * 100 : 100, speed);
    }

    if (state.cancelled) return;
    if (channel.readyState !== "open") throw new Error("Peer channel closed before verification");
    channel.send(JSON.stringify({ type: "end", transferId }));
    setTransferState("verifying");
    status("Payload sent. Waiting for Receiver byte-count verification…");
    clearTimeout(state.ackTimer);
    state.ackTimer = setTimeout(() => {
      if (state.awaitingAck && state.activeTransferId === transferId) failActiveTransfer("Receiver verification timed out");
    }, 15000);
  } catch (error) {
    console.error("Transfer error:", error);
    await failActiveTransfer(error.message || "Unexpected transfer error");
  }
}

async function finishSuccessfulTransfer() {
  const file = state.selectedFile;
  if (!file) return;
  clearTimeout(state.ackTimer);
  state.ackTimer = null;
  const durationSec = (performance.now() - state.transferStart) / 1000;
  const speedMbps = durationSec > 0 ? (file.size * 8) / 1_000_000 / durationSec : 0;
  state.awaitingAck = false;
  state.sending = false;
  state.senderWaitingAcceptance = false;
  state.activeTransferId = null;
  setProgress(100, speedMbps);
  setTransferState("complete");
  status(`Transfer verified: ${file.name} delivered after Sender Air Copy + Receiver Air Paste.`);
  await logEvent({
    type: "transfer", success: true, trigger: state.transferTrigger, room: state.room, mode: "peer",
    fileName: file.name, fileType: fileType(file), fileSizeMB: bytesToMB(file.size),
    durationSec: Math.round(durationSec * 100) / 100,
    speedMbps: Math.round(speedMbps * 100) / 100,
    acceptanceLatencySec: state.acceptanceLatencySec
  });
  state.acceptanceLatencySec = 0;
  updateActionButtons();
  toast("Air Copy/Paste transfer verified and logged");
}

async function cancelTransfer(trigger = "manual") {
  return cancelBroadcastTransfer();
  /* Legacy peer-transfer implementation retained below for migration safety, but is unreachable in V5.1. */
  const channelOpen = state.channel?.readyState === "open";

  if (state.role === "sender") {
    if (!(state.senderWaitingAcceptance || state.sending || state.awaitingAck)) return;
    const file = state.selectedFile;
    const transferId = state.activeTransferId;
    state.cancelled = true;
    clearTimeout(state.ackTimer);
    state.ackTimer = null;
    state.awaitingAck = false;
    state.sending = false;
    state.senderWaitingAcceptance = false;
    state.activeTransferId = null;
    if (channelOpen) state.channel.send(JSON.stringify({ type: "cancel", transferId }));
    setProgress(0);
    setTransferState("cancelled");
    status("Sender cancelled the Air Copy request.");
    if (file) {
      await logEvent({
        type: "transfer", success: false, trigger, room: state.room, mode: "peer",
        fileName: file.name, fileType: fileType(file), fileSizeMB: bytesToMB(file.size),
        durationSec: state.transferStart ? Math.round(((performance.now() - state.transferStart) / 1000) * 100) / 100 : 0,
        speedMbps: 0, acceptanceLatencySec: state.acceptanceLatencySec, reason: "cancelled"
      });
    }
    state.acceptanceLatencySec = 0;
  } else {
    const transferId = state.pendingRequest?.transferId || state.acceptedTransferId || state.received?.transferId;
    if (!transferId) return;
    if (channelOpen) state.channel.send(JSON.stringify({ type: "cancel", transferId }));
    state.pendingRequest = null;
    state.acceptedTransferId = null;
    state.received = null;
    renderRoleFilePanel();
    setProgress(0);
    setTransferState("cancelled");
    status("Receiver declined/cancelled the incoming Air Copy.");
  }

  updateActionButtons();
  toast("Transfer cancelled");
}

function cameraErrorMessage(error) {
  const name = error?.name || '';
  if (!navigator.mediaDevices?.getUserMedia) {
    if (!window.isSecureContext) return 'Camera access is blocked on insecure HTTP. Use localhost or HTTPS.';
    return 'This browser does not expose the camera API.';
  }
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera permission was denied. Allow camera access in the browser/site settings and try again.';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No webcam was found on this device.';
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'The webcam is busy or unavailable. Close other camera apps and try again.';
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') return 'The requested camera mode is unavailable; AirGesture will retry with basic camera settings.';
  return error?.message ? `Camera error: ${error.message}` : 'The webcam could not be started.';
}

async function requestCameraStream() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error(window.isSecureContext
    ? 'Camera API unavailable in this browser.'
    : 'Camera requires localhost or HTTPS.');
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: false
    });
  } catch (error) {
    if (['OverconstrainedError', 'ConstraintNotSatisfiedError'].includes(error?.name)) {
      return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
    throw error;
  }
}

async function importVisionModule() {
  const sources = [
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/+esm',
    'https://unpkg.com/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs'
  ];
  let lastError;
  for (const source of sources) {
    try { return await import(source); } catch (error) { lastError = error; console.warn(`MediaPipe import failed from ${source}`, error); }
  }
  throw lastError || new Error('MediaPipe module could not be loaded');
}

async function createGestureRecognizerWithFallback(vision) {
  const wasmSources = [
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm',
    'https://unpkg.com/@mediapipe/tasks-vision@0.10.35/wasm'
  ];
  let fileset;
  let lastError;
  for (const wasm of wasmSources) {
    try { fileset = await vision.FilesetResolver.forVisionTasks(wasm); break; } catch (error) { lastError = error; }
  }
  if (!fileset) throw lastError || new Error('MediaPipe WASM could not be loaded');

  const options = (delegate) => ({
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task',
      ...(delegate ? { delegate } : {})
    },
    runningMode: 'VIDEO',
    numHands: 1,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.6,
    minTrackingConfidence: 0.6
  });

  try {
    return { recognizer: await vision.GestureRecognizer.createFromOptions(fileset, options('GPU')), delegate: 'GPU' };
  } catch (gpuError) {
    console.warn('MediaPipe GPU delegate failed; retrying on CPU.', gpuError);
    return { recognizer: await vision.GestureRecognizer.createFromOptions(fileset, options(undefined)), delegate: 'CPU' };
  }
}

async function loadVisionAI(startToken) {
  if (!state.cameraRunning || state.aiLoading || state.aiReady) return;
  state.aiLoading = true;
  setBadge($('cameraBadge'), 'Camera Live · Loading AI', 'warn');
  status('Webcam is live. Loading gesture recognition in the background…');
  try {
    const vision = await importVisionModule();
    const { recognizer, delegate } = await createGestureRecognizerWithFallback(vision);
    if (!state.cameraRunning || startToken !== state.cameraStartToken) {
      try { recognizer.close?.(); } catch {}
      return;
    }
    state.visionModule = vision;
    state.recognizer = recognizer;
    state.drawingUtils = new vision.DrawingUtils($('overlay').getContext('2d'));
    state.aiReady = true;
    setBadge($('cameraBadge'), `Vision AI Live · ${delegate}`, 'good');
    status(
      state.role === 'sender'
        ? 'Vision AI is live. Show ✋ Open Palm, then close to ✊ to grab and Air Copy.'
        : 'Vision AI is live. Wait for the incoming pulse. Make ✊ to catch, then open ✋ to Air Paste.'
    );

    syncGestureExperience();
    if (!state.animationFrameId) state.animationFrameId = requestAnimationFrame(predictGesture);
  } catch (error) {
    if (startToken !== state.cameraStartToken) return;
    console.error('Gesture AI failed to load:', error);
    state.aiReady = false;
    setBadge($('cameraBadge'), 'Camera Live · AI Offline', 'warn');
    updateGestureHUD('AI Offline', 0);
    status('Webcam is working, but gesture AI could not load. Manual Air Copy/Air Paste controls remain available.', 'error');
    toast('Camera is live; gesture AI is offline. Use manual Air Copy/Air Paste or retry later.');
  } finally {
    if (startToken === state.cameraStartToken) {
      state.aiLoading = false;
      $('startCameraBtn').disabled = state.cameraRunning;
    }
  }
}

async function startCamera() {
  if (state.cameraRunning || state.aiLoading) return;

  const startToken = ++state.cameraStartToken;
  $("startCameraBtn").disabled = true;
  setBadge($("cameraBadge"), "Requesting Camera", "warn");
  status(`Requesting webcam permission for ${state.role === "sender" ? "Air Copy" : "Air Paste"}…`);

  try {
    const stream = await requestCameraStream();
    if (startToken !== state.cameraStartToken) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    state.cameraStream = stream;
    state.cameraRunning = true;
    state.aiReady = false;
    state.lastVideoTime = -1;
    const video = $("video");
    video.srcObject = stream;
    await video.play();
    resizeOverlay();
    setBadge($("cameraBadge"), "Camera Live", "good");
    $("startCameraBtn").disabled = true;
    $("stopCameraBtn").disabled = false;
    updateGestureHUD("Loading AI…", 0);
    status("Webcam is live. Gesture AI is loading separately…");

    loadVisionAI(startToken);
  } catch (error) {
    console.error("Camera start failed:", error);
    state.cameraRunning = false;
    state.aiReady = false;
    state.aiLoading = false;
    setBadge($("cameraBadge"), "Camera Unavailable", "warn");
    $("startCameraBtn").disabled = false;
    $("stopCameraBtn").disabled = true;
    const message = cameraErrorMessage(error);
    status(`${message} Manual Air Copy/Air Paste still works.`, "error");
    toast(message);
  }
}

function stopCamera() {
  state.cameraStartToken += 1;
  state.cameraRunning = false;
  state.aiReady = false;
  state.aiLoading = false;
  if (state.animationFrameId) cancelAnimationFrame(state.animationFrameId);
  state.animationFrameId = null;
  try { state.recognizer?.close?.(); } catch {}
  state.recognizer = null;
  state.drawingUtils = null;
  state.visionModule = null;
  state.cameraStream?.getTracks().forEach((track) => track.stop());
  state.cameraStream = null;
  $('video').srcObject = null;
  const ctx = $('overlay').getContext('2d');
  ctx.clearRect(0, 0, $('overlay').width, $('overlay').height);
  $('startCameraBtn').disabled = false;
  $('stopCameraBtn').disabled = true;
  setBadge($('cameraBadge'), 'Camera Off', 'neutral');
  updateGestureHUD('Camera Off', 0);
  state.gestureCandidate = '';
  state.gestureSince = 0;
  state.gestureActionFired = false;
  state.gestureCandidateFrames = 0;
  state.gestureCooldownUntil = 0;
  resetGestureSequence();
}

function resizeOverlay() {
  const canvas = $("overlay");
  const video = $("video");
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
}

function updateGestureHUD(name, score) {
  const supported = ["Open_Palm", "Closed_Fist"].includes(name);
  // For the classroom UI, 100% means the pose crossed our acceptance rule.
  // The raw MediaPipe/geometry score is still preserved internally for analytics.
  const pct = supported ? 100 : Math.round((score || 0) * 100);
  const friendly = {
    Open_Palm: "Open Palm ✋",
    Closed_Fist: "Closed Fist ✊",
    None: "Hand Detected"
  }[name] || name || "Waiting for hand";
  $("gestureName").textContent = friendly;
  $("confidenceBar").style.width = `${pct}%`;
  $("confidenceText").textContent = `${pct}%`;
  $("heroConfidence").textContent = pct ? `${pct}%` : "--";
}

async function fireAirGestureSequence(
  confidence
) {
  state.lastGestureConfidence =
    Number(confidence) || 0;

  await playGestureSuccessAnimation(
    state.role
  );

  if (
    state.role === 'receiver'
  ) {
    renderMyIntelligence();
  }

  const action =
    state.role === 'sender'
      ? 'Air_Copy'
      : 'Air_Paste';

  await logEvent({
    type:
      'gesture',

    gesture:
      action,

    confidence,

    role:
      state.role,

    action,

    mode:
      state.mode
  });


  if (
    state.role === 'sender'
  ) {
    return prepareAirCopy(
      'gesture'
    );
  }

  return acceptAirPaste(
    'gesture'
  );
}

async function handleStableGesture(
  name,
  confidence
) {
  const now =
    performance.now();


  // ---------------------------------
  // RECEIVER
  // ✊ CATCH -> ✋ RELEASE
  // ---------------------------------
  if (
    state.role === 'receiver'
  ) {

    if (!state.pendingRequest) {
      syncGestureExperience();

      return;
    }


    if (
      state.gestureSequencePhase ===
        'waiting-release' &&
      now >
        state.gestureSequenceExpiresAt
    ) {
      resetGestureSequence();
      syncGestureExperience();

      status(
        'Catch reset. Make a fist ✊ again, then open your hand ✋.'
      );

      return;
    }


    if (
      name === 'Closed_Fist' &&
      state.gestureSequencePhase ===
        'waiting-fist'
    ) {
      state.gestureSequencePhase =
        'waiting-release';

      state.gestureSequenceExpiresAt =
        now +
        GESTURE_SEQUENCE_TIMEOUT_MS;

      state.gestureOpenConfidence =
        confidence;


      setGestureExperience(
        'caught',
        'CAUGHT',
        'Great. Now open your hand ✋ to release and receive.',
        '✊'
      );


      status(
        'File caught ✓ — open your hand ✋ to Air Paste.'
      );

      toast(
        'Caught ✓ — now open your hand ✋'
      );


      await animateAirFile(
        'grab'
      );

      return;
    }


    if (
      name === 'Open_Palm' &&
      state.gestureSequencePhase ===
        'waiting-release' &&
      now <=
        state.gestureSequenceExpiresAt
    ) {
      const combinedConfidence =
        Math.min(
          1,
          (
            state.gestureOpenConfidence +
            confidence
          ) / 2
        );

      resetGestureSequence();

      await fireAirGestureSequence(
        combinedConfidence
      );

      state.gestureCooldownUntil =
        performance.now() +
        GESTURE_COOLDOWN_MS;

      return;
    }


    return;
  }


  // ---------------------------------
  // SENDER
  // ✋ ARM -> ✊ GRAB
  // ---------------------------------

  if (!state.selectedFile) {
    syncGestureExperience();

    return;
  }


  if (
    state.gestureSequencePhase ===
      'waiting-close' &&
    now >
      state.gestureSequenceExpiresAt
  ) {
    resetGestureSequence();
    syncGestureExperience();

    status(
      'Grab reset. Show your open palm ✋ again, then close your fist ✊.'
    );

    return;
  }


  if (
    name === 'Open_Palm' &&
    state.gestureSequencePhase ===
      'waiting-open'
  ) {
    state.gestureSequencePhase =
      'waiting-close';

    state.gestureSequenceExpiresAt =
      now +
      GESTURE_SEQUENCE_TIMEOUT_MS;

    state.gestureOpenConfidence =
      confidence;


    setGestureExperience(
      'armed',
      'READY TO GRAB',
      'Open Palm detected ✓ — close your fist ✊ to grab the file.',
      '✋'
    );


    status(
      'Open Palm ✓ — close your fist ✊ to grab and Air Copy.'
    );

    toast(
      'Ready to grab — close your fist ✊'
    );

    return;
  }


  if (
    name === 'Closed_Fist' &&
    state.gestureSequencePhase ===
      'waiting-close' &&
    now <=
      state.gestureSequenceExpiresAt
  ) {
    const combinedConfidence =
      Math.min(
        1,
        (
          state.gestureOpenConfidence +
          confidence
        ) / 2
      );

    resetGestureSequence();

    await fireAirGestureSequence(
      combinedConfidence
    );

    state.gestureCooldownUntil =
      performance.now() +
      GESTURE_COOLDOWN_MS;
  }
}

async function predictGesture() {
  state.animationFrameId = null;
  if (!state.cameraRunning || !state.aiReady || !state.recognizer) return;
  const video = $('video');
  if (video.readyState >= 2 && video.currentTime !== state.lastVideoTime) {
    state.lastVideoTime = video.currentTime;
    resizeOverlay();
    try {
      const result = state.recognizer.recognizeForVideo(video, performance.now());
      const ctx = $('overlay').getContext('2d');
      ctx.clearRect(0, 0, $('overlay').width, $('overlay').height);

      if (result.landmarks?.length && state.drawingUtils) {
        for (const landmarks of result.landmarks) {
          state.drawingUtils.drawConnectors(landmarks, state.visionModule.GestureRecognizer.HAND_CONNECTIONS, { color: '#45d9ff', lineWidth: 3 });
          state.drawingUtils.drawLandmarks(landmarks, { color: '#9b7cff', fillColor: '#45d9ff', radius: 3 });
        }
      }

      if (
        result.landmarks?.[0]?.length
      ) {
        updateGestureHandAnchor(
          result.landmarks[0]
        );
      }

      // AIRGESTURE GRAB / RELEASE MODE:
      // A single accepted Open Palm frame latches OPEN.
      // A single accepted Closed Fist frame after that completes Air Copy/Air Paste.
      // No hold, no repeated-frame confirmation, and intermediate motion is ignored.
      const simple = window.AirGestureCore.resolveSimpleGesture(result);
      const name = simple.name;
      const rawScore = simple.score;
      updateGestureHUD(name, rawScore);

      const now =
        performance.now();

      const expired =
        (
          state.gestureSequencePhase ===
            'waiting-close' ||
          state.gestureSequencePhase ===
            'waiting-release'
        ) &&
        now >
          state.gestureSequenceExpiresAt;

      if (expired) {
        resetGestureSequence();
        syncGestureExperience();
      }


      if (
        now >=
        state.gestureCooldownUntil
      ) {

        if (
          state.role === 'sender'
        ) {

          if (
            name === 'Open_Palm' &&
            state.gestureSequencePhase ===
              'waiting-open'
          ) {
            await handleStableGesture(
              'Open_Palm',
              rawScore
            );

          } else if (
            name === 'Closed_Fist' &&
            state.gestureSequencePhase ===
              'waiting-close'
          ) {
            await handleStableGesture(
              'Closed_Fist',
              rawScore
            );
          }

        } else if (
          state.pendingRequest
        ) {

          if (
            name === 'Closed_Fist' &&
            state.gestureSequencePhase ===
              'waiting-fist'
          ) {
            await handleStableGesture(
              'Closed_Fist',
              rawScore
            );

          } else if (
            name === 'Open_Palm' &&
            state.gestureSequencePhase ===
              'waiting-release'
          ) {
            await handleStableGesture(
              'Open_Palm',
              rawScore
            );
          }
        }
      }
    } catch (error) {
      console.error('Gesture recognition frame failed:', error);
      state.aiReady = false;
      setBadge($('cameraBadge'), 'Camera Live · AI Error', 'warn');
      updateGestureHUD('AI Error', 0);
      status('Camera remains live, but gesture recognition stopped after an AI error. Manual controls still work.', 'error');
      return;
    }
  }
  if (state.cameraRunning && state.aiReady) state.animationFrameId = requestAnimationFrame(predictGesture);
}

function chartColors() {
  const styles = getComputedStyle(document.documentElement);
  return {
    cyan: styles.getPropertyValue("--cyan").trim(),
    violet: styles.getPropertyValue("--violet").trim(),
    green: styles.getPropertyValue("--green").trim(),
    red: styles.getPropertyValue("--red").trim(),
    muted: styles.getPropertyValue("--muted").trim(),
    line: styles.getPropertyValue("--line").trim()
  };
}

async function refreshAnalytics() {
  const response = await fetch("/api/analytics");

  // During a first-time Google login the application script can initialize
  // before the authenticated session has been established.
  if (!response.ok) return;

  const data = await response.json();
  const { kpis } = data;
  $("kpiSuccess").textContent = `${kpis.successRate}%`;
  $("kpiTransfers").textContent = `${kpis.transfers} observations · ${kpis.failedTransfers} failed`;
  $("kpiSpeed").textContent = kpis.avgSpeedMbps ? kpis.avgSpeedMbps : "--";
  $("kpiGesture").textContent = kpis.avgGestureConfidence ? `${kpis.avgGestureConfidence}%` : "--%";
  $("kpiAdoption").textContent = kpis.gestureUseRate ? `${kpis.gestureUseRate}%` : "--%";
  renderRecommendations(data.recommendations);
  renderEvidence(data.recent);
  renderCharts(data);
}

function renderRecommendations(items) {
  const root = $("recommendations");
  root.innerHTML = "";
  for (const item of items) {
    const el = document.createElement("div");
    el.className = `recommendation ${item.level}`;
    el.innerHTML = `<i></i><div><strong></strong><p></p></div>`;
    el.querySelector("strong").textContent = item.title;
    el.querySelector("p").textContent = item.text;
    root.appendChild(el);
  }
}

function renderEvidence(items) {
  const body = $("evidenceBody");
  if (!items?.length) {
    body.innerHTML = '<tr><td colspan="7" class="table-empty">No evidence collected yet.</td></tr>';
    return;
  }
  body.innerHTML = "";
  for (const item of items) {
    const tr = document.createElement("tr");
    const values = [
      new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      item.fileName || "—",
      `${item.fileSizeMB || 0} MB`,
      item.trigger || "—",
      `${item.durationSec || 0}s`,
      `${item.speedMbps || 0} Mbps`
    ];
    for (const value of values) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    }
    const result = document.createElement("td");
    result.textContent = item.success ? "SUCCESS" : "FAILED";
    result.className = item.success ? "result-good" : "result-bad";
    tr.appendChild(result);
    body.appendChild(tr);
  }
}

function renderCharts(data) {
  if (!window.Chart) return;
  const c = chartColors();
  const chronological = [...(data.recent || [])].reverse();
  const labels = chronological.map((_, i) => `T${i + 1}`);
  const speeds = chronological.map((x) => Number(x.speedMbps) || 0);
  const success = chronological.map((x) => x.success ? 100 : 0);

  state.charts.trend?.destroy();
  state.charts.trend = new Chart($("trendChart"), {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Speed (Mbps)", data: speeds, borderColor: c.cyan, backgroundColor: "rgba(69,217,255,.12)", tension: .38, fill: true, pointRadius: 3, yAxisID: "y" },
        { label: "Success", data: success, borderColor: c.green, backgroundColor: "transparent", tension: .2, borderDash: [5, 5], pointRadius: 2, yAxisID: "y1" }
      ]
    },
    options: chartOptions(c, true)
  });

  state.charts.type?.destroy();
  state.charts.type = new Chart($("typeChart"), {
    type: "doughnut",
    data: {
      labels: data.byType.map((x) => x.name),
      datasets: [{ data: data.byType.map((x) => x.total), backgroundColor: [c.cyan, c.violet, c.green, "#4f7cff", "#f7c85b", "#ff6d82"], borderWidth: 0, hoverOffset: 7 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "68%",
      plugins: { legend: { position: "bottom", labels: { color: c.muted, boxWidth: 8, usePointStyle: true, font: { size: 10 } } } }
    }
  });
}

function chartOptions(c, dualAxis = false) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: { legend: { labels: { color: c.muted, boxWidth: 9, usePointStyle: true, font: { size: 10 } } } },
    scales: {
      x: { ticks: { color: c.muted, font: { size: 9 } }, grid: { color: c.line } },
      y: { beginAtZero: true, ticks: { color: c.muted, font: { size: 9 } }, grid: { color: c.line } },
      ...(dualAxis ? { y1: { beginAtZero: true, max: 100, position: "right", ticks: { color: c.muted, font: { size: 9 } }, grid: { drawOnChartArea: false } } } : {})
    }
  };
}

async function loadDemoData() {
  $("demoDataBtn").disabled = true;
  try {
    await fetch("/api/demo-data", { method: "POST" });
    await refreshAnalytics();
    toast("Classroom evidence loaded");
  } finally {
    $("demoDataBtn").disabled = false;
  }
}

async function clearAnalytics() {
  if (!confirm("Clear all locally recorded classroom evidence?")) return;
  await fetch("/api/analytics", { method: "DELETE" });
  await refreshAnalytics();
  toast("Evidence cleared");
}


function formatDatabaseDate(value) {
  if (!value) return '—';

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return '—';
  }

  return date.toLocaleString();
}


function yesNo(value) {
  return value ? 'YES' : 'NO';
}


function renderDatabaseTable(
  bodyId,
  rows,
  columns,
  emptyText = 'No records yet.'
) {
  const body =
    $(bodyId);

  if (!body) return;

  body.innerHTML = '';

  if (!Array.isArray(rows) || !rows.length) {
    const tr =
      document.createElement('tr');

    const td =
      document.createElement('td');

    td.colSpan =
      columns.length;

    td.className =
      'table-empty';

    td.textContent =
      emptyText;

    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  for (const row of rows) {
    const tr =
      document.createElement('tr');

    for (const column of columns) {
      const td =
        document.createElement('td');

      const value =
        typeof column === 'function'
          ? column(row)
          : row?.[column];

      td.textContent =
        value === null ||
        value === undefined ||
        value === ''
          ? '—'
          : String(value);

      tr.appendChild(td);
    }

    body.appendChild(tr);
  }
}


function renderAdminDatabase(data = {}) {
  const summary =
    data.summary || {};

  setText(
    'dbUsers',
    summary.users ?? 0
  );

  setText(
    'dbClassSessions',
    summary.classSessions ?? 0
  );

  setText(
    'dbParticipants',
    summary.participants ?? 0
  );

  setText(
    'dbTransferEvents',
    summary.transferEvents ?? 0
  );

  setText(
    'dbCommercialProfiles',
    summary.commercialProfiles ?? 0
  );

  setText(
    'dbConsentEvents',
    summary.consentEvents ?? 0
  );

  setText(
    'dbRecommendations',
    summary.recommendationEvents ?? 0
  );

  setText(
    'dbConversions',
    summary.conversionEvents ?? 0
  );


  setText(
    'dbGeneratedAt',
    data.generatedAt
      ? `Updated ${formatDatabaseDate(data.generatedAt)}`
      : 'Database connected'
  );


  renderDatabaseTable(
    'dbUsersBody',
    data.users,
    [
      (r) => r.name,
      (r) => r.email,
      (r) =>
        formatDatabaseDate(
          r.created_at
        ),
      (r) =>
        formatDatabaseDate(
          r.last_login_at
        )
    ]
  );


  renderDatabaseTable(
    'dbProfilesBody',
    data.commercialProfiles,
    [
      (r) => r.name,
      (r) => r.email,
      (r) => r.browser,
      (r) => r.os,
      (r) => r.device_type,
      (r) => r.device_segment,
      (r) =>
        [r.country, r.region]
          .filter(Boolean)
          .join(' · ') || '—',
      (r) => r.visit_count,
      (r) => r.total_transfers,
      (r) =>
        formatBytes(
          Number(r.total_bytes) || 0
        ),
      (r) => r.image_transfers,
      (r) => r.pdf_transfers,
      (r) => r.video_transfers,
      (r) => r.document_transfers,
      (r) => r.usage_segment,
      (r) =>
        formatDatabaseDate(
          r.updated_at
        )
    ]
  );


  renderDatabaseTable(
    'dbConsentBody',
    data.consentPreferences,
    [
      (r) => r.name,
      (r) => r.email,
      (r) =>
        yesNo(
          r.analytics_consent
        ),
      (r) =>
        yesNo(
          r.personalization_consent
        ),
      (r) =>
        yesNo(
          r.marketing_consent
        ),
      (r) => r.policy_version,
      (r) =>
        formatDatabaseDate(
          r.updated_at
        )
    ]
  );


  renderDatabaseTable(
    'dbConsentEventsBody',
    data.consentEvents,
    [
      (r) => r.name,
      (r) => r.email,
      (r) =>
        yesNo(
          r.analytics_consent
        ),
      (r) =>
        yesNo(
          r.personalization_consent
        ),
      (r) =>
        yesNo(
          r.marketing_consent
        ),
      (r) => r.source,
      (r) => r.policy_version,
      (r) =>
        formatDatabaseDate(
          r.created_at
        )
    ]
  );


  renderDatabaseTable(
    'dbTransfersBody',
    data.transferEvents,
    [
      (r) => r.name,
      (r) => r.email,
      (r) => r.room_code,
      (r) => r.result,
      (r) => r.file_name,
      (r) => r.file_type,
      (r) =>
        formatBytes(
          Number(
            r.file_size_bytes
          ) || 0
        ),
      (r) =>
        `${Number(r.speed_mbps || 0).toFixed(2)} Mbps`,
      (r) =>
        `${Number(r.duration_sec || 0).toFixed(2)} sec`,
      (r) =>
        yesNo(
          r.integrity_verified
        ),
      (r) =>
        [
          r.browser,
          r.os,
          r.device_type
        ]
          .filter(Boolean)
          .join(' · '),
      (r) => r.location,
      (r) =>
        formatDatabaseDate(
          r.created_at
        )
    ]
  );


  renderDatabaseTable(
    'dbGovernanceBody',
    data.governanceRegistry,
    [
      (r) => r.data_field,
      (r) => r.purpose,
      (r) => r.source,
      (r) => r.data_owner,
      (r) => r.sensitivity,
      (r) =>
        `${r.retention_days} days`,
      (r) =>
        yesNo(
          r.commercial_allowed
        ),
      (r) => r.notes
    ]
  );


  renderDatabaseTable(
    'dbRecommendationsBody',
    data.recommendationEvents,
    [
      (r) => r.name,
      (r) => r.email,
      (r) =>
        r.commercial_segment,
      (r) =>
        r.recommendation_category,
      (r) => r.campaign_id,
      (r) => r.action,
      (r) =>
        formatDatabaseDate(
          r.created_at
        )
    ],
    'No recommendation records yet.'
  );


  renderDatabaseTable(
    'dbConversionsBody',
    data.conversionEvents,
    [
      (r) => r.name,
      (r) => r.email,
      (r) =>
        r.conversion_type,
      (r) =>
        `${r.currency || 'USD'} ${Number(
          r.value_amount || 0
        ).toFixed(2)}`,
      (r) =>
        formatDatabaseDate(
          r.created_at
        )
    ],
    'No conversion records yet.'
  );
}


async function loadAdminDatabase(
  force = false
) {
  if (
    state.adminDatabaseDenied &&
    !force
  ) {
    return;
  }

  if (
    state.adminDatabaseLoaded &&
    !force
  ) {
    return;
  }

  const panel =
    $('databaseIntelligencePanel');

  const statusBadge =
    $('dbDashboardStatus');

  try {
    if (statusBadge) {
      statusBadge.textContent =
        'Loading PostgreSQL…';
    }

    const response =
      await fetch(
        '/api/admin/database?limit=250',
        {
          cache: 'no-store'
        }
      );

    if (
      response.status === 401 ||
      response.status === 403
    ) {
      state.adminDatabaseDenied =
        response.status === 403;

      if (panel) {
        panel.hidden = true;
      }

      return;
    }

    const data =
      await response
        .json()
        .catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error ||
        'Database dashboard unavailable.'
      );
    }

    state.adminDatabase =
      data;

    state.adminDatabaseLoaded =
      true;

    if (panel) {
      panel.hidden = false;
    }

    if (statusBadge) {
      statusBadge.textContent =
        'PostgreSQL Live';

      statusBadge.className =
        'status-badge good';
    }

    renderAdminDatabase(data);
  } catch (error) {
    console.error(
      'Database dashboard load failed:',
      error
    );

    if (panel) {
      panel.hidden = false;
    }

    if (statusBadge) {
      statusBadge.textContent =
        'Database unavailable';

      statusBadge.className =
        'status-badge warn';
    }

    setText(
      'dbGeneratedAt',
      error.message ||
      'Could not load database intelligence.'
    );
  }
}






function openLiveDataWindow() {
  window.open(
    '/live-data.html',
    '_blank',
    'noopener'
  );
}


function switchView(id) {
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === id));
  document.querySelectorAll(".nav-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === id));

  if (id === "analyticsView") {
    setTimeout(() => {
      refreshAnalytics();
      loadAdminDatabase();
    }, 50);
  }
}

function bindEvents() {
  document.querySelectorAll(".nav-tab").forEach((tab) => tab.addEventListener("click", () => switchView(tab.dataset.view)));
  document.querySelectorAll(".role-btn").forEach((btn) => btn.addEventListener("click", () => setRole(btn.dataset.role)));
  $("generateRoomBtn").addEventListener("click", () => { $("roomInput").value = randomRoom(); });
  $("joinBtn").addEventListener("click", connectRoom);
  $("chooseFileBtn").addEventListener("click", () => $("fileInput").click());
  $("dropZone").addEventListener("click", (e) => { if (e.target.id !== "chooseFileBtn") $("fileInput").click(); });
  $("fileInput").addEventListener("change", (e) => selectFile(e.target.files?.[0]));
  $("dropZone").addEventListener("dragover", (e) => { e.preventDefault(); $("dropZone").classList.add("dragging"); });
  $("dropZone").addEventListener("dragleave", () => $("dropZone").classList.remove("dragging"));
  $("dropZone").addEventListener("drop", (e) => { e.preventDefault(); $("dropZone").classList.remove("dragging"); selectFile(e.dataTransfer.files?.[0]); });
  $("copyBtn").addEventListener("click", () => prepareAirCopy("manual"));
  $("pasteBtn").addEventListener("click", () => acceptAirPaste("manual"));
  $("cancelBtn").addEventListener("click", () => cancelTransfer("manual"));
  $("startCameraBtn").addEventListener("click", startCamera);
  $("stopCameraBtn").addEventListener("click", stopCamera);
  $("refreshAnalyticsBtn").addEventListener("click", refreshAnalytics);
  $("demoDataBtn").addEventListener("click", loadDemoData);
  $("clearDataBtn").addEventListener("click", clearAnalytics);
  $('refreshDatabaseBtn')?.addEventListener(
    'click',
    () => {
      state.adminDatabaseLoaded = false;
      loadAdminDatabase(true);
    }
  );
  $("themeBtn").addEventListener("click", () => { document.body.classList.toggle("light"); if ($("analyticsView").classList.contains("active")) refreshAnalytics(); });

  $('openLiveDataBtn')
    ?.addEventListener(
      'click',
      openLiveDataWindow
    );

  window.addEventListener('airgesture-auth-user', (event) => {
    state.authUser = event.detail || null;

    if (state.role === 'receiver') {
      renderMyIntelligence();
    }

    loadCommercialConsent();
  });

  $('saveConsentBtn')?.addEventListener(
    'click',
    saveCommercialConsent
  );

  window.addEventListener("resize", () => state.cameraRunning && resizeOverlay());
  window.addEventListener("beforeunload", () => { state.ws?.close(); stopCamera(); });
}

function init() {
  $("roomInput").value = randomRoom();
  bindEvents();
  setMode();
  setRole("sender");
  setProgress(0);
  renderBroadcastStats({});
  refreshAnalytics();

  setTimeout(() => {
    if (
      window.AirGestureAuthUser
    ) {
      state.authUser =
        window.AirGestureAuthUser;

      loadCommercialConsent();
    }
  }, 100);
}

init();
