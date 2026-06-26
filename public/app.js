const video = document.getElementById("video");
const roomInput = document.getElementById("roomInput");
const joinBtn = document.getElementById("joinBtn");
const fileInput = document.getElementById("fileInput");
const sendBtn = document.getElementById("sendBtn");
const receivedImage = document.getElementById("receivedImage");
const statusText = document.getElementById("status");
const gestureStatus = document.getElementById("gestureStatus");

let socket;
let lastGestureSendTime = 0;

function joinRoom() {
  socket = new WebSocket(`ws://${location.host}`);

  socket.onopen = () => {
    socket.send(JSON.stringify({
      type: "join",
      room: roomInput.value
    }));
  };

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === "status") {
      statusText.textContent = data.message;
    }

    if (data.type === "photo") {
      receivedImage.src = data.image;
      statusText.textContent = "Photo received ✅";
    }
  };
}

function sendPhoto() {
  const file = fileInput.files[0];

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    statusText.textContent = "Join room first";
    return;
  }

  if (!file) {
    statusText.textContent = "Select a photo first";
    return;
  }

  const reader = new FileReader();

  reader.onload = () => {
    socket.send(JSON.stringify({
      type: "photo",
      image: reader.result
    }));

    statusText.textContent = "Photo sent by hand gesture ✅";
  };

  reader.readAsDataURL(file);
}

function isOpenPalm(landmarks) {
  const wrist = landmarks[0];

  const indexTip = landmarks[8];
  const middleTip = landmarks[12];
  const ringTip = landmarks[16];
  const pinkyTip = landmarks[20];

  return (
    indexTip.y < wrist.y &&
    middleTip.y < wrist.y &&
    ringTip.y < wrist.y &&
    pinkyTip.y < wrist.y
  );
}

function onHandResults(results) {
  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    gestureStatus.textContent = "No hand detected";
    return;
  }

  const landmarks = results.multiHandLandmarks[0];

  if (isOpenPalm(landmarks)) {
    gestureStatus.textContent = "Open palm detected 🖐️";

    const now = Date.now();

    if (now - lastGestureSendTime > 4000) {
      lastGestureSendTime = now;
      sendPhoto();
    }
  } else {
    gestureStatus.textContent = "Hand detected, but not open palm";
  }
}

async function startHandTracking() {
  const hands = new Hands({
    locateFile: (file) => {
      return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
    }
  });

  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.7
  });

  hands.onResults(onHandResults);

  const camera = new Camera(video, {
    onFrame: async () => {
      await hands.send({ image: video });
    },
    width: 480,
    height: 360
  });

  camera.start();
}

joinBtn.onclick = joinRoom;
sendBtn.onclick = sendPhoto;

startHandTracking();
