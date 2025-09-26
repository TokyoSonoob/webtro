// server.js — Express + WebSocket signaling (1:1 only)
const path = require("path");
const express = require("express");
const { WebSocketServer } = require("ws");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));
app.get("/healthz", (_, res) => res.send("ok"));

const server = app.listen(PORT, () => {
  console.log("HTTP on :" + PORT);
});

const wss = new WebSocketServer({ server, path: "/ws" });

// rooms: { [roomId: string]: Set<WebSocket> }
const rooms = new Map();

function joinRoom(ws, roomId) {
  const set = rooms.get(roomId) || new Set();
  if (set.size >= 2) {
    ws.send(JSON.stringify({ type: "room-full" }));
    return false;
    }
  set.add(ws);
  rooms.set(roomId, set);
  ws.roomId = roomId;
  // inform others
  for (const peer of set) {
    if (peer !== ws && peer.readyState === peer.OPEN) {
      peer.send(JSON.stringify({ type: "peer-join" }));
    }
  }
  ws.send(JSON.stringify({ type: "joined", peers: set.size - 1 }));
  return true;
}

function leaveRoom(ws) {
  const roomId = ws.roomId;
  if (!roomId) return;
  const set = rooms.get(roomId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) rooms.delete(roomId);
  else {
    for (const peer of set) {
      if (peer.readyState === peer.OPEN) {
        peer.send(JSON.stringify({ type: "peer-leave" }));
      }
    }
  }
  ws.roomId = null;
}

wss.on("connection", (ws) => {
  ws.roomId = null;

  ws.on("message", (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }

    if (msg.type === "join") {
      const id = String(msg.roomId || "").trim();
      if (id) joinRoom(ws, id);
    } else if (msg.type === "leave") {
      leaveRoom(ws);
    } else if (msg.type === "offer" || msg.type === "answer" || msg.type === "ice") {
      const set = rooms.get(ws.roomId);
      if (!set) return;
      for (const peer of set) {
        if (peer !== ws && peer.readyState === peer.OPEN) {
          peer.send(JSON.stringify(msg));
        }
      }
    }
  });

  ws.on("close", () => leaveRoom(ws));
});
