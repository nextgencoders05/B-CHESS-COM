// ==========================================
// 1. FIREBASE CONFIGURATION (EXACT MATCH)
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyDy0aKMuTzmPjg9Z8ebyFWtmT4mc9bRHG0",
  authDomain: "b--chess-analyser.firebaseapp.com",
  databaseURL: "https://b--chess-analyser-default-rtdb.firebaseio.com",
  projectId: "b--chess-analyser",
  storageBucket: "b--chess-analyser.firebasestorage.app",
  messagingSenderId: "492429152963",
  appId: "1:492429152963:web:21592594d7f4a145340876",
  measurementId: "G-Y0EFN2WYE8"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const database = firebase.database();

// Global User & Multiplayer State
let currentUserId = null;
let currentUserName = "Player";
let currentUserPhoto = "";
let currentUserRating = 800;
let currentRoomCode = null;
let myOnlineColor = 'w';
let isOnlineMatchActive = false;

// WebRTC Live Voice Chat State
let peerConnection = null;
let audioTransceiver = null;
let localVoiceStream = null;
let isMicMuted = true;
const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    // TURN relay fallback so voice works across different networks / mobile data
    { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" }
  ]
};

// --- MODE LOCKING (Blocks switching to Analysis / Bot during live match) ---
function lockModeButtons(lock) {
  isOnlineMatchActive = lock;
  const analyzeBtn = document.getElementById('modeAnalyzeBtn');
  const botBtn = document.getElementById('modeBotBtn');

  if (lock) {
    if (analyzeBtn) {
      analyzeBtn.disabled = true;
      analyzeBtn.style.opacity = "0.4";
      analyzeBtn.style.cursor = "not-allowed";
      analyzeBtn.title = "மேட்ச் முடியும் வரை அனலைஸ் செல்ல முடியாது";
    }
    if (botBtn) {
      botBtn.disabled = true;
      botBtn.style.opacity = "0.4";
      botBtn.style.cursor = "not-allowed";
      botBtn.title = "மேட்ச் முடியும் வரை பாட் மோடு செல்ல முடியாது";
    }
  } else {
    if (analyzeBtn) {
      analyzeBtn.disabled = false;
      analyzeBtn.style.opacity = "1";
      analyzeBtn.style.cursor = "pointer";
      analyzeBtn.title = "";
    }
    if (botBtn) {
      botBtn.disabled = false;
      botBtn.style.opacity = "1";
      botBtn.style.cursor = "pointer";
      botBtn.title = "";
    }
  }
}

// --- GOOGLE SIGN-IN (Popup Blocker Fix & Redirect Fallback) ---
function triggerGoogleLogin() {
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider).catch((error) => {
    console.warn("Popup blocked or closed:", error.message);
    if (error.code === 'auth/popup-blocked') {
      auth.signInWithRedirect(provider);
    } else if (error.code !== 'auth/popup-closed-by-user') {
      alert("Sign-in issue: " + error.message);
    }
  });
}

auth.getRedirectResult().catch(err => console.log(err));

auth.onAuthStateChanged(async (user) => {
  if (user) {
    currentUserId = user.uid;
    const loginBtn = document.getElementById("googleLoginBtn");
    const userProfile = document.getElementById("userProfile");
    if (loginBtn) loginBtn.style.display = "none";
    if (userProfile) userProfile.style.display = "inline-flex";

    const snap = await database.ref("users/" + user.uid).once("value");
    const data = snap.val() || {};
    currentUserName = data.username || data.name || user.displayName || "Player";
    currentUserPhoto = data.photoData || user.photoURL || "";
    updateProfileUI();

    if (!data.username) openProfileModal(true);

    if (!data.rating) {
      const modal = document.getElementById("skillModal");
      if (modal && data.username) modal.style.display = "flex";
    } else {
      currentUserRating = data.rating;
      const ratingDisplay = document.getElementById("userRatingDisplay");
      if (ratingDisplay) ratingDisplay.textContent = currentUserRating;
    }
  } else {
    currentUserId = null;
    currentUserName = "Player";
    currentUserPhoto = "";
    const loginBtn = document.getElementById("googleLoginBtn");
    const userProfile = document.getElementById("userProfile");
    if (loginBtn) loginBtn.style.display = "inline-flex";
    if (userProfile) userProfile.style.display = "none";
  }
});

function updateProfileUI() {
  const nameDisplay = document.getElementById("userNameDisplay");
  const avatar = document.getElementById("userAvatarImg");
  const fallback = document.getElementById("userAvatarFallback");
  if (nameDisplay) nameDisplay.textContent = currentUserName;
  if (currentUserPhoto) {
    if (avatar) { avatar.src = currentUserPhoto; avatar.style.display = "block"; }
    if (fallback) fallback.style.display = "none";
  } else {
    if (avatar) avatar.style.display = "none";
    if (fallback) {
      fallback.textContent = (currentUserName || "P").charAt(0).toUpperCase();
      fallback.style.display = "inline-flex";
    }
  }
}

function openProfileModal(firstSetup = false) {
  const modal = document.getElementById("profileModal");
  const usernameInput = document.getElementById("profileUsernameInput");
  const photoInput = document.getElementById("profilePhotoInput");
  const preview = document.getElementById("profilePreviewImg");
  const fallback = document.getElementById("profilePreviewFallback");
  const cancelBtn = document.getElementById("cancelProfileBtn");
  const status = document.getElementById("profileSaveStatus");
  if (!modal) return;

  if (usernameInput) usernameInput.value = currentUserName === "Player" ? "" : currentUserName;
  if (photoInput) photoInput.value = "";
  if (status) status.textContent = "";

  if (currentUserPhoto) {
    if (preview) { preview.src = currentUserPhoto; preview.style.display = "block"; }
    if (fallback) fallback.style.display = "none";
  } else {
    if (preview) preview.style.display = "none";
    if (fallback) {
      fallback.textContent = (currentUserName || "P").charAt(0).toUpperCase();
      fallback.style.display = "inline-flex";
    }
  }
  if (cancelBtn) cancelBtn.style.display = firstSetup ? "none" : "inline-block";
  modal.dataset.firstSetup = firstSetup ? "true" : "false";
  modal.style.display = "flex";
}

function closeProfileModal() {
  const modal = document.getElementById("profileModal");
  if (modal) modal.style.display = "none";
}

function readAndResizeProfilePhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const size = 256, canvas = document.createElement("canvas");
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext("2d");
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = reject; img.src = reader.result;
    };
    reader.onerror = reject; reader.readAsDataURL(file);
  });
}

async function saveUserProfile() {
  if (!currentUserId) return;
  const usernameInput = document.getElementById("profileUsernameInput");
  const photoInput = document.getElementById("profilePhotoInput");
  const status = document.getElementById("profileSaveStatus");
  const saveBtn = document.getElementById("saveProfileBtn");
  const username = (usernameInput?.value || "").trim().replace(/\s+/g, " ");

  if (!username) { if (status) status.textContent = "Please enter a username."; return; }
  if (username.length < 2) { if (status) status.textContent = "Username must be at least 2 characters."; return; }

  try {
    if (saveBtn) saveBtn.disabled = true;
    if (status) status.textContent = "Saving...";
    let photoData = currentUserPhoto;
    if (photoInput?.files?.[0]) photoData = await readAndResizeProfilePhoto(photoInput.files[0]);

    await database.ref("users/" + currentUserId).update({
      username, name: username, photoData: photoData || ""
    });
    currentUserName = username;
    currentUserPhoto = photoData || "";
    updateProfileUI();
    closeProfileModal();

    const modal = document.getElementById("skillModal");
    const snap = await database.ref("users/" + currentUserId).once("value");
    const data = snap.val() || {};
    if (modal && !data.rating) modal.style.display = "flex";
  } catch (err) {
    console.error("Profile save error:", err);
    if (status) status.textContent = "Could not save profile: " + err.message;
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

function handleLogout() {
  auth.signOut().then(() => window.location.reload());
}

function selectSkillLevel(level) {
  let initial = 800;
  if (level === 'intermediate') initial = 1200;
  if (level === 'advanced') initial = 1600;

  if (currentUserId) {
    database.ref("users/" + currentUserId).update({
      username: currentUserName,
      name: currentUserName,
      photoData: currentUserPhoto || "",
      rating: initial,
      skillLevel: level
    }).then(() => {
      currentUserRating = initial;
      const ratingDisplay = document.getElementById("userRatingDisplay");
      if (ratingDisplay) ratingDisplay.textContent = initial;
      const modal = document.getElementById("skillModal");
      if (modal) modal.style.display = "none";
    });
  }
}

// --- MULTIPLAYER ROOM & GAME LOGIC ---
function createFriendRoom() {
  if (!currentUserId) {
    alert("Please Sign in with Google first!");
    return triggerGoogleLogin();
  }
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  currentRoomCode = code;
  myOnlineColor = 'w';
  board.orientation('white');
  game.reset();
  board.start();
  lockModeButtons(true);

  database.ref("rooms/" + code).set({
    creatorId: currentUserId,
    creatorName: currentUserName,
    creatorRating: currentUserRating,
    guestId: null,
    guestName: null,
    gameFen: 'start',
    status: 'waiting'
  }).then(() => {
    document.getElementById("activeRoomInfo").style.display = "flex";
    document.getElementById("activeRoomCode").textContent = code;
    listenToRoom(code, true);
    startVoiceChat(code, true);
  });
}

function joinFriendRoom() {
  if (!currentUserId) {
    alert("Please Sign in with Google first!");
    return triggerGoogleLogin();
  }
  const code = document.getElementById("roomCodeInput").value.trim().toUpperCase();
  if (!code) return alert("Enter Room Code");

  const roomRef = database.ref("rooms/" + code);
  roomRef.once("value", (snap) => {
    const val = snap.val();
    if (!val) return alert("Invalid room code!");

    currentRoomCode = code;
    myOnlineColor = 'b';
    board.orientation('black');
    lockModeButtons(true);

    roomRef.update({
      guestId: currentUserId,
      guestName: currentUserName,
      guestRating: currentUserRating,
      status: 'playing'
    }).then(() => {
      document.getElementById("activeRoomInfo").style.display = "flex";
      document.getElementById("activeRoomCode").textContent = code;
      listenToRoom(code, false);
      startVoiceChat(code, false);
    });
  });
}

function copyRoomCode() {
  if (currentRoomCode) {
    navigator.clipboard.writeText(currentRoomCode);
    alert("Room Code copied: " + currentRoomCode);
  }
}

function listenToRoom(code, isCreator) {
  const roomRef = database.ref("rooms/" + code);
  roomRef.on("value", (snap) => {
    const val = snap.val();
    if (!val) return;

    if (val.guestName) {
      const oppLabel = isCreator ? val.guestName : val.creatorName;
      const chatOpp = document.getElementById("chatOpponentName");
      if (chatOpp) chatOpp.textContent = oppLabel + " (" + (isCreator ? val.guestRating : val.creatorRating) + ")";
    }

    if (val.gameFen && val.gameFen !== game.fen()) {
      if (val.gameFen === 'start') game.reset();
      else game.load(val.gameFen);
      board.position(game.fen());
      playSound('move');
      updateUI();
    }

    if (val.drawOffer && val.drawOffer !== currentUserId) {
      if (confirm("Opponent offered a draw. Accept?")) {
        roomRef.update({ gameOver: true, result: 'draw', drawOffer: null });
        lockModeButtons(false);
      } else {
        roomRef.child("drawOffer").remove();
      }
    }

    if (val.gameOver) {
      lockModeButtons(false);
      if (val.result === 'resigned') {
        const iWon = val.winner === currentUserId;
        alert(iWon ? "Opponent resigned! You won (+8 Rating)!" : "You resigned (-8 Rating).");
      } else if (val.result === 'draw') {
        alert("The game ended in a draw.");
      } else if (val.result === 'checkmate') {
        const iWon = val.winner === currentUserId;
        alert(iWon ? "Checkmate! You won (+8 Rating)!" : "Checkmate! Opponent won (-8 Rating).");
      }
    }
  });

  listenForChat(code);
}

function checkOnlineTrigger(move) {
  if (currentMode === 'friend' && currentRoomCode) {
    database.ref("rooms/" + currentRoomCode).update({
      gameFen: game.fen(),
      lastMove: { from: move.from, to: move.to }
    });

    if (game.in_checkmate()) {
      const roomRef = database.ref("rooms/" + currentRoomCode);
      roomRef.once("value", (snap) => {
        const val = snap.val();
        const opponentId = (val.creatorId === currentUserId) ? val.guestId : val.creatorId;
        roomRef.update({ gameOver: true, result: 'checkmate', winner: currentUserId });
        lockModeButtons(false);
        if (opponentId) {
          database.ref("users/" + currentUserId + "/rating").transaction(r => (r || 800) + 8);
          database.ref("users/" + opponentId + "/rating").transaction(r => Math.max(100, (r || 800) - 8));
        }
      });
    }
  }
}

function resignGame() {
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
    lockModeButtons(false);
    if (opponentId) database.ref("users/" + opponentId + "/rating").transaction(r => (r || 800) + 8);
    database.ref("users/" + currentUserId + "/rating").transaction(r => Math.max(100, (r || 800) - 8));
  });
}

function offerDrawGame() {
  if (!currentRoomCode) return alert("Not in an active match!");
  database.ref("rooms/" + currentRoomCode + "/drawOffer").set(currentUserId);
  alert("Draw offer sent to opponent.");
}

// --- LIVE CHAT ---
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

function listenForChat(code) {
  const box = document.getElementById("chatMessages");
  if (!box) return;
  box.innerHTML = "";

  database.ref("rooms/" + code + "/chat").limitToLast(40).on("child_added", (snap) => {
    const msg = snap.val();
    const isMe = msg.senderId === currentUserId;
    const bubble = document.createElement("div");
    bubble.className = `chat-bubble ${isMe ? 'mine' : 'theirs'}`;
    bubble.innerHTML = `<span class="chat-bubble-author">${escapeHtml(msg.sender)}</span><span class="chat-bubble-text">${escapeHtml(msg.text)}</span>`;
    box.appendChild(bubble);
    box.scrollTop = box.scrollHeight;
  });
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.innerText = str;
  return d.innerHTML;
}

// --- WEBRTC LIVE VOICE CHAT ---
// Voice uses one initial WebRTC negotiation plus explicit renegotiation when
// a microphone track is added after the room connection has already started.
// This is important for two-way audio: the room creator is the WebRTC offerer,
// so a microphone added later by the guest must trigger a fresh offer from the
// creator instead of only calling replaceTrack() on the guest.
let pendingRemoteCandidates = [];
let remoteDescriptionReady = false;
let isSpeakerMuted = false;
let remoteVoiceStream = null;
let voiceRoomRef = null;
let voiceIsCaller = false;
let renegotiationBusy = false;
let renegotiationQueue = false;

async function addRemoteIceCandidate(candidate, pc = peerConnection) {
  if (!pc || !candidate) return;
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.warn("ICE candidate error:", err);
  }
}

async function flushRemoteIceCandidates() {
  const queued = pendingRemoteCandidates.splice(0);
  for (const candidate of queued) await addRemoteIceCandidate(candidate);
}

async function setRemoteDescriptionSafe(description) {
  if (!peerConnection || !description) return;
  await peerConnection.setRemoteDescription(new RTCSessionDescription(description));
  remoteDescriptionReady = true;
  await flushRemoteIceCandidates();
}

function setSpeakerState(muted) {
  isSpeakerMuted = muted;
  const audio = document.getElementById("remoteAudio");
  const btn = document.getElementById("toggleSpeakerBtn");
  if (audio) {
    audio.muted = muted;
    audio.volume = muted ? 0 : 1;
    if (!muted) audio.play().catch(() => {});
  }
  if (btn) {
    btn.textContent = muted ? "🔇 Speaker OFF" : "🔊 Speaker ON";
    btn.classList.toggle("active-mic", !muted);
  }
}

async function addRenegotiationCandidates(negRef, pc) {
  negRef.child(voiceIsCaller ? "calleeCandidates" : "callerCandidates")
    .on("child_added", snap => {
      const c = snap.val();
      if (c) addRemoteIceCandidate(c, pc);
    });
}

async function createCallerRenegotiation() {
  if (!peerConnection || !voiceRoomRef || !voiceIsCaller) return;
  if (peerConnection.signalingState !== "stable") {
    renegotiationQueue = true;
    return;
  }
  if (renegotiationBusy) {
    renegotiationQueue = true;
    return;
  }

  renegotiationBusy = true;
  const negRef = voiceRoomRef.child("renegotiations").push();
  const negId = negRef.key;

  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    // ICE candidates can be generated immediately after setLocalDescription.
    // Store them under this exact negotiation so they cannot be mixed with
    // candidates from the original offer.
    peerConnection.__activeNegotiationRef = negRef;

    await negRef.child("offer").set({
      sdp: offer.sdp,
      type: offer.type
    });

    negRef.child("answer").on("value", async snap => {
      const answer = snap.val();
      if (!answer || peerConnection.signalingState !== "have-local-offer") return;
      try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        remoteDescriptionReady = true;
        await flushRemoteIceCandidates();
        console.log("Voice renegotiation completed:", negId);
      } catch (err) {
        console.warn("Voice renegotiation answer error:", err);
      } finally {
        renegotiationBusy = false;
        if (renegotiationQueue) {
          renegotiationQueue = false;
          setTimeout(() => createCallerRenegotiation(), 0);
        }
      }
    });

    await addRenegotiationCandidates(negRef, peerConnection);
  } catch (err) {
    renegotiationBusy = false;
    console.warn("Voice renegotiation error:", err);
  }
}

function requestVoiceRenegotiation() {
  if (!voiceRoomRef || voiceIsCaller) {
    if (voiceIsCaller) createCallerRenegotiation();
    return;
  }
  const requestRef = voiceRoomRef.child("renegotiationRequests").push();
  requestRef.set({
    requestedAt: firebase.database.ServerValue.TIMESTAMP
  });
}

// Acquire the microphone for BOTH players as soon as the room connects, so the
// mic track is already inside the first offer/answer (no late renegotiation).
// The track starts disabled (muted); the Mic button only enables/disables it.
let micReadyPromise = Promise.resolve();
async function acquireLocalMic() {
  if (localVoiceStream) return localVoiceStream;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return null;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      video: false
    });
    stream.getAudioTracks().forEach(t => t.enabled = !isMicMuted);
    localVoiceStream = stream;
    return stream;
  } catch (err) {
    console.warn("Microphone not available at room start:", err);
    return null;
  }
}

async function attachLocalMicToPeer() {
  if (!peerConnection || !localVoiceStream) return;
  const track = localVoiceStream.getAudioTracks()[0];
  if (!track) return;
  let t = audioTransceiver;
  if (!t) t = peerConnection.getTransceivers().find(x => x.receiver && x.receiver.track && x.receiver.track.kind === "audio");
  if (t) {
    audioTransceiver = t;
    t.direction = "sendrecv";
    await t.sender.replaceTrack(track);
  } else {
    audioTransceiver = peerConnection.addTransceiver(track, { direction: "sendrecv" });
  }
}

async function startVoiceChat(roomId, isCaller) {
  try {
    pendingRemoteCandidates = [];
    remoteDescriptionReady = false;
    remoteVoiceStream = null;
    voiceIsCaller = !!isCaller;
    voiceRoomRef = database.ref("rooms/" + roomId + "/voice");
    peerConnection = new RTCPeerConnection(rtcConfig);
    renegotiationBusy = false;
    renegotiationQueue = false;

    // Keep a stable audio m-line from the beginning. The actual microphone
    // track can be attached later, followed by explicit renegotiation.
    audioTransceiver = null;
    if (isCaller) {
      audioTransceiver = peerConnection.addTransceiver("audio", { direction: "sendrecv" });
    }
    micReadyPromise = acquireLocalMic();

    peerConnection.onconnectionstatechange = () => {
      console.log("Voice connection state:", peerConnection.connectionState);
      if (peerConnection.connectionState === "connected") {
        const audio = document.getElementById("remoteAudio");
        if (audio && !isSpeakerMuted) audio.play().catch(() => {});
      }
    };

    peerConnection.ontrack = (event) => {
      const audio = document.getElementById("remoteAudio");
      if (!audio) return;

      if (event.streams && event.streams[0]) {
        remoteVoiceStream = event.streams[0];
      } else {
        if (!remoteVoiceStream) remoteVoiceStream = new MediaStream();
        const alreadyAdded = remoteVoiceStream.getTracks().some(t => t.id === event.track.id);
        if (!alreadyAdded) remoteVoiceStream.addTrack(event.track);
      }

      event.track.enabled = true;
      audio.autoplay = true;
      audio.playsInline = true;
      audio.srcObject = remoteVoiceStream;
      audio.muted = isSpeakerMuted;
      audio.volume = isSpeakerMuted ? 0 : 1;
      audio.play().then(() => {
        console.log("Remote voice playback started", {
          trackId: event.track.id,
          readyState: event.track.readyState
        });
      }).catch(e => {
        console.log("Remote voice playback needs speaker interaction:", e);
      });
    };

    peerConnection.onicecandidate = (e) => {
      if (!e.candidate) return;
      const activeRef = peerConnection.__activeNegotiationRef;
      if (activeRef) {
        const path = voiceIsCaller ? "callerCandidates" : "calleeCandidates";
        activeRef.child(path).push(e.candidate.toJSON());
      } else {
        const path = voiceIsCaller ? "callerCandidates" : "calleeCandidates";
        voiceRoomRef.child(path).push(e.candidate.toJSON());
      }
    };

    if (isCaller) {
      // Initial negotiation (mic track included in the offer).
      await micReadyPromise;
      await attachLocalMicToPeer();
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      await voiceRoomRef.child("offer").set({ sdp: offer.sdp, type: offer.type });

      voiceRoomRef.child("answer").on("value", async snap => {
        const ans = snap.val();
        if (ans && !peerConnection.currentRemoteDescription) {
          await setRemoteDescriptionSafe(ans);
        }
      });

      voiceRoomRef.child("calleeCandidates").on("child_added", snap => {
        const c = snap.val();
        if (c) {
          if (!remoteDescriptionReady) pendingRemoteCandidates.push(c);
          else addRemoteIceCandidate(c);
        }
      });

      // The guest cannot create an offer itself in this simple two-peer setup.
      // If the guest turns its mic on later, it asks the caller to renegotiate.
      voiceRoomRef.child("renegotiationRequests").on("child_added", snap => {
        if (snap.val()) createCallerRenegotiation();
      });

      // The caller is also allowed to renegotiate when its own microphone is
      // enabled, so both directions use the same SDP path.
    } else {
      voiceRoomRef.child("offer").on("value", async snap => {
        const off = snap.val();
        if (off && !peerConnection.currentRemoteDescription) {
          await setRemoteDescriptionSafe(off);
          await micReadyPromise;
          await attachLocalMicToPeer();
          const ans = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(ans);
          await voiceRoomRef.child("answer").set({ sdp: ans.sdp, type: ans.type });
        }
      });

      voiceRoomRef.child("callerCandidates").on("child_added", snap => {
        const c = snap.val();
        if (c) {
          if (!remoteDescriptionReady) pendingRemoteCandidates.push(c);
          else addRemoteIceCandidate(c);
        }
      });

      // Handle every new caller-created renegotiation offer.
      voiceRoomRef.child("renegotiations").on("child_added", async snap => {
        const negRef = snap.ref;
        const neg = snap.val();
        if (!neg || !neg.offer) return;

        try {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(neg.offer));
          await attachLocalMicToPeer();
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          await negRef.child("answer").set({ sdp: answer.sdp, type: answer.type });

          negRef.child("callerCandidates").on("child_added", candidateSnap => {
            const c = candidateSnap.val();
            if (c) addRemoteIceCandidate(c);
          });

          console.log("Voice renegotiation answer sent:", snap.key);
        } catch (err) {
          console.warn("Voice renegotiation offer error:", err);
        }
      });
    }
  } catch (err) {
    console.warn("WebRTC voice init error:", err);
  }
}

async function toggleMicrophone() {
  if (!currentRoomCode) {
    alert("Please create or join a room first.");
    return;
  }

  const micBtn = document.getElementById("toggleMicBtn");
  const dot = document.getElementById("voiceStatusDot");
  const txt = document.getElementById("voiceStatusText");

  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Microphone is not available. Use HTTPS or localhost and allow browser microphone permission.");
    }

    let newTrackWasAdded = false;

    if (!localVoiceStream) {
      // Mic was not granted at room start (or permission was denied) - ask again now.
      const stream = await acquireLocalMic();
      if (!stream) throw new Error("Microphone permission denied. Allow the microphone in the browser address bar and try again.");
      await attachLocalMicToPeer();
      newTrackWasAdded = true;
    }

    isMicMuted = !isMicMuted;
    localVoiceStream.getAudioTracks().forEach(t => t.enabled = !isMicMuted);

    // If the track was added after the initial SDP exchange, explicitly
    // renegotiate. This is the key fix for guest -> creator audio.
    if (newTrackWasAdded && peerConnection) {
      if (voiceIsCaller) {
        await createCallerRenegotiation();
      } else {
        requestVoiceRenegotiation();
      }
    }

    const audio = document.getElementById("remoteAudio");
    if (audio) {
      audio.muted = isSpeakerMuted;
      audio.volume = isSpeakerMuted ? 0 : 1;
      audio.play().catch(() => {});
    }

    if (!isMicMuted) {
      if (micBtn) { micBtn.textContent = "🔴 Mute"; micBtn.classList.add("active-mic"); }
      if (dot) dot.className = "voice-dot on";
      if (txt) { txt.textContent = "Live Voice: ON"; txt.style.color = "#34d399"; }
    } else {
      if (micBtn) { micBtn.textContent = "🎙️ Turn Mic ON"; micBtn.classList.remove("active-mic"); }
      if (dot) dot.className = "voice-dot off";
      if (txt) { txt.textContent = "Live Voice: OFF"; txt.style.color = "#94a3b8"; }
    }
  } catch (err) {
    console.error("Microphone error:", err);
    alert("Microphone access failed: " + err.message);
  }
}

async function toggleSpeaker() {
  const audio = document.getElementById("remoteAudio");
  if (!audio) return;

  const nextMuted = !isSpeakerMuted;
  setSpeakerState(nextMuted);

  if (!nextMuted) {
    try {
      audio.muted = false;
      audio.volume = 1;
      if (remoteVoiceStream && audio.srcObject !== remoteVoiceStream) {
        audio.srcObject = remoteVoiceStream;
      }
      await audio.play();
    } catch (err) {
      console.log("Speaker playback waiting:", err);
    }
  }
}


// B Chess Analyzer — Stockfish Engine + Audio FX + Real-time Blunder Engine + Captured Pieces + Copy Report

let board = null;
const game = new Chess();
let redoStack = [];
let stockfish = null;
let engineReady = false;
let currentBestMoveUci = null;
let showBestMoveArrow = true;
let targetDepth = 15;
let soundEnabled = true;

// Click-to-Move / Tap state
let selectedSquare = null;
let dragActive = false;
let lastDropTime = 0;

// Game Mode State: 'analysis' or 'bot'
let currentMode = 'analysis';
let playerColor = 'w';
let botRating = 1400;
let isBotThinking = false;

// Audio Synthesizer (Realistic Wooden Acoustic Multi-layered Audio)
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      audioCtx = new AudioContext();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playSound(type) {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    if (type === 'move') {
      // Realistic wooden board tap: dual resonant body + contact click
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      const gain2 = ctx.createGain();

      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(320, now);
      osc1.frequency.exponentialRampToValueAtTime(65, now + 0.07);

      gain1.gain.setValueAtTime(0.75, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(140, now);
      osc2.frequency.exponentialRampToValueAtTime(45, now + 0.09);

      gain2.gain.setValueAtTime(0.5, now);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

      osc1.connect(gain1);
      osc2.connect(gain2);
      gain1.connect(ctx.destination);
      gain2.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.075);
      osc2.stop(now + 0.095);

    } else if (type === 'capture') {
      // Sharp wooden piece clash with impact crack
      const osc = ctx.createOscillator();
      const noise = ctx.createBufferSource();
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.06, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < buffer.length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.015));
      }
      noise.buffer = buffer;

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.65, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.06);

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(480, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.1);

      const oscGain = ctx.createGain();
      oscGain.gain.setValueAtTime(0.6, now);
      oscGain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);

      noise.connect(noiseGain);
      osc.connect(oscGain);
      noiseGain.connect(ctx.destination);
      oscGain.connect(ctx.destination);

      noise.start(now);
      osc.start(now);
      osc.stop(now + 0.1);

    } else if (type === 'check') {
      // Clear alert chime (Bell-like tension tone)
      [659.25, 880].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.07);

        gain.gain.setValueAtTime(0.45, now + idx * 0.07);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.22);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.07);
        osc.stop(now + idx * 0.07 + 0.23);
      });

    } else if (type === 'checkmate') {
      // Triumphant orchestral brass-like victory chord
      const freqs = [392.00, 493.88, 587.33, 783.99, 987.77];
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.1);

        gain.gain.setValueAtTime(0.5, now + idx * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.8);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.1);
        osc.stop(now + idx * 0.1 + 0.85);
      });
    }
  } catch (e) {
    console.warn('Audio playback error:', e);
  }
}

// Move Quality & Real-Time Blunder Analysis Engine
// Each move stores { san, color, evalBefore, evalAfter, quality, loss }
let moveQualityHistory = [];
let pendingEvalMoveIndex = null;
let currentPositionCp = 0; // Perspective: White (e.g. +120 = +1.20 pawns for White)

// Bot profiles
const BOT_PROFILES = {
  800:  { skill: 0,  depth: 1,  moveTime: 300, blunderRate: 0.35 },
  1100: { skill: 3,  depth: 2,  moveTime: 400, blunderRate: 0.18 },
  1400: { skill: 6,  depth: 4,  moveTime: 500, blunderRate: 0.06 },
  1700: { skill: 10, depth: 7,  moveTime: 650, blunderRate: 0.01 },
  2000: { skill: 15, depth: 10, moveTime: 800, blunderRate: 0.00 },
  2500: { skill: 20, depth: 14, moveTime: 1000, blunderRate: 0.00 }
};

// Rich Opening & Gambit Dictionary
const OPENINGS_LIST = [
  { moves: ["e4", "e5", "f4"], name: "King's Gambit" },
  { moves: ["e4", "e5", "f4", "exf4"], name: "King's Gambit Accepted" },
  { moves: ["e4", "e5", "f4", "d5"], name: "Falkbeer Counter-Gambit" },
  { moves: ["d4", "d5", "c4"], name: "Queen's Gambit" },
  { moves: ["d4", "d5", "c4", "dxc4"], name: "Queen's Gambit Accepted (QGA)" },
  { moves: ["d4", "d5", "c4", "c6"], name: "Slav Defense" },
  { moves: ["d4", "d5", "c4", "e6"], name: "Queen's Gambit Declined (QGD)" },
  { moves: ["e4", "e5", "Nf3", "Nc6", "d4", "exd4", "Bc4"], name: "Scotch Gambit" },
  { moves: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "b4"], name: "Evans Gambit" },
  { moves: ["e4", "e5", "d4", "exd4", "c3"], name: "Danish Gambit" },
  { moves: ["e4", "e5", "Nf3", "d5"], name: "Elephant Gambit" },
  { moves: ["e4", "e5", "Nf3", "f5"], name: "Latvian Gambit" },
  { moves: ["d4", "Nf6", "c4", "e5"], name: "Budapest Gambit" },
  { moves: ["d4", "f5", "e4"], name: "Staunton Gambit" },
  { moves: ["d4", "c5", "d5", "b5"], name: "Benko Gambit" },
  { moves: ["e4", "c5", "b4"], name: "Sicilian Wing Gambit" },
  { moves: ["e4", "c5", "d4", "cxd4", "c3"], name: "Smith-Morra Gambit" },
  { moves: ["d4", "d5", "e4"], name: "Blackmar-Diemer Gambit" },
  { moves: ["e4", "e6", "d4", "d5", "c4"], name: "Diemer-Duhm Gambit" },
  { moves: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "Ng5", "d5", "exd5", "Na5"], name: "Two Knights Defense" },
  { moves: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "d4"], name: "Two Knights: Modern Bishop's Opening" },
  { moves: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"], name: "Giuoco Piano (Italian Game)" },
  { moves: ["e4", "e5", "Nf3", "Nc6", "Bc4"], name: "Italian Game" },
  { moves: ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"], name: "Ruy Lopez: Morphy Defense" },
  { moves: ["e4", "e5", "Nf3", "Nc6", "Bb5"], name: "Ruy Lopez (Spanish Opening)" },
  { moves: ["e4", "e5", "Nf3", "Nc6", "d4"], name: "Scotch Game" },
  { moves: ["e4", "e5", "Nf3", "Nf6"], name: "Petrov's Defense (Russian Game)" },
  { moves: ["e4", "e5", "Nf3", "d6"], name: "Philidor Defense" },
  { moves: ["e4", "e5", "Nc3"], name: "Vienna Game" },
  { moves: ["e4", "e5", "Bc4"], name: "Bishop's Opening" },
  { moves: ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6"], name: "Sicilian Defense: Najdorf Variation" },
  { moves: ["e4", "c5", "Nf3", "Nc6", "d4", "cxd4", "Nxd4", "g6"], name: "Sicilian Defense: Accelerated Dragon" },
  { moves: ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "g6"], name: "Sicilian Defense: Dragon Variation" },
  { moves: ["e4", "c5", "c3"], name: "Sicilian Defense: Alapin Variation" },
  { moves: ["e4", "c5", "Nc3"], name: "Closed Sicilian" },
  { moves: ["e4", "c5"], name: "Sicilian Defense" },
  { moves: ["e4", "e6", "d4", "d5"], name: "French Defense" },
  { moves: ["e4", "e6"], name: "French Defense" },
  { moves: ["e4", "c6", "d4", "d5"], name: "Caro-Kann Defense" },
  { moves: ["e4", "c6"], name: "Caro-Kann Defense" },
  { moves: ["e4", "d6", "d4", "Nf6"], name: "Pirc Defense" },
  { moves: ["e4", "Nf6"], name: "Alekhine's Defense" },
  { moves: ["e4", "d5"], name: "Scandinavian Defense (Center Counter)" },
  { moves: ["e4", "g6"], name: "Modern Defense" },
  { moves: ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7"], name: "King's Indian Defense (KID)" },
  { moves: ["d4", "Nf6", "c4", "e6", "Nc3", "Bb4"], name: "Nimzo-Indian Defense" },
  { moves: ["d4", "Nf6", "c4", "e6", "Nf3", "b6"], name: "Queen's Indian Defense" },
  { moves: ["d4", "Nf6", "c4", "c5"], name: "Benoni Defense" },
  { moves: ["d4", "f5"], name: "Dutch Defense" },
  { moves: ["d4", "d5", "Bf4"], name: "London System" },
  { moves: ["d4", "Nf6", "Bf4"], name: "London System" },
  { moves: ["c4"], name: "English Opening" },
  { moves: ["Nf3"], name: "Réti Opening" },
  { moves: ["b3"], name: "Nimzo-Larsen Attack" },
  { moves: ["f4"], name: "Bird's Opening" },
  { moves: ["e4", "e5"], name: "Open Game (1. e4 e5)" },
  { moves: ["e4"], name: "King's Pawn Opening (1. e4)" },
  { moves: ["d4"], name: "Queen's Pawn Opening (1. d4)" }
];

function detectOpening() {
  const history = game.history();
  if (history.length === 0) return "Starting Position";

  let matchedOpening = null;
  let maxMatchedLen = 0;

  for (const item of OPENINGS_LIST) {
    if (item.moves.length <= history.length) {
      let match = true;
      for (let i = 0; i < item.moves.length; i++) {
        if (history[i] !== item.moves[i]) {
          match = false;
          break;
        }
      }
      if (match && item.moves.length > maxMatchedLen) {
        maxMatchedLen = item.moves.length;
        matchedOpening = item.name;
      }
    }
  }

  return matchedOpening || "Unorthodox / Custom Variation";
}

// 1. Initialize Stockfish Engine
async function initStockfish() {
  const urls = [
    'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js',
    'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js'
  ];

  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const scriptText = await response.text();
      const blob = new Blob([scriptText], { type: 'application/javascript' });
      stockfish = new Worker(URL.createObjectURL(blob));
      setupStockfishListeners();
      stockfish.postMessage('uci');
      return;
    } catch (e) {
      console.warn('Trying next Stockfish CDN...', e);
    }
  }

  document.getElementById('engineBadge').textContent = 'Offline Mode';
  document.getElementById('engineSubtext').textContent = 'Could not load remote Stockfish worker.';
}

function setupStockfishListeners() {
  stockfish.onmessage = function(event) {
    const line = typeof event.data === 'string' ? event.data : '';
    if (!line) return;

    if (line === 'uciok') {
      engineReady = true;
      document.getElementById('engineBadge').textContent = 'Stockfish 10 Ready';
      if (currentMode === 'analysis') {
        analyzePosition();
      }
    }

    if (line.startsWith('info depth')) {
      const depthMatch = line.match(/depth (\d+)/);
      const scoreMatch = line.match(/score cp (-?\d+)/);
      const mateMatch = line.match(/score mate (-?\d+)/);
      const pvMatch = line.match(/ pv ([a-h1-8qrbn\s]+)/);

      if (depthMatch) {
        document.getElementById('depthVal').textContent = `${depthMatch[1]} / ${targetDepth}`;
      }

      if (pvMatch) {
        const pvMoves = pvMatch[1].trim().split(/\s+/);
        const topUci = pvMoves[0];
        if (topUci && topUci.length >= 4) {
          currentBestMoveUci = topUci;
          if (currentMode === 'analysis') {
            updateBestMoveDisplay(topUci);
            drawBestMoveArrow(topUci);
          }
        }
        document.getElementById('pvLineText').textContent = `Engine Line: ${pvMoves.slice(0, 5).join(' → ')}`;
      }

      const turnMultiplier = game.turn() === 'w' ? 1 : -1;
      let newScoreCp = 0;

      if (mateMatch) {
        const mateRaw = parseInt(mateMatch[1], 10) * turnMultiplier;
        const mateText = `M${Math.abs(mateRaw)}`;
        document.getElementById('evalScore').textContent = mateRaw > 0 ? `+${mateText}` : `-${mateText}`;
        updateEvalBar(mateRaw > 0 ? 10 : -10, mateText);
        newScoreCp = mateRaw > 0 ? 1500 : -1500;
      } else if (scoreMatch) {
        const cpWhite = (parseInt(scoreMatch[1], 10) * turnMultiplier) / 100;
        newScoreCp = parseInt(scoreMatch[1], 10) * turnMultiplier;
        const sign = cpWhite > 0 ? '+' : '';
        const formatted = `${sign}${cpWhite.toFixed(2)}`;
        document.getElementById('evalScore').textContent = formatted;
        updateEvalBar(cpWhite, `${sign}${cpWhite.toFixed(1)}`);
      }

      currentPositionCp = newScoreCp;

      // RESOLVE MOVE QUALITY UPON RECEIVING REAL EVALUATION FROM ENGINE:
      if (pendingEvalMoveIndex !== null && moveQualityHistory[pendingEvalMoveIndex]) {
        resolveMoveQuality(pendingEvalMoveIndex, newScoreCp);
        pendingEvalMoveIndex = null;
      }
    }

    if (line.startsWith('bestmove')) {
      const parts = line.split(' ');
      const bestUci = parts[1];

      if (currentMode === 'bot' && isBotThinking) {
        isBotThinking = false;
        executeBotMove(bestUci);
        return;
      }

      if (bestUci && bestUci !== '(none)') {
        currentBestMoveUci = bestUci;
        if (currentMode === 'analysis') {
          updateBestMoveDisplay(bestUci);
          drawBestMoveArrow(bestUci);
        }
      }
    }
  };
}

// Correct Centipawn Difference Calculation for Real Blunders & Mistakes
function resolveMoveQuality(index, evalAfter) {
  const item = moveQualityHistory[index];
  if (!item) return;

  item.evalAfter = evalAfter;
  const evalBefore = item.evalBefore;

  // For White: If eval dropped, loss = evalBefore - evalAfter
  // For Black: If eval increased in White's favor, loss = evalAfter - evalBefore
  let diff = 0;
  if (item.color === 'w') {
    diff = evalBefore - evalAfter;
  } else {
    diff = evalAfter - evalBefore;
  }

  let quality = 'good';
  if (diff >= 200) {
    quality = 'blunder';       // ?? Loss >= 2 pawns
  } else if (diff >= 90) {
    quality = 'mistake';       // ? Loss >= 0.9 pawns
  } else if (diff >= 40) {
    quality = 'inaccuracy';    // ?! Loss >= 0.4 pawns
  } else if (diff <= 15) {
    quality = 'best';          // ★ Optimal move / minimal drop
  } else {
    quality = 'good';          // ✓ Standard playable move
  }

  item.quality = quality;
  item.loss = Math.max(0, diff);

  updateGameReview();
  renderMoveHistoryBadges();
}

function updateBestMoveDisplay(uci) {
  if (!uci || uci.length < 4) return;
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.length > 4 ? uci[4] : 'q';

  const tempGame = new Chess(game.fen());
  const moveObj = tempGame.move({ from, to, promotion });
  const sanText = moveObj ? moveObj.san : `${from}→${to}`;

  document.getElementById('bestMoveText').textContent = `${sanText} (${from.toUpperCase()} → ${to.toUpperCase()})`;
  document.getElementById('engineSubtext').textContent = `Move piece from ${from.toUpperCase()} to ${to.toUpperCase()}`;
}

function updateEvalBar(cpWhite, displayScore) {
  const clamped = Math.max(-10, Math.min(10, cpWhite));
  const whitePercent = 50 + (clamped / 10) * 46;

  document.getElementById('evalBarWhite').style.height = `${whitePercent}%`;
  document.getElementById('evalBarText').textContent = displayScore;

  const wProb = Math.round(whitePercent);
  const bProb = 100 - wProb;
  document.getElementById('whiteProbBar').style.width = `${wProb}%`;
  document.getElementById('whiteProbBar').textContent = `White ${wProb}%`;
  document.getElementById('blackProbBar').style.width = `${bProb}%`;
  document.getElementById('blackProbBar').textContent = `Black ${bProb}%`;

  const explainEl = document.getElementById('evalExplainText');
  if (cpWhite > 1.5) explainEl.textContent = 'White has a winning advantage.';
  else if (cpWhite > 0.4) explainEl.textContent = 'White is slightly better.';
  else if (cpWhite < -1.5) explainEl.textContent = 'Black has a winning advantage.';
  else if (cpWhite < -0.4) explainEl.textContent = 'Black is slightly better.';
  else explainEl.textContent = 'Position is balanced.';
}

function drawBestMoveArrow(uci) {
  clearHighlights();
  const arrowEl = document.getElementById('bestMoveArrow');

  if (!showBestMoveArrow || currentMode === 'bot' || !uci || uci.length < 4 || game.game_over()) {
    arrowEl.setAttribute('visibility', 'hidden');
    return;
  }

  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);

  $(`#myBoard .square-${from}`).addClass('highlight-from');
  $(`#myBoard .square-${to}`).addClass('highlight-to');

  const coordsFrom = squareToSvgCoords(from);
  const coordsTo = squareToSvgCoords(to);

  arrowEl.setAttribute('x1', coordsFrom.x);
  arrowEl.setAttribute('y1', coordsFrom.y);
  arrowEl.setAttribute('x2', coordsTo.x);
  arrowEl.setAttribute('y2', coordsTo.y);
  arrowEl.setAttribute('visibility', 'visible');
}

function squareToSvgCoords(square) {
  const file = square.charCodeAt(0) - 97;
  const rank = parseInt(square[1], 10) - 1;
  const orientation = board.orientation();

  let col, row;
  if (orientation === 'white') {
    col = file;
    row = 7 - rank;
  } else {
    col = 7 - file;
    row = rank;
  }

  return {
    x: col * 12.5 + 6.25,
    y: row * 12.5 + 6.25
  };
}

function clearHighlights() {
  $('#myBoard .square-55d63').removeClass('highlight-from highlight-to');
}

function clearClickHighlights() {
  $('#myBoard .square-55d63').removeClass('square-selected legal-dest-dot legal-dest-capture');
}

function showLegalDestinations(sourceSquare) {
  clearClickHighlights();
  $(`#myBoard .square-${sourceSquare}`).addClass('square-selected');

  const legalMoves = game.moves({ square: sourceSquare, verbose: true });
  for (const m of legalMoves) {
    const $target = $(`#myBoard .square-${m.to}`);
    if (m.captured || game.get(m.to)) {
      $target.addClass('legal-dest-capture');
    } else {
      $target.addClass('legal-dest-dot');
    }
  }
}

function analyzePosition() {
  if (!stockfish || !engineReady) return;
  if (game.game_over()) {
    document.getElementById('bestMoveText').textContent = 'Game Over';
    document.getElementById('bestMoveArrow').setAttribute('visibility', 'hidden');
    return;
  }

  document.getElementById('bestMoveText').textContent = 'Analyzing...';
  stockfish.postMessage('stop');
  stockfish.postMessage('setoption name Skill Level value 20');
  stockfish.postMessage('position fen ' + game.fen());
  stockfish.postMessage('go depth ' + targetDepth);
}

function requestBotMove() {
  if (game.game_over() || !stockfish || !engineReady) return;
  isBotThinking = true;

  document.getElementById('bestMoveText').textContent = `Bot (${botRating}) is thinking...`;
  document.getElementById('engineSubtext').textContent = 'Calculating response...';
  document.getElementById('pvLineText').textContent = 'Bot turn in progress...';
  document.getElementById('bestMoveArrow').setAttribute('visibility', 'hidden');

  const profile = BOT_PROFILES[botRating] || BOT_PROFILES[1400];

  if (Math.random() < profile.blunderRate) {
    const legalMoves = game.moves({ verbose: true });
    if (legalMoves.length > 0) {
      const randomMove = legalMoves[Math.floor(Math.random() * legalMoves.length)];
      setTimeout(() => {
        if (!isBotThinking) return;
        isBotThinking = false;
        const uciMove = randomMove.from + randomMove.to + (randomMove.promotion || '');
        executeBotMove(uciMove);
      }, profile.moveTime);
      return;
    }
  }

  stockfish.postMessage('stop');
  stockfish.postMessage(`setoption name Skill Level value ${profile.skill}`);
  stockfish.postMessage('position fen ' + game.fen());
  stockfish.postMessage(`go depth ${profile.depth} movetime ${profile.moveTime}`);
}

function executeBotMove(uci) {
  if (!uci || uci === '(none)') {
    isBotThinking = false;
    return;
  }

  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.length > 4 ? uci[4] : 'q';

  const beforeEval = currentPositionCp;
  const move = game.move({ from, to, promotion });
  if (move) {
    redoStack = [];
    board.position(game.fen());
    recordMoveQuality(move, beforeEval);
    handleMoveEffects(move);
    updateUI();
  }
}

// Drag & Drop Handlers
function onDragStart(source, piece) {
  if (game.game_over()) return false;
  if (isBotThinking) return false;

  if ((game.turn() === 'w' && piece.search(/^b/) !== -1) ||
      (game.turn() === 'b' && piece.search(/^w/) !== -1)) {
    return false;
  }

  if (currentMode === 'bot' && game.turn() !== playerColor) {
    return false;
  }
  if (currentMode === 'friend' && currentRoomCode) {
    if (game.turn() !== myOnlineColor) return false;
    if ((myOnlineColor === 'w' && piece.search(/^b/) !== -1) ||
        (myOnlineColor === 'b' && piece.search(/^w/) !== -1)) {
      return false;
    }
  }

  dragActive = true;
  showLegalDestinations(source);
}

function onDrop(source, target) {
  dragActive = false;
  lastDropTime = Date.now();

  if (source === target) {
    if (selectedSquare === source) {
      clearClickHighlights();
      selectedSquare = null;
    } else {
      selectedSquare = source;
      showLegalDestinations(source);
    }
    return 'snapback';
  }

  clearClickHighlights();
  selectedSquare = null;

  const beforeEval = currentPositionCp;
  const move = game.move({
    from: source,
    to: target,
    promotion: 'q'
  });

  if (move === null) return 'snapback';

  redoStack = [];
  recordMoveQuality(move, beforeEval);
  handleMoveEffects(move);
  updateUI();
  checkBotTrigger();
  checkOnlineTrigger(move);
}

function onSnapEnd() {
  board.position(game.fen());
}

// Universal Click & Touch handler for mobile & desktop
function handleSquareClick(square) {
  if (game.game_over() || isBotThinking) return;

  if (selectedSquare) {
    const clickedPiece = game.get(square);
    if (clickedPiece && clickedPiece.color === game.turn() &&
        (currentMode !== 'bot' || clickedPiece.color === playerColor)) {
      if (selectedSquare === square) {
        clearClickHighlights();
        selectedSquare = null;
        return;
      }
      selectedSquare = square;
      showLegalDestinations(square);
      return;
    }

    const beforeEval = currentPositionCp;
    const move = game.move({
      from: selectedSquare,
      to: square,
      promotion: 'q'
    });

    clearClickHighlights();
    selectedSquare = null;

    if (move) {
      redoStack = [];
      board.position(game.fen());
      recordMoveQuality(move, beforeEval);
      handleMoveEffects(move);
      updateUI();
      checkBotTrigger();
      checkOnlineTrigger(move);
      return;
    }
  }

  const piece = game.get(square);
  if (!piece) return;

  if (piece.color !== game.turn()) return;
  if (currentMode === 'bot' && piece.color !== playerColor) return;
  if (currentMode === 'friend' && currentRoomCode && piece.color !== myOnlineColor) return;

  selectedSquare = square;
  showLegalDestinations(square);
}

function recordMoveQuality(move, beforeEval) {
  const newIndex = moveQualityHistory.length;
  moveQualityHistory.push({
    san: move.san,
    color: move.color,
    evalBefore: beforeEval,
    evalAfter: beforeEval,
    quality: '...', // Pending evaluation from Stockfish
    loss: 0
  });
  pendingEvalMoveIndex = newIndex;
}

function handleMoveEffects(move) {
  if (game.in_checkmate()) {
    playSound('checkmate');
  } else if (game.in_check()) {
    playSound('check');
  } else if (move.captured) {
    playSound('capture');
  } else {
    playSound('move');
  }
}

// Captured Pieces Tracking & Material Score Calculation
const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const PIECE_IMAGES = {
  w: {
    p: 'https://chessboardjs.com/img/chesspieces/wikipedia/wP.png',
    n: 'https://chessboardjs.com/img/chesspieces/wikipedia/wN.png',
    b: 'https://chessboardjs.com/img/chesspieces/wikipedia/wB.png',
    r: 'https://chessboardjs.com/img/chesspieces/wikipedia/wR.png',
    q: 'https://chessboardjs.com/img/chesspieces/wikipedia/wQ.png'
  },
  b: {
    p: 'https://chessboardjs.com/img/chesspieces/wikipedia/bP.png',
    n: 'https://chessboardjs.com/img/chesspieces/wikipedia/bN.png',
    b: 'https://chessboardjs.com/img/chesspieces/wikipedia/bB.png',
    r: 'https://chessboardjs.com/img/chesspieces/wikipedia/bR.png',
    q: 'https://chessboardjs.com/img/chesspieces/wikipedia/bQ.png'
  }
};

function updateCapturedPiecesDisplay() {
  const startingCounts = {
    w: { p: 8, n: 2, b: 2, r: 2, q: 1 },
    b: { p: 8, n: 2, b: 2, r: 2, q: 1 }
  };

  const currentBoard = game.board();
  const currentCounts = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0 }
  };

  let whiteMaterial = 0;
  let blackMaterial = 0;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = currentBoard[r][c];
      if (piece && piece.type !== 'k') {
        currentCounts[piece.color][piece.type]++;
        if (piece.color === 'w') whiteMaterial += PIECE_VALUES[piece.type];
        else blackMaterial += PIECE_VALUES[piece.type];
      }
    }
  }

  // Pieces captured from Black (captured by White):
  const capturedFromBlack = [];
  ['q', 'r', 'b', 'n', 'p'].forEach(type => {
    const diff = startingCounts.b[type] - currentCounts.b[type];
    for (let i = 0; i < diff; i++) {
      capturedFromBlack.push({ color: 'b', type: type });
    }
  });

  // Pieces captured from White (captured by Black):
  const capturedFromWhite = [];
  ['q', 'r', 'b', 'n', 'p'].forEach(type => {
    const diff = startingCounts.w[type] - currentCounts.w[type];
    for (let i = 0; i < diff; i++) {
      capturedFromWhite.push({ color: 'w', type: type });
    }
  });

  const diffMaterial = whiteMaterial - blackMaterial;
  const isFlipped = board && board.orientation() === 'black';

  // If flipped, top is White, bottom is Black
  const topList = isFlipped ? capturedFromBlack : capturedFromWhite;
  const bottomList = isFlipped ? capturedFromWhite : capturedFromBlack;

  const topName = isFlipped ? 'White' : 'Black';
  const bottomName = isFlipped ? 'Black' : 'White';

  document.getElementById('topPlayerName').textContent = topName;
  document.getElementById('bottomPlayerName').textContent = bottomName;

  document.getElementById('topCapturedBar').querySelector('.player-dot').className = `player-dot ${isFlipped ? 'white-dot' : 'black-dot'}`;
  document.getElementById('bottomCapturedBar').querySelector('.player-dot').className = `player-dot ${isFlipped ? 'black-dot' : 'white-dot'}`;

  // Render HTML icons for captured pieces
  document.getElementById('topCapturedPieces').innerHTML = topList.map(p =>
    `<img src="${PIECE_IMAGES[p.color][p.type]}" class="captured-img" alt="${p.type}" />`
  ).join('');

  document.getElementById('bottomCapturedPieces').innerHTML = bottomList.map(p =>
    `<img src="${PIECE_IMAGES[p.color][p.type]}" class="captured-img" alt="${p.type}" />`
  ).join('');

  // Material Advantage badges (+1, +3, etc.)
  const topAdvEl = document.getElementById('topMaterialAdv');
  const bottomAdvEl = document.getElementById('bottomMaterialAdv');

  topAdvEl.textContent = '';
  bottomAdvEl.textContent = '';

  if (diffMaterial > 0) {
    // White leads
    if (isFlipped) topAdvEl.textContent = `+${diffMaterial}`;
    else bottomAdvEl.textContent = `+${diffMaterial}`;
  } else if (diffMaterial < 0) {
    // Black leads
    if (isFlipped) bottomAdvEl.textContent = `+${Math.abs(diffMaterial)}`;
    else topAdvEl.textContent = `+${Math.abs(diffMaterial)}`;
  }
}

function updateGameReview() {
  if (moveQualityHistory.length === 0) {
    document.getElementById('estEloVal').textContent = '-- Elo';
    document.getElementById('accuracyVal').textContent = '--%';
    document.getElementById('countBest').textContent = '0';
    document.getElementById('countGood').textContent = '0';
    document.getElementById('countInacc').textContent = '0';
    document.getElementById('countMistake').textContent = '0';
    document.getElementById('countBlunder').textContent = '0';
    document.getElementById('whiteQualityStats').textContent = '0 Blunders • 0 Mistakes';
    document.getElementById('blackQualityStats').textContent = '0 Blunders • 0 Mistakes';
    return;
  }

  let counts = { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0, '...': 0 };
  let whiteBlunders = 0, whiteMistakes = 0;
  let blackBlunders = 0, blackMistakes = 0;
  let totalLoss = 0;
  let analyzedMoves = 0;

  for (const m of moveQualityHistory) {
    if (m.quality !== '...') {
      counts[m.quality] = (counts[m.quality] || 0) + 1;
      totalLoss += m.loss;
      analyzedMoves++;

      if (m.color === 'w') {
        if (m.quality === 'blunder') whiteBlunders++;
        if (m.quality === 'mistake') whiteMistakes++;
      } else {
        if (m.quality === 'blunder') blackBlunders++;
        if (m.quality === 'mistake') blackMistakes++;
      }
    }
  }

  document.getElementById('countBest').textContent = counts.best;
  document.getElementById('countGood').textContent = counts.good;
  document.getElementById('countInacc').textContent = counts.inaccuracy;
  document.getElementById('countMistake').textContent = counts.mistake;
  document.getElementById('countBlunder').textContent = counts.blunder;

  document.getElementById('whiteQualityStats').textContent = `${whiteBlunders} Blunders • ${whiteMistakes} Mistakes`;
  document.getElementById('blackQualityStats').textContent = `${blackBlunders} Blunders • ${blackMistakes} Mistakes`;

  if (analyzedMoves === 0) return;

  const avgLoss = totalLoss / analyzedMoves;
  let accuracy = Math.round(100 * Math.exp(-0.0055 * avgLoss));
  accuracy = Math.max(30, Math.min(99, accuracy));
  document.getElementById('accuracyVal').textContent = `${accuracy}%`;

  let estElo = Math.round(700 + (accuracy - 30) * 26 - (counts.blunder * 40) - (counts.mistake * 15));
  estElo = Math.max(650, Math.min(2800, estElo));
  document.getElementById('estEloVal').textContent = `~${estElo} Elo`;

  const summaryEl = document.getElementById('reviewSummaryText');
  if (counts.blunder === 0 && counts.mistake === 0) {
    summaryEl.textContent = 'Flawless accuracy! GM-level precision without blunders.';
  } else if (counts.blunder === 0) {
    summaryEl.textContent = `Solid game! No catastrophic blunders. Found ${counts.best} best moves.`;
  } else {
    summaryEl.textContent = `Caution: ${counts.blunder} blunder(s) and ${counts.mistake} mistake(s) occurred. Review move badges below to inspect turning points.`;
  }
}

function renderMoveHistoryBadges() {
  const history = game.history();
  if (history.length === 0) {
    const emptyHtml = '<div class="move-list-empty">No moves yet</div>';
    document.getElementById('moveHistory').innerHTML = emptyHtml;
    document.getElementById('quickMoveHistory').innerHTML = emptyHtml;
    return;
  }

  let html = '';
  for (let i = 0; i < history.length; i += 2) {
    const moveNum = Math.floor(i / 2) + 1;
    const whiteMove = history[i] || '';
    const blackMove = history[i + 1] || '';

    const whiteReview = moveQualityHistory[i];
    const blackReview = moveQualityHistory[i + 1];

    const whiteBadge = (whiteReview && whiteReview.quality !== '...')
      ? `<span class="move-badge badge-${whiteReview.quality}">${whiteReview.quality}</span>`
      : '';
    const blackBadge = (blackReview && blackReview.quality !== '...')
      ? `<span class="move-badge badge-${blackReview.quality}">${blackReview.quality}</span>`
      : '';

    html += `<div class="move-row">
      <span class="move-num">${moveNum}.</span>
      <span>${whiteMove} ${whiteBadge}</span>
      <span>${blackMove} ${blackBadge}</span>
    </div>`;
  }
  document.getElementById('moveHistory').innerHTML = html;
  document.getElementById('quickMoveHistory').innerHTML = html;
}

function checkBotTrigger() {
  if (currentMode === 'bot' && !game.game_over()) {
    if (game.turn() !== playerColor) {
      setTimeout(() => {
        requestBotMove();
      }, 250);
    }
  }
}

function updateUI() {
  const currentOpening = detectOpening();
  document.getElementById('openingName').textContent = currentOpening;

  const statusEl = document.getElementById('gameStatus');
  if (game.in_checkmate()) {
    statusEl.textContent = 'Checkmate!';
    statusEl.style.color = '#f87171';
  } else if (game.in_draw()) {
    statusEl.textContent = 'Draw';
    statusEl.style.color = '#fbbf24';
  } else if (game.in_check()) {
    statusEl.textContent = 'Check!';
    statusEl.style.color = '#fb923c';
  } else {
    statusEl.textContent = `${game.turn() === 'w' ? 'White' : 'Black'} to move`;
    statusEl.style.color = '#4ade80';
  }

  updateCapturedPiecesDisplay();
  renderMoveHistoryBadges();

  if (currentMode === 'analysis') {
    analyzePosition();
  }
}

function setGameMode(mode) {
  if (isOnlineMatchActive && mode !== 'friend') {
    alert("நண்பருடன் நேரலை மேட்ச் நடந்துகொண்டிருக்கிறது! விளையாடும் போது அனலைஸ் அல்லது பாட் மோடிற்கு மாற முடியாது.\n\nமேட்ச் முடிந்த பின், டிரா அல்லது ரிசைன் செய்த பிறகே பிற மோடுகளுக்கு மாற முடியும்.");
    return;
  }

  currentMode = mode;
  selectedSquare = null;
  clearClickHighlights();

  const botBtn = document.getElementById('modeBotBtn');
  const analyzeBtn = document.getElementById('modeAnalyzeBtn');
  const friendBtn = document.getElementById('modeFriendBtn');
  const botControls = document.getElementById('botControls');
  const friendControls = document.getElementById('friendControls');
  const playBestBtn = document.getElementById('playBestBtn');
  const chatTabBtn = document.getElementById('chatTabBtn');

  if (botBtn) botBtn.classList.toggle('active', mode === 'bot');
  if (analyzeBtn) analyzeBtn.classList.toggle('active', mode === 'analysis');
  if (friendBtn) friendBtn.classList.toggle('active', mode === 'friend');

  if (mode === 'bot') {
    if (botControls) botControls.style.display = 'flex';
    if (friendControls) friendControls.style.display = 'none';
    if (chatTabBtn) chatTabBtn.style.display = 'none';
    if (playBestBtn) playBestBtn.style.display = 'none';
    document.getElementById('panelPrimaryLabel').textContent = 'Bot Status';
    document.getElementById('bestMoveArrow').setAttribute('visibility', 'hidden');
    clearHighlights();
  } else if (mode === 'friend') {
    if (botControls) botControls.style.display = 'none';
    if (friendControls) friendControls.style.display = 'flex';
    if (chatTabBtn) chatTabBtn.style.display = 'inline-block';
    if (playBestBtn) playBestBtn.style.display = 'none';
    document.getElementById('panelPrimaryLabel').textContent = 'Friend Match';
    document.getElementById('bestMoveArrow').setAttribute('visibility', 'hidden');
    clearHighlights();
  } else {
    if (botControls) botControls.style.display = 'none';
    if (friendControls) friendControls.style.display = 'none';
    if (chatTabBtn) chatTabBtn.style.display = 'none';
    if (playBestBtn) playBestBtn.style.display = 'block';
    document.getElementById('panelPrimaryLabel').textContent = 'Best Move Suggestion';
    analyzePosition();
  }
}

function startNewBotGame() {
  game.reset();
  redoStack = [];
  moveQualityHistory = [];
  selectedSquare = null;
  isBotThinking = false;
  clearClickHighlights();
  clearHighlights();

  playerColor = document.getElementById('botSideSelect').value;
  botRating = parseInt(document.getElementById('botRatingSelect').value, 10);

  board.orientation(playerColor === 'w' ? 'white' : 'black');
  board.start();

  updateEvalBar(0, '0.0');
  document.getElementById('evalScore').textContent = '+0.00';
  updateGameReview();
  updateUI();

  if (playerColor === 'b') {
    setTimeout(() => {
      requestBotMove();
    }, 400);
  } else {
    document.getElementById('bestMoveText').textContent = 'Your turn!';
    document.getElementById('engineSubtext').textContent = `Playing against Stockfish bot (${botRating})`;
    document.getElementById('pvLineText').textContent = 'Make your opening move...';
  }
}

// Full Analysis Report Copy function
function copyFullAnalysisReport() {
  const opening = detectOpening();
  const evalScore = document.getElementById('evalScore').textContent;
  const accuracy = document.getElementById('accuracyVal').textContent;
  const estElo = document.getElementById('estEloVal').textContent;
  const bestCount = document.getElementById('countBest').textContent;
  const goodCount = document.getElementById('countGood').textContent;
  const inaccCount = document.getElementById('countInacc').textContent;
  const mistakeCount = document.getElementById('countMistake').textContent;
  const blunderCount = document.getElementById('countBlunder').textContent;
  const whiteStats = document.getElementById('whiteQualityStats').textContent;
  const blackStats = document.getElementById('blackQualityStats').textContent;
  const pgn = game.pgn() || 'No moves played yet.';

  const report = [
    '=== B CHESS ANALYZER — FULL GAME REPORT ===',
    `Opening / Gambit : ${opening}`,
    `Final Evaluation : ${evalScore}`,
    `Move Accuracy    : ${accuracy}`,
    `Estimated Elo    : ${estElo}`,
    '-------------------------------------------',
    'MOVE QUALITY BREAKDOWN:',
    `★ Best Moves     : ${bestCount}`,
    `✓ Good Moves     : ${goodCount}`,
    `?! Inaccuracies  : ${inaccCount}`,
    `? Mistakes       : ${mistakeCount}`,
    `?? Blunders      : ${blunderCount}`,
    '-------------------------------------------',
    `White Stats      : ${whiteStats}`,
    `Black Stats      : ${blackStats}`,
    '-------------------------------------------',
    'PGN MOVE RECORD:',
    pgn,
    '==========================================='
  ].join('\n');

  navigator.clipboard.writeText(report).then(() => {
    const msg = document.getElementById('copySuccessMsg');
    msg.style.display = 'block';
    setTimeout(() => {
      msg.style.display = 'none';
    }, 3500);
  }).catch(err => {
    alert('Analysis report copied to console!');
    console.log(report);
  });
}

$(document).ready(function() {
  const config = {
    draggable: true,
    position: 'start',
    pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
    onDragStart: onDragStart,
    onDrop: onDrop,
    onSnapEnd: onSnapEnd
  };

  board = Chessboard('myBoard', config);

  let lastTouchTime = 0;
  $('#myBoard').on('touchstart', '.square-55d63', function() {
    lastTouchTime = Date.now();
  });

  $('#myBoard').on('click touchend', '.square-55d63', function(e) {
    if (dragActive) return;
    if (Date.now() - lastDropTime < 400) return;
    if (e.type === 'click' && Date.now() - lastTouchTime < 450) {
      return;
    }
    const square = $(this).attr('data-square');
    if (square) {
      handleSquareClick(square);
    }
  });

  $(window).resize(() => {
    board.resize();
    if (currentBestMoveUci && currentMode === 'analysis') {
      drawBestMoveArrow(currentBestMoveUci);
    }
  });

  initStockfish();
  updateUI();

  // Copy Analysis Button Listener
  document.getElementById('copyAnalysisBtn').addEventListener('click', copyFullAnalysisReport);

  // Mode Switchers
  document.getElementById('modeAnalyzeBtn').addEventListener('click', () => {
    setGameMode('analysis');
  });

  document.getElementById('modeBotBtn').addEventListener('click', () => {
    setGameMode('bot');
    startNewBotGame();
  });

  const friendBtn = document.getElementById('modeFriendBtn');
  if (friendBtn) {
    friendBtn.addEventListener('click', () => {
      setGameMode('friend');
    });
  }
  const loginBtn = document.getElementById('googleLoginBtn');
  if (loginBtn) loginBtn.addEventListener('click', triggerGoogleLogin);

  const signoutBtn = document.getElementById('signOutBtn');
  if (signoutBtn) signoutBtn.addEventListener('click', handleLogout);
  const editProfileBtn = document.getElementById('editProfileBtn');
  if (editProfileBtn) editProfileBtn.addEventListener('click', () => openProfileModal(false));

  const saveProfileBtn = document.getElementById('saveProfileBtn');
  if (saveProfileBtn) saveProfileBtn.addEventListener('click', saveUserProfile);

  const cancelProfileBtn = document.getElementById('cancelProfileBtn');
  if (cancelProfileBtn) cancelProfileBtn.addEventListener('click', closeProfileModal);

  const profilePhotoInput = document.getElementById('profilePhotoInput');
  if (profilePhotoInput) {
    profilePhotoInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const photo = await readAndResizeProfilePhoto(file);
        const preview = document.getElementById('profilePreviewImg');
        const fallback = document.getElementById('profilePreviewFallback');
        if (preview) { preview.src = photo; preview.style.display = 'block'; }
        if (fallback) fallback.style.display = 'none';
      } catch (err) {
        console.error("Profile image preview error:", err);
      }
    });
  }

  const createBtn = document.getElementById('createRoomBtn');
  if (createBtn) createBtn.addEventListener('click', createFriendRoom);

  const joinBtn = document.getElementById('joinRoomBtn');
  if (joinBtn) joinBtn.addEventListener('click', joinFriendRoom);

  const copyBtn = document.getElementById('copyRoomCodeBtn');
  if (copyBtn) copyBtn.addEventListener('click', copyRoomCode);

  const micBtn = document.getElementById('toggleMicBtn');
  if (micBtn) micBtn.addEventListener('click', toggleMicrophone);
  const speakerBtn = document.getElementById('toggleSpeakerBtn');
  if (speakerBtn) speakerBtn.addEventListener('click', toggleSpeaker);

  const drawBtn = document.getElementById('offerDrawBtn');
  if (drawBtn) drawBtn.addEventListener('click', offerDrawGame);

  const resBtn = document.getElementById('resignBtn');
  if (resBtn) resBtn.addEventListener('click', resignGame);

  const chatF = document.getElementById('chatForm');
  if (chatF) chatF.addEventListener('submit', handleSendChat);

  document.getElementById('startBotGameBtn').addEventListener('click', () => {
    startNewBotGame();
  });

  document.getElementById('botRatingSelect').addEventListener('change', (e) => {
    botRating = parseInt(e.target.value, 10);
  });

  // Sound Toggle Button
  document.getElementById('soundToggleBtn').addEventListener('click', (e) => {
    soundEnabled = !soundEnabled;
    e.target.textContent = soundEnabled ? '🔊 Sound: ON' : '🔇 Sound: OFF';
    e.target.classList.toggle('active-pill', soundEnabled);
    if (soundEnabled) playSound('move');
  });

  // Undo Button
  document.getElementById('undoBtn').addEventListener('click', () => {
    if (isBotThinking) return;
    clearClickHighlights();
    selectedSquare = null;

    if (currentMode === 'bot') {
      game.undo();
      game.undo();
      moveQualityHistory.pop();
      moveQualityHistory.pop();
    } else {
      const move = game.undo();
      if (move) {
        redoStack.push(move);
        moveQualityHistory.pop();
      }
    }
    board.position(game.fen());
    updateGameReview();
    updateUI();
  });

  // Redo Button
  document.getElementById('redoBtn').addEventListener('click', () => {
    if (currentMode === 'bot' || isBotThinking) return;
    clearClickHighlights();
    selectedSquare = null;
    if (redoStack.length > 0) {
      const move = redoStack.pop();
      game.move(move);
      board.position(game.fen());
      updateUI();
    }
  });

  // Flip Board
  document.getElementById('flipBtn').addEventListener('click', () => {
    board.flip();
    updateCapturedPiecesDisplay();
    if (currentBestMoveUci && currentMode === 'analysis') {
      drawBestMoveArrow(currentBestMoveUci);
    }
  });

  // Play Best Move Button
  document.getElementById('playBestBtn').addEventListener('click', () => {
    if (currentMode === 'bot' || !currentBestMoveUci || game.game_over()) return;
    clearClickHighlights();
    selectedSquare = null;
    const from = currentBestMoveUci.slice(0, 2);
    const to = currentBestMoveUci.slice(2, 4);
    const promotion = currentBestMoveUci.length > 4 ? currentBestMoveUci[4] : 'q';

    const beforeEval = currentPositionCp;
    const move = game.move({ from, to, promotion });
    if (move) {
      redoStack = [];
      board.position(game.fen());
      recordMoveQuality(move, beforeEval);
      handleMoveEffects(move);
      updateUI();
    }
  });

  // Reset Button
  document.getElementById('resetBtn').addEventListener('click', () => {
    clearClickHighlights();
    selectedSquare = null;
    moveQualityHistory = [];
    if (currentMode === 'bot') {
      startNewBotGame();
    } else {
      game.reset();
      redoStack = [];
      board.start();
      updateEvalBar(0, '0.0');
      document.getElementById('evalScore').textContent = '+0.00';
      updateGameReview();
      updateUI();
    }
  });

  // Toggle Best Move Arrow
  document.getElementById('arrowToggleBtn').addEventListener('click', (e) => {
    showBestMoveArrow = !showBestMoveArrow;
    e.target.textContent = showBestMoveArrow ? '🏹 Arrow: ON' : '🏹 Arrow: OFF';
    e.target.classList.toggle('active-pill', showBestMoveArrow);
    if (currentBestMoveUci && currentMode === 'analysis') {
      drawBestMoveArrow(currentBestMoveUci);
    }
  });

  // Theme Toggle
  document.getElementById('themeBtn').addEventListener('click', (e) => {
    document.body.classList.toggle('wood-theme');
    const isWood = document.body.classList.contains('wood-theme');
    e.target.textContent = isWood ? 'Wood & Cream' : 'Green & White';
  });

  // Load FEN
  document.getElementById('loadFenBtn').addEventListener('click', () => {
    const fen = document.getElementById('fenInput').value.trim();
    if (fen && game.load(fen)) {
      redoStack = [];
      moveQualityHistory = [];
      clearClickHighlights();
      selectedSquare = null;
      board.position(game.fen());
      updateGameReview();
      updateUI();
    } else {
      alert('Invalid FEN string!');
    }
  });

  // Tabs Switching
  document.querySelectorAll('.tab').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active-content'));
      tabBtn.classList.add('active');
      const targetId = tabBtn.getAttribute('data-tab');
      document.getElementById(targetId).classList.add('active-content');
    });
  });

  // Depth Slider
  document.getElementById('depthSlider').addEventListener('input', (e) => {
    targetDepth = parseInt(e.target.value, 10);
    document.getElementById('depthSliderVal').textContent = targetDepth;
    if (currentMode === 'analysis') {
      analyzePosition();
    }
  });
});
