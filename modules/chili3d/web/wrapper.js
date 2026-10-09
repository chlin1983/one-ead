(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const frame = $("app-frame");
  const state = { status: null, frameLoaded: false, loadedRef: null, polling: null, autoTried: false };

  async function api(path, method = "GET", body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`/api/chili3d${path}`, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.hidden = true; }, 3000);
  }

  function setSync(stateName, text) {
    $("sync").dataset.state = stateName;
    $("sync-text").textContent = text;
  }

  function loadApp() {
    frame.src = "app/";
    frame.hidden = false;
    $("btn-home").hidden = false;
    $("installer").hidden = true;
    state.frameLoaded = true;
    state.loadedRef = state.status && state.status.version && state.status.version.ref;
  }

  function render(s) {
    state.status = s;
    const v = s.version;
    const job = s.job;
    const running = job.state === "running";

    $("chip-version").textContent = v
      ? (v.channel === "main" ? `v${v.version} · ${v.label}` : `v${v.version}`)
      : "not installed";
    $("sel-channel").value = s.config.channel;
    $("chk-auto").checked = s.config.auto_update;

    const chipUpd = $("chip-update");
    chipUpd.hidden = !(s.update_available && !running);
    if (!chipUpd.hidden) chipUpd.textContent = `Update available: ${s.latest.label}`;
    $("btn-update").hidden = chipUpd.hidden;

    const needsReload = !!(v && state.frameLoaded && state.loadedRef && v.ref !== state.loadedRef);
    $("btn-reload").hidden = !needsReload;

    $("btn-check").disabled = running;
    $("btn-update").disabled = running;

    // Installer panel: shown on first install, or when a build fails with nothing installed.
    const showInstaller = !s.installed && !state.frameLoaded;
    $("installer").hidden = !showInstaller;
    if (showInstaller) {
      const failed = job.state === "error";
      $("inst-title").textContent = failed ? "Chili3D setup failed" : "Setting up Chili3D";
      $("inst-msg").textContent = !s.node_available
        ? "Node.js and npm are required to build Chili3D. Install Node.js 20+ and retry."
        : failed
          ? (job.error || job.message)
          : `${job.message}${job.target ? ` (${job.target})` : ""} — first build takes a few minutes.`;
      $("inst-track").classList.toggle("stopped", !running);
      $("btn-retry").hidden = running || !failed && s.node_available;
      const log = $("inst-log");
      const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
      log.textContent = job.log.join("\n");
      if (atBottom) log.scrollTop = log.scrollHeight;
    } else if (running) {
      chipUpd.hidden = false;
      chipUpd.textContent = `Building ${job.target || "update"}: ${job.message}`;
    } else if (v && job.state === "error") {
      chipUpd.hidden = false;
      chipUpd.textContent = "Update failed (previous version kept)";
      chipUpd.title = job.error || "";
    }
  }

  async function refresh() {
    const s = await api("/status");
    const wasRunning = state.status && state.status.job.state === "running";
    render(s);
    if (s.job.state === "running") startPolling();
    else stopPolling();
    if (wasRunning && s.job.state === "done") {
      toast(`Chili3D updated to ${s.version.label}`);
      if (!state.frameLoaded) loadApp();
      render(s);
    }
    return s;
  }

  function startPolling() {
    if (!state.polling) state.polling = setInterval(() => refresh().catch(() => {}), 1500);
  }
  function stopPolling() {
    clearInterval(state.polling);
    state.polling = null;
  }

  async function startInstall(force) {
    try {
      render(await api("/install", "POST", { force: !!force }));
      startPolling();
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
        if (s.latest_error && !s.latest) toast("Could not reach GitHub");
        else toast(s.update_available ? `Update available: ${s.latest.label}` : "Already up to date");
      }
      return s;
    } catch (e) {
      if (manual) toast(`Check failed: ${e.message}`);
    } finally {
      $("btn-check").disabled = state.status && state.status.job.state === "running";
    }
  }

  async function saveConfig(patch) {
    try {
      render(await api("/config", "POST", patch));
      if ("channel" in patch) await checkUpdates(true);
    } catch (e) {
      toast(`Could not save setting: ${e.message}`);
    }
  }

  window.addEventListener("message", (e) => {
    if (e.origin !== location.origin || !e.data || e.data.source !== "oneead-chili3d") return;
    const d = e.data;
    if (d.state === "saving") setSync("saving", "Saving to disk…");
    else if (d.state === "saved") setSync("saved", "Works backed up to disk");
    else if (d.state === "error") setSync("error", "Disk backup failed — retrying");
    else if (d.state === "restored") toast(`Restored ${d.count} work(s) from disk backup`);
  });

  $("btn-check").addEventListener("click", () => checkUpdates(true));

  // Chili3D exposes no API here, so trigger the same click as its own toolbar home icon.
  $("btn-home").addEventListener("click", () => {
    try {
      const doc = frame.contentDocument;
      const use = [...doc.querySelectorAll("use")].find(
        (u) => (u.getAttribute("href") || u.getAttribute("xlink:href")) === "#icon-home");
      const icon = use && use.closest("svg");
      if (!icon) throw new Error("home icon not found");
      icon.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: frame.contentWindow }));
    } catch (_) {
      toast("Use the home icon at the top-left of the Chili3D toolbar");
    }
  });
  $("btn-update").addEventListener("click", () => startInstall(false));
  $("btn-retry").addEventListener("click", () => startInstall(true));
  $("btn-reload").addEventListener("click", () => {
    loadApp();
    render(state.status);
  });
  $("sel-channel").addEventListener("change", (e) => saveConfig({ channel: e.target.value }));
  $("chk-auto").addEventListener("change", (e) => saveConfig({ auto_update: e.target.checked }));

  // Read by autosave.js inside the app frame (same origin); default is on.
  const AUTOSAVE_KEY = "oneead:chili3d:autosave";
  $("chk-autosave").checked = localStorage.getItem(AUTOSAVE_KEY) !== "0";
  $("chk-autosave").addEventListener("change", (e) => {
    localStorage.setItem(AUTOSAVE_KEY, e.target.checked ? "1" : "0");
    toast(e.target.checked ? "Autosave on" : "Autosave off");
  });

  // Full screen = browser fullscreen of this plugin page (hides browser + portal chrome);
  // the toolbar then floats and is revealed from the handle at the top edge.
  $("btn-fullscreen").addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (e) {
      toast(`Full screen is not available: ${e.message}`);
    }
  });
  document.addEventListener("fullscreenchange", () => {
    const on = !!document.fullscreenElement;
    document.body.classList.toggle("fs", on);
    document.body.classList.remove("peek");
    setMenu(false);
    $("fs-label").textContent = on ? "Exit Full Screen" : "Work in Full Screen";
  });
  const peek = (on) => {
    document.body.classList.toggle("peek", on);
    if (!on) setMenu(false);
  };
  let peekTimer = null;
  $("bar-handle").addEventListener("click", () => peek(true));
  document.querySelector(".c3d-bar").addEventListener("mouseenter", () => clearTimeout(peekTimer));
  document.querySelector(".c3d-bar").addEventListener("mouseleave", () => {
    if (document.body.classList.contains("fs")) peekTimer = setTimeout(() => peek(false), 500);
  });
  // Clicking into the Chili3D canvas moves focus to the inner frame: tuck the toolbar and menu away.
  window.addEventListener("blur", () => peek(false));

  // One compact menu for channel / auto-update / update check / source link.
  function setMenu(open) {
    $("menu").hidden = !open;
    $("btn-settings").setAttribute("aria-expanded", String(open));
  }
  $("btn-settings").addEventListener("click", (e) => {
    e.stopPropagation();
    setMenu($("menu").hidden);
  });
  document.addEventListener("click", (e) => { if (!e.target.closest(".menu-wrap")) setMenu(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setMenu(false); });
  window.addEventListener("message", (e) => {
    if (e.origin === location.origin && e.data && e.data.type === "ead:escape") setMenu(false);
  });

  function syncTheme() {
    document.documentElement.setAttribute("data-theme", localStorage.getItem("ead-portal:theme") || "light");
  }
  window.addEventListener("storage", (e) => { if (e.key === "ead-portal:theme") syncTheme(); });

  async function init() {
    syncTheme();
    let s = await refresh();
    if (s.installed) {
      loadApp();
      render(s);
    }
    if (s.job.state === "running") return;

    if (!s.installed) {
      if (s.node_available) await startInstall(false);
      return;
    }
    // Installed: look for a newer upstream build and, if enabled, update in the background.
    s = (await checkUpdates(false)) || s;
    if (s.config.auto_update && s.update_available) {
      toast(`Updating Chili3D to ${s.latest.label} in the background…`);
      await startInstall(false);
    }
  }

  init().catch((e) => {
    $("installer").hidden = false;
    $("inst-title").textContent = "Chili3D plugin unavailable";
    $("inst-msg").textContent = e.message;
  });
})();
