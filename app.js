// ── Configuration ──────────────────────────────────────────────────────────
// Update this to your deployed backend URL before hosting on GitHub Pages.
// During local development, this points to the Express server running locally.
const BACKEND_URL = 'https://readwell-tzvg.onrender.com';

// ── App state ──────────────────────────────────────────────────────────────
const state = {
  level: 1,
  paragraphCount: 1,
  topic: '',
  passage: '',
  contentWords: [],      // 6 or 10 words from passage (depends on level)
  distractorWords: [],   // 2 or 5 unrelated words (depends on level)
  allWords: [],          // shuffled array of all words
  selectedWords: new Set(),
  vocabResults: null,    // { correct, wrong, missed }
  vocabularyScore: 0,
  rereadMode: false,     // true = came from "re-read", skip vocab on finish
  recognition: null,     // SpeechRecognition instance
  isRecording: false,
  finalTranscript: '',   // accumulates confirmed speech across pauses
};

// ── Helpers ────────────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Returns level-specific word counts (change 4)
function getLevelConfig(level) {
  if (level === 1) return { contentCount: 6, distractorCount: 2, selectCount: 6 };
  return { contentCount: 10, distractorCount: 5, selectCount: 10 };
}

function getFractionMessage(numerator, denominator) {
  const pct = numerator / denominator;
  if (pct === 1)    return 'Every key word — perfect!';
  if (pct >= 0.75)  return 'Excellent vocabulary use!';
  if (pct >= 0.5)   return 'Good vocabulary use!';
  if (pct >= 0.25)  return 'Keep building that vocabulary!';
  return 'Keep practicing — you\'re making progress!';
}

function getVocabEncouragement(score, denominator) {
  const pct = score / denominator;
  if (pct === 1)   return `Perfect — all ${denominator} words! Amazing!`;
  if (pct >= 0.8)  return 'Excellent memory! You caught almost all of them.';
  if (pct >= 0.6)  return 'Great job! You remembered most of the key words.';
  if (pct >= 0.4)  return 'Good effort! Reading it again will help those words stick.';
  return 'Every attempt helps you learn. Keep going — you\'re doing great!';
}

function showError(elementId, message) {
  const el = document.getElementById(elementId);
  if (el) { el.textContent = message; el.classList.add('visible'); }
}
function hideError(elementId) {
  const el = document.getElementById(elementId);
  if (el) { el.textContent = ''; el.classList.remove('visible'); }
}

// ── Screen navigation ──────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  updateStepIndicator(id);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateStepIndicator(screenId) {
  const steps = ['screen1', 'screen2', 'screen3', 'screen4'];
  const current = steps.indexOf(screenId);
  steps.forEach((sid, i) => {
    const dot  = document.getElementById(`step-${i + 1}`);
    const line = document.getElementById(`step-line-${i + 1}`);
    if (!dot) return;
    dot.classList.toggle('active', i === current);
    dot.classList.toggle('done', i < current);
    if (line) line.classList.toggle('done', i < current);
  });
}

// ── Screen 1: Session setup ────────────────────────────────────────────────
function initScreen1() {
  // Level selector
  document.querySelectorAll('.level-option').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.level-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      state.level = Number(opt.dataset.level);
    });
  });

  // Length selector
  document.querySelectorAll('.length-option').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.length-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      state.paragraphCount = Number(opt.dataset.length);
    });
  });

  document.getElementById('topic-input').addEventListener('input', e => {
    state.topic = e.target.value.trim();
  });

  document.getElementById('generate-btn').addEventListener('click', generatePassage);
}

async function generatePassage() {
  hideError('generate-error');
  const btn = document.getElementById('generate-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Generating…';

  try {
    const res = await fetch(`${BACKEND_URL}/api/generate-passage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level: state.level,
        paragraphCount: state.paragraphCount,
        topic: state.topic,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Server error ${res.status}`);
    }

    const data = await res.json();
    state.passage       = data.passage;
    state.contentWords  = data.contentWords.map(w => w.toLowerCase());
    state.distractorWords = data.distractorWords.map(w => w.toLowerCase());
    state.allWords      = shuffle([...data.contentWords, ...data.distractorWords]);
    state.selectedWords = new Set();
    state.vocabResults  = null;
    state.rereadMode    = false;

    renderPassage();
    showScreen('screen2');
  } catch (err) {
    showError('generate-error', err.message || 'Something went wrong. Please try again.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Generate My Passage';
  }
}

// ── Screen 2: Read the passage ─────────────────────────────────────────────
function renderPassage() {
  const levelNames = { 1: 'Level 1 — Easy', 2: 'Level 2 — Moderate', 3: 'Level 3 — Advanced' };
  const lenLabel   = `${state.paragraphCount} paragraph${state.paragraphCount > 1 ? 's' : ''}`;

  document.getElementById('passage-level-badge').textContent  = levelNames[state.level];
  document.getElementById('passage-length-badge').textContent = lenLabel;

  const container = document.getElementById('passage-content');
  // Split on double newlines into paragraphs
  const paras = state.passage.split(/\n\n+/).filter(p => p.trim());
  container.innerHTML = paras.map(p => `<p>${p.trim()}</p>`).join('');
}

function initScreen2() {
  document.getElementById('finished-reading-btn').addEventListener('click', () => {
    if (state.rereadMode) {
      // Came back from vocab screen to re-read — go straight to summary
      showScreen('screen4');
      resetSummaryScreen();
    } else {
      renderVocabGrid();
      showScreen('screen3');
    }
  });
}

// ── Screen 3: Vocabulary priming ───────────────────────────────────────────
function renderVocabGrid() {
  state.selectedWords = new Set();
  state.vocabResults  = null;

  const cfg  = getLevelConfig(state.level);
  const total = cfg.contentCount + cfg.distractorCount;

  // Update instructions dynamically (change 4)
  document.getElementById('vocab-instructions').innerHTML =
    `Below are ${total} words. <strong>${cfg.contentCount} appeared in the passage</strong> and ${cfg.distractorCount} did not. Tap the ${cfg.selectCount} words you think were in the passage.`;

  const grid = document.getElementById('word-grid');
  grid.innerHTML = '';

  state.allWords.forEach(word => {
    const chip = document.createElement('button');
    chip.className    = 'word-chip';
    chip.textContent  = word;
    chip.dataset.word = word.toLowerCase();
    chip.addEventListener('click', () => toggleWord(chip));
    grid.appendChild(chip);
  });

  updateVocabCounter();
  document.getElementById('check-vocab-btn').disabled = true;
  document.getElementById('check-vocab-btn').classList.remove('hidden');
  document.getElementById('vocab-results-section').classList.add('hidden');
  document.getElementById('vocab-action-btns').classList.add('hidden');
}

function toggleWord(chip) {
  // Don't allow interaction after results are shown
  if (state.vocabResults) return;

  const word = chip.dataset.word;
  if (state.selectedWords.has(word)) {
    state.selectedWords.delete(word);
    chip.classList.remove('selected');
  } else {
    const max = getLevelConfig(state.level).selectCount;
    if (state.selectedWords.size >= max) return;
    state.selectedWords.add(word);
    chip.classList.add('selected');
  }
  updateVocabCounter();
  const selectCount = getLevelConfig(state.level).selectCount;
  document.getElementById('check-vocab-btn').disabled = state.selectedWords.size !== selectCount;
}

function updateVocabCounter() {
  const el  = document.getElementById('vocab-counter');
  const n   = state.selectedWords.size;
  const max = getLevelConfig(state.level).selectCount;
  el.textContent = `${n} / ${max} words selected`;
  el.style.color = n === max ? 'var(--green)' : 'var(--muted)';
}

function checkVocabAnswers() {
  const correct = [];
  const wrong   = [];
  const missed  = [];

  state.contentWords.forEach(w => {
    const lower = w.toLowerCase();
    if (state.selectedWords.has(lower)) correct.push(w);
    else missed.push(w);
  });
  state.distractorWords.forEach(w => {
    const lower = w.toLowerCase();
    if (state.selectedWords.has(lower)) wrong.push(w);
  });

  state.vocabResults    = { correct, wrong, missed };
  state.vocabularyScore = correct.length;

  // Color the chips
  document.querySelectorAll('.word-chip').forEach(chip => {
    const word = chip.dataset.word;
    chip.classList.remove('selected');
    const isContent    = state.contentWords.includes(word);
    const isDistractor = state.distractorWords.includes(word);
    const wasSelected  = state.selectedWords.has(word);

    if (isContent && wasSelected)   { chip.classList.add('result-correct'); chip.innerHTML = `${chip.textContent}<span class="chip-icon">✓</span>`; }
    else if (isDistractor && wasSelected) { chip.classList.add('result-wrong'); chip.innerHTML = `${chip.textContent}<span class="chip-icon">✗</span>`; }
    else if (isContent && !wasSelected)   { chip.classList.add('result-missed'); chip.innerHTML = `${chip.textContent}<span class="chip-icon">○</span>`; }
    else { chip.classList.add('result-neutral'); }
  });

  // Show results section
  const cfg = getLevelConfig(state.level);
  document.getElementById('vocab-score-num').textContent = `${state.vocabularyScore}/${cfg.contentCount}`;
  document.getElementById('vocab-encouragement').textContent = getVocabEncouragement(state.vocabularyScore, cfg.contentCount);
  document.getElementById('vocab-results-section').classList.remove('hidden');
  document.getElementById('vocab-action-btns').classList.remove('hidden');
  document.getElementById('check-vocab-btn').classList.add('hidden');
}

function initScreen3() {
  document.getElementById('check-vocab-btn').addEventListener('click', checkVocabAnswers);

  document.getElementById('go-to-summary-btn').addEventListener('click', () => {
    showScreen('screen4');
    resetSummaryScreen();
  });

  document.getElementById('reread-btn').addEventListener('click', () => {
    state.rereadMode = true;
    showScreen('screen2');
  });
}

// ── Screen 4: Summary + feedback ──────────────────────────────────────────
function resetSummaryScreen() {
  state.finalTranscript = '';
  document.getElementById('summary-textarea').value = '';
  document.getElementById('feedback-section').classList.add('hidden');
  document.getElementById('summary-form').classList.remove('hidden');
  hideError('feedback-error');
  setInputMode('speak');
  stopRecording();
}

function setInputMode(mode) {
  document.getElementById('mode-type-btn').classList.toggle('active', mode === 'type');
  document.getElementById('mode-speak-btn').classList.toggle('active', mode === 'speak');
  document.getElementById('type-panel').classList.toggle('hidden', mode !== 'type');
  document.getElementById('speak-panel').classList.toggle('hidden', mode !== 'speak');
  document.getElementById('summary-textarea').placeholder =
    mode === 'speak' ? 'Your spoken words will appear here…' : 'Write your summary here…';
  if (mode === 'type') stopRecording();
}

// ── Speech recognition ──────────────────────────────────────────────────
function initSpeech() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    document.getElementById('speak-panel').innerHTML =
      '<p class="text-muted mt-8">Sorry, your browser does not support speech recognition. Please use the Type mode or try Chrome/Edge.</p>';
    document.getElementById('mode-speak-btn').disabled = true;
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.continuous    = true;
  recognition.interimResults = true;
  recognition.lang           = 'en-US';

  recognition.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript; // [0] = highest-confidence alternative
      if (e.results[i].isFinal) state.finalTranscript += t + ' ';
      else interim = t;
    }
    document.getElementById('summary-textarea').value = (state.finalTranscript + interim).trim();
    document.getElementById('interim-preview').textContent = interim ? `"${interim}"` : '';
  };

  recognition.onerror = e => {
    if (e.error === 'not-allowed') {
      showError('feedback-error', 'Microphone access was denied. Please allow access in your browser and try again.');
    }
    stopRecording();
  };

  recognition.onend = () => {
    if (state.isRecording) {
      // Auto-restart if still in recording mode (handles browser timeout)
      recognition.start();
    }
  };

  state.recognition = recognition;

  document.getElementById('mic-toggle-btn').addEventListener('click', () => {
    if (state.isRecording) stopRecording();
    else startRecording();
  });
}

function startRecording() {
  if (!state.recognition) return;
  state.isRecording = true;
  state.recognition.start();
  const btn = document.getElementById('mic-toggle-btn');
  btn.classList.remove('idle');
  btn.classList.add('recording');
  btn.innerHTML = '⏹ Stop Recording';
  document.getElementById('recording-indicator').classList.remove('hidden');
}

function stopRecording() {
  if (state.recognition && state.isRecording) {
    state.isRecording = false;
    state.recognition.stop();
  }
  state.isRecording = false;
  const btn = document.getElementById('mic-toggle-btn');
  if (btn) {
    btn.classList.remove('recording');
    btn.classList.add('idle');
    btn.innerHTML = '🎤 Start Recording';
  }
  const indicator = document.getElementById('recording-indicator');
  if (indicator) indicator.classList.add('hidden');
  const preview = document.getElementById('interim-preview');
  if (preview) preview.textContent = '';
}

// ── Submit summary ──────────────────────────────────────────────────────
async function submitSummary() {
  stopRecording();
  const summary = document.getElementById('summary-textarea').value.trim();
  if (!summary) {
    showError('feedback-error', 'Please write or speak your summary before submitting.');
    return;
  }
  hideError('feedback-error');

  const btn = document.getElementById('submit-summary-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Getting feedback…';

  try {
    const res = await fetch(`${BACKEND_URL}/api/get-feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        passage: state.passage,
        summary,
        contentWords: state.contentWords,
        vocabCorrect: state.vocabResults ? state.vocabResults.correct : [],
        vocabMissed:  state.vocabResults ? state.vocabResults.missed  : [],
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Server error ${res.status}`);
    }

    const feedback = await res.json();
    renderFeedback(feedback);
    document.getElementById('summary-form').classList.add('hidden');
    document.getElementById('feedback-section').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    showError('feedback-error', err.message || 'Something went wrong. Please try again.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Get My Feedback';
  }
}

function renderFeedback(fb) {
  const { mainIdeaFeedback, vocabularyFeedback, wordsUsed, scoreNumerator, scoreDenominator } = fb;

  // Section A — Main Idea
  document.getElementById('fb-main-idea-text').textContent = mainIdeaFeedback;

  // Section B — Vocabulary (fraction score + 1-sentence feedback)
  document.getElementById('fb-score-num').textContent = `${scoreNumerator}/${scoreDenominator}`;
  document.getElementById('fb-score-msg').textContent = getFractionMessage(scoreNumerator, scoreDenominator);
  document.getElementById('fb-vocab-text').textContent = vocabularyFeedback;

  // Key words used chips
  const wordsList = document.getElementById('fb-words-used');
  if (wordsUsed && wordsUsed.length > 0) {
    wordsList.innerHTML = wordsUsed.map(w => `<span class="word-tag">${w}</span>`).join('');
    document.getElementById('fb-words-section').classList.remove('hidden');
  } else {
    document.getElementById('fb-words-section').classList.add('hidden');
  }
}

function initScreen4() {
  document.getElementById('mode-type-btn').addEventListener('click', () => setInputMode('type'));
  document.getElementById('mode-speak-btn').addEventListener('click', () => setInputMode('speak'));
  document.getElementById('submit-summary-btn').addEventListener('click', submitSummary);
  document.getElementById('new-session-btn').addEventListener('click', () => {
    // Reset state and go back to screen 1
    state.passage = '';
    state.vocabResults = null;
    state.vocabularyScore = 0;
    state.rereadMode = false;
    showScreen('screen1');
  });
  initSpeech();
}

// ── Boot ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initScreen1();
  initScreen2();
  initScreen3();
  initScreen4();
  showScreen('screen1');
});
