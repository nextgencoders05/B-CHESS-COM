B Chess Analyzer — PWA-ready full project

Deploy the CONTENTS of this folder to the root of your existing GitHub Pages repository (not the ZIP itself).
Keep the folder structure, especially pieces/ and icons/.

Included:
- Original chess project files and chess piece assets
- PWA manifest and service worker
- Install banner and install handling
- App icons at 192x192 and 512x512
- Mobile viewport/safe-area support

Deployment notes:
1. Upload/replace the files in the repository root while preserving folders.
2. Enable GitHub Pages for the correct branch/folder.
3. The site must be served over HTTPS for PWA installation/service workers.
4. On Android Chrome, use the Install banner when available, or browser menu > Install app / Add to Home screen.
5. Some browsers decide when to show the native install prompt; a website cannot force it to appear immediately.
6. Third-party chess libraries loaded from CDNs and online multiplayer features may still require an internet connection.


## Mobile app / PWA
This version is optimized for Android and iPhone browsers while keeping the desktop version.
On mobile, the site shows an install card near the top. On supported Android browsers,
the Install button opens the browser's native PWA installation prompt. On iPhone/iPad,
the button explains Safari > Share > Add to Home Screen.

After installation, B Chess opens in standalone app mode without the normal browser tab/address
bar. The manifest, icons and service worker are included. A normal HTTPS deployment is required
for service-worker/PWA installation.


## Update 2026-11-04 — Quick Match, board mic, challenge alerts

> Note: the navigation order and Quick Match described in this section were replaced by the 2026-11-05 update below.

- Navigation order: Vs Bot, Friend, Analyze, Books.
- Mic ON/OFF button next to each player's name and Elo on the board. Your own bar toggles your mic;
  the opponent's bar shows their live mic status (stored at rooms/{code}/mic/{uid}).
- Incoming challenges pop up immediately with the challenger's name, Elo, time control, a message and
  Accept / Decline buttons. When the app is in the background, a browser/PWA notification is shown too;
  tapping it opens the challenge (its Accept / Decline buttons act directly).
- When you send a challenge, the board shows "Challenge sent to [name]" with their Elo, the time control
  and "Waiting for opponent to accept..." right away.
- Quick Match (Friend > ⚡ Quick Match): pick Rapid / Blitz / Bullet, then the app searches for an online
  player with the same time control and a similar Elo (±50, widening to ±400). If nobody is found within
  about 25 seconds, the game starts against an engine opponent shown as a regular player.
- The service worker now loads pages/scripts network-first, so a new deployment appears on the next load.

Firebase Realtime Database rules: Quick Match uses a new path `matchmaking/{timeControl}/{uid}`.
Signed-in users must be able to read `matchmaking/{timeControl}` and write entries there. Example:

    "matchmaking": {
      "$tc": {
        ".read": "auth != null",
        "$uid": { ".write": "auth != null" }
      }
    }

Without this, Quick Match still works but always ends up with the engine opponent.

Note: browser notifications reach a player while the app/tab is open (including in the background).
Notifications when the app is fully closed would need Firebase Cloud Messaging and a server.


---

## Update 2026-11-05 — Quick Match page, Other Learning Materials, hidden Admin panel (Phone OTP)

### What's new
| Feature | Where |
|---|---|
| **Quick Match** as its own page, first in the navigation (Quick Match → Play → Friends → Analyze → Books) | `features.js`, `features.css`, `index.html` |
| Time controls: Bullet 1+0, 2+1 · Blitz 3+0, 3+2, 5+0 · Rapid 10+0, 10+5, 15+10 · Classical 30+0 (increments supported) | |
| Server-side matchmaking (Firestore transactions in Cloud Functions), cancel, duplicate protection, disconnect handling | `functions/index.js` |
| **Books → Other Learning Materials**: live cards (title, VIDEO badge, Watch Video link, 1–5 star rating, average, count) | `features.js` |
| **Hidden Admin panel**: Ctrl + ↑ (desktop) or tap the ♟ logo in the header 5 times within 3 s (mobile) | `features.js`, `index.html` |
| Admin login with **phone number + SMS OTP only**; only +91 88387 18613 can become admin | `functions/index.js`, `firestore.rules` |
| Admin dashboard: add / edit / delete / publish / unpublish learning materials, logout | `features.js` |

Everything else (board, pieces, themes, engine, rules, promotion, Friends, Challenges, voice chat,
Analyze, Openings/Defences, Google sign-in, Terms, profiles, timers, mobile layout) is unchanged.
`script.js` only received small hooks (Quick Match mode, clock increment, Quick Match result/rematch,
presence-based clock start for Quick Match rooms, Books "Other" panel hand-off).
The old "⚡ Quick Match" button inside the Friend panel now opens the new Quick Match page; the previous
engine-opponent fallback is no longer used — Quick Match always pairs two real players.

### How it works (short)
* **Quick Match**: while searching, the browser calls `quickMatchJoin` every 7 s (this is also the
  heartbeat). The function runs a Firestore transaction on `quickMatchQueue`: it either pairs you with
  the oldest online player waiting for the same time control or puts you in the queue. A pair gets a
  normal Realtime Database room `rooms/QM…` (created by the server) and plays through the existing
  room/clock/chat/voice code. Entries without a heartbeat for 25 s are ignored (closed tab = offline).
* **Disconnects**: each player writes `rooms/{code}/presence/{uid}` (removed automatically on
  disconnect). The clock starts only when both players are connected. If the opponent never connects
  within 30 s, the game is **aborted** (no rating change). If a player drops mid-game they have 60 s
  to come back, otherwise the other player wins (`left`). Reopening Quick Match offers **Resume**.
* **Ratings**: `rateMaterial` stores one rating per user (`ratings/{userId}`) and updates
  `averageRating` / `totalRatings` in the same transaction, so averages are always exact.
* **Admin**: (1) `adminOtpPrecheck` rate-limits and refuses any number other than the configured one —
  other numbers never receive an SMS and see "Access Denied – You are not an authorized Admin."
  (2) Firebase Phone Auth sends the OTP (invisible reCAPTCHA). (3) `adminVerifySession` checks that the
  token is not revoked, was signed in by phone, has the `admin` custom claim, matches `ADMIN_PHONE`, and
  has an active `admins/{uid}` record. **Phone verification alone never grants admin** — you assign the
  claim once with the Admin SDK script. Every admin operation repeats these checks. Logout revokes the
  session (a new OTP is required). The admin session uses a separate Firebase app instance, so it never
  signs the normal Google user out, lasts only for the browser tab, and logs out after 30 minutes idle.

### Firestore structure
```
learningMaterials/{materialId}  title, url, resourceType, published, createdAt, createdBy,
                                updatedAt, averageRating, totalRatings, ratingSum
learningMaterials/{materialId}/ratings/{userId}   userId, rating, createdAt, updatedAt
quickMatchQueue/{userId}        userId, timeKey, status (waiting|pairing|matched), name, rating,
                                createdAt, lastSeen, matchId, roomCode, color, opponent, matchedAt
quickMatches/{matchId}          player1, player2, players[], timeControl, baseSeconds, increment,
                                roomCode, status, createdAt
admins/{uid}                    phone, role, active, grantedAt, lastLoginAt   (server only)
users/{uid}                     displayName, role                              (server only)
adminOtpRequests/*              hashed-IP rate-limit counters                  (server only)
```
Player profiles, friends, challenges and games stay in the Realtime Database as before.

---

## Setup & deployment (one time)

### 1. Firebase console
1. **Upgrade to the Blaze plan** (Project settings → Usage and billing). Cloud Functions and Phone
   Authentication SMS require it. SMS messages are billed per message (see Firebase pricing).
2. **Firestore**: Build → Firestore Database → *Create database* → Native mode → location
   `asia-south1 (Mumbai)` (any location works).
3. **Phone sign-in**: Build → Authentication → Sign-in method → enable **Phone**.
4. **Authorized domains**: Authentication → Settings → Authorized domains → add your GitHub Pages
   domain (e.g. `yourname.github.io`) if it is not listed yet.
5. **SMS abuse protection** (recommended): Authentication → Settings → **SMS region policy** →
   allow only **India**.

### 2. Deploy the backend (Cloud Functions + Firestore rules)
Requires Node.js 20+.
```bash
npm install -g firebase-tools
```
```bash
firebase login
```
From the project folder (where `firebase.json` is):
```bash
cd functions && npm install && cd ..
```
```bash
firebase deploy --only functions,firestore
```
`.firebaserc` already points at `b--chess-analyser`. Functions are deployed to `asia-south1`; if you
change the region, change `setGlobalOptions` in `functions/index.js` **and** `FUNCTIONS_REGION` at the
top of `features.js`. The authorised number is in `functions/.env` (`ADMIN_PHONE=+918838718613`) and in
`firestore.rules` (`isAdmin()`); keep both in sync if it ever changes.

### 3. Grant the Admin role (once)
1. Project settings → **Service accounts** → *Generate new private key*. Save the JSON **outside** this
   folder. Never commit it and never upload it to GitHub Pages.
2. Windows PowerShell:
   ```
   $env:GOOGLE_APPLICATION_CREDENTIALS="C:\secure\b-chess-service-account.json"
   cd functions
   npm run grant-admin
   ```
   macOS/Linux: `GOOGLE_APPLICATION_CREDENTIALS=/secure/key.json npm run grant-admin`
3. The script creates or finds the phone user for `+918838718613`, sets the `admin` custom claim and
   writes `admins/{uid}`. To remove admin access later: `node scripts/grant-admin.js --revoke`.
4. Delete the key file (or store it safely) when you are done.

### 4. Realtime Database rules
Nothing new is required beyond what normal rooms already need: Quick Match games use the same
`rooms/{code}` path (plus `rooms/{code}/presence/{uid}`), and the server creates the room with the
Admin SDK. The old `matchmaking/` path from the previous update is no longer used.

### 5. Deploy the website
Upload the website files to GitHub Pages exactly as before (`index.html`, `*.js`, `*.css`, `pieces/`,
`icons/`, `manifest.webmanifest`, `sw.js`). The service-worker cache version was bumped, so users get
the update on the next load. `functions/`, `firebase.json` and `firestore.rules` do not need to be on
GitHub Pages. If your repository is public, remember that `functions/.env` and `firestore.rules`
contain the admin phone number (no passwords or keys). **Never commit a service-account JSON** —
`.gitignore` already blocks the usual file names.

### 6. Check it
* Quick Match: open the site in two browsers with two different Google accounts, pick the same time
  control in both and press **Find Opponent**.
* Admin: press **Ctrl + ↑** (not while typing in a text box), enter `8838718613`, **Send OTP**, enter
  the SMS code, **Verify OTP** → Admin Dashboard → add a title + Instagram URL → **Save** → it appears
  under **Books → Other Learning Materials** straight away for everyone.

### Automated backend tests (optional)
`functions/test/emulator.test.js` runs 25 end-to-end checks against the Firebase Local Emulator Suite
(demo project, no real data, no SMS): matchmaking (pairing, no duplicates, cancel, stale players,
8 simultaneous players), security rules, admin OTP pre-check, rate limit, wrong OTP, phone-without-claim
denied, other numbers denied, granting via the script, logout revocation, material validation/CRUD and
rating averages. Requires Java 11+ and firebase-tools:
```bash
cd functions && npm run test:emulator
```

### Limits you can tune (top of each file)
* `features.js`: search retry 7 s, give up after 5 min, abort if the opponent is absent 30 s, reconnect
  window 60 s, admin idle logout 30 min, OTP 1 per minute / 3 per 15 min per browser.
* `functions/index.js`: queue heartbeat timeout 25 s, OTP 1 per 30 s and 5 per hour per IP, 15 per
  hour overall.
