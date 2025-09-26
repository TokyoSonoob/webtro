// server.js — Voice hub (key-by-code only) + signaling
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

/** ห้องคุย ตามรหัส 6 หลัก */
const rooms = new Map(); // Map<code, { peers: Map<peerId, ws> }>
const six = () => String(Math.floor(100000 + Math.random() * 900000));
const ensureRoom = (code) => {
  if (!rooms.has(code)) rooms.set(code, { peers: new Map() });
  return rooms.get(code);
};

/**
 * POST /api/player-enter
 * เซิร์ฟเวอร์เกมเรียกทุกครั้งที่ “ผู้เล่นเข้ามา”
 * - สุ่มรหัสใหม่ 6 หลักทุกครั้ง
 * - เตรียมห้องตามรหัสนั้น
 * - ส่งคำสั่ง scoreboard ที่ต้องรันคืนไปให้
 */
app.post("/api/player-enter", (req, res) => {
  let code = six();
  // กันซ้ำเล็กน้อย
  while (rooms.has(code)) code = six();

  ensureRoom(code);

  res.json({
    ok: true,
    code,
    scoreboard: {
      objectiveAdd: `scoreboard objectives add SeamuwwApi dummy`,
      playerSet:     `scoreboard players set Seamuww SeamuwwApi ${code}`
    }
  });
});

/* ===== WebSocket Signaling (mesh ตามรหัสห้อง) ===== */
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  ws.roomCode = null;
  ws.peerId = null;

  ws.on("message", (buf) => {
    let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }

    if (msg.type === "join") {
      const code = String(msg.roomId || "");
      const pid  = String(msg.peerId || "");
      if (!/^\d{6}$/.test(code) || !pid) return;

      const room = ensureRoom(code);
      if (!room.peers.has(pid)) {
        ws.roomCode = code;
        ws.peerId   = pid;
        room.peers.set(pid, ws);

        // ส่งรายชื่อเพื่อนที่อยู่ก่อนหน้าให้คนใหม่
        ws.send(JSON.stringify({
          type: "joined",
          yourId: pid,
          peers: [...room.peers.keys()].filter(i => i !== pid)
        }));
        // แจ้งคนเก่า ๆ ว่ามีคนมาใหม่
        for (const [otherId, peerWs] of room.peers) {
          if (otherId === pid) continue;
          if (peerWs.readyState === peerWs.OPEN) {
            peerWs.send(JSON.stringify({ type: "peer-join", peerId: pid }));
          }
        }
      }
    }

    // รีเลย์สัญญาณ WebRTC แบบตัวต่อตัว
    if (["offer","answer","ice"].includes(msg.type)) {
      const room = rooms.get(ws.roomCode);
      if (!room) return;
      const target = room.peers.get(String(msg.to));
      if (target && target.readyState === target.OPEN) {
        target.send(JSON.stringify(msg));
      }
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
