const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../public/core.js');

test('room codes accept safe values and reject unsafe values', () => {
  assert.equal(core.isValidRoom('DBA802'), true);
  assert.equal(core.isValidRoom('NOVA-527'), true);
  assert.equal(core.isValidRoom('A'), false);
  assert.equal(core.isValidRoom('ROOM WITH SPACE'), false);
  assert.equal(core.isValidRoom('<script>'), false);
});

test('open hand then closed fist completes one Air Copy/Paste sequence', () => {
  const a = core.transitionAirGesture({}, 'Open_Palm', 1000, 8000);
  assert.equal(a.phase, 'waiting-close');
  assert.equal(a.fired, false);
  const b = core.transitionAirGesture(a, 'Closed_Fist', 1800, 8000);
  assert.equal(b.phase, 'waiting-open');
  assert.equal(b.fired, true);
});

test('closed fist without an open hand does not fire', () => {
  const result = core.transitionAirGesture({}, 'Closed_Fist', 1000, 8000);
  assert.equal(result.fired, false);
  assert.equal(result.phase, 'waiting-open');
});

test('gesture sequence expires and requires a fresh open hand', () => {
  const a = core.transitionAirGesture({}, 'Open_Palm', 1000, 1000);
  const b = core.transitionAirGesture(a, 'Closed_Fist', 2501, 1000);
  assert.equal(b.fired, false);
  assert.equal(b.phase, 'waiting-open');
});

test('manual Air Copy requires sender file, P2P channel, and idle state', () => {
  const base = { role: 'sender', selectedFile: true, channelOpen: true, sending: false, waitingAcceptance: false, awaitingAck: false };
  assert.equal(core.canAirCopy(base), true);
  assert.equal(core.canAirCopy({ ...base, selectedFile: false }), false);
  assert.equal(core.canAirCopy({ ...base, channelOpen: false }), false);
  assert.equal(core.canAirCopy({ ...base, waitingAcceptance: true }), false);
  assert.equal(core.canAirCopy({ ...base, role: 'receiver' }), false);
});

test('manual Air Paste requires receiver incoming request and idle state', () => {
  const base = { role: 'receiver', pendingRequest: true, channelOpen: true, receiving: false, acceptedTransferId: null };
  assert.equal(core.canAirPaste(base), true);
  assert.equal(core.canAirPaste({ ...base, pendingRequest: false }), false);
  assert.equal(core.canAirPaste({ ...base, channelOpen: false }), false);
  assert.equal(core.canAirPaste({ ...base, acceptedTransferId: 'x' }), false);
  assert.equal(core.canAirPaste({ ...base, role: 'sender' }), false);
});

test('receiver byte-count verification catches truncation and overflow', () => {
  assert.equal(core.verifyTransferSize(100, 100), true);
  assert.equal(core.verifyTransferSize(100, 99), false);
  assert.equal(core.verifyTransferSize(100, 101), false);
  assert.equal(core.verifyTransferSize(-1, -1), false);
});


test('easy geometry detects a clearly open four-finger hand independent of image orientation', () => {
  const lm = Array.from({length:21}, () => ({x:0,y:0,z:0}));
  lm[0]={x:0,y:0.9,z:0}; lm[5]={x:-0.3,y:0.55,z:0}; lm[9]={x:0,y:0.5,z:0}; lm[13]={x:0.25,y:0.55,z:0}; lm[17]={x:0.45,y:0.65,z:0};
  const defs=[[5,6,8,-0.3],[9,10,12,0],[13,14,16,0.25],[17,18,20,0.45]];
  for (const [mcp,pip,tip,x] of defs) { lm[pip]={x,y:0.3,z:0}; lm[tip]={x,y:0.05,z:0}; }
  const r=core.classifyHandGeometry(lm);
  assert.equal(r.name,'Open_Palm');
});

test('ultra-easy mode accepts clear model labels even at low raw confidence', () => {
  const open=core.resolveSimpleGesture({gestures:[[{categoryName:'Open_Palm',score:0.20}]],landmarks:[]});
  const close=core.resolveSimpleGesture({gestures:[[{categoryName:'Closed_Fist',score:0.18}]],landmarks:[]});
  assert.equal(open.name,'Open_Palm');
  assert.equal(close.name,'Closed_Fist');
  assert.ok(open.score >= 0.60);
  assert.ok(close.score >= 0.60);
});

test('transfer mode normalization uses the single universal workflow', () => {
  assert.equal(core.normalizeMode('peer'), 'universal');
  assert.equal(core.normalizeMode('broadcast'), 'universal');
  assert.equal(core.normalizeMode('anything-else'), 'universal');
});

test('broadcast KPI summary calculates connected, accepted, completed, failed and waiting', () => {
  const summary = core.summarizeBroadcast([
    { acceptedAt: 1, completedAt: 2 },
    { acceptedAt: 1 },
    { failedAt: 3 },
    {}
  ]);
  assert.deepEqual(summary, {
    connected: 4,
    accepted: 2,
    completed: 1,
    failed: 1,
    waiting: 2,
    completionRate: 25
  });
});
