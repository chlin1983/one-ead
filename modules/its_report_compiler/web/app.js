/* ITS Report Compiler — import ITS PDFs, compare parameters in a table.
   Supports a split-compare mode: two independent panels (A/B), each with its
   own imported reports, parameter selection, table, and statistics. */

const DEFAULT_COL_WIDTH = 140;
const MIN_COL_WIDTH = 60;

function panelTemplate(prefix) {
  return `
    <div class="toolbar">
      <span class="panel-badge">${prefix === "a" ? "A" : "B"}</span>
      <button class="btn primary" id="${prefix}-open-btn">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
        Import PDF report(s)
      </button>
      <button class="btn ghost" id="${prefix}-clear-btn" disabled>Clear</button>
      <button class="btn ghost" id="${prefix}-export-btn" disabled>Export CSV</button>
      <button class="btn ghost" id="${prefix}-stats-btn" disabled>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
        Statistics
      </button>
      <span class="spacer"></span>
      <span class="status" id="${prefix}-status">No reports loaded</span>
      <input type="file" id="${prefix}-file-input" accept=".pdf" multiple hidden />
    </div>

    <div class="split">
      <div class="pane left">
        <div class="dropzone" id="${prefix}-dropzone">
          Drop <strong>.pdf</strong> reports here<br />or use <em>Import PDF report(s)</em>
        </div>
        <div class="pane-title" id="${prefix}-param-title" hidden>Parameters (columns)</div>
        <div class="checklist" id="${prefix}-param-controls" hidden>
          <label><input type="checkbox" id="${prefix}-toggle-all" checked /> <strong>Select all</strong></label>
        </div>
        <div class="checklist" id="${prefix}-param-list"></div>
      </div>

      <div class="pane-resizer" id="${prefix}-pane-resizer"></div>

      <div class="pane right">
        <div class="empty" id="${prefix}-empty">Import ITS PDF reports to compare their parameters side by side.</div>
        <div class="table-toolbar" id="${prefix}-table-toolbar" hidden>
          <div class="jump-search">
            <svg class="icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" id="${prefix}-param-jump" placeholder="Jump to parameter…" autocomplete="off" />
            <button class="jump-clear" id="${prefix}-param-jump-clear" title="Clear" hidden>
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
            <div class="jump-dropdown" id="${prefix}-param-jump-dropdown" hidden></div>
          </div>
        </div>
        <div class="table-scroll" id="${prefix}-table-scroll" hidden></div>
        <div class="stats-panel" id="${prefix}-stats-panel" hidden>
          <div class="stats-panel-head">
            <h3 id="${prefix}-stats-title">Parameter distribution</h3>
            <span class="stats-hint" id="${prefix}-stats-hint">Click a parameter column header to view its distribution</span>
            <span class="spacer"></span>
            <button class="stats-close" id="${prefix}-stats-close" title="Hide statistics">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="stats-panel-body">
            <div class="stats-plot" id="${prefix}-stats-plot"></div>
            <div class="stats-summary" id="${prefix}-stats-summary"></div>
          </div>
        </div>
      </div>
    </div>`;
}

// Builds one fully independent panel instance (own state, own DOM, own event wiring).
function createPanel(container, prefix) {
  container.innerHTML = panelTemplate(prefix);
  const q = (id) => container.querySelector(`#${prefix}-${id}`);

  const state = { rows: [], paramKeys: [], selected: new Set(), colWidths: {}, statsOpen: false, statsKey: null };

  const el = {
    openBtn: q("open-btn"),
    clearBtn: q("clear-btn"),
    exportBtn: q("export-btn"),
    fileInput: q("file-input"),
    status: q("status"),
    dropzone: q("dropzone"),
    paramTitle: q("param-title"),
    paramControls: q("param-controls"),
    toggleAll: q("toggle-all"),
    paramList: q("param-list"),
    empty: q("empty"),
    tableScroll: q("table-scroll"),
    tableToolbar: q("table-toolbar"),
    paramJump: q("param-jump"),
    paramJumpClear: q("param-jump-clear"),
    paramJumpDropdown: q("param-jump-dropdown"),
    statsBtn: q("stats-btn"),
    statsPanel: q("stats-panel"),
    statsClose: q("stats-close"),
    statsHint: q("stats-hint"),
    statsPlot: q("stats-plot"),
    statsSummary: q("stats-summary"),
    statsTitle: q("stats-title"),
    paneResizer: q("pane-resizer"),
    split: container.querySelector(".split"),
  };

  // ── Persistence (sessionStorage) ──────────────────────────────────────────
  // Keep this panel's last loaded reports across a page refresh so the user doesn't lose
  // their work; only the explicit "Clear" button (clearAll) or the shell's top-right
  // "Reload" button (marked with ?_reload=1) wipes it.
  const PERSIST_KEY = `itsReportCompiler.state.${prefix}.v1`;

  function schedulePersist() {
    clearTimeout(schedulePersist._t);
    schedulePersist._t = setTimeout(persistState, 250);
  }

  function persistState() {
    try {
      const snapshot = {
        rows: state.rows,
        paramKeys: state.paramKeys,
        selected: Array.from(state.selected),
        colWidths: state.colWidths,
      };
      sessionStorage.setItem(PERSIST_KEY, JSON.stringify(snapshot));
    } catch (e) {
      console.warn("ITS Report Compiler: could not persist state to sessionStorage", e);
    }
  }

  function restorePersistedState() {
    let raw;
    try {
      raw = sessionStorage.getItem(PERSIST_KEY);
    } catch (e) {
      return false;
    }
    if (!raw) return false;
    try {
      const snap = JSON.parse(raw);
      if (!snap || !Array.isArray(snap.rows) || !snap.rows.length) return false;
      state.rows = snap.rows;
      state.paramKeys = snap.paramKeys || [];
      state.selected = new Set(snap.selected || []);
      state.colWidths = snap.colWidths || {};
      return true;
    } catch (e) {
      console.warn("ITS Report Compiler: could not restore persisted state", e);
      return false;
    }
  }

  attachPaneResize();

  el.openBtn.addEventListener("click", () => el.fileInput.click());
  el.fileInput.addEventListener("change", () => uploadFiles(el.fileInput.files));
  el.clearBtn.addEventListener("click", clearAll);
  el.exportBtn.addEventListener("click", exportCsv);
  el.toggleAll.addEventListener("change", () => {
    if (el.toggleAll.checked) state.paramKeys.forEach((p) => state.selected.add(p.key));
    else state.selected.clear();
    renderParamList();
    renderTable();
  });

  el.paramJump.addEventListener("input", () => {
    const qv = el.paramJump.value.trim().toLowerCase();
    el.paramJumpClear.hidden = !qv;
    if (!qv) { hideJumpDropdown(); return; }
    const matches = selectedKeys().filter((p) => p.name.toLowerCase().includes(qv)).slice(0, 20);
    renderJumpDropdown(matches);
  });
  el.paramJump.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const first = el.paramJumpDropdown.querySelector(".jump-item");
      if (first) first.click();
    } else if (e.key === "Escape") {
      clearJumpSearch();
    }
  });
  el.paramJump.addEventListener("focus", () => {
    if (el.paramJump.value.trim() && el.paramJumpDropdown.innerHTML) el.paramJumpDropdown.hidden = false;
  });
  el.paramJump.addEventListener("blur", () => {
    setTimeout(hideJumpDropdown, 150);
  });
  el.paramJumpClear.addEventListener("click", clearJumpSearch);

  el.statsBtn.addEventListener("click", toggleStats);
  el.statsClose.addEventListener("click", () => setStatsOpen(false));

  function renderJumpDropdown(matches) {
    if (!matches.length) {
      el.paramJumpDropdown.innerHTML = '<div class="jump-empty">No matches</div>';
      el.paramJumpDropdown.hidden = false;
      return;
    }
    el.paramJumpDropdown.innerHTML = matches
      .map((p) => `<div class="jump-item" data-key="${escapeAttr(p.key)}"><span class="jump-step">${p.step}</span><span>${escapeHtml(p.name)}</span></div>`)
      .join("");
    el.paramJumpDropdown.querySelectorAll(".jump-item").forEach((item) => {
      item.addEventListener("mousedown", (e) => e.preventDefault()); // keep input focus so blur doesn't hide before click
      item.addEventListener("click", () => {
        toggleStatsFor(item.dataset.key);
        jumpToColumn(item.dataset.key);
        hideJumpDropdown();
      });
    });
    el.paramJumpDropdown.hidden = false;
  }

  function hideJumpDropdown() {
    el.paramJumpDropdown.hidden = true;
    el.paramJumpDropdown.innerHTML = "";
  }

  function clearJumpSearch() {
    el.paramJump.value = "";
    el.paramJumpClear.hidden = true;
    hideJumpDropdown();
  }

  function jumpToColumn(key) {
    const table = el.tableScroll.querySelector("table.data");
    if (!table) return;
    const th = [...table.querySelectorAll("th")].find((t) => t.dataset.col === key);
    if (!th) return;
    const idx = th.cellIndex;
    th.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    // Brief scroll-arrival pulse on top of the persistent .active stats highlight (toggleStatsFor).
    const flashCells = [th, ...[...table.querySelectorAll("tbody tr")].map((r) => r.cells[idx]).filter(Boolean)];
    flashCells.forEach((c) => c.classList.add("col-flash"));
    setTimeout(() => flashCells.forEach((c) => c.classList.remove("col-flash")), 1200);
  }

  // Drag the handle between the parameter list and the table to resize the left panel.
  function attachPaneResize() {
    el.paneResizer.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = el.split.getBoundingClientRect().width;
      const leftEl = container.querySelector(".pane.left");
      const startPaneWidth = leftEl.getBoundingClientRect().width;
      const onMove = (ev) => {
        const w = Math.max(160, Math.min(startWidth - 120, Math.round(startPaneWidth + (ev.clientX - startX))));
        el.split.style.setProperty("--pane-w", `${w}px`);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.classList.remove("col-resizing");
        el.paneResizer.classList.remove("active");
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.body.classList.add("col-resizing");
      el.paneResizer.classList.add("active");
    });
  }

  ["dragover", "dragenter"].forEach((ev) =>
    el.dropzone.addEventListener(ev, (e) => { e.preventDefault(); el.dropzone.classList.add("drag"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    el.dropzone.addEventListener(ev, (e) => { e.preventDefault(); el.dropzone.classList.remove("drag"); })
  );
  el.dropzone.addEventListener("drop", (e) => {
    if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files);
  });

  async function uploadFiles(fileList) {
    const files = [...fileList].filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (!files.length) return;
    el.status.textContent = "Parsing… (this can take a moment)";
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    try {
      const res = await fetch("/api/its-report-compiler/parse", { method: "POST", body: fd });
      const data = await res.json();
      mergePayload(data);
      el.toggleAll.checked = state.selected.size === state.paramKeys.length;
      renderParamList();
      renderTable();
      if (state.statsOpen) renderStats(state.statsKey);
      const failed = state.rows.filter((r) => r.error).length;
      el.status.textContent = `${state.rows.length} report(s), ${state.paramKeys.length} parameter(s)` +
        (failed ? ` · ${failed} failed to parse` : "");
      el.clearBtn.disabled = false;
      el.exportBtn.disabled = false;
      el.statsBtn.disabled = false;
    } catch (err) {
      el.status.textContent = "Parse failed";
      console.error(err);
    }
    el.fileInput.value = "";
  }

  // Append newly parsed reports to the existing set instead of replacing them.
  function mergePayload(data) {
    const isFirst = state.rows.length === 0;
    const newRows = data.rows || [];
    const newKeys = data.paramKeys || [];

    // Upsert rows by file name so re-importing the same file refreshes it.
    const byFile = new Map(state.rows.map((r) => [r.file, r]));
    newRows.forEach((r) => byFile.set(r.file, r));
    state.rows = [...byFile.values()];

    // Union parameter keys; newly discovered parameters become visible by default.
    const known = new Set(state.paramKeys.map((p) => p.key));
    newKeys.forEach((p) => {
      if (!known.has(p.key)) {
        state.paramKeys.push(p);
        state.selected.add(p.key);
        known.add(p.key);
      }
    });
    state.paramKeys.sort((a, b) => a.step - b.step);
    if (isFirst) state.selected = new Set(state.paramKeys.map((p) => p.key));
  }

  function clearAll() {
    state.rows = [];
    state.paramKeys = [];
    state.selected.clear();
    state.colWidths = {};
    state.statsOpen = false;
    state.statsKey = null;
    try { sessionStorage.removeItem(PERSIST_KEY); } catch (e) {}
    el.paramList.innerHTML = "";
    el.paramTitle.hidden = true;
    el.paramControls.hidden = true;
    el.dropzone.hidden = false;
    el.tableScroll.hidden = true;
    el.tableToolbar.hidden = true;
    el.statsPanel.hidden = true;
    clearJumpSearch();
    el.empty.hidden = false;
    el.clearBtn.disabled = true;
    el.exportBtn.disabled = true;
    el.statsBtn.disabled = true;
    el.statsBtn.classList.remove("active");
    el.status.textContent = "No reports loaded";
  }

  function renderParamList() {
    el.dropzone.hidden = state.paramKeys.length > 0;
    el.paramTitle.hidden = state.paramKeys.length === 0;
    el.paramControls.hidden = state.paramKeys.length === 0;
    el.paramList.innerHTML = "";
    state.paramKeys.forEach((p) => {
      const label = document.createElement("label");
      const checked = state.selected.has(p.key) ? "checked" : "";
      label.innerHTML = `<input type="checkbox" ${checked} data-key="${escapeAttr(p.key)}" /> <span>${p.step}. ${escapeHtml(p.name)}</span>`;
      label.querySelector("input").addEventListener("change", (e) => {
        if (e.target.checked) state.selected.add(p.key);
        else state.selected.delete(p.key);
        el.toggleAll.checked = state.selected.size === state.paramKeys.length;
        renderTable();
      });
      el.paramList.appendChild(label);
    });
  }

  function resultClass(v) {
    const s = (v || "").toLowerCase();
    if (s.startsWith("pass")) return "cell-pass";
    if (s.startsWith("fail")) return "cell-fail";
    if (s.startsWith("warn")) return "cell-warn";
    return "";
  }

  function selectedKeys() {
    return state.paramKeys.filter((p) => state.selected.has(p.key));
  }

  function colWidth(key, autoW) {
    return state.colWidths[key] || autoW || DEFAULT_COL_WIDTH;
  }

  // Estimate a "fits the content" pixel width from the header label and the widest cell value.
  function estimateColWidth(label, values) {
    const CHAR_PX = 6.6;
    const PAD = 30;
    let maxLen = String(label).length;
    values.forEach((v) => {
      const len = String(v ?? "").length;
      if (len > maxLen) maxLen = len;
    });
    const w = Math.round(maxLen * CHAR_PX + PAD);
    return Math.min(Math.max(w, MIN_COL_WIDTH), 260);
  }

  function renderTable() {
    if (!state.rows.length) {
      schedulePersist();
      return;
    }
    el.empty.hidden = true;
    el.tableScroll.hidden = false;
    el.tableToolbar.hidden = false;
    const keys = selectedKeys();

    const cols = [
      { key: "serial", label: "Serial No.", sticky: true },
      { key: "result", label: "Result" },
      { key: "startTime", label: "Start Time" },
      ...keys.map((p) => ({ key: p.key, label: p.name, title: `Step ${p.step}` })),
    ];

    // Auto-fit each column's width to its content (header + widest value), unless the user resized it.
    const autoWidths = {
      serial: estimateColWidth("Serial No.", state.rows.map((r) => r.serial)),
      result: estimateColWidth("Result", state.rows.map((r) => r.result || "—")),
      startTime: estimateColWidth("Start Time", state.rows.map((r) => r.startTime || "")),
    };
    keys.forEach((p) => {
      autoWidths[p.key] = estimateColWidth(p.name, state.rows.map((r) => r.params[p.key]?.measured ?? ""));
    });

    let html = '<table class="data"><colgroup>';
    cols.forEach((c) => { html += `<col style="width:${colWidth(c.key, autoWidths[c.key])}px">`; });
    html += "</colgroup><thead><tr>";
    cols.forEach((c) => {
      const isParam = c.key !== "serial" && c.key !== "result" && c.key !== "startTime";
      const classes = [];
      if (c.sticky) classes.push("sticky-col");
      if (isParam) classes.push("param-th");
      if (isParam && state.statsOpen && c.key === state.statsKey) classes.push("active");
      const cls = classes.length ? ` class="${classes.join(" ")}"` : "";
      const title = isParam ? ' title="Click to view distribution"' : (c.title ? ` title="${escapeAttr(c.title)}"` : "");
      html += `<th${cls}${title} data-col="${escapeAttr(c.key)}">${escapeHtml(c.label)}<span class="col-resizer"></span></th>`;
    });
    html += "</tr></thead><tbody>";

    state.rows.forEach((r) => {
      html += "<tr>";
      html += `<td class="sticky-col">${escapeHtml(r.serial)}</td>`;
      html += `<td class="${resultClass(r.result)}">${escapeHtml(r.result || "—")}</td>`;
      html += `<td>${escapeHtml(r.startTime || "")}</td>`;
      keys.forEach((p) => {
        const cell = r.params[p.key];
        const activeCls = state.statsOpen && p.key === state.statsKey ? " active" : "";
        if (cell) html += `<td class="measured ${resultClass(cell.result)}${activeCls}" data-col="${escapeAttr(p.key)}">${escapeHtml(cell.measured)}</td>`;
        else html += `<td class="${activeCls.trim()}" data-col="${escapeAttr(p.key)}"></td>`;
      });
      html += "</tr>";
    });
    html += "</tbody>";
    html += buildStatsFooter(keys, autoWidths);
    html += "</table>";
    el.tableScroll.innerHTML = html;
    attachColumnResize();
    attachHeaderStats();
    schedulePersist();
  }

  // Sticky footer rows summarising each parameter column directly in the table.
  function buildStatsFooter(keys, autoWidths) {
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#e08a1e";
    const statRows = [
      ["Min", (s) => fmt(s.min)],
      ["Max", (s) => fmt(s.max)],
      ["Avg", (s) => fmt(s.mean)],
      ["Median", (s) => fmt(s.median)],
      ["Std", (s) => fmt(s.std)],
    ];
    const colStats = keys.map((p) => computeStats(numericSeries(p.key).map((d) => d.value)));
    let html = "<tfoot>";
    // Mini box plot per column.
    html += '<tr><th class="sticky-col stat-name">Box</th><td></td><td></td>';
    keys.forEach((p, i) => {
      const s = colStats[i];
      const activeCls = state.statsOpen && p.key === state.statsKey ? " active" : "";
      html += `<td class="box-cell${activeCls}" data-col="${escapeAttr(p.key)}">${s ? miniBoxSvg(s, p.key, accent, autoWidths[p.key]) : ""}</td>`;
    });
    html += "</tr>";
    statRows.forEach(([label, get]) => {
      html += "<tr>";
      html += `<th class="sticky-col stat-name">${label}</th>`;
      html += "<td></td><td></td>";
      colStats.forEach((s, i) => {
        const activeCls = state.statsOpen && keys[i].key === state.statsKey ? " active" : "";
        html += `<td class="${activeCls.trim()}" data-col="${escapeAttr(keys[i].key)}">${s ? get(s) : ""}</td>`;
      });
      html += "</tr>";
    });
    html += "</tfoot>";
    return html;
  }

  // Compact horizontal box plot (min–Q1–median–Q3–max) drawn as inline SVG for a column footer cell.
  // Shows min/max above and median below the plot.
  function miniBoxSvg(s, key, color, autoW) {
    const w = Math.max(64, colWidth(key, autoW) - 24);
    const h = 46;
    const pad = 3;
    const innerW = w - pad * 2;

    // Degenerate case: every value identical -> a single centered label (no overlapping min/max/median).
    if (s.max - s.min === 0) {
      return (
        `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
        `<line x1="${w / 2}" y1="16" x2="${w / 2}" y2="30" stroke="${color}" stroke-width="1.6"/>` +
        `<text x="${w / 2}" y="${h - 4}" font-size="11" fill="${color}" text-anchor="middle">${escapeHtml(fmt(s.median))}</text>` +
        `</svg>`
      );
    }

    const range = s.max - s.min;
    const sx = (v) => pad + ((v - s.min) / range) * innerW;
    const midY = 24;
    const top = 16;
    const bot = 32;
    const x1 = sx(s.min), xq1 = sx(s.q1), xmed = sx(s.median), xq3 = sx(s.q3), x2 = sx(s.max);
    const boxW = Math.max(1, xq3 - xq1);
    return (
      `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<text x="${x1}" y="10" font-size="11" fill="${color}" text-anchor="start">${escapeHtml(fmt(s.min))}</text>` +
      `<text x="${x2}" y="10" font-size="11" fill="${color}" text-anchor="end">${escapeHtml(fmt(s.max))}</text>` +
      `<line x1="${x1}" y1="${midY}" x2="${x2}" y2="${midY}" stroke="${color}" stroke-width="1"/>` +
      `<line x1="${x1}" y1="${top + 2}" x2="${x1}" y2="${bot - 2}" stroke="${color}" stroke-width="1"/>` +
      `<line x1="${x2}" y1="${top + 2}" x2="${x2}" y2="${bot - 2}" stroke="${color}" stroke-width="1"/>` +
      `<rect x="${xq1}" y="${top}" width="${boxW}" height="${bot - top}" fill="rgba(224,138,30,0.20)" stroke="${color}" stroke-width="1"/>` +
      `<line x1="${xmed}" y1="${top}" x2="${xmed}" y2="${bot}" stroke="${color}" stroke-width="1.6"/>` +
      `<text x="${xmed}" y="${h - 2}" font-size="11" fill="${color}" text-anchor="middle">${escapeHtml(fmt(s.median))}</text>` +
      `</svg>`
    );
  }

  // Clicking a parameter column header opens the docked distribution panel for it.
  function attachHeaderStats() {
    const table = el.tableScroll.querySelector("table.data");
    if (!table) return;
    table.querySelectorAll("th.param-th").forEach((th) => {
      th.addEventListener("click", (e) => {
        if (e.target.classList.contains("col-resizer")) return; // ignore resize handle
        toggleStatsFor(th.dataset.col);
      });
    });
  }

  function attachColumnResize() {
    const table = el.tableScroll.querySelector("table.data");
    if (!table) return;
    const colEls = table.querySelectorAll("colgroup col");
    table.querySelectorAll("th").forEach((th, i) => {
      const handle = th.querySelector(".col-resizer");
      if (!handle) return;
      handle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const col = colEls[i];
        const key = th.dataset.col;
        const startX = e.clientX;
        const startWidth = th.getBoundingClientRect().width;
        const onMove = (ev) => {
          const w = Math.max(MIN_COL_WIDTH, Math.round(startWidth + (ev.clientX - startX)));
          col.style.width = `${w}px`;
          state.colWidths[key] = w;
        };
        const onUp = () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          document.body.classList.remove("col-resizing");
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        document.body.classList.add("col-resizing");
      });
    });
  }

  function exportCsv() {
    const keys = selectedKeys();
    const head = ["Serial No.", "Result", "Start Time", ...keys.map((p) => `${p.step}. ${p.name}`)];
    const lines = [head.map(csv).join(",")];
    state.rows.forEach((r) => {
      const cells = [r.serial, r.result, r.startTime, ...keys.map((p) => r.params[p.key]?.measured ?? "")];
      lines.push(cells.map(csv).join(","));
    });
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = prefix === "a" ? "its_report_compiler.csv" : "its_report_compiler_b.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* --- Statistics ------------------------------------------------------------ */

  // Pull the numeric measured values for one parameter, keyed by report serial.
  function numericSeries(key) {
    const points = [];
    state.rows.forEach((r) => {
      const cell = r.params[key];
      if (!cell) return;
      const num = parseNumber(cell.measured);
      if (num !== null) points.push({ serial: r.serial, value: num });
    });
    return points;
  }

  function computeStats(nums) {
    const n = nums.length;
    if (!n) return null;
    const sorted = [...nums].sort((a, b) => a - b);
    const sum = nums.reduce((a, b) => a + b, 0);
    const mean = sum / n;
    const variance = n > 1 ? nums.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
    return {
      n,
      min: sorted[0],
      max: sorted[n - 1],
      mean,
      median: quantile(sorted, 0.5),
      q1: quantile(sorted, 0.25),
      q3: quantile(sorted, 0.75),
      std: Math.sqrt(variance),
      range: sorted[n - 1] - sorted[0],
    };
  }

  function toggleStats() {
    setStatsOpen(!state.statsOpen);
  }

  function setStatsOpen(open) {
    state.statsOpen = open;
    el.statsPanel.hidden = !open;
    el.statsBtn.classList.toggle("active", open);
    if (open) {
      // Default to the first numeric parameter if none selected yet.
      if (!state.statsKey || !selectedKeys().some((p) => p.key === state.statsKey)) {
        const first = selectedKeys().find((p) => numericSeries(p.key).length > 0);
        state.statsKey = first ? first.key : null;
      }
      renderStats(state.statsKey);
      renderTable();
    } else {
      try { Plotly.purge(el.statsPlot); } catch (e) {}
      renderTable();
    }
  }

  function showStatsFor(key) {
    state.statsKey = key;
    if (!state.statsOpen) { setStatsOpen(true); return; }
    renderStats(key);
    // Refresh the active-column highlight (header + every body/footer cell) without a full rebuild.
    const table = el.tableScroll.querySelector("table.data");
    if (table) {
      table.querySelectorAll("th.param-th").forEach((th) => th.classList.toggle("active", th.dataset.col === key));
      table.querySelectorAll("td[data-col]").forEach((td) => td.classList.toggle("active", td.dataset.col === key));
    }
  }

  // Clicking the currently-active column again closes the stats panel; any other column
  // opens the panel (if closed) or switches the chart to it (if already open).
  function toggleStatsFor(key) {
    if (state.statsOpen && state.statsKey === key) {
      setStatsOpen(false);
      return;
    }
    showStatsFor(key);
  }

  function renderStats(key) {
    const param = state.paramKeys.find((p) => p.key === key);
    const points = key ? numericSeries(key) : [];
    const nums = points.map((p) => p.value);
    const stats = computeStats(nums);
    el.statsTitle.textContent = param ? `${param.step}. ${param.name}` : "Parameter distribution";

    if (!stats) {
      el.statsHint.hidden = false;
      el.statsSummary.innerHTML = "";
      try { Plotly.purge(el.statsPlot); } catch (e) {}
      el.statsPlot.innerHTML = '<div class="stats-empty">Click a numeric parameter column header to view its distribution.</div>';
      return;
    }
    el.statsHint.hidden = true;

    const rows = [
      ["Count (N)", String(stats.n)],
      ["Maximum", fmt(stats.max)],
      ["Upper quartile (Q3)", fmt(stats.q3)],
      ["Median", fmt(stats.median)],
      ["Mean (average)", fmt(stats.mean)],
      ["Lower quartile (Q1)", fmt(stats.q1)],
      ["Minimum", fmt(stats.min)],
      ["Std. deviation", fmt(stats.std)],
      ["Range", fmt(stats.range)],
    ];
    el.statsSummary.innerHTML = rows
      .map(([label, value]) => `<div class="stat-row"><span class="stat-label">${label}</span><span class="stat-value">${value}</span></div>`)
      .join("");

    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#e08a1e";

    // The bundled Plotly is the "basic" build (no histogram/box trace types), so bin
    // the values manually and draw a vertical bar chart, matching a Minitab histogram.
    const nbins = Math.max(5, Math.min(20, Math.ceil(Math.sqrt(stats.n))));
    const binWidth = (stats.max - stats.min) / nbins || 1;
    const binCenters = [];
    const counts = [];
    for (let i = 0; i < nbins; i++) {
      const lo = stats.min + i * binWidth;
      const hi = lo + binWidth;
      binCenters.push(lo + binWidth / 2);
      counts.push(nums.filter((v) => v >= lo && (i === nbins - 1 ? v <= hi : v < hi)).length);
    }
    const traces = [{
      type: "bar",
      x: binCenters,
      y: counts,
      width: binWidth * 0.96,
      name: "Frequency",
      marker: { color: "rgba(224,138,30,0.55)", line: { color: accent, width: 1 } },
      text: counts.map((c, i) => (c > 0 ? `${fmt(binCenters[i])}<br>${c}` : "")),
      textposition: "outside",
      textfont: { size: 13, color: "#1f2937" },
      cliponaxis: false,
      hoverinfo: "skip", // value + frequency are already shown as permanent labels above each bar
    }];
    if (stats.std > 0) {
      const xs = [];
      const ys = [];
      const steps = 80;
      const lo = stats.min - binWidth;
      const hi = stats.max + binWidth;
      for (let i = 0; i <= steps; i++) {
        const x = lo + ((hi - lo) * i) / steps;
        const pdf = Math.exp(-((x - stats.mean) ** 2) / (2 * stats.std ** 2)) / (stats.std * Math.sqrt(2 * Math.PI));
        xs.push(x);
        ys.push(stats.n * binWidth * pdf); // scale PDF to expected frequency
      }
      traces.push({
        type: "scatter",
        mode: "lines",
        x: xs,
        y: ys,
        name: "Normal",
        line: { color: "#b23b3b", width: 2 },
        hoverinfo: "skip",
      });
    }
    const layout = {
      margin: { l: 50, r: 16, t: 44, b: 44 },
      height: 270,
      bargap: 0.04,
      showlegend: false,
      xaxis: { title: { text: "Measured value", font: { size: 13, color: "#1f2937" } }, zeroline: false, gridcolor: "#e6ebf3", tickfont: { size: 12, color: "#1f2937" } },
      yaxis: { title: { text: "Frequency", font: { size: 13, color: "#1f2937" } }, zeroline: false, gridcolor: "#e6ebf3", rangemode: "tozero", tickfont: { size: 12, color: "#1f2937" } },
      paper_bgcolor: "transparent",
      plot_bgcolor: "transparent",
      font: { family: "Segoe UI, Inter, system-ui, sans-serif", size: 12, color: "#47546a" },
    };
    Plotly.newPlot(el.statsPlot, traces, layout, { displayModeBar: false, responsive: true });
  }

  // Restore this panel's last loaded reports (if any) so a plain page refresh doesn't lose
  // the user's work. The shell's top-right "Reload" button marks its navigation with
  // "_reload=1" to mean "give me a clean page" - honor that by wiping persisted state instead.
  const isExplicitReload = new URLSearchParams(window.location.search).get("_reload") === "1";
  if (isExplicitReload) {
    try { sessionStorage.removeItem(PERSIST_KEY); } catch (e) {}
  } else if (restorePersistedState()) {
    el.toggleAll.checked = state.selected.size === state.paramKeys.length;
    renderParamList();
    renderTable();
    if (state.statsOpen) renderStats(state.statsKey);
    const failed = state.rows.filter((r) => r.error).length;
    el.status.textContent = `${state.rows.length} report(s), ${state.paramKeys.length} parameter(s)` +
      (failed ? ` · ${failed} failed to parse` : "");
    el.clearBtn.disabled = false;
    el.exportBtn.disabled = false;
    el.statsBtn.disabled = false;
  }

  return {
    // Re-fit the Plotly plot after the panel's width changes (e.g. split toggle).
    resizeStatsPlot() {
      if (state.statsOpen) {
        try { Plotly.Plots.resize(el.statsPlot); } catch (e) {}
      }
    },
  };
}

function parseNumber(raw) {
  if (raw === null || raw === undefined) return null;
  const m = String(raw).replace(/,/g, "").match(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base];
}

function fmt(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e6)) return v.toExponential(3);
  return Number(v.toFixed(4)).toString();
}

function csv(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

/* --- App bootstrap: two independent panels + the split-view toggle -------- */

const panels = [
  createPanel(document.getElementById("panel-a"), "a"),
  createPanel(document.getElementById("panel-b"), "b"),
];

// The Split view toggle lives in panel A's own toolbar (no separate row needed).
const workspace = document.getElementById("workspace");
const panelB = document.getElementById("panel-b");
const panelDivider = document.getElementById("panel-divider");
const panelAStatus = document.getElementById("a-status");
const panelAToolbar = panelAStatus.closest(".toolbar");

const splitToggle = document.createElement("button");
splitToggle.className = "btn ghost";
splitToggle.id = "split-toggle";
splitToggle.title = "Compare two independent datasets side by side";
splitToggle.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="12" y1="4" x2="12" y2="20"/></svg><span> Split view</span>';
panelAToolbar.insertBefore(splitToggle, panelAStatus);
const splitToggleLabel = splitToggle.querySelector("span");

splitToggle.addEventListener("click", () => {
  const turningOn = panelB.hidden; // currently off -> turning on
  panelB.hidden = !turningOn;
  panelDivider.hidden = !turningOn;
  workspace.classList.toggle("is-split", turningOn);
  splitToggle.classList.toggle("active", turningOn);
  splitToggleLabel.textContent = turningOn ? " Single view" : " Split view";
  requestAnimationFrame(() => panels.forEach((p) => p.resizeStatsPlot()));
});

