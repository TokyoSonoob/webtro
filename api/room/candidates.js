// api/room/candidates.js
const { db, cors } = require('./_admin');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  const code = String(req.query.code || '').replace(/\D/g, '').slice(0, 6);
  const role = String(req.query.role || '');
  const after = Number(req.query.after || 0);
  if (!code || !['caller','callee'].includes(role)) {
    return res.status(400).json({ error: 'invalid params' });
  }

  const src = role === 'caller' ? 'answerCandidates' : 'offerCandidates';
  let q = db.collection('calls').doc(code).collection(src).orderBy('createdAtMs', 'asc').limit(50);
  if (after > 0) q = q.where('createdAtMs', '>', after);

  const snap = await q.get();
  const items = [];
  snap.forEach(d => {
    const m = d.data() || {};
    items.push({ id: d.id, candidate: m.candidate, createdAtMs: Number(m.createdAtMs || 0) });
  });
  res.status(200).json({ items });
};
