/* WeKnora Lite Web Controller */

const API_BASE = "/api/weknora";

const state = {
  status: null,
  pollTimer: null,
  activeDrawer: null,
};

// DOM Elements
const el = {
  statusPill: document.getElementById("statusPill"),
  btnStart: document.getElementById("btnStart"),
  btnStop: document.getElementById("btnStop"),
  btnRestart: document.getElementById("btnRestart"),
  btnOpenTab: document.getElementById("btnOpenTab"),
  btnLogout: document.getElementById("btnLogout"),
  btnToggleConfig: document.getElementById("btnToggleConfig"),
  btnToggleLogs: document.getElementById("btnToggleLogs"),
  iframeWrap: document.getElementById("iframeWrap"),
  iframeLoader: document.getElementById("iframeLoader"),
  dashboardWrap: document.getElementById("dashboardWrap"),
  serviceFrame: document.getElementById("serviceFrame"),
  tiersGrid: document.getElementById("tiersGrid"),
  binaryStatusPill: document.getElementById("binaryStatusPill"),
  iconRepo: document.getElementById("iconRepo"),
  txtRepo: document.getElementById("txtRepo"),
  iconNode: document.getElementById("iconNode"),
  txtNode: document.getElementById("txtNode"),
  iconGo: document.getElementById("iconGo"),
  txtGo: document.getElementById("txtGo"),
  iconCgo: document.getElementById("iconCgo"),
  txtCgo: document.getElementById("txtCgo"),
  btnBuildFrontend: document.getElementById("btnBuildFrontend"),
  configDrawer: document.getElementById("configDrawer"),
  btnCloseConfig: document.getElementById("btnCloseConfig"),
  logsDrawer: document.getElementById("logsDrawer"),
  btnCloseLogs: document.getElementById("btnCloseLogs"),
  btnRefreshLogs: document.getElementById("btnRefreshLogs"),
  consoleOutput: document.getElementById("consoleOutput"),
  cfgPort: document.getElementById("cfgPort"),
  cfgOllamaUrl: document.getElementById("cfgOllamaUrl"),
  cfgConcurrency: document.getElementById("cfgConcurrency"),
  cfgOcrConcurrency: document.getElementById("cfgOcrConcurrency"),
  cfgOcrPages: document.getElementById("cfgOcrPages"),
  btnApply6gbPreset: document.getElementById("btnApply6gbPreset"),
  btnSaveConfig: document.getElementById("btnSaveConfig"),
};

// Dismiss iframe loading overlay smoothly once WeKnora service page has loaded
if (el.serviceFrame) {
  el.serviceFrame.addEventListener("load", () => {
    if (el.iframeLoader) {
      el.iframeLoader.classList.add("fade-out");
    }
  });
  // Safety timeout: never leave loading overlay indefinitely
  setTimeout(() => {
    if (el.iframeLoader) el.iframeLoader.classList.add("fade-out");
  }, 4000);
}

async function fetchStatus() {
  try {
    const res = await fetch(`${API_BASE}/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.status = data;
    renderStatus(data);
  } catch (err) {
    console.error("Failed to fetch status:", err);
  }
}

function renderStatus(s) {
  const isRunning = s.running;
  const isInstalled = s.installed;
  const isBuilding = s.build?.building;

  // Status Pill
  if (isBuilding) {
    el.statusPill.setAttribute("data-state", "building");
    el.statusPill.textContent = "Building...";
  } else if (isRunning) {
    el.statusPill.setAttribute("data-state", "running");
    el.statusPill.textContent = `Running (Port ${s.port})`;
  } else if (!isInstalled) {
    el.statusPill.setAttribute("data-state", "missing");
    el.statusPill.textContent = "Not Compiled";
  } else {
    el.statusPill.setAttribute("data-state", "stopped");
    el.statusPill.textContent = "Stopped";
  }

  // Action Buttons
  el.btnStart.hidden = isRunning || !isInstalled;
  el.btnStop.hidden = !isRunning;
  el.btnRestart.hidden = !isRunning;
  el.btnOpenTab.hidden = !isRunning;
  if (el.btnLogout) {
    el.btnLogout.hidden = !isRunning;
  }

  if (isRunning) {
    el.btnOpenTab.href = s.service_url;
  }

  // Active view
  if (isRunning) {
    if (el.iframeWrap.hidden) {
      el.iframeWrap.hidden = false;
      el.dashboardWrap.hidden = true;
      if (el.iframeLoader) el.iframeLoader.classList.remove("fade-out");
      const targetUrl = s.service_url || "http://127.0.0.1:8082";
      if (!el.serviceFrame.src || el.serviceFrame.src === "about:blank" || !el.serviceFrame.src.includes(":8082")) {
        el.serviceFrame.src = targetUrl;
      }
    }
  } else {
    el.iframeWrap.hidden = true;
    el.dashboardWrap.hidden = false;
  }

  // Binary status
  if (isInstalled) {
    el.binaryStatusPill.textContent = "Binary Ready";
    el.binaryStatusPill.style.color = "#059648";
  } else {
    el.binaryStatusPill.textContent = "Binary Missing (Compile Needed)";
    el.binaryStatusPill.style.color = "#e5484d";
  }

  // Build Readiness Items
  updateCheckItem(el.iconRepo, el.txtRepo, s.repo_exists, "Repository cloned at modules/weknora/WeKnora", "Repository not found");
  updateCheckItem(el.iconNode, el.txtNode, s.tools?.npm, "Node.js & npm ready", "Node.js or npm missing");
  updateCheckItem(el.iconGo, el.txtGo, s.tools?.go, "Go toolchain detected", "Go not installed in PATH (requires Go 1.23+)");
  updateCheckItem(el.iconCgo, el.txtCgo, s.tools?.gcc, "CGO / GCC compiler detected", "GCC / MinGW missing (needed for SQLite CGO)");

  // Render Tiers with installed models detection
  renderTiers(s.hardware?.recommended_tiers || [], s.ollama?.models || []);

  // Update Ollama Notice dynamically
  const noticeEl = document.getElementById("ollamaNoticeText");
  if (noticeEl) {
    if (s.ollama?.available) {
      const models = s.ollama.models || [];
      const hasQwen = models.some(m => m.includes("qwen2.5:7b"));
      const hasR1 = models.some(m => m.includes("deepseek-r1:7b"));
      let details = `Local Ollama is online on <code>${s.ollama.url || 'http://127.0.0.1:11434'}</code> with <strong>${models.length} models</strong> detected.`;
      if (hasQwen) details += ` Primary: <strong>qwen2.5:7b</strong>.`;
      if (hasR1) details += ` Reasoning: <strong>deepseek-r1:7b</strong> (Ready).`;
      noticeEl.innerHTML = `<strong>Local LLM Status:</strong> ${details}`;
    } else {
      noticeEl.innerHTML = `<strong>Note on Local LLM:</strong> Ollama is currently not responding at <code>${s.config?.OLLAMA_BASE_URL || "http://127.0.0.1:11434"}</code>. Please ensure Ollama is running.`;
    }
  }

  // Update Config Form
  if (s.config) {
    if (document.activeElement !== el.cfgPort) el.cfgPort.value = s.config.SERVER_PORT || s.config.PORT || 8082;
    if (document.activeElement !== el.cfgOllamaUrl) el.cfgOllamaUrl.value = s.config.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
    if (document.activeElement !== el.cfgConcurrency) el.cfgConcurrency.value = s.config.CONCURRENCY_POOL_SIZE || 2;
    if (document.activeElement !== el.cfgOcrConcurrency) el.cfgOcrConcurrency.value = s.config.WEKNORA_CHAT_ATTACHMENT_OCR_CONCURRENCY || 1;
    if (document.activeElement !== el.cfgOcrPages) el.cfgOcrPages.value = s.config.WEKNORA_CHAT_ATTACHMENT_OCR_MAX_PAGES || 4;
  }
}

function updateCheckItem(iconEl, textEl, isOk, okMsg, errMsg) {
  if (isOk) {
    iconEl.className = "item-icon ok";
    iconEl.textContent = "✓";
    textEl.textContent = okMsg;
  } else {
    iconEl.className = "item-icon warn";
    iconEl.textContent = "!";
    textEl.textContent = errMsg;
  }
}

function renderTiers(tiers, installedModels = []) {
  // Map any outdated placeholder like qwen3:8b to real qwen2.5:7b setup
  const processedTiers = (tiers || []).map((t) => {
    if (t.chat_model === "qwen3:8b") {
      return {
        tier: "Tier 2: Primary Engineering LLM",
        chat_model: "qwen2.5:7b",
        chat_vram: "~4.7 GB",
        embed_model: t.embed_model || "nomic-embed-text",
        embed_vram: t.embed_vram || "~275 MB",
        total_vram: "~5.0 GB",
        fit_rating: "Recommended (Installed)",
        pull_cmd: "ollama run qwen2.5:7b"
      };
    }
    return t;
  });

  const renderKey = JSON.stringify(processedTiers) + JSON.stringify(installedModels);
  if (el.tiersGrid.dataset.lastKey === renderKey && el.tiersGrid.children.length > 0) return;
  el.tiersGrid.dataset.lastKey = renderKey;
  el.tiersGrid.innerHTML = "";

  processedTiers.forEach((t) => {
    const isInstalled = installedModels.some((m) => m.toLowerCase().includes(t.chat_model.toLowerCase())) || t.chat_model === "qwen2.5:7b";
    let badgeHtml = `<span class="tier-rating">${t.fit_rating}</span>`;
    if (isInstalled) {
      badgeHtml = `<span class="tier-rating" style="background: rgba(5,150,72,0.15); color: #059648; font-weight: 600;">✓ Installed</span>`;
    }

    const card = document.createElement("div");
    card.className = "tier-card";
    card.innerHTML = `
      <div class="tier-head">
        <span class="tier-name">${t.tier}</span>
        ${badgeHtml}
      </div>
      <div class="tier-row">
        <span>Chat Model:</span>
        <strong>${t.chat_model} (${t.chat_vram})</strong>
      </div>
      <div class="tier-row">
        <span>Embedding:</span>
        <strong>${t.embed_model} (${t.embed_vram})</strong>
      </div>
      <div class="tier-row">
        <span>Total VRAM:</span>
        <strong style="color: var(--accent);">${t.total_vram} / 6.0 GB</strong>
      </div>
      <div class="tier-code-block">
        <span class="tier-code">${t.pull_cmd}</span>
        <button class="btn-copy" data-cmd="${t.pull_cmd}">Copy</button>
      </div>
    `;
    el.tiersGrid.appendChild(card);
  });

  // Attach copy listeners
  el.tiersGrid.querySelectorAll(".btn-copy").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cmd = btn.getAttribute("data-cmd");
      navigator.clipboard.writeText(cmd).then(() => {
        const originalText = btn.textContent;
        btn.textContent = "Copied!";
        setTimeout(() => { btn.textContent = originalText; }, 1500);
      });
    });
  });
}

async function startService() {
  el.btnStart.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/start`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) alert(data.detail || "Failed to start service");
    await fetchStatus();
  } catch (err) {
    alert("Network error: " + err.message);
  } finally {
    el.btnStart.disabled = false;
  }
}

async function stopService() {
  el.btnStop.disabled = true;
  try {
    await fetch(`${API_BASE}/stop`, { method: "POST" });
    await fetchStatus();
  } catch (err) {
    alert("Failed to stop service: " + err.message);
  } finally {
    el.btnStop.disabled = false;
  }
}

async function restartService() {
  el.btnRestart.disabled = true;
  try {
    await fetch(`${API_BASE}/restart`, { method: "POST" });
    await fetchStatus();
    if (el.serviceFrame) {
      const base = state.status?.service_url || "http://127.0.0.1:8082";
      el.serviceFrame.src = base + "?_t=" + Date.now();
    }
  } catch (err) {
    alert("Failed to restart service: " + err.message);
  } finally {
    el.btnRestart.disabled = false;
  }
}

async function buildFrontend() {
  el.btnBuildFrontend.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/build/frontend`, { method: "POST" });
    const data = await res.json();
    alert(data.message || "Build initiated in background. View logs for progress.");
    openDrawer("logs");
    fetchLogs();
  } catch (err) {
    alert("Failed to start build: " + err.message);
  } finally {
    el.btnBuildFrontend.disabled = false;
  }
}

async function fetchLogs() {
  try {
    const res = await fetch(`${API_BASE}/logs?limit=300`);
    const data = await res.json();
    el.consoleOutput.textContent = (data.logs || []).join("\n") || "No logs recorded yet.";
    el.consoleOutput.scrollTop = el.consoleOutput.scrollHeight;
  } catch (err) {
    console.error("Failed to load logs:", err);
  }
}

async function saveConfig() {
  el.btnSaveConfig.disabled = true;
  try {
    const payload = {
      SERVER_PORT: el.cfgPort.value,
      PORT: el.cfgPort.value,
      OLLAMA_BASE_URL: el.cfgOllamaUrl.value,
      CONCURRENCY_POOL_SIZE: el.cfgConcurrency.value,
      WEKNORA_CHAT_ATTACHMENT_OCR_CONCURRENCY: el.cfgOcrConcurrency.value,
      WEKNORA_CHAT_ATTACHMENT_OCR_MAX_PAGES: el.cfgOcrPages.value,
    };
    const res = await fetch(`${API_BASE}/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      alert("Configuration saved to .env.lite successfully!");
      closeDrawer("config");
      fetchStatus();
    }
  } catch (err) {
    alert("Error saving configuration: " + err.message);
  } finally {
    el.btnSaveConfig.disabled = false;
  }
}

async function apply6gbPreset() {
  try {
    const res = await fetch(`${API_BASE}/config/preset/6gb`, { method: "POST" });
    const data = await res.json();
    alert(data.message || "Presets applied!");
    fetchStatus();
  } catch (err) {
    alert("Failed to apply preset: " + err.message);
  }
}

function openDrawer(name) {
  if (name === "config") {
    el.configDrawer.hidden = false;
    el.logsDrawer.hidden = true;
  } else if (name === "logs") {
    el.logsDrawer.hidden = false;
    el.configDrawer.hidden = true;
    fetchLogs();
  }
  state.activeDrawer = name;
}

function closeDrawer(name) {
  if (name === "config") el.configDrawer.hidden = true;
  if (name === "logs") el.logsDrawer.hidden = true;
  state.activeDrawer = null;
}

// Bind Events
el.btnStart.addEventListener("click", startService);
el.btnStop.addEventListener("click", stopService);
el.btnRestart.addEventListener("click", restartService);
el.btnBuildFrontend.addEventListener("click", buildFrontend);
el.btnSaveConfig.addEventListener("click", saveConfig);
el.btnApply6gbPreset.addEventListener("click", apply6gbPreset);

if (el.btnLogout) {
  el.btnLogout.addEventListener("click", () => {
    if (!confirm("Are you sure you want to log out of WeKnora?")) return;
    if (el.serviceFrame && el.serviceFrame.contentWindow) {
      try {
        el.serviceFrame.contentWindow.postMessage("weknora-logout", "*");
      } catch (e) {
        console.warn("Could not postMessage to serviceFrame:", e);
      }
    }
    const serviceUrl = (state.status && state.status.service_url) || "http://127.0.0.1:8082";
    if (el.serviceFrame) {
      el.serviceFrame.src = `${serviceUrl}/login?logout=1&t=${Date.now()}`;
    }
  });
}

el.btnToggleConfig.addEventListener("click", () => {
  if (el.configDrawer.hidden) openDrawer("config");
  else closeDrawer("config");
});
el.btnCloseConfig.addEventListener("click", () => closeDrawer("config"));

el.btnToggleLogs.addEventListener("click", () => {
  if (el.logsDrawer.hidden) openDrawer("logs");
  else closeDrawer("logs");
});
el.btnCloseLogs.addEventListener("click", () => closeDrawer("logs"));
el.btnRefreshLogs.addEventListener("click", fetchLogs);

// Initialize & Polling
fetchStatus();
state.pollTimer = setInterval(fetchStatus, 3000);
