#!/usr/bin/env python3
from pathlib import Path
import json
import sys

ROOT=Path(__file__).resolve().parents[1]
server=ROOT/"server.js"
auth=ROOT/"public"/"auth-client.js"
package=ROOT/"package.json"

def replace_once(text, old, new, label):
    count=text.count(old)
    if count==0:
        if new in text:
            print(f"[ok] {label} already applied")
            return text
        raise SystemExit(f"[error] Could not find patch anchor: {label}")
    if count!=1:
        raise SystemExit(f"[error] Patch anchor is not unique ({count} matches): {label}")
    print(f"[patch] {label}")
    return text.replace(old,new,1)

s=server.read_text(encoding="utf-8")

s=replace_once(
    s,
    "        file: null,\n        sessionId: null,",
    "        file: null,\n        intent: null,\n        sessionId: null,",
    "room stores pending transfer intent"
)

s=replace_once(
    s,
    "      file: publicBroadcastFile(room.file),\n      receiverLimit: CONFIGURED_RECEIVER_LIMIT || null,",
    "      file: publicBroadcastFile(room.file),\n      intent: room.intent || null,\n      receiverLimit: CONFIGURED_RECEIVER_LIMIT || null,",
    "join response includes pending intent"
)

s=replace_once(
    s,
    "    if (role === 'receiver' && room.file) {\n      sendJson(ws, { type: 'broadcast-file-ready', file: publicBroadcastFile(room.file), stats: broadcastStats(room) });\n    }\n\n    emitBroadcastStats(room);",
    "    if (role === 'receiver' && room.file) {\n      sendJson(ws, { type: 'broadcast-file-ready', file: publicBroadcastFile(room.file), stats: broadcastStats(room) });\n    } else if (role === 'receiver' && room.intent) {\n      sendJson(ws, { type: 'broadcast-intent', intent: room.intent });\n    }\n\n    emitBroadcastStats(room);",
    "late receiver receives pending intent"
)

s=replace_once(
    s,
    "        if (data.type === 'broadcast-accept' && ws.role === 'receiver') {",
    """        if (data.type === 'broadcast-intent' && ws.role === 'sender' && room.host === ws) {
          const rawFile = data.file || {};
          const size = Number(rawFile.size);

          if (!Number.isFinite(size) || size < 0 || size > MAX_BROADCAST_FILE_BYTES) {
            return sendJson(ws, { type: 'error', message: 'Transfer request must be 100 MB or smaller.' });
          }

          room.intent = {
            id: crypto.randomUUID(),
            name: sanitizeFilename(rawFile.name),
            size,
            mime: String(rawFile.mime || 'application/octet-stream').slice(0, 120),
            sentAt: new Date().toISOString()
          };

          room.updatedAt = Date.now();

          for (const receiver of room.receivers.values()) {
            sendJson(receiver, {
              type: 'broadcast-intent',
              intent: room.intent
            });
          }

          return;
        }

        if (data.type === 'broadcast-intent-cancel' && ws.role === 'sender' && room.host === ws) {
          room.intent = null;
          room.updatedAt = Date.now();

          for (const receiver of room.receivers.values()) {
            sendJson(receiver, {
              type: 'broadcast-intent-cancelled'
            });
          }

          return;
        }

        if (data.type === 'broadcast-accept' && ws.role === 'receiver') {""",
    "WebSocket transfer intent protocol"
)

s=replace_once(
    s,
    "        room.updatedAt = now;\n        resetReceiverStatesForFile(room);",
    "        room.updatedAt = now;\n        room.intent = null;\n        resetReceiverStatesForFile(room);",
    "clear intent when file becomes ready"
)

s=replace_once(
    s,
    "    if (ws.role === 'sender' && room.host === ws) {\n      room.host = null;\n      emitBroadcastRoom(room, { type: 'broadcast-host-left', room: room.code });",
    "    if (ws.role === 'sender' && room.host === ws) {\n      room.host = null;\n      room.intent = null;\n      emitBroadcastRoom(room, { type: 'broadcast-intent-cancelled' });\n      emitBroadcastRoom(room, { type: 'broadcast-host-left', room: room.code });",
    "clear intent when sender leaves"
)

server.write_text(s,encoding="utf-8")

a=auth.read_text(encoding="utf-8")
a=a.replace(
    "showLogin('Sign in with Google to enter the DBA 802 lab.');",
    "showLogin('Sign in with Google to continue.');"
)
auth.write_text(a,encoding="utf-8")
print("[patch] simplified login copy")

data=json.loads(package.read_text(encoding="utf-8"))
data["description"]="AirGesture — gesture-driven two-device file transfer."
data["scripts"]["check"]="node --check server.js && node --check auth.js && node --check db.js && node --check public/core.js && node --check public/auth-client.js && node --check public/app.js && node --test tests/auth.test.js tests/core.test.js tests/server.integration.test.js tests/huawei-transfer-ui.test.js tests/huawei-intent.integration.test.js"
data["scripts"]["test"]="node --test tests/auth.test.js tests/core.test.js tests/server.integration.test.js tests/huawei-transfer-ui.test.js tests/huawei-intent.integration.test.js"
package.write_text(json.dumps(data,indent=2)+"\n",encoding="utf-8")
print("[patch] package scripts use branch-relevant tests")
print("[done] AirGesture V3 patch applied")
