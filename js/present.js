// 51Talk Quiz — Presentation Logic
(function () {
  'use strict';

  // --- DOM refs ---
  const presentIdle = document.getElementById('present-idle');
  const presentActive = document.getElementById('present-active');
  const presentRevealed = document.getElementById('present-revealed');
  const presentLeaderboard = document.getElementById('present-leaderboard');

  const presentQAr = document.getElementById('present-q-ar');
  const presentQEn = document.getElementById('present-q-en');
  const presentTimer = document.getElementById('present-timer');
  const ringFg = document.getElementById('ring-fg');
  const presentResponseCount = document.getElementById('present-response-count');
  const presentOptions = document.getElementById('present-options');

  const revealQAr = document.getElementById('reveal-q-ar');
  const revealQEn = document.getElementById('reveal-q-en');
  const revealWinner = document.getElementById('reveal-winner');
  const revealDistribution = document.getElementById('reveal-distribution');
  const presentLeaderboardList = document.getElementById('present-leaderboard-list');

  // --- State ---
  let currentAQ = null;
  let currentQuestion = null;
  let shuffleMap = [];
  let timerInterval = null;
  let responseCount = 0;
  let responseChannel = null;

  const RING_CIRCUMFERENCE = 2 * Math.PI * 108; // r=108

  // --- Screens ---
  function showScreen(screen) {
    [presentIdle, presentActive, presentRevealed, presentLeaderboard]
      .forEach(s => s.classList.add('hidden'));
    screen.classList.remove('hidden');
  }

  // --- Init ---
  loadActiveQuestion();
  subscribeToAQ();

  async function loadActiveQuestion() {
    const { data } = await supabase
      .from('active_question')
      .select('*')
      .eq('id', 1)
      .single();
    if (data) handleAQUpdate(data);
  }

  function subscribeToAQ() {
    supabase
      .channel('present-aq')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'active_question',
        filter: 'id=eq.1'
      }, payload => {
        handleAQUpdate(payload.new);
      })
      .subscribe();
  }

  async function handleAQUpdate(aq) {
    currentAQ = aq;

    if (aq.status === 'idle') {
      stopTimer();
      unsubscribeResponses();
      showScreen(presentIdle);
      return;
    }

    if (aq.status === 'active') {
      await loadQuestion(aq.question_id);
      renderActiveQuestion();
      startTimer();
      subscribeToResponses(aq.question_id);
      showScreen(presentActive);
      return;
    }

    if (aq.status === 'revealed') {
      stopTimer();
      await loadQuestion(aq.question_id);
      await renderRevealed();
      showScreen(presentRevealed);
      return;
    }

    if (aq.status === 'leaderboard') {
      stopTimer();
      await renderLeaderboard();
      showScreen(presentLeaderboard);
      return;
    }
  }

  // --- Load Question ---
  async function loadQuestion(questionId) {
    if (currentQuestion && currentQuestion.id === questionId) return;

    const { data } = await supabase
      .from('questions')
      .select('*')
      .eq('id', questionId)
      .single();

    if (data) {
      currentQuestion = data;
      shuffleMap = createShuffleMap(data.options.length, currentAQ.shuffle_seed);
    }
  }

  // --- Render Active Question ---
  function renderActiveQuestion() {
    if (!currentQuestion) return;

    presentQAr.textContent = currentQuestion.question_ar;
    presentQEn.textContent = currentQuestion.question_en;

    // Render options (display only, not clickable)
    const options = currentQuestion.options;
    const letters = ['A', 'B', 'C', 'D'];
    presentOptions.innerHTML = '';

    shuffleMap.forEach((originalIdx, shuffledIdx) => {
      const opt = options[originalIdx];
      const div = document.createElement('div');
      div.className = 'option-btn';
      div.style.cursor = 'default';
      div.dataset.originalIndex = originalIdx;
      div.innerHTML = `
        <span class="option-letter">${escapeHtml(letters[shuffledIdx])}</span>
        <span>
          <span class="text-ar" style="display:block;">${escapeHtml(opt.ar)}</span>
          <span class="text-en" style="display:block;font-size:0.9rem;color:var(--text-secondary);">${escapeHtml(opt.en)}</span>
        </span>
      `;
      presentOptions.appendChild(div);
    });

    // Reset response count
    responseCount = 0;
    presentResponseCount.textContent = '0';
  }

  // --- Timer ---
  function startTimer() {
    stopTimer();
    updateTimer();
    timerInterval = setInterval(updateTimer, 100);
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function updateTimer() {
    if (!currentAQ || !currentAQ.started_at) return;

    const remaining = getRemainingSeconds(currentAQ.started_at, currentAQ.timer_sec);
    const secs = Math.ceil(remaining);

    presentTimer.textContent = secs;
    presentTimer.classList.toggle('urgent', secs <= 5);

    // Update ring
    const fraction = remaining / currentAQ.timer_sec;
    const offset = RING_CIRCUMFERENCE * (1 - fraction);
    ringFg.style.strokeDashoffset = offset;
    ringFg.classList.toggle('urgent', secs <= 5);

    if (remaining <= 0) {
      stopTimer();
      presentTimer.textContent = '0';
      ringFg.style.strokeDashoffset = RING_CIRCUMFERENCE;
    }
  }

  // --- Response Subscription ---
  function subscribeToResponses(questionId) {
    unsubscribeResponses();
    responseCount = 0;
    presentResponseCount.textContent = '0';

    // Load existing count
    loadResponseCount(questionId);

    responseChannel = supabase
      .channel('present-responses')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'responses',
        filter: `question_id=eq.${questionId}`
      }, () => {
        responseCount++;
        presentResponseCount.textContent = responseCount;
      })
      .subscribe();
  }

  function unsubscribeResponses() {
    if (responseChannel) {
      supabase.removeChannel(responseChannel);
      responseChannel = null;
    }
  }

  async function loadResponseCount(questionId) {
    const { count } = await supabase
      .from('responses')
      .select('*', { count: 'exact', head: true })
      .eq('question_id', questionId);

    responseCount = count || 0;
    presentResponseCount.textContent = responseCount;
  }

  // --- Revealed ---
  async function renderRevealed() {
    if (!currentQuestion || !currentAQ) return;

    revealQAr.textContent = currentQuestion.question_ar;
    revealQEn.textContent = currentQuestion.question_en;

    // Get all responses for this question
    const { data: responses } = await supabase
      .from('responses')
      .select('*')
      .eq('question_id', currentAQ.question_id)
      .order('response_time_ms');

    // Find winner (fastest correct)
    const correctResponses = (responses || []).filter(r => r.is_correct);
    if (correctResponses.length > 0) {
      const winner = correctResponses[0];
      const score = calculateScore(winner.response_time_ms, currentAQ.timer_sec * 1000);
      revealWinner.innerHTML = `
        <div class="winner-card">
          <div class="winner-label">Fastest Correct Answer</div>
          <div class="winner-name">${escapeHtml(winner.player_name)}</div>
          <div class="winner-time">${formatTime(winner.response_time_ms)} — +${score} points</div>
        </div>
      `;
    } else {
      revealWinner.innerHTML = `
        <div class="feedback incorrect mt-2">No one got it right!</div>
      `;
    }

    // Response distribution
    const options = currentQuestion.options;
    const letters = ['A', 'B', 'C', 'D'];
    const counts = new Array(options.length).fill(0);
    const total = (responses || []).length;

    (responses || []).forEach(r => {
      if (r.selected_index >= 0 && r.selected_index < counts.length) {
        counts[r.selected_index]++;
      }
    });

    let distHtml = '';
    shuffleMap.forEach((originalIdx, shuffledIdx) => {
      const count = counts[originalIdx];
      const pct = total > 0 ? (count / total * 100) : 0;
      const isCorrect = originalIdx === currentQuestion.correct_index;
      distHtml += `
        <div class="dist-row">
          <span class="dist-label">${letters[shuffledIdx]}</span>
          <div class="dist-bar-wrap">
            <div class="dist-bar ${isCorrect ? 'correct' : ''}" style="width:${pct}%"></div>
          </div>
          <span class="dist-count">${count}</span>
        </div>
      `;
    });
    revealDistribution.innerHTML = distHtml;

    // Highlight correct option in the options display
    presentOptions.querySelectorAll('.option-btn').forEach(btn => {
      const origIdx = parseInt(btn.dataset.originalIndex);
      if (origIdx === currentQuestion.correct_index) {
        btn.classList.add('correct');
      }
    });
  }

  // --- Leaderboard ---
  async function renderLeaderboard() {
    if (!currentAQ || !currentAQ.quiz_id) return;

    const { data } = await supabase.rpc('get_leaderboard', {
      p_quiz_id: currentAQ.quiz_id,
      p_limit: 10
    });

    presentLeaderboardList.innerHTML = '';

    if (data && data.length > 0) {
      data.forEach(entry => {
        const li = document.createElement('li');
        li.className = 'leaderboard-item';
        li.innerHTML = `
          <span class="leaderboard-name">${escapeHtml(entry.player_name)}</span>
          <span class="leaderboard-score">${entry.total_score}</span>
          <span class="leaderboard-meta">${entry.correct_count} correct · avg ${formatTime(entry.avg_time_ms)}</span>
        `;
        presentLeaderboardList.appendChild(li);
      });
    } else {
      presentLeaderboardList.innerHTML = '<li class="text-center" style="color:var(--text-muted);padding:2rem;">No scores yet</li>';
    }
  }

})();
