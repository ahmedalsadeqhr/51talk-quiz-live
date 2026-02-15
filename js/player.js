// 51Talk Quiz — Player Logic
(function () {
  'use strict';

  // --- DOM refs ---
  const screenName = document.getElementById('screen-name');
  const screenWaiting = document.getElementById('screen-waiting');
  const screenQuestion = document.getElementById('screen-question');
  const screenAnswered = document.getElementById('screen-answered');
  const screenRevealed = document.getElementById('screen-revealed');
  const screenLeaderboard = document.getElementById('screen-leaderboard');

  const inputName = document.getElementById('input-name');
  const btnJoin = document.getElementById('btn-join');
  const displayName = document.getElementById('display-name');
  const timerValue = document.getElementById('timer-value');
  const questionAr = document.getElementById('question-ar');
  const questionEn = document.getElementById('question-en');
  const optionsContainer = document.getElementById('options-container');
  const answeredFeedback = document.getElementById('answered-feedback');
  const revealResult = document.getElementById('reveal-result');
  const leaderboardList = document.getElementById('leaderboard-list');

  // --- State ---
  let playerName = '';
  let currentAQ = null;         // active_question row
  let currentQuestion = null;   // full question data
  let shuffleMap = [];           // maps shuffled index -> original index
  let hasAnswered = false;
  let myResponse = null;
  let timerInterval = null;

  // --- Screens ---
  function showScreen(screen) {
    [screenName, screenWaiting, screenQuestion, screenAnswered, screenRevealed, screenLeaderboard]
      .forEach(s => s.classList.add('hidden'));
    screen.classList.remove('hidden');
  }

  // --- Name Entry ---
  const savedName = getPlayerName();
  if (savedName) {
    inputName.value = savedName;
  }

  btnJoin.addEventListener('click', joinGame);
  inputName.addEventListener('keydown', e => {
    if (e.key === 'Enter') joinGame();
  });

  function joinGame() {
    const name = inputName.value.trim();
    if (!name) {
      inputName.focus();
      return;
    }
    playerName = name;
    setPlayerName(playerName);
    displayName.textContent = playerName;
    showScreen(screenWaiting);
    subscribeToActiveQuestion();
  }

  // --- Realtime Subscription ---
  function subscribeToActiveQuestion() {
    // Fetch initial state
    loadActiveQuestion();

    // Subscribe to changes
    supabase
      .channel('aq-changes')
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

  async function loadActiveQuestion() {
    const { data, error } = await supabase
      .from('active_question')
      .select('*')
      .eq('id', 1)
      .single();

    if (!error && data) {
      handleAQUpdate(data);
    }
  }

  async function handleAQUpdate(aq) {
    currentAQ = aq;

    if (aq.status === 'idle') {
      stopTimer();
      hasAnswered = false;
      myResponse = null;
      showScreen(screenWaiting);
      return;
    }

    if (aq.status === 'active') {
      await loadQuestion(aq.question_id);
      // Check if already answered
      const alreadyAnswered = await checkAlreadyAnswered(aq.question_id);
      if (alreadyAnswered) {
        hasAnswered = true;
        showScreen(screenAnswered);
      } else {
        hasAnswered = false;
        myResponse = null;
        renderQuestion();
        showScreen(screenQuestion);
        startTimer();
      }
      return;
    }

    if (aq.status === 'revealed') {
      stopTimer();
      await showRevealedState();
      showScreen(screenRevealed);
      return;
    }

    if (aq.status === 'leaderboard') {
      stopTimer();
      await showLeaderboard();
      showScreen(screenLeaderboard);
      return;
    }
  }

  // --- Load Question Data ---
  async function loadQuestion(questionId) {
    if (currentQuestion && currentQuestion.id === questionId) return;

    const { data, error } = await supabase
      .from('questions')
      .select('*')
      .eq('id', questionId)
      .single();

    if (!error && data) {
      currentQuestion = data;
      shuffleMap = createShuffleMap(data.options.length, currentAQ.shuffle_seed);
    }
  }

  // --- Check if already answered ---
  async function checkAlreadyAnswered(questionId) {
    const { data } = await supabase
      .from('responses')
      .select('*')
      .eq('question_id', questionId)
      .eq('player_name', playerName)
      .maybeSingle();

    if (data) {
      myResponse = data;
      return true;
    }
    return false;
  }

  // --- Render Question ---
  function renderQuestion() {
    if (!currentQuestion || !currentAQ) return;

    questionAr.textContent = currentQuestion.question_ar;
    questionEn.textContent = currentQuestion.question_en;

    const options = currentQuestion.options;
    const letters = ['A', 'B', 'C', 'D'];
    optionsContainer.innerHTML = '';

    shuffleMap.forEach((originalIdx, shuffledIdx) => {
      const opt = options[originalIdx];
      const btn = document.createElement('button');
      btn.className = 'option-btn';
      btn.innerHTML = `
        <span class="option-letter">${escapeHtml(letters[shuffledIdx])}</span>
        <span>
          <span class="text-ar" style="display:block;">${escapeHtml(opt.ar)}</span>
          <span class="text-en" style="display:block;font-size:0.9rem;color:var(--text-secondary);">${escapeHtml(opt.en)}</span>
        </span>
      `;
      btn.addEventListener('click', () => submitAnswer(originalIdx, btn));
      optionsContainer.appendChild(btn);
    });
  }

  // --- Submit Answer ---
  async function submitAnswer(originalIndex, btnElement) {
    if (hasAnswered) return;

    // Check timer
    const remaining = getRemainingSeconds(currentAQ.started_at, currentAQ.timer_sec);
    if (remaining <= 0) {
      answeredFeedback.textContent = 'Time is up!';
      answeredFeedback.className = 'feedback incorrect';
      showScreen(screenAnswered);
      return;
    }

    hasAnswered = true;

    // Disable all buttons
    optionsContainer.querySelectorAll('.option-btn').forEach(b => b.disabled = true);
    btnElement.classList.add('selected');

    const responseTimeMs = getResponseTimeMs(currentAQ.started_at);
    const isCorrect = originalIndex === currentQuestion.correct_index;

    const { error } = await supabase
      .from('responses')
      .insert({
        question_id: currentAQ.question_id,
        player_name: playerName,
        selected_index: originalIndex,
        is_correct: isCorrect,
        response_time_ms: responseTimeMs
      });

    if (error) {
      // Could be duplicate or timer expired server-side
      if (error.code === '23505') {
        answeredFeedback.textContent = 'Already answered!';
      } else {
        answeredFeedback.textContent = 'Could not submit — time may have expired.';
      }
      answeredFeedback.className = 'feedback incorrect';
    } else {
      myResponse = { selected_index: originalIndex, is_correct: isCorrect, response_time_ms: responseTimeMs };
      answeredFeedback.textContent = 'Answer submitted! Waiting for results...';
      answeredFeedback.className = 'feedback waiting';
    }

    showScreen(screenAnswered);
  }

  // --- Timer ---
  function startTimer() {
    stopTimer();
    updateTimer();
    timerInterval = setInterval(updateTimer, 250);
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
    timerValue.textContent = secs;
    timerValue.classList.toggle('urgent', secs <= 5);

    if (remaining <= 0) {
      stopTimer();
      if (!hasAnswered) {
        answeredFeedback.textContent = 'Time is up!';
        answeredFeedback.className = 'feedback incorrect';
        showScreen(screenAnswered);
        hasAnswered = true;
      }
    }
  }

  // --- Revealed State ---
  async function showRevealedState() {
    if (!currentQuestion) return;

    const correctOpt = currentQuestion.options[currentQuestion.correct_index];
    let html = '';

    html += `<div class="question-text">
      <div class="ar">${escapeHtml(currentQuestion.question_ar)}</div>
      <div class="en">${escapeHtml(currentQuestion.question_en)}</div>
    </div>`;

    html += `<div class="feedback correct mt-2">
      Correct answer: ${escapeHtml(correctOpt.en)} — ${escapeHtml(correctOpt.ar)}
    </div>`;

    if (myResponse) {
      if (myResponse.is_correct) {
        const score = calculateScore(myResponse.response_time_ms, currentAQ.timer_sec * 1000);
        html += `<div class="feedback correct mt-1">
          You got it right! +${score} points (${formatTime(myResponse.response_time_ms)})
        </div>`;
      } else {
        html += `<div class="feedback incorrect mt-1">
          Wrong answer. Better luck next time!
        </div>`;
      }
    } else {
      html += `<div class="feedback incorrect mt-1">
        You didn't answer this question.
      </div>`;
    }

    revealResult.innerHTML = html;
  }

  // --- Leaderboard ---
  async function showLeaderboard() {
    if (!currentAQ || !currentAQ.quiz_id) return;

    const { data, error } = await supabase.rpc('get_leaderboard', {
      p_quiz_id: currentAQ.quiz_id,
      p_limit: 10
    });

    leaderboardList.innerHTML = '';

    if (!error && data && data.length > 0) {
      data.forEach(entry => {
        const li = document.createElement('li');
        li.className = 'leaderboard-item';
        const isMe = entry.player_name === playerName;
        li.innerHTML = `
          <span class="leaderboard-name" ${isMe ? 'style="color:var(--accent);"' : ''}>
            ${escapeHtml(entry.player_name)} ${isMe ? '(You)' : ''}
          </span>
          <span class="leaderboard-score">${entry.total_score}</span>
          <span class="leaderboard-meta">${entry.correct_count} correct</span>
        `;
        leaderboardList.appendChild(li);
      });
    } else {
      leaderboardList.innerHTML = '<li class="text-center" style="color:var(--text-muted);padding:2rem;">No scores yet</li>';
    }
  }

})();
