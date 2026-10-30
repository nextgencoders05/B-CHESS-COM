// B Chess Analyzer — Multiplayer (Firebase) + WebRTC Live Voice Chat (PeerJS) + Stockfish

// 1. FIREBASE CONFIGURATION (Direct from Project Setup)
const firebaseConfig = {
  apiKey: "AIzaSyDy0akMUtzmPjg9Z8ebyFWtmT4mc9bRHG0",
  authDomain: "b--chess-analyser.firebaseapp.com",
  databaseURL: "https://b--chess-analyser-default-rtdb.firebaseio.com",
  projectId: "b--chess-analyser",
  storageBucket: "b--chess-analyser.firebasestorage.app",
  messagingSenderId: "492429152963",
  appId: "1:492429152963:web:21592594d7f4a145340876",
  measurementId: "G-Y0EFN2WYE8"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const database = firebase.database();

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

// Game Modes: 'analysis' | 'bot' | 'friend'
let currentMode = 'analysis';
let playerColor = 'w';
let botRating = 1400;
let isBotThinking = false;

// Multiplayer State
let currentRoomId = null;
let myRole = null; // 'w' | 'b' | 'spectator'
let roomListener = null;

// Voice Chat (PeerJS WebRTC) State
let peer = null;
let localStream = null;
let voiceCall = null;
let isMicMuted = false;

// Audio Synthesizer (Realistic Wooden Acoustic Multi-layered Audio)
let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) audioCtx = new AudioContext();
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

// Move Quality & Blunder Tracking Engine
let moveQualityHistory = [];
let pendingEvalMoveIndex = null;
let currentPositionCp = 0;

const BOT_PROFILES = {
  800:  { skill: 0,  depth: 1,  moveTime: 300, blunderRate: 0.35 },
  1100: { skill: 3,  depth: 2,  moveTime: 400, blunderRate: 0.18 },
  1400: { skill: 6,  depth: 4,  moveTime: 500, blunderRate: 0.06 },
  1700: { skill: 10, depth: 7,  moveTime: 650, blunderRate: 0.01 },
  2000: { skill: 15, depth: 10, moveTime: 800, blunderRate: 0.00 },
  2500: { skill: 20, depth: 14, moveTime: 1000, blunderRate: 0.00 }
};

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

// 2. Initialize Stockfish Engine
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

function resolveMoveQuality(index, evalAfter) {
  const item = moveQualityHistory[index];
  if (!item) return;

  item.evalAfter = evalAfter;
  const evalBefore = item.evalBefore;

  let diff = 0;
  if (item.color === 'w') {
    diff = evalBefore - evalAfter;
  } else {
    diff = evalAfter - evalBefore;
  }

  let quality = 'good';
  if (diff >= 200) {
    quality = 'blunder';
  } else if (diff >= 90) {
    quality = 'mistake';
  } else if (diff >= 40) {
    quality = 'inaccuracy';
  } else if (diff <= 15) {
    quality = 'best';
  } else {
    quality = 'good';
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

  if (!showBestMoveArrow || currentMode !== 'analysis' || !uci || uci.length < 4 || game.game_over()) {
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

  // Analysis mode: allow either side
  if (currentMode === 'analysis') {
    if ((game.turn() === 'w' && piece.search(/^b/) !== -1) ||
        (game.turn() === 'b' && piece.search(/^w/) !== -1)) {
      return false;
    }
  }

  // Bot mode: allow only playerColor
  if (currentMode === 'bot' && game.turn() !== playerColor) {
    return false;
  }

  // Friend / Multiplayer mode: allow only assigned role
  if (currentMode === 'friend') {
    if (myRole !== 'w' && myRole !== 'b') return false;
    if (game.turn() !== myRole) return false;
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

  if (currentMode === 'friend' && currentRoomId) {
    pushMoveToFirebase(move);
  } else if (currentMode === 'bot') {
    checkBotTrigger();
  }
}

function onSnapEnd() {
  board.position(game.fen());
}

// Universal Click & Touch handler for mobile & desktop
function handleSquareClick(square) {
  if (game.game_over() || isBotThinking) return;

  if (selectedSquare) {
    const clickedPiece = game.get(square);
    const activeSide = game.turn();

    if (clickedPiece && clickedPiece.color === activeSide) {
      if (currentMode === 'bot' && clickedPiece.color !== playerColor) return;
      if (currentMode === 'friend' && clickedPiece.color !== myRole) return;

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

      if (currentMode === 'friend' && currentRoomId) {
        pushMoveToFirebase(move);
      } else if (currentMode === 'bot') {
        checkBotTrigger();
      }
      return;
    }
  }

  const piece = game.get(square);
  if (!piece) return;

  if (piece.color !== game.turn()) return;
  if (currentMode === 'bot' && piece.color !== playerColor) return;
  if (currentMode === 'friend' && piece.color !== myRole) return;

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
    quality: '...',
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

  const capturedFromBlack = [];
  ['q', 'r', 'b', 'n', 'p'].forEach(type => {
    const diff = startingCounts.b[type] - currentCounts.b[type];
    for (let i = 0; i < diff; i++) {
      capturedFromBlack.push({ color: 'b', type: type });
    }
  });

  const capturedFromWhite = [];
  ['q', 'r', 'b', 'n', 'p'].forEach(type => {
    const diff = startingCounts.w[type] - currentCounts.w[type];
    for (let i = 0; i < diff; i++) {
      capturedFromWhite.push({ color: 'w', type: type });
    }
  });

  const diffMaterial = whiteMaterial - blackMaterial;
  const isFlipped = board && board.orientation() === 'black';

  const topList = isFlipped ? capturedFromBlack : capturedFromWhite;
  const bottomList = isFlipped ? capturedFromWhite : capturedFromBlack;

  const topName = isFlipped ? 'White' : 'Black';
  const bottomName = isFlipped ? 'Black' : 'White';

  document.getElementById('topPlayerName').textContent = topName;
  document.getElementById('bottomPlayerName').textContent = bottomName;

  document.getElementById('topCapturedBar').querySelector('.player-dot').className = `player-dot ${isFlipped ? 'white-dot' : 'black-dot'}`;
  document.getElementById('bottomCapturedBar').querySelector('.player-dot').className = `player-dot ${isFlipped ? 'black-dot' : 'white-dot'}`;

  document.getElementById('topCapturedPieces').innerHTML = topList.map(p =>
    `<img src="${PIECE_IMAGES[p.color][p.type]}" class="captured-img" alt="${p.type}" />`
  ).join('');

  document.getElementById('bottomCapturedPieces').innerHTML = bottomList.map(p =>
    `<img src="${PIECE_IMAGES[p.color][p.type]}" class="captured-img" alt="${p.type}" />`
  ).join('');

  const topAdvEl = document.getElementById('topMaterialAdv');
  const bottomAdvEl = document.getElementById('bottomMaterialAdv');

  topAdvEl.textContent = '';
  bottomAdvEl.textContent = '';

  if (diffMaterial > 0) {
    if (isFlipped) topAdvEl.textContent = `+${diffMaterial}`;
    else bottomAdvEl.textContent = `+${diffMaterial}`;
  } else if (diffMaterial < 0) {
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
    summaryEl.textContent = `Caution: ${counts.blunder} blunder(s) and ${counts.mistake} mistake(s) occurred. Check badges in the Move List.`;
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

// 3. MULTIPLAYER ROOM & FIREBASE LOGIC
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function createMultiplayerRoom() {
  const roomId = generateRoomCode();
  currentRoomId = roomId;
  myRole = 'w'; // Creator plays White

  board.orientation('white');
  game.reset();
  redoStack = [];
  moveQualityHistory = [];

  const roomRef = database.ref('rooms/' + roomId);
  roomRef.set({
    fen: game.fen(),
    lastMove: null,
    whiteConnected: true,
    blackConnected: false,
    createdAt: firebase.database.ServerValue.TIMESTAMP
  });

  setupRoomUI(roomId, 'White (Host)');
  listenToRoom(roomId);
  initVoicePeer(roomId, 'host');
}

function joinMultiplayerRoom(roomId) {
  roomId = roomId.trim().toUpperCase();
  if (!roomId || roomId.length !== 6) {
    alert('Please enter a valid 6-character room code!');
    return;
  }

  const roomRef = database.ref('rooms/' + roomId);
  roomRef.once('value').then(snapshot => {
    if (!snapshot.exists()) {
      alert('Room not found! Check the room code.');
      return;
    }

    const data = snapshot.val();
    currentRoomId = roomId;

    if (!data.blackConnected) {
      myRole = 'b'; // Joiner plays Black
      board.orientation('black');
      roomRef.update({ blackConnected: true });
      setupRoomUI(roomId, 'Black (Guest)');
    } else {
      myRole = 'spectator';
      setupRoomUI(roomId, 'Spectator');
    }

    if (data.fen) {
      game.load(data.fen);
      board.position(data.fen);
      updateUI();
    }

    listenToRoom(roomId);
    initVoicePeer(roomId, 'guest');
  });
}

function setupRoomUI(roomId, roleText) {
  document.getElementById('activeRoomBar').style.display = 'flex';
  document.getElementById('currentRoomCode').textContent = roomId;
  document.getElementById('playerRoleBadge').textContent = `You: ${roleText}`;
  document.getElementById('voiceControlBar').style.display = 'flex';

  // Update URL parameter so player can easily share
  const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?room=' + roomId;
  window.history.replaceState({ path: newUrl }, '', newUrl);
}

function listenToRoom(roomId) {
  if (roomListener) database.ref('rooms/' + currentRoomId).off('value', roomListener);

  const roomRef = database.ref('rooms/' + roomId);
  roomListener = roomRef.on('value', snapshot => {
    if (!snapshot.exists()) return;
    const data = snapshot.val();

    // Check opponent connection status
    const oppBadge = document.getElementById('opponentStatusBadge');
    if (myRole === 'w') {
      oppBadge.textContent = data.blackConnected ? 'Opponent: Connected (Black)' : 'Opponent: Waiting...';
      oppBadge.style.color = data.blackConnected ? '#4ade80' : '#facc15';
    } else if (myRole === 'b') {
      oppBadge.textContent = data.whiteConnected ? 'Opponent: Connected (White)' : 'Opponent: Disconnected';
      oppBadge.style.color = data.whiteConnected ? '#4ade80' : '#ef4444';
    }

    // Sync incoming moves from opponent
    if (data.lastMove && data.lastMove.by !== myRole) {
      const move = game.move({
        from: data.lastMove.from,
        to: data.lastMove.to,
        promotion: data.lastMove.promotion || 'q'
      });

      if (move) {
        board.position(game.fen());
        handleMoveEffects(move);
        updateUI();
      }
    }
  });
}

function pushMoveToFirebase(move) {
  if (!currentRoomId) return;
  database.ref('rooms/' + currentRoomId).update({
    fen: game.fen(),
    lastMove: {
      by: myRole,
      from: move.from,
      to: move.to,
      promotion: move.promotion || 'q',
      san: move.san
    }
  });
}

// 4. WEBRTC LIVE VOICE CHAT ENGINE (PeerJS)
function initVoicePeer(roomId, role) {
  const peerId = `bchess-${roomId.toLowerCase()}-${role}`;

  if (peer) {
    try { peer.destroy(); } catch (e) {}
  }

  peer = new Peer(peerId, {
    debug: 1
  });

  peer.on('open', id => {
    document.getElementById('voiceStatusText').textContent = 'Voice ready. Click Start Voice.';
  });

  // Listen for incoming voice call from opponent
  peer.on('call', incomingCall => {
    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then(stream => {
        localStream = stream;
        incomingCall.answer(stream);
        setupVoiceCallEvents(incomingCall);
        document.getElementById('startVoiceBtn').style.display = 'none';
        document.getElementById('toggleMuteBtn').style.display = 'inline-block';
        document.getElementById('voiceStatusText').textContent = '🟢 Voice Connected!';
      })
      .catch(err => {
        alert('Microphone permission required for voice chat!');
        console.warn(err);
      });
  });

  peer.on('error', err => {
    console.warn('PeerJS error:', err);
  });
}

function startVoiceCall() {
  if (!peer || !currentRoomId) {
    alert('Please create or join a room first!');
    return;
  }

  document.getElementById('voiceStatusText').textContent = 'Requesting mic...';

  navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    .then(stream => {
      localStream = stream;
      const targetRole = myRole === 'w' ? 'guest' : 'host';
      const targetPeerId = `bchess-${currentRoomId.toLowerCase()}-${targetRole}`;

      document.getElementById('voiceStatusText').textContent = 'Calling opponent...';
      const call = peer.call(targetPeerId, stream);
      setupVoiceCallEvents(call);

      document.getElementById('startVoiceBtn').style.display = 'none';
      document.getElementById('toggleMuteBtn').style.display = 'inline-block';
    })
    .catch(err => {
      alert('Could not access microphone! Please check browser permissions.');
      document.getElementById('voiceStatusText').textContent = 'Mic access denied.';
    });
}

function setupVoiceCallEvents(call) {
  voiceCall = call;

  call.on('stream', remoteStream => {
    const remoteAudio = document.getElementById('remoteAudio');
    remoteAudio.srcObject = remoteStream;
    document.getElementById('voiceStatusText').textContent = '🟢 In Call with Opponent';
  });

  call.on('close', () => {
    document.getElementById('voiceStatusText').textContent = 'Voice chat ended.';
    document.getElementById('startVoiceBtn').style.display = 'inline-block';
    document.getElementById('toggleMuteBtn').style.display = 'none';
  });

  call.on('error', err => {
    console.warn('Voice call error:', err);
    document.getElementById('voiceStatusText').textContent = 'Call error.';
  });
}

function toggleMicrophoneMute() {
  if (!localStream) return;
  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) {
    isMicMuted = !isMicMuted;
    audioTrack.enabled = !isMicMuted;
    const btn = document.getElementById('toggleMuteBtn');
    btn.textContent = isMicMuted ? '🔇 Mic: MUTED' : '🎤 Mic: ON';
    btn.classList.toggle('muted', isMicMuted);
  }
}

// Mode Switcher
function setGameMode(mode) {
  currentMode = mode;
  selectedSquare = null;
  clearClickHighlights();

  document.getElementById('modeAnalyzeBtn').classList.toggle('active', mode === 'analysis');
  document.getElementById('modeBotBtn').classList.toggle('active', mode === 'bot');
  document.getElementById('modeFriendBtn').classList.toggle('active', mode === 'friend');

  document.getElementById('botControls').style.display = (mode === 'bot') ? 'flex' : 'none';
  document.getElementById('friendControls').style.display = (mode === 'friend') ? 'flex' : 'none';

  if (mode === 'friend') {
    document.getElementById('playBestBtn').style.display = 'none';
    document.getElementById('panelPrimaryLabel').textContent = 'Match Status';
    document.getElementById('bestMoveArrow').setAttribute('visibility', 'hidden');
    clearHighlights();
  } else if (mode === 'bot') {
    document.getElementById('playBestBtn').style.display = 'none';
    document.getElementById('panelPrimaryLabel').textContent = 'Bot Status';
    document.getElementById('bestMoveArrow').setAttribute('visibility', 'hidden');
    clearHighlights();
  } else {
    document.getElementById('playBestBtn').style.display = 'block';
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
    alert('Analysis report copied to clipboard!');
  });
}


// --- FIREBASE AUTHENTICATION & USER PROFILE ---
const auth = firebase.auth();
const googleProvider = new firebase.auth.GoogleAuthProvider();
let currentUser = null;
let currentProfile = null;

function setupAuth() {
  const loginBtn = document.getElementById('googleLoginBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const userProfileDiv = document.getElementById('userProfile');
  const userNameSpan = document.getElementById('userName');
  const userAvatarImg = document.getElementById('userAvatar');
  const userIdSpan = document.getElementById('userUniqueId');

  if (loginBtn) {
    loginBtn.addEventListener('click', () => {
      auth.signInWithPopup(googleProvider).catch(err => {
        console.error('Google Sign-in Error:', err);
        alert('Google Sign-in Error: ' + err.message);
      });
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      auth.signOut();
    });
  }

  auth.onAuthStateChanged(user => {
    currentUser = user;
    if (user) {
      const userRef = database.ref('users/' + user.uid);
      userRef.once('value').then(snapshot => {
        let profile = snapshot.val();
        if (!profile) {
          const randomTag = 'BC-' + Math.floor(1000 + Math.random() * 9000);
          profile = {
            uid: user.uid,
            name: user.displayName || 'Chess Player',
            email: user.email,
            photoURL: user.photoURL || '',
            tag: randomTag,
            createdAt: Date.now()
          };
          userRef.set(profile);
        }
        currentProfile = profile;
        if (loginBtn) loginBtn.style.display = 'none';
        if (userProfileDiv) userProfileDiv.style.display = 'flex';
        if (userNameSpan) userNameSpan.textContent = profile.name;
        if (userAvatarImg) userAvatarImg.src = profile.photoURL || 'https://chessboardjs.com/img/chesspieces/wikipedia/wP.png';
        if (userIdSpan) userIdSpan.textContent = profile.tag;
      });
    } else {
      currentProfile = null;
      if (loginBtn) loginBtn.style.display = 'inline-block';
      if (userProfileDiv) userProfileDiv.style.display = 'none';
    }
  });
}

$(document).ready(function() {
  setupAuth();

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

  // Mode Selection Listeners
  document.getElementById('modeAnalyzeBtn').addEventListener('click', () => setGameMode('analysis'));
  document.getElementById('modeBotBtn').addEventListener('click', () => {
    setGameMode('bot');
    startNewBotGame();
  });
  document.getElementById('modeFriendBtn').addEventListener('click', () => setGameMode('friend'));

  // Bot Listeners
  document.getElementById('startBotGameBtn').addEventListener('click', startNewBotGame);
  document.getElementById('botRatingSelect').addEventListener('change', (e) => {
    botRating = parseInt(e.target.value, 10);
  });

  // Friend / Multiplayer Listeners
  document.getElementById('createRoomBtn').addEventListener('click', createMultiplayerRoom);
  document.getElementById('joinRoomBtn').addEventListener('click', () => {
    const code = document.getElementById('joinRoomInput').value;
    joinMultiplayerRoom(code);
  });

  document.getElementById('copyInviteLinkBtn').addEventListener('click', () => {
    const inviteUrl = window.location.href;
    navigator.clipboard.writeText(inviteUrl).then(() => {
      alert('Invite link copied! Send it to your friend.');
    });
  });

  // Voice Chat Listeners
  document.getElementById('startVoiceBtn').addEventListener('click', startVoiceCall);
  document.getElementById('toggleMuteBtn').addEventListener('click', toggleMicrophoneMute);

  // Auto-join if URL has ?room=XXXXXX
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  if (roomParam) {
    setGameMode('friend');
    document.getElementById('joinRoomInput').value = roomParam;
    joinMultiplayerRoom(roomParam);
  }

  // Sound Toggle Button
  document.getElementById('soundToggleBtn').addEventListener('click', (e) => {
    soundEnabled = !soundEnabled;
    e.target.textContent = soundEnabled ? '🔊 Sound: ON' : '🔇 Sound: OFF';
    e.target.classList.toggle('active-pill', soundEnabled);
    if (soundEnabled) playSound('move');
  });

  // Copy Analysis Button
  document.getElementById('copyAnalysisBtn').addEventListener('click', copyFullAnalysisReport);

  // Controls
  document.getElementById('undoBtn').addEventListener('click', () => {
    if (currentMode === 'friend') {
      alert('Undo is disabled in live online multiplayer games!');
      return;
    }
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

  document.getElementById('redoBtn').addEventListener('click', () => {
    if (currentMode !== 'analysis') return;
    clearClickHighlights();
    selectedSquare = null;
    if (redoStack.length > 0) {
      const move = redoStack.pop();
      game.move(move);
      board.position(game.fen());
      updateUI();
    }
  });

  document.getElementById('flipBtn').addEventListener('click', () => {
    board.flip();
    updateCapturedPiecesDisplay();
    if (currentBestMoveUci && currentMode === 'analysis') {
      drawBestMoveArrow(currentBestMoveUci);
    }
  });

  document.getElementById('playBestBtn').addEventListener('click', () => {
    if (currentMode !== 'analysis' || !currentBestMoveUci || game.game_over()) return;
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

  document.getElementById('resetBtn').addEventListener('click', () => {
    clearClickHighlights();
    selectedSquare = null;
    moveQualityHistory = [];
    if (currentMode === 'bot') {
      startNewBotGame();
    } else if (currentMode === 'friend') {
      if (currentRoomId && confirm('Reset current multiplayer game?')) {
        game.reset();
        board.start();
        database.ref('rooms/' + currentRoomId).update({
          fen: game.fen(),
          lastMove: null
        });
        updateUI();
      }
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

  document.getElementById('arrowToggleBtn').addEventListener('click', (e) => {
    showBestMoveArrow = !showBestMoveArrow;
    e.target.textContent = showBestMoveArrow ? '🏹 Arrow: ON' : '🏹 Arrow: OFF';
    e.target.classList.toggle('active-pill', showBestMoveArrow);
    if (currentBestMoveUci && currentMode === 'analysis') {
      drawBestMoveArrow(currentBestMoveUci);
    }
  });

  document.getElementById('themeBtn').addEventListener('click', (e) => {
    document.body.classList.toggle('wood-theme');
    const isWood = document.body.classList.contains('wood-theme');
    e.target.textContent = isWood ? 'Wood & Cream' : 'Green & White';
  });

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

  document.querySelectorAll('.tab').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active-content'));
      tabBtn.classList.add('active');
      const targetId = tabBtn.getAttribute('data-tab');
      document.getElementById(targetId).classList.add('active-content');
    });
  });

  document.getElementById('depthSlider').addEventListener('input', (e) => {
    targetDepth = parseInt(e.target.value, 10);
    document.getElementById('depthSliderVal').textContent = targetDepth;
    if (currentMode === 'analysis') {
      analyzePosition();
    }
  });
});
