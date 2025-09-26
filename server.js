// server.js — Express + WebSocket signaling for 1:1 calls
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');


const app = express();
const PORT = process.env.PORT || 3000;


// Serve static files
app.use(express.static(path.join(__dirname, 'public')));


// Health check
app.get('/healthz', (_, res) => res.status(200).send('ok'));


const server = app.listen(PORT, () => {
console.log(`HTTP listening on :${PORT}`);
});


// WebSocket signaling
const wss = new WebSocketServer({ server, path: '/ws' });


// rooms: { [roomId: string]: Set<WebSocket> }
const rooms = new Map();


function broadcast(roomId, except, data) {
const set = rooms.get(roomId);
if (!set) return;
for (const ws of set) {
if (ws !== except && ws.readyState === ws.OPEN) {
ws.send(JSON.stringify(data));
}
}
}


wss.on('connection', (ws) => {
ws.roomId = null;


ws.on('message', (buf) => {
let msg;
try { msg = JSON.parse(buf.toString()); } catch { return; }


const type = msg?.type;
if (type === 'join') {
const roomId = String(msg.roomId || '').trim();
if (!roomId) return;


// Enforce 1:1 (max 2 clients per room)
const set = rooms.get(roomId) || new Set();
if (set.size >= 2) {
ws.send(JSON.stringify({ type: 'room-full' }));
return;
}
set.add(ws);
rooms.set(roomId, set);
ws.roomId = roomId;


// Inform peers someone joined
broadcast(roomId, ws, { type: 'peer-join' });


// Reply with room state
ws.send(JSON.stringify({ type: 'joined', peers: set.size - 1 }));
}


// Forward SDP/ICE to the other peer in the room
else if (type === 'offer' || type === 'answer' || type === 'ice') {
const roomId = ws.roomId;
if (!roomId) return;
broadcast(roomId, ws, msg);
}


else if (type === 'leave') {
cleanup(ws);
}
});


ws.on('close', () => cleanup(ws));
});


function cleanup(ws) {
const roomId = ws.roomId;
if (!roomId) return;
const set = rooms.get(roomId);
if (!set) return;
set.delete(ws);
if (set.size === 0) rooms.delete(roomId);
else broadcast(roomId, ws, { type: 'peer-leave' });
ws.roomId = null;
}