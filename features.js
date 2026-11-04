/* =====================================================================
   B CHESS ANALYZER — FEATURE UPDATE
   1. Quick Match (server-side matchmaking via Cloud Functions + Firestore)
   2. Books → Other Learning Materials (live from Firestore) + user ratings
   3. Hidden Admin panel (Ctrl + Arrow Up) with Firebase Phone OTP login
   This file is additive: it only uses the existing globals from script.js
   (firebase app, auth, database, board, game, setGameMode, listenToRoom, ...).
   ===================================================================== */
(function () {
  'use strict';

  // Region of the Cloud Functions in /functions (must match setGlobalOptions there).
  const FUNCTIONS_REGION = 'asia-south1';

  const fsdb = firebase.firestore();
  const fns = firebase.app().functions(FUNCTIONS_REGION);
  const call = (name, data) => fns.httpsCallable(name)(data || {}).then(r => r.data);

  const $id = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tsMillis = (t) => (t && typeof t.toMillis === 'function') ? t.toMillis() : (Number(t) || 0);
  const serverNow = () => Date.now() + (typeof serverTimeOffset === 'number' ? serverTimeOffset : 0);

  function friendlyFnError(err, fallback) {
    const code = String((err && err.code) || '').replace('functions/', '');
    if (code === 'not-found' || code === 'unavailable' || (code === 'internal' && /internal/i.test(err.message || ''))) {
      return 'The game server is not reachable right now. Please try again in a moment.';
    }
    return (err && err.message) || fallback || 'Something went wrong.';
  }

  function showFeatureToast(html, ms) {
    let el = $id('featureToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'featureToast';
      el.className = 'feature-toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.innerHTML = html;
    el.classList.add('show');
    clearTimeout(el.__t);
    el.__t = setTimeout(() => el.classList.remove('show'), ms || 3200);
  }

  // =====================================================================
  // 1. QUICK MATCH
  // =====================================================================
  const QM_GROUPS = [
    { name: 'Bullet', icon: '🔥', items: ['1+0', '2+1'] },
    { name: 'Blitz', icon: '⚡', items: ['3+0', '3+2', '5+0'] },
    { name: 'Rapid', icon: '♟', items: ['10+0', '10+5', '15+10'] },
    { name: 'Classical', icon: '🕰', items: ['30+0'] }
  ];
  const QM_RETRY_MS = 7000;             // re-run server pairing + heartbeat while searching
  const QM_MAX_SEARCH_MS = 5 * 60000;   // stop searching after 5 minutes
  const QM_ABORT_MS = 30000;            // opponent never connected to the game → abort
  const QM_DISCONNECT_MS = 60000;       // opponent left mid-game → you win after 60s
  const QM_STORAGE_KEY = 'bChessQuickMatchTime';

  const qm = {
    phase: 'idle',   // idle | searching | found | playing
    timeKey: localStorage.getItem(QM_STORAGE_KEY) || '10+0',
    startedAt: 0,
    startedServer: 0,
    retryTimer: null,
    clockTimer: null,
    unsubQueue: null,
    busy: false,
    message: '',
    match: null,
    resume: null,
    token: null,
    room: null       // { code, oppId, enteredAt, presenceRef, presenceListener, connListener, monitor, oppSeenAt, oppEverSeen, ending }
  };

  function qmLabel(key) {
    const g = QM_GROUPS.find(gr => gr.items.includes(key));
    return (g ? g.name + ' • ' : '') + key;
  }

  function qmIsValidKey(key) { return QM_GROUPS.some(g => g.items.includes(key)); }
  if (!qmIsValidKey(qm.timeKey)) qm.timeKey = '10+0';

  function qmFormatElapsed(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function qmAvatar(name, photo, cls) {
    if (photo && /^(data:image\/|https:\/\/)/.test(photo)) return `<img class="${cls}" src="${esc(photo)}" alt="" />`;
    return `<span class="${cls} qm-avatar-fallback">${esc((name || 'P').charAt(0).toUpperCase())}</span>`;
  }

  function renderQuickMatchPanel() {
    const el = $id('quickMatchControls');
    if (!el) return;
    const selecting = qm.phase === 'idle';
    const groups = QM_GROUPS.map(g => `
      <div class="qm-group">
        <div class="qm-group-title"><span>${g.icon}</span>${g.name}</div>
        <div class="qm-group-cards">
          ${g.items.map(k => `<button type="button" class="qm-time-card${k === qm.timeKey ? ' active' : ''}" data-qm-time="${k}" ${selecting ? '' : 'disabled'} aria-pressed="${k === qm.timeKey}">
              <strong>${k}</strong><span>${g.name}</span></button>`).join('')}
        </div>
      </div>`).join('');

    let status = '';
    if (qm.phase === 'searching') {
      const elapsed = Date.now() - qm.startedAt;
      status = `
        <div class="qm-search-box">
          <div class="qm-radar" aria-hidden="true"><span></span><span></span><span></span><i>♟</i></div>
          <div class="qm-search-copy">
            <strong>Searching for an opponent…</strong>
            <span>${esc(qmLabel(qm.timeKey))} • <b id="qmElapsed">${qmFormatElapsed(elapsed)}</b></span>
            <small>${elapsed > 45000 ? 'Few players online right now — still looking.' : 'You will be matched with the next player who picks the same time control.'}</small>
          </div>
          <button type="button" id="qmCancelBtn" class="pill-btn resign-danger-btn">✕ Cancel</button>
        </div>`;
    } else if (qm.phase === 'found' && qm.match) {
      const o = qm.match.opponent || {};
      status = `
        <div class="qm-found-box">
          <div class="qm-found-title">🎉 Match Found!</div>
          <div class="qm-found-players">
            <div class="qm-found-player">${qmAvatar(currentUserName, currentUserPhoto, 'qm-avatar')}<strong>${esc(currentUserName)}</strong><small>${esc(currentUserRating)} Elo • ${qm.match.color === 'w' ? 'White' : 'Black'}</small></div>
            <div class="qm-found-vs">VS</div>
            <div class="qm-found-player">${qmAvatar(o.name, o.photo, 'qm-avatar')}<strong>${esc(o.name || 'Player')}</strong><small>${esc(o.rating || 800)} Elo • ${qm.match.color === 'w' ? 'Black' : 'White'}</small></div>
          </div>
          <div class="qm-found-sub">${esc(qmLabel(qm.match.timeControl || qm.timeKey))} • Starting game…</div>
        </div>`;
    }

    const resume = (qm.phase === 'idle' && qm.resume) ? `
      <div class="qm-resume-box"><span>You have an unfinished Quick Match against <b>${esc((qm.resume.opponent || {}).name || 'a player')}</b>.</span>
        <button type="button" id="qmResumeBtn" class="pill-btn highlight-btn">↩ Resume</button></div>` : '';
    const msg = qm.message ? `<div class="qm-message">${esc(qm.message)}</div>` : '';

    el.innerHTML = `
      <div class="qm-head">
        <div><h3>⚡ Quick Match</h3><p>Pick a time control and play a random online opponent — no friends needed.</p></div>
      </div>
      ${resume}
      <div class="qm-groups">${groups}</div>
      ${status}
      ${msg}
      ${qm.phase === 'idle' ? `<button type="button" id="qmFindBtn" class="pill-btn highlight-btn qm-find-btn">🔍 Find Opponent <small>${esc(qmLabel(qm.timeKey))}</small></button>` : ''}`;

    el.querySelectorAll('[data-qm-time]').forEach(btn => btn.addEventListener('click', () => {
      if (qm.phase !== 'idle') return;
      qm.timeKey = btn.dataset.qmTime;
      localStorage.setItem(QM_STORAGE_KEY, qm.timeKey);
      qm.message = '';
      renderQuickMatchPanel();
    }));
    const find = $id('qmFindBtn'); if (find) find.addEventListener('click', qmFindOpponent);
    const cancel = $id('qmCancelBtn'); if (cancel) cancel.addEventListener('click', qmCancelSearch);
    const resumeBtn = $id('qmResumeBtn'); if (resumeBtn) resumeBtn.addEventListener('click', () => { const r = qm.resume; qm.resume = null; qmHandleMatched(r, true); });
  }

  function qmApplyQuickChrome() {
    const quickBtn = $id('modeQuickBtn');
    const friendBtn = $id('modeFriendBtn');
    if (friendBtn) friendBtn.classList.remove('active');
    if (quickBtn) quickBtn.classList.add('active');
    const row = document.querySelector('#friendControls .friend-btn-row');
    if (row) row.style.display = 'none';
    const label = $id('panelPrimaryLabel'); if (label) label.textContent = 'Quick Match';
  }

  function openQuickMatchPage() {
    if (qm.room && currentRoomCode === qm.room.code) {   // game in progress: just show it
      if (currentMode !== 'friend') setGameMode('friend');
      qmApplyQuickChrome();
      return;
    }
    setGameMode('quick');
    if (currentMode !== 'quick') return; // blocked by another live match
    if (qm.phase === 'idle' && !currentRoomCode) {
      try { game.reset(); board.orientation('white'); board.start(); updateUI(); } catch (_) {}
    }
    renderQuickMatchPanel();
    qmCheckResume();
  }

  async function qmCheckResume() {
    if (!currentUserId || qm.phase !== 'idle') return;
    try {
      const snap = await fsdb.collection('quickMatchQueue').doc(currentUserId).get();
      const d = snap.exists ? snap.data() : null;
      if (!d || d.status !== 'matched' || !d.roomCode) return;
      const room = (await database.ref('rooms/' + d.roomCode).once('value')).val();
      if (!room || room.gameOver || (room.creatorId !== currentUserId && room.guestId !== currentUserId)) return;
      qm.resume = { roomCode: d.roomCode, color: d.color, opponent: d.opponent || {}, timeControl: d.timeKey };
      if (qm.phase === 'idle') renderQuickMatchPanel();
    } catch (_) { /* Firestore not configured yet: nothing to resume */ }
  }

  function qmStopTimers() {
    clearInterval(qm.retryTimer); qm.retryTimer = null;
    clearInterval(qm.clockTimer); qm.clockTimer = null;
    if (qm.unsubQueue) { try { qm.unsubQueue(); } catch (_) {} qm.unsubQueue = null; }
  }

  async function qmFindOpponent() {
    if (qm.phase !== 'idle' || qm.busy) return;                  // duplicate request guard
    if (!currentUserId) { alert('Please Sign in with Google first!'); return triggerGoogleLogin(); }
    if (!requireTermsAccepted()) return;
    if (currentRoomCode || isOnlineMatchActive) return alert('You are already in a game.');
    if (typeof ensureNotificationPermission === 'function') ensureNotificationPermission();

    qm.phase = 'searching';
    qm.message = '';
    qm.resume = null;
    qm.startedAt = Date.now();
    qm.startedServer = serverNow();
    renderQuickMatchPanel();

    // Someone else may pair with us: the server marks our queue entry "matched".
    qm.unsubQueue = fsdb.collection('quickMatchQueue').doc(currentUserId).onSnapshot(snap => {
      const d = snap.exists ? snap.data() : null;
      if (!d || d.status !== 'matched' || !d.roomCode || qm.phase !== 'searching') return;
      if (tsMillis(d.matchedAt) < qm.startedServer - 10000) return; // an older finished match
      qmHandleMatched({ roomCode: d.roomCode, color: d.color, opponent: d.opponent || {}, timeControl: d.timeKey });
    }, () => {});

    qm.clockTimer = setInterval(() => {
      if (qm.phase !== 'searching') return;
      const el = $id('qmElapsed');
      if (el) el.textContent = qmFormatElapsed(Date.now() - qm.startedAt);
      if (Date.now() - qm.startedAt > QM_MAX_SEARCH_MS) {
        qmCancelSearch().then(() => { qm.message = 'No opponent found in 5 minutes. Try another time control or search again.'; renderQuickMatchPanel(); });
      }
    }, 1000);

    await qmJoinOnce(true);
    if (qm.phase === 'searching') qm.retryTimer = setInterval(() => qmJoinOnce(false), QM_RETRY_MS);
  }

  async function qmJoinOnce(first) {
    if (qm.phase !== 'searching' || qm.busy) return;
    qm.busy = true;
    try {
      if (auth.currentUser) qm.token = await auth.currentUser.getIdToken();
      const res = await call('quickMatchJoin', { timeControl: qm.timeKey });
      if (qm.phase !== 'searching') return;
      if (res && res.status === 'matched') qmHandleMatched(res);
    } catch (err) {
      if (qm.phase !== 'searching') return;
      if (first) {
        qmStopTimers();
        qm.phase = 'idle';
        qm.message = friendlyFnError(err, 'Could not start matchmaking.');
        renderQuickMatchPanel();
      }
    } finally {
      qm.busy = false;
    }
  }

  async function qmCancelSearch() {
    if (qm.phase !== 'searching') return;
    qmStopTimers();
    qm.phase = 'idle';
    qm.message = 'Matchmaking cancelled.';
    renderQuickMatchPanel();
    try {
      const res = await call('quickMatchCancel', {});
      if (res && res.cancelled === false && res.status === 'matched') {
        qm.message = '';
        qm.phase = 'searching'; // let the match go ahead: an opponent was already assigned
        qmHandleMatched(res);
      }
    } catch (_) { /* entry will expire on the server after ~25s without heartbeat */ }
  }

  async function qmHandleMatched(m, resumed) {
    if (!m || !m.roomCode) return;
    if (!resumed && qm.phase !== 'searching') return;
    if (qm.phase === 'found' || qm.phase === 'playing') return;
    qmStopTimers();
    qm.phase = 'found';
    qm.match = m;
    qm.message = '';
    if (!m.opponent) m.opponent = {};
    renderQuickMatchPanel();
    try { playSound('move'); } catch (_) {}
    showFeatureToast(`<strong>⚡ Match found!</strong><span>vs ${esc(m.opponent.name || 'Player')} (${esc(m.opponent.rating || 800)}) • ${esc(qmLabel(m.timeControl || qm.timeKey))}</span>`);
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification('B Chess — Match found!', { body: 'vs ' + (m.opponent.name || 'Player'), icon: 'icons/icon-192.png', tag: 'bchess-quickmatch' }); } catch (_) {}
    }
    if (m.opponent.uid) {
      database.ref('users/' + m.opponent.uid + '/photoData').once('value').then(s => {
        if (qm.match === m && s.val()) { m.opponent.photo = s.val(); if (qm.phase === 'found') renderQuickMatchPanel(); }
      }).catch(() => {});
    }
    setTimeout(() => { if (qm.match === m && qm.phase === 'found') qmEnterRoom(m); }, resumed ? 300 : 2200);
  }

  async function qmEnterRoom(m) {
    const code = m.roomCode;
    let val;
    try { val = (await database.ref('rooms/' + code).once('value')).val(); } catch (_) { val = null; }
    if (!val || val.gameOver || (val.creatorId !== currentUserId && val.guestId !== currentUserId)) {
      qm.phase = 'idle'; qm.match = null;
      qm.message = 'That match is no longer available. Please search again.';
      renderQuickMatchPanel();
      return;
    }
    const isWhite = val.creatorId === currentUserId;
    setGameMode('friend');
    if (currentMode !== 'friend') return;

    qm.phase = 'playing';
    currentRoomCode = code;
    myOnlineColor = isWhite ? 'w' : 'b';
    friendTimeControl = Number(val.timeControl) || 0;
    friendRoomData = val;
    moveQualityHistory = [];
    redoStack = [];
    game.reset();
    board.orientation(isWhite ? 'white' : 'black');
    board.start();
    lockModeButtons(true);
    resetFriendClockUI();
    try { updateGameReview(); } catch (_) {}
    $id('activeRoomInfo').style.display = 'flex';
    $id('activeRoomCode').textContent = 'Quick';
    updateTimeControlUI();
    qmApplyQuickChrome();
    qmStartPresence(code, isWhite ? val.guestId : val.creatorId);
    listenToRoom(code, isWhite);
    startVoiceChat(code, isWhite);
    updateUI();
  }

  // ---- Presence & disconnect handling for Quick Match rooms ----
  function qmBothPlayersPresent(val) {
    const p = (val && val.presence) || {};
    return !!(val && val.creatorId && val.guestId && p[val.creatorId] && p[val.guestId]);
  }

  function qmStartPresence(code, oppId) {
    const presenceRef = database.ref('rooms/' + code + '/presence/' + currentUserId);
    const connRef = database.ref('.info/connected');
    const room = { code, oppId, enteredAt: Date.now(), presenceRef, oppSeenAt: 0, oppEverSeen: false, ending: false };
    qm.room = room;
    room.connListener = connRef.on('value', s => {
      if (s.val() !== true || qm.room !== room) return;
      presenceRef.onDisconnect().remove().then(() => presenceRef.set(true)).catch(() => {});
    });
    room.presenceListener = database.ref('rooms/' + code + '/presence/' + oppId).on('value', s => {
      if (qm.room !== room) return;
      if (s.val()) { room.oppEverSeen = true; room.oppSeenAt = 0; } else if (room.oppEverSeen && !room.oppSeenAt) { room.oppSeenAt = Date.now(); }
    });
    room.monitor = setInterval(() => qmMonitorRoom(room), 1000);
  }

  function qmSetBanner(text) {
    let el = $id('qmDisconnectBanner');
    const host = $id('activeRoomInfo');
    if (!el && host && text) {
      el = document.createElement('div');
      el.id = 'qmDisconnectBanner';
      el.className = 'qm-disconnect-banner';
      host.appendChild(el);
    }
    if (el) { el.textContent = text || ''; el.style.display = text ? 'block' : 'none'; }
  }

  function qmMonitorRoom(room) {
    if (qm.room !== room) return;
    const val = friendRoomData || {};
    if (val.gameOver || currentRoomCode !== room.code) { qmSetBanner(''); return; }
    const moves = Array.isArray(val.moveHistory) ? val.moveHistory.length : 0;
    if (!room.oppEverSeen) {
      const left = Math.ceil((QM_ABORT_MS - (Date.now() - room.enteredAt)) / 1000);
      qmSetBanner(left > 0 ? `Waiting for your opponent to connect… (${left}s)` : '');
      if (left <= 0 && !room.ending && moves === 0) qmEndRoom(room, 'aborted');
      return;
    }
    if (room.oppSeenAt) {
      const left = Math.ceil((QM_DISCONNECT_MS - (Date.now() - room.oppSeenAt)) / 1000);
      qmSetBanner(left > 0 ? `⚠ Opponent disconnected. They have ${left}s to reconnect.` : '');
      if (left <= 0 && !room.ending) qmEndRoom(room, moves === 0 ? 'aborted' : 'left');
      return;
    }
    qmSetBanner('');
  }

  function qmEndRoom(room, kind) {
    room.ending = true;
    const me = currentUserId;
    database.ref('rooms/' + room.code).transaction(cur => {
      if (!cur || cur.gameOver) return;      // already finished: abort transaction
      if (kind === 'aborted') return Object.assign({}, cur, { gameOver: true, result: 'aborted', winner: null });
      return Object.assign({}, cur, { gameOver: true, result: 'left', leftBy: room.oppId, winner: me });
    }).catch(() => { room.ending = false; });
  }

  // Called by cleanupFriendGame() in script.js. Returns true when the room was a Quick Match.
  function qmOnRoomCleanup() {
    const room = qm.room;
    if (!room) return false;
    qm.room = null;
    clearInterval(room.monitor);
    try { database.ref('.info/connected').off('value', room.connListener); } catch (_) {}
    try { database.ref('rooms/' + room.code + '/presence/' + room.oppId).off('value', room.presenceListener); } catch (_) {}
    try { room.presenceRef.onDisconnect().cancel(); room.presenceRef.remove(); } catch (_) {}
    qmSetBanner('');
    const row = document.querySelector('#friendControls .friend-btn-row');
    if (row) row.style.display = '';
    qm.phase = 'idle';
    qm.match = null;
    setTimeout(renderQuickMatchPanel, 0);
    return true;
  }

  function qmRematch(key) {
    if (qmIsValidKey(key)) { qm.timeKey = key; localStorage.setItem(QM_STORAGE_KEY, key); }
    openQuickMatchPage();
    if (currentMode === 'quick') qmFindOpponent();
  }

  // Leaving the page while searching: best-effort server cancel (the entry also expires by itself).
  window.addEventListener('pagehide', () => {
    if (qm.phase !== 'searching' || !qm.token) return;
    try {
      fetch(`https://${FUNCTIONS_REGION}-${firebaseConfig.projectId}.cloudfunctions.net/quickMatchCancel`, {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + qm.token },
        body: JSON.stringify({ data: {} })
      }).catch(() => {});
    } catch (_) {}
  });

  // =====================================================================
  // 2. BOOKS → OTHER LEARNING MATERIALS (+ ratings)
  // =====================================================================
  const lm = { items: [], loaded: false, error: '', myRatings: {}, ratingsFor: null, pending: {} };

  function safeHttpsUrl(u) {
    try { const url = new URL(String(u || '')); return url.protocol === 'https:' ? url.href : null; } catch (_) { return null; }
  }

  function lmStartListener() {
    fsdb.collection('learningMaterials').where('published', '==', true).onSnapshot(snap => {
      lm.items = snap.docs.map(d => Object.assign({ id: d.id }, d.data()))
        .sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
      lm.loaded = true;
      lm.error = '';
      lmLoadMyRatings();
      renderLearningMaterialsPanel();
    }, err => {
      lm.loaded = true;
      lm.error = 'Learning materials could not be loaded right now.';
      console.warn('Learning materials:', err && err.message);
      renderLearningMaterialsPanel();
    });
  }

  async function lmLoadMyRatings() {
    const uid = auth.currentUser && auth.currentUser.uid;
    if (lm.ratingsFor !== uid) { lm.myRatings = {}; lm.ratingsFor = uid || null; }
    if (!uid) return;
    const missing = lm.items.filter(it => !(it.id in lm.myRatings));
    if (!missing.length) return;
    await Promise.all(missing.map(it => fsdb.collection('learningMaterials').doc(it.id).collection('ratings').doc(uid).get()
      .then(s => { lm.myRatings[it.id] = s.exists ? Number(s.data().rating) || 0 : 0; })
      .catch(() => { lm.myRatings[it.id] = 0; })));
    if (lm.ratingsFor === uid) renderLearningMaterialsPanel();
  }

  function lmStarsHtml(item) {
    const mine = lm.myRatings[item.id] || 0;
    const avg = Number(item.averageRating) || 0;
    const shown = mine || Math.round(avg);
    return `<div class="lm-stars${mine ? ' rated' : ''}" role="radiogroup" aria-label="Rate ${esc(item.title)}">` +
      [1, 2, 3, 4, 5].map(n => `<button type="button" class="lm-star${n <= shown ? ' on' : ''}" data-lm-rate="${n}" data-lm-id="${esc(item.id)}" role="radio" aria-checked="${n === mine}" aria-label="${n} star${n > 1 ? 's' : ''}" ${lm.pending[item.id] ? 'disabled' : ''}>★</button>`).join('') +
      '</div>';
  }

  function renderLearningMaterialsPanel() {
    const el = $id('booksPanelOther');
    if (!el) return;
    if (!lm.loaded) { el.innerHTML = '<div class="books-empty"><div class="waiting-spinner lm-spinner"></div><span>Loading learning materials…</span></div>'; return; }
    if (lm.error && !lm.items.length) { el.innerHTML = `<div class="books-empty"><div class="books-empty-icon">📖</div><strong>Other Learning Materials</strong><span>${esc(lm.error)}</span></div>`; return; }
    if (!lm.items.length) { el.innerHTML = '<div class="books-empty"><div class="books-empty-icon">🎬</div><strong>Other Learning Materials</strong><span>No learning materials yet — new videos will appear here automatically.</span></div>'; return; }

    const signedIn = !!(auth.currentUser);
    el.innerHTML = `<div class="books-count">${lm.items.length} learning material${lm.items.length > 1 ? 's' : ''}</div>
      <div class="lm-grid">` + lm.items.map(item => {
        const url = safeHttpsUrl(item.url);
        const type = String(item.resourceType || 'video').toUpperCase();
        const avg = Number(item.averageRating) || 0;
        const total = Number(item.totalRatings) || 0;
        const mine = lm.myRatings[item.id] || 0;
        const isInsta = url && /(^|\.)instagram\.com$/i.test(new URL(url).hostname);
        return `<article class="lm-card">
          <div class="lm-card-top"><span class="lm-type-badge">${type === 'VIDEO' ? '🎬' : '📄'} ${esc(type)}</span>${isInsta ? '<span class="lm-source">Instagram</span>' : ''}</div>
          <h3 class="lm-title">${esc(item.title || 'Untitled')}</h3>
          ${url ? `<a class="lm-watch-btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${type === 'VIDEO' ? '▶ Watch Video' : '🔗 Open Link'}</a>` : '<span class="lm-watch-btn disabled">Link unavailable</span>'}
          <div class="lm-rating">
            ${lmStarsHtml(item)}
            <div class="lm-rating-summary"><strong>${total ? avg.toFixed(1) : '–'}</strong> <span class="lm-avg-star">★</span> <span>${total} rating${total === 1 ? '' : 's'}</span></div>
            <div class="lm-my-rating">${!signedIn ? 'Sign in to rate' : mine ? `Your rating: ${mine}★ — tap a star to change` : 'Tap a star to rate'}</div>
          </div>
        </article>`;
      }).join('') + '</div>';

    el.querySelectorAll('[data-lm-rate]').forEach(btn => btn.addEventListener('click', () => lmRate(btn.dataset.lmId, Number(btn.dataset.lmRate))));
  }

  async function lmRate(materialId, value) {
    if (!auth.currentUser) { alert('Please Sign in with Google to rate learning materials.'); return triggerGoogleLogin(); }
    if (!requireTermsAccepted()) return;
    if (lm.pending[materialId] || !(value >= 1 && value <= 5)) return;
    const prev = lm.myRatings[materialId] || 0;
    lm.pending[materialId] = true;
    lm.myRatings[materialId] = value;
    renderLearningMaterialsPanel();
    try {
      const res = await call('rateMaterial', { materialId, rating: value });
      const item = lm.items.find(i => i.id === materialId);
      if (item && res) { item.averageRating = res.averageRating; item.totalRatings = res.totalRatings; }
      showFeatureToast(`<strong>★ Thanks!</strong><span>You rated this ${value} star${value > 1 ? 's' : ''}.</span>`, 2200);
    } catch (err) {
      lm.myRatings[materialId] = prev;
      alert('Could not save your rating: ' + friendlyFnError(err));
    } finally {
      delete lm.pending[materialId];
      renderLearningMaterialsPanel();
    }
  }

  auth.onAuthStateChanged(() => { lmLoadMyRatings(); renderLearningMaterialsPanel(); if (currentMode === 'quick') { qm.resume = null; renderQuickMatchPanel(); qmCheckResume(); } });

  // =====================================================================
  // 3. HIDDEN ADMIN PANEL — Phone OTP (separate Firebase app instance, so the
  //    normal Google sign-in of the page is never touched)
  // =====================================================================
  const ADMIN_COUNTRY_CODE = '+91';
  const ADMIN_IDLE_MS = 30 * 60000;          // auto-logout after 30 min without activity
  const OTP_COOLDOWN_MS = 60000;             // one SMS per minute
  const OTP_WINDOW_MS = 15 * 60000;          // max 3 SMS per 15 minutes from this browser
  const OTP_WINDOW_MAX = 3;
  const OTP_LOG_KEY = 'bChessAdminOtpLog';

  const adminApp = firebase.apps.find(a => a.name === 'bchess-admin') || firebase.initializeApp(firebaseConfig, 'bchess-admin');
  const adminAuth = adminApp.auth();
  const adminDb = adminApp.firestore();
  const adminFns = adminApp.functions(FUNCTIONS_REGION);
  const adminCall = (name, data) => adminFns.httpsCallable(name)(data || {}).then(r => r.data);
  adminAuth.setPersistence(firebase.auth.Auth.Persistence.SESSION).catch(() => {});

  const ad = { confirmation: null, verifier: null, verified: false, unsub: null, materials: [], editingId: null, idleTimer: null, resendTimer: null, phoneMasked: '' };

  function adminMsg(id, text, kind) {
    const el = $id(id);
    if (!el) return;
    el.textContent = text || '';
    el.className = 'admin-msg' + (kind ? ' ' + kind : '');
  }

  function isEditableTarget(t) {
    if (!t || t === document.body) return false;
    if (t.isContentEditable) return true;
    const tag = (t.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    return !!(t.closest && t.closest('[contenteditable=""],[contenteditable="true"]'));
  }

  // Desktop: Ctrl + Arrow Up
  document.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
    if (e.key !== 'ArrowUp' && e.code !== 'ArrowUp') return;
    if (e.repeat || isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return;
    e.preventDefault();
    openAdminEntry();
  });

  // Mobile (and desktop): tap the ♟ logo in the header 5 times within 3 seconds.
  (function bindHiddenTap() {
    const icon = document.querySelector('.brand .pawn-icon');
    if (!icon) return;
    let taps = [];
    icon.addEventListener('click', () => {
      const now = Date.now();
      taps = taps.filter(t => now - t < 3000);
      taps.push(now);
      if (taps.length >= 5) { taps = []; openAdminEntry(); }
    });
  })();

  function openAdminEntry() {
    if (adminAuth.currentUser && ad.verified) { verifyAdminAndOpen(); return; }
    openAdminLogin();
  }

  function openAdminLogin() {
    const modal = $id('adminLoginModal');
    if (!modal) return;
    showAdminStep('phone');
    adminMsg('adminLoginMsg', '');
    $id('adminOtpInput').value = '';
    modal.style.display = 'flex';
    setTimeout(() => { const i = $id('adminPhoneInput'); if (i) i.focus(); }, 50);
  }

  function closeAdminLogin() {
    const modal = $id('adminLoginModal');
    if (modal) modal.style.display = 'none';
  }

  function showAdminStep(step) {
    $id('adminStepPhone').style.display = step === 'phone' ? 'block' : 'none';
    $id('adminStepOtp').style.display = step === 'otp' ? 'block' : 'none';
  }

  function resetRecaptcha() {
    try { if (ad.verifier) ad.verifier.clear(); } catch (_) {}
    ad.verifier = null;
    const holder = $id('adminRecaptchaHolder');
    if (holder) holder.innerHTML = '<div id="adminRecaptcha"></div>';
  }

  function getRecaptcha() {
    if (!ad.verifier) ad.verifier = new firebase.auth.RecaptchaVerifier('adminRecaptcha', { size: 'invisible' }, adminApp);
    return ad.verifier;
  }

  function otpLog() {
    try { return (JSON.parse(localStorage.getItem(OTP_LOG_KEY) || '[]') || []).filter(t => Date.now() - t < OTP_WINDOW_MS); } catch (_) { return []; }
  }

  function otpClientLimit() {
    const log = otpLog();
    const last = log.length ? Math.max.apply(null, log) : 0;
    if (Date.now() - last < OTP_COOLDOWN_MS) return 'Please wait ' + Math.ceil((OTP_COOLDOWN_MS - (Date.now() - last)) / 1000) + 's before requesting another OTP.';
    if (log.length >= OTP_WINDOW_MAX) return 'Too many OTP requests. Try again in ' + Math.ceil((OTP_WINDOW_MS - (Date.now() - Math.min.apply(null, log))) / 60000) + ' min.';
    return '';
  }

  function startResendCountdown() {
    const btn = $id('adminResendOtpBtn');
    clearInterval(ad.resendTimer);
    const tick = () => {
      const log = otpLog();
      const last = log.length ? Math.max.apply(null, log) : 0;
      const left = Math.ceil((OTP_COOLDOWN_MS - (Date.now() - last)) / 1000);
      if (left > 0) { btn.disabled = true; btn.textContent = 'Resend OTP in ' + left + 's'; }
      else { btn.disabled = false; btn.textContent = 'Resend OTP'; clearInterval(ad.resendTimer); }
    };
    tick();
    ad.resendTimer = setInterval(tick, 1000);
  }

  function authErrorText(err) {
    const code = (err && err.code) || '';
    const map = {
      'auth/invalid-verification-code': 'Incorrect OTP. Please check the code and try again.',
      'auth/code-expired': 'This OTP has expired. Please request a new one.',
      'auth/session-expired': 'This OTP has expired. Please request a new one.',
      'auth/too-many-requests': 'Too many attempts. Please try again later.',
      'auth/quota-exceeded': 'SMS quota exceeded. Please try again later.',
      'auth/invalid-phone-number': 'Invalid mobile number.',
      'auth/captcha-check-failed': 'reCAPTCHA verification failed. Please try again.',
      'auth/missing-verification-code': 'Please enter the 6-digit OTP.',
      'auth/network-request-failed': 'Network error. Check your connection and try again.',
      'auth/operation-not-allowed': 'Phone sign-in is not enabled for this project.',
      'auth/unauthorized-domain': 'This website domain is not authorised for Firebase sign-in.'
    };
    return map[code] || (err && err.message) || 'Something went wrong. Please try again.';
  }

  async function adminSendOtp() {
    const digits = ($id('adminPhoneInput').value || '').replace(/\D/g, '');
    if (!/^[6-9]\d{9}$/.test(digits)) return adminMsg('adminLoginMsg', 'Enter a valid 10-digit mobile number.', 'error');
    const limited = otpClientLimit();
    if (limited) return adminMsg('adminLoginMsg', limited, 'error');
    const phone = ADMIN_COUNTRY_CODE + digits;
    const sendBtn = $id('adminSendOtpBtn');
    const resendBtn = $id('adminResendOtpBtn');
    sendBtn.disabled = true; resendBtn.disabled = true;
    adminMsg('adminLoginMsg', 'Checking…');
    try {
      // Backend check first: rate limit + authorised number (no SMS is sent to other numbers).
      await adminCall('adminOtpPrecheck', { phoneNumber: phone });
    } catch (err) {
      sendBtn.disabled = false;
      const code = String(err.code || '').replace('functions/', '');
      if (code === 'permission-denied') adminMsg('adminLoginMsg', 'Access Denied – You are not an authorized Admin.', 'error');
      else if (code === 'resource-exhausted') adminMsg('adminLoginMsg', err.message || 'Too many OTP requests. Please try again later.', 'error');
      else adminMsg('adminLoginMsg', friendlyFnError(err, 'Could not send OTP.'), 'error');
      if (ad.confirmation) startResendCountdown();
      return;
    }
    try {
      adminMsg('adminLoginMsg', 'Sending OTP…');
      ad.confirmation = await adminAuth.signInWithPhoneNumber(phone, getRecaptcha());
      const log = otpLog(); log.push(Date.now()); localStorage.setItem(OTP_LOG_KEY, JSON.stringify(log));
      $id('adminOtpSentTo').textContent = 'OTP sent to ' + ADMIN_COUNTRY_CODE + ' ••••••' + digits.slice(-4);
      showAdminStep('otp');
      adminMsg('adminLoginMsg', 'OTP sent. It is valid for a few minutes.', 'success');
      startResendCountdown();
      setTimeout(() => $id('adminOtpInput').focus(), 50);
    } catch (err) {
      adminMsg('adminLoginMsg', authErrorText(err), 'error');
      resetRecaptcha();
      if (ad.confirmation) startResendCountdown();
    } finally {
      sendBtn.disabled = false;
    }
  }

  async function adminVerifyOtp() {
    const code = ($id('adminOtpInput').value || '').replace(/\D/g, '');
    if (!/^\d{6}$/.test(code)) return adminMsg('adminLoginMsg', 'Please enter the 6-digit OTP.', 'error');
    if (!ad.confirmation) return adminMsg('adminLoginMsg', 'Please request an OTP first.', 'error');
    const btn = $id('adminVerifyOtpBtn');
    btn.disabled = true;
    adminMsg('adminLoginMsg', 'Verifying…');
    try {
      await ad.confirmation.confirm(code);
    } catch (err) {
      btn.disabled = false;
      adminMsg('adminLoginMsg', authErrorText(err), 'error');
      if (/expired/.test(err.code || '')) { ad.confirmation = null; resetRecaptcha(); }
      return;
    }
    ad.confirmation = null;
    resetRecaptcha();
    await verifyAdminAndOpen(true);
    btn.disabled = false;
  }

  // Trusted check on the backend (custom claim + phone + admins/{uid} record + not revoked).
  async function verifyAdminAndOpen(fromLogin) {
    try {
      if (!adminAuth.currentUser) throw Object.assign(new Error('no user'), { code: 'unauthenticated' });
      await adminAuth.currentUser.getIdToken(true);
      const res = await adminCall('adminVerifySession', {});
      if (!res || res.admin !== true) throw Object.assign(new Error('denied'), { code: 'permission-denied' });
      ad.verified = true;
      ad.phoneMasked = res.phoneMasked || '';
      closeAdminLogin();
      openAdminDashboard();
    } catch (err) {
      const code = String(err.code || '').replace('functions/', '');
      ad.verified = false;
      try { await adminAuth.signOut(); } catch (_) {}
      closeAdminDashboard();
      openAdminLogin();
      if (code === 'permission-denied') adminMsg('adminLoginMsg', 'Access Denied – You are not an authorized Admin.', 'error');
      else if (code === 'unauthenticated') adminMsg('adminLoginMsg', fromLogin ? 'Verification failed. Please try again.' : 'Your admin session has ended. Please verify OTP again.', 'error');
      else adminMsg('adminLoginMsg', friendlyFnError(err, 'Could not verify admin access.'), 'error');
    }
  }

  // ---- Dashboard ----
  function openAdminDashboard() {
    if (!ad.verified || !adminAuth.currentUser) return openAdminLogin();
    $id('adminDashPhone').textContent = ad.phoneMasked ? '🔐 ' + ad.phoneMasked : '🔐 Admin';
    $id('adminDashboard').style.display = 'flex';
    adminResetForm();
    adminStartListener();
    adminBumpIdle();
  }

  function closeAdminDashboard() {
    const dash = $id('adminDashboard');
    if (dash) dash.style.display = 'none';
    if (ad.unsub) { try { ad.unsub(); } catch (_) {} ad.unsub = null; }
    ad.materials = [];
    const list = $id('adminMaterialsList'); if (list) list.innerHTML = '';
    clearTimeout(ad.idleTimer);
  }

  function adminBumpIdle() {
    clearTimeout(ad.idleTimer);
    if (!ad.verified) return;
    ad.idleTimer = setTimeout(() => adminLogout('Logged out after 30 minutes of inactivity.'), ADMIN_IDLE_MS);
  }

  async function adminLogout(reason) {
    try { if (adminAuth.currentUser) await adminCall('adminLogout', {}); } catch (_) {}
    try { await adminAuth.signOut(); } catch (_) {}
    ad.verified = false;
    closeAdminDashboard();
    showFeatureToast(`<strong>🔒 Admin logged out</strong><span>${esc(reason || 'OTP verification is required for a new session.')}</span>`, 3500);
  }

  function adminHandleOpError(err) {
    const code = String(err.code || '').replace('functions/', '');
    if (code === 'unauthenticated' || code === 'permission-denied') {
      ad.verified = false;
      adminAuth.signOut().catch(() => {});
      closeAdminDashboard();
      openAdminLogin();
      adminMsg('adminLoginMsg', code === 'permission-denied' ? 'Access Denied – You are not an authorized Admin.' : 'Your admin session has expired. Please verify OTP again.', 'error');
      return true;
    }
    return false;
  }

  adminAuth.onAuthStateChanged(user => {
    if (!user && ad.verified) { ad.verified = false; closeAdminDashboard(); }
  });

  function adminStartListener() {
    if (ad.unsub) return;
    ad.unsub = adminDb.collection('learningMaterials').onSnapshot(snap => {
      ad.materials = snap.docs.map(d => Object.assign({ id: d.id }, d.data())).sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
      renderAdminList();
    }, err => {
      if (!adminHandleOpError({ code: err.code === 'permission-denied' ? 'permission-denied' : err.code })) {
        $id('adminMaterialsList').innerHTML = `<div class="friend-empty">Could not load materials: ${esc(err.message)}</div>`;
      }
    });
  }

  function renderAdminList() {
    const list = $id('adminMaterialsList');
    if (!list) return;
    const q = ($id('adminMatFilter').value || '').trim().toLowerCase();
    const items = ad.materials.filter(m => !q || String(m.title || '').toLowerCase().includes(q));
    const published = ad.materials.filter(m => m.published).length;
    $id('adminStats').innerHTML = `<div><strong>${ad.materials.length}</strong><span>Total</span></div><div><strong>${published}</strong><span>Published</span></div><div><strong>${ad.materials.length - published}</strong><span>Unpublished</span></div>`;
    if (!items.length) { list.innerHTML = `<div class="friend-empty">${ad.materials.length ? 'No materials match your search.' : 'No learning materials yet. Add the first one above.'}</div>`; return; }
    list.innerHTML = items.map(m => {
      const url = safeHttpsUrl(m.url);
      const total = Number(m.totalRatings) || 0;
      return `<div class="admin-mat-row${ad.editingId === m.id ? ' editing' : ''}">
        <div class="admin-mat-info">
          <div class="admin-mat-title"><strong>${esc(m.title)}</strong><span class="admin-badge ${m.published ? 'pub' : 'draft'}">${m.published ? 'Published' : 'Unpublished'}</span><span class="lm-type-badge">${esc(String(m.resourceType || 'video').toUpperCase())}</span></div>
          ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" class="admin-mat-url">${esc(url)}</a>` : '<span class="admin-mat-url">Invalid URL</span>'}
          <small>★ ${total ? (Number(m.averageRating) || 0).toFixed(1) : '–'} • ${total} rating${total === 1 ? '' : 's'}${m.createdAt ? ' • Added ' + esc(new Date(tsMillis(m.createdAt)).toLocaleDateString()) : ''}</small>
        </div>
        <div class="admin-mat-actions">
          <button type="button" class="pill-btn" data-admin-edit="${esc(m.id)}">✏️ Edit</button>
          <button type="button" class="pill-btn ${m.published ? '' : 'highlight-btn'}" data-admin-pub="${esc(m.id)}" data-pub="${m.published ? '0' : '1'}">${m.published ? '🙈 Unpublish' : '📢 Publish'}</button>
          <button type="button" class="pill-btn resign-danger-btn" data-admin-del="${esc(m.id)}">🗑 Delete</button>
        </div>
      </div>`;
    }).join('');
    list.querySelectorAll('[data-admin-edit]').forEach(b => b.addEventListener('click', () => adminEdit(b.dataset.adminEdit)));
    list.querySelectorAll('[data-admin-pub]').forEach(b => b.addEventListener('click', () => adminSetPublished(b.dataset.adminPub, b.dataset.pub === '1', b)));
    list.querySelectorAll('[data-admin-del]').forEach(b => b.addEventListener('click', () => adminDelete(b.dataset.adminDel, b)));
  }

  function adminResetForm() {
    ad.editingId = null;
    $id('adminMatTitle').value = '';
    $id('adminMatUrl').value = '';
    $id('adminMatType').value = 'video';
    $id('adminMatPublished').checked = true;
    $id('adminFormTitle').textContent = 'Add New Learning Material';
    $id('adminSaveBtn').textContent = '💾 Save';
    $id('adminCancelEditBtn').style.display = 'none';
    adminMsg('adminFormMsg', '');
    renderAdminList();
  }

  function adminEdit(id) {
    const m = ad.materials.find(x => x.id === id);
    if (!m) return;
    ad.editingId = id;
    $id('adminMatTitle').value = m.title || '';
    $id('adminMatUrl').value = m.url || '';
    $id('adminMatType').value = m.resourceType || 'video';
    $id('adminMatPublished').checked = !!m.published;
    $id('adminFormTitle').textContent = 'Edit Learning Material';
    $id('adminSaveBtn').textContent = '💾 Save Changes';
    $id('adminCancelEditBtn').style.display = '';
    adminMsg('adminFormMsg', '');
    renderAdminList();
    $id('adminMaterialForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $id('adminMatTitle').focus();
  }

  function validateMaterialForm() {
    const title = ($id('adminMatTitle').value || '').trim().replace(/\s+/g, ' ');
    const rawUrl = ($id('adminMatUrl').value || '').trim();
    const resourceType = $id('adminMatType').value;
    if (title.length < 2) return { error: 'Please enter a title (at least 2 characters).' };
    if (title.length > 120) return { error: 'Title must be 120 characters or fewer.' };
    const url = safeHttpsUrl(rawUrl);
    if (!url) return { error: 'Please enter a valid URL starting with https:// (for example an Instagram video link).' };
    if (url.length > 500) return { error: 'URL is too long.' };
    if (resourceType !== 'video') return { error: 'Please choose a resource type.' };
    return { title, url, resourceType, published: $id('adminMatPublished').checked };
  }

  async function adminSave(e) {
    if (e) e.preventDefault();
    adminBumpIdle();
    const v = validateMaterialForm();
    if (v.error) return adminMsg('adminFormMsg', v.error, 'error');
    const btn = $id('adminSaveBtn');
    btn.disabled = true;
    adminMsg('adminFormMsg', 'Saving…');
    try {
      await adminCall('adminSaveMaterial', Object.assign({ id: ad.editingId || null }, v));
      const wasEdit = !!ad.editingId;
      adminResetForm();
      adminMsg('adminFormMsg', wasEdit ? '✓ Changes saved.' : (v.published ? '✓ Saved and published under Books → Other Learning Materials.' : '✓ Saved (unpublished).'), 'success');
    } catch (err) {
      if (!adminHandleOpError(err)) adminMsg('adminFormMsg', friendlyFnError(err, 'Could not save.'), 'error');
    } finally {
      btn.disabled = false;
    }
  }

  async function adminSetPublished(id, published, btn) {
    adminBumpIdle();
    if (btn) btn.disabled = true;
    try { await adminCall('adminSetPublished', { id, published }); }
    catch (err) { if (!adminHandleOpError(err)) alert(friendlyFnError(err, 'Could not update.')); }
    finally { if (btn) btn.disabled = false; }
  }

  async function adminDelete(id, btn) {
    adminBumpIdle();
    const m = ad.materials.find(x => x.id === id);
    if (!confirm('Delete "' + (m ? m.title : 'this material') + '"? Its ratings are deleted too. This cannot be undone.')) return;
    if (btn) btn.disabled = true;
    try {
      await adminCall('adminDeleteMaterial', { id });
      if (ad.editingId === id) adminResetForm();
    } catch (err) { if (!adminHandleOpError(err)) alert(friendlyFnError(err, 'Could not delete.')); }
    finally { if (btn) btn.disabled = false; }
  }

  // ---- Wiring ----
  function wire() {
    const bind = (id, ev, fn) => { const el = $id(id); if (el) el.addEventListener(ev, fn); };
    bind('modeQuickBtn', 'click', openQuickMatchPage);
    bind('modeBooksBtn', 'click', renderLearningMaterialsPanel);

    bind('adminSendOtpBtn', 'click', adminSendOtp);
    bind('adminResendOtpBtn', 'click', adminSendOtp);
    bind('adminVerifyOtpBtn', 'click', adminVerifyOtp);
    bind('adminPhoneInput', 'keydown', e => { if (e.key === 'Enter') adminSendOtp(); });
    bind('adminPhoneInput', 'input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10); });
    bind('adminOtpInput', 'input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); });
    bind('adminOtpInput', 'keydown', e => { if (e.key === 'Enter') adminVerifyOtp(); });
    bind('adminChangeNumberBtn', 'click', () => { ad.confirmation = null; showAdminStep('phone'); adminMsg('adminLoginMsg', ''); });
    bind('adminLoginCloseX', 'click', closeAdminLogin);
    bind('adminLogoutBtn', 'click', () => adminLogout());
    bind('adminMaterialForm', 'submit', adminSave);
    bind('adminCancelEditBtn', 'click', adminResetForm);
    bind('adminMatFilter', 'input', renderAdminList);
    const dash = $id('adminDashboard');
    if (dash) ['click', 'keydown', 'input'].forEach(ev => dash.addEventListener(ev, adminBumpIdle));
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      const login = $id('adminLoginModal');
      if (login && login.style.display !== 'none') closeAdminLogin();
    });

    renderQuickMatchPanel();
    lmStartListener();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();

  // Hooks used by script.js
  window.openQuickMatchPage = openQuickMatchPage;
  window.qmBothPlayersPresent = qmBothPlayersPresent;
  window.qmOnRoomCleanup = qmOnRoomCleanup;
  window.qmRematch = qmRematch;
  window.renderLearningMaterialsPanel = renderLearningMaterialsPanel;
})();
