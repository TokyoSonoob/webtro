// server.js — Voice hub + signaling + REST API
const path = require("path");
const express = require("express");
const { WebSocketServer } = require("ws");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.set("trust proxy", true); // เผื่อรันหลังพร็อกซี/Render

const server = app.listen(PORT, () => {
  console.log("Listening on http://localhost:" + PORT);
});

// ===== In-memory state =====
/** Map<serverKey, code>  — serverKey = ip:port */
const serverCode = new Map();
/** Map<code, { peers: Map<peerId, ws> }> */
const rooms = new Map();

const six = () => String(Math.floor(100000 + Math.random() * 900000));
const ensureRoom = (code) => {
  if (!rooms.has(code)) rooms.set(code, { peers: new Map() });
  return rooms.get(code);
};
const keyOf = (ip, port) => `${ip}:${port}`;

// ===== REST: เซิร์ฟเรียกเมื่อ "มีคนเข้าเซิร์ฟ" =====
// body: { ip, port, playerName? }  -> new 6-digit code every call
app.post("/api/player-enter", (req, res) => {
  let ip = String(req.body.ip || "").trim();
  const port = String(req.body.port || "").trim() || "19132";
  if (!ip) {
    // fallback จับจาก proxy header / req.ip
    ip = (req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || req.ip || "")
      .toString().split(",")[0].trim();
  }
  if (!ip) return res.status(400).json({ ok: false, error: "ip required" });

  const k = keyOf(ip, port);

  // reset code EVERY time this endpoint is called
  let code = six();
  // กันชนกับโค้ดอื่นเล็กน้อย
  while (rooms.has(code) || [...serverCode.values()].includes(code)) code = six();

  serverCode.set(k, code);
  ensureRoom(code);

  return res.json({
    ok: true,
    code,
    scoreboard: {
      objectiveAdd: `scoreboard objectives add SeamuwwApi dummy`,
      playerSet: `scoreboard players set Seamuww SeamuwwApi ${code}`
    }
  });
});

// เผื่ออยากดูว่าตอนนี้ ip:port ใดใช้โค้ดอะไร
app.get("/api/current-code", (req, res) => {
  const ip = String(req.query.ip || "");
  const port = String(req.query.port || "19132");
  const k = keyOf(ip, port);
  const code = serverCode.get(k);
  if (!code) return res.status(404).json({ ok: false, error: "not found" });
  res.json({ ok: true, code });
});

// ===== WebSocket Signaling (ห้องตามรหัส 6 หลัก) =====
const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws) => {
  ws.roomCode = null;
  ws.peerId = null;

  ws.on("message", (buf) => {
    let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }

    if (msg.type === "join") {
      const code = String(msg.roomId || "").trim();
      const pid  = String(msg.peerId || "");
      if (!/^\d{6}$/.test(code) || !pid) return;

      const room = ensureRoom(code);
      if (!room.peers.has(pid)) {
        ws.roomCode = code;
        ws.peerId   = pid;
        room.peers.set(pid, ws);

        ws.send(JSON.stringify({
          type: "joined",
          yourId: pid,
          peers: [...room.peers.keys()].filter(i => i !== pid)
        }));

        for (const [otherId, peerWs] of room.peers) {
          if (otherId === pid) continue;
          if (peerWs.readyState === peerWs.OPEN) {
            peerWs.send(JSON.stringify({ type: "peer-join", peerId: pid }));
          }
        }
      }
    }

    // mesh relay: offer/answer/ice -> ส่งให้ปลายทางที่ระบุ
    if (["offer", "answer", "ice"].includes(msg.type)) {
      const room = rooms.get(ws.roomCode);
      if (!room) return;
      const target = room.peers.get(String(msg.to));
      if (target && target.readyState === target.OPEN) target.send(JSON.stringify(msg));
    }

    if (msg.type === "leave") cleanup(ws);
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
