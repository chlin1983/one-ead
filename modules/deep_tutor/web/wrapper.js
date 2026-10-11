(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const frame = $("app-frame");
  const state = { status: null, shownKey: null, polling: null };
  const AI_DISMISS_KEY = "oneead:deep-tutor:ai-banner-dismissed";
  const ai = { info: null, timer: null };

  async function api(path, method = "GET", body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`/api/deep-tutor${path}`, opts);
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try { detail = (await res.json()).detail || detail; } catch (_) {}
      throw new Error(detail);
    }
    return res.json();
  }

  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.hidden = true; }, 3500);
  }

  function setLog(lines) {
    const log = $("inst-log");
    const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
    log.textContent = lines.join("\n");
    if (atBottom) log.scrollTop = log.scrollHeight;
  }

  function render(s) {
    state.status = s;
    const v = s.version;
    const job = s.job;
    const svc = s.service;
    const installing = job.state === "running";

    $("chip-version").textContent = v ? v.label : "not installed";
    $("chk-auto").checked = s.config.auto_update;
    $("ai-banner").hidden = !(s.installed && s.llm_configured === false && localStorage.getItem(AI_DISMISS_KEY) !== "1");

    const chipUpd = $("chip-update");
    chipUpd.hidden = !(s.update_available && !installing);
    if (!chipUpd.hidden) chipUpd.textContent = `Update available: ${s.latest.label}`;
    $("btn-update").hidden = chipUpd.hidden;
    $("btn-update").disabled = installing;
    $("btn-check").disabled = installing;
    $("btn-restart").disabled = installing || !s.installed;
    $("btn-stop").disabled = installing || !svc.running;

    const chipState = $("chip-state");
    const stateKey = svc.ready ? "ready" : svc.running ? "starting" : "stopped";
    chipState.dataset.state = stateKey;
    chipState.textContent = { ready: "Running", starting: "Starting…", stopped: "Stopped" }[stateKey];

    const open = $("btn-open");
    open.hidden = !svc.ready;
    open.href = s.url;

    const showApp = svc.ready && !installing;
    if (showApp) {
      // A new version is served at the same URL, so force a reload when it changes.
      const src = `${s.url}?oe=${encodeURIComponent(v.version)}`;
      if (state.shownKey !== src) {
        state.shownKey = src;
        frame.src = src;
      }
    } else {
      state.shownKey = null;
      if (frame.getAttribute("src")) frame.removeAttribute("src");
    }
    frame.hidden = !showApp;
    $("installer").hidden = showApp;
    if (showApp) return;

    const failed = job.state === "error" && !s.installed;
    const track = $("inst-track");
    $("btn-retry").hidden = !(failed && !installing);
    $("btn-start").hidden = !(s.installed && !svc.running && !installing);

    if (installing) {
      $("inst-title").textContent = v ? "Updating DeepTutor" : "Setting up DeepTutor";
      $("inst-msg").textContent = `${job.message}${job.target ? ` (${job.target})` : ""}`;
      track.classList.remove("stopped");
      setLog(job.log);
    } else if (failed) {
      $("inst-title").textContent = "DeepTutor setup failed";
      $("inst-msg").textContent = job.error || job.message;
      track.classList.add("stopped");
      setLog(job.log);
    } else if (svc.running) {
      $("inst-title").textContent = "Starting DeepTutor";
      $("inst-msg").textContent = "The first start after an install can take a minute or two.";
      track.classList.remove("stopped");
      setLog(svc.log);
    } else {
      $("inst-title").textContent = "DeepTutor is stopped";
      $("inst-msg").textContent = job.state === "error"
        ? `Last update failed: ${job.error || job.message}`
        : "Start the service to use DeepTutor.";
      track.classList.add("stopped");
      setLog(svc.log.length ? svc.log : job.log);
    }
  }

  async function refresh() {
    const s = await api("/status");
    render(s);
    return s;
  }

  async function startService() {
    try {
      render(await api("/start", "POST"));
    } catch (e) {
      toast(`Could not start: ${e.message}`);
    }
  }

  async function startInstall(force) {
    try {
      render(await api("/install", "POST", { force: !!force }));
    } catch (e) {
      toast(`Could not start update: ${e.message}`);
    }
  }

  async function checkUpdates(manual) {
    $("btn-check").disabled = true;
    try {
      const s = await api("/check", "POST");
      render(s);
      if (manual) {
        if (s.latest_error && !s.latest) toast("Could not reach PyPI");
        else toast(s.update_available ? `Update available: ${s.latest.label}` : "Already up to date");
      }
      return s;
    } catch (e) {
      if (manual) toast(`Check failed: ${e.message}`);
    } finally {
      $("btn-check").disabled = !!(state.status && state.status.job.state === "running");
    }
  }

  async function saveConfig(patch) {
    try {
      render(await api("/config", "POST", patch));
    } catch (e) {
      toast(`Could not save setting: ${e.message}`);
    }
  }

  function setMenu(open) {
    $("menu").hidden = !open;
    $("btn-settings").setAttribute("aria-expanded", String(open));
  }
  $("btn-settings").addEventListener("click", (e) => {
    e.stopPropagation();
    setMenu($("menu").hidden);
  });
  document.addEventListener("click", (e) => { if (!e.target.closest(".menu-wrap")) setMenu(false); });
  window.addEventListener("blur", () => setMenu(false));

  $("btn-check").addEventListener("click", () => checkUpdates(true));
  $("btn-update").addEventListener("click", () => startInstall(false));
  $("btn-retry").addEventListener("click", () => startInstall(true));
  $("btn-start").addEventListener("click", startService);
  $("btn-restart").addEventListener("click", async () => {
    setMenu(false);
    try { render(await api("/restart", "POST")); } catch (e) { toast(`Restart failed: ${e.message}`); }
  });
  $("btn-stop").addEventListener("click", async () => {
    setMenu(false);
    try { render(await api("/stop", "POST")); } catch (e) { toast(`Stop failed: ${e.message}`); }
  });
  $("chk-auto").addEventListener("change", (e) => saveConfig({ auto_update: e.target.checked }));

  // ---- Local AI (Ollama) setup dialog. All installs are opt-in checkboxes; see setup_local_ai.py.
  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    Object.assign(n, props);
    kids.forEach((k) => n.append(k));
    return n;
  }
  const line = (text, cls = "") => el("div", { textContent: text, className: cls });
  const section = (title, ...nodes) => el("div", { className: "ai-sec" }, el("h3", { textContent: title }), ...nodes);
  function optRow(id, label, hint, checked) {
    const text = el("span", { textContent: label });
    if (hint) text.append(el("small", { textContent: hint }));
    return el("label", { className: "ai-opt" }, el("input", { type: "checkbox", id, checked }), text);
  }
  const checked = (id) => !!($(id) && $(id).checked);

  function buildAiBody(info) {
    const hw = info.hardware, d = info.deps;
    const gpu = hw.gpu ? `${hw.gpu.name}, ${hw.gpu.vram_gb} GB GPU memory` : "no GPU detected (models run on the CPU, slower)";
    const body = $("ai-body");
    body.replaceChildren();
    body.style.cssText = "display:flex;flex-direction:column;gap:10px";

    body.append(section("Your PC",
      line(`RAM ${hw.ram_gb ?? "?"} GB \u00b7 free disk ${hw.free_disk_gb ?? "?"} GB \u00b7 ${gpu}`),
      line("Minimum (Light): 8 GB RAM and about 6 GB free disk. Recommended (Standard): 16 GB RAM, a GPU with 6 GB+ memory and about 20 GB free disk. Models are downloaded from the internet once.")));

    const presets = section("Model set");
    Object.entries(info.presets).forEach(([key, p]) => {
      const rec = key === info.recommended_preset;
      const text = el("span", { textContent: `${p.label}: ${p.chat.join(" + ")} + embeddings ` });
      if (rec) text.append(el("span", { className: "ai-tag", textContent: "recommended for this PC" }));
      text.append(el("small", { textContent: `${p.detail}. Download about ${p.download_gb} GB.` }));
      presets.append(el("label", { className: "ai-opt" },
        el("input", { type: "radio", name: "ai-preset", value: key, checked: rec }), text));
    });
    body.append(presets);

    const deps = section("Install if missing");
    deps.append(d.node ? line("\u2713 Node.js installed", "ai-ok")
      : info.winget ? optRow("ai-install-node", "Install Node.js LTS (required by DeepTutor)", "About 30 MB. Windows may show a permission prompt.", true)
      : line("Node.js is missing. Install it from https://nodejs.org/", "ai-warn"));
    deps.append(d.python ? line("\u2713 uv / Python 3.11+ available", "ai-ok")
      : info.winget ? optRow("ai-install-uv", "Install uv (creates DeepTutor's Python environment)", "About 20 MB.", true)
      : line("uv or Python 3.11-3.14 is missing. See https://docs.astral.sh/uv/", "ai-warn"));
    deps.append(d.ollama ? line("\u2713 Ollama installed", "ai-ok")
      : info.winget ? optRow("ai-install-ollama", "Install Ollama (runs the models on this PC)", `About ${info.ollama_install_gb} GB of disk.`, true)
      : line("Ollama is missing. Install it from https://ollama.com/download", "ai-warn"));
    const missing = Object.keys(info.ollama_env_missing || {});
    if (missing.length) {
      deps.append(optRow("ai-ollama-env", "Apply recommended Ollama settings",
        `Sets ${missing.join(", ")} so chats do not fail on Ollama's small default context. Ollama is restarted.`, true));
    }
    body.append(deps, el("div", { id: "ai-warn", className: "ai-warn" }));
    $("ai-cmd").textContent = info.command;
    updateAiWarn();
  }

  function updateAiWarn() {
    const info = ai.info;
    const radio = document.querySelector('input[name="ai-preset"]:checked');
    if (!info || !radio) return;
    const p = info.presets[radio.value];
    const need = p.download_gb + (checked("ai-install-ollama") ? info.ollama_install_gb : 0);
    const notes = [];
    if (info.hardware.free_disk_gb != null && info.hardware.free_disk_gb < need + 2) {
      notes.push(`Free disk (${info.hardware.free_disk_gb} GB) is below the ~${(need + 2).toFixed(1)} GB needed.`);
    }
    if (info.hardware.ram_gb && info.hardware.ram_gb < p.min_ram_gb) {
      notes.push(`This set suggests at least ${p.min_ram_gb} GB RAM; you have ${info.hardware.ram_gb} GB. Try Light.`);
    }
    $("ai-warn").textContent = notes.join(" ");
    updateAiRun();
  }

  function updateAiRun() {
    const info = ai.info;
    if (!info) return;
    const running = info.job.state === "running";
    const ollamaOk = info.deps.ollama || checked("ai-install-ollama");
    $("btn-ai-run").disabled = running || info.busy || !ollamaOk;
    $("btn-ai-run").textContent = running ? "Running\u2026" : "Run setup now";
    $("btn-ai-run").title = !ollamaOk ? "Ollama is required. Tick the Ollama install option or install it yourself first." : "";
  }

  function updateAiJob(info) {
    ai.info = info;
    const job = info.job;
    const status = $("ai-status"), log = $("ai-log");
    status.hidden = job.state === "idle";
    status.textContent = job.state === "error" ? (job.error || job.message) : job.message;
    status.className = job.state === "error" ? "ai-warn" : job.state === "done" ? "ai-ok" : "muted";
    log.hidden = !job.log.length;
    log.textContent = job.log.join("\n");
    log.scrollTop = log.scrollHeight;
    updateAiRun();
  }

  function stopAiPolling() {
    clearInterval(ai.timer);
    ai.timer = null;
  }
  function startAiPolling() {
    if (ai.timer) return;
    ai.timer = setInterval(async () => {
      try {
        const info = await api("/local-ai");
        updateAiJob(info);
        if (info.job.state !== "running") {
          stopAiPolling();
          buildAiBody(info);
          toast(info.job.state === "done" ? "Local AI is ready" : "Local AI setup did not finish");
          refresh().catch(() => {});
        }
      } catch (_) { /* server restarting; keep polling */ }
    }, 1500);
  }

  async function openAi() {
    setMenu(false);
    $("ai-modal").hidden = false;
    try {
      const info = await api("/local-ai");
      buildAiBody(info);
      updateAiJob(info);
      if (info.job.state === "running") startAiPolling();
    } catch (e) {
      ai.info = null;
      $("ai-body").replaceChildren(line(
        `Could not read this PC's details (${e.message}). If One EAD was just updated, restart it so the setup endpoints load, then reopen this dialog.`,
        "ai-warn"));
      $("ai-cmd").textContent = "python modules\\deep_tutor\\setup_local_ai.py";
      $("btn-ai-run").disabled = true;
    }
  }
  function closeAi() {
    $("ai-modal").hidden = true;
  }

  async function runAi() {
    const radio = document.querySelector('input[name="ai-preset"]:checked');
    if (!radio) return;
    try {
      updateAiJob(await api("/local-ai/setup", "POST", {
        preset: radio.value,
        install_ollama: checked("ai-install-ollama"),
        install_node: checked("ai-install-node"),
        install_uv: checked("ai-install-uv"),
        ollama_env: checked("ai-ollama-env"),
      }));
      startAiPolling();
    } catch (e) {
      toast(`Could not start setup: ${e.message}`);
    }
  }

  $("btn-ai-menu").addEventListener("click", openAi);
  $("btn-ai-open").addEventListener("click", openAi);
  $("btn-ai-dismiss").addEventListener("click", () => {
    localStorage.setItem(AI_DISMISS_KEY, "1");
    $("ai-banner").hidden = true;
    toast("You can set up local AI later from the menu: Local AI setup");
  });
  $("btn-ai-close").addEventListener("click", closeAi);
  $("btn-ai-run").addEventListener("click", runAi);
  $("ai-body").addEventListener("change", updateAiWarn);
  $("ai-modal").addEventListener("click", (e) => { if (e.target === $("ai-modal")) closeAi(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAi(); });
  $("btn-ai-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("ai-cmd").textContent);
      toast("Command copied");
    } catch (_) {
      toast("Select the command and copy it manually");
    }
  });

  function syncTheme() {
    document.documentElement.setAttribute("data-theme", localStorage.getItem("ead-portal:theme") || "light");
  }
  window.addEventListener("storage", (e) => { if (e.key === "ead-portal:theme") syncTheme(); });

  async function init() {
    syncTheme();
    let s = await refresh();
    state.polling = setInterval(() => refresh().catch(() => {}), 2000);
    if (s.job.state === "running") return;

    if (!s.installed) {
      await startInstall(false);
      return;
    }
    if (!s.service.running) await startService();
    // Installed: look for a newer upstream release and, if enabled, update in the background.
    s = (await checkUpdates(false)) || s;
    if (s.config.auto_update && s.update_available) {
      toast(`Updating DeepTutor to ${s.latest.label}…`);
      await startInstall(false);
    }
  }

  init().catch((e) => {
    $("installer").hidden = false;
    $("inst-title").textContent = "DeepTutor plugin unavailable";
    $("inst-msg").textContent = e.message;
  });
})();
