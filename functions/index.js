/* =====================================================================
   B Chess Analyzer — Cloud Functions (trusted backend)
   - Quick Match matchmaking (Firestore transactions + RTDB room creation)
   - Learning-material ratings (transactional average)
   - Admin: OTP pre-check / rate limit, session verification, material CRUD, logout
   Runs with the Firebase Admin SDK. Never ship service-account keys to the browser.
   ===================================================================== */
'use strict';

const crypto = require('crypto');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions } = require('firebase-functions/v2');
const { defineString } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();
const { FieldValue, Timestamp } = require('firebase-admin/firestore');

// Keep in sync with FUNCTIONS_REGION in features.js.
setGlobalOptions({ region: 'asia-south1', maxInstances: 10 });

// The only phone number that may ever hold the admin role (set in functions/.env).
const ADMIN_PHONE = defineString('ADMIN_PHONE', { default: '+918838718613' });

// ---------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------
const toMillis = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : Number(t) || 0);

function requireUser(request) {
  if (!request.auth || !request.auth.uid) throw new HttpsError('unauthenticated', 'Please sign in first.');
  return request.auth.uid;
}

function rtdb() { return admin.database(); }

async function loadProfile(uid, token) {
  let data = {};
  try { data = (await rtdb().ref('users/' + uid).once('value')).val() || {}; } catch (e) { logger.warn('profile read failed', e.message); }
  const name = String(data.username || data.name || (token && token.name) || 'Player').slice(0, 40);
  const rating = Math.max(100, Math.min(4000, Math.round(Number(data.rating) || 800)));
  return { uid, name, rating };
}

// ---------------------------------------------------------------------
// 1. QUICK MATCH
// ---------------------------------------------------------------------
const TIME_CONTROLS = {
  '1+0': { base: 60, increment: 0, category: 'Bullet' },
  '2+1': { base: 120, increment: 1, category: 'Bullet' },
  '3+0': { base: 180, increment: 0, category: 'Blitz' },
  '3+2': { base: 180, increment: 2, category: 'Blitz' },
  '5+0': { base: 300, increment: 0, category: 'Blitz' },
  '10+0': { base: 600, increment: 0, category: 'Rapid' },
  '10+5': { base: 600, increment: 5, category: 'Rapid' },
  '15+10': { base: 900, increment: 10, category: 'Rapid' },
  '30+0': { base: 1800, increment: 0, category: 'Classical' }
};
const QUEUE_STALE_MS = 25000;            // waiting entries without heartbeat for this long are offline
const PAIRING_STUCK_MS = 30000;          // recover from an interrupted pairing
const ACTIVE_MATCH_MAX_MS = 4 * 3600 * 1000;

const queueRef = (uid) => db.collection('quickMatchQueue').doc(uid);

function matchedPayload(d, resume) {
  return {
    status: 'matched',
    roomCode: d.roomCode,
    color: d.color,
    opponent: d.opponent || {},
    timeControl: d.timeKey,
    matchId: d.matchId || null,
    resume: !!resume
  };
}

async function isRoomActive(roomCode, uid, matchedAt) {
  if (!roomCode) return false;
  if (Date.now() - toMillis(matchedAt) > ACTIVE_MATCH_MAX_MS) return false;
  const room = (await rtdb().ref('rooms/' + roomCode).once('value')).val();
  return !!(room && !room.gameOver && (room.creatorId === uid || room.guestId === uid));
}

exports.quickMatchJoin = onCall(async (request) => {
  const uid = requireUser(request);
  const timeKey = String((request.data && request.data.timeControl) || '');
  const tc = TIME_CONTROLS[timeKey];
  if (!tc) throw new HttpsError('invalid-argument', 'Unknown time control.');
  const myRef = queueRef(uid);

  // Duplicate-request protection: an unfinished match is resumed, never duplicated.
  const existing = await myRef.get();
  if (existing.exists && existing.data().status === 'matched') {
    const d = existing.data();
    if (await isRoomActive(d.roomCode, uid, d.matchedAt)) return matchedPayload(d, true);
  }

  const me = await loadProfile(uid, request.auth.token);

  const pairing = await db.runTransaction(async (tx) => {
    const now = Date.now();
    const mineSnap = await tx.get(myRef);
    const mine = mineSnap.exists ? mineSnap.data() : null;
    if (mine && mine.status === 'pairing' && now - toMillis(mine.updatedAt) < PAIRING_STUCK_MS) return { status: 'pairing' };
    // A "matched" entry here belongs to a finished game (active games were resumed above):
    // nobody can pair with a matched entry, so it is safe to overwrite it below.

    const q = await tx.get(db.collection('quickMatchQueue')
      .where('timeKey', '==', timeKey).where('status', '==', 'waiting').limit(30));
    const candidates = q.docs
      .filter(d => d.id !== uid && now - toMillis(d.data().lastSeen) < QUEUE_STALE_MS)
      .sort((a, b) => toMillis(a.data().createdAt) - toMillis(b.data().createdAt));

    const stamp = Timestamp.now();
    if (!candidates.length) {
      const keepCreated = mine && mine.status === 'waiting' && mine.timeKey === timeKey && mine.createdAt;
      tx.set(myRef, {
        userId: uid, timeKey, status: 'waiting', name: me.name, rating: me.rating,
        createdAt: keepCreated || stamp, lastSeen: stamp, updatedAt: stamp,
        matchId: null, roomCode: null, color: null, opponent: null, matchedAt: null
      });
      return { status: 'waiting' };
    }

    const oppDoc = candidates[0];
    const o = oppDoc.data();
    const opp = { uid: oppDoc.id, name: String(o.name || 'Player'), rating: Number(o.rating) || 800 };
    const matchRef = db.collection('quickMatches').doc();
    const roomCode = 'QM' + matchRef.id;
    const meWhite = crypto.randomInt(2) === 0;
    const white = meWhite ? me : opp;
    const black = meWhite ? opp : me;

    tx.set(matchRef, {
      player1: { uid: white.uid, name: white.name, rating: white.rating, color: 'w' },
      player2: { uid: black.uid, name: black.name, rating: black.rating, color: 'b' },
      players: [white.uid, black.uid],
      timeControl: timeKey, baseSeconds: tc.base, increment: tc.increment, category: tc.category,
      roomCode, status: 'creating', createdAt: stamp
    });
    tx.update(oppDoc.ref, { status: 'pairing', matchId: matchRef.id, updatedAt: stamp });
    tx.set(myRef, {
      userId: uid, timeKey, status: 'pairing', name: me.name, rating: me.rating,
      createdAt: stamp, lastSeen: stamp, updatedAt: stamp, matchId: matchRef.id,
      roomCode: null, color: null, opponent: null, matchedAt: null
    });
    return { status: 'paired', matchRef, roomCode, white, black, oppRef: oppDoc.ref, oppCreatedAt: o.createdAt || stamp };
  });

  if (pairing.status === 'waiting' || pairing.status === 'pairing') return { status: pairing.status };

  const { matchRef, roomCode, white, black, oppRef } = pairing;
  try {
    // The game itself runs in the existing Realtime Database rooms/{code} flow.
    await rtdb().ref('rooms/' + roomCode).set({
      creatorId: white.uid, creatorName: white.name, creatorRating: white.rating,
      guestId: black.uid, guestName: black.name, guestRating: black.rating,
      gameFen: 'start', status: 'playing', gameOver: false,
      timeControl: tc.base, increment: tc.increment,
      quickMatch: true, quickKey: timeKey, quickLabel: tc.category + ' • ' + timeKey,
      matchId: matchRef.id, createdAt: require('firebase-admin/database').ServerValue.TIMESTAMP
    });
  } catch (err) {
    logger.error('room creation failed', err);
    const stamp = Timestamp.now();
    const batch = db.batch();
    batch.update(oppRef, { status: 'waiting', matchId: null, lastSeen: stamp, updatedAt: stamp });
    batch.delete(queueRef(uid));
    batch.update(matchRef, { status: 'failed' });
    await batch.commit().catch(() => {});
    throw new HttpsError('internal', 'Could not create the game. Please try again.');
  }

  const stamp = Timestamp.now();
  const batch = db.batch();
  batch.update(matchRef, { status: 'active', startedAt: stamp });
  [[white, black, 'w'], [black, white, 'b']].forEach(([p, o, color]) => {
    batch.update(queueRef(p.uid), {
      status: 'matched', roomCode, color, matchedAt: stamp, updatedAt: stamp,
      opponent: { uid: o.uid, name: o.name, rating: o.rating }
    });
  });
  await batch.commit();

  const mine = white.uid === uid ? { color: 'w', opponent: black } : { color: 'b', opponent: white };
  return {
    status: 'matched', roomCode, color: mine.color, timeControl: timeKey, matchId: matchRef.id, resume: false,
    opponent: { uid: mine.opponent.uid, name: mine.opponent.name, rating: mine.opponent.rating }
  };
});

exports.quickMatchCancel = onCall(async (request) => {
  const uid = requireUser(request);
  const myRef = queueRef(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(myRef);
    if (!snap.exists) return { cancelled: true };
    const d = snap.data();
    if (d.status === 'waiting') { tx.delete(myRef); return { cancelled: true }; }
    if (d.status === 'pairing') return { cancelled: false, status: 'pairing' };
    if (d.status === 'matched' && Date.now() - toMillis(d.matchedAt) < 60000) return Object.assign({ cancelled: false }, matchedPayload(d, false));
    tx.delete(myRef);
    return { cancelled: true };
  });
});

// Housekeeping: remove abandoned queue entries.
exports.quickMatchCleanup = onSchedule('every 30 minutes', async () => {
  const cutoff = Timestamp.fromMillis(Date.now() - 10 * 60000);
  const old = await db.collection('quickMatchQueue').where('updatedAt', '<', cutoff).limit(400).get();
  const batch = db.batch();
  old.docs.forEach(d => { if (d.data().status !== 'matched' || toMillis(d.data().matchedAt) < Date.now() - ACTIVE_MATCH_MAX_MS) batch.delete(d.ref); });
  await batch.commit();
  logger.info('quickMatchCleanup removed', old.size);
});

// ---------------------------------------------------------------------
// 2. LEARNING MATERIAL RATINGS (one rating per user, average kept in a transaction)
// ---------------------------------------------------------------------
exports.rateMaterial = onCall(async (request) => {
  const uid = requireUser(request);
  const materialId = String((request.data && request.data.materialId) || '');
  const rating = Number(request.data && request.data.rating);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(materialId)) throw new HttpsError('invalid-argument', 'Invalid material.');
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpsError('invalid-argument', 'Rating must be 1 to 5 stars.');

  const matRef = db.collection('learningMaterials').doc(materialId);
  const rRef = matRef.collection('ratings').doc(uid); // doc id = user id → no duplicates
  return db.runTransaction(async (tx) => {
    const [mat, prev] = await Promise.all([tx.get(matRef), tx.get(rRef)]);
    if (!mat.exists || mat.data().published !== true) throw new HttpsError('not-found', 'This learning material is not available.');
    const m = mat.data();
    const prevRating = prev.exists ? Number(prev.data().rating) || 0 : 0;
    const total = (Number(m.totalRatings) || 0) + (prev.exists ? 0 : 1);
    const sum = Math.max(0, (Number(m.ratingSum) || 0) - prevRating + rating);
    const average = total ? Math.round((sum / total) * 100) / 100 : 0;
    const now = FieldValue.serverTimestamp();
    tx.set(rRef, prev.exists ? { userId: uid, rating, updatedAt: now } : { userId: uid, rating, createdAt: now, updatedAt: now }, { merge: true });
    tx.update(matRef, { ratingSum: sum, totalRatings: total, averageRating: average });
    return { rating, averageRating: average, totalRatings: total };
  });
});

// ---------------------------------------------------------------------
// 3. ADMIN (Phone OTP + custom claim + admins/{uid} record)
// ---------------------------------------------------------------------
const OTP_IP_MAX_PER_HOUR = 5;
const OTP_IP_MIN_GAP_MS = 30000;
const OTP_GLOBAL_MAX_PER_HOUR = 15;

function maskPhone(p) { return String(p || '').replace(/^(\+\d{2})\d+(\d{4})$/, '$1 ••••••$2'); }

function clientIp(request) {
  const raw = request.rawRequest || {};
  const fwd = String((raw.headers && raw.headers['x-forwarded-for']) || '').split(',')[0].trim();
  return fwd || raw.ip || 'unknown';
}

async function consumeOtpQuota(request) {
  const ipKey = crypto.createHash('sha256').update('bchess-otp:' + clientIp(request)).digest('hex').slice(0, 40);
  const ipRef = db.collection('adminOtpRequests').doc('ip_' + ipKey);
  const globalRef = db.collection('adminOtpRequests').doc('global');
  await db.runTransaction(async (tx) => {
    const now = Date.now();
    const [ipSnap, gSnap] = await Promise.all([tx.get(ipRef), tx.get(globalRef)]);
    const ipTimes = ((ipSnap.exists && ipSnap.data().times) || []).filter(t => now - t < 3600000);
    const gTimes = ((gSnap.exists && gSnap.data().times) || []).filter(t => now - t < 3600000);
    const last = ipTimes.length ? Math.max(...ipTimes) : 0;
    if (now - last < OTP_IP_MIN_GAP_MS) throw new HttpsError('resource-exhausted', 'Please wait a minute before requesting another OTP.');
    if (ipTimes.length >= OTP_IP_MAX_PER_HOUR || gTimes.length >= OTP_GLOBAL_MAX_PER_HOUR) {
      throw new HttpsError('resource-exhausted', 'Too many OTP requests. Please try again later.');
    }
    ipTimes.push(now); gTimes.push(now);
    tx.set(ipRef, { times: ipTimes, updatedAt: FieldValue.serverTimestamp() });
    tx.set(globalRef, { times: gTimes, updatedAt: FieldValue.serverTimestamp() });
  });
}

// Called before the browser asks Firebase to send an SMS: rate limit + authorised number only.
exports.adminOtpPrecheck = onCall(async (request) => {
  const phone = String((request.data && request.data.phoneNumber) || '');
  if (!/^\+91[6-9]\d{9}$/.test(phone)) throw new HttpsError('invalid-argument', 'Enter a valid 10-digit mobile number.');
  await consumeOtpQuota(request);
  if (phone !== ADMIN_PHONE.value()) {
    logger.warn('Admin OTP requested for an unauthorised number', { masked: maskPhone(phone) });
    throw new HttpsError('permission-denied', 'Access Denied – You are not an authorized Admin.');
  }
  return { ok: true };
});

// Every protected admin operation goes through this check.
async function requireAdmin(request) {
  if (!request.auth || !request.auth.rawToken) throw new HttpsError('unauthenticated', 'Admin session required.');
  let token;
  try {
    token = await admin.auth().verifyIdToken(request.auth.rawToken, true); // true = reject revoked sessions
  } catch (e) {
    throw new HttpsError('unauthenticated', 'Your admin session has expired. Please verify OTP again.');
  }
  const denied = () => new HttpsError('permission-denied', 'Access Denied – You are not an authorized Admin.');
  if (!token.firebase || token.firebase.sign_in_provider !== 'phone') throw denied();
  if (token.phone_number !== ADMIN_PHONE.value()) throw denied();
  if (token.admin !== true) throw denied();
  const rec = await db.collection('admins').doc(token.uid).get();
  if (!rec.exists || rec.data().active !== true || rec.data().phone !== ADMIN_PHONE.value()) throw denied();
  if (Date.now() / 1000 - Number(token.auth_time || 0) > 12 * 3600) {
    throw new HttpsError('unauthenticated', 'Your admin session has expired. Please verify OTP again.');
  }
  return token;
}

exports.adminVerifySession = onCall(async (request) => {
  const token = await requireAdmin(request);
  await db.collection('admins').doc(token.uid).set({ lastLoginAt: FieldValue.serverTimestamp() }, { merge: true });
  return { admin: true, phoneMasked: maskPhone(token.phone_number) };
});

exports.adminLogout = onCall(async (request) => {
  if (!request.auth) return { ok: true };
  const token = request.auth.token || {};
  if (token.admin === true) await admin.auth().revokeRefreshTokens(request.auth.uid); // forces a new OTP login
  return { ok: true };
});

function cleanMaterialInput(data) {
  const title = String((data && data.title) || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ');
  if (title.length < 2 || title.length > 120) throw new HttpsError('invalid-argument', 'Title must be 2–120 characters.');
  let url;
  try { url = new URL(String((data && data.url) || '').trim()); } catch (e) { throw new HttpsError('invalid-argument', 'Please enter a valid URL.'); }
  if (url.protocol !== 'https:') throw new HttpsError('invalid-argument', 'The URL must start with https://');
  if (url.href.length > 500) throw new HttpsError('invalid-argument', 'URL is too long.');
  const resourceType = String((data && data.resourceType) || '');
  if (!['video'].includes(resourceType)) throw new HttpsError('invalid-argument', 'Unsupported resource type.');
  return { title, url: url.href, resourceType, published: data.published !== false };
}

function materialRef(id) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(id || ''))) throw new HttpsError('invalid-argument', 'Invalid material id.');
  return db.collection('learningMaterials').doc(String(id));
}

exports.adminSaveMaterial = onCall(async (request) => {
  const token = await requireAdmin(request);
  const input = cleanMaterialInput(request.data || {});
  const now = FieldValue.serverTimestamp();
  if (request.data && request.data.id) {
    const ref = materialRef(request.data.id);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Material not found.');
    await ref.update(Object.assign({}, input, { updatedAt: now, updatedBy: token.uid }));
    return { id: ref.id };
  }
  const ref = await db.collection('learningMaterials').add(Object.assign({}, input, {
    createdAt: now, createdBy: token.uid, updatedAt: now,
    averageRating: 0, totalRatings: 0, ratingSum: 0
  }));
  return { id: ref.id };
});

exports.adminSetPublished = onCall(async (request) => {
  const token = await requireAdmin(request);
  const ref = materialRef(request.data && request.data.id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Material not found.');
  await ref.update({ published: request.data.published === true, updatedAt: FieldValue.serverTimestamp(), updatedBy: token.uid });
  return { ok: true };
});

exports.adminDeleteMaterial = onCall(async (request) => {
  await requireAdmin(request);
  const ref = materialRef(request.data && request.data.id);
  await db.recursiveDelete(ref); // also removes the ratings subcollection
  return { ok: true };
});
