// server.js — signaling server for Minecraft Voice
const path = require("path");
const express = require("express");
const { WebSocketServer } = require("ws");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const server = app.listen(PORT, () => {
  console.log("Listening on http://localhost:" + PORT);
});

// --- In-memory stores ---
const rooms = new Map();     // Map<roomCode, { peers: Map<peerId, ws> }>
const mcMap = new Map();     // Map<serverKey, roomCode>

// Helpers
const six = () => String(Math.floor(100000 + Math.random() * 900000));
const ensureRoom = (code) => {
  if (!rooms.has(code)) rooms.set(code, { peers: new Map() });
  return rooms.get(code);
};

// API: register server
app.post("/api/register", (req, res) => {
  const ip = String(req.body.ip || "").trim();
  const port = String(req.body.port || "").trim() || "19132";
  if (!ip) return res.status(400).json({ ok: false, error: "ip required" });

  const key = ip + ":" + port;
  let code = mcMap.get(key);
  if (!code) {
    code = six();
    mcMap.set(key, code);
  }
  ensureRoom(code);
  res.json({ ok: true, code });
});

// API: lookup
app.get("/api/code", (req, res) => {
  const ip = String(req.query.ip || "");
  const port = String(req.query.port || "19132");
  const code = mcMap.get(ip + ":" + port);
  if (!code) return res.status(404).json({ ok: false, error: "not found" });
  res.json({ ok: true, code });
});

// --- WebSocket signaling ---
const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws) => {
  ws.roomCode = null;
  ws.peerId = null;

  ws.on("message", (buf) => {
    let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }

    if (msg.type === "join") {
      const code = String(msg.roomId || "").trim();
      const pid = String(msg.peerId || "");
      if (!/^\d{6}$/.test(code)) return;

      const room = ensureRoom(code);
      if (!room.peers.has(pid)) {
        ws.roomCode = code;
        ws.peerId = pid;
        room.peers.set(pid, ws);

        ws.send(JSON.stringify({ type: "joined", yourId: pid, peers: [...room.peers.keys()].filter(i => i !== pid) }));

        for (const [otherId, peerWs] of room.peers) {
          if (otherId === pid) continue;
          peerWs.send(JSON.stringify({ type: "peer-join", peerId: pid }));
        }
      }
    }

    if (["offer", "answer", "ice"].includes(msg.type)) {
      const room = rooms.get(ws.roomCode);
      if (!room) return;
      const target = room.peers.get(String(msg.to));
      if (target) target.send(JSON.stringify(msg));
    }

    if (msg.type === "leave") {
      cleanup(ws);
    }
  });

  ws.on("close", () => cleanup(ws));
});

function cleanup(ws) {
  if (!ws.roomCode) return;
  const room = rooms.get(ws.roomCode);
  if (!room) return;
  room.peers.delete(ws.peerId);
  for (const [id, peerWs] of room.peers) {
    peerWs.send(JSON.stringify({ type: "peer-leave", peerId: ws.peerId }));
  }
  if (room.peers.size === 0) rooms.delete(ws.roomCode);
}
