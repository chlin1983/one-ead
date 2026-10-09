/* One EAD: tweaks for Chili3D's home page (left panel). Class names are hashed per build,
   so everything here locates elements by structure/content, never by class. */
(() => {
  "use strict";

  const KEY = "oneead:chili3d:home-left-width-v2";
  const MIN = 160, MAX = 640, DEFAULT = 200, NARROW = 900; // below NARROW Chili3D stacks the panels vertically

  const clamp = (w) => Math.max(MIN, Math.min(MAX, w));
  const saved = () => {
    const w = Number(localStorage.getItem(KEY));
    return w ? clamp(w) : null;
  };

  /* ---- rename support: stored project data lives in IndexedDB "chili3d-db" ---- */
  const asPromise = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const txDone = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = tx.onabort = () => rej(tx.error); });
  const openDb = () => asPromise(indexedDB.open("chili3d-db"));

  // Same order/limit the start page uses, so cards map 1:1 onto these records.
  async function readRecents() {
    const db = await openDb();
    try {
      if (!db.objectStoreNames.contains("recents")) return [];
      const os = db.transaction("recents", "readonly").objectStore("recents");
      return (await asPromise(os.getAll())).slice(0, 20);
    } finally { db.close(); }
  }

  // The project name is stored in three places: recents, document.name, and the root tree node.
  async function renameStored(id, oldName, newName) {
    const db = await openDb();
    try {
      const tx = db.transaction(["documents", "recents"], "readwrite");
      const docs = tx.objectStore("documents"), recents = tx.objectStore("recents");
      const d = await asPromise(docs.get(id));
      if (d) {
        d.name = newName;
        const root = d.models && Array.isArray(d.models.nodes) ? d.models.nodes[0] : null;
        if (root && root.name === oldName) root.name = newName;
        docs.put(d, id);
      }
      const r = await asPromise(recents.get(id));
      if (r) { r.name = newName; r.date = Date.now(); recents.put(r, id); }
      await txDone(tx);
    } finally { db.close(); }
  }

  function startRename(home, card) {
    const titleEl = card.querySelector("span");
    if (!titleEl || card.querySelector("input")) return;
    const oldName = titleEl.textContent;
    const input = document.createElement("input");
    input.value = oldName;
    input.style.cssText =
      "flex:1;min-width:0;font:inherit;padding:1px 4px;border:1px solid var(--primary-color,#4f8cff);" +
      "border-radius:4px;outline:none;background:var(--input-background-color,#fff);color:var(--input-text-color,inherit);";
    for (const t of ["click", "dblclick", "pointerdown"]) input.addEventListener(t, (e) => e.stopPropagation());
    titleEl.style.display = "none";
    titleEl.after(input);
    input.focus();
    input.select();

    let done = false;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      const newName = input.value.trim();
      input.remove();
      titleEl.style.display = "";
      if (!commit || !newName || newName === oldName) return;
      try {
        const recents = await readRecents();
        if (recents.some((r) => r.name === newName)) { alert(`A project named "${newName}" already exists.`); return; }
        const cards = [...home.querySelectorAll("img")].map((i) => i.parentElement);
        const byIndex = recents[cards.indexOf(card)];
        const rec = byIndex && byIndex.name === oldName ? byIndex : recents.find((r) => r.name === oldName);
        if (!rec) return;
        // An open document keeps its own copy: rename it too so its next save does not undo this.
        const app = home.app;
        const live = app && app.documents && [...app.documents].find((x) => x.id === rec.id);
        if (live) live.name = newName;
        await renameStored(rec.id, oldName, newName);
        titleEl.textContent = newName;
      } catch (err) {
        console.warn("[oneead] rename failed", err);
      }
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") finish(true);
      else if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
  }

  function tweak(home) {
    if (home.dataset.oeTweaked) return;
    const left = home.firstElementChild;
    if (!left) return;
    home.dataset.oeTweaked = "1";

    const social = left.querySelector('a[href*="github.com/xiangechen/chili3d"]');
    if (social && social.parentElement && social.parentElement !== left) social.parentElement.remove();

    for (const u of left.querySelectorAll("use")) {
      if ((u.getAttribute("href") || u.getAttribute("xlink:href")) === "#icon-back") u.closest("button")?.remove();
    }

    // Double-click a project's name to rename it. A single click on the name still opens the
    // project, after a short wait to tell the two apart (the open is replayed as a synthetic click).
    let nameClick = null, replaying = false;
    home.addEventListener("click", (e) => {
      if (replaying || e.target.tagName === "INPUT" || e.target.closest("svg")) return;
      let card = e.target;
      while (card && card !== home && !card.querySelector(":scope > img")) card = card.parentElement;
      if (!card || card === home) return;
      const titleEl = card.querySelector("span");
      if (!titleEl || !titleEl.contains(e.target)) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (nameClick && nameClick.card === card) {
        clearTimeout(nameClick.timer);
        nameClick = null;
        startRename(home, card);
        return;
      }
      nameClick = {
        card,
        timer: setTimeout(() => {
          nameClick = null;
          replaying = true;
          titleEl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
          replaying = false;
        }, 260),
      };
    }, true);

    // Upstream: clicking an already-open project only closes the start page (showing whichever
    // project was active). Activate the matching tab first so the clicked project is the one shown.
    home.addEventListener("click", (e) => {
      if (e.target.closest("svg")) return; // delete icon
      let card = e.target;
      while (card && card !== home && !card.querySelector(":scope > img")) card = card.parentElement;
      if (!card || card === home) return;
      const title = (card.querySelector("span") || {}).textContent;
      const tabs = [];
      for (const u of document.querySelectorAll("use")) {
        if ((u.getAttribute("href") || u.getAttribute("xlink:href")) !== "#icon-times") continue;
        const svg = u.closest("svg");
        if (svg && !svg.closest("chili-home")) tabs.push(svg.parentElement);
      }
      const named = tabs.filter((t) => (t.querySelector("span") || {}).textContent === title);
      if (named.length && !named.some((t) => t.classList.length > 1)) named[0].click();
    }, true);

    left.style.position = "relative";
    const handle = document.createElement("div");
    handle.title = "Drag to resize (double-click to reset)";
    handle.style.cssText =
      "position:absolute;top:0;right:-3px;width:6px;height:100%;cursor:col-resize;z-index:5;" +
      "background:transparent;transition:background 0.15s;touch-action:none;";
    let dragging = false;
    handle.addEventListener("pointerenter", () => {
      handle.style.background = "color-mix(in srgb, var(--primary-color, #4f8cff) 45%, transparent)";
    });
    handle.addEventListener("pointerleave", () => { if (!dragging) handle.style.background = "transparent"; });
    left.appendChild(handle);

    const page = home.children[1] && home.children[1].firstElementChild;
    const apply = () => {
      const narrow = window.innerWidth <= NARROW;
      handle.hidden = narrow;
      left.style.flex = narrow ? "" : `0 0 ${saved() || DEFAULT}px`;
      // Chili3D centres the content column; keep it close to the left panel instead.
      if (page) {
        page.style.margin = narrow ? "" : "0";
        page.style.paddingLeft = narrow ? "" : "56px";
      }
    };

    handle.addEventListener("pointerdown", (e) => {
      dragging = true;
      handle.setPointerCapture(e.pointerId);
      document.body.style.userSelect = "none";
      e.preventDefault();
    });
    handle.addEventListener("pointermove", (e) => {
      if (!handle.hasPointerCapture(e.pointerId)) return;
      const w = clamp(e.clientX - left.getBoundingClientRect().left);
      left.style.flex = `0 0 ${w}px`;
    });
    const end = (e) => {
      if (!handle.hasPointerCapture(e.pointerId)) return;
      dragging = false;
      handle.releasePointerCapture(e.pointerId);
      document.body.style.userSelect = "";
      handle.style.background = "transparent";
      localStorage.setItem(KEY, String(Math.round(left.getBoundingClientRect().width)));
    };
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    handle.addEventListener("dblclick", () => {
      localStorage.removeItem(KEY);
      apply();
    });

    window.addEventListener("resize", apply);
    apply();
  }

  const scan = () => document.querySelectorAll("chili-home").forEach(tweak);
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  scan();
})();
