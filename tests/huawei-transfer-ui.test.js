const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'public','styles.css'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');

test('V4 UI has every app.js DOM id',()=>{
  const used=[...app.matchAll(/\$\(["']([^"']+)["']\)/g)].map(m=>m[1]);
  const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]));
  assert.deepEqual([...new Set(used)].filter(id=>!ids.has(id)),[]);
});

test('privacy mode blurs the camera but redraws a clear hand spotlight',()=>{
  assert.match(css,/video\{[^}]*filter:blur\(14px\)/);
  assert.match(app,/function drawPrivateHandSpotlight/);
  assert.match(app,/ctx\.ellipse/);
  assert.match(app,/ctx\.drawImage\(video/);
  assert.match(html,/FACE PRIVACY ON/);
});

test('uploaded file never overlays the camera stage',()=>{
  assert.doesNotMatch(html,/floatingFile|floatingImage|floatingDoc/);
  assert.doesNotMatch(app,/floatingFile|floatingImage|floatingDoc/);
});

test('sender has Huawei-inspired outgoing bubble animation',()=>{
  assert.match(html,/id="transferBubble"/);
  assert.match(app,/animateOutgoingBubble/);
  assert.match(css,/@keyframes bubbleFly/);
});

test('receiver uses glow and bubble instead of screen shake',()=>{
  assert.match(html,/id="incomingBubble"/);
  assert.match(css,/@keyframes floatBubble/);
  assert.match(css,/@keyframes ambientGlow/);
  assert.doesNotMatch(css,/screenShock/);
});

test('receiver reveals the downloaded file through incoming bubble animation',()=>{
  assert.match(app,/animateIncomingBubble/);
  assert.match(css,/@keyframes bubbleArrive/);
});

test('V3 transfer intent protocol remains intact',()=>{
  assert.match(app,/type:"broadcast-intent"/);
  assert.match(server,/broadcast-intent/);
  assert.match(server,/room\.intent/);
});

test('gesture stability and camera resilience remain enabled',()=>{
  assert.match(app,/STABLE_FRAMES=4/);
  assert.match(app,/ACTION_COOLDOWN_MS=700/);
  assert.match(app,/cameraToken/);
  assert.match(app,/using CPU/i);
});
