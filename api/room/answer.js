// api/room/answer.js
const { db, admin, cors } = require('./_admin');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const code = String(body.code || '').replace(/\D/g, '').slice(0, 6);
  if (!code || !body.answer || !body.answer.sdp) return res.status(400).json({ error: 'invalid params' });

  await db.collection('calls').doc(code).set({
    answer: body.answer,
    joinedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  res.status(200).json({ ok: true });
};
