/* One EAD: show which documents (and pages) a DeepTutor chat answer was retrieved from.
 *
 * Upstream already records the retrieved passages as "sources" events on every answer but only
 * shows their titles inside the collapsed "Done" trace. This adds a visible "Sources" panel under
 * each answer: document, knowledge base, page and the exact passage, with a link that opens the
 * PDF at that page. The list is what the retriever returned, not what the model claims to cite.
 *
 * Page numbers are not stored with the passages, so they are looked up by finding the passage in
 * the document's extracted text, which carries "--- Page N ---" markers.
 */
(() => {
  'use strict';
  if (window.__oneEadChatSources) return;
  window.__oneEadChatSources = true;

  const MARKER_SRC = '---\\s*Page\\s+(\\d+)\\s*---';
  const MAX_EXCERPT = 300;
  const NEGATIVE_TTL = 20000;
  const MAX_DOCS_CACHED = 6;

  const sourceCache = new Map(); // session:assistantId -> {at, items}
  const docCache = new Map(); // kb/rel -> Promise<{norm, markers} | null>
  let aliases = new Map();
  let aliasAt = 0;
  let rendering = false;
  let again = false;
  let timer = 0;

  const css = `
.oe-src{margin:10px 0 4px;border:1px solid var(--border,#ddd);border-radius:10px;background:var(--card,transparent);font:12px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--foreground,#111)}
.oe-src>summary{display:flex;gap:8px;align-items:baseline;padding:7px 10px;cursor:pointer;list-style:none;user-select:none}
.oe-src>summary::-webkit-details-marker{display:none}
.oe-src>summary::before{content:"\\25B8";color:var(--muted-foreground,#888);font-size:11px}
.oe-src[open]>summary::before{content:"\\25BE"}
.oe-src-label{font-weight:600;flex:none}
.oe-src-count{color:var(--muted-foreground,#666);flex:none}
.oe-src-names{color:var(--muted-foreground,#666);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.oe-src-body{padding:2px 10px 10px;display:flex;flex-direction:column;gap:10px}
.oe-src-doc{border-top:1px solid var(--border,#e5e5e5);padding-top:8px}
.oe-src-doc:first-child{border-top:0;padding-top:0}
.oe-src-head{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:4px}
.oe-src-title{font-weight:600;color:var(--primary,#3b82f6);text-decoration:none;word-break:break-word}
a.oe-src-title:hover{text-decoration:underline}
.oe-src-kb{padding:0 6px;border-radius:999px;background:var(--muted,rgba(128,128,128,.15));color:var(--muted-foreground,#666);font-size:11px}
.oe-src-chunk{display:flex;gap:8px;align-items:flex-start;margin:3px 0}
.oe-src-page{flex:none;min-width:44px;text-align:center;padding:0 6px;border-radius:6px;border:1px solid var(--border,#ccc);color:var(--foreground,#111);text-decoration:none;font-variant-numeric:tabular-nums}
.oe-src-page:empty{display:none}
a.oe-src-page:hover{border-color:var(--primary,#3b82f6);color:var(--primary,#3b82f6)}
.oe-src-text{color:var(--muted-foreground,#555);word-break:break-word}
`;

  const mk = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const isOurs = (n) => !!(n && n.closest && n.closest('[data-one-ead]'));
  const enc = encodeURIComponent;

  async function getJson(url) {
    const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function sessionId() {
    const m = location.pathname.match(/^\/chat\/([^/]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  async function refreshAliases() {
    if (Date.now() - aliasAt < 30000) return;
    aliasAt = Date.now();
    try {
      const cfg = await getJson('/api/knowledge-bases/configs');
      const next = new Map();
      const entries = (cfg && cfg.knowledge_bases) || {};
      for (const name of Object.keys(entries)) {
        const alias = entries[name] && typeof entries[name].display_name === 'string' ? entries[name].display_name.trim() : '';
        if (alias) next.set(name, alias);
      }
      aliases = next;
    } catch (err) {
      // Keep the last known aliases.
    }
  }

  async function loadSources(sid, assistantId) {
    if (!assistantId || String(assistantId).startsWith('-') || String(assistantId) === 'undefined') {
      return [];
    }
    const key = `${sid}:${assistantId}`;
    const hit = sourceCache.get(key);
    if (hit && (hit.items.length || Date.now() - hit.at < NEGATIVE_TTL)) return hit.items;
    try {
      const stored = sessionStorage.getItem(`oe_src:${key}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        sourceCache.set(key, { at: Date.now(), items: parsed });
        return parsed;
      }
    } catch (_) {}
    const items = [];
    const seen = new Set();
    let after = 0;
    try {
      for (let i = 0; i < 4; i += 1) {
        const trace = await getJson(`/api/sessions/${enc(sid)}/messages/${assistantId}/events?after_seq=${after}&limit=1000`);
        for (const ev of trace.events || []) {
          const list = ev && ev.type === 'sources' && ev.metadata ? ev.metadata.sources : null;
          if (!Array.isArray(list)) continue;
          for (const s of list) {
            if (!s || typeof s !== 'object') continue;
            const id = s.chunk_id || `${s.title || s.url || ''}|${String(s.content || '').slice(0, 60)}`;
            if (seen.has(id)) continue;
            seen.add(id);
            items.push(s);
          }
        }
        if (items.length || trace.complete || trace.next_seq == null) break;
        after = trace.next_seq;
      }
      sourceCache.set(key, { at: Date.now(), items });
      try {
        sessionStorage.setItem(`oe_src:${key}`, JSON.stringify(items));
      } catch (_) {}
      return items;
    } catch (err) {
      sourceCache.set(key, { at: Date.now(), items: [] });
      return [];
    }
  }

  const stripMarkers = (s) => String(s || '').replace(new RegExp(MARKER_SRC, 'g'), ' ').replace(/\s+/g, ' ').trim();

  function relPath(source) {
    const parts = String(source || '').split(/[\\/]raw[\\/]/);
    return parts.length > 1 ? parts[parts.length - 1].replace(/\\/g, '/') : '';
  }

  const fileUrl = (kb, rel) => `/api/knowledge-bases/${enc(kb)}/files/${rel.split('/').map(enc).join('/')}`;

  function group(items) {
    const groups = new Map();
    for (const s of items) {
      const kb = s.kb_name || '';
      const rel = relPath(s.source);
      const title = s.title || (rel && rel.split('/').pop()) || s.url || s.query || s.type || 'source';
      const id = `${kb}\u0000${rel || title}`;
      if (!groups.has(id)) groups.set(id, { kb, rel, title, url: /^https?:\/\//i.test(s.url || '') ? s.url : '', chunks: [] });
      groups.get(id).chunks.push({ text: String(s.content || ''), page: s.page ? String(s.page) : '', score: s.score });
    }
    return [...groups.values()];
  }

  function loadDoc(kb, rel) {
    const key = `${kb}/${rel}`;
    if (docCache.has(key)) return docCache.get(key);
    const p = fetch(`/api/knowledge-bases/${enc(kb)}/file-preview-text/${rel.split('/').map(enc).join('/')}`, { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.text() : null))
      .then((text) => {
        if (!text) return null;
        const norm = text.replace(/\s+/g, ' ');
        const markers = [];
        const re = new RegExp(MARKER_SRC, 'g');
        for (let m = re.exec(norm); m; m = re.exec(norm)) markers.push({ at: m.index, page: m[1] });
        return markers.length ? { norm, markers } : null;
      })
      .catch(() => null);
    docCache.set(key, p);
    if (docCache.size > MAX_DOCS_CACHED) docCache.delete(docCache.keys().next().value);
    return p;
  }

  function pageFor(doc, text) {
    const probe = stripMarkers(text).slice(0, 70);
    if (probe.length < 20) return '';
    const at = doc.norm.indexOf(probe);
    if (at < 0) return '';
    let page = '';
    for (const m of doc.markers) {
      if (m.at > at) break;
      page = m.page;
    }
    return page;
  }

  function pageFromSnippet(text) {
    const m = new RegExp(MARKER_SRC).exec(text);
    return m && m.index <= 5 ? m[1] : '';
  }

  // DeepTutor's click handler only sends links whose href attribute starts with http(s):// to its side pane.
  const absolute = (href) => new URL(href, location.origin).href;

  // The pane is sandboxed so Chrome's PDF viewer won't load there; page_view.html shows rendered pages instead.
  function viewUrl(g, page) {
    if (!/\.pdf$/i.test(g.rel)) return fileUrl(g.kb, g.rel);
    return `/_one-ead/page-view?kb=${enc(g.kb)}&src=${enc(g.rel)}&page=${page || 1}`;
  }

  function point(a, href, hint) {
    a.setAttribute('href', absolute(href));
    a.target = '_blank';
    a.rel = 'noopener';
    a.title = hint;
  }

  function setPage(chip, link, pageEl, g, page) {
    pageEl.textContent = `p. ${page}`;
    if (pageEl.hasAttribute('href') || !g.rel) return;
    point(pageEl, viewUrl(g, page), 'Open this page of the document');
    if (link && !link.dataset.paged) {
      link.setAttribute('href', absolute(viewUrl(g, page)));
      link.dataset.paged = '1';
    }
  }

  async function resolvePages(g, chips, link) {
    for (const c of chips) {
      const known = c.data.page || pageFromSnippet(c.data.text);
      if (known) setPage(c, link, c.pageEl, g, known);
    }
    if (!g.rel) return;
    const need = chips.filter((c) => !c.data.page);
    if (!need.length) return;
    const doc = await loadDoc(g.kb, g.rel);
    if (!doc) return;
    for (const c of need) {
      const page = pageFor(doc, c.data.text);
      if (page) setPage(c, link, c.pageEl, g, page);
    }
  }

  function excerpt(text) {
    const t = stripMarkers(text);
    return t.length > MAX_EXCERPT ? `${t.slice(0, MAX_EXCERPT).trimEnd()}\u2026` : t;
  }

  function buildPanel(key, sid, items) {
    const groups = group(items);
    const root = mk('details', 'oe-src');
    root.dataset.oneEad = '1';
    root.dataset.oeSrcFor = key;
    root.dataset.sid = sid;
    root.dataset.count = String(items.length);

    const sum = mk('summary');
    sum.append(
      mk('span', 'oe-src-label', 'Sources'),
      mk('span', 'oe-src-count', `${items.length} passage${items.length === 1 ? '' : 's'} \u00b7 ${groups.length} document${groups.length === 1 ? '' : 's'}`),
      mk('span', 'oe-src-names', groups.map((g) => g.title).join(' \u00b7 '))
    );
    const body = mk('div', 'oe-src-body');

    const jobs = [];
    for (const g of groups) {
      const doc = mk('div', 'oe-src-doc');
      const head = mk('div', 'oe-src-head');
      const href = g.rel ? viewUrl(g, 1) : g.url;
      const title = mk(href ? 'a' : 'span', 'oe-src-title', g.title);
      if (href) point(title, href, 'Open the document');
      head.append(title);
      if (g.kb) head.append(mk('span', 'oe-src-kb', aliases.get(g.kb) || g.kb));
      doc.append(head);
      const chips = g.chunks.map((data) => {
        const row = mk('div', 'oe-src-chunk');
        const pageEl = mk('a', 'oe-src-page');
        row.append(pageEl, mk('span', 'oe-src-text', excerpt(data.text)));
        doc.append(row);
        return { data, pageEl };
      });
      body.append(doc);
      jobs.push(() => resolvePages(g, chips, g.rel ? title : null));
    }
    root.append(sum, body);
    jobs.reduce((p, job) => p.then(job).catch(() => {}), Promise.resolve());
    return root;
  }

  const STRAY_DOLLAR_RE = /(?<!\$)\$\s*(?:\\text\{)?([A-Za-z0-9_.-]+)\}?\s*\$(?!\$)/g;
  function cleanMathNodes(root) {
    if (!root || !root.textContent || !root.textContent.includes('$')) return;
    if (root.dataset && root.dataset.oeMathCleaned) return;
    try {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => {
          if (!n || !n.nodeValue || !n.nodeValue.includes('$')) return NodeFilter.FILTER_REJECT;
          const p = n.parentElement;
          if (p && (p.tagName === 'CODE' || p.tagName === 'PRE' || p.closest('.katex') || isOurs(p))) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      const nodes = [];
      let node;
      while ((node = walker.nextNode())) nodes.push(node);
      for (const n of nodes) {
        if (n.nodeValue.includes('$')) {
          n.nodeValue = n.nodeValue.replace(/(?<!\$)\$\s*(?:\\text\{)?([A-Za-z0-9_.-]+)\}?\s*\$(?!\$)/g, '$1');
        }
      }
      if (root.dataset) root.dataset.oeMathCleaned = '1';
    } catch (e) {
      // Ignore DOM traversal errors
    }
  }

  async function render() {
    if (rendering) {
      again = true;
      return;
    }
    // Defer rendering while conversation is currently transitioning or loading
    if (document.querySelector('svg.animate-spin') && document.body.textContent.includes('Loading conversation')) {
      schedule();
      return;
    }
    rendering = true;
    try {
      const sid = sessionId();
      if (!sid) return;
      const allAssistant = [...document.querySelectorAll('[data-chat-message-role="assistant"], [data-chat-message-id], .prose')].filter((e) => !isOurs(e));
      allAssistant.forEach(cleanMathNodes);
      // Messages without an id are still streaming.
      const answers = allAssistant.filter((e) => e.hasAttribute('data-chat-message-id'));
      document.querySelectorAll('.oe-src[data-oe-src-for]').forEach((p) => {
        const alive = answers.some((a) => a.dataset.chatMessageId === p.dataset.oeSrcFor);
        if (!sid || p.dataset.sid !== sid || !alive) p.remove();
      });
      if (!answers.length) return;
      await refreshAliases();
      for (const answer of answers) {
        const key = answer.dataset.chatMessageId;
        const existing = document.querySelector(`.oe-src[data-oe-src-for="${key}"]`);
        if (existing && existing.previousElementSibling === answer) {
          continue; // Already attached in place, skip redundant fetch
        }
        let items = [];
        try {
          items = await loadSources(sid, key);
        } catch (err) {
          continue;
        }
        if (existing && existing.dataset.count === String(items.length)) {
          if (existing.previousElementSibling !== answer) answer.after(existing);
          continue;
        }
        if (existing) existing.remove();
        if (items.length && answer.isConnected) answer.after(buildPanel(key, sid, items));
      }
    } finally {
      rendering = false;
      if (again) {
        again = false;
        schedule();
      }
    }
  }

  function schedule() {
    clearTimeout(timer);
    const run = () => {
      if (window.requestIdleCallback) {
        requestIdleCallback(render, { timeout: 800 });
      } else {
        render();
      }
    };
    timer = setTimeout(run, 350);
  }

  // The side panel should only open from a source link: close it when the user moves to another chat.
  let lastSid = sessionId();
  function onRouteChange() {
    const sid = sessionId();
    if (sid === lastSid) return;
    const hadChat = !!lastSid;
    lastSid = sid;
    if (!hadChat) return;
    try {
      localStorage.setItem('dt:chat:viewer-panel', '0');
    } catch (err) {
      // Storage unavailable.
    }
    // DeepTutor's panel closes itself on Escape while it is open.
    if (document.querySelector('.dt-viewer-panel[data-open="true"]')) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }
  }
  for (const name of ['pushState', 'replaceState']) {
    const original = history[name];
    history[name] = function patched(...args) {
      const result = original.apply(this, args);
      setTimeout(onRouteChange, 0);
      return result;
    };
  }
  window.addEventListener('popstate', () => setTimeout(onRouteChange, 0));

  function start() {
    document.head.append(mk('style', null, css));
    render();
    new MutationObserver((records) => {
      const relevant = records.some((r) => {
        if (isOurs(r.target)) return false;
        const t = r.target;
        if (t && t.closest && (t.closest('aside') || t.closest('nav') || t.closest('.dt-viewer-panel') || t.closest('header') || t.closest('form') || t.closest('[data-chat-composer="true"]'))) return false;
        const nodes = [...r.addedNodes, ...r.removedNodes];
        return nodes.length === 0 || nodes.some((n) => !(n.nodeType === Node.ELEMENT_NODE && n.hasAttribute('data-one-ead')));
      });
      if (relevant) schedule();
    }).observe(document.body, { childList: true, subtree: true });
  }

  const boot = () => setTimeout(start, 700);
  if (document.readyState === 'complete') boot();
  else window.addEventListener('load', boot, { once: true });
})();
