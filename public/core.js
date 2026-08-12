(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AirGestureCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function normalizeRole(role) {
    return role === 'receiver' ? 'receiver' : 'sender';
  }

  function normalizeMode() {
    return 'universal';
  }

  function isValidRoom(room) {
    return /^[A-Z0-9-]{2,12}$/.test(String(room || '').trim().toUpperCase());
  }

  function canAirCopy(state) {
    return normalizeRole(state?.role) === 'sender' && Boolean(
      state?.selectedFile && state?.channelOpen && !state?.sending && !state?.waitingAcceptance && !state?.awaitingAck
    );
  }

  function canAirPaste(state) {
    return normalizeRole(state?.role) === 'receiver' && Boolean(
      state?.pendingRequest && state?.channelOpen && !state?.receiving && !state?.acceptedTransferId
    );
  }

  function transitionAirGesture(sequence = {}, gesture, now, timeoutMs = 8000) {
    let phase = sequence.phase === 'waiting-close' ? 'waiting-close' : 'waiting-open';
    let expiresAt = Number(sequence.expiresAt) || 0;
    if (phase === 'waiting-close' && Number(now) > expiresAt) {
      phase = 'waiting-open';
      expiresAt = 0;
    }
    if (gesture === 'Open_Palm' && phase === 'waiting-open') {
      return { phase: 'waiting-close', expiresAt: Number(now) + timeoutMs, fired: false };
    }
    if (gesture === 'Closed_Fist' && phase === 'waiting-close' && Number(now) <= expiresAt) {
      return { phase: 'waiting-open', expiresAt: 0, fired: true };
    }
    return { phase, expiresAt, fired: false };
  }

  function verifyTransferSize(expected, received) {
    const e = Number(expected);
    const r = Number(received);
    return Number.isFinite(e) && Number.isFinite(r) && e >= 0 && e === r;
  }

  function distance(a, b) {
    if (!a || !b) return 0;
    const dx = (a.x || 0) - (b.x || 0);
    const dy = (a.y || 0) - (b.y || 0);
    const dz = (a.z || 0) - (b.z || 0);
    return Math.hypot(dx, dy, dz);
  }

  function angleDegrees(a, b, c) {
    if (!a || !b || !c) return 0;
    const v1 = { x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) };
    const v2 = { x: c.x - b.x, y: c.y - b.y, z: (c.z || 0) - (b.z || 0) };
    const d1 = Math.hypot(v1.x, v1.y, v1.z);
    const d2 = Math.hypot(v2.x, v2.y, v2.z);
    if (!d1 || !d2) return 0;
    const cosine = Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y + v1.z * v2.z) / (d1 * d2)));
    return Math.acos(cosine) * 180 / Math.PI;
  }

  // Rotation-independent, intentionally forgiving geometry classifier.
  // Thumb position is ignored because thumb orientation varies strongly by camera angle.
  function classifyHandGeometry(landmarks) {
    if (!Array.isArray(landmarks) || landmarks.length < 21) return { name: '', score: 0, source: 'geometry' };

    const fingers = [
      [5, 6, 8],   // index MCP, PIP, tip
      [9, 10, 12], // middle
      [13, 14, 16],// ring
      [17, 18, 20] // pinky
    ];

    let straight = 0;
    let bent = 0;
    const angles = [];
    for (const [mcp, pip, tip] of fingers) {
      const angle = angleDegrees(landmarks[mcp], landmarks[pip], landmarks[tip]);
      angles.push(angle);
      if (angle >= 125) straight += 1;
      if (angle <= 140) bent += 1;
    }

    const palmCenter = {
      x: (landmarks[0].x + landmarks[5].x + landmarks[9].x + landmarks[13].x + landmarks[17].x) / 5,
      y: (landmarks[0].y + landmarks[5].y + landmarks[9].y + landmarks[13].y + landmarks[17].y) / 5,
      z: ((landmarks[0].z || 0) + (landmarks[5].z || 0) + (landmarks[9].z || 0) + (landmarks[13].z || 0) + (landmarks[17].z || 0)) / 5
    };
    const palmScale = Math.max(0.0001, distance(landmarks[0], landmarks[9]));
    const tipIndices = [8, 12, 16, 20];
    const avgTipDistance = tipIndices.reduce((sum, i) => sum + distance(landmarks[i], palmCenter), 0) / tipIndices.length;
    const openness = avgTipDistance / palmScale;

    // Easy Open: any 3 of the 4 fingers reasonably straight OR hand is clearly spread out.
    if (straight >= 3 || (straight >= 2 && openness >= 1.08)) {
      const score = Math.min(0.99, 0.82 + straight * 0.035 + Math.max(0, openness - 1.1) * 0.08);
      return { name: 'Open_Palm', score, source: 'geometry', straight, bent, openness, angles };
    }

    // Easy Close: any 3 fingers visibly bent, with a relaxed fallback for a compact hand.
    if (bent >= 3 || (bent >= 2 && openness <= 1.10)) {
      const score = Math.min(0.99, 0.82 + bent * 0.035 + Math.max(0, 1.05 - openness) * 0.08);
      return { name: 'Closed_Fist', score, source: 'geometry', straight, bent, openness, angles };
    }

    return { name: '', score: 0, source: 'geometry', straight, bent, openness, angles };
  }

  function resolveSimpleGesture(result) {
    const category = result?.gestures?.[0]?.[0];
    const modelName = category?.categoryName || '';
    const modelScore = Number(category?.score) || 0;
    const landmarks = result?.landmarks?.[0];
    const geometry = classifyHandGeometry(landmarks);

    // Geometry is deliberately preferred when it clearly sees open/closed.
    // This rescues common cases where MediaPipe reports "None" for a slightly tilted hand.
    if (geometry.name) return geometry;

    // Lower model threshold because the Open→Close sequence itself already protects against accidental actions.
    if (['Open_Palm', 'Closed_Fist'].includes(modelName) && modelScore >= 0.15) {
      return { name: modelName, score: Math.max(0.60, modelScore), source: 'model' };
    }

    return { name: 'None', score: modelScore, source: 'none' };
  }

  function summarizeBroadcast(receiverStates = []) {
    const rows = Array.isArray(receiverStates) ? receiverStates : [];
    const connected = rows.length;
    const accepted = rows.filter((x) => Boolean(x?.acceptedAt)).length;
    const completed = rows.filter((x) => Boolean(x?.completedAt)).length;
    const failed = rows.filter((x) => Boolean(x?.failedAt)).length;
    return {
      connected,
      accepted,
      completed,
      failed,
      waiting: Math.max(0, connected - accepted),
      completionRate: connected ? Math.round((completed / connected) * 1000) / 10 : 0
    };
  }

  return {
    normalizeRole,
    normalizeMode,
    isValidRoom,
    summarizeBroadcast,
    canAirCopy,
    canAirPaste,
    transitionAirGesture,
    verifyTransferSize,
    angleDegrees,
    classifyHandGeometry,
    resolveSimpleGesture
  };
});
