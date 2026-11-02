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
