const $=(id)=>document.getElementById(id);
const MAX_FILE_SIZE=100*1024*1024;
const PHASE_TIMEOUT=10000;
const STABLE_FRAMES=3;

const state={
  role:"sender",room:"",ws:null,hostToken:"",
  selectedFile:null,pendingFile:null,receivedUrl:"",
  cameraStream:null,cameraRunning:false,aiReady:false,aiLoading:false,
  recognizer:null,vision:null,drawingUtils:null,raf:null,lastVideoTime:-1,
  phase:"waiting-open",expiresAt:0,lastConfidence:0,
  candidate:"",candidateFrames:0,
  uploadBusy:false,downloadBusy:false
};

function toast(msg){const e=$("toast");e.textContent=msg;e.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove("show"),2200)}
function status(msg){$("statusText").textContent=msg}
function setTransferState(text,tone=""){$("transferState").textContent=text;$("transferState").className="status-chip "+tone}
function setCameraState(text,tone=""){$("cameraStatus").textContent=text;$("cameraStatus").className="status-chip "+tone}
function setProgress(v){$("progressBar").style.width=Math.max(0,Math.min(100,Number(v)||0))+"%"}
function bytes(n){if(n<1024)return n+" B";if(n<1048576)return (n/1024).toFixed(1)+" KB";return (n/1048576).toFixed(1)+" MB"}
function randomRoom(){return Math.random().toString(36).slice(2,8).toUpperCase()}
function wsUrl(){return `${location.protocol==="https:"?"wss":"ws"}://${location.host}`}
function clientInfo(){
  const ua=navigator.userAgent;
  return {
    browser:/Edg/i.test(ua)?"Edge":/Chrome/i.test(ua)?"Chrome":/Safari/i.test(ua)?"Safari":/Firefox/i.test(ua)?"Firefox":"Browser",
    os:/Mac/i.test(ua)?"macOS":/Windows/i.test(ua)?"Windows":/Android/i.test(ua)?"Android":/(iPhone|iPad)/i.test(ua)?"iOS":"Other",
    deviceType:/Mobi|Android|iPhone|iPad/i.test(ua)?"Mobile":"Desktop",
    timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||"",
    language:navigator.language||""
  };
}

function setConnection(live,text){
  $("connectionPill").className="connection-pill "+(live?"live":"offline");
  $("connectionPill").querySelector("span").textContent=text;
}

function setRole(role){
  if(!["sender","receiver"].includes(role))return;
  if(state.ws){try{state.ws.close()}catch{}}
  state.ws=null;state.hostToken="";state.pendingFile=null;
  state.role=role;state.phase=role==="sender"?"waiting-open":"waiting-fist";
  document.querySelectorAll(".role-btn").forEach(b=>b.classList.toggle("active",b.dataset.role===role));
  $("senderPanel").hidden=role!=="sender";
  $("receiverPanel").hidden=role!=="receiver";
  $("roleLabel").textContent=role==="sender"?"SENDER":"RECEIVER";
  $("transferTitle").textContent=role==="sender"?"Pick a file.":"Ready to receive.";
  setConnection(false,"Not connected");
  setTransferState("Idle");
  hideIncoming();
  syncGuide();
}

function syncGuide(){
  if(state.role==="sender"){
    if(!state.selectedFile){
      $("guideHand").textContent="＋";
      $("guideTitle").textContent="Choose a file";
      $("guideText").textContent="Then start the camera.";
    }else if(state.phase==="waiting-close"){
      $("guideHand").textContent="✊";
      $("guideTitle").textContent="Close your fist";
      $("guideText").textContent="This sends the file request.";
    }else{
      $("guideHand").textContent="✋";
      $("guideTitle").textContent="Open palm";
      $("guideText").textContent="Then close your fist to send.";
    }
  }else{
    if(!state.pendingFile){
      $("guideHand").textContent="·";
      $("guideTitle").textContent="Waiting";
      $("guideText").textContent="Stay connected to the room.";
    }else if(state.phase==="waiting-release"){
      $("guideHand").textContent="✋";
      $("guideTitle").textContent="Open your palm";
      $("guideText").textContent="Release to receive the file.";
    }else{
      $("guideHand").textContent="✊";
      $("guideTitle").textContent="Make a fist";
      $("guideText").textContent="Then open your palm.";
    }
  }
}

function setSelectedFile(file){
  if(!file)return;
  if(file.size>MAX_FILE_SIZE){toast("Maximum file size is 100 MB");return}
  state.selectedFile=file;state.phase="waiting-open";
  $("selectedFileCard").hidden=false;
  $("selectedFileName").textContent=file.name;
  $("selectedFileSize").textContent=bytes(file.size);
  const icon=$("selectedIcon");icon.innerHTML="";
  if((file.type||"").startsWith("image/")){
    const img=document.createElement("img");img.src=URL.createObjectURL(file);icon.appendChild(img);
  }else icon.textContent="📄";
  setTransferState("Ready","good");
  status("Open palm ✋, then close fist ✊.");
  syncGuide();
}

function connectRoom(){
  const room=$("roomInput").value.trim().toUpperCase();
  if(!window.AirGestureCore?.isValidRoom(room)){toast("Use 2–12 letters, numbers, or hyphens");return}
  if(state.ws){try{state.ws.close()}catch{}}
  state.room=room;state.hostToken="";state.pendingFile=null;setConnection(false,"Connecting…");setTransferState("Connecting","warn");
  const ws=new WebSocket(wsUrl());state.ws=ws;
  ws.onopen=()=>ws.send(JSON.stringify({type:"join",room,role:state.role,mode:"universal",clientInfo:clientInfo()}));
  ws.onmessage=(event)=>{
    let msg;try{msg=JSON.parse(event.data)}catch{return}
    if(msg.type==="broadcast-joined"){
      if(state.role==="sender")state.hostToken=msg.hostToken||"";
      setConnection(true,`Room ${msg.room}`);setTransferState("Connected","good");
      if(state.role==="receiver"&&msg.file)incomingFile(msg.file);
      status(state.role==="sender"?"Connected. Choose a file.":"Connected. Waiting for sender.");
      return;
    }
    if(msg.type==="broadcast-file-ready"){
      if(state.role==="receiver")incomingFile(msg.file);
      return;
    }
    if(msg.type==="broadcast-file-cleared"){
      state.pendingFile=null;hideIncoming();syncGuide();return;
    }
    if(msg.type==="broadcast-host-left"){status("Sender left the room.");return}
    if(msg.type==="error"){toast(msg.message||"Room error");status(msg.message||"Room error")}
  };
  ws.onclose=()=>{if(state.ws===ws){setConnection(false,"Disconnected");setTransferState("Offline")}};
  ws.onerror=()=>status("Could not connect to the room.");
}

function incomingFile(file){
  if(!file)return;
  state.pendingFile={fileId:file.id,name:file.name||"file",size:Number(file.size)||0,mime:file.mime||"application/octet-stream",sha256:file.sha256||""};
  state.phase="waiting-fist";
  $("incomingFileName").textContent=state.pendingFile.name;
  $("receiverStandby").querySelector("strong").textContent="File request received";
  $("receiverStandby").querySelector("span").textContent=state.pendingFile.name;
  setTransferState("Incoming","warn");
  status("Incoming request. Make a fist ✊, then open your palm ✋.");
  syncGuide();
  showIncoming();
  if(navigator.vibrate) navigator.vibrate([120,70,180]);
}

function showIncoming(){
  const o=$("incomingOverlay");o.hidden=false;o.classList.remove("active");void o.offsetWidth;o.classList.add("active");
}
function hideIncoming(){const o=$("incomingOverlay");o.hidden=true;o.classList.remove("active")}
function showSent(){
  const o=$("sentOverlay");o.hidden=false;clearTimeout(showSent.t);showSent.t=setTimeout(()=>o.hidden=true,3500);
}

async function uploadSelected(){
  if(state.uploadBusy||!state.selectedFile)return;
  if(!state.ws||state.ws.readyState!==WebSocket.OPEN||!state.hostToken){toast("Connect as sender first");state.phase="waiting-open";syncGuide();return}
  state.uploadBusy=true;setTransferState("Sending","warn");setProgress(0);status("Sending request…");
  try{
    const file=state.selectedFile;
    await new Promise((resolve,reject)=>{
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
    setProgress(100);setTransferState("Request sent","good");status("Request sent. Waiting for receiver.");showSent();toast("Request sent");
    $("guideHand").textContent="✓";$("guideTitle").textContent="Request sent";$("guideText").textContent="Waiting for the receiver.";
  }catch(err){console.error(err);setTransferState("Failed","warn");status(err.message||"Upload failed");state.phase="waiting-open";syncGuide()}
  finally{state.uploadBusy=false}
}

async function sha256Hex(blob){
  if(!crypto.subtle)return"";const d=await crypto.subtle.digest("SHA-256",await blob.arrayBuffer());
  return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,"0")).join("");
}

async function receivePending(){
  if(state.downloadBusy||!state.pendingFile)return;
  if(!state.ws||state.ws.readyState!==WebSocket.OPEN){toast("Reconnect the room");return}
  const req={...state.pendingFile};state.downloadBusy=true;hideIncoming();setTransferState("Receiving","warn");setProgress(0);
  state.ws.send(JSON.stringify({type:"broadcast-accept",fileId:req.fileId,trigger:"gesture",gestureConfidence:state.lastConfidence,clientInfo:clientInfo()}));
  const started=performance.now();
  try{
    const response=await fetch(`/api/broadcast/${encodeURIComponent(state.room)}/files/${encodeURIComponent(req.fileId)}`,{cache:"no-store"});
    if(!response.ok)throw new Error("Download failed");
    const total=Number(response.headers.get("content-length"))||req.size;
    const serverHash=response.headers.get("x-airgesture-sha256")||req.sha256||"";
    const reader=response.body?.getReader(),chunks=[];let got=0;
    if(reader){while(true){const {value,done}=await reader.read();if(done)break;chunks.push(value);got+=value.byteLength;setProgress(total?got/total*100:0)}}else{const b=await response.arrayBuffer();chunks.push(new Uint8Array(b));got=b.byteLength}
    const blob=new Blob(chunks,{type:req.mime});
    if(req.size&&blob.size!==req.size)throw new Error("File verification failed");
    if(serverHash){const local=await sha256Hex(blob);if(local&&local!==serverHash)throw new Error("Integrity verification failed")}
    if(state.receivedUrl)URL.revokeObjectURL(state.receivedUrl);
    state.receivedUrl=URL.createObjectURL(blob);
    renderReceived(blob,req);
    setProgress(100);setTransferState("Received","good");status("File received.");toast("File received");
    const duration=(performance.now()-started)/1000;
    state.ws.send(JSON.stringify({type:"broadcast-complete",fileId:req.fileId,durationSec:duration,speedMbps:duration?(blob.size*8/1e6/duration):0,gestureConfidence:state.lastConfidence,integrityVerified:true,clientInfo:clientInfo()}));
  }catch(err){console.error(err);setTransferState("Failed","warn");status(err.message||"Receive failed");state.phase="waiting-fist";syncGuide()}
  finally{state.downloadBusy=false}
}

function renderReceived(blob,req){
  $("receiverStandby").hidden=true;$("receivedCard").hidden=false;
  $("receivedName").textContent=req.name;$("receivedSize").textContent=bytes(blob.size);
  const p=$("receivedPreview");p.innerHTML="";
  if((req.mime||"").startsWith("image/")){const img=document.createElement("img");img.src=state.receivedUrl;p.appendChild(img)}else p.textContent="📄";
  $("downloadBtn").href=state.receivedUrl;$("downloadBtn").download=req.name;
  $("guideHand").textContent="✓";$("guideTitle").textContent="Received";$("guideText").textContent="The file is now on this device.";
}

async function importVision(){
  const sources=["https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/+esm","https://unpkg.com/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs"];
  let last;for(const src of sources){try{return await import(src)}catch(e){last=e}}throw last||new Error("Vision AI failed to load");
}
async function createRecognizer(vision){
  let fs,last;
  for(const wasm of ["https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm","https://unpkg.com/@mediapipe/tasks-vision@0.10.35/wasm"]){try{fs=await vision.FilesetResolver.forVisionTasks(wasm);break}catch(e){last=e}}
  if(!fs)throw last;
  return vision.GestureRecognizer.createFromOptions(fs,{
    baseOptions:{modelAssetPath:"https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task"},
    runningMode:"VIDEO",numHands:1,minHandDetectionConfidence:.55,minHandPresenceConfidence:.55,minTrackingConfidence:.55
  });
}

async function startCamera(){
  if(state.cameraRunning||state.aiLoading)return;
  try{
    state.cameraStream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},facingMode:"user"},audio:false});
    state.cameraRunning=true;$("video").srcObject=state.cameraStream;await $("video").play();resizeOverlay();
    $("cameraPrompt").classList.add("hidden");$("startCameraBtn").disabled=true;$("stopCameraBtn").disabled=false;
    setCameraState("Loading AI","warn");state.aiLoading=true;
    const vision=await importVision();state.vision=vision;state.recognizer=await createRecognizer(vision);state.drawingUtils=new vision.DrawingUtils($("overlay").getContext("2d"));
    state.aiReady=true;state.aiLoading=false;setCameraState("Vision live","good");status(state.role==="sender"?"Open palm ✋, then close fist ✊.":"Make a fist ✊, then open palm ✋.");
    state.raf=requestAnimationFrame(predict);
  }catch(err){console.error(err);state.aiLoading=false;setCameraState("Camera blocked","warn");toast("Allow camera permission and try again")}
}
function stopCamera(){
  state.cameraRunning=false;state.aiReady=false;if(state.raf)cancelAnimationFrame(state.raf);state.raf=null;
  try{state.recognizer?.close?.()}catch{}state.recognizer=null;state.cameraStream?.getTracks().forEach(t=>t.stop());state.cameraStream=null;$("video").srcObject=null;
  $("cameraPrompt").classList.remove("hidden");$("startCameraBtn").disabled=false;$("stopCameraBtn").disabled=true;setCameraState("Camera off");
  $("gestureName").textContent="Waiting";$("gestureIcon").textContent="·";
}
function resizeOverlay(){const c=$("overlay"),v=$("video");c.width=v.videoWidth||1280;c.height=v.videoHeight||720}

async function handleGesture(name,score){
  state.lastConfidence=score||0;const now=performance.now();
  if(state.role==="sender"){
    if(!state.selectedFile)return;
    if(state.phase==="waiting-close"&&now>state.expiresAt){state.phase="waiting-open";syncGuide()}
    if(name==="Open_Palm"&&state.phase==="waiting-open"){state.phase="waiting-close";state.expiresAt=now+PHASE_TIMEOUT;setTransferState("Palm detected","good");syncGuide();return}
    if(name==="Closed_Fist"&&state.phase==="waiting-close"&&now<=state.expiresAt){state.phase="sent";await uploadSelected()}
  }else{
    if(!state.pendingFile)return;
    if(state.phase==="waiting-release"&&now>state.expiresAt){state.phase="waiting-fist";syncGuide()}
    if(name==="Closed_Fist"&&state.phase==="waiting-fist"){state.phase="waiting-release";state.expiresAt=now+PHASE_TIMEOUT;setTransferState("Caught","good");syncGuide();return}
    if(name==="Open_Palm"&&state.phase==="waiting-release"&&now<=state.expiresAt){state.phase="received";await receivePending()}
  }
}

async function predict(){
  state.raf=null;if(!state.cameraRunning||!state.aiReady||!state.recognizer)return;
  const v=$("video");
  if(v.readyState>=2&&v.currentTime!==state.lastVideoTime){
    state.lastVideoTime=v.currentTime;resizeOverlay();
    try{
      const result=state.recognizer.recognizeForVideo(v,performance.now());
      const ctx=$("overlay").getContext("2d");ctx.clearRect(0,0,$("overlay").width,$("overlay").height);
      if(result.landmarks?.length){
        for(const lm of result.landmarks){
          state.drawingUtils.drawConnectors(lm,state.vision.GestureRecognizer.HAND_CONNECTIONS,{color:"#ffffff",lineWidth:4});
          state.drawingUtils.drawLandmarks(lm,{color:"#111318",fillColor:"#ffffff",radius:3});
        }
      }
      const g=window.AirGestureCore.resolveSimpleGesture(result);
      const supported=["Open_Palm","Closed_Fist"].includes(g.name);
      if(supported){
        if(state.candidate===g.name)state.candidateFrames++;else{state.candidate=g.name;state.candidateFrames=1}
        $("gestureName").textContent=g.name==="Open_Palm"?"Open palm":"Closed fist";$("gestureIcon").textContent=g.name==="Open_Palm"?"✋":"✊";
        if(state.candidateFrames===STABLE_FRAMES)await handleGesture(g.name,g.score);
      }else{
        state.candidate="";state.candidateFrames=0;$("gestureName").textContent=result.landmarks?.length?"Hand visible":"No hand";$("gestureIcon").textContent=result.landmarks?.length?"◌":"·";
      }
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
$("incomingStartCameraBtn").addEventListener("click",async()=>{hideIncoming();await startCamera()});
window.addEventListener("resize",resizeOverlay);
window.addEventListener("beforeunload",()=>{try{state.ws?.close()}catch{}stopCamera()});
$("roomInput").value=randomRoom();setRole("sender");setProgress(0);
