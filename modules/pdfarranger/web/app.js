(() => {
  "use strict";

  const API = "/api/pdfarranger";
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const state = {
    installed: false,
    running: false,
    ready: false,
    url: "",
    watchToken: 0,
    pollingInstall: false,
  };

  let toastTimer;

  function toast(msg) {
    const el = $("toast");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.hidden = true;
    }, 3000);
  }

  async function api(path, method = "GET", body = null) {
    const opts = { method, headers: {} };
    if (body !== null) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(API + path, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
  }

  function setBadge(status, text) {
    const badge = $("status-badge");
    const textEl = $("status-text");
    if (!badge || !textEl) return;
    badge.className = `status-badge ${status}`;
    textEl.textContent = text;
  }

  function overlay(text, { spinner = true, reopen = false } = {}) {
    const ov = $("tool-overlay");
    const sp = $("tool-spinner");
    const txt = $("tool-overlay-text");
    const btn = $("btn-reopen");
    if (!ov) return;
    ov.hidden = false;
    if (sp) sp.hidden = !spinner;
    if (txt) txt.textContent = text;
    if (btn) btn.hidden = !reopen;
  }

  function hideOverlay() {
    const ov = $("tool-overlay");
    if (ov) ov.hidden = true;
  }

  async function startLaunch() {
    const token = ++state.watchToken;
    $("view-setup").hidden = true;
    $("view-running").hidden = false;

    setBadge("starting", "Starting...");
    overlay("Starting PDF Arranger\u2026");

    try {
      let st = await api("/launch", "POST");
      while (!(st.running && st.ready)) {
        if (token !== state.watchToken) return;
        await sleep(500);
        st = await api("/status");
      }

      state.running = true;
      state.ready = true;
      state.url = st.url;

      const frame = $("tool-frame");
      if (frame && frame.src !== st.url) {
        frame.src = st.url;
      }

      hideOverlay();
      setBadge("running", "Running");

      // Monitor process life
      while (token === state.watchToken) {
        await sleep(2500);
        st = await api("/status");
        if (!st.running) {
          state.running = false;
          setBadge("stopped", "Closed");
          if (frame) frame.removeAttribute("src");
          overlay("PDF Arranger was closed.", { spinner: false, reopen: true });
          return;
        }
      }
    } catch (e) {
      setBadge("stopped", "Error");
      overlay(`Could not launch: ${e.message}`, { spinner: false, reopen: true });
    }
  }

  async function startInstall() {
    if (state.pollingInstall) return;
    state.pollingInstall = true;
    const btn = $("btn-start-install");
    const progWrap = $("setup-progress-wrap");
    const progBar = $("progress-bar");
    const progMsg = $("setup-msg");
    const errEl = $("setup-error");

    if (btn) btn.disabled = true;
    if (progWrap) progWrap.hidden = false;
    if (errEl) errEl.hidden = true;

    try {
      await api("/install", "POST");
      while (true) {
        const st = await api("/status");
        const inst = st.install || {};

        if (progBar) progBar.style.width = `${inst.percent || 0}%`;
        if (progMsg) progMsg.textContent = inst.message || "Working...";

        if (inst.error) {
          if (errEl) {
            errEl.textContent = `Setup failed: ${inst.error}`;
            errEl.hidden = false;
          }
          if (btn) btn.disabled = false;
          state.pollingInstall = false;
          return;
        }

        if (!inst.active && st.installed) {
          state.installed = true;
          toast("PDF Arranger installed successfully!");
          state.pollingInstall = false;
          await startLaunch();
          return;
        }

        await sleep(800);
      }
    } catch (e) {
      if (errEl) {
        errEl.textContent = `Error: ${e.message}`;
        errEl.hidden = false;
      }
      if (btn) btn.disabled = false;
      state.pollingInstall = false;
    }
  }

  async function restartSession() {
    toast("Restarting PDF Arranger session...");
    overlay("Restarting PDF Arranger\u2026");
    setBadge("starting", "Restarting...");
    const frame = $("tool-frame");
    if (frame) {
      frame.style.background = "#ffffff";
    }
    try {
      await api("/restart", "POST");
      await startLaunch();
    } catch (e) {
      toast(`Restart failed: ${e.message}`);
    }
  }

  function wireEvents() {
    $("btn-start-install")?.addEventListener("click", () => {
      startInstall();
    });

    $("btn-reopen")?.addEventListener("click", () => {
      startLaunch();
    });

    $("btn-restart")?.addEventListener("click", () => {
      restartSession();
    });

    $("btn-open-tab")?.addEventListener("click", () => {
      const url = state.url || "http://127.0.0.1:8185/";
      window.open(url, "_blank");
    });
  }

  function syncTheme() {
    const theme = localStorage.getItem("ead-portal:theme") || "light";
    document.documentElement.setAttribute("data-theme", theme);
  }

  window.addEventListener("storage", (e) => {
    if (e.key === "ead-portal:theme") syncTheme();
  });

  async function init() {
    syncTheme();
    wireEvents();

    try {
      const st = await api("/status");
      state.installed = st.installed;
      state.url = st.url;

      if (!st.installed) {
        setBadge("stopped", "Setup Required");
        $("view-setup").hidden = false;
        $("view-running").hidden = true;
      } else {
        await startLaunch();
      }
    } catch (e) {
      console.error("Status check failed:", e);
      overlay(`Initialization error: ${e.message}`, { spinner: false });
    }
  }

  init();
})();
