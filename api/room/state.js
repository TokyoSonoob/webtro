// api/room/state.js
const { db, cors } = require('./_admin');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  const code = String(req.query.code || '').replace(/\D/g, '').slice(0, 6);
  if (!code) return res.status(400).json({ error: 'missing code' });

  const snap = await db.collection('calls').doc(code).get();
  if (!snap.exists) return res.status(404).json({ error: 'not found' });
  const d = snap.data() || {};
  const out = {};
  if (d.offer) out.offer = d.offer;
  if (d.answer) out.answer = d.answer;
  res.status(200).json(out);
};
