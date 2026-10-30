// ==========================================================================
// B-CHESS ANALYZER: ALL-IN-ONE ENGINE, MULTIPLAYER, WEBRTC & RATINGS
// ==========================================================================

// --- 1. FIREBASE CONFIGURATION (உங்கள் Firebase விவரங்களை இங்கு வைக்கவும்) ---
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
let currentUserId = null;
let currentUserName = "வீரர்";
let currentUserRating = 800;
let currentRoomCode = null;
let myColor = 'w'; // 'w' or 'b'
let localStream = null;
let peerConnection = null;
let isMicMuted = true;

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};

// --- 3. GOOGLE AUTHENTICATION & MANDATORY SKILL RATING ---
window.addEventListener("DOMContentLoaded", () => {
  initBoard();
  initAuth();
  setupAudioUnlock();
});

function initAuth() {
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      currentUserId = user.uid;
      currentUserName = user.displayName || "வீரர்";

      document.getElementById("loginBtn").style.display = "none";
      document.getElementById("userProfile").style.display = "flex";
      document.getElementById("userNameDisplay").innerText = currentUserName;
      document.getElementById("myName").innerText = currentUserName;

      // Check user record in database
      const userRef = database.ref("users/" + user.uid);
      const snap = await userRef.once("value");
      const data = snap.val();

      if (!data || !data.rating) {
        // First-time user: Show skill level selection modal
        document.getElementById("skillModal").style.display = "flex";
      } else {
        currentUserRating = data.rating;
        updateRatingUI();
      }
    } else {
      // User not logged in: Prompt Google Login
      currentUserId = null;
      document.getElementById("loginBtn").style.display = "block";
      document.getElementById("userProfile").style.display = "none";
      triggerGoogleLogin();
    }
  });
}

function triggerGoogleLogin() {
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider).catch(err => {
    console.warn("Login cancelled or blocked:", err.message);
  });
}

function handleLogout() {
  auth.signOut().then(() => {
    window.location.reload();
  });
}

function selectSkillLevel(level) {
  let initialRating = 800;
  if (level === 'intermediate') initialRating = 1200;
  if (level === 'advanced') initialRating = 1600;

  if (currentUserId) {
    database.ref("users/" + currentUserId).set({
      name: currentUserName,
      rating: initialRating,
      skillLevel: level
    }).then(() => {
      currentUserRating = initialRating;
      document.getElementById("skillModal").style.display = "none";
      updateRatingUI();
    });
  }
}

function updateRatingUI() {
  document.getElementById("userRatingDisplay").innerText = `ரேட்டிங்: ${currentUserRating}`;
  document.getElementById("myRatingTag").innerText = `(${currentUserRating})`;
}

// Adjust ratings (+8 / -8)
function applyMatchRatings(winnerUid, loserUid) {
  if (winnerUid) {
    database.ref("users/" + winnerUid + "/rating").transaction(r => (r || 800) + 8);
  }
  if (loserUid) {
    database.ref("users/" + loserUid + "/rating").transaction(r => Math.max(100, (r || 800) - 8));
  }
}

// --- 4. WEBRTC VOICE CHAT WITH AUTOPLAY FIX ---
function setupAudioUnlock() {
  const unlockAudio = () => {
    const audio = document.getElementById("remoteAudio");
    if (audio && audio.paused && audio.srcObject) {
      audio.play().catch(e => console.log("Audio unlock:", e));
    }
  };
  document.body.addEventListener("click", unlockAudio, { once: true });
}

async function startVoiceChat(roomId, isCaller) {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    // Default muted until button clicked
    localStream.getAudioTracks().forEach(t => t.enabled = false);

    document.getElementById("micToggleBtn").disabled = false;
    document.getElementById("voiceStatus").className = "status-badge on";
    document.getElementById("voiceStatus").innerText = "இணைக்கப்பட்டது";

    peerConnection = new RTCPeerConnection(rtcConfig);

    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });

    peerConnection.ontrack = (event) => {
      const remoteAudio = document.getElementById("remoteAudio");
      if (remoteAudio && event.streams[0]) {
        remoteAudio.srcObject = event.streams[0];
        remoteAudio.play().catch(e => console.warn("Autoplay wait for click:", e));
      }
    };

    const roomRef = database.ref("rooms/" + roomId + "/voice");

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        const path = isCaller ? "callerCandidates" : "calleeCandidates";
        roomRef.child(path).push(event.candidate.toJSON());
      }
    };

    if (isCaller) {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      await roomRef.child("offer").set({ sdp: offer.sdp, type: offer.type });

      roomRef.child("answer").on("value", async (snap) => {
        const answer = snap.val();
        if (answer && !peerConnection.currentRemoteDescription) {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        }
      });

      roomRef.child("calleeCandidates").on("child_added", (snap) => {
        const candidate = snap.val();
        if (candidate) peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      });
    } else {
      roomRef.child("offer").once("value", async (snap) => {
        const offer = snap.val();
        if (offer) {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          await roomRef.child("answer").set({ sdp: answer.sdp, type: answer.type });
        }
      });

      roomRef.child("callerCandidates").on("child_added", (snap) => {
        const candidate = snap.val();
        if (candidate) peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      });
    }
  } catch (err) {
    console.error("Microphone Access Error:", err);
    alert("மைக் அனுமதி வழங்கப்படவில்லை அல்லது ஆதரிக்கப்படவில்லை.");
  }
}

function toggleMicrophone() {
  if (!localStream) return;
  isMicMuted = !isMicMuted;
  localStream.getAudioTracks().forEach(t => t.enabled = !isMicMuted);

  const btn = document.getElementById("micToggleBtn");
  const label = document.getElementById("micStateText");
  if (isMicMuted) {
    btn.innerText = "🎤 மைக் ஆன் செய்";
    label.innerText = "மைக் ஆஃப்";
    btn.style.background = "#2563eb";
  } else {
    btn.innerText = "🔇 மைக் மியூட் செய்";
    label.innerText = "மைக் பேசுகிறது...";
    btn.style.background = "#dc2626";
  }
}

// --- 5. CHESSBOARD & GAME LOGIC ---
function initBoard() {
  const config = {
    draggable: true,
    position: 'start',
    pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
    onDragStart: onDragStart,
    onDrop: onDrop,
    onSnapEnd: onSnapEnd
  };
  board = Chessboard('myBoard', config);
}

function onDragStart(source, piece, position, orientation) {
  if (game.game_over()) return false;
  // Restrict to my color in room
  if (currentRoomCode) {
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

function onDrop(source, target) {
  const move = game.move({
    from: source,
    to: target,
    promotion: 'q'
  });

  if (move === null) return 'snapback';

  if (currentRoomCode) {
    database.ref("rooms/" + currentRoomCode + "/game").update({
      fen: game.fen(),
      lastMove: { from: source, to: target }
    });
  }
  checkGameEnd();
}

function onSnapEnd() {
  board.position(game.fen());
}

function checkGameEnd() {
  if (game.in_checkmate()) {
    const winnerColor = game.turn() === 'w' ? 'Black' : 'White';
    alert(`செக்மேட்! ${winnerColor} வெற்றி பெற்றது!`);
  } else if (game.in_draw()) {
    alert("ஆட்டம் சமனில் முடிவடைந்தது (Draw).");
  }
}

// --- 6. MULTIPLAYER (ROOM CREATION & JOINING) ---
function handleCreateRoom() {
  if (!currentUserId) return alert("தயவுசெய்து முதலில் Google Login செய்யவும்!");
  const roomCode = Math.floor(100000 + Math.random() * 900000).toString();
  currentRoomCode = roomCode;
  myColor = 'w';

  database.ref("rooms/" + roomCode).set({
    creatorId: currentUserId,
    creatorName: currentUserName,
    creatorRating: currentUserRating,
    guestId: null,
    guestName: null,
    game: { fen: 'start' },
    status: 'waiting'
  }).then(() => {
    displayRoomUI(roomCode);
    listenToRoom(roomCode, true);
    startVoiceChat(roomCode, true);
  });
}

function handleJoinRoom() {
  if (!currentUserId) return alert("தயவுசெய்து முதலில் Google Login செய்யவும்!");
  const roomCode = document.getElementById("roomCodeInput").value.trim();
  if (!roomCode) return alert("ரூம் கோடை உள்ளிடவும்!");

  const roomRef = database.ref("rooms/" + roomCode);
  roomRef.once("value", (snap) => {
    const data = snap.val();
    if (!data) return alert("தவறான ரூம் கோடு!");

    currentRoomCode = roomCode;
    myColor = 'b';
    board.orientation('black');

    roomRef.update({
      guestId: currentUserId,
      guestName: currentUserName,
      guestRating: currentUserRating,
      status: 'playing'
    }).then(() => {
      displayRoomUI(roomCode);
      listenToRoom(roomCode, false);
      startVoiceChat(roomCode, false);
    });
  });
}

function displayRoomUI(code) {
  document.getElementById("currentRoomDisplay").style.display = "flex";
  document.getElementById("activeRoomCode").innerText = code;
  document.getElementById("drawBtn").disabled = false;
  document.getElementById("resignBtn").disabled = false;
}

function copyRoomCode() {
  navigator.clipboard.writeText(currentRoomCode);
  alert("ரூம் கோடு நகலெடுக்கப்பட்டது: " + currentRoomCode);
}

function listenToRoom(roomId, isCreator) {
  const roomRef = database.ref("rooms/" + roomId);

  // Sync Players Info
  roomRef.on("value", (snap) => {
    const val = snap.val();
    if (!val) return;

    if (isCreator && val.guestName) {
      document.getElementById("opponentName").innerText = `${val.guestName} (${val.guestRating || 800})`;
    } else if (!isCreator && val.creatorName) {
      document.getElementById("opponentName").innerText = `${val.creatorName} (${val.creatorRating || 800})`;
    }

    // Sync Game FEN
    if (val.game && val.game.fen && val.game.fen !== game.fen()) {
      if (val.game.fen === 'start') {
        game.reset();
      } else {
        game.load(val.game.fen);
      }
      board.position(game.fen());
    }

    // Listen for Draw Offers
    if (val.drawOffer && val.drawOffer !== currentUserId) {
      const accept = confirm("எதிரணி சமன் (Draw) செய்யக் கோருகிறார். ஏற்கிறீர்களா?");
      if (accept) {
        roomRef.update({ gameOver: true, result: 'draw', drawOffer: null });
      } else {
        roomRef.child("drawOffer").remove();
      }
    }

    // Listen for Resign / GameOver
    if (val.gameOver) {
      if (val.result === 'resigned') {
        const isWinner = val.winner === currentUserId;
        alert(isWinner ? "எதிரணி சரணடைந்தார்! நீங்கள் வெற்றி (+8)!" : "நீங்கள் சரணடைந்தீர்கள் (-8).");
      } else if (val.result === 'draw') {
        alert("ஆட்டம் சமனில் முடிவடைந்தது (Draw).");
      }
    }
  });

  listenForChat(roomId);
}

// --- 7. RESIGN & DRAW REQUESTS ---
function resignCurrentGame() {
  if (!currentRoomCode) return;
  if (!confirm("நிச்சயமாக சரணடைய (Resign) விரும்புகிறீர்களா? (-8 Rating)")) return;

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
    applyMatchRatings(opponentId, currentUserId);
  });
}

function offerDrawGame() {
  if (!currentRoomCode) return;
  database.ref("rooms/" + currentRoomCode + "/drawOffer").set(currentUserId);
  alert("டிரா (Draw) கோரிக்கை எதிரணிக்கு அனுப்பப்பட்டது.");
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

  database.ref("rooms/" + roomId + "/chat").limitToLast(60).on("child_added", (snap) => {
    const msg = snap.val();
    const isMe = msg.senderId === currentUserId;

    const bubble = document.createElement("div");
    bubble.className = `chat-bubble ${isMe ? 'mine' : 'theirs'}`;
    bubble.innerHTML = `<span class="chat-sender">${escapeHtml(msg.sender)}</span>${escapeHtml(msg.text)}`;

    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.innerText = str;
  return div.innerHTML;
}
