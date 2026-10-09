/* One EAD: autosave for Chili3D. Chili3D only saves on request, so this watches each open
   document's undo history and, once edits go quiet, writes it to the same storage the Save
   command uses (IndexedDB "chili3d-db"; persist.js mirrors that to disk). */
(() => {
  "use strict";

  const DB = "chili3d-db";
  const TICK_MS = 500;
  const QUIET_MS = 1500; // wait for edits to stop before saving
  const ENABLED_KEY = "oneead:chili3d:autosave"; // "0" = off (toggle lives in the plugin toolbar menu)

  let app = null;
  const state = new WeakMap(); // document -> { saved, last, changedAt, busy }
  const ids = new WeakMap();
  let nextId = 1;
  const idOf = (o) => {
    if (!o) return 0;
    if (!ids.has(o)) ids.set(o, nextId++);
    return ids.get(o);
  };

  // Changes only ever add/remove history records, so this identifies the document's edit state.
  const signature = (doc) => {
    const h = doc.history;
    if (!h || !h._undos) return "";
    return `${h._undos.length}/${h._redos.length}/${idOf(h._undos[h._undos.length - 1])}`;
  };

  async function save(doc, isActive, fit) {
    // Capture everything synchronously: when this runs because the start page is opening,
    // the editor is still showing and the start page must see the finished write.
    const data = doc.serialize();
    let image;
    if (isActive) {
      try {
        if (fit) app.activeView.cameraController.fitContent(); // opened files: thumbnail of the whole model
        image = app.activeView.toImage();
      } catch (_) { /* keep previous thumbnail */ }
    }
    if (image === undefined) {
      const prev = await app.storage.get(DB, "recents", doc.id);
      image = prev && prev.image;
    }
    await Promise.all([
      app.storage.put(DB, "documents", doc.id, data),
      app.storage.put(DB, "recents", doc.id, { id: doc.id, name: doc.name, date: Date.now(), image }),
    ]);
  }

  function ready() {
    if (!app) {
      const home = document.querySelector("chili-home");
      if (home && home.app) app = home.app;
    }
    return !!app && !!app.documents && localStorage.getItem(ENABLED_KEY) !== "0";
  }

  function visit(force) {
    if (!ready()) return;
    const active = app.activeView && app.activeView.document;
    for (const doc of [...app.documents]) {
      const sig = signature(doc);
      let st = state.get(doc);
      if (!st) {
        st = { saved: sig, last: sig, changedAt: 0, busy: false, fresh: false, freshAt: 0 };
        state.set(doc, st);
        // A document that arrives with content but is not in storage was opened/imported from a
        // file: it should become a saved project at once, not wait for a first edit.
        const stState = st;
        app.storage.get(DB, "documents", doc.id).then((stored) => {
          const root = doc.modelManager && doc.modelManager.rootNode;
          if (!stored && root && root.firstChild) {
            stState.fresh = true;
            stState.freshAt = Date.now();
          }
        }).catch(() => {});
        continue;
      }
      if (sig !== st.last) {
        st.last = sig;
        st.changedAt = Date.now();
      }
      const dirty = st.last !== st.saved;
      const quiet = force || Date.now() - st.changedAt >= QUIET_MS;
      // Give a freshly opened file a moment to become the active view before its thumbnail is taken.
      const freshDue = st.fresh && (force || Date.now() - st.freshAt >= (doc === active ? 700 : 3000));
      if (st.busy || !((dirty && quiet) || freshDue)) continue;

      st.busy = true;
      const savedSig = st.last;
      save(doc, doc === active, st.fresh)
        .then(() => { st.saved = savedSig; st.fresh = false; })
        .catch((err) => {
          console.warn("[oneead] autosave failed, will retry", err);
          st.changedAt = Date.now();
        })
        .finally(() => { st.busy = false; });
    }
  }

  // Opening the start page re-reads thumbnails: save pending edits first instead of waiting.
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!t || !t.closest || t.closest("chili-home")) return;
    let opening = !!t.closest("#appName");
    if (!opening) {
      const use = t.closest("svg") && t.closest("svg").querySelector("use");
      const href = use && (use.getAttribute("href") || use.getAttribute("xlink:href"));
      opening = href === "#icon-home" || href === "#icon-chili";
    }
    if (opening) visit(true);
  }, true);

  setInterval(() => visit(false), TICK_MS);
})();
