const $=(id)=>document.getElementById(id);

const MAX_FILE_SIZE=100*1024*1024;
const PHASE_TIMEOUT_MS=12000;
const STABLE_FRAMES=4;
const ACTION_COOLDOWN_MS=700;

const state={
  role:"sender",room:"",ws:null,hostToken:"",
  selectedFile:null,selectedPreviewUrl:"",
  pendingFile:null,pendingIntent:null,receiverReleasedEarly:false,receivedUrl:"",
  cameraStream:null,cameraRunning:false,aiReady:false,aiLoading:false,cameraToken:0,
  recognizer:null,vision:null,drawingUtils:null,raf:null,lastVideoTime:-1,
  phase:"waiting-open",expiresAt:0,lastConfidence:0,
  candidate:"",candidateFrames:0,cooldownUntil:0,
  overlayBlocking:false,uploadBusy:false,downloadBusy:false
};

function toast(msg){
  const e=$("toast");e.textContent=msg;e.classList.add("show");
  clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove("show"),2200);
}
function status(msg){$("statusText").textContent=msg}
function setTransferState(text,tone=""){$("transferState").textContent=text;$("transferState").className="status-chip "+tone}
function setCameraState(text,tone=""){$("cameraStatus").textContent=text;$("cameraStatus").className="status-chip "+tone}
function setProgress(value){$("progressBar").style.width=Math.max(0,Math.min(100,Number(value)||0))+"%"}
function bytes(n){if(n<1024)return`${n} B`;if(n<1048576)return`${(n/1024).toFixed(1)} KB`;return`${(n/1048576).toFixed(1)} MB`}
function randomRoom(){return Math.random().toString(36).slice(2,8).toUpperCase()}
function wsUrl(){return`${location.protocol==="https:"?"wss":"ws"}://${location.host}`}
function clientInfo(){
  const ua=navigator.userAgent;
  return{
    browser:/Edg/i.test(ua)?"Edge":/Chrome/i.test(ua)?"Chrome":/Safari/i.test(ua)?"Safari":/Firefox/i.test(ua)?"Firefox":"Browser",
    os:/Mac/i.test(ua)?"macOS":/Windows/i.test(ua)?"Windows":/Android/i.test(ua)?"Android":/(iPhone|iPad)/i.test(ua)?"iOS":"Other",
    deviceType:/Mobi|Android|iPhone|iPad/i.test(ua)?"Mobile":"Desktop",
    timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||"",
    language:navigator.language||""
  };
}

function resetGestureCandidate(){state.candidate="";state.candidateFrames=0;state.cooldownUntil=0}
function setConnection(live,text){$("connectionPill").className="connection-pill "+(live?"live":"offline");$("connectionPill").querySelector("span").textContent=text}

function resetReceiverVisuals(){
  $("receiverStandby").hidden=false;$("receivedCard").hidden=true;
  $("receiverStandby").querySelector("strong").textContent="Waiting";
  $("receiverStandby").querySelector("span").textContent="Stay in this room.";
  if(state.receivedUrl){URL.revokeObjectURL(state.receivedUrl);state.receivedUrl=""}
}

function disconnectSocket(){
  if(!state.ws)return;
  const ws=state.ws;state.ws=null;
  try{ws.close()}catch{}
}

function setRole(role){
  if(!["sender","receiver"].includes(role))return;
  disconnectSocket();
  state.role=role;state.hostToken="";state.pendingFile=null;state.pendingIntent=null;state.receiverReleasedEarly=false;
  state.phase=role==="sender"?"waiting-open":"waiting-fist";state.expiresAt=0;
  resetGestureCandidate();hideIncoming();resetReceiverVisuals();
  document.querySelectorAll(".role-btn").forEach(b=>b.classList.toggle("active",b.dataset.role===role));
  $("senderPanel").hidden=role!=="sender";$("receiverPanel").hidden=role!=="receiver";
  $("roleLabel").textContent=role==="sender"?"SENDER":"RECEIVER";
  $("transferTitle").textContent=role==="sender"?"Pick a file.":"Ready to receive.";
  setConnection(false,"Not connected");setTransferState("Idle");setProgress(0);status("Choose a room and connect.");syncGuide();
}

function syncGuide(){
  if(state.role==="sender"){
    if(!state.selectedFile){$("guideHand").textContent="＋";$("guideTitle").textContent="Choose a file";$("guideText").textContent="Then start the camera."}
    else if(state.phase==="waiting-close"){$("guideHand").textContent="✊";$("guideTitle").textContent="Close your fist";$("guideText").textContent="Grab and send."}
    else if(state.phase==="sent"){$("guideHand").textContent="✓";$("guideTitle").textContent="Request sent";$("guideText").textContent="Waiting for receiver."}
    else{$("guideHand").textContent="✋";$("guideTitle").textContent="Open palm";$("guideText").textContent="Then close your fist."}
    return;
  }
  if(!state.pendingFile&&!state.pendingIntent){$("guideHand").textContent="·";$("guideTitle").textContent="Waiting";$("guideText").textContent="Stay connected to the room."}
  else if(state.phase==="waiting-release"){$("guideHand").textContent="✋";$("guideTitle").textContent="Open your palm";$("guideText").textContent=state.pendingFile?"Release to receive.":"Release now — file is preparing."}
  else if(state.phase==="received"){$("guideHand").textContent="✓";$("guideTitle").textContent="Received";$("guideText").textContent="The file is on this device."}
  else{$("guideHand").textContent="✊";$("guideTitle").textContent="Make a fist";$("guideText").textContent="Then open your palm."}
}

function setSelectedFile(file){
  if(!file)return;
  if(file.size>MAX_FILE_SIZE){toast("Maximum file size is 100 MB");return}
  state.selectedFile=file;state.phase="waiting-open";state.expiresAt=0;resetGestureCandidate();
  $("selectedFileCard").hidden=false;$("selectedFileName").textContent=file.name;$("selectedFileSize").textContent=bytes(file.size);
  if(state.selectedPreviewUrl){URL.revokeObjectURL(state.selectedPreviewUrl);state.selectedPreviewUrl=""}
  const icon=$("selectedIcon");icon.innerHTML="";
  if((file.type||"").startsWith("image/")){
    state.selectedPreviewUrl=URL.createObjectURL(file);
    const img=document.createElement("img");img.src=state.selectedPreviewUrl;img.alt="";icon.appendChild(img);
  }else icon.textContent="📄";
  setTransferState("Ready","good");status("Open palm ✋, then close fist ✊.");syncGuide();
}

function connectRoom(){
  const room=$("roomInput").value.trim().toUpperCase();
  if(!window.AirGestureCore?.isValidRoom(room)){toast("Use 2–12 letters, numbers, or hyphens");return}
  disconnectSocket();
  state.room=room;state.hostToken="";state.pendingFile=null;state.pendingIntent=null;state.receiverReleasedEarly=false;
  resetGestureCandidate();setConnection(false,"Connecting…");setTransferState("Connecting","warn");
  const ws=new WebSocket(wsUrl());state.ws=ws;

  ws.onopen=()=>{if(state.ws===ws)ws.send(JSON.stringify({type:"join",room,role:state.role,mode:"universal",clientInfo:clientInfo()}))};

  ws.onmessage=(event)=>{
    if(state.ws!==ws)return;
    let msg;try{msg=JSON.parse(event.data)}catch{return}

    if(msg.type==="broadcast-joined"){
      if(state.role==="sender")state.hostToken=msg.hostToken||"";
      setConnection(true,`Room ${msg.room}`);setTransferState("Connected","good");
      if(state.role==="receiver"){if(msg.file)readyFile(msg.file);else if(msg.intent)incomingIntent(msg.intent)}
      status(state.role==="sender"?"Connected. Choose a file.":"Connected. Waiting for sender.");return;
    }
    if(msg.type==="broadcast-intent"){if(state.role==="receiver")incomingIntent(msg.intent);return}
    if(msg.type==="broadcast-intent-cancelled"){
      if(state.role==="receiver"){state.pendingIntent=null;if(!state.pendingFile){hideIncoming();setTransferState("Connected","good");status("Sender cancelled the request.");syncGuide()}}
      return;
    }
    if(msg.type==="broadcast-file-ready"){if(state.role==="receiver")readyFile(msg.file);return}
    if(msg.type==="broadcast-file-cleared"){state.pendingFile=null;state.pendingIntent=null;state.receiverReleasedEarly=false;hideIncoming();syncGuide();return}
    if(msg.type==="broadcast-host-left"){state.pendingIntent=null;if(!state.pendingFile)hideIncoming();status("Sender left the room.");return}
    if(msg.type==="error"){toast(msg.message||"Room error");status(msg.message||"Room error");setTransferState("Error","bad")}
  };

  ws.onclose=()=>{if(state.ws===ws){state.ws=null;setConnection(false,"Disconnected");setTransferState("Offline","bad");state.hostToken=""}};
  ws.onerror=()=>{if(state.ws===ws)status("Could not connect to the room.")};
}

function normalizeIntent(intent){
  if(!intent)return null;
  return{id:String(intent.id||""),name:String(intent.name||"file").slice(0,180),size:Number(intent.size)||0,mime:String(intent.mime||"application/octet-stream").slice(0,120),sentAt:intent.sentAt||""};
}

function incomingIntent(intent){
  const parsed=normalizeIntent(intent);if(!parsed)return;
  state.pendingIntent=parsed;state.pendingFile=null;state.receiverReleasedEarly=false;state.phase="waiting-fist";state.expiresAt=0;resetGestureCandidate();resetReceiverVisuals();
  $("receiverStandby").querySelector("strong").textContent="Incoming request";$("receiverStandby").querySelector("span").textContent=parsed.name;
  setTransferState("Incoming","warn");status("Incoming request. Make a fist ✊, then open your palm ✋.");syncGuide();showIncoming(parsed.name,parsed.size,false);
  if(navigator.vibrate){try{navigator.vibrate([90,55,120])}catch{}}
}

function readyFile(file){
  if(!file)return;
  state.pendingFile={fileId:String(file.id||""),name:String(file.name||"file").slice(0,180),size:Number(file.size)||0,mime:String(file.mime||"application/octet-stream").slice(0,120),sha256:String(file.sha256||"")};
  state.pendingIntent=null;
  $("receiverStandby").querySelector("strong").textContent="File ready";$("receiverStandby").querySelector("span").textContent=state.pendingFile.name;
  if(state.receiverReleasedEarly){state.receiverReleasedEarly=false;receivePending();return}
  if(state.phase!=="waiting-release")state.phase="waiting-fist";
  setTransferState("Ready","good");status("File ready. Make a fist ✊, then open your palm ✋.");syncGuide();showIncoming(state.pendingFile.name,state.pendingFile.size,true);
}

function showIncoming(name,size,ready){
  $("incomingFileName").textContent=name||"A file is waiting";$("incomingMeta").textContent=size?bytes(size):"Preparing file…";
  if(state.cameraRunning&&state.aiReady){
    $("incomingInstruction").textContent=ready?"Camera is live. Make a fist ✊, then open your palm ✋.":"Camera is live. Get ready: fist ✊, then open palm ✋.";
    $("incomingActionBtn").textContent="Show camera";
  }else{
    $("incomingInstruction").textContent=ready?"Open camera. Make a fist ✊, then open your palm ✋.":"Open camera while the file prepares.";
    $("incomingActionBtn").textContent="Open camera";
  }
  state.overlayBlocking=true;$("incomingOverlay").hidden=false;
}

function hideIncoming(){state.overlayBlocking=false;$("incomingOverlay").hidden=true}

function showSent(){
  const o=$("sentOverlay");o.hidden=false;clearTimeout(showSent.t);showSent.t=setTimeout(()=>o.hidden=true,3500);
}

function setBubblePreview({name="",mime="",url=""}={}){
  const box=$("bubblePreview");box.innerHTML="";
  if(url&&String(mime).startsWith("image/")){const img=document.createElement("img");img.src=url;img.alt="";box.appendChild(img)}
  else box.textContent="📄";
}

function animateOutgoingBubble(){
  if(!state.selectedFile)return Promise.resolve();
  setBubblePreview({name:state.selectedFile.name,mime:state.selectedFile.type,url:state.selectedPreviewUrl});
  const bubble=$("transferBubble");bubble.hidden=false;bubble.className="transfer-bubble";
  void bubble.offsetWidth;bubble.classList.add("outgoing");
  return new Promise(resolve=>setTimeout(()=>{bubble.hidden=true;bubble.className="transfer-bubble";resolve()},1050));
}

function animateIncomingBubble(blob,req){
  setBubblePreview({name:req.name,mime:req.mime,url:(req.mime||"").startsWith("image/")?state.receivedUrl:""});
  const bubble=$("transferBubble");bubble.hidden=false;bubble.className="transfer-bubble";
  void bubble.offsetWidth;bubble.classList.add("arriving");
  return new Promise(resolve=>setTimeout(()=>{bubble.hidden=true;bubble.className="transfer-bubble";resolve()},900));
}

function sendIntent(){
  if(!state.ws||state.ws.readyState!==WebSocket.OPEN||!state.selectedFile)return false;
  state.ws.send(JSON.stringify({type:"broadcast-intent",file:{name:state.selectedFile.name,size:state.selectedFile.size,mime:state.selectedFile.type||"application/octet-stream"}}));
  return true;
}

function cancelIntent(){if(state.ws?.readyState===WebSocket.OPEN)state.ws.send(JSON.stringify({type:"broadcast-intent-cancel"}))}

async function uploadSelected(){
  if(state.uploadBusy||!state.selectedFile)return;
  if(!state.ws||state.ws.readyState!==WebSocket.OPEN||!state.hostToken){toast("Connect as sender first");state.phase="waiting-open";syncGuide();return}
  state.uploadBusy=true;setTransferState("Sending","warn");setProgress(0);status("Request sent. Preparing file…");sendIntent();showSent();
  await animateOutgoingBubble();

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
      xhr.upload.onprogress=e=>{if(e.lengthComputable)setProgress((e.loaded/e.total)*100)};
      xhr.onload=()=>xhr.status>=200&&xhr.status<300?resolve(xhr.response||{}):reject(new Error(xhr.response?.error||`Upload failed (${xhr.status})`));
      xhr.onerror=()=>reject(new Error("Upload failed because the server could not be reached."));
      xhr.onabort=()=>reject(new DOMException("Upload cancelled","AbortError"));
      xhr.send(file);
    });
    setProgress(100);setTransferState("Request sent","good");status("Request sent. Waiting for receiver.");state.phase="sent";syncGuide();toast("Request sent");
  }catch(err){
    console.error(err);cancelIntent();setTransferState("Failed","bad");status(err.message||"Upload failed");state.phase="waiting-open";syncGuide();
  }finally{state.uploadBusy=false}
}

async function sha256Hex(blob){
  if(!globalThis.crypto?.subtle)return"";
  const digest=await crypto.subtle.digest("SHA-256",await blob.arrayBuffer());
  return[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");
}

async function receivePending(){
  if(state.downloadBusy)return;
  if(!state.pendingFile){
    if(state.pendingIntent){state.receiverReleasedEarly=true;setTransferState("Preparing","warn");status("Gesture accepted. File is preparing — it will arrive automatically.");$("guideHand").textContent="✓";$("guideTitle").textContent="Gesture accepted";$("guideText").textContent="Waiting for file…";hideIncoming()}
    return;
  }
  if(!state.ws||state.ws.readyState!==WebSocket.OPEN){toast("Reconnect the room");return}

  const req={...state.pendingFile};state.downloadBusy=true;hideIncoming();setTransferState("Receiving","warn");setProgress(0);
  state.ws.send(JSON.stringify({type:"broadcast-accept",fileId:req.fileId,trigger:"gesture",gestureConfidence:state.lastConfidence,clientInfo:clientInfo()}));
  const started=performance.now();

  try{
    const response=await fetch(`/api/broadcast/${encodeURIComponent(state.room)}/files/${encodeURIComponent(req.fileId)}`,{cache:"no-store"});
    if(!response.ok){let detail="";try{detail=(await response.json()).error||""}catch{}throw new Error(detail||`Download failed (${response.status})`)}
    const total=Number(response.headers.get("content-length"))||req.size;
    const serverHash=response.headers.get("x-airgesture-sha256")||req.sha256||"";
    const reader=response.body?.getReader(),chunks=[];let got=0;

    if(reader){
      while(true){
        const{value,done}=await reader.read();if(done)break;
        chunks.push(value);got+=value.byteLength;
        if(total&&got>total)throw new Error("Received more bytes than expected.");
        setProgress(total?(got/total)*100:0);
      }
    }else{
      const buffer=await response.arrayBuffer();chunks.push(new Uint8Array(buffer));got=buffer.byteLength;
    }

    const blob=new Blob(chunks,{type:req.mime});
    if(req.size&&blob.size!==req.size)throw new Error("File size verification failed.");
    if(serverHash){const localHash=await sha256Hex(blob);if(localHash&&localHash!==serverHash)throw new Error("Integrity verification failed.")}

    if(state.receivedUrl)URL.revokeObjectURL(state.receivedUrl);
    state.receivedUrl=URL.createObjectURL(blob);

    await animateIncomingBubble(blob,req);
    renderReceived(blob,req);
    setProgress(100);setTransferState("Received","good");status("File received.");toast("File received");

    const duration=(performance.now()-started)/1000;
    state.ws.send(JSON.stringify({type:"broadcast-complete",fileId:req.fileId,durationSec:duration,speedMbps:duration?(blob.size*8/1e6/duration):0,gestureConfidence:state.lastConfidence,integrityVerified:true,clientInfo:clientInfo()}));
  }catch(err){
    console.error(err);setTransferState("Failed","bad");status(err.message||"Receive failed");state.phase="waiting-fist";syncGuide();
    if(state.ws?.readyState===WebSocket.OPEN)state.ws.send(JSON.stringify({type:"broadcast-failed",fileId:req.fileId,reason:String(err.message||"download failed").slice(0,160),gestureConfidence:state.lastConfidence,clientInfo:clientInfo()}));
  }finally{state.downloadBusy=false}
}

function renderReceived(blob,req){
  $("receiverStandby").hidden=true;$("receivedCard").hidden=false;$("receivedName").textContent=req.name;$("receivedSize").textContent=bytes(blob.size);
  const preview=$("receivedPreview");preview.innerHTML="";
  if((req.mime||"").startsWith("image/")){const img=document.createElement("img");img.src=state.receivedUrl;img.alt="";preview.appendChild(img)}else preview.textContent="📄";
  $("downloadBtn").href=state.receivedUrl;$("downloadBtn").download=req.name;
  state.phase="received";syncGuide();
}

function cameraErrorMessage(error){
  const name=error?.name||"";
  if(!navigator.mediaDevices?.getUserMedia)return window.isSecureContext?"Camera API is unavailable in this browser.":"Camera requires HTTPS.";
  if(name==="NotAllowedError"||name==="SecurityError")return"Camera permission was denied.";
  if(name==="NotFoundError"||name==="DevicesNotFoundError")return"No camera was found.";
  if(name==="NotReadableError"||name==="TrackStartError")return"The camera is busy in another app.";
  return error?.message||"Camera could not start.";
}

async function requestCameraStream(){
  if(!navigator.mediaDevices?.getUserMedia)throw new Error("Camera API unavailable.");
  try{return await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},facingMode:"user"},audio:false})}
  catch(error){
    if(["OverconstrainedError","ConstraintNotSatisfiedError"].includes(error?.name))return navigator.mediaDevices.getUserMedia({video:true,audio:false});
    throw error;
  }
}

async function importVision(){
  const sources=["https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/+esm","https://unpkg.com/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs"];
  let last;for(const src of sources){try{return await import(src)}catch(error){last=error}}
  throw last||new Error("Vision AI failed to load.");
}

async function createRecognizer(vision){
  let fileset,last;
  for(const wasm of ["https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm","https://unpkg.com/@mediapipe/tasks-vision@0.10.35/wasm"]){try{fileset=await vision.FilesetResolver.forVisionTasks(wasm);break}catch(error){last=error}}
  if(!fileset)throw last||new Error("MediaPipe WASM failed to load.");
  const options=delegate=>({baseOptions:{modelAssetPath:"https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",...(delegate?{delegate}:{})},runningMode:"VIDEO",numHands:1,minHandDetectionConfidence:.58,minHandPresenceConfidence:.58,minTrackingConfidence:.58});
  try{return await vision.GestureRecognizer.createFromOptions(fileset,options("GPU"))}
  catch(error){console.warn("MediaPipe GPU unavailable; using CPU.",error);return vision.GestureRecognizer.createFromOptions(fileset,options(undefined))}
}

async function startCamera(){
  if(state.cameraRunning||state.aiLoading)return;
  const token=++state.cameraToken;state.aiLoading=true;setCameraState("Requesting","warn");$("startCameraBtn").disabled=true;
  try{
    const stream=await requestCameraStream();
    if(token!==state.cameraToken){stream.getTracks().forEach(track=>track.stop());return}
    state.cameraStream=stream;state.cameraRunning=true;state.aiReady=false;state.lastVideoTime=-1;
    const video=$("video");video.srcObject=stream;await video.play();
    if(token!==state.cameraToken)return;
    resizeOverlay();$("cameraPrompt").classList.add("hidden");$("stopCameraBtn").disabled=false;setCameraState("Loading AI","warn");
    const vision=await importVision();const recognizer=await createRecognizer(vision);
    if(token!==state.cameraToken||!state.cameraRunning){try{recognizer.close?.()}catch{}return}
    state.vision=vision;state.recognizer=recognizer;state.drawingUtils=new vision.DrawingUtils($("overlay").getContext("2d"));
    state.aiReady=true;state.aiLoading=false;resetGestureCandidate();setCameraState("Vision live","good");
    status(state.role==="sender"?"Open palm ✋, then close fist ✊.":"Make a fist ✊, then open palm ✋.");
    if(!state.raf)state.raf=requestAnimationFrame(predict);
  }catch(error){
    console.error(error);if(token!==state.cameraToken)return;
    state.aiLoading=false;state.aiReady=false;
    if(state.cameraStream){state.cameraStream.getTracks().forEach(track=>track.stop());state.cameraStream=null}
    state.cameraRunning=false;$("video").srcObject=null;$("cameraPrompt").classList.remove("hidden");$("startCameraBtn").disabled=false;$("stopCameraBtn").disabled=true;setCameraState("Unavailable","bad");
    const message=cameraErrorMessage(error);status(message);toast(message);
    if(state.role==="receiver"&&(state.pendingIntent||state.pendingFile))showIncoming(state.pendingFile?.name||state.pendingIntent?.name||"Incoming file",state.pendingFile?.size||state.pendingIntent?.size||0,Boolean(state.pendingFile));
  }
}

function stopCamera(){
  state.cameraToken++;state.cameraRunning=false;state.aiReady=false;state.aiLoading=false;
  if(state.raf)cancelAnimationFrame(state.raf);state.raf=null;
  try{state.recognizer?.close?.()}catch{}
  state.recognizer=null;state.drawingUtils=null;state.vision=null;
  state.cameraStream?.getTracks().forEach(track=>track.stop());state.cameraStream=null;$("video").srcObject=null;
  const ctx=$("overlay").getContext("2d");ctx.clearRect(0,0,$("overlay").width,$("overlay").height);
  $("cameraPrompt").classList.remove("hidden");$("startCameraBtn").disabled=false;$("stopCameraBtn").disabled=true;setCameraState("Camera off");$("gestureName").textContent="Waiting";$("gestureIcon").textContent="·";resetGestureCandidate();
}

function resizeOverlay(){
  const canvas=$("overlay"),video=$("video");
  canvas.width=video.videoWidth||1280;canvas.height=video.videoHeight||720;
}

function drawPrivateHandSpotlight(video,canvas,landmarks){
  if(!landmarks?.length)return;
  const ctx=canvas.getContext("2d");
  const xs=landmarks.map(p=>p.x*canvas.width);
  const ys=landmarks.map(p=>p.y*canvas.height);
  let minX=Math.max(0,Math.min(...xs)),maxX=Math.min(canvas.width,Math.max(...xs));
  let minY=Math.max(0,Math.min(...ys)),maxY=Math.min(canvas.height,Math.max(...ys));
  const w=Math.max(90,maxX-minX),h=Math.max(90,maxY-minY);
  const pad=Math.max(36,Math.max(w,h)*.42);
  minX=Math.max(0,minX-pad);maxX=Math.min(canvas.width,maxX+pad);
  minY=Math.max(0,minY-pad);maxY=Math.min(canvas.height,maxY+pad);
  const cx=(minX+maxX)/2,cy=(minY+maxY)/2;
  const rx=Math.max(70,(maxX-minX)/2),ry=Math.max(70,(maxY-minY)/2);

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2);
  ctx.clip();
  ctx.filter="none";
  ctx.drawImage(video,0,0,canvas.width,canvas.height);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2);
  ctx.strokeStyle="rgba(77,220,230,.65)";
  ctx.lineWidth=3;
  ctx.shadowColor="rgba(75,140,255,.65)";
  ctx.shadowBlur=22;
  ctx.stroke();
  ctx.restore();
}

async function handleGesture(name,score){
  const now=performance.now();if(now<state.cooldownUntil)return;
  state.lastConfidence=score||0;

  if(state.role==="sender"){
    if(!state.selectedFile||state.uploadBusy)return;
    if(state.phase==="waiting-close"&&now>state.expiresAt){state.phase="waiting-open";syncGuide()}
    if(name==="Open_Palm"&&state.phase==="waiting-open"){state.phase="waiting-close";state.expiresAt=now+PHASE_TIMEOUT_MS;state.cooldownUntil=now+ACTION_COOLDOWN_MS;setTransferState("Palm detected","good");syncGuide();return}
    if(name==="Closed_Fist"&&state.phase==="waiting-close"&&now<=state.expiresAt){state.cooldownUntil=now+ACTION_COOLDOWN_MS;await uploadSelected()}
    return;
  }

  if(!state.pendingFile&&!state.pendingIntent)return;
  if(state.phase==="waiting-release"&&now>state.expiresAt){state.phase="waiting-fist";syncGuide()}
  if(name==="Closed_Fist"&&state.phase==="waiting-fist"){state.phase="waiting-release";state.expiresAt=now+PHASE_TIMEOUT_MS;state.cooldownUntil=now+ACTION_COOLDOWN_MS;setTransferState("Caught","good");syncGuide();return}
  if(name==="Open_Palm"&&state.phase==="waiting-release"&&now<=state.expiresAt){state.cooldownUntil=now+ACTION_COOLDOWN_MS;await receivePending()}
}

async function predict(){
  state.raf=null;if(!state.cameraRunning||!state.aiReady||!state.recognizer)return;
  const video=$("video");

  if(video.readyState>=2&&video.currentTime!==state.lastVideoTime){
    state.lastVideoTime=video.currentTime;resizeOverlay();
    try{
      const result=state.recognizer.recognizeForVideo(video,performance.now());
      const canvas=$("overlay"),ctx=canvas.getContext("2d");ctx.clearRect(0,0,canvas.width,canvas.height);

      if(result.landmarks?.length){
        const primary=result.landmarks[0];
        drawPrivateHandSpotlight(video,canvas,primary);
        for(const landmarks of result.landmarks){
          state.drawingUtils.drawConnectors(landmarks,state.vision.GestureRecognizer.HAND_CONNECTIONS,{color:"#55e8e7",lineWidth:4});
          state.drawingUtils.drawLandmarks(landmarks,{color:"#0b1420",fillColor:"#ffffff",radius:3});
        }
      }

      const gesture=window.AirGestureCore.resolveSimpleGesture(result);
      const supported=["Open_Palm","Closed_Fist"].includes(gesture.name);

      if(supported){
        if(state.candidate===gesture.name)state.candidateFrames++;else{state.candidate=gesture.name;state.candidateFrames=1}
        $("gestureName").textContent=gesture.name==="Open_Palm"?"Open palm":"Closed fist";$("gestureIcon").textContent=gesture.name==="Open_Palm"?"✋":"✊";
        if(state.candidateFrames===STABLE_FRAMES&&!state.overlayBlocking)await handleGesture(gesture.name,gesture.score);
      }else{
        state.candidate="";state.candidateFrames=0;
        const handVisible=Boolean(result.landmarks?.length);
        $("gestureName").textContent=handVisible?"Hand visible":"No hand";$("gestureIcon").textContent=handVisible?"◌":"·";
      }
    }catch(error){
      console.error("Gesture frame failed:",error);state.aiReady=false;setCameraState("AI error","bad");status("Gesture recognition stopped. Stop and restart the camera.");
    }
  }

  if(state.cameraRunning&&state.aiReady)state.raf=requestAnimationFrame(predict);
}

async function incomingAction(){
  hideIncoming();
  if(state.cameraRunning&&state.aiReady){status("Camera is live. Make a fist ✊, then open your palm ✋.");return}
  await startCamera();
}

document.querySelectorAll(".role-btn").forEach(btn=>btn.addEventListener("click",()=>setRole(btn.dataset.role)));
$("newRoomBtn").addEventListener("click",()=>{$("roomInput").value=randomRoom()});
$("connectBtn").addEventListener("click",connectRoom);
$("chooseFileBtn").addEventListener("click",()=>$("fileInput").click());
$("fileInput").addEventListener("change",event=>setSelectedFile(event.target.files?.[0]));
$("startCameraBtn").addEventListener("click",startCamera);
$("stopCameraBtn").addEventListener("click",stopCamera);
$("incomingActionBtn").addEventListener("click",incomingAction);
$("roomInput").addEventListener("input",event=>{event.target.value=event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g,"").slice(0,12)});
window.addEventListener("resize",resizeOverlay);
window.addEventListener("beforeunload",()=>{disconnectSocket();stopCamera();if(state.selectedPreviewUrl)URL.revokeObjectURL(state.selectedPreviewUrl);if(state.receivedUrl)URL.revokeObjectURL(state.receivedUrl)});
$("roomInput").value=randomRoom();setRole("sender");setProgress(0);
