/* End-to-end test against the Firebase Local Emulator Suite (no real project, no real SMS).
   Run from functions/:  npm run test:emulator   (see README) */
'use strict';
const assert = require('assert');
const { execFileSync } = require('child_process');
const path = require('path');
const admin = require('firebase-admin');

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-bchess';
const REGION = 'asia-south1';
const ADMIN_PHONE = '+918838718613';
const AUTH = 'http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST;
const FS = 'http://' + process.env.FIRESTORE_EMULATOR_HOST;
const FN = 'http://127.0.0.1:' + (process.env.BCHESS_FN_PORT || 5001) + '/' + PROJECT + '/' + REGION + '/';

admin.initializeApp({ projectId: PROJECT, databaseURL: (JSON.parse(process.env.FIREBASE_CONFIG || '{}').databaseURL) || ('https://' + PROJECT + '.firebaseio.com') });
const db = admin.firestore();
const rtdb = admin.database();

let passed = 0;
async function step(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { console.error('  ✗', name, '\n    ', e && e.stack || e); process.exitCode = 1; throw e; }
}

async function post(url, body, token) {
  const res = await fetch(url, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: JSON.stringify(body) });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (_) { json = { raw: text }; }
  return { status: res.status, json };
}

async function callFn(name, data, token) {
  const r = await post(FN + name, { data: data || {} }, token);
  if (r.json.error) { const e = new Error(r.json.error.message); e.code = String(r.json.error.status || '').toLowerCase().replace(/_/g, '-'); throw e; }
  return r.json.result;
}
async function expectFnError(name, data, token, code) {
  try { await callFn(name, data, token); } catch (e) { assert.strictEqual(e.code, code, name + ' error ' + e.code + ' ' + e.message); return e; }
  throw new Error(name + ' should have failed with ' + code);
}

async function emailUser(n) {
  const email = n + '@test.dev';
  await post(AUTH + '/identitytoolkit.googleapis.com/v1/accounts:signUp?key=k', { email, password: 'secret123', returnSecureToken: true });
  const r = await post(AUTH + '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=k', { email, password: 'secret123', returnSecureToken: true });
  await rtdb.ref('users/' + r.json.localId).set({ username: n, rating: 1000 + n.length });
  return { uid: r.json.localId, token: r.json.idToken, name: n };
}

async function phoneSignIn(phone, wrongCode) {
  const s = await post(AUTH + '/identitytoolkit.googleapis.com/v1/accounts:sendVerificationCode?key=k', { phoneNumber: phone, recaptchaToken: 'x' });
  const codes = await (await fetch(AUTH + '/emulator/v1/projects/' + PROJECT + '/verificationCodes')).json();
  const entry = codes.verificationCodes.filter(c => c.sessionInfo === s.json.sessionInfo)[0];
  const r = await post(AUTH + '/identitytoolkit.googleapis.com/v1/accounts:signInWithPhoneNumber?key=k', { sessionInfo: s.json.sessionInfo, code: wrongCode || entry.code });
  return r.json;
}

async function clearOtpQuota() {
  const snap = await db.collection('adminOtpRequests').get();
  await Promise.all(snap.docs.map(d => d.ref.delete()));
}

async function untilMatched(user, key, tries) {
  for (let i = 0; i < (tries || 8); i++) {
    const r = await callFn('quickMatchJoin', { timeControl: key }, user.token);
    if (r.status === 'matched') return r;
    await new Promise(res => setTimeout(res, 150));
  }
  // Like the web client, also watch the queue entry: another player's request may pair us.
  for (let i = 0; i < 40; i++) {
    const d = (await db.doc('quickMatchQueue/' + user.uid).get()).data();
    if (d && d.status === 'matched') return { status: 'matched', roomCode: d.roomCode, color: d.color, opponent: d.opponent };
    await new Promise(res => setTimeout(res, 250));
  }
  return null;
}

(async () => {
  console.log('Quick Match');
  const [A, B, C] = await Promise.all(['alice', 'bob', 'carol'].map(emailUser));

  await step('rejects unauthenticated / unknown time control', async () => {
    await expectFnError('quickMatchJoin', { timeControl: '3+2' }, null, 'unauthenticated');
    await expectFnError('quickMatchJoin', { timeControl: '7+7' }, A.token, 'invalid-argument');
  });

  let matchAC;
  await step('first player waits, different time control does not match', async () => {
    assert.strictEqual((await callFn('quickMatchJoin', { timeControl: '3+2' }, A.token)).status, 'waiting');
    assert.strictEqual((await callFn('quickMatchJoin', { timeControl: '5+0' }, B.token)).status, 'waiting');
  });
  await step('same time control pairs two different players and creates the room', async () => {
    matchAC = await callFn('quickMatchJoin', { timeControl: '3+2' }, C.token);
    assert.strictEqual(matchAC.status, 'matched');
    assert.strictEqual(matchAC.opponent.uid, A.uid);
    const room = (await rtdb.ref('rooms/' + matchAC.roomCode).once('value')).val();
    assert.ok(room && room.quickMatch && !room.gameOver);
    assert.deepStrictEqual([room.creatorId, room.guestId].sort(), [A.uid, C.uid].sort());
    assert.strictEqual(room.timeControl, 180);
    assert.strictEqual(room.increment, 2);
    assert.strictEqual(room.quickLabel, 'Blitz • 3+2');
    const qa = (await db.doc('quickMatchQueue/' + A.uid).get()).data();
    assert.strictEqual(qa.status, 'matched');
    assert.strictEqual(qa.roomCode, matchAC.roomCode);
    assert.notStrictEqual(qa.color, matchAC.color);
  });
  await step('repeated request resumes the same match (no duplicates)', async () => {
    const again = await callFn('quickMatchJoin', { timeControl: '3+2' }, A.token);
    assert.strictEqual(again.status, 'matched');
    assert.strictEqual(again.roomCode, matchAC.roomCode);
    assert.strictEqual(again.resume, true);
    const matches = await db.collection('quickMatches').where('players', 'array-contains', A.uid).get();
    assert.strictEqual(matches.size, 1);
  });
  await step('after the game ends the player can queue again', async () => {
    await rtdb.ref('rooms/' + matchAC.roomCode).update({ gameOver: true, result: 'resigned' });
    assert.strictEqual((await callFn('quickMatchJoin', { timeControl: '3+2' }, A.token)).status, 'waiting');
    assert.strictEqual((await callFn('quickMatchCancel', {}, A.token)).cancelled, true);
  });
  await step('cancel removes the queue entry', async () => {
    assert.strictEqual((await callFn('quickMatchCancel', {}, B.token)).cancelled, true);
    assert.strictEqual((await db.doc('quickMatchQueue/' + B.uid).get()).exists, false);
  });
  await step('disconnected (stale) players are skipped', async () => {
    const [H, I] = await Promise.all(['henry', 'ivy'].map(emailUser));
    await callFn('quickMatchJoin', { timeControl: '10+0' }, H.token);
    await db.doc('quickMatchQueue/' + H.uid).update({ lastSeen: require('firebase-admin/firestore').Timestamp.fromMillis(Date.now() - 60000) });
    assert.strictEqual((await callFn('quickMatchJoin', { timeControl: '10+0' }, I.token)).status, 'waiting');
    await callFn('quickMatchCancel', {}, I.token);
  });
  await step('8 simultaneous players → 4 consistent matches, nobody double-booked', async () => {
    const users = await Promise.all(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'].map(emailUser));
    const results = await Promise.all(users.map(u => untilMatched(u, '1+0', 10)));
    results.forEach((r, i) => assert.ok(r && r.status === 'matched', users[i].name + ' not matched'));
    const byRoom = {};
    results.forEach((r, i) => { (byRoom[r.roomCode] = byRoom[r.roomCode] || []).push(users[i].uid); });
    assert.strictEqual(Object.keys(byRoom).length, 4);
    for (const code of Object.keys(byRoom)) {
      assert.strictEqual(byRoom[code].length, 2);
      const room = (await rtdb.ref('rooms/' + code).once('value')).val();
      assert.deepStrictEqual([room.creatorId, room.guestId].sort(), byRoom[code].sort());
    }
  });

  console.log('Security rules (client access)');
  const fsDoc = (p) => FS + '/v1/projects/' + PROJECT + '/databases/(default)/documents/' + p;
  await step('clients cannot write learning materials, queue entries or admin records', async () => {
    let r = await post(fsDoc('learningMaterials?documentId=hack'), { fields: { title: { stringValue: 'x' }, published: { booleanValue: true } } }, A.token);
    assert.strictEqual(r.status, 403);
    r = await post(fsDoc('admins?documentId=' + A.uid), { fields: { active: { booleanValue: true } } }, A.token);
    assert.strictEqual(r.status, 403);
    r = await post(fsDoc('quickMatchQueue?documentId=' + A.uid), { fields: { status: { stringValue: 'matched' } } }, A.token);
    assert.strictEqual(r.status, 403);
  });
  await step('players can read only their own queue entry', async () => {
    let res = await fetch(fsDoc('quickMatchQueue/' + C.uid), { headers: { Authorization: 'Bearer ' + C.token } });
    assert.strictEqual(res.status, 200);
    res = await fetch(fsDoc('quickMatchQueue/' + C.uid), { headers: { Authorization: 'Bearer ' + B.token } });
    assert.strictEqual(res.status, 403);
  });

  console.log('Admin phone OTP');
  await clearOtpQuota();
  await step('unauthorised number is denied before any SMS', async () => {
    const e = await expectFnError('adminOtpPrecheck', { phoneNumber: '+919999999999' }, null, 'permission-denied');
    assert.ok(/Access Denied/.test(e.message));
    await expectFnError('adminOtpPrecheck', { phoneNumber: '12345' }, null, 'invalid-argument');
  });
  await clearOtpQuota();
  await step('authorised number passes pre-check; repeated requests are rate limited', async () => {
    assert.strictEqual((await callFn('adminOtpPrecheck', { phoneNumber: ADMIN_PHONE })).ok, true);
    await expectFnError('adminOtpPrecheck', { phoneNumber: ADMIN_PHONE }, null, 'resource-exhausted');
  });
  await step('incorrect OTP is rejected', async () => {
    const r = await phoneSignIn(ADMIN_PHONE, '000000');
    assert.ok(r.error && /INVALID_CODE/.test(r.error.message), JSON.stringify(r));
  });
  let adminToken;
  await step('phone verification alone does NOT grant admin', async () => {
    const r = await phoneSignIn(ADMIN_PHONE);
    assert.ok(r.idToken);
    await expectFnError('adminVerifySession', {}, r.idToken, 'permission-denied');
    await expectFnError('adminSaveMaterial', { title: 'X', url: 'https://instagram.com/x', resourceType: 'video' }, r.idToken, 'permission-denied');
  });
  await step('other phone numbers / Google users cannot use admin functions', async () => {
    const other = await phoneSignIn('+919876543210');
    await expectFnError('adminVerifySession', {}, other.idToken, 'permission-denied');
    await expectFnError('adminSaveMaterial', { title: 'Hack', url: 'https://x.com', resourceType: 'video' }, A.token, 'permission-denied');
  });
  await step('owner grants the role with the Admin SDK script; new OTP session is admin', async () => {
    execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'grant-admin.js')], { env: process.env, stdio: 'pipe' });
    const r = await phoneSignIn(ADMIN_PHONE);
    adminToken = r.idToken;
    const s = await callFn('adminVerifySession', {}, adminToken);
    assert.strictEqual(s.admin, true);
    assert.strictEqual(s.phoneMasked, '+91 ••••••8613');
  });

  console.log('Learning materials + ratings');
  let matId, draftId;
  await step('admin validation: bad title / bad URL rejected', async () => {
    await expectFnError('adminSaveMaterial', { title: '', url: 'https://instagram.com/x', resourceType: 'video' }, adminToken, 'invalid-argument');
    await expectFnError('adminSaveMaterial', { title: "King's Gambit", url: 'javascript:alert(1)', resourceType: 'video' }, adminToken, 'invalid-argument');
    await expectFnError('adminSaveMaterial', { title: "King's Gambit", url: 'http://instagram.com/x', resourceType: 'video' }, adminToken, 'invalid-argument');
  });
  await step('admin saves a published video and an unpublished one', async () => {
    matId = (await callFn('adminSaveMaterial', { title: "King's Gambit", url: 'https://www.instagram.com/reel/abc123/', resourceType: 'video', published: true }, adminToken)).id;
    draftId = (await callFn('adminSaveMaterial', { title: 'Draft', url: 'https://www.instagram.com/reel/zzz/', resourceType: 'video', published: false }, adminToken)).id;
    const d = (await db.doc('learningMaterials/' + matId).get()).data();
    assert.strictEqual(d.title, "King's Gambit");
    assert.strictEqual(d.resourceType, 'video');
    assert.strictEqual(d.totalRatings, 0);
  });
  await step('users (even signed-out) read only published materials', async () => {
    const q = { structuredQuery: { from: [{ collectionId: 'learningMaterials' }], where: { fieldFilter: { field: { fieldPath: 'published' }, op: 'EQUAL', value: { booleanValue: true } } } } };
    const r = await post(FS + '/v1/projects/' + PROJECT + '/databases/(default)/documents:runQuery', q, null);
    assert.strictEqual(r.status, 200);
    const ids = r.json.filter(x => x.document).map(x => x.document.name.split('/').pop());
    assert.deepStrictEqual(ids, [matId]);
    const res = await fetch(fsDoc('learningMaterials/' + draftId), { headers: { Authorization: 'Bearer ' + A.token } });
    assert.strictEqual(res.status, 403);
  });
  await step('ratings: average, total, update own rating, no duplicates', async () => {
    let r = await callFn('rateMaterial', { materialId: matId, rating: 5 }, A.token);
    assert.deepStrictEqual([r.averageRating, r.totalRatings], [5, 1]);
    r = await callFn('rateMaterial', { materialId: matId, rating: 3 }, B.token);
    assert.deepStrictEqual([r.averageRating, r.totalRatings], [4, 2]);
    r = await callFn('rateMaterial', { materialId: matId, rating: 1 }, A.token);   // update, not a new rating
    assert.deepStrictEqual([r.averageRating, r.totalRatings], [2, 2]);
    const all = await db.collection('learningMaterials/' + matId + '/ratings').get();
    assert.strictEqual(all.size, 2);
  });
  await step('ratings: invalid values, unpublished items, signed-out users rejected', async () => {
    await expectFnError('rateMaterial', { materialId: matId, rating: 6 }, A.token, 'invalid-argument');
    await expectFnError('rateMaterial', { materialId: matId, rating: 2.5 }, A.token, 'invalid-argument');
    await expectFnError('rateMaterial', { materialId: draftId, rating: 4 }, A.token, 'not-found');
    await expectFnError('rateMaterial', { materialId: matId, rating: 4 }, null, 'unauthenticated');
  });
  await step('8 concurrent ratings keep the average exact', async () => {
    const raters = await Promise.all(Array.from({ length: 8 }, (_, i) => emailUser('r' + i)));
    await Promise.all(raters.map((u, i) => callFn('rateMaterial', { materialId: matId, rating: (i % 5) + 1 }, u.token)));
    const d = (await db.doc('learningMaterials/' + matId).get()).data();
    // 8 raters: 1,2,3,4,5,1,2,3 (sum 21) + alice 1 + bob 3 → 25 / 10
    assert.strictEqual(d.totalRatings, 10);
    assert.strictEqual(d.ratingSum, 25);
    assert.strictEqual(d.averageRating, 2.5);
  });
  await step('users cannot read other users\' ratings', async () => {
    let res = await fetch(fsDoc('learningMaterials/' + matId + '/ratings/' + A.uid), { headers: { Authorization: 'Bearer ' + A.token } });
    assert.strictEqual(res.status, 200);
    res = await fetch(fsDoc('learningMaterials/' + matId + '/ratings/' + A.uid), { headers: { Authorization: 'Bearer ' + B.token } });
    assert.strictEqual(res.status, 403);
  });
  await step('admin edits, unpublishes and deletes (ratings removed too)', async () => {
    await callFn('adminSaveMaterial', { id: matId, title: "King's Gambit Accepted", url: 'https://www.instagram.com/reel/abc123/', resourceType: 'video', published: true }, adminToken);
    assert.strictEqual((await db.doc('learningMaterials/' + matId).get()).data().title, "King's Gambit Accepted");
    await callFn('adminSetPublished', { id: matId, published: false }, adminToken);
    assert.strictEqual((await db.doc('learningMaterials/' + matId).get()).data().published, false);
    await callFn('adminDeleteMaterial', { id: matId }, adminToken);
    assert.strictEqual((await db.doc('learningMaterials/' + matId).get()).exists, false);
    assert.strictEqual((await db.collection('learningMaterials/' + matId + '/ratings').get()).size, 0);
  });
  await step('logout revokes the admin session (OTP required again)', async () => {
    await callFn('adminLogout', {}, adminToken);
    await new Promise(r => setTimeout(r, 1100));
    await expectFnError('adminVerifySession', {}, adminToken, 'unauthenticated');
    const fresh = await phoneSignIn(ADMIN_PHONE);
    assert.strictEqual((await callFn('adminVerifySession', {}, fresh.idToken)).admin, true);
  });

  console.log('\nAll ' + passed + ' checks passed.');
})().catch(() => { console.error('\nFAILED after ' + passed + ' passing checks.'); process.exit(1); });
