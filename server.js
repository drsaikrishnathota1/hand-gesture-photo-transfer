const express = require("express");
const path = require("path");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = 3000;
const rooms = new Map();

app.use(express.static(path.join(__dirname, "public")));

wss.on("connection", (ws) => {
  ws.on("message", (message) => {
    const data = JSON.parse(message);

    if (data.type === "join") {
      ws.room = data.room;
      if (!rooms.has(data.room)) rooms.set(data.room, new Set());
      rooms.get(data.room).add(ws);
      ws.send(JSON.stringify({ type: "status", message: `Joined room ${data.room}` }));
    }

    if (data.type === "photo") {
      const clients = rooms.get(ws.room) || [];
      for (const client of clients) {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(data));
        }
      }
    }
  });

  ws.on("close", () => {
    if (ws.room && rooms.has(ws.room)) {
      rooms.get(ws.room).delete(ws);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running: http://localhost:${PORT}`);
});
