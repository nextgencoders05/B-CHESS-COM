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
