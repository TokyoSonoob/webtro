// api/room/_admin.js
const admin = require('firebase-admin');

let db;
if (!admin.apps.length) {
  const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (!svc.project_id) {
    throw new Error('Missing FIREBASE_SERVICE_ACCOUNT (service account JSON) in Vercel ENV');
  }
  admin.initializeApp({ credential: admin.credential.cert(svc) });
}
db = admin.firestore();

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = { admin, db, cors };
