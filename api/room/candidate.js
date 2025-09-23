// api/room/candidate.js
const { db, admin, cors } = require('./_admin');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const code = String(body.code || '').replace(/\D/g, '').slice(0, 6);
  const role = String(body.role || '');
  const candidate = body.candidate;
  if (!code || !candidate || !['caller', 'callee'].includes(role)) {
    return res.status(400).json({ error: 'invalid params' });
  }

  const coll = role === 'caller' ? 'offerCandidates' : 'answerCandidates';
  await db.collection('calls').doc(code).collection(coll).add({
    candidate,
    createdAtMs: Date.now(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  res.status(200).json({ ok: true });
};
