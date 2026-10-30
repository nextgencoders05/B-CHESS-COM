# B Chess Analyzer — Online Multiplayer & Live Voice Chat

## New Features Added:
1. **Firebase Realtime Database Integration**:
   - Full room-based multiplayer move syncing directly on GitHub Pages without requiring a backend server.
   - **Create Room**: Generates a 6-digit room code with a shareable invite URL (`?room=XXXXXX`).
   - **Join Room**: Friends can paste the code or just click the invite link to instantly connect.
   - Automatic side assignment: Host plays **White**, friend plays **Black** (board flips automatically for Black).

2. **WebRTC Live Voice Chat (PeerJS)**:
   - Built-in live audio calling so you can speak to your friend directly through your phone/laptop microphone while playing.
   - **Start Voice Chat** button with browser microphone permission prompt.
   - **Mute / Unmute** toggle with real-time connection status badges.

3. **Preserved Capabilities**:
   - **Mobile Tap-to-Move** with legal green dots & capture rings.
   - **Stockfish Engine Analysis** with Best Move Arrow & Evaluation Bar.
   - **Game Review & Estimated Elo** with real-time Blunder, Mistake, and Inaccuracy detection.
   - **Captured Pieces Display** with material advantage point tracking (+1, +3, +5, etc.).
   - **Realistic Wooden Board & Capture Sound Effects** with mute toggle.
   - **One-click Copy Analysis Report** button.

## How to Deploy to GitHub Pages:
1. Download and extract this ZIP file.
2. Replace `index.html`, `style.css`, and `script.js` in your GitHub repository with these updated files.
3. Commit and push. Within 1 minute, your GitHub Pages site will be live with multiplayer and voice chat!

## புதிய அப்டேட் (Google Login & Profile ID):
- கூகுள் லாகின் (Google Sign-In) வசதி இணைக்கப்பட்டுள்ளது.
- ஒவ்வொரு பயனருக்கும் ஒரு தனித்துவமான ஐடி (எ.கா: `BC-4821`) உருவாக்கப்பட்டு டேட்டாபேஸில் சேமிக்கப்படும்.
- ப்ரொஃபைல் பெயர் மற்றும் படம் திரையின் மேல் பகுதியில் தோன்றும்.
