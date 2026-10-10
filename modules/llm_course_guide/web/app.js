/**
 * LLM Course Guide & Fundamentals Application Logic
 */

let appState = {
  currentLessonId: "math-linear-algebra",
  completedLessons: new Set(),
  bookmarks: new Set(),
  quizScores: {},
  notes: {},
  searchQuery: "",
  activeTrackFilter: "all",
  activeTab: "guide"
};

// API Endpoints
const API_BASE = "/api/llm-course";

// Initialization
document.addEventListener("DOMContentLoaded", async () => {
  initTheme();
  await loadProgress();
  setupEventListeners();
  renderSidebar();
  selectLesson(appState.currentLessonId || "math-linear-algebra");
  updateProgressWidget();
  initInteractiveSandboxes();
});

// Load state from backend or localStorage
async function loadProgress() {
  try {
    const res = await fetch(`${API_BASE}/progress`);
    if (res.ok) {
      const data = await res.json();
      if (data.completed_lessons) {
        appState.completedLessons = new Set(data.completed_lessons);
      }
      if (data.bookmarks) {
        appState.bookmarks = new Set(data.bookmarks);
      }
      if (data.quiz_scores) {
        appState.quizScores = data.quiz_scores;
      }
      if (data.notes) {
        appState.notes = data.notes;
      }
      if (data.current_lesson_id) {
        appState.currentLessonId = data.current_lesson_id;
      }
      return;
    }
  } catch (err) {
    console.warn("Could not load from API, falling back to localStorage", err);
  }

  // Local fallback
  const local = localStorage.getItem("one_ead_llm_progress");
  if (local) {
    try {
      const parsed = JSON.parse(local);
      appState.completedLessons = new Set(parsed.completedLessons || []);
      appState.bookmarks = new Set(parsed.bookmarks || []);
      appState.quizScores = parsed.quizScores || {};
      appState.notes = parsed.notes || {};
      appState.currentLessonId = parsed.currentLessonId || "math-linear-algebra";
    } catch (e) {}
  }
}

// Save state to backend
async function saveProgress() {
  const payload = {
    completed_lessons: Array.from(appState.completedLessons),
    bookmarks: Array.from(appState.bookmarks),
    quiz_scores: appState.quizScores,
    notes: appState.notes,
    current_lesson_id: appState.currentLessonId,
    last_updated: new Date().toISOString()
  };

  localStorage.setItem("one_ead_llm_progress", JSON.stringify({
    completedLessons: payload.completed_lessons,
    bookmarks: payload.bookmarks,
    quizScores: payload.quiz_scores,
    notes: payload.notes,
    currentLessonId: payload.current_lesson_id
  }));

  try {
    await fetch(`${API_BASE}/progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.warn("Could not save to API backend", err);
  }
}

// Reset Progress
async function resetProgress() {
  if (!confirm("Are you sure you want to reset all course progress and notes?")) return;
  appState.completedLessons.clear();
  appState.bookmarks.clear();
  appState.quizScores = {};
  appState.notes = {};
  appState.currentLessonId = "math-linear-algebra";

  try {
    await fetch(`${API_BASE}/reset`, { method: "POST" });
  } catch (e) {}
  localStorage.removeItem("one_ead_llm_progress");

  updateProgressWidget();
  renderSidebar();
  selectLesson("math-linear-algebra");
  showToast("Learning progress has been reset.");
}

// Theme Management (Light mode by default)
function initTheme() {
  let theme = localStorage.getItem("one_ead_llm_theme");
  if (!theme) {
    try {
      if (window.parent && window.parent.document) {
        theme = window.parent.document.documentElement.getAttribute("data-theme");
      }
    } catch (_) {}
    if (!theme) {
      theme = localStorage.getItem("ead-portal:theme") || "light";
    }
  }
  document.documentElement.setAttribute("data-theme", theme);
  const themeToggle = document.getElementById("themeToggle");
  if (themeToggle) {
    themeToggle.innerHTML = theme === "dark" ? getSunIcon() : getMoonIcon();
  }
}

// Event Listeners
function setupEventListeners() {
  // Theme Toggle
  const themeToggle = document.getElementById("themeToggle");
  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      const currentTheme = document.documentElement.getAttribute("data-theme") || "light";
      const newTheme = currentTheme === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", newTheme);
      localStorage.setItem("one_ead_llm_theme", newTheme);
      themeToggle.innerHTML = newTheme === "dark" ? getSunIcon() : getMoonIcon();
    });
  }

  // Listen to cross-frame or storage theme changes
  window.addEventListener("storage", (e) => {
    if (e.key === "ead-portal:theme" && e.newValue) {
      document.documentElement.setAttribute("data-theme", e.newValue);
      if (themeToggle) {
        themeToggle.innerHTML = e.newValue === "dark" ? getSunIcon() : getMoonIcon();
      }
    }
  });

  // Reset Progress Button
  const resetBtn = document.getElementById("btnReset");
  if (resetBtn) {
    resetBtn.addEventListener("click", resetProgress);
  }

  // Continue Learning Button
  const continueBtn = document.getElementById("btnContinue");
  if (continueBtn) {
    continueBtn.addEventListener("click", jumpToNextUnfinished);
  }

  // Search Input
  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      appState.searchQuery = e.target.value.toLowerCase().trim();
      renderSidebar();
    });
  }

  // Track Filter Chips
  const filterChips = document.querySelectorAll(".filter-chip");
  filterChips.forEach(chip => {
    chip.addEventListener("click", () => {
      filterChips.forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      appState.activeTrackFilter = chip.dataset.track;
      renderSidebar();
    });
  });

  // Tab Navigation Buttons
  const tabBtns = document.querySelectorAll(".tab-btn");
  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      tabBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      appState.activeTab = btn.dataset.tab;
      switchTab(btn.dataset.tab);
    });
  });

  // Previous & Next Lesson Navigation
  const prevBtn = document.getElementById("btnPrevLesson");
  const nextBtn = document.getElementById("btnNextLesson");
  if (prevBtn) {
    prevBtn.addEventListener("click", () => navigateLessonOffset(-1));
  }
  if (nextBtn) {
    nextBtn.addEventListener("click", () => navigateLessonOffset(1));
  }

  // Mark Completed Toggle
  const completeToggle = document.getElementById("btnCompleteToggle");
  if (completeToggle) {
    completeToggle.addEventListener("click", () => {
      const id = appState.currentLessonId;
      if (appState.completedLessons.has(id)) {
        appState.completedLessons.delete(id);
      } else {
        appState.completedLessons.add(id);
        showToast("🎉 Lesson marked as completed!");
      }
      saveProgress();
      updateCompleteButtonState();
      updateProgressWidget();
      renderSidebar();
    });
  }

  // Bookmark Toggle
  const bookmarkToggle = document.getElementById("btnBookmarkToggle");
  if (bookmarkToggle) {
    bookmarkToggle.addEventListener("click", () => {
      const id = appState.currentLessonId;
      if (appState.bookmarks.has(id)) {
        appState.bookmarks.delete(id);
        showToast("Bookmark removed.");
      } else {
        appState.bookmarks.add(id);
        showToast("🔖 Lesson saved to bookmarks!");
      }
      saveProgress();
      updateBookmarkButtonState();
      renderSidebar();
    });
  }

  // Save Notes Button
  const saveNotesBtn = document.getElementById("btnSaveNotes");
  if (saveNotesBtn) {
    saveNotesBtn.addEventListener("click", () => {
      const textarea = document.getElementById("notesTextarea");
      if (textarea) {
        appState.notes[appState.currentLessonId] = textarea.value;
        saveProgress();
        const status = document.getElementById("notesStatus");
        if (status) {
          status.textContent = "Saved to local disk at " + new Date().toLocaleTimeString();
        }
        showToast("Notes saved successfully.");
      }
    });
  }
}

// Render Sidebar syllabus list
function renderSidebar() {
  const container = document.getElementById("syllabusList");
  if (!container) return;
  container.innerHTML = "";

  const q = appState.searchQuery;
  const filter = appState.activeTrackFilter;

  // Filter lessons
  const filtered = COURSE_LESSONS.filter(l => {
    // Track filter
    if (filter === "bookmarked") {
      if (!appState.bookmarks.has(l.id)) return false;
    } else if (filter !== "all" && l.trackId !== filter) {
      return false;
    }

    // Search query
    if (q) {
      const matchTitle = l.title.toLowerCase().includes(q);
      const matchSummary = l.summary.toLowerCase().includes(q);
      const matchConcepts = l.keyConcepts.some(c => c.title.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q));
      if (!matchTitle && !matchSummary && !matchConcepts) return false;
    }

    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="padding: 24px 12px; text-align: center; color: var(--text-muted); font-size: 13px;">
        No lessons match your filter criteria.
      </div>
    `;
    return;
  }

  // Group by Track
  COURSE_TRACKS.forEach(track => {
    const trackLessons = filtered.filter(l => l.trackId === track.id);
    if (trackLessons.length === 0) return;

    const groupDiv = document.createElement("div");
    groupDiv.className = "syllabus-track-group";

    const completedInTrack = trackLessons.filter(l => appState.completedLessons.has(l.id)).length;

    groupDiv.innerHTML = `
      <div class="track-header">
        <span>${track.title}</span>
        <span class="track-count">${completedInTrack}/${trackLessons.length}</span>
      </div>
    `;

    trackLessons.forEach(lesson => {
      const isCompleted = appState.completedLessons.has(lesson.id);
      const isActive = lesson.id === appState.currentLessonId;
      const isBookmarked = appState.bookmarks.has(lesson.id);

      const card = document.createElement("div");
      card.className = `lesson-item-card ${isActive ? "active" : ""} ${isCompleted ? "completed" : ""}`;
      card.onclick = () => selectLesson(lesson.id);

      card.innerHTML = `
        <div class="lesson-step-badge">
          ${isCompleted ? '✓' : lesson.stepNumber}
        </div>
        <div class="lesson-meta">
          <div class="lesson-item-title">${lesson.title}</div>
          <div class="lesson-item-sub">
            <span>${lesson.readTime}</span>
            <span class="tag-badge">${lesson.badge}</span>
            ${isBookmarked ? '<span>🔖</span>' : ''}
          </div>
        </div>
      `;

      groupDiv.appendChild(card);
    });

    container.appendChild(groupDiv);
  });
}

// Select a lesson to display
function selectLesson(lessonId) {
  const lesson = COURSE_LESSONS.find(l => l.id === lessonId);
  if (!lesson) return;

  appState.currentLessonId = lessonId;
  saveProgress();

  // Highlight in sidebar
  document.querySelectorAll(".lesson-item-card").forEach(c => c.classList.remove("active"));
  renderSidebar();

  // Update Breadcrumb & Header
  document.getElementById("lessonBreadcrumb").textContent = `${lesson.unitName} • Step ${lesson.stepNumber} of ${COURSE_LESSONS.length}`;
  document.getElementById("lessonTitle").textContent = lesson.title;
  document.getElementById("lessonSummary").textContent = lesson.summary;

  updateCompleteButtonState();
  updateBookmarkButtonState();

  // Populate Lesson Guide Tab
  document.getElementById("eli5Text").textContent = lesson.eli5;

  // Key Concepts
  const conceptsGrid = document.getElementById("conceptsGrid");
  conceptsGrid.innerHTML = "";
  lesson.keyConcepts.forEach((c, idx) => {
    const box = document.createElement("div");
    box.className = "concept-box";
    box.innerHTML = `
      <h4><span>${idx + 1}.</span> ${c.title}</h4>
      <p>${c.desc}</p>
    `;
    conceptsGrid.appendChild(box);
  });

  // Glossary Table
  const glossaryTbody = document.getElementById("glossaryTbody");
  glossaryTbody.innerHTML = "";
  if (lesson.glossary && lesson.glossary.length > 0) {
    document.getElementById("glossaryCard").style.display = "block";
    lesson.glossary.forEach(g => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="glossary-term">${g.term}</td>
        <td>${g.def}</td>
      `;
      glossaryTbody.appendChild(tr);
    });
  } else {
    document.getElementById("glossaryCard").style.display = "none";
  }

  // Code Snippet & Colab Banner
  const codePre = document.getElementById("lessonCode");
  if (codePre) {
    codePre.textContent = lesson.codeSnippet.code;
  }

  const colabBanner = document.getElementById("colabHeroBanner");
  const btnColab = document.getElementById("btnOpenColab");
  if (lesson.colabUrl) {
    colabBanner.style.display = "flex";
    btnColab.href = lesson.colabUrl;
  } else {
    colabBanner.style.display = "none";
  }

  // Resources Tab
  const resourcesList = document.getElementById("resourcesList");
  resourcesList.innerHTML = "";
  lesson.resources.forEach(r => {
    const a = document.createElement("a");
    a.className = "resource-item";
    a.href = r.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.innerHTML = `
      <div class="resource-left">
        <span style="font-size: 16px;">🔗</span>
        <span class="resource-title">${r.title}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <span class="resource-tag">${r.type}</span>
        <span style="font-size: 12px; color: var(--text-muted);">Open ↗</span>
      </div>
    `;
    resourcesList.appendChild(a);
  });

  // Interactive Sandbox Tab Setup
  setupInteractiveTab(lesson);

  // Knowledge Check Tab
  renderQuiz(lesson);

  // Notes Tab
  const notesTextarea = document.getElementById("notesTextarea");
  if (notesTextarea) {
    notesTextarea.value = appState.notes[lessonId] || "";
  }
  const notesStatus = document.getElementById("notesStatus");
  if (notesStatus) {
    notesStatus.textContent = appState.notes[lessonId] ? "Notes saved on disk." : "No notes yet.";
  }

  // Bottom Prev / Next state
  updateNavigationButtons(lesson);

  // Scroll main view back to top
  const contentArea = document.querySelector(".content-area");
  if (contentArea) contentArea.scrollTop = 0;
}

// Update complete button visual
function updateCompleteButtonState() {
  const btn = document.getElementById("btnCompleteToggle");
  if (!btn) return;
  const isCompleted = appState.completedLessons.has(appState.currentLessonId);
  if (isCompleted) {
    btn.classList.add("completed");
    btn.innerHTML = `<span>✓</span> Completed`;
  } else {
    btn.classList.remove("completed");
    btn.innerHTML = `<span>○</span> Mark as Completed`;
  }
}

// Update bookmark button visual
function updateBookmarkButtonState() {
  const btn = document.getElementById("btnBookmarkToggle");
  if (!btn) return;
  const isBookmarked = appState.bookmarks.has(appState.currentLessonId);
  if (isBookmarked) {
    btn.classList.add("bookmarked");
    btn.title = "Remove bookmark";
  } else {
    btn.classList.remove("bookmarked");
    btn.title = "Bookmark this lesson";
  }
}

// Switch main reader tabs
function switchTab(tabName) {
  document.querySelectorAll(".tab-pane").forEach(pane => {
    pane.classList.remove("active");
  });
  const activePane = document.getElementById(`tab-${tabName}`);
  if (activePane) {
    activePane.classList.add("active");
  }
}

// Update Prev / Next buttons
function updateNavigationButtons(currentLesson) {
  const prevBtn = document.getElementById("btnPrevLesson");
  const nextBtn = document.getElementById("btnNextLesson");
  const currentIndex = COURSE_LESSONS.findIndex(l => l.id === currentLesson.id);

  if (prevBtn) {
    prevBtn.disabled = currentIndex <= 0;
  }
  if (nextBtn) {
    nextBtn.disabled = currentIndex >= COURSE_LESSONS.length - 1;
    if (currentIndex < COURSE_LESSONS.length - 1) {
      nextBtn.innerHTML = `Next: Step ${COURSE_LESSONS[currentIndex + 1].stepNumber} <span>→</span>`;
    } else {
      nextBtn.innerHTML = `Completed Course! <span>🎉</span>`;
    }
  }
}

// Navigate lesson by offset (-1 or +1)
function navigateLessonOffset(offset) {
  const currentIndex = COURSE_LESSONS.findIndex(l => l.id === appState.currentLessonId);
  const targetIndex = currentIndex + offset;
  if (targetIndex >= 0 && targetIndex < COURSE_LESSONS.length) {
    selectLesson(COURSE_LESSONS[targetIndex].id);
  }
}

// Jump to next unfinished lesson
function jumpToNextUnfinished() {
  const next = COURSE_LESSONS.find(l => !appState.completedLessons.has(l.id));
  if (next) {
    selectLesson(next.id);
    showToast(`Jumped to Step ${next.stepNumber}: ${next.title}`);
  } else {
    showToast("🎉 Congratulations! You have completed all lessons!");
  }
}

// Update progress bar & label in header
function updateProgressWidget() {
  const completedCount = appState.completedLessons.size;
  const total = COURSE_LESSONS.length;
  const percent = Math.round((completedCount / total) * 100);

  const fill = document.getElementById("progressBarFill");
  const label = document.getElementById("progressLabel");

  if (fill) fill.style.width = `${percent}%`;
  if (label) label.textContent = `${completedCount} / ${total} Completed (${percent}%)`;
}

// Render Quiz questions
function renderQuiz(lesson) {
  const container = document.getElementById("quizContainer");
  if (!container) return;
  container.innerHTML = "";

  if (!lesson.quiz || lesson.quiz.length === 0) {
    container.innerHTML = `<p style="color: var(--text-muted); font-size: 13.5px;">No quiz for this section.</p>`;
    return;
  }

  lesson.quiz.forEach((q, qIdx) => {
    const card = document.createElement("div");
    card.className = "quiz-card";

    const savedAnswer = appState.quizScores[`${lesson.id}_${qIdx}`];

    let optionsHtml = "";
    q.options.forEach((opt, optIdx) => {
      let extraClass = "";
      let disabled = "";
      if (savedAnswer !== undefined) {
        disabled = "disabled";
        if (optIdx === q.answerIndex) {
          extraClass = "correct";
        } else if (optIdx === savedAnswer) {
          extraClass = "incorrect";
        }
      }

      optionsHtml += `
        <button class="quiz-option-btn ${extraClass}" ${disabled} onclick="handleQuizAnswer('${lesson.id}', ${qIdx}, ${optIdx}, ${q.answerIndex})">
          ${String.fromCharCode(65 + optIdx)}. ${opt}
        </button>
      `;
    });

    let feedbackHtml = "";
    if (savedAnswer !== undefined) {
      const isCorrect = savedAnswer === q.answerIndex;
      feedbackHtml = `
        <div class="quiz-feedback show ${isCorrect ? 'success' : 'failure'}">
          <strong>${isCorrect ? '✓ Correct!' : '✗ Not quite.'}</strong> ${q.explanation}
        </div>
      `;
    }

    card.innerHTML = `
      <div class="quiz-question">${qIdx + 1}. ${q.question}</div>
      <div class="quiz-options">${optionsHtml}</div>
      ${feedbackHtml}
    `;

    container.appendChild(card);
  });
}

// Handle Quiz response
window.handleQuizAnswer = function(lessonId, questionIdx, selectedIdx, correctIdx) {
  appState.quizScores[`${lessonId}_${questionIdx}`] = selectedIdx;
  saveProgress();
  const lesson = COURSE_LESSONS.find(l => l.id === lessonId);
  renderQuiz(lesson);
};

// Copy Code Button
window.copyCodeSnippet = function() {
  const codePre = document.getElementById("lessonCode");
  if (!codePre) return;
  navigator.clipboard.writeText(codePre.textContent).then(() => {
    showToast("📋 Code snippet copied to clipboard!");
  }).catch(() => {
    showToast("Failed to copy snippet.");
  });
};

// Show temporary toast message
function showToast(message) {
  let toast = document.getElementById("appToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "appToast";
    toast.className = "toast-msg";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.classList.remove("show");
  }, 2600);
}

// Icons
function getSunIcon() {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`;
}
function getMoonIcon() {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
}

// Setup Interactive Tab according to lesson
function setupInteractiveTab(lesson) {
  const container = document.getElementById("interactiveTabContent");
  if (!container) return;

  const type = lesson.interactiveType;
  const tabBtn = document.querySelector(`.tab-btn[data-tab="interactive"]`);

  if (!type) {
    if (tabBtn) tabBtn.style.display = "none";
    container.innerHTML = "";
    return;
  }

  if (tabBtn) tabBtn.style.display = "inline-flex";

  if (type === "tokenizer") {
    container.innerHTML = getTokenizerSandboxHtml();
    attachTokenizerHandlers();
  } else if (type === "temperature") {
    container.innerHTML = getTemperatureSandboxHtml();
    attachTemperatureHandlers();
  } else if (type === "quantization") {
    container.innerHTML = getQuantizationSandboxHtml();
    attachQuantizationHandlers();
  } else if (type === "attention") {
    container.innerHTML = getAttentionSandboxHtml();
    attachAttentionHandlers();
  } else if (type === "embeddings") {
    container.innerHTML = getEmbeddingsSandboxHtml();
    attachEmbeddingsHandlers();
  }
}

function initInteractiveSandboxes() {
  // Global hooks
}

// ==========================================
// 1. TOKENIZER SANDBOX
// ==========================================
function getTokenizerSandboxHtml() {
  return `
    <div class="sandbox-card">
      <div class="card-title-row">
        <span class="card-icon" style="font-size: 20px;">✂️</span>
        <h3>Interactive Subword Tokenizer Simulator</h3>
      </div>
      <p style="font-size: 13.5px; color: var(--text-secondary);">
        Type or paste any text below to see how an LLM tokenizer breaks sentences into subword tokens and assigns unique numerical IDs.
      </p>

      <div class="tokenizer-input-area">
        <textarea id="tokenizerInput" class="tokenizer-textarea" placeholder="Type text here...">Transformers revolutionize natural language processing by calculating self-attention.</textarea>
      </div>

      <div class="tokenizer-stats-bar">
        <div>Characters: <span id="charCount" class="stat-highlight">0</span></div>
        <div>Tokens: <span id="tokenCount" class="stat-highlight">0</span></div>
        <div>Ratio: <span id="tokenRatio" class="stat-highlight">0</span> char/token</div>
      </div>

      <div class="tokenizer-chips-container" id="tokenChips"></div>
    </div>
  `;
}

function attachTokenizerHandlers() {
  const input = document.getElementById("tokenizerInput");
  if (!input) return;

  const update = () => {
    const text = input.value;
    const chipsContainer = document.getElementById("tokenChips");
    const charSpan = document.getElementById("charCount");
    const tokenSpan = document.getElementById("tokenCount");
    const ratioSpan = document.getElementById("tokenRatio");

    // Realistic subword chunking simulation (splitting prefixes, common words, punctuation)
    const tokens = simulateTokenizer(text);

    charSpan.textContent = text.length;
    tokenSpan.textContent = tokens.length;
    ratioSpan.textContent = tokens.length > 0 ? (text.length / tokens.length).toFixed(2) : "0";

    chipsContainer.innerHTML = "";
    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    const colors = isLight ? [
      { bg: "rgba(59, 130, 246, 0.12)", border: "#3b82f6", text: "#1d4ed8" },
      { bg: "rgba(139, 92, 246, 0.12)", border: "#8b5cf6", text: "#6d28d9" },
      { bg: "rgba(16, 185, 129, 0.12)", border: "#10b981", text: "#047857" },
      { bg: "rgba(245, 158, 11, 0.12)", border: "#f59e0b", text: "#b45309" },
      { bg: "rgba(236, 72, 153, 0.12)", border: "#ec4899", text: "#be185d" }
    ] : [
      { bg: "rgba(59, 130, 246, 0.2)", border: "#3b82f6", text: "#93c5fd" },
      { bg: "rgba(139, 92, 246, 0.2)", border: "#8b5cf6", text: "#c4b5fd" },
      { bg: "rgba(16, 185, 129, 0.2)", border: "#10b981", text: "#6ee7b7" },
      { bg: "rgba(245, 158, 11, 0.2)", border: "#f59e0b", text: "#fde68a" },
      { bg: "rgba(236, 72, 153, 0.2)", border: "#ec4899", text: "#fbcfe8" }
    ];

    tokens.forEach((t, i) => {
      const c = colors[i % colors.length];
      const chip = document.createElement("div");
      chip.className = "token-chip";
      chip.style.backgroundColor = c.bg;
      chip.style.borderColor = c.border;
      chip.style.color = c.text;

      // Hash to mock token ID
      const hashId = Math.abs(hashString(t.piece) % 32000) + 100;

      chip.innerHTML = `
        <span>${escapeHtml(t.piece)}</span>
        <span class="token-id">#${hashId}</span>
      `;
      chipsContainer.appendChild(chip);
    });
  };

  input.addEventListener("input", update);
  update();
}

function simulateTokenizer(str) {
  if (!str) return [];
  const regex = /(\s+|[a-zA-Z]+|[0-9]+|[^\s\w])/g;
  let matches = str.match(regex) || [];
  let result = [];

  matches.forEach(m => {
    if (m.length > 5 && /^[a-zA-Z]+$/.test(m)) {
      // Split into common subwords
      const mid = Math.ceil(m.length / 2);
      result.push({ piece: m.slice(0, mid) });
      result.push({ piece: m.slice(mid) });
    } else {
      result.push({ piece: m });
    }
  });

  return result;
}

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(31, h) + s.charCodeAt(i) | 0;
  }
  return h;
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ==========================================
// 2. TEMPERATURE & SAMPLING SANDBOX
// ==========================================
function getTemperatureSandboxHtml() {
  return `
    <div class="sandbox-card">
      <div class="card-title-row">
        <span class="card-icon" style="font-size: 20px;">🌡️</span>
        <h3>Sampling Visualizer: Temperature & Top-P Nucleus</h3>
      </div>
      <p style="font-size: 13.5px; color: var(--text-secondary);">
        See how Temperature scales logits and Top-P filters the distribution when predicting the next word after: <em>"The astronaut stepped onto the..."</em>
      </p>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
        <div class="slider-group">
          <div class="slider-label-row">
            <span>Temperature (Randomness)</span>
            <span id="tempVal" style="color: var(--accent-light);">0.7</span>
          </div>
          <input type="range" id="tempSlider" class="range-slider" min="0.05" max="2.0" step="0.05" value="0.7">
          <span style="font-size: 11px; color: var(--text-muted);">0 = Deterministic/Greedy, 2.0 = High Entropy/Creative</span>
        </div>

        <div class="slider-group">
          <div class="slider-label-row">
            <span>Top-P Nucleus (Cumulative Cutoff)</span>
            <span id="topPVal" style="color: var(--accent-light);">0.90</span>
          </div>
          <input type="range" id="topPSlider" class="range-slider" min="0.2" max="1.0" step="0.05" value="0.90">
          <span style="font-size: 11px; color: var(--text-muted);">Limits sampling to the smallest pool summing to P%</span>
        </div>
      </div>

      <div class="probs-chart-container" id="probsChartContainer"></div>
    </div>
  `;
}

function attachTemperatureHandlers() {
  const tempSlider = document.getElementById("tempSlider");
  const topPSlider = document.getElementById("topPSlider");
  const tempVal = document.getElementById("tempVal");
  const topPVal = document.getElementById("topPVal");

  // Raw logits for next word candidates
  const candidates = [
    { word: "moon", logit: 4.8 },
    { word: "surface", logit: 4.1 },
    { word: "ladder", logit: 2.8 },
    { word: "platform", logit: 2.1 },
    { word: "spaceship", logit: 1.4 },
    { word: "pizza", logit: -0.5 }
  ];

  const update = () => {
    const T = parseFloat(tempSlider.value);
    const P = parseFloat(topPSlider.value);

    tempVal.textContent = T.toFixed(2);
    topPVal.textContent = P.toFixed(2);

    // 1. Softmax with Temperature
    const expVals = candidates.map(c => Math.exp(c.logit / T));
    const sumExp = expVals.reduce((a, b) => a + b, 0);
    let probs = candidates.map((c, i) => ({
      word: c.word,
      prob: expVals[i] / sumExp
    }));

    // Sort descending
    probs.sort((a, b) => b.prob - a.prob);

    // 2. Apply Top-P threshold
    let cumulative = 0;
    const finalItems = probs.map(item => {
      cumulative += item.prob;
      const isIncluded = cumulative <= P || (cumulative - item.prob) < P;
      return {
        word: item.word,
        prob: item.prob,
        included: isIncluded
      };
    });

    const chart = document.getElementById("probsChartContainer");
    chart.innerHTML = "";

    finalItems.forEach(item => {
      const pct = (item.prob * 100).toFixed(1);
      const row = document.createElement("div");
      row.className = "prob-row";
      if (!item.included) row.style.opacity = "0.3";

      row.innerHTML = `
        <div class="prob-token-name">${item.word}</div>
        <div class="prob-bar-track">
          <div class="prob-bar-fill" style="width: ${pct}%; background: ${item.included ? 'linear-gradient(90deg, #3b82f6, #8b5cf6)' : '#4b5563'};"></div>
        </div>
        <div class="prob-pct-val">${pct}%</div>
      `;
      chart.appendChild(row);
    });
  };

  tempSlider.addEventListener("input", update);
  topPSlider.addEventListener("input", update);
  update();
}

// ==========================================
// 3. VRAM QUANTIZATION CALCULATOR
// ==========================================
function getQuantizationSandboxHtml() {
  return `
    <div class="sandbox-card">
      <div class="card-title-row">
        <span class="card-icon" style="font-size: 20px;">⚡</span>
        <h3>Model VRAM & Quantization Footprint Calculator</h3>
      </div>
      <p style="font-size: 13.5px; color: var(--text-secondary);">
        Dynamically calculate exact GPU VRAM needed for weights and KV Cache across different parameter sizes and quantization bitwidths.
      </p>

      <div class="vram-controls-grid">
        <div>
          <label style="font-size: 12px; color: var(--text-muted); font-weight: 600; display: block; margin-bottom: 6px;">Model Size</label>
          <select id="vramModelSelect" class="calc-select">
            <option value="1">1 Billion (e.g. SmolLM-1B)</option>
            <option value="3">3 Billion (e.g. Llama 3.2 3B)</option>
            <option value="7">7 Billion (e.g. Mistral 7B)</option>
            <option value="8" selected>8 Billion (e.g. Llama 3.1 8B)</option>
            <option value="14">14 Billion (e.g. Qwen 2.5 14B)</option>
            <option value="70">70 Billion (e.g. Llama 3.3 70B)</option>
          </select>
        </div>

        <div>
          <label style="font-size: 12px; color: var(--text-muted); font-weight: 600; display: block; margin-bottom: 6px;">Precision Format</label>
          <select id="vramPrecisionSelect" class="calc-select">
            <option value="4">FP32 (32-bit Full Precision)</option>
            <option value="2">FP16 / BF16 (16-bit Standard)</option>
            <option value="1">INT8 / GPTQ 8-bit</option>
            <option value="0.55" selected>GGUF Q4_K_M (4-bit Recommended)</option>
            <option value="0.35">GGUF Q2_K (2-bit Extreme Compression)</option>
          </select>
        </div>

        <div>
          <label style="font-size: 12px; color: var(--text-muted); font-weight: 600; display: block; margin-bottom: 6px;">Context Length</label>
          <select id="vramContextSelect" class="calc-select">
            <option value="4096">4,096 tokens (Standard)</option>
            <option value="8192" selected>8,192 tokens (Extended)</option>
            <option value="32768">32,768 tokens (Long context)</option>
            <option value="131072">131,072 tokens (Ultra context)</option>
          </select>
        </div>
      </div>

      <div class="vram-results-grid">
        <div class="vram-kpi-card">
          <span class="kpi-title">Model Weights</span>
          <span class="kpi-value" id="kpiWeights">0.0 GB</span>
          <span class="kpi-sub">Static parameters footprint</span>
        </div>
        <div class="vram-kpi-card">
          <span class="kpi-title">KV Cache Buffer</span>
          <span class="kpi-value" id="kpiKVCache">0.0 GB</span>
          <span class="kpi-sub">Dynamic attention activations</span>
        </div>
        <div class="vram-kpi-card">
          <span class="kpi-title">Total VRAM Needed</span>
          <span class="kpi-value" id="kpiTotalVram" style="color: #34d399;">0.0 GB</span>
          <span class="kpi-sub" id="kpiRecommendedHw">Recommended: GPU</span>
        </div>
      </div>
    </div>
  `;
}

function attachQuantizationHandlers() {
  const mSelect = document.getElementById("vramModelSelect");
  const pSelect = document.getElementById("vramPrecisionSelect");
  const cSelect = document.getElementById("vramContextSelect");

  const update = () => {
    const paramsB = parseFloat(mSelect.value);
    const bytesPerParam = parseFloat(pSelect.value);
    const ctxLen = parseInt(cSelect.value);

    // Weights VRAM (GB)
    const weightsGb = paramsB * bytesPerParam;

    // Approximate KV Cache (GB): 2 * 2 * n_layers * n_heads * d_head * ctx_len in FP16
    // Rule of thumb: ~0.5MB per 1000 tokens for 8B model with GQA
    const kvPer1k = (paramsB / 8) * 0.45;
    const kvGb = (ctxLen / 1000) * kvPer1k * 0.7;

    const totalVram = weightsGb + kvGb + 0.8; // +0.8 GB CUDA driver overhead

    document.getElementById("kpiWeights").textContent = `${weightsGb.toFixed(1)} GB`;
    document.getElementById("kpiKVCache").textContent = `${kvGb.toFixed(1)} GB`;
    document.getElementById("kpiTotalVram").textContent = `${totalVram.toFixed(1)} GB`;

    let hw = "NVIDIA RTX 3060 12GB";
    if (totalVram <= 8) hw = "Consumer GPU / 8GB VRAM or Apple M-series";
    else if (totalVram <= 12) hw = "RTX 3060 / 4070 (12GB VRAM)";
    else if (totalVram <= 16) hw = "Free Google Colab T4 / RTX 4080 (16GB)";
    else if (totalVram <= 24) hw = "NVIDIA RTX 3090 / 4090 (24GB VRAM)";
    else if (totalVram <= 48) hw = "2x RTX 3090 / A6000 (48GB) or Mac 64GB";
    else hw = "Data Center 2x A100 / H100 (80GB)";

    document.getElementById("kpiRecommendedHw").textContent = `Recommended: ${hw}`;
  };

  mSelect.addEventListener("change", update);
  pSelect.addEventListener("change", update);
  cSelect.addEventListener("change", update);
  update();
}

// ==========================================
// 4. ATTENTION HEATMAP SANDBOX
// ==========================================
function getAttentionSandboxHtml() {
  return `
    <div class="sandbox-card">
      <div class="card-title-row">
        <span class="card-icon" style="font-size: 20px;">🔍</span>
        <h3>Self-Attention Heatmap Explorer</h3>
      </div>
      <p style="font-size: 13.5px; color: var(--text-secondary);">
        Click on any word below to inspect which context words it attends to (notice how the pronoun <strong>"it"</strong> pays heavy attention to <strong>"animal"</strong>)!
      </p>

      <div class="attention-tokens-row" id="attnTokensRow"></div>

      <div id="attnExplanation" style="font-size: 13px; color: var(--accent-light); padding: 8px 12px; background: var(--bg-surface-elevated); border-radius: var(--radius-sm);">
        Click any token above to view attention distribution.
      </div>
    </div>
  `;
}

function attachAttentionHandlers() {
  const sentence = ["The", "animal", "didn't", "cross", "the", "street", "because", "it", "was", "too", "tired"];
  const weightsMap = {
    "it": { "animal": 0.85, "tired": 0.55, "was": 0.2, "cross": 0.15 },
    "animal": { "The": 0.7, "tired": 0.35 },
    "street": { "cross": 0.8, "the": 0.6 },
    "tired": { "animal": 0.8, "too": 0.75, "was": 0.4 }
  };

  const row = document.getElementById("attnTokensRow");
  const expl = document.getElementById("attnExplanation");
  row.innerHTML = "";

  sentence.forEach(word => {
    const btn = document.createElement("button");
    btn.className = "attn-token-btn";
    btn.textContent = word;
    btn.onclick = () => {
      document.querySelectorAll(".attn-token-btn").forEach(b => {
        b.classList.remove("selected", "highlighted");
        b.style.backgroundColor = "";
      });
      btn.classList.add("selected");

      const targets = weightsMap[word] || {};
      Object.keys(targets).forEach(tgt => {
        const val = targets[tgt];
        const match = Array.from(document.querySelectorAll(".attn-token-btn")).find(b => b.textContent === tgt);
        if (match) {
          match.classList.add("highlighted");
          match.style.backgroundColor = `rgba(139, 92, 246, ${val})`;
        }
      });

      if (word === "it") {
        expl.innerHTML = `🌟 <strong>Core Insight:</strong> The pronoun <strong>"it"</strong> pays 85% attention to <strong>"animal"</strong>, successfully resolving coreference!`;
      } else {
        expl.innerHTML = `Showing self-attention distribution for token: <strong>"${word}"</strong>.`;
      }
    };
    row.appendChild(btn);
  });

  // Auto select "it"
  const itBtn = Array.from(row.children).find(b => b.textContent === "it");
  if (itBtn) itBtn.click();
}

// ==========================================
// 5. EMBEDDINGS COSINE SIMILARITY SANDBOX
// ==========================================
function getEmbeddingsSandboxHtml() {
  return `
    <div class="sandbox-card">
      <div class="card-title-row">
        <span class="card-icon" style="font-size: 20px;">📐</span>
        <h3>Embedding Space & Cosine Similarity Calculator</h3>
      </div>
      <p style="font-size: 13.5px; color: var(--text-secondary);">
        Select two words to calculate their mathematical cosine similarity: <code>cos(θ) = (A · B) / (||A|| * ||B||)</code>.
      </p>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        <div>
          <label style="font-size: 12px; color: var(--text-muted); font-weight: 600; display: block; margin-bottom: 6px;">Word A</label>
          <select id="embWordA" class="calc-select">
            <option value="king" selected>King [0.92, 0.12, 0.85]</option>
            <option value="queen">Queen [0.90, 0.94, 0.82]</option>
            <option value="man">Man [0.15, 0.10, 0.12]</option>
            <option value="woman">Woman [0.18, 0.92, 0.14]</option>
            <option value="apple">Apple [0.02, 0.05, 0.01]</option>
          </select>
        </div>

        <div>
          <label style="font-size: 12px; color: var(--text-muted); font-weight: 600; display: block; margin-bottom: 6px;">Word B</label>
          <select id="embWordB" class="calc-select">
            <option value="king">King [0.92, 0.12, 0.85]</option>
            <option value="queen" selected>Queen [0.90, 0.94, 0.82]</option>
            <option value="man">Man [0.15, 0.10, 0.12]</option>
            <option value="woman">Woman [0.18, 0.92, 0.14]</option>
            <option value="apple">Apple [0.02, 0.05, 0.01]</option>
          </select>
        </div>
      </div>

      <div style="background: var(--bg-surface-elevated); padding: 18px; border-radius: var(--radius-md); border: 1px solid var(--border-light); display: flex; align-items: center; justify-content: space-between;">
        <div>
          <span style="font-size: 12px; color: var(--text-muted); display: block;">Calculated Cosine Similarity</span>
          <span id="embResultVal" style="font-size: 26px; font-weight: 800; color: #8b5cf6;">0.9542</span>
        </div>
        <div id="embResultVerdict" style="font-size: 13.5px; font-weight: 600; color: var(--success);">
          Very Strong Semantic Similarity
        </div>
      </div>
    </div>
  `;
}

function attachEmbeddingsHandlers() {
  const dict = {
    king:  [0.92, 0.12, 0.85],
    queen: [0.90, 0.94, 0.82],
    man:   [0.15, 0.10, 0.12],
    woman: [0.18, 0.92, 0.14],
    apple: [0.02, 0.05, 0.01]
  };

  const aSelect = document.getElementById("embWordA");
  const bSelect = document.getElementById("embWordB");
  const valSpan = document.getElementById("embResultVal");
  const verdict = document.getElementById("embResultVerdict");

  const update = () => {
    const vA = dict[aSelect.value];
    const vB = dict[bSelect.value];

    // Dot product
    const dot = vA.reduce((sum, a, i) => sum + a * vB[i], 0);
    const normA = Math.sqrt(vA.reduce((sum, a) => sum + a * a, 0));
    const normB = Math.sqrt(vB.reduce((sum, b) => sum + b * b, 0));
    const sim = dot / (normA * normB);

    valSpan.textContent = sim.toFixed(4);

    if (sim > 0.85) {
      verdict.textContent = "Very Strong Semantic Similarity";
      verdict.style.color = "var(--success)";
    } else if (sim > 0.5) {
      verdict.textContent = "Moderate Semantic Relatedness";
      verdict.style.color = "var(--warning)";
    } else {
      verdict.textContent = "Low / Distant Semantic Relation";
      verdict.style.color = "var(--danger)";
    }
  };

  aSelect.addEventListener("change", update);
  bSelect.addEventListener("change", update);
  update();
}
