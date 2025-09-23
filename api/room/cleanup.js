// api/room/cleanup.js
const { db, cors } = require('./_admin');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const code = String(body.code || '').replace(/\D/g, '').slice(0, 6);
  if (!code) return res.status(400).json({ error: 'missing code' });

  const ref = db.collection('calls').doc(code);
  try {
    const [ocSnap, acSnap] = await Promise.all([
      ref.collection('offerCandidates').get(),
      ref.collection('answerCandidates').get(),
    ]);
    await Promise.all(
      [...ocSnap.docs, ...acSnap.docs].map(d => d.ref.delete()).concat([ref.delete()])
    );
  } catch (e) {
    // ignore if already removed
  }
  res.status(200).json({ ok: true });
};
