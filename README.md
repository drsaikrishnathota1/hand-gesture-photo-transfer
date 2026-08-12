# AirGesture Transfer Intelligence V4

A two-party gesture-controlled peer-to-peer file transfer and decision-intelligence laboratory for **DBA 802 — Data Analytics and Strategic Decision Intelligence**.

## Core interaction

The same gesture sequence is used on both devices:

- **Sender:** ✋ Open Hand → ✊ Closed Fist = **Air Copy / Ready to Send**
- **Receiver:** ✋ Open Hand → ✊ Closed Fist = **Air Paste / Accept & Receive**

The Sender gesture does **not** immediately send the file. It creates a transfer request containing only metadata. The file payload begins only after the Receiver performs the same gesture and accepts the request.

## Transfer flow

1. Sender and Receiver join the same secure room.
2. Both start Vision AI.
3. Sender chooses a file and performs ✋ → ✊.
4. Receiver sees the incoming file request and performs ✋ → ✊.
5. WebRTC DataChannel transfers the binary file peer-to-peer.
6. Receiver reconstructs the file, verifies the exact byte count, and sends an ACK.
7. Analytics record transfer performance and gesture evidence.

Manual **Air Copy**, **Air Paste**, and **Cancel** controls remain available when camera/AI is unavailable.

## DBA 802 alignment

**Data** → file size, duration, throughput, Sender/Receiver gesture confidence, acceptance latency, success/failure  
**Insight** → reliability, usability, friction, performance, adoption  
**Decision** → pilot, improve, scale, or reject

The Executive Analytics view includes KPIs, trend charts, evidence history, and rule-based management recommendations.

## Technology

- Node.js + Express
- WebSocket room/signaling server
- WebRTC DataChannel for binary transfer
- MediaPipe Gesture Recognizer in each browser
- Chart.js executive analytics

## Quick start

```bash
npm install
npm run check
npm start
```

Open `http://localhost:3000`.

### Two tabs on one laptop

Use one tab as Sender and the other as Receiver. Join the same room code. Both tabs can start Vision AI.

### Two laptops

For both laptops to use cameras reliably, serve the application through **HTTPS**. A plain LAN URL such as `http://192.168.x.x:3000` may be blocked from camera access by browser secure-context rules.

WebRTC uses STUN for peer discovery. Restrictive enterprise networks may require TURN for production-grade connectivity.

## Gesture safeguards

- Open Hand must be held stably before the sequence advances.
- Closed Fist must follow within about 2.6 seconds.
- A completed sequence fires only once.
- Sender cannot transmit until Receiver acceptance is confirmed.
- Receiver can cancel/decline before or during a transfer.
- Files are byte-count verified before success is recorded.
