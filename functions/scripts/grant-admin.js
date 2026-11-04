#!/usr/bin/env node
/* =====================================================================
   One-time owner script: grant (or revoke) the Admin role.
   Run it on YOUR computer only — it uses a Firebase service-account key,
   which must never be uploaded to GitHub or used in browser code.

     Grant:   node scripts/grant-admin.js
     Revoke:  node scripts/grant-admin.js --revoke

   Requires: GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
   The phone number is read from functions/.env (ADMIN_PHONE).
   ===================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

function readAdminPhone() {
  const envFile = path.join(__dirname, '..', '.env');
  const text = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
  const m = text.match(/^\s*ADMIN_PHONE\s*=\s*(\+\d{8,15})\s*$/m);
  return (process.env.ADMIN_PHONE || (m && m[1]) || '').trim();
}

async function main() {
  const revoke = process.argv.includes('--revoke');
  const phone = readAdminPhone();
  if (!/^\+91[6-9]\d{9}$/.test(phone)) throw new Error('ADMIN_PHONE in functions/.env is missing or invalid.');
  const emulator = !!(process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST);
  if (!emulator && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS to your service-account JSON path first (see README).');
  }

  admin.initializeApp(emulator ? { projectId: process.env.GCLOUD_PROJECT } : { credential: admin.credential.applicationDefault() });
  const auth = admin.auth();
  const db = admin.firestore();

  let user;
  try {
    user = await auth.getUserByPhoneNumber(phone);
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
    // Pre-create the phone account so the first OTP login signs into this exact user.
    user = await auth.createUser({ phoneNumber: phone, displayName: 'B Chess Admin' });
    console.log('Created phone user', user.uid);
  }

  if (revoke) {
    await auth.setCustomUserClaims(user.uid, null);
    await auth.revokeRefreshTokens(user.uid);
    await db.collection('admins').doc(user.uid).set({ active: false, revokedAt: FieldValue.serverTimestamp() }, { merge: true });
    await db.collection('users').doc(user.uid).set({ role: 'user' }, { merge: true });
    console.log('Admin role REVOKED for', user.uid);
    return;
  }

  await auth.setCustomUserClaims(user.uid, { admin: true, role: 'admin' });
  await auth.revokeRefreshTokens(user.uid); // old sessions must log in again to receive the claim
  await db.collection('admins').doc(user.uid).set({
    phone, role: 'admin', active: true, grantedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  await db.collection('users').doc(user.uid).set({ displayName: 'B Chess Admin', role: 'admin' }, { merge: true });
  console.log('Admin role GRANTED to', user.uid, '(' + phone.replace(/^(\+\d{2})\d+(\d{4})$/, '$1 ••••••$2') + ')');
}

main().then(() => process.exit(0)).catch(err => { console.error('Error:', err.message); process.exit(1); });
