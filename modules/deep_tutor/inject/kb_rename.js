/* One EAD: rename knowledge bases in DeepTutor's Knowledge Center.
 *
 * A knowledge base's folder name is its identity (sessions, indexes, settings and
 * bindings all reference it), so it is never changed. Instead a display name is stored
 * in kb_config.json (via the existing PUT /api/knowledge-bases/{kb}/config) and shown
 * wherever the original name appears as a whole text node.
 */
(() => {
  'use strict';
  if (window.__oneEadKbRename) return;
  window.__oneEadKbRename = true;

  const API = '/api/knowledge-bases';
  const MAX_LEN = 80;
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'PRE']);

  let names = new Set();
  let aliases = new Map();
  const tracked = new WeakMap(); // text node -> {real, lead, trail, shown}
  let lastRefresh = 0;
  let pending = new Set();
  let flushTimer = 0;
  let dialog = null;

  const css = `
.oe-kb-edit{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;margin-left:6px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--muted-foreground,#888);cursor:pointer;font-size:13px;line-height:1;vertical-align:middle;flex:none;opacity:.8}
.oe-kb-edit:hover{background:var(--muted,rgba(128,128,128,.18));color:var(--foreground,#111);opacity:1}
.oe-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.4)}
.oe-box{width:min(440px,92vw);padding:18px;border-radius:12px;border:1px solid var(--border,#ddd);background:var(--background,#fff);color:var(--foreground,#111);box-shadow:0 12px 40px rgba(0,0,0,.25);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
.oe-box h3{margin:0 0 6px;font-size:16px;font-weight:600}
.oe-box p{margin:0 0 12px;font-size:12px;color:var(--muted-foreground,#666)}
.oe-box input{width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid var(--border,#ccc);background:transparent;color:inherit;font:inherit;outline:none}
.oe-box input:focus{border-color:var(--primary,#3b82f6)}
.oe-err{min-height:18px;margin-top:6px;font-size:12px;color:#dc2626}
.oe-row{display:flex;gap:8px;justify-content:flex-end;margin-top:8px}
.oe-row button{padding:6px 14px;border-radius:8px;border:1px solid var(--border,#ccc);background:transparent;color:inherit;font:inherit;cursor:pointer}
.oe-row button.oe-primary{background:var(--primary,#3b82f6);border-color:transparent;color:var(--primary-foreground,#fff)}
.oe-row button:disabled{opacity:.5;cursor:default}
.oe-row .oe-spacer{flex:1}
`;

  async function getJson(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function refresh() {
    lastRefresh = Date.now();
    try {
      const [list, cfg] = await Promise.all([getJson(`${API}/list`), getJson(`${API}/configs`)]);
      names = new Set((Array.isArray(list) ? list : []).map((kb) => kb && kb.name).filter(Boolean));
      const next = new Map();
      const entries = (cfg && cfg.knowledge_bases) || {};
      for (const name of Object.keys(entries)) {
        const alias = entries[name] && typeof entries[name].display_name === 'string' ? entries[name].display_name.trim() : '';
        if (alias && names.has(name)) next.set(name, alias);
      }
      aliases = next;
    } catch (err) {
      // Backend not ready or request failed: keep the last known state.
    }
  }

  function isOurs(el) {
    return !!(el && el.closest && el.closest('[data-one-ead]'));
  }

  function onKbPage(host) {
    const path = location.pathname.replace(/\/+$/, '');
    if (path === '/knowledge-bases') return !host.closest('[role="dialog"],[role="menu"],[role="listbox"],option,select');
    return path.startsWith('/knowledge-bases/') && /^H[1-3]$/.test(host.tagName);
  }

  function decorate(node, real) {
    const host = node.parentElement;
    if (!host || !onKbPage(host)) return;
    const next = host.nextElementSibling;
    if (next && next.classList.contains('oe-kb-edit') && next.dataset.kb === real) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'oe-kb-edit';
    btn.dataset.oneEad = '1';
    btn.dataset.kb = real;
    btn.title = 'Rename';
    btn.setAttribute('aria-label', `Rename ${real}`);
    btn.textContent = '\u270E';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openDialog(real);
    });
    host.after(btn);
  }

  function visit(node) {
    const rec = tracked.get(node);
    const cur = node.nodeValue;
    if (rec && rec.shown === cur) {
      const want = rec.lead + (aliases.get(rec.real) || rec.real) + rec.trail;
      if (want !== cur) {
        node.nodeValue = want;
        rec.shown = want;
      }
      decorate(node, rec.real);
      return;
    }
    const real = cur.trim();
    if (!names.has(real)) return;
    const lead = cur.slice(0, cur.indexOf(real));
    const trail = cur.slice(lead.length + real.length);
    const shown = lead + (aliases.get(real) || real) + trail;
    if (shown !== cur) node.nodeValue = shown;
    tracked.set(node, { real, lead, trail, shown });
    decorate(node, real);
  }

  function scan(root) {
    if (!names.size || !root.isConnected) return;
    if (root.nodeType === Node.TEXT_NODE) {
      if (root.parentElement && !SKIP_TAGS.has(root.parentElement.tagName) && !isOurs(root.parentElement)) visit(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE || isOurs(root)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement;
        if (!p || SKIP_TAGS.has(p.tagName) || p.isContentEditable || isOurs(p)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const found = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) found.push(n);
    found.forEach(visit);
  }

  function dropStaleButtons() {
    document.querySelectorAll('.oe-kb-edit').forEach((btn) => {
      const prev = btn.previousElementSibling;
      const real = btn.dataset.kb;
      const text = prev ? prev.textContent : '';
      if (!prev || !(text.includes(aliases.get(real) || real))) btn.remove();
    });
  }

  async function flush() {
    flushTimer = 0;
    const roots = pending;
    pending = new Set();
    if (location.pathname.startsWith('/knowledge-bases') && Date.now() - lastRefresh > 4000) await refresh();
    dropStaleButtons();
    roots.forEach(scan);
  }

  function schedule(node) {
    pending.add(node);
    if (!flushTimer) flushTimer = setTimeout(flush, 120);
  }

  function closeDialog() {
    if (dialog) dialog.remove();
    dialog = null;
  }

  function mk(tag, props, text) {
    const el = document.createElement(tag);
    if (props) Object.assign(el, props);
    if (text) el.textContent = text;
    return el;
  }

  function openDialog(real) {
    closeDialog();
    const current = aliases.get(real) || real;
    const overlay = mk('div', { className: 'oe-overlay' });
    overlay.dataset.oneEad = '1';
    const box = mk('div', { className: 'oe-box' });
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    const input = mk('input', { type: 'text', value: current, maxLength: MAX_LEN });
    const err = mk('div', { className: 'oe-err' });
    const reset = mk('button', { type: 'button' }, 'Reset');
    reset.disabled = !aliases.has(real);
    const cancel = mk('button', { type: 'button' }, 'Cancel');
    const save = mk('button', { type: 'button', className: 'oe-primary' }, 'Save');
    const row = mk('div', { className: 'oe-row' });
    row.append(reset, mk('span', { className: 'oe-spacer' }), cancel, save);
    box.append(
      mk('h3', null, 'Rename knowledge base'),
      mk('p', null, `Only the display name changes. The internal ID "${real}" stays the same, so chats, indexes and settings keep working.`),
      input,
      err,
      row
    );
    overlay.append(box);
    document.body.append(overlay);
    dialog = overlay;
    input.focus();
    input.select();

    const apply = async (value) => {
      err.textContent = '';
      const alias = value.trim();
      if (alias.length > MAX_LEN) {
        err.textContent = `Use at most ${MAX_LEN} characters.`;
        return;
      }
      if (alias && alias !== real) {
        const taken = [...names].filter((n) => n !== real).concat([...aliases].filter(([k]) => k !== real).map(([, v]) => v));
        if (taken.some((n) => n.toLowerCase() === alias.toLowerCase()) || names.has(alias)) {
          err.textContent = 'Another knowledge base already uses this name.';
          return;
        }
      }
      [reset, cancel, save].forEach((b) => (b.disabled = true));
      try {
        const res = await fetch(`${API}/${encodeURIComponent(real)}/config`, {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ display_name: alias && alias !== real ? alias : '' }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (alias && alias !== real) aliases.set(real, alias);
        else aliases.delete(real);
        closeDialog();
        scan(document.body);
        dropStaleButtons();
      } catch (e) {
        err.textContent = `Could not save: ${e.message}`;
        [reset, cancel, save].forEach((b) => (b.disabled = false));
        reset.disabled = !aliases.has(real);
      }
    };

    save.addEventListener('click', () => apply(input.value));
    reset.addEventListener('click', () => apply(''));
    cancel.addEventListener('click', closeDialog);
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) closeDialog();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') apply(input.value);
      else if (e.key === 'Escape') closeDialog();
      e.stopPropagation();
    });
  }

  async function start() {
    document.head.append(mk('style', { textContent: css }));
    await refresh();
    scan(document.body);
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'characterData') schedule(r.target);
        else r.addedNodes.forEach((n) => (n.nodeType === Node.ELEMENT_NODE || n.nodeType === Node.TEXT_NODE) && schedule(n));
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  const boot = () => setTimeout(start, 500);
  if (document.readyState === 'complete') boot();
  else window.addEventListener('load', boot, { once: true });
})();
