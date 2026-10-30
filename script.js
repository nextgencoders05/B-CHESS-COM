// =========================================================================
// B-CHESS FULL ENHANCEMENTS: VOICE CHAT FIX, RATING SYSTEM, CHAT, DRAW/RESIGN
// =========================================================================

// --- 1. VOICE CHAT (MIC) FIX & AUTOPLAY UNBLOCK ---
let remoteAudioElement = null;

function setupRemoteAudio() {
  if (!remoteAudioElement) {
    remoteAudioElement = document.getElementById("remoteAudio");
    if (!remoteAudioElement) {
      remoteAudioElement = document.createElement("audio");
      remoteAudioElement.id = "remoteAudio";
      remoteAudioElement.autoplay = true;
      document.body.appendChild(remoteAudioElement);
    }
  }
}

// User interaction unlocks audio autoplay
document.addEventListener("click", () => {
  if (remoteAudioElement && remoteAudioElement.paused && remoteAudioElement.srcObject) {
    remoteAudioElement.play().catch(e => console.log("Audio unlock:", e));
  }
}, { once: true });

function handleWebRTCTracks(peerConn) {
  setupRemoteAudio();
  peerConn.ontrack = (event) => {
    console.log("Remote voice track received:", event.streams);
    if (event.streams && event.streams[0]) {
      remoteAudioElement.srcObject = event.streams[0];
      remoteAudioElement.play().catch(err => {
        console.warn("Autoplay prevented, will play on next click:", err);
      });
    }
  };
}

// --- 2. MANDATORY LOGIN & SKILL LEVEL / RATING SYSTEM ---
let currentUserId = null;
let currentUserName = "Player";
let currentUserRating = 800;

function initAuthAndRatingListener() {
  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      // Prompt Google Login immediately
      triggerGoogleLogin();
    } else {
      currentUserId = user.uid;
      currentUserName = user.displayName || "Player";
      
      const userRef = database.ref("users/" + user.uid);
      const snapshot = await userRef.once("value");
      const data = snapshot.val();

      if (!data || !data.rating) {
        // Show skill level selection modal
        const modal = document.getElementById("skillModal");
        if (modal) modal.style.display = "flex";
      } else {
        currentUserRating = data.rating;
        updateUserRatingDisplay();
      }
    }
  });
}

function triggerGoogleLogin() {
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider).catch((error) => {
    console.error("Login Error:", error);
  });
}

function selectSkillLevel(level) {
  let initialRating = 800;
  if (level === "intermediate") initialRating = 1200;
  if (level === "advanced") initialRating = 1600;

  if (currentUserId) {
    database.ref("users/" + currentUserId).set({
      name: currentUserName,
      rating: initialRating,
      skillLevel: level
    }).then(() => {
      currentUserRating = initialRating;
      const modal = document.getElementById("skillModal");
      if (modal) modal.style.display = "none";
      updateUserRatingDisplay();
    });
  }
}

function updateUserRatingDisplay() {
  const ratingEl = document.getElementById("userRatingDisplay");
  if (ratingEl) {
    ratingEl.innerText = `Rating: ${currentUserRating}`;
  }
}

// Fixed Rating change (+8 / -8)
function applyMatchResultRating(winnerUid, loserUid) {
  if (winnerUid) {
    database.ref("users/" + winnerUid + "/rating").transaction(r => (r || 800) + 8);
  }
  if (loserUid) {
    database.ref("users/" + loserUid + "/rating").transaction(r => Math.max(100, (r || 800) - 8));
  }
}

// --- 3. RESIGN & DRAW SYSTEM ---
function resignCurrentGame() {
  if (!currentRoomCode) return alert("ரூமில் இணையவில்லை!");
  if (!confirm("நிச்சயமாக Resign செய்ய விரும்புகிறீர்களா? (-8 Rating)")) return;

  const opponentId = getOpponentUid();
  database.ref("rooms/" + currentRoomCode).update({
    gameOver: true,
    result: "resigned",
    winner: opponentId,
    loser: currentUserId
  });
  applyMatchResultRating(opponentId, currentUserId);
}

function offerDrawGame() {
  if (!currentRoomCode) return alert("ரூமில் இணையவில்லை!");
  database.ref("rooms/" + currentRoomCode + "/drawOffer").set(currentUserId);
  alert("டிரா (Draw) கோரிக்கை எதிரணிக்கு அனுப்பப்பட்டது.");
}

function listenForRoomEvents(roomId) {
  const roomRef = database.ref("rooms/" + roomId);

  // Listen for Draw Offers
  roomRef.child("drawOffer").on("value", (snap) => {
    const offerBy = snap.val();
    if (offerBy && offerBy !== currentUserId) {
      const accepted = confirm("எதிரணி சமன் (Draw) செய்யக் கோருகிறார். ஏற்கிறீர்களா?");
      if (accepted) {
        roomRef.update({
          gameOver: true,
          result: "draw",
          drawOffer: null
        });
      } else {
        roomRef.child("drawOffer").remove();
      }
    }
  });

  // Listen for Game Over
  roomRef.child("gameOver").on("value", (snap) => {
    if (snap.val() === true) {
      roomRef.once("value", (s) => {
        const val = s.val();
        if (val.result === "resigned") {
          alert(val.winner === currentUserId ? "எதிரணி சரணடைந்தார்! நீங்கள் வெற்றி பெற்றீர்கள் (+8)!" : "நீங்கள் சரணடைந்தீர்கள் (-8).");
        } else if (val.result === "draw") {
          alert("ஆட்டம் சமனில் முடிவடைந்தது (Draw).");
        }
      });
    }
  });

  // Listen for Chat messages
  listenForChat(roomId);
}

// --- 4. LIVE IN-GAME CHAT ---
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
  const chatMessages = document.getElementById("chatMessages");
  if (!chatMessages) return;
  chatMessages.innerHTML = "";

  database.ref("rooms/" + roomId + "/chat").limitToLast(50).on("child_added", (snap) => {
    const msg = snap.val();
    const isMe = msg.senderId === currentUserId;
    const msgDiv = document.createElement("div");
    msgDiv.style.padding = "4px 8px";
    msgDiv.style.borderRadius = "4px";
    msgDiv.style.background = isMe ? "#1e3a8a" : "#334155";
    msgDiv.style.alignSelf = isMe ? "flex-end" : "flex-start";
    msgDiv.style.maxWidth = "80%";
    msgDiv.innerHTML = `<span style="font-size:0.75rem; color:#94a3b8; display:block;">${msg.sender}</span>${escapeHtml(msg.text)}`;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  });
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.innerText = text;
  return div.innerHTML;
}
