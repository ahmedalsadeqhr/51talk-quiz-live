// 51Talk Quiz — Admin Logic
(function () {
  'use strict';

  // --- DOM refs ---
  const authModal = document.getElementById('auth-modal');
  const dashboard = document.getElementById('admin-dashboard');
  const inputPassword = document.getElementById('input-password');
  const btnLogin = document.getElementById('btn-login');
  const authError = document.getElementById('auth-error');
  const btnLogout = document.getElementById('btn-logout');
  const statusBadge = document.getElementById('status-badge');

  // Control tab
  const selectQuiz = document.getElementById('select-quiz');
  const selectQuestion = document.getElementById('select-question');
  const inputTimer = document.getElementById('input-timer');
  const btnStart = document.getElementById('btn-start');
  const btnReveal = document.getElementById('btn-reveal');
  const btnLeaderboard = document.getElementById('btn-leaderboard');
  const btnStop = document.getElementById('btn-stop');
  const btnClearResponses = document.getElementById('btn-clear-responses');
  const btnClearAll = document.getElementById('btn-clear-all');
  const previewQuestion = document.getElementById('preview-question');

  // Responses tab
  const responseCountBadge = document.getElementById('response-count-badge');
  const responseList = document.getElementById('response-list');
  const noResponses = document.getElementById('no-responses');

  // Editor tab
  const editorQuizSelect = document.getElementById('editor-quiz-select');
  const editorQuizEn = document.getElementById('editor-quiz-en');
  const editorQuizAr = document.getElementById('editor-quiz-ar');
  const btnSaveQuiz = document.getElementById('btn-save-quiz');
  const btnNewQuiz = document.getElementById('btn-new-quiz');
  const btnDeleteQuiz = document.getElementById('btn-delete-quiz');
  const editorQuestionSelect = document.getElementById('editor-question-select');
  const editorQEn = document.getElementById('editor-q-en');
  const editorQAr = document.getElementById('editor-q-ar');
  const editorQSort = document.getElementById('editor-q-sort');
  const btnSaveQuestion = document.getElementById('btn-save-question');
  const btnNewQuestion = document.getElementById('btn-new-question');
  const btnDeleteQuestion = document.getElementById('btn-delete-question');

  // --- State ---
  let adminPw = '';
  let quizzes = [];
  let questions = [];
  let currentAQ = null;
  let responseSubscription = null;

  // --- Auth ---
  const savedPw = sessionStorage.getItem('admin_pw');
  if (savedPw) {
    adminPw = savedPw;
    verifyAndEnter(savedPw);
  }

  btnLogin.addEventListener('click', () => {
    verifyAndEnter(inputPassword.value);
  });
  inputPassword.addEventListener('keydown', e => {
    if (e.key === 'Enter') verifyAndEnter(inputPassword.value);
  });

  btnLogout.addEventListener('click', () => {
    sessionStorage.removeItem('admin_pw');
    adminPw = '';
    authModal.classList.remove('hidden');
    dashboard.classList.add('hidden');
  });

  async function verifyAndEnter(pw) {
    authError.style.display = 'none';
    btnLogin.disabled = true;
    btnLogin.textContent = 'Verifying...';

    try {
      const { data, error } = await supabase.rpc('verify_admin', { pw: pw });

      if (error) {
        authError.textContent = 'Connection error: ' + error.message;
        authError.style.display = 'block';
        return;
      }

      if (data !== true) {
        authError.textContent = 'Invalid password';
        authError.style.display = 'block';
        return;
      }

      adminPw = pw;
      sessionStorage.setItem('admin_pw', pw);
      authModal.classList.add('hidden');
      dashboard.classList.remove('hidden');
      init();
    } catch (err) {
      authError.textContent = 'Error: ' + err.message;
      authError.style.display = 'block';
    } finally {
      btnLogin.disabled = false;
      btnLogin.textContent = 'Login';
    }
  }

  // --- Init ---
  async function init() {
    await loadQuizzes();
    await loadActiveQuestion();
    subscribeToAQ();
    setupTabs();
  }

  // --- Tabs ---
  function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      });
    });
  }

  // --- Load Data ---
  async function loadQuizzes() {
    const { data } = await supabase.from('quizzes').select('*').order('created_at');
    quizzes = data || [];
    populateQuizSelects();
  }

  function populateQuizSelects() {
    // Control tab
    selectQuiz.innerHTML = '<option value="">— Select quiz —</option>';
    quizzes.forEach(q => {
      selectQuiz.innerHTML += `<option value="${q.id}">${escapeHtml(q.title_en)} — ${escapeHtml(q.title_ar)}</option>`;
    });

    // Editor tab
    editorQuizSelect.innerHTML = '<option value="">— New quiz —</option>';
    quizzes.forEach(q => {
      editorQuizSelect.innerHTML += `<option value="${q.id}">${escapeHtml(q.title_en)}</option>`;
    });
  }

  selectQuiz.addEventListener('change', loadQuestions);
  editorQuizSelect.addEventListener('change', loadEditorQuiz);

  async function loadQuestions() {
    const quizId = selectQuiz.value;
    selectQuestion.innerHTML = '<option value="">— Select question —</option>';
    if (!quizId) return;

    const { data } = await supabase.from('questions').select('*').eq('quiz_id', quizId).order('sort_order');
    questions = data || [];
    questions.forEach((q, i) => {
      selectQuestion.innerHTML += `<option value="${q.id}">Q${i + 1}: ${escapeHtml(q.question_en.substring(0, 50))}</option>`;
    });
  }

  selectQuestion.addEventListener('change', () => {
    const q = questions.find(q => q.id === selectQuestion.value);
    if (q) {
      previewQuestion.innerHTML = `
        <div class="question-text">
          <div class="ar">${escapeHtml(q.question_ar)}</div>
          <div class="en">${escapeHtml(q.question_en)}</div>
        </div>`;
    }
  });

  // --- Active Question Subscription ---
  async function loadActiveQuestion() {
    const { data } = await supabase.from('active_question').select('*').eq('id', 1).single();
    if (data) updateAQState(data);
  }

  function subscribeToAQ() {
    supabase
      .channel('admin-aq')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'active_question',
        filter: 'id=eq.1'
      }, payload => {
        updateAQState(payload.new);
      })
      .subscribe();
  }

  function updateAQState(aq) {
    currentAQ = aq;
    const s = aq.status;

    // Update badge
    statusBadge.textContent = s.toUpperCase();
    statusBadge.className = 'badge badge-' + s;

    // Enable/disable buttons based on state
    btnStart.disabled = false;
    btnReveal.disabled = s !== 'active';
    btnLeaderboard.disabled = s !== 'revealed' && s !== 'active';
    btnStop.disabled = s === 'idle';

    // Subscribe to responses when active
    if (s === 'active' && aq.question_id) {
      subscribeToResponses(aq.question_id);
    }
  }

  // --- Response Subscription ---
  function subscribeToResponses(questionId) {
    // Unsubscribe previous
    if (responseSubscription) {
      supabase.removeChannel(responseSubscription);
    }

    // Clear list
    responseList.innerHTML = '';
    noResponses.classList.remove('hidden');
    responseCountBadge.textContent = '0 responses';

    // Load existing responses
    loadResponses(questionId);

    // Subscribe to new inserts
    responseSubscription = supabase
      .channel('admin-responses')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'responses',
        filter: `question_id=eq.${questionId}`
      }, payload => {
        addResponseToList(payload.new);
      })
      .subscribe();
  }

  async function loadResponses(questionId) {
    const { data } = await supabase
      .from('responses')
      .select('*')
      .eq('question_id', questionId)
      .order('response_time_ms');

    if (data && data.length > 0) {
      data.forEach(r => addResponseToList(r));
    }
  }

  function addResponseToList(r) {
    noResponses.classList.add('hidden');
    const li = document.createElement('li');
    li.className = 'response-item';
    li.innerHTML = `
      <span class="name">${escapeHtml(r.player_name)}</span>
      <span class="result ${r.is_correct ? 'correct' : 'incorrect'}">
        ${r.is_correct ? 'Correct' : 'Wrong'} — ${formatTime(r.response_time_ms)}
      </span>
    `;
    responseList.appendChild(li);

    const count = responseList.children.length;
    responseCountBadge.textContent = count + ' response' + (count !== 1 ? 's' : '');
  }

  // --- Control Buttons ---
  btnStart.addEventListener('click', async () => {
    const questionId = selectQuestion.value;
    const quizId = selectQuiz.value;
    if (!questionId || !quizId) {
      alert('Select a quiz and question first.');
      return;
    }
    const timerSec = parseInt(inputTimer.value) || 20;
    btnStart.disabled = true;

    const { error } = await supabase.rpc('set_active_question', {
      pw: adminPw,
      p_question_id: questionId,
      p_quiz_id: quizId,
      p_timer_sec: timerSec
    });

    if (error) {
      alert('Error: ' + error.message);
      btnStart.disabled = false;
    }
  });

  btnReveal.addEventListener('click', async () => {
    btnReveal.disabled = true;
    const { error } = await supabase.rpc('update_aq_status', { pw: adminPw, new_status: 'revealed' });
    if (error) alert('Error: ' + error.message);
  });

  btnLeaderboard.addEventListener('click', async () => {
    btnLeaderboard.disabled = true;
    const { error } = await supabase.rpc('update_aq_status', { pw: adminPw, new_status: 'leaderboard' });
    if (error) alert('Error: ' + error.message);
  });

  btnStop.addEventListener('click', async () => {
    btnStop.disabled = true;
    const { error } = await supabase.rpc('update_aq_status', { pw: adminPw, new_status: 'idle' });
    if (error) alert('Error: ' + error.message);
  });

  btnClearResponses.addEventListener('click', async () => {
    const quizId = selectQuiz.value;
    if (!quizId) { alert('Select a quiz first.'); return; }
    if (!confirm('Clear all responses for this quiz?')) return;
    await supabase.rpc('clear_responses', { pw: adminPw, p_quiz_id: quizId });
    responseList.innerHTML = '';
    noResponses.classList.remove('hidden');
    responseCountBadge.textContent = '0 responses';
  });

  btnClearAll.addEventListener('click', async () => {
    if (!confirm('Clear ALL responses for ALL quizzes?')) return;
    // Clear each quiz individually since DELETE without WHERE is blocked
    for (const q of quizzes) {
      await supabase.rpc('clear_responses', { pw: adminPw, p_quiz_id: q.id });
    }
    responseList.innerHTML = '';
    noResponses.classList.remove('hidden');
    responseCountBadge.textContent = '0 responses';
  });

  // --- Quiz Editor ---
  async function loadEditorQuiz() {
    const quizId = editorQuizSelect.value;
    if (!quizId) {
      editorQuizEn.value = '';
      editorQuizAr.value = '';
      editorQuestionSelect.innerHTML = '<option value="">— Select question —</option>';
      return;
    }
    const quiz = quizzes.find(q => q.id === quizId);
    if (quiz) {
      editorQuizEn.value = quiz.title_en;
      editorQuizAr.value = quiz.title_ar;
    }
    await loadEditorQuestions(quizId);
  }

  async function loadEditorQuestions(quizId) {
    const { data } = await supabase.from('questions').select('*').eq('quiz_id', quizId).order('sort_order');
    const editorQuestions = data || [];
    editorQuestionSelect.innerHTML = '<option value="">— New question —</option>';
    editorQuestions.forEach((q, i) => {
      editorQuestionSelect.innerHTML += `<option value="${q.id}">Q${i + 1}: ${escapeHtml(q.question_en.substring(0, 50))}</option>`;
    });
    // Store for later
    editorQuestionSelect._questions = editorQuestions;
  }

  editorQuestionSelect.addEventListener('change', () => {
    const qId = editorQuestionSelect.value;
    if (!qId) {
      clearQuestionForm();
      return;
    }
    const questions = editorQuestionSelect._questions || [];
    const q = questions.find(x => x.id === qId);
    if (!q) return;

    editorQEn.value = q.question_en;
    editorQAr.value = q.question_ar;
    editorQSort.value = q.sort_order;

    // Fill options
    const optEditors = document.querySelectorAll('.option-editor');
    q.options.forEach((opt, i) => {
      if (optEditors[i]) {
        optEditors[i].querySelector('.opt-en').value = opt.en || '';
        optEditors[i].querySelector('.opt-ar').value = opt.ar || '';
        optEditors[i].querySelector('.correct-toggle').checked = (i === q.correct_index);
      }
    });
  });

  function clearQuestionForm() {
    editorQEn.value = '';
    editorQAr.value = '';
    editorQSort.value = '0';
    document.querySelectorAll('.option-editor').forEach((ed, i) => {
      ed.querySelector('.opt-en').value = '';
      ed.querySelector('.opt-ar').value = '';
      ed.querySelector('.correct-toggle').checked = (i === 0);
    });
  }

  btnSaveQuiz.addEventListener('click', async () => {
    const titleEn = editorQuizEn.value.trim();
    const titleAr = editorQuizAr.value.trim();
    if (!titleEn || !titleAr) { alert('Fill in both titles.'); return; }

    const quizId = editorQuizSelect.value || null;
    const { data, error } = await supabase.rpc('upsert_quiz', {
      pw: adminPw,
      p_id: quizId,
      p_title_en: titleEn,
      p_title_ar: titleAr
    });

    if (error) { alert('Error: ' + error.message); return; }
    await loadQuizzes();
    alert('Quiz saved!');
  });

  btnNewQuiz.addEventListener('click', () => {
    editorQuizSelect.value = '';
    editorQuizEn.value = '';
    editorQuizAr.value = '';
    editorQuestionSelect.innerHTML = '<option value="">— New question —</option>';
    clearQuestionForm();
  });

  btnDeleteQuiz.addEventListener('click', async () => {
    const quizId = editorQuizSelect.value;
    if (!quizId) return;
    if (!confirm('Delete this quiz and all its questions?')) return;

    const { error } = await supabase.rpc('delete_quiz', { pw: adminPw, p_id: quizId });
    if (error) { alert('Error: ' + error.message); return; }
    await loadQuizzes();
    editorQuizEn.value = '';
    editorQuizAr.value = '';
    alert('Quiz deleted.');
  });

  btnSaveQuestion.addEventListener('click', async () => {
    const quizId = editorQuizSelect.value;
    if (!quizId) { alert('Select or save a quiz first.'); return; }

    const qEn = editorQEn.value.trim();
    const qAr = editorQAr.value.trim();
    if (!qEn || !qAr) { alert('Fill in both question texts.'); return; }

    // Gather options
    const optEditors = document.querySelectorAll('.option-editor');
    const options = [];
    let correctIndex = 0;
    optEditors.forEach((ed, i) => {
      const en = ed.querySelector('.opt-en').value.trim();
      const ar = ed.querySelector('.opt-ar').value.trim();
      options.push({ en, ar });
      if (ed.querySelector('.correct-toggle').checked) correctIndex = i;
    });

    if (options.some(o => !o.en || !o.ar)) {
      alert('Fill in all option texts.');
      return;
    }

    const qId = editorQuestionSelect.value || null;
    const sortOrder = parseInt(editorQSort.value) || 0;

    const { error } = await supabase.rpc('upsert_question', {
      pw: adminPw,
      p_quiz_id: quizId,
      p_question_en: qEn,
      p_question_ar: qAr,
      p_options: options,
      p_correct_index: correctIndex,
      p_sort_order: sortOrder,
      p_id: qId
    });

    if (error) { alert('Error: ' + error.message); return; }
    await loadEditorQuestions(quizId);
    await loadQuestions();
    alert('Question saved!');
  });

  btnNewQuestion.addEventListener('click', () => {
    editorQuestionSelect.value = '';
    clearQuestionForm();
  });

  btnDeleteQuestion.addEventListener('click', async () => {
    const qId = editorQuestionSelect.value;
    if (!qId) return;
    if (!confirm('Delete this question?')) return;

    const { error } = await supabase.rpc('delete_question', { pw: adminPw, p_id: qId });
    if (error) { alert('Error: ' + error.message); return; }

    const quizId = editorQuizSelect.value;
    if (quizId) await loadEditorQuestions(quizId);
    clearQuestionForm();
    alert('Question deleted.');
  });

})();
