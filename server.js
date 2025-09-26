// server.js — Voice hub (key-by-code) + BedrockBridge webhook + signaling
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

/* =========================
   STATE (ผูกทุกอย่างด้วย "รหัส")
========================= */
const rooms = new Map(); // Map<code, { peers: Map<peerId, ws> }>
const six = () => String(Math.floor(100000 + Math.random() * 900000));
const ensureRoom = (code) => {
  if (!rooms.has(code)) rooms.set(code, { peers: new Map() });
  return rooms.get(code);
};

/* =========================================================
   1) Endpoint สำหรับ BedrockBridge ยิงมาบอกเหตุการณ์จากเซิร์ฟ
   ---------------------------------------------------------
   - เรารองรับ 2 เหตุการณ์พื้นฐาน: playerJoin, chat (ขยายเพิ่มทีหลังได้)
   - ทุกครั้งที่ playerJoin => สุ่ม "รหัสใหม่ 6 หลัก", เตรียมห้อง,
     แล้วตอบ "ชุดคำสั่ง scoreboard" กลับไปให้ BedrockBridge รันในเกม
   - รูปแบบ request (ตัวอย่าง):
     { "event": "playerJoin", "player": "Steve", "server": "th-01" }
   - รูปแบบ response:
     {
       ok: true,
       code: "123456",
       commands: [
         "scoreboard objectives add SeamuwwApi dummy",
         "scoreboard players set Seamuww SeamuwwApi 123456",
         "tellraw @a {\"rawtext\":[{\"text\":\"§a[Voice]§r รหัสห้องคุย: §e123456§r  เปิดเว็บ: https://webtro.onrender.com/?room=123456\"}]}"
       ]
     }
========================================================= */
app.post("/bridge/event", (req, res) => {
  const { event, player, server } = req.body || {};

  // รองรับ /ping ง่ายๆ ไว้ให้ทดสอบ
  if (event === "ping") return res.json({ ok: true, pong: true });

  if (event === "playerJoin") {
    // สุ่มรหัสใหม่ทุกครั้งที่มีคนเข้า
    let code = six();
    while (rooms.has(code)) code = six(); // กันซ้ำเล็กน้อย
    ensureRoom(code);

    const url = `https://webtro.onrender.com/?room=${code}`;

    const commands = [
      // ทำ scoreboard ตามที่คุณกำหนด
      `scoreboard objectives add SeamuwwApi dummy`,
      `scoreboard players set Seamuww SeamuwwApi ${code}`,
      // แจ้งผู้เล่นที่เข้าสู่เซิร์ฟ (หรือทั้งเซิร์ฟก็ได้)
      `tellraw ${player ? `"${player}"` : "@a"} {"rawtext":[{"text":"§a[Voice]§r รหัสห้องคุย: §e${code}§r\\nเปิดเว็บ: ${url}"}]}`
    ];

    return res.json({ ok: true, code, commands });
  }

  if (event === "chat") {
    // ยังไม่ใช้ก็ได้—เผื่อในอนาคตอยากสั่งงานด้วยแชต เช่น !voice
    return res.json({ ok: true });
  }

  return res.status(400).json({ ok: false, error: "unknown event" });
});

/* =========================================================
   2) (ออปชัน) endpoint แบบเก่าที่เกมเรียกได้เอง (ถ้ายังอยากใช้)
========================================================= */
app.post("/api/player-enter", (_req, res) => {
  let code = six();
  while (rooms.has(code)) code = six();
  ensureRoom(code);
  return res.json({
    ok: true,
    code,
    scoreboard: {
      objectiveAdd: `scoreboard objectives add SeamuwwApi dummy`,
      playerSet:     `scoreboard players set Seamuww SeamuwwApi ${code}`
    }
  });
});

/* =========================================================
   3) WebSocket Signaling (mesh ต่อห้องด้วยรหัส)
========================================================= */
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
