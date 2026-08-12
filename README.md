# AirGesture Transfer Intelligence V5.1 — Universal Room

AirGesture V5.1 removes the separate **Peer-to-Peer** and **Classroom Broadcast** choices. The application now has one simple workflow:

- **One Sender** creates or joins a room code.
- **Any number of Receivers supported by the deployed server/network** join the same code.
- Sender selects a file and performs **✋ Open Hand → ✊ Closed Fist** to **Air Send**.
- The Sender uploads the file once to temporary server storage.
- Each Receiver performs the same **✋ → ✊** gesture to **Air Paste** and download independently.
- Live metrics show connected, accepted, completed, waiting, failed, and completion percentage.

There is **no hard-coded 200-receiver application cap**. Practical capacity is determined by the server, network, reverse proxy, operating-system connection limits, and deployment architecture. An administrator can optionally set `AIRGESTURE_MAX_RECEIVERS` to impose a room limit.

## Quick start

```bash
npm install
npm run check
npm start
```

Open `http://localhost:3000`.

## Same-laptop test

Open three or more tabs. Use the same room code in every tab. Set one tab to **Sender** and all other tabs to **Receiver**. No transfer-mode selection is required.

## Universal transfer flow

1. Sender and Receivers join the same room code.
2. Sender chooses a file (100 MB classroom safety limit).
3. Sender performs ✋ → ✊ or uses the manual send button.
4. The file is uploaded once and announced to all connected Receivers.
5. Each Receiver performs ✋ → ✊ or uses Air Paste.
6. The Receiver downloads and verifies the exact byte count plus SHA-256 header.
7. Sender analytics update as Receivers accept and complete.

## Capacity

By default V5.1 does not enforce a fixed Receiver count:

```text
1 Sender → N Receivers
```

This does not mean a single Node.js process is infinitely scalable. Production capacity must be load-tested. For large deployments, use HTTPS, a reverse proxy/load balancer, shared object storage, and an appropriate WebSocket scaling strategy.

Optional application-level cap:

```bash
AIRGESTURE_MAX_RECEIVERS=500 npm start
```

Leaving the variable unset means no fixed application cap.

## Security / deployment notes

- Camera access on physical devices should be served over HTTPS.
- Broadcast files are temporary and expire automatically.
- One active Sender/Host is allowed per room.
- Room codes should be treated as convenience identifiers, not strong authentication for an Internet-facing production deployment.
- Files remain limited to 100 MB in this classroom build.

## DBA 802 decision-intelligence alignment

**Data** → connected Receivers, acceptance, completion, failure, file size, duration, throughput, gesture evidence  
**Insight** → adoption, reliability, friction, performance, scale behavior  
**Decision** → pilot, improve, scale, or reject
