// XSS protection — escape all dynamic text before DOM insertion
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Deterministic Fisher-Yates shuffle using LCG PRNG
// All clients with the same seed produce the same order
function seededShuffle(array, seed) {
  const arr = [...array];
  let s = seed >>> 0; // ensure unsigned 32-bit
  function lcg() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  }
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(lcg() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Create an index mapping: shuffled position -> original index
function createShuffleMap(length, seed) {
  const indices = Array.from({ length }, (_, i) => i);
  return seededShuffle(indices, seed);
}

// Calculate remaining seconds from a started_at timestamp and timer duration
function getRemainingSeconds(startedAt, timerSec) {
  const start = new Date(startedAt).getTime();
  const now = Date.now();
  const elapsed = (now - start) / 1000;
  return Math.max(0, timerSec - elapsed);
}

// Calculate response time in ms from started_at
function getResponseTimeMs(startedAt) {
  const start = new Date(startedAt).getTime();
  return Date.now() - start;
}

// Calculate score for a correct answer based on response time
function calculateScore(responseTimeMs, timerMs) {
  if (responseTimeMs > timerMs) return 0;
  const speedBonus = Math.max(0, 500 - Math.floor(responseTimeMs / 40));
  return 1000 + speedBonus;
}

// Format milliseconds to readable time
function formatTime(ms) {
  return (ms / 1000).toFixed(2) + 's';
}

// Get or set player name from localStorage
function getPlayerName() {
  return localStorage.getItem('quiz_player_name') || '';
}

function setPlayerName(name) {
  localStorage.setItem('quiz_player_name', name.trim());
}
