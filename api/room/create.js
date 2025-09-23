// api/room/create.js
const { db, admin, cors } = require('./_admin');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  let code = null, lastErr = null;
  for (let i = 0; i < 12; i++) {
    const c = String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
    const ref = db.collection('calls').doc(c);
    try {
      await db.runTransaction(async (t) => {
        const snap = await t.get(ref);
        if (snap.exists) throw new Error('taken');
        t.set(ref, { createdAt: admin.firestore.FieldValue.serverTimestamp(), state: 'waiting' });
      });
      code = c; break;
    } catch (e) { lastErr = e; }
  }
  if (!code) return res.status(500).json({ error: 'cannot allocate code', detail: String(lastErr) });
  res.status(200).json({ code });
};
