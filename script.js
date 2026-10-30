// ==========================================================================
// B-CHESS ANALYZER: FINAL INTEGRATED SCRIPT (POPUP FIX & EXACT FIREBASE CONFIG)
// ==========================================================================

// --- 1. FIREBASE CONFIGURATION (Matches Your Firebase Console Settings) ---
const firebaseConfig = {
  // Replace apiKey below with the exact key copied from your Firebase Console if needed:
  apiKey: "AIzaSyYOUR_API_KEY_HERE",
  authDomain: "b-chess-analyser.firebaseapp.com",
  databaseURL: "https://b-chess-analyser-default-rtdb.firebaseio.com",
  projectId: "b-chess-analyser",
  storageBucket: "b-chess-analyser.firebasestorage.app",
  messagingSenderId: "338871638210",
  appId: "1:338871638210:web:8653ca64fe66d120a13df6",
  measurementId: "G-GZ0L6G6Z7Z"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const database = firebase.database();

// --- 2. GLOBAL STATE ---
let board = null;
let game = new Chess();
let soundEnabled = true;
let arrowEnabled = true;
let boardTheme = "green"; // green or wood
let currentMode = "analysis"; // 'analysis', 'ai', 'friend'

let currentUserId = null;
let currentUserName = "Player";
let currentUserRating = 800;

let currentRoomCode = null;
let myColor = 'w';
let peerConnection = null;
let localVoiceStream = null;
let isMicMuted = true;

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};

// --- 3. CUSTOM NATURAL SOUND EFFECTS ---
let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function playSound(type) {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    if (type === 'move') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(80, now + 0.08);
      gain.gain.setValueAtTime(0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
      osc.start(now);
      osc.stop(now + 0.08);
    } else if (type === 'capture') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.12);
      gain.gain.setValueAtTime(0.6, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if (type === 'check' || type === 'blunder') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(260, now);
      osc.frequency.setValueAtTime(180, now + 0.1);
      gain.gain.setValueAtTime(0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
      osc.start(now);
      osc.stop(now + 0.25);
    }
  } catch (err) {
    console.warn("Sound play error:", err);
  }
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  document.getElementById("soundToggleBtn").innerText = soundEnabled ? "🔊 Sound: ON" : "🔇 Sound: OFF";
}

function toggleArrow() {
  arrowEnabled = !arrowEnabled;
  document.getElementById("arrowToggleBtn").innerText = arrowEnabled ? "🏹 Arrow: ON" : "🏹 Arrow: OFF";
}

function toggleBoardTheme() {
  if (boardTheme === "green") {
    boardTheme = "wood";
    document.getElementById("themeToggleBtn").innerText = "🎨 Classic Wood";
  } else {
    boardTheme = "green";
    document.getElementById("themeToggleBtn").innerText = "🎨 Green & White";
  }
}

// --- 4. BOARD INITIALIZATION ---
function initBoard() {
  let boardTarget = document.getElementById("board") || document.getElementById("myBoard");
  if (!boardTarget) return;

  const cfg = {
    draggable: true,
    position: 'start',
    pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
    onDragStart: handleDragStart,
    onDrop: handleDrop,
    onSnapEnd: () => board.position(game.fen())
  };

  board = Chessboard(boardTarget, cfg);
  updateGameMeta();
}

$(document).ready(() => {
  initBoard();
  initAuthAndRating();
  setupAudioUnlock();
});

// --- 5. GOOGLE AUTH & SKILL LEVEL (FIXED: NO AUTOMATIC POPUP BLOCK ON PAGE LOAD) ---
function initAuthAndRating() {
  // Check redirect login result first if popup was blocked
  auth.getRedirectResult().then((result) => {
    if (result && result.user) {
      console.log("Logged in via redirect:", result.user.displayName);
    }
  }).catch((err) => {
    console.warn("Redirect check:", err.message);
  });

  auth.onAuthStateChanged(async (user) => {
    if (user) {
      currentUserId = user.uid;
      currentUserName = user.displayName || "Player";

      document.getElementById("googleLoginBtn").style.display = "none";
      document.getElementById("userProfile").style.display = "flex";
      document.getElementById("userNameDisplay").innerText = currentUserName;
      document.getElementById("playerName").innerText = currentUserName;

      const userRef = database.ref("users/" + user.uid);
      const snap = await userRef.once("value");
      const data = snap.val();

      if (!data || !data.rating) {
        document.getElementById("skillModal").style.display = "flex";
      } else {
        currentUserRating = data.rating;
        updateRatingDisplays();
      }
    } else {
      currentUserId = null;
      document.getElementById("googleLoginBtn").style.display = "flex";
      document.getElementById("userProfile").style.display = "none";
      // NOTE: Do NOT call triggerGoogleLogin() here automatically!
      // Calling popup inside page load causes browsers to block popups.
    }
  });
}

function triggerGoogleLogin() {
  const provider = new firebase.auth.GoogleAuthProvider();
  // Using direct click-triggered popup with redirect fallback
  auth.signInWithPopup(provider).catch((err) => {
    console.warn("Popup error:", err.code, err.message);
    if (err.code === "auth/popup-blocked") {
      alert("Browser blocked the popup. Redirecting to Google Sign-In page...");
      auth.signInWithRedirect(provider);
    } else if (err.code !== "auth/popup-closed-by-user") {
      alert("Sign-in error: " + err.message);
    }
  });
}

function handleLogout() {
  auth.signOut().then(() => window.location.reload());
}

function selectSkillLevel(level) {
  let initial = 800;
  if (level === 'intermediate') initial = 1200;
  if (level === 'advanced') initial = 1600;

  if (currentUserId) {
    database.ref("users/" + currentUserId).set({
      name: currentUserName,
      rating: initial,
      skillLevel: level
    }).then(() => {
      currentUserRating = initial;
      document.getElementById("skillModal").style.display = "none";
      updateRatingDisplays();
    });
  }
}

function updateRatingDisplays() {
  document.getElementById("userRatingDisplay").innerText = currentUserRating;
  document.getElementById("playerRating").innerText = `(${currentUserRating})`;
}

function updateMatchRatings(winnerUid, loserUid) {
  if (winnerUid) {
    database.ref("users/" + winnerUid + "/rating").transaction(r => (r || 800) + 8);
  }
  if (loserUid) {
    database.ref("users/" + loserUid + "/rating").transaction(r => Math.max(100, (r || 800) - 8));
  }
}

// --- 6. WEBRTC VOICE CHAT WITH AUTOPLAY FIX ---
function setupAudioUnlock() {
  const unlock = () => {
    const audio = document.getElementById("remoteAudio");
    if (audio && audio.paused && audio.srcObject) {
      audio.play().catch(e => console.log("Voice autoplay unlock:", e));
    }
  };
  document.addEventListener("click", unlock, { once: true });
}

async function startVoiceChat(roomId, isCaller) {
  try {
    localVoiceStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localVoiceStream.getAudioTracks().forEach(t => t.enabled = false);

    document.getElementById("toggleMicBtn").disabled = false;
    document.getElementById("voiceStatus").className = "voice-badge on";
    document.getElementById("voiceStatus").innerText = "Connected";

    peerConnection = new RTCPeerConnection(rtcConfig);

    localVoiceStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localVoiceStream);
    });

    peerConnection.ontrack = (event) => {
      const audio = document.getElementById("remoteAudio");
      if (audio && event.streams[0]) {
        audio.srcObject = event.streams[0];
        audio.play().catch(e => console.warn("Waiting user click to autoplay audio:", e));
      }
    };

    const roomVoiceRef = database.ref("rooms/" + roomId + "/voice");

    peerConnection.onicecandidate = (e) => {
      if (e.candidate) {
        const path = isCaller ? "callerCandidates" : "calleeCandidates";
        roomVoiceRef.child(path).push(e.candidate.toJSON());
      }
    };

    if (isCaller) {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      await roomVoiceRef.child("offer").set({ sdp: offer.sdp, type: offer.type });

      roomVoiceRef.child("answer").on("value", async (snap) => {
        const answer = snap.val();
        if (answer && !peerConnection.currentRemoteDescription) {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        }
      });

      roomVoiceRef.child("calleeCandidates").on("child_added", (snap) => {
        const cand = snap.val();
        if (cand) peerConnection.addIceCandidate(new RTCIceCandidate(cand));
      });
    } else {
      roomVoiceRef.child("offer").once("value", async (snap) => {
        const offer = snap.val();
        if (offer) {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          await roomVoiceRef.child("answer").set({ sdp: answer.sdp, type: answer.type });
        }
      });

      roomVoiceRef.child("callerCandidates").on("child_added", (snap) => {
        const cand = snap.val();
        if (cand) peerConnection.addIceCandidate(new RTCIceCandidate(cand));
      });
    }
  } catch (err) {
    console.warn("Microphone access denied or unsupported:", err);
  }
}

function toggleMicrophone() {
  if (!localVoiceStream) return;
  isMicMuted = !isMicMuted;
  localVoiceStream.getAudioTracks().forEach(t => t.enabled = !isMicMuted);

  const btn = document.getElementById("toggleMicBtn");
  if (isMicMuted) {
    btn.innerText = "🎤 Unmute Mic";
    btn.style.background = "#2563eb";
  } else {
    btn.innerText = "🔇 Mute Mic";
    btn.style.background = "#ef4444";
  }
}

// --- 7. CHESS ENGINE & MOVE HANDLERS ---
function handleDragStart(source, piece, position, orientation) {
  if (game.game_over()) return false;

  if (currentMode === "friend" && currentRoomCode) {
    if ((myColor === 'w' && piece.search(/^b/) !== -1) ||
        (myColor === 'b' && piece.search(/^w/) !== -1)) {
      return false;
    }
    if ((game.turn() === 'w' && myColor !== 'w') ||
        (game.turn() === 'b' && myColor !== 'b')) {
      return false;
    }
  }
}

function handleDrop(source, target) {
  const isCapture = game.get(target) !== null;
  const move = game.move({
    from: source,
    to: target,
    promotion: 'q'
  });

  if (move === null) return 'snapback';

  if (isCapture) playSound('capture');
  else playSound('move');

  if (game.in_check()) playSound('check');

  if (currentMode === "friend" && currentRoomCode) {
    database.ref("rooms/" + currentRoomCode + "/game").update({
      fen: game.fen(),
      lastMove: { from: source, to: target }
    });
  }

  updateGameMeta();
  recordMoveHistory(move);
}

function updateGameMeta() {
  const turn = game.turn() === 'w' ? "White to move" : "Black to move";
  document.getElementById("gameStatusText").innerText = turn;
  updateCapturedPieces();
}

function recordMoveHistory(move) {
  const list = document.getElementById("moveHistoryList");
  const moveText = `${move.from}-${move.to} `;
  list.innerText += moveText;
}

function updateCapturedPieces() {
  const pieces = { p: 8, r: 2, n: 2, b: 2, q: 1 };
  let whiteCaptured = "";
  let blackCaptured = "";

  const currentCounts = { w: {}, b: {} };
  game.board().forEach(row => {
    row.forEach(sq => {
      if (sq) currentCounts[sq.color][sq.type] = (currentCounts[sq.color][sq.type] || 0) + 1;
    });
  });

  ['p', 'n', 'b', 'r', 'q'].forEach(t => {
    const missingW = (pieces[t] || 0) - (currentCounts.w[t] || 0);
    const missingB = (pieces[t] || 0) - (currentCounts.b[t] || 0);
    if (missingW > 0) blackCaptured += t.toUpperCase() + " ";
    if (missingB > 0) whiteCaptured += t + " ";
  });

  document.getElementById("playerCaptured").innerText = whiteCaptured;
  document.getElementById("opponentCaptured").innerText = blackCaptured;
}

// --- 8. MODE SWITCHER & MULTIPLAYER ROOMS ---
function switchMode(mode) {
  currentMode = mode;
  document.querySelectorAll(".mode-btn").forEach(b => b.classList.remove("active"));
  if (mode === 'analysis') document.getElementById("modeAnalysisBtn").classList.add("active");
  if (mode === 'ai') document.getElementById("modeVsBotBtn").classList.add("active");
  if (mode === 'friend') document.getElementById("modeFriendBtn").classList.add("active");

  const multiPanel = document.getElementById("multiplayerPanel");
  const actionControls = document.getElementById("gameActionControls");
  if (mode === 'friend') {
    multiPanel.style.display = "block";
    actionControls.style.display = "flex";
  } else {
    multiPanel.style.display = "none";
    actionControls.style.display = "none";
  }
}

function createRoom() {
  if (!currentUserId) {
    alert("Please Sign in with Google first!");
    return triggerGoogleLogin();
  }
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  currentRoomCode = code;
  myColor = 'w';
  board.orientation('white');

  database.ref("rooms/" + code).set({
    creatorId: currentUserId,
    creatorName: currentUserName,
    creatorRating: currentUserRating,
    guestId: null,
    guestName: null,
    game: { fen: 'start' },
    status: 'waiting'
  }).then(() => {
    showRoomUI(code);
    listenToRoom(code, true);
    startVoiceChat(code, true);
  });
}

function joinRoom() {
  if (!currentUserId) {
    alert("Please Sign in with Google first!");
    return triggerGoogleLogin();
  }
  const code = document.getElementById("roomCodeInput").value.trim();
  if (!code) return alert("Please enter Room Code");

  const roomRef = database.ref("rooms/" + code);
  roomRef.once("value", (snap) => {
    const val = snap.val();
    if (!val) return alert("Invalid room code!");

    currentRoomCode = code;
    myColor = 'b';
    board.orientation('black');

    roomRef.update({
      guestId: currentUserId,
      guestName: currentUserName,
      guestRating: currentUserRating,
      status: 'playing'
    }).then(() => {
      showRoomUI(code);
      listenToRoom(code, false);
      startVoiceChat(code, false);
    });
  });
}

function showRoomUI(code) {
  document.getElementById("roomActiveBanner").style.display = "flex";
  document.getElementById("activeRoomCodeDisplay").innerText = code;
}

function copyRoomCode() {
  navigator.clipboard.writeText(currentRoomCode);
  alert("Room code copied: " + currentRoomCode);
}

function listenToRoom(roomId, isCreator) {
  const roomRef = database.ref("rooms/" + roomId);

  roomRef.on("value", (snap) => {
    const val = snap.val();
    if (!val) return;

    if (isCreator && val.guestName) {
      document.getElementById("opponentName").innerText = val.guestName;
      document.getElementById("opponentRating").innerText = `(${val.guestRating || 800})`;
    } else if (!isCreator && val.creatorName) {
      document.getElementById("opponentName").innerText = val.creatorName;
      document.getElementById("opponentRating").innerText = `(${val.creatorRating || 800})`;
    }

    if (val.game && val.game.fen && val.game.fen !== game.fen()) {
      if (val.game.fen === 'start') game.reset();
      else game.load(val.game.fen);
      board.position(game.fen());
      playSound('move');
      updateGameMeta();
    }

    if (val.drawOffer && val.drawOffer !== currentUserId) {
      const accept = confirm("Opponent offered a draw. Do you accept?");
      if (accept) {
        roomRef.update({ gameOver: true, result: 'draw', drawOffer: null });
      } else {
        roomRef.child("drawOffer").remove();
      }
    }

    if (val.gameOver) {
      if (val.result === 'resigned') {
        const iWon = val.winner === currentUserId;
        alert(iWon ? "Opponent resigned! You won (+8 Rating)!" : "You resigned (-8 Rating).");
      } else if (val.result === 'draw') {
        alert("The game ended in a draw.");
      }
    }
  });

  listenForChat(roomId);
}

// --- 9. RESIGN & DRAW REQUESTS ---
function resignCurrentGame() {
  if (!currentRoomCode) return alert("Not in an active match!");
  if (!confirm("Are you sure you want to resign? (-8 Rating)")) return;

  const roomRef = database.ref("rooms/" + currentRoomCode);
  roomRef.once("value", (snap) => {
    const val = snap.val();
    const opponentId = (val.creatorId === currentUserId) ? val.guestId : val.creatorId;

    roomRef.update({
      gameOver: true,
      result: 'resigned',
      winner: opponentId,
      loser: currentUserId
    });
    updateMatchRatings(opponentId, currentUserId);
  });
}

function offerDrawGame() {
  if (!currentRoomCode) return alert("Not in an active match!");
  database.ref("rooms/" + currentRoomCode + "/drawOffer").set(currentUserId);
  alert("Draw offer sent to opponent.");
}

// --- 10. LIVE IN-GAME CHAT ---
function handleSendChat(e) {
  e.preventDefault();
  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  if (!text || !currentRoomCode) return;

  database.ref("rooms/" + currentRoomCode + "/chat").push({
    sender: currentUserName,
    senderId: currentUserId,
    text: text,
    timestamp: Date.now()
  });
  input.value = "";
}

function listenForChat(roomId) {
  const container = document.getElementById("chatMessages");
  container.innerHTML = "";

  database.ref("rooms/" + roomId + "/chat").limitToLast(50).on("child_added", (snap) => {
    const msg = snap.val();
    const isMe = msg.senderId === currentUserId;

    const bubble = document.createElement("div");
    bubble.className = `chat-bubble ${isMe ? 'mine' : 'theirs'}`;
    bubble.innerHTML = `<span class="chat-author">${escapeHtml(msg.sender)}</span>${escapeHtml(msg.text)}`;

    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.innerText = str;
  return div.innerHTML;
}

function switchSidebarTab(tab) {
  if (tab === 'analysis') {
    document.getElementById("tabAnalysis").classList.add("active");
    document.getElementById("tabReview").classList.remove("active");
    document.getElementById("tabContentAnalysis").style.display = "block";
    document.getElementById("tabContentReview").style.display = "none";
  } else {
    document.getElementById("tabReview").classList.add("active");
    document.getElementById("tabAnalysis").classList.remove("active");
    document.getElementById("tabContentReview").style.display = "block";
    document.getElementById("tabContentAnalysis").style.display = "none";
  }
}
