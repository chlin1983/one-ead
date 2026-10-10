(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const frame = $("app-frame");
  const state = { status: null, shownKey: null, polling: null };

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
