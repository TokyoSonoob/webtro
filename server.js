// server.js — Voice hub (key-by-code) + BedrockBridge webhook + WebRTC signaling
const path = require("path");
const express = require("express");
const { WebSocketServer } = require("ws");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// -------------------- In-memory state (room keyed by 6-digit code) --------------------
const rooms = new Map(); // Map<code, { peers: Map<peerId, ws> }>
const six = () => String(Math.floor(100000 + Math.random() * 900000));
const ensureRoom = (code) => {
  if (!rooms.has(code)) rooms.set(code, { peers: new Map() });
  return rooms.get(code);
};

// -------------------- BedrockBridge -> Webhook --------------------
// Expect JSON like: { event:"playerJoin", player:"Steve", server:"th-01" }
app.post("/bridge/event", (req, res) => {
  const { event, player } = req.body || {};

  if (event === "ping") {
    return res.json({ ok: true, pong: true });
  }

  if (event === "playerJoin") {
    // always rotate to a fresh 6-digit room on every join (as requested)
    let code = six();
    while (rooms.has(code)) code = six();
    ensureRoom(code);

    const url = `${req.protocol}://${req.get("host")}/?room=${code}`;

    return res.json({
      ok: true,
      code,
      commands: [
        // scoreboard for future use
        `scoreboard objectives add SeamuwwApi dummy`,
        `scoreboard players set Seamuww SeamuwwApi ${code}`,
        // whisper to the player (fallback to @a if player missing)
        `tellraw ${player ? `"${player}"` : "@a"} {"rawtext":[{"text":"§a[Voice]§r รหัสห้องคุย: §e${code}§r\\nเปิดเว็บ: ${url}"}]}`
      ]
    });
  }

  if (event === "playerLeave" || event === "chat") {
    // not used right now, but keep the contract
    return res.json({ ok: true });
  }

  return res.status(400).json({ ok: false, error: "unknown event" });
});

// (Optional) legacy endpoint if you want to mint a code without BedrockBridge
app.post("/api/player-enter", (_req, res) => {
  let code = six();
  while (rooms.has(code)) code = six();
  ensureRoom(code);
  res.json({
    ok: true,
    code,
    scoreboard: {
      objectiveAdd: `scoreboard objectives add SeamuwwApi dummy`,
      playerSet: `scoreboard players set Seamuww SeamuwwApi ${code}`
    }
  });
});

// -------------------- WebSocket signaling (mesh, by room code) --------------------
const server = app.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}`);
});

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  ws.roomCode = null;
  ws.peerId = null;

  ws.on("message", (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }

    if (msg.type === "join") {
      const code = String(msg.roomId || "");
      const pid  = String(msg.peerId || "");
      if (!/^\d{6}$/.test(code) || !pid) return;

      const room = ensureRoom(code);
      if (!room.peers.has(pid)) {
        ws.roomCode = code;
        ws.peerId   = pid;
        room.peers.set(pid, ws);

        // send back current peers to the newcomer
        ws.send(JSON.stringify({
          type: "joined",
          yourId: pid,
          peers: [...room.peers.keys()].filter(i => i !== pid)
        }));

        // notify existing peers
        for (const [otherId, peerWs] of room.peers) {
          if (otherId === pid) continue;
          if (peerWs.readyState === peerWs.OPEN) {
            peerWs.send(JSON.stringify({ type: "peer-join", peerId: pid }));
          }
        }
      }
      return;
    }

    if (msg.type === "leave") {
      cleanup(ws);
      return;
    }

    // relay offer/answer/ice to a specific peer within the same room
    if (msg.type === "offer" || msg.type === "answer" || msg.type === "ice") {
      const room = rooms.get(ws.roomCode);
      if (!room) return;
      const target = room.peers.get(String(msg.to));
      if (target && target.readyState === target.OPEN) {
        target.send(JSON.stringify(msg));
      }
      return;
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
    if (peerWs.readyState === peerWs.OPEN) {
      peerWs.send(JSON.stringify({ type: "peer-leave", peerId: ws.peerId }));
    }
  }
  if (room.peers.size === 0) rooms.delete(ws.roomCode);
}
