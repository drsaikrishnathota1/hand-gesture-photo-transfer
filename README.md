# AirGesture Transfer Intelligence v2

A gesture-controlled, peer-to-peer file transfer experiment with executive analytics for **DBA 802 — Data Analytics and Strategic Decision Intelligence**.

## Highlights

- Futuristic responsive decision-cockpit UI
- MediaPipe Gesture Recognizer: Open Palm / Victory / Closed Fist
- WebRTC DataChannel for actual peer-to-peer binary file transfer
- WebSocket used only for secure-room signaling
- Sender / Receiver roles and generated room codes
- Drag-and-drop file staging (100 MB classroom limit)
- Transfer progress, duration, throughput, and acknowledgement
- Local evidence store (`data/analytics.json`)
- Executive KPI dashboard and charts
- Rule-based management recommendations
- One-click classroom demo dataset
- DBA 802 discussion prompts and Data → Insight → Decision framing

## Requirements

- Node.js 18+
- npm
- Chrome or Edge recommended
- Camera permission in the Sender browser

## Quick start

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Two-tab classroom demo

### Sender
1. Select **Sender**.
2. Use the generated room code and click **Connect Room**.
3. Choose a file.
4. Click **Start Vision AI** and allow camera access.

### Receiver
1. Open a second tab.
2. Select **Receiver**.
3. Enter the same room code.
4. Click **Connect Room**.
5. Wait for **P2P Ready**.

### Gesture sequence

- ✋ Open Palm → Arm
- ✌️ Victory → Send
- ✊ Closed Fist → Cancel

Manual controls remain available as a fallback.

## DBA 802 alignment

**Data** → file size, duration, throughput, success/failure, gesture confidence, trigger type  
**Insight** → reliability, usability, performance, adoption  
**Decision** → pilot, improve, scale, or reject

Open **Executive Analytics** after testing. Use **Load Classroom Demo Data** when you want a ready-to-discuss dataset without performing many transfers live.

## Browser/security note

Camera access works on `localhost` in modern browsers. Accessing the app from another physical device over a plain LAN URL such as `http://192.168.x.x:3000` may cause the browser to block camera access because camera APIs generally require a secure context. For the simplest Week-1 demo, use two tabs/windows on the same laptop or deploy through HTTPS.

The WebRTC configuration includes a public STUN server. Restrictive enterprise/NAT networks may additionally require TURN infrastructure for production deployment.

## Project structure

```text
hand-gesture-photo-transfer/
├── server.js
├── package.json
├── package-lock.json   # keep/regenerate with npm
├── .gitignore
├── README.md
├── data/
│   └── .gitkeep
└── public/
    ├── index.html
    ├── styles.css
    └── app.js
```

## Validation

```bash
npm run check
```

## APIs

- `GET /api/health`
- `GET /api/analytics`
- `POST /api/events`
- `POST /api/demo-data`
- `DELETE /api/analytics`
