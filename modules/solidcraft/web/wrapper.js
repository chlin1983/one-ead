(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const frame = $("app-frame");
  const state = {
    status: null,
    frameLoaded: false,
    loadedTag: null,
    polling: null,
    autoInstallTriggered: false,
  };

  async function api(path, method = "GET", body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`/api/solidcraft${path}`, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.hidden = true; }, 3200);
  }

  function formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  }

  function setSync(stateName, text) {
    $("sync").dataset.state = stateName;
    $("sync-text").textContent = text;
  }

  function loadApp() {
    frame.src = "app/";
    frame.hidden = false;
    $("installer").hidden = true;
    state.frameLoaded = true;
    state.loadedTag = state.status && state.status.version && state.status.version.tag;
  }

  function render(s) {
    state.status = s;
    const v = s.version;
    const job = s.job;
    const running = job.state === "running";

    $("chip-version").textContent = v ? v.tag : "not installed";
    $("sel-channel").value = s.config.channel;
    $("chk-auto").checked = s.config.auto_update;
    if ($("sel-interval")) $("sel-interval").value = String(s.config.check_interval_hours || 24);

    // Update notification & button
    const chipUpd = $("chip-update");
    chipUpd.hidden = !(s.update_available && !running);
    if (!chipUpd.hidden && s.latest) {
      chipUpd.textContent = `Update available: ${s.latest.label}`;
    }
    $("btn-update").hidden = chipUpd.hidden;

    const needsReload = !!(v && state.frameLoaded && state.loadedTag && v.tag !== state.loadedTag);
    $("btn-reload").hidden = !needsReload;

    $("btn-check").disabled = running;
    $("btn-update").disabled = running;

    // Installer panel: shown when not installed, or downloading/installing
    const showInstaller = !s.installed && !state.frameLoaded;
    $("installer").hidden = !showInstaller;

    if (showInstaller) {
      const failed = job.state === "error";
      $("inst-title").textContent = failed ? "SolidCraft setup failed" : "Setting up SolidCraft";
      $("inst-msg").textContent = failed
        ? (job.error || job.message)
        : (job.message ? `${job.message} (${job.target || ""})` : "Preparing download from GitHub...");
      $("inst-track").classList.toggle("stopped", !running);
      $("btn-retry").hidden = running || !failed;

      const log = $("inst-log");
      const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 10;
      log.textContent = (job.log || []).join("\n");
      if (atBottom) log.scrollTop = log.scrollHeight;
    } else if (running) {
      chipUpd.hidden = false;
      chipUpd.textContent = `Installing ${job.target || "update"}: ${job.message}`;
    }

    if (s.store) {
      $("projects-count").textContent = s.store.count || 0;
    }
  }

  async function refresh() {
    try {
      const s = await api("/status");
      const wasRunning = state.status && state.status.job.state === "running";
      render(s);

      if (s.job.state === "running") {
        startPolling();
      } else {
        stopPolling();
      }

      if (wasRunning && s.job.state === "done") {
        toast(`SolidCraft updated to ${s.version.label}`);
        if (!state.frameLoaded) loadApp();
        render(s);
      }

      // Auto-trigger installation if not installed yet
      if (!s.installed && !state.autoInstallTriggered && s.job.state !== "running") {
        state.autoInstallTriggered = true;
        await api("/install", "POST", { force: false });
        startPolling();
      } else if (s.installed && !state.frameLoaded && s.job.state !== "running") {
        loadApp();
      }
    } catch (e) {
      console.warn("[One EAD SolidCraft] Status refresh error:", e);
    }
  }

  function startPolling() {
    if (state.polling) return;
    state.polling = setInterval(refresh, 1200);
  }

  function stopPolling() {
    if (!state.polling) return;
    clearInterval(state.polling);
    state.polling = null;
  }

  /* ------------------- Projects Modal ------------------- */
  async function loadProjectsList() {
    try {
      const data = await api("/store/index");
      const projects = data.projects || [];
      $("projects-count").textContent = projects.length;

      let totalBytes = 0;
      const listEl = $("projects-list");
      listEl.innerHTML = "";

      if (projects.length === 0) {
        listEl.innerHTML = '<div class="empty-state">No saved designs yet. Any 3D model created in SolidCraft is automatically backed up here.</div>';
      } else {
        for (const p of projects) {
          totalBytes += p.size;
          const row = document.createElement("div");
          row.className = "project-row";

          const isRec = p.is_recovery;
          const iconSvg = isRec
            ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>'
            : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>';

          const dateStr = new Date(p.mtime * 1000).toLocaleString();

          row.innerHTML = `
            <div class="project-info">
              <div class="project-icon" title="${isRec ? "Autosave Recovery File" : "SolidCraft CAD Design"}">${iconSvg}</div>
              <div>
                <div class="project-name">${p.filename}</div>
                <div class="project-meta">${formatBytes(p.size)} • Last modified ${dateStr}</div>
              </div>
            </div>
            <div class="project-actions">
              <button class="btn" data-act="open" data-file="${p.filename}" title="Load file into browser OPFS">Open</button>
              <a class="btn" href="/api/solidcraft/store/download/${encodeURIComponent(p.filename)}" download="${p.filename}" title="Export .solidcraft file to your PC">Export</a>
              <button class="btn icon" data-act="del" data-file="${p.filename}" title="Move to trash" style="color: var(--danger, #ef4444);">&times;</button>
            </div>
          `;
          listEl.appendChild(row);
        }
      }
      $("storage-summary").textContent = `Total: ${projects.length} files (${formatBytes(totalBytes)})`;
    } catch (e) {
      console.warn("Failed to load projects list", e);
    }
  }

  // Handle Projects Actions
  $("projects-list").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    const file = btn.dataset.file;

    if (act === "del") {
      if (confirm(`Move "${file}" to trash?`)) {
        await api(`/store/file/${encodeURIComponent(file)}`, "DELETE");
        toast(`Moved ${file} to trash`);
        loadProjectsList();
      }
    } else if (act === "open") {
      frame.contentWindow.postMessage({ target: "oneead-solidcraft", action: "load-file", filename: file }, location.origin);
      $("projects-modal").hidden = true;
      toast(`Loading "${file}" into SolidCraft...`);
    }
  });

  $("btn-projects").addEventListener("click", () => {
    $("projects-modal").hidden = false;
    loadProjectsList();
  });
  $("btn-close-projects").addEventListener("click", () => {
    $("projects-modal").hidden = true;
  });
  $("projects-modal").addEventListener("click", (e) => {
    if (e.target === $("projects-modal")) $("projects-modal").hidden = true;
  });

  // Import file
  $("btn-import-project").addEventListener("click", () => $("file-import").click());
  $("file-import").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    try {
      toast(`Importing ${file.name}...`);
      const res = await fetch("/api/solidcraft/store/upload", { method: "POST", body: form });
      if (!res.ok) throw new Error("Upload failed");
      toast(`Imported ${file.name}`);
      loadProjectsList();
      frame.contentWindow.postMessage({ target: "oneead-solidcraft", action: "load-file", filename: file.name }, location.origin);
    } catch (err) {
      toast(`Error: ${err.message}`);
    }
    e.target.value = "";
  });

  // Top Bar Actions
  $("btn-update").addEventListener("click", async () => {
    await api("/install", "POST", { force: true });
    toast("Starting update...");
    startPolling();
  });

  $("btn-reload").addEventListener("click", () => {
    frame.src = "app/";
    state.loadedTag = state.status && state.status.version && state.status.version.tag;
    $("btn-reload").hidden = true;
    toast("Reloaded SolidCraft");
  });

  $("btn-retry").addEventListener("click", async () => {
    await api("/install", "POST", { force: true });
    startPolling();
  });

  $("btn-check").addEventListener("click", async () => {
    toast("Checking GitHub releases...");
    const s = await api("/check", "POST");
    render(s);
    if (!s.update_available) {
      toast("SolidCraft is already up to date!");
    }
  });

  $("btn-force-sync").addEventListener("click", () => {
    if (frame && frame.contentWindow) {
      frame.contentWindow.postMessage({ target: "oneead-solidcraft", action: "force-sync" }, location.origin);
      toast("Triggered disk backup sync");
    }
  });

  $("sel-channel").addEventListener("change", async (e) => {
    await api("/config", "POST", { channel: e.target.value });
    toast(`Switched channel to ${e.target.value}. Checking updates...`);
    const s = await api("/check", "POST");
    render(s);
  });

  $("chk-auto").addEventListener("change", async (e) => {
    await api("/config", "POST", { auto_update: e.target.checked });
  });

  $("sel-interval")?.addEventListener("change", async (e) => {
    await api("/config", "POST", { check_interval_hours: Number(e.target.value) });
    toast(`Check interval updated to ${e.target.value} hours`);
  });

  // Settings Menu Toggle
  $("btn-settings").addEventListener("click", (e) => {
    e.stopPropagation();
    const menu = $("menu");
    const open = !menu.hidden;
    menu.hidden = open;
    $("btn-settings").setAttribute("aria-expanded", !open);
  });
  document.addEventListener("click", () => {
    $("menu").hidden = true;
    $("btn-settings").setAttribute("aria-expanded", "false");
  });
  $("menu").addEventListener("click", (e) => e.stopPropagation());

  // Full Screen transitions (unified with portal header button and F11)
  document.addEventListener("fullscreenchange", () => {
    const isFs = Boolean(document.fullscreenElement);
    document.body.classList.toggle("fs", isFs);
  });
  $("bar-handle")?.addEventListener("click", () => {
    document.body.classList.toggle("peek");
  });

  // Listen for persist.js messages from iframe
  window.addEventListener("message", (evt) => {
    if (!evt.data) return;
    if (evt.data.type === "ead:toggle-fullscreen") {
      if (parent !== window) {
        parent.postMessage({ type: "ead:toggle-fullscreen" }, location.origin);
      }
      return;
    }
    if (evt.data.type === "ead:fullscreen-change") {
      document.body.classList.toggle("fs", Boolean(evt.data.isFullscreen));
      return;
    }
    if (evt.data.source !== "oneead-solidcraft") return;
    const { state: sName, message, count } = evt.data;
    if (sName === "saved") {
      setSync("saved", "Disk backup: up to date");
    } else if (sName === "saving") {
      setSync("saving", "Syncing to disk...");
    } else if (sName === "restored") {
      setSync("saved", "Disk backup: up to date");
      toast(`Restored ${count} CAD project(s) from disk mirror`);
      loadProjectsList();
    } else if (sName === "error") {
      setSync("error", message || "Disk backup error");
    }
  });

  // Initial load
  refresh();
})();
