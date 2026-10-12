(() => {
  "use strict";
  const API = "/api/gpt-researcher";
  const PREFS_KEY = "gpt-researcher:prefs:v3";
  const LAST_KEY = "gpt-researcher:last";
  const DRAFT_KEY = "gpt-researcher:draft";
  const OPEN_KEY = "gpt-researcher:folders-open";
  const SIDE_KEY = "gpt-researcher:side-w";
  const DRAG_TYPE = "application/x-gpt-researcher-report";
  const $ = (id) => document.getElementById(id);

  const state = {
    status: null, reports: [], folders: [], selectedId: null, runState: "idle", optionsSig: "",
    unchecked: new Set(), busyStart: false, timer: null,
    open: (() => { try { return JSON.parse(localStorage.getItem(OPEN_KEY)) || {}; } catch { return {}; } })(),
  };

  function el(tag, props, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) node.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null) node.append(kid);
    return node;
  }

  async function api(path, opts = {}) {
    const init = { method: opts.method || "GET", headers: {} };
    if (opts.json !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(opts.json); }
    if (opts.form) init.body = opts.form;
    const res = await fetch(API + path, init);
    if (!res.ok) {
      let detail = res.statusText;
      try { detail = (await res.json()).detail || detail; } catch { /* not JSON */ }
      throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    }
    return res.json();
  }

  let toastTimer;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
  }

  // ------------------------------------------------------------ safe Markdown (DOM only, no innerHTML)

  // Reference numbers found in the report's References/Sources section; only those become clickable citations.
  let refTitles = new Map();
  let refLines = new Set();

  function jumpToRef(n) {
    const target = document.querySelector(`.md [data-ref="${n}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.remove("flash");
    void target.offsetWidth;
    target.classList.add("flash");
  }

  function inline(text, parent) {
    const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)\s]+\))|(https?:\/\/[^\s<>"'`\])]+)|(\[\d{1,3}(?:\s*[,;]\s*\d{1,3})*\])/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) parent.append(text.slice(last, m.index));
      const tok = m[0];
      if (m[1]) parent.append(el("code", { text: tok.slice(1, -1) }));
      else if (m[2]) { const b = el("strong"); inline(tok.slice(2, -2), b); parent.append(b); }
      else if (m[3]) { const i = el("em"); inline(tok.slice(1, -1), i); parent.append(i); }
      else if (m[5]) {
        const trail = /[.,;:!?]+$/.exec(tok);
        const url = trail ? tok.slice(0, -trail[0].length) : tok;
        parent.append(el("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: url }));
        if (trail) parent.append(trail[0]);
      } else if (m[6]) {
        const nums = tok.slice(1, -1).split(/\s*[,;]\s*/);
        parent.append("[");
        nums.forEach((n, k) => {
          if (k) parent.append(", ");
          if (refTitles.has(n)) {
            parent.append(el("a", { href: "#", class: "cite", text: n, title: `Go to reference ${n}: ${refTitles.get(n)}`,
              onclick: (e) => { e.preventDefault(); jumpToRef(n); } }));
          } else parent.append(n);
        });
        parent.append("]");
      } else {
        const [, label, url] = /\[([^\]]+)\]\(([^)\s]+)\)/.exec(tok);
        if (/^https?:\/\//i.test(url)) parent.append(el("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: label }));
        else parent.append(label);
      }
      last = m.index + tok.length;
    }
    if (last < text.length) parent.append(text.slice(last));
  }

  function renderMarkdown(md, root) {
    root.replaceChildren();
    const lines = md.replace(/\r\n?/g, "\n").split("\n");
    refTitles = new Map(); refLines = new Set();
    let inRefs = false;
    lines.forEach((ln, idx) => {
      if (/^#{1,6}\s/.test(ln)) inRefs = /^#{1,6}\s*(references|sources|bibliography)\s*$/i.test(ln);
      else if (inRefs) {
        const r = /^\s*\[(\d{1,3})\]\s+(\S.*)$/.exec(ln);
        if (r) { refLines.add(idx); refTitles.set(r[1], r[2].replace(/\s+-?\s*https?:\/\/\S+\s*$/, "").slice(0, 120)); }
      }
    });
    let i = 0;
    const isTableRow = (s) => /^\s*\|.*\|\s*$/.test(s);
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      if (refLines.has(i)) {
        const r = /^\s*\[(\d{1,3})\]\s+(\S.*)$/.exec(line);
        const entry = el("div", { class: "ref", "data-ref": r[1] }, el("span", { class: "ref-n", text: `[${r[1]}]` }), " ");
        inline(r[2], entry);
        root.append(entry); i++;
        continue;
      }
      let m;
      if (/^```/.test(line)) {
        const buf = []; i++;
        while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
        i++;
        root.append(el("pre", {}, el("code", { text: buf.join("\n") })));
      } else if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
        const h = el("h" + m[1].length); inline(m[2], h); root.append(h); i++;
      } else if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
        root.append(el("hr")); i++;
      } else if (isTableRow(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes("-")) {
        const cells = (s) => s.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        const table = el("table"), head = el("tr");
        for (const c of cells(line)) { const th = el("th"); inline(c, th); head.append(th); }
        table.append(el("thead", {}, head));
        const body = el("tbody");
        i += 2;
        while (i < lines.length && isTableRow(lines[i])) {
          const tr = el("tr");
          for (const c of cells(lines[i++])) { const td = el("td"); inline(c, td); tr.append(td); }
          body.append(tr);
        }
        table.append(body); root.append(table);
      } else if (/^\s*>/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
        const q = el("blockquote"); inline(buf.join(" "), q); root.append(q);
      } else if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
        const ordered = /^\s*\d/.test(line), list = el(ordered ? "ol" : "ul");
        while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
          const li = el("li"); inline(lines[i++].replace(/^\s*([-*+]|\d+[.)])\s+/, ""), li); list.append(li);
        }
        root.append(list);
      } else {
        const buf = [];
        while (i < lines.length && lines[i].trim() && !refLines.has(i) && !/^(```|#{1,6}\s|\s*>|\s*([-*+]|\d+[.)])\s+)/.test(lines[i])) buf.push(lines[i++]);
        const p = el("p"); inline(buf.join(" "), p); root.append(p);
      }
    }
  }

  // ------------------------------------------------------------ rendering

  function chip(node, text, ok) { node.textContent = text; node.dataset.ok = String(ok); }

  function renderChips(s) {
    const e = s.engine;
    chip($("chip-engine"), e.installed ? `engine v${e.version}${e.current ? "" : " (update)"}${e.update_available ? ` ↑ ${e.latest}` : ""}` : "engine: not installed", e.current);
    chip($("chip-ollama"), s.ollama.running ? `Ollama: ${s.ollama.models.length} model${s.ollama.models.length === 1 ? "" : "s"}` : "Ollama: not running", s.ollama.running);
  }

  function renderPrivacy() {
    const source = $("source").value || "local";
    const c = $("chip-privacy");
    c.dataset.mode = source === "local" ? "local" : "web";
    c.textContent = source === "local" ? "Offline: nothing leaves this PC" : "Web search on: search terms leave this PC";
    $("web-opts").hidden = source === "local";
    $("len-hint").textContent = $("report-type").value === "detailed_report"
      ? "Detailed reports are written section by section, so 2000-3000 words stay technical and sourced. Expect roughly 10-25 minutes on a laptop GPU."
      : $("report-type").value === "research_report" ? "Single-pass reports work best below about 1500 words; use the detailed type for longer ones." : "";
  }

  function renderEngineUpdate(s, cards) {
    const e = s.engine, u = s.update;
    if (!e.installed || !e.current) return;
    const key = `${u.state}|${u.to}|${u.message}|${u.error}`;
    const showResult = u.state === "running" || (u.state !== "idle" && state.dismissed !== key);
    if (!state.showEngine && !e.update_available && !showResult) return;
    const busy = u.state === "running" || s.install.state === "running" || ["running", "cancelling"].includes(s.run.state);
    const post = async (path, json) => { try { await api(path, { method: "POST", json }); } catch (err) { toast(err.message); } refresh(); };

    const info = e.update_available
      ? [el("strong", { text: `Engine update available: ${e.version} → ${e.latest}` }),
         el("small", {}, "It is installed as a separate copy, checked against this plugin and test-run offline first; your current engine stays unless every check passes. Read the ",
           el("a", { href: e.release_notes, target: "_blank", rel: "noopener noreferrer", text: "release notes" }), ".")]
      : [el("strong", { text: `Research engine v${e.version} is up to date` }),
         el("small", { text: `Latest known: ${e.latest || "not checked yet"}${e.checked_at ? ` (checked ${fmtDate(e.checked_at)})` : ""}${e.check_error ? ` — check failed: ${e.check_error}` : ""}` })];
    const buttons = [];
    if (e.update_available) buttons.push(el("button", { class: "btn primary", type: "button", disabled: busy, text: "Update & verify", onclick: () => post("/engine/update") }));
    buttons.push(el("button", { class: "btn small", type: "button", disabled: busy, text: "Check now", onclick: () => post("/engine/update/check") }));
    if (e.previous) buttons.push(el("button", { class: "btn small", type: "button", disabled: busy, text: `Roll back to v${e.previous}`,
      onclick: () => { if (confirm(`Switch back to engine v${e.previous}?`)) post("/engine/rollback"); } }));
    cards.push(el("div", { class: "setup-card" }, el("div", { class: "txt" }, info), buttons));

    if (state.showEngine) {
      const last = e.last_update;
      cards.push(el("div", { class: "setup-card" }, el("div", { class: "txt" },
        el("label", { class: "chk" },
          el("input", { type: "checkbox", checked: e.auto_update, onchange: (ev) => post("/engine/update/settings", { auto_update: ev.target.checked }) }),
          " Install verified updates automatically"),
        el("small", { text: "Same major version only, releases at least 2 days old, and only when Ollama can run the offline test job. The newest version is looked up every 6 hours (one request to pypi.org)." }),
        last ? el("small", { text: `Last change: ${last.result} ${last.from || ""} → ${last.to || ""} (${fmtDate(last.at)})${last.auto ? " [automatic]" : ""} — ${last.detail || ""}` }) : null)));
    }

    if (showResult) {
      const checks = u.checks;
      const lines = [];
      if (checks && checks.static) lines.push(`Compatibility: ${checks.static.errors.length ? checks.static.errors.join("; ") : "passed"}${checks.static.warnings.length ? ` (warnings: ${checks.static.warnings.join("; ")})` : ""}`);
      if (checks && checks.functional && checks.functional.state !== "pending") lines.push(`Test job: ${checks.functional.state}${checks.functional.detail ? ` — ${checks.functional.detail}` : ""}`);
      const head = el("div", { class: "txt" },
        el("strong", { text: u.state === "running" ? `Updating to ${u.to}: ${u.message}` : u.message }),
        u.error ? el("small", { text: u.error }) : null,
        lines.map((l) => el("small", { text: l })));
      cards.push(el("div", { class: u.state === "error" ? "setup-card ai-warn" : "setup-card" }, head,
        u.state === "running" ? null : el("button", { class: "btn small", type: "button", text: "Dismiss", onclick: () => { state.dismissed = key; render(); } })));
      if (u.log.length) cards.push(el("pre", { class: "log", text: u.log.join("\n") }));
    }
  }

  function renderSetup(s) {
    const box = $("setup"), cards = [];
    const busyInstall = s.install.state === "running";
    if (!s.engine.current) {
      cards.push(el("div", { class: "setup-card" },
        el("div", { class: "txt" },
          el("strong", { text: s.engine.installed ? "Research engine needs an update" : "Research engine not installed" }),
          el("small", { text: `Installs gpt-researcher ${s.engine.pinned} into a private folder (a few hundred MB, needs internet once). Nothing is added to One EAD's own Python.` })),
        el("button", { class: "btn primary", type: "button", disabled: busyInstall, text: busyInstall ? "Installing…" : (s.engine.installed ? "Update engine" : "Install engine"),
          onclick: async () => { try { await api("/engine/install", { method: "POST" }); refresh(); } catch (e) { toast(e.message); } } })));
      if (s.install.state === "error") cards.push(el("div", { class: "setup-card ai-warn", text: s.install.error }));
      if (s.install.log.length && s.install.state !== "idle") cards.push(el("pre", { class: "log", text: s.install.log.join("\n") }));
    }
    if (!s.ollama.running) {
      cards.push(el("div", { class: "setup-card" }, el("div", { class: "txt" },
        el("strong", { text: "Ollama is not running" }),
        el("small", {}, "Install Ollama from ollama.com (or start it), then it appears here automatically. The DeepTutor plugin also has a guided \"Local AI setup\"."))));
    } else if (!s.ollama.models.length) {
      const row = el("div", { class: "setup-card" }, el("div", { class: "txt" },
        el("strong", { text: "No chat model installed yet" }),
        el("small", { text: "Download one (needs internet once; the model then runs fully offline). 6 GB GPU: qwen3:4b or qwen3:8b; 16 GB RAM+: gemma4:e4b." })));
      for (const name of s.ollama.recommended) {
        row.append(el("button", { class: "btn small", type: "button", disabled: s.pull.state === "running", text: `Get ${name}`,
          onclick: async () => { try { await api("/models/pull", { method: "POST", json: { model: name } }); refresh(); } catch (e) { toast(e.message); } } }));
      }
      cards.push(row);
    }
    if (s.pull.state === "running") {
      cards.push(el("div", { class: "setup-card" }, el("div", { class: "txt" },
        el("strong", { text: `Downloading ${s.pull.model}` }),
        el("small", { text: `${s.pull.message}${s.pull.percent != null ? ` — ${s.pull.percent}%` : ""}` }))));
    } else if (s.pull.state === "error") {
      cards.push(el("div", { class: "setup-card ai-warn", text: `Model download failed: ${s.pull.error}` }));
    }
    renderEngineUpdate(s, cards);
    box.replaceChildren(...cards);
    box.hidden = cards.length === 0;
  }

  function fillSelect(sel, entries, current) {
    sel.replaceChildren(...entries.map(([value, label]) => el("option", { value, text: label })));
    if (current && entries.some(([v]) => v === current)) sel.value = current;
  }

  function savePrefs() {
    const checks = [...document.querySelectorAll("#retriever-checks input:checked")].map((c) => c.value);
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      source: $("source").value, report_type: $("report-type").value, model: $("model").value, words: $("words").value,
      tone: $("tone").value, num_ctx: $("num-ctx").value, retrievers: checks,
    }));
  }

  function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; } }

  function renderForm(s) {
    const models = s.ollama.models;
    const sig = JSON.stringify([s.options, models.map((m) => m.name)]);
    if (sig !== state.optionsSig) {
      const prefs = state.optionsSig ? {
        source: $("source").value, report_type: $("report-type").value, model: $("model").value, tone: $("tone").value,
        retrievers: [...document.querySelectorAll("#retriever-checks input:checked")].map((c) => c.value),
      } : loadPrefs();
      state.optionsSig = sig;
      fillSelect($("source"), Object.entries(s.options.sources), prefs.source || "local");
      fillSelect($("report-type"), Object.entries(s.options.report_types), prefs.report_type);
      fillSelect($("tone"), s.options.tones.map((t) => [t, t[0].toUpperCase() + t.slice(1)]), prefs.tone);
      fillSelect($("model"), models.length ? models.map((m) => [m.name, `${m.name}  (${m.size_gb} GB)${m.recommended ? " ★" : ""}`]) : [["", "No model installed"]], prefs.model);
      const picked = new Set(prefs.retrievers || ["arxiv", "semantic_scholar", "openalex", "pubmed_central"]);
      $("retriever-checks").replaceChildren(...Object.entries(s.options.retrievers).map(([id, label]) =>
        el("label", {}, el("input", { type: "checkbox", value: id, checked: picked.has(id), onchange: savePrefs }), label)));
      if (!state.prefsLoaded) {
        const p = loadPrefs();
        if (p.words) $("words").value = p.words;
        if (p.num_ctx) $("num-ctx").value = p.num_ctx;
        state.prefsLoaded = true;
      }
    }
    const running = ["running", "cancelling"].includes(s.run.state);
    const ready = s.engine.current && s.ollama.running && models.length && !running && s.install.state !== "running" && s.update.state !== "running";
    for (const id of ["query", "source", "report-type", "model", "words", "tone", "num-ctx"]) $(id).disabled = !!running;
    $("btn-run").disabled = !ready || state.busyStart;
    $("btn-cancel").hidden = !running;
    $("btn-new").disabled = !!running;
    $("btn-cancel").disabled = s.run.state === "cancelling";
    $("ask-msg").textContent = running ? "" : (s.update.state === "running" ? "Engine update in progress" : !s.engine.current ? "Install the engine first" : !s.ollama.running ? "Start Ollama first" : !models.length ? "Download a model first" : "");
    renderPrivacy();
  }

  function renderDocs(s) {
    const list = $("doc-list");
    if (!s.docs.length) { list.replaceChildren(el("li", { class: "empty-li", text: "No documents yet" })); return; }
    list.replaceChildren(...s.docs.map((d) => el("li", {},
      el("input", { type: "checkbox", checked: !state.unchecked.has(d.name), title: "Use in research",
        onchange: (e) => { e.target.checked ? state.unchecked.delete(d.name) : state.unchecked.add(d.name); } }),
      el("span", { class: "name", title: d.name, text: d.name }),
      el("span", { class: "size", text: d.size_kb >= 1024 ? `${(d.size_kb / 1024).toFixed(1)} MB` : `${d.size_kb} KB` }),
      el("button", { class: "icon-btn", type: "button", title: "Remove from library", "aria-label": `Remove ${d.name}`, text: "×",
        onclick: async () => {
          if (!confirm(`Remove "${d.name}" from the library?`)) return;
          try { await api(`/docs/${encodeURIComponent(d.name)}`, { method: "DELETE" }); refresh(); } catch (e) { toast(e.message); }
        } }))));
  }

  function fmtDate(iso) {
    const d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  }

  function inlineEdit(host, initial, maxLength, onSave, restore) {
    const input = el("textarea", { class: "inline-edit", rows: "1", maxlength: maxLength, spellcheck: "false" });
    input.value = initial;
    const item = host.closest("li");
    if (item && item.draggable) item.draggable = false;
    host.replaceChildren(input);
    const fit = () => { input.style.height = "auto"; input.style.height = `${input.scrollHeight}px`; };
    fit(); input.focus(); input.select();
    input.addEventListener("input", fit);
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const value = input.value.replace(/\s+/g, " ").trim();
      if (save && value !== initial) onSave(value); else restore();
    };
    input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); finish(true); } else if (e.key === "Escape") finish(false); });
    input.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("dblclick", (e) => e.stopPropagation());
    input.addEventListener("blur", () => finish(true));
  }

  async function saveReport(id, patch) {
    try { await api(`/reports/${id}`, { method: "PATCH", json: patch }); } catch (e) { toast(e.message); }
    await loadReports();
  }

  function editReportTitle(r, host) {
    inlineEdit(host, r.title || r.query, 200, (title) => saveReport(r.id, { title }), renderReports);
  }

  function editFolderName(f, host) {
    inlineEdit(host, f.name, 60, async (name) => {
      try { await api(`/folders/${f.id}`, { method: "PATCH", json: { name } }); } catch (e) { toast(e.message); }
      await loadReports();
    }, renderReports);
  }

  async function addFolder() {
    try {
      const { folder } = await api("/folders", { method: "POST", json: { name: "New folder" } });
      state.open[folder.id] = true;
      await loadReports();
      const host = document.querySelector(`[data-folder="${folder.id}"] .fname`);
      if (host) editFolderName(folder, host);
    } catch (e) { toast(e.message); }
  }

  async function removeFolder(f, count) {
    const note = count ? ` Its ${count} report${count === 1 ? "" : "s"} will be kept and moved out of the folder.` : "";
    if (!confirm(`Delete the folder "${f.name}"?${note}`)) return;
    try { await api(`/folders/${f.id}`, { method: "DELETE" }); delete state.open[f.id]; localStorage.setItem(OPEN_KEY, JSON.stringify(state.open)); } catch (e) { toast(e.message); }
    await loadReports();
  }

  function makeDropTarget(node, folderId) {
    const wanted = (e) => [...(e.dataTransfer?.types || [])].includes(DRAG_TYPE);
    node.addEventListener("dragover", (e) => { if (!wanted(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; node.classList.add("drop"); });
    node.addEventListener("dragleave", (e) => { if (!node.contains(e.relatedTarget)) node.classList.remove("drop"); });
    node.addEventListener("drop", (e) => {
      node.classList.remove("drop");
      const id = e.dataTransfer.getData(DRAG_TYPE);
      if (!id) return;
      e.preventDefault();
      const moved = state.reports.find((r) => r.id === id);
      if (moved && (moved.folder || null) !== folderId) saveReport(id, { folder: folderId });
    });
  }

  function reportItem(r) {
    const note = r.state === "done" ? `${r.words || "?"} words · ${r.model}` : r.state;
    const titleEl = el("span", { class: "qt", text: r.title || r.query, title: r.title ? `Question: ${r.query}` : "" });
    titleEl.addEventListener("dblclick", (e) => { e.stopPropagation(); editReportTitle(r, titleEl); });
    const li = el("li", {
      class: r.id === state.selectedId ? "selected" : "", draggable: "true", onclick: () => openReport(r.id),
      ondragstart: (e) => { e.dataTransfer.setData(DRAG_TYPE, r.id); e.dataTransfer.effectAllowed = "move"; li.classList.add("dragging"); },
      ondragend: () => li.classList.remove("dragging"),
    },
      el("div", { class: "q" }, titleEl, el("small", { class: `st-${r.state}`, text: `${fmtDate(r.created_at)} · ${note}` })),
      el("button", { class: "icon-btn edit", type: "button", title: "Rename (or double-click the title)", "aria-label": "Rename report", text: "✎",
        onclick: (e) => { e.stopPropagation(); editReportTitle(r, titleEl); } }));
    return li;
  }

  function toggleFolder(id) {
    state.open[id] = state.open[id] === false;
    localStorage.setItem(OPEN_KEY, JSON.stringify(state.open));
    renderReports();
  }

  function folderGroup(f, items) {
    const open = state.open[f.id] !== false;
    const nameEl = el("span", { class: "fname", text: f.name, title: f.name });
    nameEl.addEventListener("dblclick", (e) => { e.stopPropagation(); editFolderName(f, nameEl); });
    const head = el("div", { class: "folder-head", onclick: () => toggleFolder(f.id) },
      el("span", { class: "caret", text: open ? "▾" : "▸" }), nameEl, el("small", { class: "count", text: String(items.length) }),
      el("button", { class: "icon-btn", type: "button", title: "Rename folder", "aria-label": `Rename folder ${f.name}`, text: "✎",
        onclick: (e) => { e.stopPropagation(); editFolderName(f, nameEl); } }),
      el("button", { class: "icon-btn del", type: "button", title: "Delete folder (its reports are kept)", "aria-label": `Delete folder ${f.name}`, text: "×",
        onclick: (e) => { e.stopPropagation(); removeFolder(f, items.length); } }));
    const body = open ? el("ul", { class: "folder-items" }, items.length ? items.map(reportItem) : el("li", { class: "empty-li", text: "Drag reports here" })) : null;
    const group = el("li", { class: "folder-group", "data-folder": f.id }, head, body);
    makeDropTarget(group, f.id);
    return group;
  }

  function renderReports() {
    const list = $("report-list");
    if (!state.reports.length && !state.folders.length) { list.replaceChildren(el("li", { class: "empty-li", text: "No reports yet" })); return; }
    const known = new Set(state.folders.map((f) => f.id));
    const inFolder = new Map(), loose = [];
    for (const r of state.reports) {
      if (r.folder && known.has(r.folder)) { if (!inFolder.has(r.folder)) inFolder.set(r.folder, []); inFolder.get(r.folder).push(r); } else loose.push(r);
    }
    const nodes = state.folders.map((f) => folderGroup(f, inFolder.get(f.id) || []));
    if (!state.folders.length) nodes.push(...loose.map(reportItem));
    else {
      const group = el("li", { class: "folder-group unfiled" },
        el("div", { class: "folder-head plain" }, el("span", { class: "fname", text: "Not in a folder" }), el("small", { class: "count", text: String(loose.length) })),
        el("ul", { class: "folder-items" }, loose.map(reportItem)));
      makeDropTarget(group, null);
      nodes.push(group);
    }
    list.replaceChildren(...nodes);
  }

  function renderProgress(s) {
    const running = ["running", "cancelling"].includes(s.run.state);
    const reading = running && !!state.selectedId;
    $("ask-form").hidden = !!state.selectedId;
    $("progress").hidden = !running || reading;
    $("run-banner").hidden = !reading;
    if (!running) return;
    const phase = { research: "Gathering sources and notes…", writing: "Writing the report…" }[s.run.phase] || "Starting…";
    $("progress-title").textContent = s.run.state === "cancelling" ? "Cancelling…" : phase;
    const secs = Math.max(0, Math.round((Date.now() - new Date(s.run.started_at).getTime()) / 1000));
    $("progress-time").textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")} elapsed`;
    $("run-banner-text").textContent = `A research is running in the background (${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")} elapsed).`;
    const log = $("run-log"), stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 20;
    log.textContent = s.run.log.join("\n");
    if (stick) log.scrollTop = log.scrollHeight;
  }

  async function openReport(id) {
    state.selectedId = id;
    localStorage.setItem(LAST_KEY, id);
    renderReports();
    if (state.status) renderProgress(state.status);
    try {
      const { meta, markdown } = await api(`/reports/${id}`);
      const viewer = $("viewer");
      viewer.hidden = false;
      paintViewerTitle(meta);
      const bits = [fmtDate(meta.created_at), meta.model, SOURCE_LABEL(meta.source)];
      if (meta.seconds) bits.push(`${Math.round(meta.seconds / 60 * 10) / 10} min`);
      $("viewer-meta").textContent = bits.filter(Boolean).join(" · ");
      if (markdown) renderMarkdown(markdown, $("viewer-body"));
      else $("viewer-body").replaceChildren(el("p", { class: "muted", text: meta.error ? `This run failed: ${meta.error}` : `No report (${meta.state}).` }));
      $("btn-download").href = `${API}/reports/${id}/download`;
      $("btn-download").hidden = !markdown;
      $("btn-copy").hidden = !markdown;
      $("btn-pdf").hidden = !markdown;
      $("btn-reuse").onclick = () => {
        $("query").value = meta.query || "";
        localStorage.setItem(DRAFT_KEY, $("query").value);
        if ([...$("source").options].some((o) => o.value === meta.source)) $("source").value = meta.source;
        if ([...$("report-type").options].some((o) => o.value === meta.report_type)) $("report-type").value = meta.report_type;
        if ([...$("model").options].some((o) => o.value === meta.model)) $("model").value = meta.model;
        const picked = new Set(meta.retrievers || []);
        if (picked.size) document.querySelectorAll("#retriever-checks input").forEach((c) => { c.checked = picked.has(c.value); });
        savePrefs(); renderPrivacy();
        state.selectedId = null;
        $("viewer").hidden = true;
        renderReports();
        if (state.status) renderProgress(state.status);
        focusForm();
      };
      $("btn-pdf").onclick = async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true; btn.textContent = "Preparing PDF…";
        try {
          const res = await fetch(`${API}/reports/${id}/download?format=pdf`);
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || res.statusText);
          const url = URL.createObjectURL(await res.blob());
          const a = el("a", { href: url, download: `research-${id}.pdf` });
          document.body.append(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 10000);
        } catch (err) { toast(`PDF export failed: ${err.message}`); }
        btn.disabled = false; btn.textContent = "Download PDF";
      };
      $("btn-copy").onclick = async () => { await navigator.clipboard.writeText(markdown); toast("Markdown copied"); };
      $("btn-rename").onclick = () => {
        const current = state.reports.find((r) => r.id === id) || meta;
        inlineEdit($("viewer-query"), current.title || current.query, 200, (title) => saveReport(id, { title }), () => paintViewerTitle());
      };
      $("btn-delete").onclick = async () => {
        if (!confirm("Delete this report?")) return;
        try { await api(`/reports/${id}`, { method: "DELETE" }); state.selectedId = null; localStorage.removeItem(LAST_KEY); viewer.hidden = true; await loadReports(); if (state.status) renderProgress(state.status); } catch (e) { toast(e.message); }
      };
    } catch (e) { toast(e.message); }
  }

  const SOURCE_LABEL = (s) => ({ local: "documents only", web: "web", hybrid: "documents + web" }[s] || "");

  function paintViewerTitle(meta) {
    const r = meta || state.reports.find((x) => x.id === state.selectedId);
    if (!r) return;
    $("viewer-query").textContent = r.title || r.query;
    $("viewer-question").hidden = !r.title;
    $("viewer-question").textContent = r.title ? `Question: ${r.query}` : "";
  }

  async function loadReports() {
    const [reports, folders] = await Promise.all([api("/reports").catch(() => []), api("/folders").catch(() => [])]);
    state.reports = reports; state.folders = folders;
    renderReports();
    if (!$("viewer").hidden) paintViewerTitle();
  }

  // ------------------------------------------------------------ actions

  async function uploadFiles(files) {
    for (const file of files) {
      const form = new FormData();
      form.append("file", file, file.name);
      try { await api("/docs", { method: "POST", form }); } catch (e) { toast(`${file.name}: ${e.message}`); }
    }
    refresh();
  }

  $("file-input").addEventListener("change", (e) => { uploadFiles([...e.target.files]); e.target.value = ""; });
  const dz = $("dropzone");
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
  dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("drag"); uploadFiles([...e.dataTransfer.files]); });

  $("source").addEventListener("change", () => { renderPrivacy(); savePrefs(); });
  for (const id of ["report-type", "model", "words", "tone", "num-ctx"]) $(id).addEventListener("change", savePrefs);
  $("report-type").addEventListener("change", renderPrivacy);

  $("ask-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    savePrefs();
    const s = state.status;
    state.busyStart = true; $("btn-run").disabled = true;
    try {
      const payload = {
        query: $("query").value, source: $("source").value, report_type: $("report-type").value, model: $("model").value,
        tone: $("tone").value, total_words: Number($("words").value), num_ctx: Number($("num-ctx").value),
        retrievers: [...document.querySelectorAll("#retriever-checks input:checked")].map((c) => c.value),
        docs: s.docs.map((d) => d.name).filter((n) => !state.unchecked.has(n)),
      };
      $("viewer").hidden = true; state.selectedId = null; renderReports();
      state.status = await api("/research", { method: "POST", json: payload });
      state.runState = "running";
      render();
    } catch (err) { toast(err.message); }
    state.busyStart = false;
    refresh();
  });

  function focusForm() {
    document.querySelector(".pr-work").scrollTo({ top: 0, behavior: "smooth" });
    $("query").focus();
  }

  $("btn-show-progress").addEventListener("click", () => {
    state.selectedId = null;
    $("viewer").hidden = true;
    renderReports();
    if (state.status) renderProgress(state.status);
  });

  $("btn-new").addEventListener("click", () => {
    state.selectedId = null;
    localStorage.removeItem(LAST_KEY);
    localStorage.removeItem(DRAFT_KEY);
    $("viewer").hidden = true;
    $("query").value = "";
    renderReports();
    if (state.status) renderProgress(state.status);
    focusForm();
  });

  $("btn-folder").addEventListener("click", addFolder);

  // Side panel width: drag the right edge (double-click resets); remembered between visits.
  const main = document.querySelector(".pr-main");
  const setSide = (px) => main.style.setProperty("--side-w", `${Math.max(200, Math.round(px))}px`);
  const saveSide = () => localStorage.setItem(SIDE_KEY, parseInt(main.style.getPropertyValue("--side-w"), 10) || "");
  if (Number(localStorage.getItem(SIDE_KEY))) setSide(Number(localStorage.getItem(SIDE_KEY)));
  const handle = $("side-resizer");
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add("resizing");
    const move = (ev) => setSide(ev.clientX - main.getBoundingClientRect().left);
    const stop = () => {
      handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", stop); handle.removeEventListener("pointercancel", stop);
      document.body.classList.remove("resizing"); saveSide();
    };
    handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", stop); handle.addEventListener("pointercancel", stop);
  });
  handle.addEventListener("dblclick", () => { main.style.removeProperty("--side-w"); localStorage.removeItem(SIDE_KEY); });
  handle.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setSide(document.querySelector(".pr-side").getBoundingClientRect().width + (e.key === "ArrowRight" ? 24 : -24)); saveSide();
  });

  const cancelRun = async () => {
    try { state.status = await api("/research/cancel", { method: "POST" }); render(); } catch (e) { toast(e.message); }
  };
  $("btn-cancel").addEventListener("click", cancelRun);
  $("btn-cancel-run").addEventListener("click", cancelRun);

  // ------------------------------------------------------------ polling

  function render() {
    const s = state.status;
    renderChips(s); renderSetup(s); renderForm(s); renderDocs(s); renderProgress(s);
  }

  async function refresh() {
    clearTimeout(state.timer);
    let busy = false;
    try {
      const s = await api("/status");
      const prev = state.runState;
      state.status = s;
      render();
      busy = ["running", "cancelling"].includes(s.run.state) || s.install.state === "running" || s.pull.state === "running" || s.update.state === "running";
      if (prev !== s.run.state) {
        state.runState = s.run.state;
        if (["done", "error", "cancelled"].includes(s.run.state) && ["running", "cancelling"].includes(prev)) {
          await loadReports();
          if (s.run.id && !state.selectedId) await openReport(s.run.id);
          else if (s.run.state === "done") toast("Research finished. Open it from the Reports list.");
          if (s.run.state === "error") toast(s.run.error || "Research failed");
        }
      }
    } catch (e) { /* server restarting; retry */ }
    state.timer = setTimeout(refresh, busy ? 2000 : 6000);
  }

  $("chip-engine").addEventListener("click", () => { state.showEngine = !state.showEngine; if (state.status) render(); });

  function syncTheme() { document.documentElement.setAttribute("data-theme", localStorage.getItem("ead-portal:theme") || "light"); }
  window.addEventListener("storage", (e) => { if (e.key === "ead-portal:theme") syncTheme(); });
  syncTheme();

  const FONT_KEY = "gpt-researcher:font-px";
  const FONT_DEFAULT = 14, FONT_MIN = 11, FONT_MAX = 28;
  let fontPx = Number(localStorage.getItem(FONT_KEY)) || FONT_DEFAULT;
  function setFont(px) {
    fontPx = Math.min(FONT_MAX, Math.max(FONT_MIN, px));
    $("viewer-body").style.setProperty("--md-size", `${fontPx}px`);
    $("btn-font-reset").textContent = `${Math.round((fontPx / FONT_DEFAULT) * 100)}%`;
    $("btn-font-down").disabled = fontPx <= FONT_MIN;
    $("btn-font-up").disabled = fontPx >= FONT_MAX;
    if (fontPx === FONT_DEFAULT) localStorage.removeItem(FONT_KEY); else localStorage.setItem(FONT_KEY, String(fontPx));
  }
  $("btn-font-down").addEventListener("click", () => setFont(fontPx - 1));
  $("btn-font-up").addEventListener("click", () => setFont(fontPx + 1));
  $("btn-font-reset").addEventListener("click", () => setFont(FONT_DEFAULT));
  setFont(fontPx);

  loadReports().then(() => {
    const last = localStorage.getItem(LAST_KEY);
    const pick = state.reports.find((r) => r.id === last && r.state === "done") || state.reports.find((r) => r.state === "done");
    if (pick && !state.selectedId) openReport(pick.id);
  });
  $("query").value = localStorage.getItem(DRAFT_KEY) || "";
  $("query").addEventListener("input", () => localStorage.setItem(DRAFT_KEY, $("query").value));
  refresh();
})();
