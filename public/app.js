const $ = (id) => document.getElementById(id);
const state = {
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
  const channelReady = Boolean(state.channel && state.channel.readyState === "open");
  const senderBusy = state.sending || state.senderWaitingAcceptance || state.awaitingAck;
  const receiverBusy = Boolean(state.acceptedTransferId || state.received);

  $("copyBtn").style.display = isSender ? "block" : "none";
  $("pasteBtn").style.display = isSender ? "none" : "block";
  $("copyBtn").disabled = !isSender || !state.selectedFile || !channelReady || senderBusy;
  $("pasteBtn").disabled = isSender || !state.pendingRequest || !channelReady || receiverBusy;
  $("cancelBtn").disabled = isSender
    ? !(state.senderWaitingAcceptance || state.sending || state.awaitingAck)
    : !(state.pendingRequest || state.acceptedTransferId || state.received);
}

function resetGestureSequence() {
  state.gestureSequencePhase = "waiting-open";
  state.gestureSequenceExpiresAt = 0;
  state.gestureOpenConfidence = 0;
}

function renderRoleFilePanel() {
  if (state.role === "sender") {
    $("dropZone").style.opacity = "1";
    $("dropZone").style.pointerEvents = "auto";
    if (state.selectedFile) {
      $("fileTitle").textContent = state.selectedFile.name;
      $("fileMeta").textContent = `${formatBytes(state.selectedFile.size)} · ${state.selectedFile.type || "unknown type"}`;
    } else {
      $("fileTitle").textContent = "Choose a file to Air Copy";
      $("fileMeta").textContent = "Click or drag & drop · up to 100 MB";
    }
  } else {
    $("dropZone").style.opacity = ".75";
    $("dropZone").style.pointerEvents = "none";
    if (state.pendingRequest) {
      $("fileTitle").textContent = `Incoming: ${state.pendingRequest.name}`;
      $("fileMeta").textContent = `${formatBytes(state.pendingRequest.size)} · show ✋ → ✊ to Air Paste`;
    } else {
      $("fileTitle").textContent = "Waiting for an incoming Air Copy";
      $("fileMeta").textContent = "Connect to the Sender room, then start Vision AI";
    }
  }
}

function setRole(role) {
  if (!["sender", "receiver"].includes(role)) return;
  const changed = state.role !== role;
  state.role = role;
  document.querySelectorAll(".role-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.role === role));

  if (changed && state.ws?.readyState === WebSocket.OPEN) {
    state.ws.close();
    closePeerConnection();
    setBadge($("peerBadge"), "Disconnected", "neutral");
  }

  resetGestureSequence();
  renderRoleFilePanel();
  $("startCameraBtn").disabled = state.cameraRunning || state.aiLoading;
  $("stopCameraBtn").disabled = !state.cameraRunning;

  status(role === "sender"
    ? "Sender ready. Choose a file, connect the Receiver, then show ✋ Open Hand → ✊ Closed Fist to Air Copy."
    : "Receiver ready. Connect to the same room, start Vision AI, then use ✋ Open Hand → ✊ Closed Fist when an incoming file appears.");
  updateActionButtons();
}

function selectFile(file) {
  if (!file) return;
  if (file.size > MAX_FILE_SIZE) {
    toast("For this classroom build, select a file smaller than 100 MB.");
    return;
  }
  state.selectedFile = file;
  $("fileTitle").textContent = file.name;
  $("fileMeta").textContent = `${formatBytes(file.size)} · ${file.type || "unknown type"}`;
  state.senderWaitingAcceptance = false;
  state.activeTransferId = null;
  setTransferState("file selected");
  setProgress(0);
  updateActionButtons();
  status(`File selected: ${file.name}. Show ✋ Open Hand → ✊ Closed Fist to Air Copy, or use the manual Air Copy button.`);
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

  ws.onopen = () => ws.send(JSON.stringify({ type: 'join', room, role: state.role }));
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
      type: "transfer", success: false, trigger: state.transferTrigger, room: state.room,
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

function prepareAirCopy(trigger = "manual") {
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
    type: "transfer", success: true, trigger: state.transferTrigger, room: state.room,
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
        type: "transfer", success: false, trigger, room: state.room,
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
    status(state.role === 'sender' ? 'Vision AI is live. Show ✋ Open Hand → ✊ Closed Fist to Air Copy.' : 'Vision AI is live. Wait for an incoming file, then show ✋ Open Hand → ✊ Closed Fist to Air Paste.');
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

async function fireAirGestureSequence(confidence) {
  const action = state.role === "sender" ? "Air_Copy" : "Air_Paste";
  await logEvent({ type: "gesture", gesture: action, confidence, role: state.role, action });
  if (state.role === "sender") return prepareAirCopy("gesture");
  return acceptAirPaste("gesture");
}

async function handleStableGesture(name, confidence) {
  const now = performance.now();
  if (state.gestureSequencePhase === "waiting-close" && now > state.gestureSequenceExpiresAt) {
    resetGestureSequence();
    status(state.role === "sender"
      ? "Gesture reset. Show ✋ once, then close naturally to ✊ for Air Copy."
      : "Gesture reset. Show ✋ once, then close naturally to ✊ for Air Paste.");
  }

  if (name === "Open_Palm") {
    if (state.gestureSequencePhase === "waiting-open") {
      state.gestureSequencePhase = "waiting-close";
      state.gestureSequenceExpiresAt = now + GESTURE_SEQUENCE_TIMEOUT_MS;
      state.gestureOpenConfidence = confidence;
      status(state.role === "sender"
        ? "Open Hand ✓ — simply close your hand to ✊ for Air Copy."
        : "Open Hand ✓ — simply close your hand to ✊ for Air Paste.");
      toast("Open Hand ✓ — now close your hand");
    }
    return;
  }

  if (name === "Closed_Fist" && state.gestureSequencePhase === "waiting-close" && now <= state.gestureSequenceExpiresAt) {
    const combinedConfidence = Math.min(1, (state.gestureOpenConfidence + confidence) / 2);
    resetGestureSequence();
    await fireAirGestureSequence(combinedConfidence);
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

      // ULTRA-EASY GESTURE MODE:
      // A single accepted Open Palm frame latches OPEN.
      // A single accepted Closed Fist frame after that completes Air Copy/Air Paste.
      // No hold, no repeated-frame confirmation, and intermediate motion is ignored.
      const simple = window.AirGestureCore.resolveSimpleGesture(result);
      const name = simple.name;
      const rawScore = simple.score;
      updateGestureHUD(name, rawScore);

      const now = performance.now();
      if (state.gestureSequencePhase === 'waiting-close' && now > state.gestureSequenceExpiresAt) {
        resetGestureSequence();
        status(state.role === 'sender'
          ? 'Ready. Show ✋ once, then simply close to ✊ for Air Copy.'
          : 'Ready. Show ✋ once, then simply close to ✊ for Air Paste.');
      }

      if (now >= state.gestureCooldownUntil) {
        if (name === 'Open_Palm' && state.gestureSequencePhase === 'waiting-open') {
          await handleStableGesture('Open_Palm', rawScore);
        } else if (name === 'Closed_Fist' && state.gestureSequencePhase === 'waiting-close') {
          await handleStableGesture('Closed_Fist', rawScore);
          state.gestureCooldownUntil = performance.now() + GESTURE_COOLDOWN_MS;
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

function switchView(id) {
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === id));
  document.querySelectorAll(".nav-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === id));
  if (id === "analyticsView") setTimeout(refreshAnalytics, 50);
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
  $("themeBtn").addEventListener("click", () => { document.body.classList.toggle("light"); if ($("analyticsView").classList.contains("active")) refreshAnalytics(); });
  window.addEventListener("resize", () => state.cameraRunning && resizeOverlay());
  window.addEventListener("beforeunload", () => { state.ws?.close(); stopCamera(); });
}

function init() {
  $("roomInput").value = randomRoom();
  bindEvents();
  setRole("sender");
  setProgress(0);
  refreshAnalytics();
}

init();
