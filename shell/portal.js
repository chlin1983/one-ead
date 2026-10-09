/**
 * EAD Portal shell.
 * Fetches module manifests from the backend, builds the sidebar and landing
 * grid, and loads the selected tool in an isolated iframe. Modules are fully
 * decoupled: the shell knows nothing about a tool beyond its manifest.
 */

const state = {
  modules: [],
  activeId: null,
  // One cached <iframe> per plugin, created lazily on first visit and kept
  // alive (hidden, not reloaded) when switching away — so a plugin's
  // in-progress work (loaded files, plotted data, form state) survives
  // switching to another plugin and back.
  frames: {},
};

const el = {
  portal: document.getElementById("portal"),
  brandHomeBtn: document.getElementById("brand-home-btn"),
  list: document.getElementById("module-list"),
  grid: document.getElementById("tool-grid"),
  search: document.getElementById("module-search"),
  count: document.getElementById("module-count"),
  landing: document.getElementById("landing"),
  frameHost: document.getElementById("frame-host"),
  loader: document.getElementById("frame-loader"),
  title: document.getElementById("stage-title"),
  subtitle: document.getElementById("stage-subtitle"),
  dot: document.getElementById("stage-dot"),
  reloadBtn: document.getElementById("reload-btn"),
  openNewBtn: document.getElementById("open-new-btn"),
  collapseBtn: document.getElementById("collapse-btn"),
  themeToggle: document.getElementById("theme-toggle"),
};

const FALLBACK_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`;
const GRIP_ICON = `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>`;

let draggedModuleId = null;
let isDraggingActive = false;

async function init() {
  applyStoredTheme();
  wireChrome();
  try {
    const res = await fetch("/api/modules");
    state.modules = await res.json();
    applySavedOrder();
  } catch (err) {
    el.grid.innerHTML = `<p class="empty-note">Could not reach the portal backend. Is the server running?</p>`;
    return;
  }
  renderSidebar();
  renderLanding();
  el.count.textContent = `${state.modules.length} plugin${state.modules.length === 1 ? "" : "s"}`;

  // Purge legacy sticky localStorage key so startup reliably displays the cover page
  localStorage.removeItem("ead-portal:lastModule");

  // Check URL hash if user opened with a specific module (e.g. bookmarks or reload)
  const hash = window.location.hash.replace(/^#/, "");
  if (hash && hash !== "landing" && state.modules.some((m) => m.id === hash)) {
    openModule(hash, false);
  } else {
    showLanding();
  }
}

function applySavedOrder() {
  const saved = localStorage.getItem("ead-portal:moduleOrder");
  if (!saved) return;
  try {
    const orderList = JSON.parse(saved);
    if (!Array.isArray(orderList) || !orderList.length) return;

    // Detect if new modules were added by the backend that aren't yet in cached localStorage
    const savedSet = new Set(orderList);
    const hasMissing = state.modules.some((m) => !savedSet.has(m.id));

    if (hasMissing) {
      state.modules.forEach((mod, sIdx) => {
        if (!savedSet.has(mod.id)) {
          const predId = sIdx > 0 ? state.modules[sIdx - 1].id : null;
          const predIdx = predId ? orderList.indexOf(predId) : -1;
          if (predIdx !== -1) {
            orderList.splice(predIdx + 1, 0, mod.id);
          } else {
            orderList.push(mod.id);
          }
          savedSet.add(mod.id);
        }
      });
      localStorage.setItem("ead-portal:moduleOrder", JSON.stringify(orderList));
    }

    const orderMap = new Map(orderList.map((id, idx) => [id, idx]));
    state.modules.sort((a, b) => {
      const idxA = orderMap.has(a.id) ? orderMap.get(a.id) : 999;
      const idxB = orderMap.has(b.id) ? orderMap.get(b.id) : 999;
      return idxA - idxB;
    });
  } catch (err) {
    console.warn("[portal] Failed to apply local module order:", err);
  }
}

function persistModuleOrder() {
  const order = state.modules.map((m) => m.id);
  // 1. Instant local storage persistence (instant render across browser refresh and restart)
  localStorage.setItem("ead-portal:moduleOrder", JSON.stringify(order));

  // 2. On-disk backend persistence (survives cache wipe and PC restarts)
  fetch("/api/modules/order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order }),
  }).catch((err) => console.warn("[portal] Failed to save module order to server:", err));
}

function renderSidebar() {
  el.list.innerHTML = "";
  if (!state.modules.length) {
    el.list.innerHTML = `<p class="empty-note">No plugins installed yet.</p>`;
    return;
  }
  for (const m of state.modules) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "module-item";
    btn.dataset.id = m.id;
    btn.dataset.search = `${m.title} ${m.subtitle}`.toLowerCase();
    btn.style.setProperty("--mod-accent", m.accent || "");
    btn.title = `${m.title} (Drag up/down to relocate)`;
    btn.draggable = true;

    btn.innerHTML = `
      <span class="m-icon">${m.icon || FALLBACK_ICON}</span>
      <span class="m-text">
        <span class="m-title">${escapeHtml(m.title)}</span>
        <span class="m-sub">${escapeHtml(m.subtitle || "")}</span>
      </span>
      <span class="m-grip" title="Drag up or down to relocate">
        ${GRIP_ICON}
      </span>`;

    // Click handler to open module
    btn.addEventListener("click", () => {
      if (isDraggingActive) return;
      openModule(m.id);
    });

    // Drag start
    btn.addEventListener("dragstart", (e) => {
      // Don't drag if user is actively filtering
      if (el.search.value.trim()) {
        e.preventDefault();
        return;
      }
      draggedModuleId = m.id;
      isDraggingActive = true;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", m.id);

      setTimeout(() => {
        btn.classList.add("dragging");
        el.list.classList.add("is-dragging-modules");
      }, 0);
    });

    // Drag over
    btn.addEventListener("dragover", (e) => {
      if (!draggedModuleId || draggedModuleId === m.id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";

      const rect = btn.getBoundingClientRect();
      const isTop = (e.clientY - rect.top) < (rect.height / 2);
      btn.classList.toggle("drop-target-top", isTop);
      btn.classList.toggle("drop-target-bottom", !isTop);
    });

    // Drag leave
    btn.addEventListener("dragleave", (e) => {
      const rect = btn.getBoundingClientRect();
      if (
        e.clientX < rect.left ||
        e.clientX >= rect.right ||
        e.clientY < rect.top ||
        e.clientY >= rect.bottom
      ) {
        btn.classList.remove("drop-target-top", "drop-target-bottom");
      }
    });

    // Drop
    btn.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const sourceId = draggedModuleId || e.dataTransfer.getData("text/plain");
      const targetId = m.id;

      btn.classList.remove("drop-target-top", "drop-target-bottom");

      if (sourceId && targetId && sourceId !== targetId) {
        const sourceIdx = state.modules.findIndex((x) => x.id === sourceId);
        const targetIdx = state.modules.findIndex((x) => x.id === targetId);
        if (sourceIdx !== -1 && targetIdx !== -1) {
          const rect = btn.getBoundingClientRect();
          const isTop = (e.clientY - rect.top) < (rect.height / 2);

          const [movedModule] = state.modules.splice(sourceIdx, 1);
          let newTargetIdx = state.modules.findIndex((x) => x.id === targetId);
          let insertIdx = isTop ? newTargetIdx : newTargetIdx + 1;
          state.modules.splice(insertIdx, 0, movedModule);

          persistModuleOrder();
          renderSidebar();
          renderLanding();
        }
      }
    });

    // Drag end
    btn.addEventListener("dragend", () => {
      btn.classList.remove("dragging");
      el.list.classList.remove("is-dragging-modules");
      el.grid.classList.remove("is-dragging-cards");
      el.list.querySelectorAll(".module-item").forEach((item) => {
        item.classList.remove("dragging", "drop-target-top", "drop-target-bottom");
      });
      el.grid.querySelectorAll(".tool-card").forEach((item) => {
        item.classList.remove("dragging", "drop-target-left", "drop-target-right");
      });
      draggedModuleId = null;
      setTimeout(() => {
        isDraggingActive = false;
      }, 80);
    });

    el.list.appendChild(btn);
  }

  // Restore active class
  if (state.activeId) {
    el.list.querySelectorAll(".module-item").forEach((b) =>
      b.classList.toggle("active", b.dataset.id === state.activeId)
    );
  }
}

let hasRenderedLandingOnce = false;

function renderLanding() {
  el.grid.innerHTML = "";
  const skipAnim = hasRenderedLandingOnce;
  hasRenderedLandingOnce = true;

  state.modules.forEach((m, i) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "tool-card";
    card.dataset.id = m.id;
    card.title = `${m.title} (Drag to relocate)`;
    card.draggable = true;
    card.style.setProperty("--mod-accent", m.accent || "");
    if (skipAnim) {
      card.style.animation = "none";
    } else {
      card.style.animationDelay = `${i * 60}ms`;
    }

    card.innerHTML = `
      <span class="tc-grip" title="Drag to relocate">
        ${GRIP_ICON}
      </span>
      <span class="tc-icon">${m.icon || FALLBACK_ICON}</span>
      <h3>${escapeHtml(m.title)}</h3>
      <p>${escapeHtml(m.subtitle || "")}</p>
      <span class="tc-launch">Launch
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>
      </span>`;

    // Click handler to open module (only when not dragging)
    card.addEventListener("click", () => {
      if (isDraggingActive) return;
      openModule(m.id);
    });

    // Drag start
    card.addEventListener("dragstart", (e) => {
      draggedModuleId = m.id;
      isDraggingActive = true;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", m.id);

      setTimeout(() => {
        card.classList.add("dragging");
        el.grid.classList.add("is-dragging-cards");
      }, 0);
    });

    // Drag over
    card.addEventListener("dragover", (e) => {
      if (!draggedModuleId || draggedModuleId === m.id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";

      const rect = card.getBoundingClientRect();
      const isLeft = (e.clientX - rect.left) < (rect.width / 2);
      card.classList.toggle("drop-target-left", isLeft);
      card.classList.toggle("drop-target-right", !isLeft);
    });

    // Drag leave
    card.addEventListener("dragleave", (e) => {
      const rect = card.getBoundingClientRect();
      if (
        e.clientX < rect.left ||
        e.clientX >= rect.right ||
        e.clientY < rect.top ||
        e.clientY >= rect.bottom
      ) {
        card.classList.remove("drop-target-left", "drop-target-right");
      }
    });

    // Drop
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const sourceId = draggedModuleId || e.dataTransfer.getData("text/plain");
      const targetId = m.id;

      card.classList.remove("drop-target-left", "drop-target-right");

      if (sourceId && targetId && sourceId !== targetId) {
        const sourceIdx = state.modules.findIndex((x) => x.id === sourceId);
        const targetIdx = state.modules.findIndex((x) => x.id === targetId);
        if (sourceIdx !== -1 && targetIdx !== -1) {
          const rect = card.getBoundingClientRect();
          const isLeft = (e.clientX - rect.left) < (rect.width / 2);

          const [movedModule] = state.modules.splice(sourceIdx, 1);
          let newTargetIdx = state.modules.findIndex((x) => x.id === targetId);
          let insertIdx = isLeft ? newTargetIdx : newTargetIdx + 1;
          state.modules.splice(insertIdx, 0, movedModule);

          persistModuleOrder();
          renderSidebar();
          renderLanding();
        }
      }
    });

    // Drag end
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      el.grid.classList.remove("is-dragging-cards");
      el.list.classList.remove("is-dragging-modules");
      el.grid.querySelectorAll(".tool-card").forEach((item) => {
        item.classList.remove("dragging", "drop-target-left", "drop-target-right");
      });
      el.list.querySelectorAll(".module-item").forEach((item) => {
        item.classList.remove("dragging", "drop-target-top", "drop-target-bottom");
      });
      draggedModuleId = null;
      setTimeout(() => {
        isDraggingActive = false;
      }, 80);
    });

    el.grid.appendChild(card);
  });
}

function showLanding() {
  state.activeId = null;

  // Clear remembered module so page reloads or restarts stay on landing page
  localStorage.removeItem("ead-portal:lastModule");

  // Clear hash from address bar if present
  if (window.location.hash && window.location.hash !== "#") {
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }

  // Deselect active class on all sidebar items
  el.list.querySelectorAll(".module-item").forEach((b) => b.classList.remove("active"));

  // Hide any active plugin iframes
  Object.values(state.frames).forEach((f) => f.classList.add("inactive-frame"));
  el.loader.classList.add("hidden");

  // Show cover/landing page, hide frame host
  el.landing.hidden = false;
  el.frameHost.hidden = true;
  el.reloadBtn.hidden = true;
  el.openNewBtn.hidden = true;

  // Reset stage header back to portal welcome title
  el.title.textContent = "Welcome";
  el.subtitle.textContent = "Select a plugin from the sidebar to begin.";
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent");
  el.dot.style.background = accent;
  el.dot.style.boxShadow = `0 0 0 4px var(--accent-soft)`;

  // Scroll landing page smoothly to top
  el.landing.scrollTo({ top: 0, behavior: "smooth" });
}

function openModule(id, updateHash = true) {
  const m = state.modules.find((x) => x.id === id);
  if (!m) return;
  const isSwitch = state.activeId !== id;
  state.activeId = id;

  if (updateHash && window.location.hash.replace(/^#/, "") !== id) {
    history.pushState(null, "", `#${id}`);
  }

  el.list.querySelectorAll(".module-item").forEach((b) =>
    b.classList.toggle("active", b.dataset.id === id)
  );

  el.title.textContent = m.title;
  el.subtitle.textContent = m.subtitle || "";
  const accent = m.accent || getComputedStyle(document.documentElement).getPropertyValue("--accent");
  el.dot.style.background = accent;
  el.dot.style.boxShadow = `0 0 0 4px color-mix(in srgb, ${accent} 22%, transparent)`;

  el.landing.hidden = true;
  el.frameHost.hidden = false;
  el.reloadBtn.hidden = false;
  el.openNewBtn.hidden = false;

  // Hide every other cached iframe; only the active plugin's frame is shown.
  if (isSwitch) {
    Object.values(state.frames).forEach((f) => f.classList.add("inactive-frame"));
  }

  const existing = state.frames[id];
  if (existing) {
    // Already visited this session: just reveal it, no reload, state intact.
    existing.classList.remove("inactive-frame");
    el.loader.classList.add("hidden");
    return;
  }

  // First visit this session: create and cache a dedicated iframe for it.
  const frame = document.createElement("iframe");
  frame.title = m.title;
  frame.allow = "microphone; speaker-selection; clipboard-read; clipboard-write; display-capture; fullscreen";
  frame.src = m.entry + (m.entry.includes("?") ? "&" : "?") + "_v=" + Date.now();
  el.loader.classList.remove("hidden");
  const hideLoader = () => { if (state.activeId === id) el.loader.classList.add("hidden"); };
  frame.addEventListener("load", hideLoader);
  // Safety net: never leave a permanent spinner if the load event is missed.
  setTimeout(hideLoader, 8000);
  el.frameHost.appendChild(frame);
  state.frames[id] = frame;
}

function wireChrome() {
  // Brand logo click returns to the all plugins summary cover page
  el.brandHomeBtn?.addEventListener("click", () => {
    showLanding();
  });

  // Handle browser back / forward navigation
  window.addEventListener("popstate", () => {
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash || hash === "landing") {
      showLanding();
    } else if (state.modules.some((m) => m.id === hash)) {
      openModule(hash, false);
    }
  });

  // Keyboard focus can sit in the shell instead of the plugin iframe; hand ESC over to the plugin.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !state.activeId) return;
    const frame = state.frames[state.activeId];
    frame?.contentWindow?.postMessage({ type: "ead:escape" }, window.location.origin);
  });
  el.search.addEventListener("input", () => {
    const q = el.search.value.trim().toLowerCase();
    el.list.querySelectorAll(".module-item").forEach((b) => {
      b.style.display = !q || b.dataset.search.includes(q) ? "" : "none";
    });
  });

  el.reloadBtn.addEventListener("click", () => {
    if (!state.activeId) return;
    const frame = state.frames[state.activeId];
    if (!frame) return;
    el.loader.classList.remove("hidden");
    frame.addEventListener("load", () => el.loader.classList.add("hidden"), { once: true });
    // Force a fresh reload with updated timestamp to bypass any browser cache. "_reload=1"
    // is a distinct marker (unlike the cache-busting "_v" used on every first open/F5) that
    // modules persisting state (e.g. sessionStorage) can check to start with a clean slate -
    // this button is meant to mean "give me a fresh instance", unlike a plain browser refresh.
    const baseSrc = frame.src.split("?")[0];
    frame.src = baseSrc + "?_v=" + Date.now() + "&_reload=1";
  });

  el.openNewBtn.addEventListener("click", () => {
    const m = state.modules.find((x) => x.id === state.activeId);
    if (m) window.open(m.entry, "_blank");
  });

  el.collapseBtn.addEventListener("click", () => {
    el.portal.classList.toggle("collapsed");
    localStorage.setItem("ead-portal:collapsed", el.portal.classList.contains("collapsed") ? "1" : "0");
  });
  if (localStorage.getItem("ead-portal:collapsed") === "1") el.portal.classList.add("collapsed");

  el.themeToggle.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("ead-portal:theme", next);
  });
}

function applyStoredTheme() {
  const t = localStorage.getItem("ead-portal:theme") || "light";
  document.documentElement.setAttribute("data-theme", t);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

init();
