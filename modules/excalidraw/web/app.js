(() => {
  "use strict";

  const state = {
    drawings: [],
    activeFileId: "default",
    drawerOpen: false,
    searchQuery: "",
  };

  const $ = (id) => document.getElementById(id);

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatTime(isoStr) {
    if (!isoStr) return "";
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return "";
      const now = new Date();
      const diffSec = Math.floor((now - d) / 1000);
      if (diffSec < 60) return "Just now";
      if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
      if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
      return `${Math.floor(diffSec / 86400)}d ago`;
    } catch (_) {
      return "";
    }
  }

  function toast(msg) {
    const el = $("toast");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(() => {
      el.hidden = true;
    }, 2400);
  }

  async function api(path, method = "GET", body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`/api/excalidraw${path}`, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
  }

  // --- Multi-file Board Management ---

  async function loadDrawingsList() {
    try {
      const data = await api("/files");
      state.drawings = data.files || [];
      state.activeFileId = data.active_id || "default";

      if ($("boards-count")) {
        $("boards-count").textContent = state.drawings.length;
      }

      updateCurrentBoardHeader();
      renderDrawings();
    } catch (e) {
      console.warn("Could not load drawings list:", e);
      const listEl = $("boards-list");
      if (listEl) {
        listEl.innerHTML = `<div class="empty-boards">
          <p style="margin-bottom:8px;color:var(--danger,#d64545);">Could not load drawings</p>
          <button class="btn btn-sm" id="btn-retry-drawings">Retry</button>
        </div>`;
        $("btn-retry-drawings")?.addEventListener("click", () => loadDrawingsList());
      }
    }
  }

  function updateCurrentBoardHeader() {
    const activeItem = state.drawings.find((d) => d.id === state.activeFileId);
    const titleEl = $("current-board-name");
    if (titleEl) {
      titleEl.textContent = activeItem ? activeItem.name : "Whiteboard";
    }
  }

  function renderDrawings() {
    const listEl = $("boards-list");
    if (!listEl) return;
    const q = (state.searchQuery || "").toLowerCase().trim();
    const filtered = state.drawings.filter((d) =>
      (d.name || "").toLowerCase().includes(q)
    );

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="empty-boards">${
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
        <div class="board-card ${isActive ? "active" : ""}" data-id="${esc(d.id)}">
          <div class="card-row-top">
            <span class="card-title-text" title="${esc(d.name)}">${esc(d.name)}</span>
            ${isActive ? `<span class="card-badge">Active</span>` : ""}
            <div class="card-actions">
              <button class="card-act-btn edit-name-btn" data-id="${esc(d.id)}" title="Rename whiteboard">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
              </button>
              <button class="card-act-btn dup-btn" data-id="${esc(d.id)}" title="Duplicate whiteboard">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
              <button class="card-act-btn del del-btn" data-id="${esc(d.id)}" title="Delete whiteboard">
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

  function updateActiveCardInDOM(fileId) {
    const listEl = $("boards-list");
    if (!listEl) return;
    const cards = listEl.querySelectorAll(".board-card");
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
    api(`/files/${fileId}/active`, "POST").catch(() => {});

    updateCurrentBoardHeader();
    updateActiveCardInDOM(fileId);

    const frame = $("canvas-frame");
    if (frame && frame.contentWindow) {
      // Instant switch via postMessage without reloading the iframe
      frame.contentWindow.postMessage({ type: "LOAD_DRAWING_FILE", fileId, force: true }, "*");
    }
  }

  async function createDrawing() {
    const defaultName = `Whiteboard ${state.drawings.length + 1}`;
    const name = prompt("Enter a name for the new whiteboard:", defaultName);
    if (name === null) return;
    try {
      const newFile = await api("/files", "POST", { name: name.trim() || defaultName });
      toast(`Created "${newFile.name}"`);
      await loadDrawingsList();
      switchDrawing(newFile.id, true);
    } catch (e) {
      toast(`Could not create whiteboard: ${e.message}`);
    }
  }

  async function renameDrawing(fileId) {
    const item = state.drawings.find((d) => d.id === fileId);
    if (!item) return;
    const newName = prompt("Rename whiteboard:", item.name);
    if (!newName || newName.trim() === item.name) return;
    try {
      await api(`/files/${fileId}`, "PATCH", { name: newName.trim() });
      await loadDrawingsList();
    } catch (e) {
      toast(`Could not rename: ${e.message}`);
    }
  }

  async function duplicateDrawing(fileId) {
    try {
      const dup = await api(`/files/${fileId}/duplicate`, "POST");
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
      const frame = $("canvas-frame");
      if (frame && frame.contentWindow) {
        frame.contentWindow.postMessage({ type: "DRAWING_DELETED", fileId }, "*");
      }

      // 2. Call backend delete endpoint
      const res = await api(`/files/${fileId}`, "DELETE");
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

  function toggleDrawer(force) {
    const drawer = $("boards-drawer");
    if (!drawer) return;
    const shouldOpen = force !== undefined ? force : drawer.hidden;
    drawer.hidden = !shouldOpen;
    state.drawerOpen = shouldOpen;
    $("btn-toggle-drawer")?.classList.toggle("primary", shouldOpen);
    if (shouldOpen) {
      loadDrawingsList();
      setTimeout(() => $("drawer-search-input")?.focus(), 80);
    }
  }

  // --- Setup Canvas Iframe ---

  function setupCanvasIframe() {
    const frame = $("canvas-frame");
    if (!frame) return;
    const targetUrl = `canvas/?file=${encodeURIComponent(state.activeFileId || "default")}`;
    frame.src = targetUrl;
  }

  // --- Listen to Canvas Save Events ---

  window.addEventListener("message", (e) => {
    if (e.data && e.data.type === "EXCALIDRAW_SAVED") {
      const { fileId, count } = e.data;
      const statusBadge = $("save-status-badge");
      const statusText = $("save-status-text");

      if (statusBadge && statusText) {
        statusBadge.classList.remove("saving");
        statusText.textContent = "Saved to disk";
      }

      // Update local state metadata
      const item = state.drawings.find((d) => d.id === fileId);
      if (item) {
        item.elements_count = count;
        item.updated_at = new Date().toISOString();
        if (state.drawerOpen) {
          renderDrawings();
        }
      }
    }
  });

  // --- Portal Shell Theme Sync ---

  function syncTheme() {
    const theme = localStorage.getItem("ead-portal:theme") || "dark";
    document.documentElement.setAttribute("data-theme", theme);
  }

  window.addEventListener("storage", (e) => {
    if (e.key === "ead-portal:theme") syncTheme();
  });

  // --- Event Wireup ---

  function wireEvents() {
    $("btn-toggle-drawer")?.addEventListener("click", () => toggleDrawer());
    $("btn-close-drawer")?.addEventListener("click", () => toggleDrawer(false));

    $("btn-new-board")?.addEventListener("click", () => createDrawing());
    $("drawer-new-btn")?.addEventListener("click", () => createDrawing());

    $("btn-edit-board-name")?.addEventListener("click", (e) => {
      e.stopPropagation();
      renameDrawing(state.activeFileId);
    });

    $("board-title-chip")?.addEventListener("click", () => {
      renameDrawing(state.activeFileId);
    });

    $("drawer-search-input")?.addEventListener("input", (e) => {
      state.searchQuery = e.target.value;
      renderDrawings();
    });

    $("boards-list")?.addEventListener("click", (e) => {
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
      const card = e.target.closest(".board-card");
      if (card && card.dataset.id) {
        switchDrawing(card.dataset.id);
      }
    });
  }

  async function init() {
    syncTheme();
    wireEvents();
    await loadDrawingsList();
    setupCanvasIframe();
  }

  init();
})();
