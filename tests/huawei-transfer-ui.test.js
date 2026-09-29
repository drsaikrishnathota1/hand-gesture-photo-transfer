const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'public','styles.css'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');

test('minimal V3 UI has every app.js DOM id',()=>{
  const used=[...app.matchAll(/\$\(["']([^"']+)["']\)/g)].map(m=>m[1]);
  const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]));
  const missing=[...new Set(used)].filter(id=>!ids.has(id));
  assert.deepEqual(missing,[]);
});

test('camera never overlays the selected file',()=>{
  assert.doesNotMatch(html,/floatingFile|floatingImage|floatingDoc/);
  assert.doesNotMatch(app,/floatingFile|floatingImage|floatingDoc/);
  assert.match(html,/id="video"/);
  assert.match(html,/id="overlay"/);
});

test('gesture flow matches sender grab and receiver release',()=>{
  assert.match(app,/Open_Palm/);
  assert.match(app,/Closed_Fist/);
  assert.match(app,/STABLE_FRAMES=4/);
  assert.match(app,/PHASE_TIMEOUT_MS=12000/);
  assert.match(app,/ACTION_COOLDOWN_MS=700/);
});

test('receiver has immersive incoming alert',()=>{
  assert.match(html,/id="incomingOverlay"/);
  assert.match(css,/@keyframes screenShock/);
  assert.match(app,/navigator\.vibrate/);
});

test('sender publishes immediate intent before upload completes',()=>{
  assert.match(app,/type:"broadcast-intent"/);
  assert.match(server,/data\.type === 'broadcast-intent'/);
  assert.match(server,/room\.intent/);
  assert.match(server,/broadcast-intent-cancelled/);
});

test('camera start is resilient',()=>{
  assert.match(app,/requestCameraStream/);
  assert.match(app,/OverconstrainedError/);
  assert.match(app,/using CPU/i);
  assert.match(app,/cameraToken/);
});
