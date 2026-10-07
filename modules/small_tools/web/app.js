(() => {
  const API = "/api/small-tools";
  const ICONS = {
    pdfarranger:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="9" rx="1"/>' +
      '<rect x="3" y="15" width="7" height="6" rx="1"/><path d="M14 18h7M18 15l3 3-3 3"/></svg>',
    excalidraw:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>' +
      '<path d="m15 5 4 4"/>' +
      '<path d="M9 19c-1-1-2.5-1.5-4-1.5"/></svg>',
  };

  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const state = {
    tools: [],
    busy: new Set(),
    active: null,
    watch: 0,
    drawings: [],
    activeFileId: "default",
    searchQuery: "",
    panelOpen: false,
  };
  let toastTimer;

  async function api(path, method = "GET", body = null) {
    const opts = { method };
    if (body) {
      opts.headers = { "Content-Type": "application/json" };
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(API + path, opts);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function formatTime(isoStr) {
    if (!isoStr) return "";
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  }

  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 5000);
  }

  function cardFoot(t) {
    const st = t.status;
    const inst = st.install;
    if (inst.active) {
      return `<div class="progress"><i style="width:${inst.percent}%"></i></div><div class="card-foot">${esc(inst.message || "Working")}</div>`;
    }
    const err = inst.error ? `<div class="card-error">Setup failed: ${esc(inst.error)}</div>` : "";
    if (!st.installed) {
      return `${err}<div class="card-foot"><span class="card-action">Set up &rarr;</span></div>`;
    }
    return `<div class="card-foot"><span class="card-action">Open &rarr;</span></div>`;
  }

  function render() {
    $("grid").innerHTML = state.tools
      .map(
        (t) => `
      <button class="tool-card ${state.busy.has(t.id) ? "busy" : ""}" data-id="${esc(t.id)}" style="--card-color: var(--accent, #e0562b)">
        <span class="card-tag">${esc(t.tag)}</span>
        <span class="card-icon">${ICONS[t.id] || ""}</span>
        <span class="card-title">${esc(t.title)}</span>
        <span class="card-desc">${esc(t.description)}</span>
        ${cardFoot(t)}
      </button>`
      )
      .join("");
  }

  async function refresh() {
    state.tools = await api("/tools");
    render();
  }

  async function install(tool) {
    if (!confirm(`${tool.title} needs a one-time download (about 60 MB). Continue?`)) return false;
    await api(`/tools/${tool.id}/install`, "POST");
    for (;;) {
      const st = await api(`/tools/${tool.id}/status`);
      tool.status = st;
      render();
      if (!st.install.active) return st.installed;
      await sleep(1000);
    }
  }

  function showView(name) {
    $("view-grid").hidden = name !== "grid";
    $("view-tool").hidden = name !== "tool";
  }

  function overlay(text, { spinner = true, reopen = false } = {}) {
    $("tool-overlay").hidden = false;
    $("tool-spinner").hidden = !spinner;
    $("tool-overlay-text").textContent = text;
    $("btn-reopen").hidden = !reopen;
  }

  async function open(tool) {
    state.active = tool;
    const token = ++state.watch;
    $("tool-title").textContent = tool.title;
    showView("tool");
    overlay(`Starting ${tool.title}\u2026`);

    // Manage Drawings panel button visibility
    const isExcalidraw = tool.id === "excalidraw";
    if ($("btn-toggle-panel")) {
      $("btn-toggle-panel").hidden = !isExcalidraw;
    }

    let st = await api(`/tools/${tool.id}/launch`, "POST");
    while (!(st.running && st.ready)) {
      if (state.active !== tool || token !== state.watch) return;
      await sleep(500);
      st = await api(`/tools/${tool.id}/status`);
    }
    const frame = $("tool-frame");
    if (frame.dataset.tool !== tool.id) {
      frame.src = st.url;
      frame.dataset.tool = tool.id;
      if (!tool.embedded) {
        await sleep(1500);
      }
    }
    frame.hidden = false;
    $("tool-overlay").hidden = true;

    if (isExcalidraw) {
      loadDrawingsList();
    }

    // Watch for the app being closed from inside its own window.
    while (state.active === tool && token === state.watch) {
      await sleep(2000);
      st = await api(`/tools/${tool.id}/status`);
      if (!st.running) {
        frame.hidden = true;
        frame.removeAttribute("src");
        frame.removeAttribute("data-tool");
        overlay(`${tool.title} was closed.`, { spinner: false, reopen: true });
        return;
      }
    }
  }

  // --- Multi-file Working Drawings Logic ---

  async function loadDrawingsList() {
    try {
      const data = await api("/tools/excalidraw/files");
      state.drawings = data.files || [];
      state.activeFileId = data.active_id || "default";
      if ($("panel-file-count")) {
        $("panel-file-count").textContent = state.drawings.length;
      }
      renderDrawings();
    } catch (e) {
      console.warn("Could not load drawings list:", e);
      const listEl = $("files-list");
      if (listEl) {
        listEl.innerHTML = `<div class="empty-drawings">
          <p style="margin-bottom:8px;color:var(--danger,#d64545);">Could not load drawings</p>
          <button class="btn btn-sm" id="btn-retry-drawings">Retry</button>
        </div>`;
        $("btn-retry-drawings")?.addEventListener("click", () => loadDrawingsList());
      }
    }
  }

  function renderDrawings() {
    const listEl = $("files-list");
    if (!listEl) return;
    const q = (state.searchQuery || "").toLowerCase().trim();
    const filtered = state.drawings.filter((d) =>
      (d.name || "").toLowerCase().includes(q)
    );

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="empty-drawings">${
        q ? "No drawings match your search." : "No saved drawings yet."
      }</div>`;
      return;
    }

    listEl.innerHTML = filtered
      .map((d) => {
        const isActive = d.id === state.activeFileId;
        const count = d.elements_count || 0;
        const countLabel = count === 1 ? "1 element" : `${count} elements`;
        const timeLabel = formatTime(d.updated_at);

        return `
        <div class="drawing-card ${isActive ? "active" : ""}" data-id="${esc(d.id)}">
          <div class="card-row-top">
            <span class="card-title-text" title="${esc(d.name)}">${esc(d.name)}</span>
            ${isActive ? `<span class="card-badge">Active</span>` : ""}
            <div class="card-actions">
              <button class="card-act-btn edit-name-btn" data-id="${esc(d.id)}" title="Rename drawing">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
              </button>
              <button class="card-act-btn dup-btn" data-id="${esc(d.id)}" title="Duplicate drawing">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
              <button class="card-act-btn del del-btn" data-id="${esc(d.id)}" title="Delete drawing">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            </div>
          </div>
          <div class="card-row-meta">
            <span>${esc(countLabel)}</span>
            <span>${esc(timeLabel)}</span>
          </div>
        </div>`;
      })
      .join("");
  }

  function updateActiveDrawingCard(fileId) {
    const listEl = $("files-list");
    if (!listEl) return;
    const cards = listEl.querySelectorAll(".drawing-card");
    cards.forEach((card) => {
      const isAct = card.dataset.id === fileId;
      card.classList.toggle("active", isAct);
      let badge = card.querySelector(".card-badge");
      if (isAct && !badge) {
        const topRow = card.querySelector(".card-row-top");
        const actions = card.querySelector(".card-actions");
        if (topRow) {
          const b = document.createElement("span");
          b.className = "card-badge";
          b.textContent = "Active";
          if (actions) {
            topRow.insertBefore(b, actions);
          } else {
            topRow.appendChild(b);
          }
        }
      } else if (!isAct && badge) {
        badge.remove();
      }
    });
  }

  function switchDrawing(fileId, force = false) {
    state.activeFileId = fileId;
    api(`/tools/excalidraw/files/${fileId}/active`, "POST").catch(() => {});

    // Instantly update active badge in DOM without rebuilding innerHTML
    updateActiveDrawingCard(fileId);

    const frame = $("tool-frame");
    if (frame && frame.contentWindow) {
      // Instant switch via postMessage to iframe
      frame.contentWindow.postMessage({ type: "LOAD_DRAWING_FILE", fileId, force: true }, "*");
    }
  }

  async function createDrawing() {
    const defaultName = `Whiteboard ${state.drawings.length + 1}`;
    const name = prompt("Enter a name for the new whiteboard:", defaultName);
    if (name === null) return;
    try {
      const newFile = await api("/tools/excalidraw/files", "POST", { name: name.trim() || defaultName });
      toast(`Created "${newFile.name}"`);
      await loadDrawingsList();
      switchDrawing(newFile.id, true);
    } catch (e) {
      toast(`Could not create drawing: ${e.message}`);
    }
  }

  async function renameDrawing(fileId) {
    const item = state.drawings.find((d) => d.id === fileId);
    if (!item) return;
    const newName = prompt("Rename whiteboard:", item.name);
    if (!newName || newName.trim() === item.name) return;
    try {
      await api(`/tools/excalidraw/files/${fileId}`, "PATCH", { name: newName.trim() });
      await loadDrawingsList();
    } catch (e) {
      toast(`Could not rename: ${e.message}`);
    }
  }

  async function duplicateDrawing(fileId) {
    try {
      const dup = await api(`/tools/excalidraw/files/${fileId}/duplicate`, "POST");
      toast(`Duplicated as "${dup.name}"`);
      await loadDrawingsList();
      if (dup.id) {
        switchDrawing(dup.id, true);
      }
    } catch (e) {
      toast(`Could not duplicate: ${e.message}`);
    }
  }

  async function deleteDrawing(fileId) {
    const item = state.drawings.find((d) => d.id === fileId);
    if (!item) return;
    if (!confirm(`Delete "${item.name}"?`)) return;
    try {
      // 1. Tell iframe to cancel any pending auto-saves for this file immediately
      const frame = $("tool-frame");
      if (frame && frame.contentWindow) {
        frame.contentWindow.postMessage({ type: "DRAWING_DELETED", fileId }, "*");
      }

      // 2. Call backend soft-delete endpoint
      const res = await api(`/tools/excalidraw/files/${fileId}`, "DELETE");
      toast(res.status === "cleared" ? `Cleared canvas for "${item.name}"` : `Deleted "${item.name}"`);

      // 3. Refresh list from backend
      await loadDrawingsList();

      // 4. If the deleted whiteboard was the active one, switch to remaining active board
      if (state.activeFileId === fileId && res.active_id) {
        switchDrawing(res.active_id, true);
      }
    } catch (e) {
      toast(`Could not delete: ${e.message}`);
    }
  }

  function togglePanel(force) {
    const panel = $("working-files-panel");
    if (!panel) return;
    const shouldOpen = force !== undefined ? force : panel.hidden;
    panel.hidden = !shouldOpen;
    state.panelOpen = shouldOpen;
    $("btn-toggle-panel")?.classList.toggle("primary", shouldOpen);
    if (shouldOpen) {
      loadDrawingsList();
      setTimeout(() => $("panel-search-input")?.focus(), 80);
    }
  }

  // --- Event Bindings ---

  async function onCard(id) {
    const tool = state.tools.find((t) => t.id === id);
    if (!tool || state.busy.has(id)) return;
    state.busy.add(id);
    render();
    try {
      if (!tool.status.installed && !(await install(tool))) return;
      state.busy.delete(id);
      await open(tool);
    } catch (e) {
      toast(`Could not open ${tool.title}: ${e.message}`);
      showView("grid");
    } finally {
      state.busy.delete(id);
      if (!$("view-grid").hidden) await refresh();
    }
  }

  $("grid").addEventListener("click", (e) => {
    const card = e.target.closest(".tool-card");
    if (card) onCard(card.dataset.id);
  });

  $("btn-back").addEventListener("click", () => {
    state.active = null;
    state.watch++;
    showView("grid");
    refresh();
  });

  $("btn-open-tab")?.addEventListener("click", () => {
    const targetUrl = `/modules/small-tools/excalidraw/?file=${encodeURIComponent(state.activeFileId || "default")}`;
    window.open(targetUrl, "_blank");
  });

  $("btn-toggle-panel")?.addEventListener("click", () => {
    togglePanel();
  });

  $("btn-close-panel")?.addEventListener("click", () => {
    togglePanel(false);
  });

  $("panel-new-board-btn")?.addEventListener("click", () => {
    createDrawing();
  });

  $("panel-search-input")?.addEventListener("input", (e) => {
    state.searchQuery = e.target.value;
    renderDrawings();
  });

  $("files-list")?.addEventListener("click", (e) => {
    const editBtn = e.target.closest(".edit-name-btn");
    if (editBtn) {
      e.stopPropagation();
      renameDrawing(editBtn.dataset.id);
      return;
    }
    const dupBtn = e.target.closest(".dup-btn");
    if (dupBtn) {
      e.stopPropagation();
      duplicateDrawing(dupBtn.dataset.id);
      return;
    }
    const delBtn = e.target.closest(".del-btn");
    if (delBtn) {
      e.stopPropagation();
      deleteDrawing(delBtn.dataset.id);
      return;
    }
    const card = e.target.closest(".drawing-card");
    if (card && card.dataset.id) {
      switchDrawing(card.dataset.id);
    }
  });

  $("btn-reopen").addEventListener("click", () => {
    if (state.active) open(state.active).catch((e) => toast(e.message));
  });

  // Listen for save events emitted by the iframe to update the drawings list live
  window.addEventListener("message", (e) => {
    if (e.data && e.data.type === "EXCALIDRAW_SAVED") {
      const item = state.drawings.find((d) => d.id === e.data.fileId);
      if (item) {
        item.elements_count = e.data.count;
        item.updated_at = new Date().toISOString();
        const card = $("files-list")?.querySelector(`.drawing-card[data-id="${CSS.escape(e.data.fileId)}"]`);
        if (card) {
          const countLabel = e.data.count === 1 ? "1 element" : `${e.data.count} elements`;
          const countSpan = card.querySelector(".card-row-meta span:first-child");
          if (countSpan) countSpan.textContent = countLabel;
          const timeSpan = card.querySelector(".card-row-meta span:last-child");
          if (timeSpan) timeSpan.textContent = formatTime(item.updated_at);
        } else {
          renderDrawings();
        }
      } else {
        loadDrawingsList();
      }
    }
  });

  async function init() {
    try {
      showView("grid");
      await refresh();
    } catch (e) {
      $("grid").innerHTML = `<p class="card-error">Failed to load tools: ${esc(e.message)}</p>`;
    }
  }

  init();
})();
