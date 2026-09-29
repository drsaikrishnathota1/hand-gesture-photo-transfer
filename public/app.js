const $=(id)=>document.getElementById(id);
const MAX_FILE_SIZE=100*1024*1024;
const GESTURE_TIMEOUT=10000;

const state={
  role:"sender",room:"",ws:null,hostToken:"",
  selectedFile:null,pendingFile:null,receivedUrl:"",
  cameraStream:null,cameraRunning:false,aiReady:false,aiLoading:false,
  recognizer:null,vision:null,drawingUtils:null,raf:null,lastVideoTime:-1,
  gesturePhase:"waiting-open",gestureExpiresAt:0,lastConfidence:0,
  uploadBusy:false,downloadBusy:false
};

function toast(message){
  const el=$("toast"); if(!el)return;
  el.textContent=message; el.classList.add("show");
  clearTimeout(toast.t); toast.t=setTimeout(()=>el.classList.remove("show"),2200);
}
function status(message){$("statusText").textContent=message}
function setBadge(text,tone=""){$("actionBadge").textContent=text;$("actionBadge").className="pill "+tone}
function setCameraBadge(text,tone=""){$("cameraStatus").textContent=text;$("cameraStatus").className="pill "+tone}
function setProgress(v){const n=Math.max(0,Math.min(100,Number(v)||0));$("progressBar").style.width=n+"%";$("progressText").textContent=Math.round(n)+"%"}
function bytes(n){if(n<1024)return n+" B";if(n<1048576)return (n/1024).toFixed(1)+" KB";return (n/1048576).toFixed(1)+" MB"}
function randomRoom(){return Math.random().toString(36).slice(2,8).toUpperCase()}
function wsUrl(){return `${location.protocol==="https:"?"wss":"ws"}://${location.host}`}
function clientInfo(){
  const ua=navigator.userAgent;
  let os=/Mac/i.test(ua)?"macOS":/Windows/i.test(ua)?"Windows":/Android/i.test(ua)?"Android":/(iPhone|iPad)/i.test(ua)?"iOS":"Other";
  let browser=/Edg/i.test(ua)?"Edge":/Chrome/i.test(ua)?"Chrome":/Safari/i.test(ua)?"Safari":/Firefox/i.test(ua)?"Firefox":"Browser";
  return {browser,os,deviceType:/Mobi|Android|iPhone|iPad/i.test(ua)?"Mobile":"Desktop",timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||"",language:navigator.language||""};
}

function setRole(role){
  if(role!=="sender"&&role!=="receiver")return;
  if(state.ws){try{state.ws.close()}catch{} state.ws=null}
  state.role=role; state.hostToken=""; state.pendingFile=null; state.gesturePhase=role==="sender"?"waiting-open":"waiting-fist";
  document.querySelectorAll(".role-btn").forEach(b=>b.classList.toggle("active",b.dataset.role===role));
  $("senderPanel").hidden=role!=="sender"; $("receiverPanel").hidden=role!=="receiver";
  $("stepLabel").textContent=role==="sender"?"SENDER":"RECEIVER";
  $("actionTitle").textContent=role==="sender"?"Choose a file":"Wait for the incoming file";
  $("connectionText").textContent="Not connected";$("connectionDot").className="dot";setBadge("Waiting");
  syncInstruction();
}

function syncInstruction(){
  const hand=$("instructionHand"),title=$("instructionTitle"),text=$("instructionText");
  if(state.role==="sender"){
    if(!state.selectedFile){hand.textContent="📄";title.textContent="Select a file first";text.textContent="Choose an image or document, then start the camera.";return}
    if(state.gesturePhase==="waiting-close"){hand.textContent="✊";title.textContent="Now close your fist";text.textContent="Your open palm was detected. Close naturally to grab and send.";return}
    hand.textContent="✋";title.textContent="Show an open palm";text.textContent="Hold your hand in view, then close it into a fist.";
  }else{
    if(!state.pendingFile){hand.textContent="📡";title.textContent="Waiting for sender";text.textContent="When a file arrives, make a fist to catch it.";return}
    if(state.gesturePhase==="waiting-release"){hand.textContent="✋";title.textContent="Open your hand";text.textContent="File caught. Open your palm to release it onto this device.";return}
    hand.textContent="✊";title.textContent="Make a fist to catch";text.textContent="Incoming file detected. Close your hand, then open it.";
  }
}

function previewFile(file){
  const isImage=(file.type||"").startsWith("image/");
  $("floatingFile").hidden=false;
  $("floatingFile").className="floating-file";
  $("floatingFileName").textContent=file.name;
  $("floatingFileMeta").textContent=bytes(file.size);
  if(isImage){
    const url=URL.createObjectURL(file);
    $("floatingImage").src=url;$("floatingImage").hidden=false;$("floatingDoc").hidden=true;
  }else{$("floatingImage").hidden=true;$("floatingDoc").hidden=false}
}
function setSelectedFile(file){
  if(!file)return;
  if(file.size>MAX_FILE_SIZE){toast("Maximum file size is 100 MB");return}
  state.selectedFile=file;
  $("selectedFileCard").hidden=false;$("selectedFileName").textContent=file.name;$("selectedFileSize").textContent=bytes(file.size);
  const thumb=$("selectedThumb");thumb.innerHTML="";
  if((file.type||"").startsWith("image/")){const img=document.createElement("img");img.src=URL.createObjectURL(file);thumb.appendChild(img)}else thumb.textContent="📄";
  previewFile(file);state.gesturePhase="waiting-open";syncInstruction();setBadge("Ready","good");
  status("File ready. Connect the room, start the camera, show an open palm ✋, then close your fist ✊.");
  if(!state.cameraRunning) startCamera();
}

function connectRoom(){
  const room=$("roomInput").value.trim().toUpperCase();
  if(!window.AirGestureCore?.isValidRoom(room)){toast("Use 2–12 letters, numbers, or hyphens");return}
  if(state.ws){try{state.ws.close()}catch{}}
  state.room=room; state.hostToken=""; state.pendingFile=null;
  $("connectionText").textContent="Connecting…"; setBadge("Connecting","warn");
  const ws=new WebSocket(wsUrl());state.ws=ws;
  ws.onopen=()=>ws.send(JSON.stringify({type:"join",room,role:state.role,mode:"universal",clientInfo:clientInfo()}));
  ws.onmessage=(event)=>{
    let msg;try{msg=JSON.parse(event.data)}catch{return}
    if(msg.type==="broadcast-joined"){
      if(state.role==="sender")state.hostToken=msg.hostToken||"";
      $("connectionDot").className="dot live";$("connectionText").textContent=`Connected to ${msg.room}`;setBadge("Connected","good");
      if(state.role==="receiver"&&msg.file) applyIncoming(msg.file);
      status(state.role==="sender"?"Connected. Choose a file and use ✋ → ✊ to send.":"Connected. Waiting for the sender's file.");
      return;
    }
    if(msg.type==="broadcast-file-ready"){if(state.role==="receiver")applyIncoming(msg.file);return}
    if(msg.type==="broadcast-file-cleared"){state.pendingFile=null;syncInstruction();return}
    if(msg.type==="broadcast-host-left"){status("Sender disconnected. Current file may remain available briefly.");return}
    if(msg.type==="error"){toast(msg.message||"Room error");status(msg.message||"Room error")}
  };
  ws.onclose=()=>{if(state.ws===ws){$("connectionDot").className="dot";$("connectionText").textContent="Disconnected";setBadge("Offline")}};
  ws.onerror=()=>status("Could not connect to the room server.");
}

function applyIncoming(file){
  if(!file)return;
  state.pendingFile={fileId:file.id,name:file.name||"file",size:Number(file.size)||0,mime:file.mime||"application/octet-stream",sha256:file.sha256||""};
  state.gesturePhase="waiting-fist";setBadge("Incoming","warn");syncInstruction();
  $("receiverWaiting").querySelector("strong").textContent="Incoming file ready";
  $("receiverWaiting").querySelector("span").textContent=state.pendingFile.name;
  $("floatingFile").hidden=false;$("floatingFile").className="floating-file receiving";
  $("floatingFileName").textContent=state.pendingFile.name;$("floatingFileMeta").textContent=bytes(state.pendingFile.size);
  $("floatingImage").hidden=true;$("floatingDoc").hidden=false;
  status(`Incoming: ${state.pendingFile.name}. Make a fist ✊ to catch it, then open your hand ✋.`);
  if(!state.cameraRunning) startCamera();
}

async function uploadSelected(){
  if(state.uploadBusy||!state.selectedFile)return;
  if(!state.ws||state.ws.readyState!==WebSocket.OPEN||!state.hostToken){toast("Connect as sender first");return}
  state.uploadBusy=true;setBadge("Sending","warn");status("Uploading file to the room…");setProgress(0);
  $("floatingFile").classList.add("grabbed");pulse();
  try{
    const file=state.selectedFile;
    const result=await new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();
      xhr.open("POST",`/api/broadcast/${encodeURIComponent(state.room)}/upload`);xhr.responseType="json";
      xhr.setRequestHeader("Content-Type","application/octet-stream");
      xhr.setRequestHeader("X-AirGesture-Host-Token",state.hostToken);
      xhr.setRequestHeader("X-File-Name",encodeURIComponent(file.name));
      xhr.setRequestHeader("X-File-Size",String(file.size));
      xhr.setRequestHeader("X-File-Type",file.type||"application/octet-stream");
      const ci=clientInfo();
      xhr.setRequestHeader("X-AirGesture-Client-Browser",encodeURIComponent(ci.browser));
      xhr.setRequestHeader("X-AirGesture-Client-OS",encodeURIComponent(ci.os));
      xhr.setRequestHeader("X-AirGesture-Client-Device",encodeURIComponent(ci.deviceType));
      xhr.setRequestHeader("X-AirGesture-Client-Timezone",encodeURIComponent(ci.timezone));
      xhr.setRequestHeader("X-AirGesture-Client-Language",encodeURIComponent(ci.language));
      xhr.upload.onprogress=e=>{if(e.lengthComputable)setProgress(e.loaded/e.total*100)};
      xhr.onload=()=>xhr.status>=200&&xhr.status<300?resolve(xhr.response||{}):reject(new Error(xhr.response?.error||"Upload failed"));
      xhr.onerror=()=>reject(new Error("Upload failed"));
      xhr.send(file);
    });
    setProgress(100);setBadge("Sent","good");status("File grabbed and sent. The receiver can now catch and release it.");
    $("instructionHand").textContent="✓";$("instructionTitle").textContent="Sent to the room";$("instructionText").textContent="On the receiving device: make a fist ✊, then open ✋.";
    toast("File sent");
    return result;
  }catch(err){console.error(err);setBadge("Failed","warn");status(err.message||"Upload failed");$("floatingFile").classList.remove("grabbed")}
  finally{state.uploadBusy=false}
}

async function sha256Hex(blob){
  if(!crypto.subtle)return"";const digest=await crypto.subtle.digest("SHA-256",await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");
}

async function receivePending(){
  if(state.downloadBusy||!state.pendingFile)return;
  if(!state.ws||state.ws.readyState!==WebSocket.OPEN){toast("Reconnect the room");return}
  const req={...state.pendingFile};state.downloadBusy=true;setBadge("Receiving","warn");setProgress(0);pulse();
  state.ws.send(JSON.stringify({type:"broadcast-accept",fileId:req.fileId,trigger:"gesture",gestureConfidence:state.lastConfidence,clientInfo:clientInfo()}));
  const started=performance.now();
  try{
    const response=await fetch(`/api/broadcast/${encodeURIComponent(state.room)}/files/${encodeURIComponent(req.fileId)}`,{cache:"no-store"});
    if(!response.ok)throw new Error("Download failed");
    const total=Number(response.headers.get("content-length"))||req.size;const serverHash=response.headers.get("x-airgesture-sha256")||req.sha256||"";
    const reader=response.body?.getReader();const chunks=[];let got=0;
    if(reader){while(true){const {value,done}=await reader.read();if(done)break;chunks.push(value);got+=value.byteLength;setProgress(total?got/total*100:0)}}else{const buf=await response.arrayBuffer();chunks.push(new Uint8Array(buf));got=buf.byteLength}
    const blob=new Blob(chunks,{type:req.mime});if(req.size&&blob.size!==req.size)throw new Error("File size verification failed");
    if(serverHash){const local=await sha256Hex(blob);if(local&&local!==serverHash)throw new Error("Integrity verification failed")}
    if(state.receivedUrl)URL.revokeObjectURL(state.receivedUrl);state.receivedUrl=URL.createObjectURL(blob);
    showReceived(blob,req);setProgress(100);setBadge("Received","good");
    const duration=(performance.now()-started)/1000;
    state.ws.send(JSON.stringify({type:"broadcast-complete",fileId:req.fileId,durationSec:duration,speedMbps:duration?(blob.size*8/1e6/duration):0,gestureConfidence:state.lastConfidence,integrityVerified:true,clientInfo:clientInfo()}));
    status("Transfer complete. The file is now on this device.");toast("File received");
  }catch(err){console.error(err);setBadge("Failed","warn");status(err.message||"Receive failed")}
  finally{state.downloadBusy=false}
}

function showReceived(blob,req){
  $("receiverWaiting").hidden=true;$("receivedCard").hidden=false;$("receivedName").textContent=req.name;$("receivedSize").textContent=bytes(blob.size);
  const p=$("receivedPreview");p.innerHTML="";
  if((req.mime||"").startsWith("image/")){const img=document.createElement("img");img.src=state.receivedUrl;p.appendChild(img)}else p.textContent="📄";
  const a=$("downloadBtn");a.href=state.receivedUrl;a.download=req.name;
  $("floatingFile").hidden=false;$("floatingFile").className="floating-file receiving";
  if((req.mime||"").startsWith("image/")){$("floatingImage").src=state.receivedUrl;$("floatingImage").hidden=false;$("floatingDoc").hidden=true}else{$("floatingImage").hidden=true;$("floatingDoc").hidden=false}
  $("instructionHand").textContent="✓";$("instructionTitle").textContent="File received";$("instructionText").textContent="It has landed on this device. Preview or download it.";
}

function pulse(){const p=$("pulse");p.classList.remove("fire");void p.offsetWidth;p.classList.add("fire")}

async function importVision(){
  const sources=["https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/+esm","https://unpkg.com/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs"];
  let last;for(const src of sources){try{return await import(src)}catch(e){last=e}}throw last||new Error("MediaPipe could not load");
}
async function createRecognizer(vision){
  let fileset,last;for(const wasm of ["https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm","https://unpkg.com/@mediapipe/tasks-vision@0.10.35/wasm"]){try{fileset=await vision.FilesetResolver.forVisionTasks(wasm);break}catch(e){last=e}}
  if(!fileset)throw last;
  const options={baseOptions:{modelAssetPath:"https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task"},runningMode:"VIDEO",numHands:1,minHandDetectionConfidence:.6,minHandPresenceConfidence:.6,minTrackingConfidence:.6};
  return vision.GestureRecognizer.createFromOptions(fileset,options);
}
async function startCamera(){
  if(state.cameraRunning||state.aiLoading)return;
  try{
    state.cameraStream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},facingMode:"user"},audio:false});
    state.cameraRunning=true;$("video").srcObject=state.cameraStream;await $("video").play();resizeOverlay();
    $("startCameraBtn").disabled=true;$("stopCameraBtn").disabled=false;setCameraBadge("Loading AI","warn");state.aiLoading=true;
    const vision=await importVision();state.vision=vision;state.recognizer=await createRecognizer(vision);state.drawingUtils=new vision.DrawingUtils($("overlay").getContext("2d"));state.aiReady=true;state.aiLoading=false;setCameraBadge("Vision live","good");
    status(state.role==="sender"?"Show an open palm ✋, then close your fist ✊.":"When the file arrives, make a fist ✊, then open your palm ✋.");
    state.raf=requestAnimationFrame(predict);
  }catch(err){console.error(err);state.aiLoading=false;setCameraBadge("Camera unavailable","warn");toast("Allow camera permission and try again")}
}
function stopCamera(){
  state.cameraRunning=false;state.aiReady=false;if(state.raf)cancelAnimationFrame(state.raf);state.raf=null;
  try{state.recognizer?.close?.()}catch{}state.recognizer=null;state.cameraStream?.getTracks().forEach(t=>t.stop());state.cameraStream=null;$("video").srcObject=null;
  $("startCameraBtn").disabled=false;$("stopCameraBtn").disabled=true;setCameraBadge("Camera off");$("gestureName").textContent="Camera off";$("gestureIcon").textContent="✋";
}
function resizeOverlay(){const c=$("overlay"),v=$("video");c.width=v.videoWidth||1280;c.height=v.videoHeight||720}

async function onGesture(name,score){
  state.lastConfidence=score||0;const now=performance.now();
  if(state.role==="sender"){
    if(!state.selectedFile)return;
    if(state.gesturePhase==="waiting-close"&&now>state.gestureExpiresAt){state.gesturePhase="waiting-open";syncInstruction()}
    if(name==="Open_Palm"&&state.gesturePhase==="waiting-open"){state.gesturePhase="waiting-close";state.gestureExpiresAt=now+GESTURE_TIMEOUT;syncInstruction();setBadge("Palm detected","good");return}
    if(name==="Closed_Fist"&&state.gesturePhase==="waiting-close"&&now<=state.gestureExpiresAt){state.gesturePhase="done";syncInstruction();await uploadSelected()}
  }else{
    if(!state.pendingFile)return;
    if(state.gesturePhase==="waiting-release"&&now>state.gestureExpiresAt){state.gesturePhase="waiting-fist";syncInstruction()}
    if(name==="Closed_Fist"&&state.gesturePhase==="waiting-fist"){state.gesturePhase="waiting-release";state.gestureExpiresAt=now+GESTURE_TIMEOUT;$("floatingFile").classList.add("grabbed");syncInstruction();setBadge("Caught","good");return}
    if(name==="Open_Palm"&&state.gesturePhase==="waiting-release"&&now<=state.gestureExpiresAt){state.gesturePhase="done";$("floatingFile").classList.remove("grabbed");await receivePending()}
  }
}

async function predict(){
  state.raf=null;if(!state.cameraRunning||!state.aiReady||!state.recognizer)return;
  const v=$("video");
  if(v.readyState>=2&&v.currentTime!==state.lastVideoTime){
    state.lastVideoTime=v.currentTime;resizeOverlay();
    try{
      const result=state.recognizer.recognizeForVideo(v,performance.now());const ctx=$("overlay").getContext("2d");ctx.clearRect(0,0,$("overlay").width,$("overlay").height);
      if(result.landmarks?.length){for(const lm of result.landmarks){state.drawingUtils.drawConnectors(lm,state.vision.GestureRecognizer.HAND_CONNECTIONS,{color:"#47dbff",lineWidth:3});state.drawingUtils.drawLandmarks(lm,{color:"#8b7dff",radius:3})}}
      const simple=window.AirGestureCore.resolveSimpleGesture(result);const friendly=simple.name==="Open_Palm"?"Open Palm ✋":simple.name==="Closed_Fist"?"Closed Fist ✊":"Hand detected";
      $("gestureName").textContent=friendly;$("gestureIcon").textContent=simple.name==="Closed_Fist"?"✊":"✋";
      if(simple.name==="Open_Palm"||simple.name==="Closed_Fist")await onGesture(simple.name,simple.score);
    }catch(err){console.error(err)}
  }
  if(state.cameraRunning&&state.aiReady)state.raf=requestAnimationFrame(predict);
}

document.querySelectorAll(".role-btn").forEach(b=>b.addEventListener("click",()=>setRole(b.dataset.role)));
$("newRoomBtn").addEventListener("click",()=>{$("roomInput").value=randomRoom()});
$("connectBtn").addEventListener("click",connectRoom);
$("chooseFileBtn").addEventListener("click",()=>$("fileInput").click());
$("fileInput").addEventListener("change",e=>setSelectedFile(e.target.files?.[0]));
$("startCameraBtn").addEventListener("click",startCamera);
$("stopCameraBtn").addEventListener("click",stopCamera);
window.addEventListener("resize",resizeOverlay);
window.addEventListener("beforeunload",()=>{try{state.ws?.close()}catch{}stopCamera()});
$("roomInput").value=randomRoom();
setRole("sender");setProgress(0);
