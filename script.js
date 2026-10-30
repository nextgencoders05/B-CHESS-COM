// ==========================================================================
// B-CHESS ANALYZER: ALL ORIGINAL ENGINE & SOUNDS + MULTIPLAYER, CHAT, RATINGS
// ==========================================================================

// --- 1. FIREBASE CONFIGURATION ---
const firebaseConfig = {
  apiKey: "AIzaSyYOUR_API_KEY_HERE",
  authDomain: "b-chess-analyser.firebaseapp.com",
  databaseURL: "https://b-chess-analyser-default-rtdb.firebaseio.com",
  projectId: "b-chess-analyser",
  storageBucket: "b-chess-analyser.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_ID",
  appId: "YOUR_APP_ID"
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

// --- 3. CUSTOM NATURAL SOUND EFFECTS (Original Audio Synthesis & Audio Context) ---
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
      // Natural wooden click sound
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

// --- 4. INITIALIZATION & MANDATORY GOOGLE LOGIN ---
window.addEventListener("DOMContentLoaded", () => {
  initBoard();
  initAuthAndRating();
  setupAudioUnlock();
});

function initAuthAndRating() {
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
        // Show skill level selection modal
        document.getElementById("skillModal").style.display = "flex";
      } else {
        currentUserRating = data.rating;
        updateRatingDisplays();
      }
    } else {
      currentUserId = null;
      document.getElementById("googleLoginBtn").style.display = "flex";
      document.getElementById("userProfile").style.display = "none";
      // Prompt Google Login
      triggerGoogleLogin();
    }
  });
}

function triggerGoogleLogin() {
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider).catch(err => {
    console.warn("Login prompt:", err.message);
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

// Match Rating Change: +8 for Winner, -8 for Loser
function updateMatchRatings(winnerUid, loserUid) {
  if (winnerUid) {
    database.ref("users/" + winnerUid + "/rating").transaction(r => (r || 800) + 8);
  }
  if (loserUid) {
    database.ref("users/" + loserUid + "/rating").transaction(r => Math.max(100, (r || 800) - 8));
  }
}

// --- 5. WEBRTC VOICE CHAT WITH AUTOPLAY FIX ---
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
    localVoiceStream.getAudioTracks().forEach(t => t.enabled = false); // muted initially

    document.getElementById("toggleMicBtn").disabled = false;
    document.getElementById("voiceStatus").className = "voice-status-badge on";
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
    console.warn("Microphone not available or permission denied:", err);
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

// --- 6. CHESS ENGINE & BOARD LOGIC ---
function initBoard() {
  const cfg = {
    draggable: true,
    position: 'start',
    pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
    onDragStart: handleDragStart,
    onDrop: handleDrop,
    onSnapEnd: () => board.position(game.fen())
  };
  board = Chessboard('board', cfg);
  updateGameMeta();
}

function handleDragStart(source, piece, position, orientation) {
  if (game.game_over()) return false;

  // In Multiplayer mode, check color and turn
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

  // Play Sound
  if (isCapture) playSound('capture');
  else playSound('move');

  if (game.in_check()) playSound('check');

  // Push Move in Multiplayer
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

  // Simple Material & captured pieces tracker
  updateCapturedPieces();
}

function recordMoveHistory(move) {
  const list = document.getElementById("moveHistoryList");
  const moveText = `${move.from}-${move.to} `;
  list.innerText += moveText;
}

function updateCapturedPieces() {
  // Compute captured pieces from initial vs current board pieces
  const pieces = { p: 8, r: 2, n: 2, b: 2, q: 1 };
  let whiteCaptured = "";
  let blackCaptured = "";

  const boardArray = game.board();
  const currentCounts = { w: {}, b: {} };

  boardArray.forEach(row => {
    row.forEach(sq => {
      if (sq) {
        currentCounts[sq.color][sq.type] = (currentCounts[sq.color][sq.type] || 0) + 1;
      }
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

// --- 7. PLAY WITH FRIENDS, ROOMS, RESIGN & DRAW ---
function switchMode(mode) {
  currentMode = mode;
  document.querySelectorAll(".mode-btn").forEach(b => b.classList.remove("active"));
  if (mode === 'analysis') document.getElementById("modeAnalysisBtn").classList.add("active");
  if (mode === 'ai') document.getElementById("modeVsAiBtn").classList.add("active");
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
  if (!currentUserId) return triggerGoogleLogin();
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
  if (!currentUserId) return triggerGoogleLogin();
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
  document.getElementById("roomActiveInfo").style.display = "flex";
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

    // Opponent Details
    if (isCreator && val.guestName) {
      document.getElementById("opponentName").innerText = val.guestName;
      document.getElementById("opponentRating").innerText = `(${val.guestRating || 800})`;
    } else if (!isCreator && val.creatorName) {
      document.getElementById("opponentName").innerText = val.creatorName;
      document.getElementById("opponentRating").innerText = `(${val.creatorRating || 800})`;
    }

    // Sync Chess Board
    if (val.game && val.game.fen && val.game.fen !== game.fen()) {
      if (val.game.fen === 'start') game.reset();
      else game.load(val.game.fen);
      board.position(game.fen());
      playSound('move');
      updateGameMeta();
    }

    // Draw Offer Listener
    if (val.drawOffer && val.drawOffer !== currentUserId) {
      const accept = confirm("Opponent offered a draw. Do you accept?");
      if (accept) {
        roomRef.update({ gameOver: true, result: 'draw', drawOffer: null });
      } else {
        roomRef.child("drawOffer").remove();
      }
    }

    // Resign & Game Over Listener
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

function resignCurrentGame() {
  if (!currentRoomCode) return alert("Not in a game!");
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
  if (!currentRoomCode) return alert("Not in a game!");
  database.ref("rooms/" + currentRoomCode + "/drawOffer").set(currentUserId);
  alert("Draw offer sent to opponent.");
}

// --- 8. IN-GAME LIVE CHAT ---
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
    bubble.innerHTML = `<span class="chat-sender-name">${escapeHtml(msg.sender)}</span>${escapeHtml(msg.text)}`;

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
