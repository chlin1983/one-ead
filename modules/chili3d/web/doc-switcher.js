/* One EAD: project switcher dropdown for Chili3D's ribbon (next to the "+" new-document icon).
   Lists open projects and saved projects so you can switch without going to the start page.
   Class names are hashed per build, so elements are found by structure/icon, never by class. */
(() => {
  "use strict";

  const DB = "chili3d-db";
  const PAGE = 20; // the start page lists only the first 20 saved projects; mirror it

  const hrefOf = (u) => u.getAttribute("href") || u.getAttribute("xlink:href");
  const findIcon = (name, filter) =>
    [...document.querySelectorAll("use")].filter((u) => hrefOf(u) === name).map((u) => u.closest("svg")).find(filter || (() => true));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(fn, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(40);
    }
    return null;
  }

  async function readRecents() {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open(DB);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    try {
      if (!db.objectStoreNames.contains("recents")) return [];
      const all = await new Promise((res, rej) => {
        const r = db.transaction("recents", "readonly").objectStore("recents").getAll();
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      return all.slice(0, PAGE).map((v) => ({ id: v.id, name: v.name, date: v.date }));
    } finally { db.close(); }
  }

  // Saved projects are opened through the start page's own card click, kept invisible meanwhile.
  async function openSaved(rec, index) {
    const hide = document.createElement("style");
    hide.textContent = "chili-home{visibility:hidden!important}";
    document.head.appendChild(hide);
    try {
      const home = findIcon("#icon-home", (s) => !s.closest("chili-home"));
      if (!home) return;
      home.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      const page = await waitFor(() => document.querySelector("chili-home"), 4000);
      if (!page) return;
      const cards = [...page.querySelectorAll("img")].map((i) => i.parentElement);
      const titleOf = (c) => (c.querySelector("span") || {}).textContent;
      const card = titleOf(cards[index] || {}) === rec.name ? cards[index] : cards.find((c) => titleOf(c) === rec.name);
      if (card) card.click();
      await waitFor(() => !document.querySelector("chili-home"), 20000);
    } finally { hide.remove(); }
  }

  let pop = null;
  const closePop = () => { if (pop) { pop.remove(); pop = null; } };

  function item(label, meta, active, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;padding:7px 10px;" +
      "border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;";
    const name = document.createElement("span");
    name.textContent = (active ? "\u2713 " : "") + label;
    name.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" + (active ? "font-weight:600;" : "");
    const m = document.createElement("span");
    m.textContent = meta || "";
    m.style.cssText = "flex-shrink:0;font-size:11px;color:var(--foreground-muted-color,#888);";
    b.append(name, m);
    b.addEventListener("pointerenter", () => { b.style.background = "var(--panel-hover-background-color,#eee)"; });
    b.addEventListener("pointerleave", () => { b.style.background = "transparent"; });
    b.addEventListener("click", () => { closePop(); onClick(); });
    return b;
  }

  function heading(text) {
    const h = document.createElement("div");
    h.textContent = text;
    h.style.cssText =
      "padding:6px 10px 3px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;" +
      "color:var(--foreground-muted-color,#888);";
    return h;
  }

  async function openMenu(btn) {
    closePop();
    const tabsBox = btn.previousElementSibling;
    const tabs = tabsBox ? [...tabsBox.children] : [];
    const openNames = tabs.map((t) => (t.querySelector("span") || {}).textContent);
    let recents = [];
    try { recents = await readRecents(); } catch (_) {}

    pop = document.createElement("div");
    pop.style.cssText =
      "position:fixed;z-index:10050;min-width:240px;max-width:360px;max-height:60vh;overflow:auto;padding:6px;" +
      "border-radius:10px;font-size:13px;background:var(--panel-background-color,#fff);color:var(--foreground-color,#222);" +
      "border:1px solid var(--border-color,#ddd);box-shadow:0 12px 32px -12px rgba(0,0,0,.45);";

    if (tabs.length) {
      pop.appendChild(heading("Open"));
      tabs.forEach((t, i) => pop.appendChild(item(openNames[i] || "Untitled", "", t.classList.length > 1, () => t.click())));
    }

    // Saved projects not already open (an open tab "uses up" one saved entry with the same name).
    const remaining = [...openNames];
    const saved = [];
    recents.forEach((r, index) => {
      const at = remaining.indexOf(r.name);
      if (at >= 0) remaining.splice(at, 1);
      else saved.push({ r, index });
    });
    pop.appendChild(heading("Saved projects"));
    if (!saved.length) {
      const e = document.createElement("div");
      e.textContent = "No other saved projects";
      e.style.cssText = "padding:7px 10px;color:var(--foreground-muted-color,#888);";
      pop.appendChild(e);
    }
    for (const { r, index } of saved) {
      pop.appendChild(item(r.name, r.date ? new Date(r.date).toLocaleDateString() : "", false, () => openSaved(r, index)));
    }

    document.body.appendChild(pop);
    const rect = btn.getBoundingClientRect();
    pop.style.top = `${rect.bottom + 6}px`;
    pop.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - pop.offsetWidth - 8))}px`;
  }

  function attach(plus) {
    if (plus.dataset.oeSwitcher) return;
    plus.dataset.oeSwitcher = "1";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = "Switch project";
    btn.setAttribute("aria-label", "Switch project");
    btn.style.cssText =
      "display:grid;place-items:center;width:22px;height:22px;margin:0 2px;padding:0;border:0;border-radius:6px;" +
      "background:transparent;color:var(--foreground-color,#222);cursor:pointer;flex-shrink:0;";
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" ' +
      'stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
    btn.addEventListener("pointerenter", () => { btn.style.background = "var(--panel-hover-background-color,#eee)"; });
    btn.addEventListener("pointerleave", () => { btn.style.background = "transparent"; });
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (pop) closePop();
      else openMenu(btn);
    });
    // Order: [+] [tabs] [switcher]; a fixed "+" on the left no longer drifts as tabs widen.
    const tabsBox = plus.previousElementSibling;
    tabsBox.before(plus);
    tabsBox.after(btn);

    // Only the active project's tab stays visible; the rest are reached via the switcher.
    const syncTabs = () => {
      const tabs = [...tabsBox.children];
      const active = tabs.find((t) => t.classList.length > 1) || tabs[0];
      for (const t of tabs) {
        t.style.display = t === active ? "" : "none";
        for (const u of t.querySelectorAll("use")) {
          if (hrefOf(u) === "#icon-times") u.closest("svg").style.display = "none"; // close (x) icon
        }
      }
    };
    new MutationObserver(syncTabs).observe(tabsBox, {
      childList: true, subtree: true, attributes: true, attributeFilter: ["class"],
    });
    syncTabs();
  }

  document.addEventListener("pointerdown", (e) => {
    if (pop && !pop.contains(e.target) && !e.target.closest('[aria-label="Switch project"]')) closePop();
  }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePop(); });

  const scan = () => {
    // The ribbon's "+" is a bare svg whose parent holds only the tab list and that icon;
    // other "+" icons (start page, item tree) have different surroundings.
    const plus = findIcon("#icon-plus", (s) => {
      const p = s.parentElement;
      return !s.closest("button, chili-home") && p && p.children.length === 2 && s.previousElementSibling
        && s.previousElementSibling.tagName.toLowerCase() !== "svg";
    });
    if (plus) attach(plus);
  };
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  scan();
})();
