/* One EAD: disk mirror for Chili3D's IndexedDB ("chili3d-db").
   Runs before the Chili3D bundle: restores/pushes works, then starts the app,
   then mirrors every later save/delete to the server. */
(() => {
  "use strict";

  const DB_NAME = "chili3d-db";
  const API = "/api/chili3d/store";
  const scriptsEl = document.getElementById("oneead-app-scripts");
  let appScripts = [];
  try { appScripts = JSON.parse(scriptsEl ? scriptsEl.textContent : "[]"); } catch (_) {}

  const notify = (state, extra) => {
    try {
      if (parent !== window) parent.postMessage({ source: "oneead-chili3d", state, ...extra }, location.origin);
    } catch (_) {}
  };

  /* ---- "Untitled N" numbering (the patched New Document command calls this) ---- */
  const savedNames = new Map(); // recents id -> name; kept in step with saves and deletes
  const openTabNames = () => {
    const names = [];
    for (const u of document.querySelectorAll("use")) {
      if ((u.getAttribute("href") || u.getAttribute("xlink:href")) !== "#icon-times") continue;
      const span = u.closest("svg") && u.closest("svg").parentElement.querySelector("span");
      if (span) names.push(span.textContent);
    }
    return names;
  };
  window.__oeNextUntitled = () => {
    const used = new Set([...savedNames.values(), ...openTabNames()]);
    let i = 1;
    while (used.has("Untitled " + i)) i++;
    return i;
  };

  /* ---- value codec (IndexedDB values may hold binary / Map / Date) ---- */
  const TYPED = { Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array,
    Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array };

  function toB64(u8) {
    let s = "";
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromB64(b64) {
    const s = atob(b64), u8 = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    return u8;
  }
  function encode(value) {
    return JSON.stringify(value, function (k, v) {
      const raw = this[k];
      if (raw instanceof ArrayBuffer) return { __oe: "ab", b: toB64(new Uint8Array(raw)) };
      if (ArrayBuffer.isView(raw)) {
        return { __oe: "ta", c: raw.constructor.name, b: toB64(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)) };
      }
      if (raw instanceof Date) return { __oe: "d", t: raw.getTime() };
      if (raw instanceof Map) return { __oe: "map", e: [...raw.entries()] };
      if (raw instanceof Set) return { __oe: "set", e: [...raw] };
      if (typeof raw === "bigint") return { __oe: "bi", v: raw.toString() };
      if (typeof Blob !== "undefined" && raw instanceof Blob) return null;
      return v;
    });
  }
  function decode(text) {
    return JSON.parse(text, (k, v) => {
      if (!v || typeof v !== "object" || !v.__oe) return v;
      switch (v.__oe) {
        case "ab": return fromB64(v.b).buffer;
        case "ta": { const C = TYPED[v.c] || Uint8Array; return new C(fromB64(v.b).buffer); }
        case "d": return new Date(v.t);
        case "map": return new Map(v.e);
        case "set": return new Set(v.e);
        case "bi": return BigInt(v.v);
        default: return v;
      }
    });
  }

  /* ---- server helpers ---- */
  const url = (table, id) => `${API}/${encodeURIComponent(table)}/${encodeURIComponent(id)}`;
  async function fetchJson(u, ms) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms || 8000);
    try {
      const r = await fetch(u, { signal: ctl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r;
    } finally { clearTimeout(t); }
  }
  async function putItem(table, id, value) {
    const body = encode(value);
    const r = await fetch(url(table, id), {
      method: "PUT", headers: { "Content-Type": "application/json" }, body, keepalive: body.length < 60000,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  }
  async function deleteItem(table, id) {
    const r = await fetch(url(table, id), { method: "DELETE", keepalive: true });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  }

  /* ---- IndexedDB helpers ---- */
  const asPromise = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const txDone = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = tx.onabort = () => rej(tx.error); });
  function openDb(version, onUpgrade) {
    return new Promise((res, rej) => {
      const r = version ? indexedDB.open(DB_NAME, version) : indexedDB.open(DB_NAME);
      r.onupgradeneeded = () => onUpgrade && onUpgrade(r.result);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error("IndexedDB open blocked"));
    });
  }

  /* ---- startup reconcile: disk <-> browser ---- */
  // Returns local items that the server lacks (or has older), already read into memory.
  async function reconcile() {
    const idx = await (await fetchJson(`${API}/index`, 6000)).json();
    const server = idx.tables || {};
    let db = await openDb();
    const names = [...db.objectStoreNames];

    const localKeys = {};
    const localDates = new Map();
    for (const t of names) {
      const os = db.transaction(t, "readonly").objectStore(t);
      if (t === "recents") {
        const [keys, vals] = await Promise.all([asPromise(os.getAllKeys()), asPromise(os.getAll())]);
        localKeys[t] = new Set(keys.map(String));
        keys.forEach((k, i) => localDates.set(String(k), Number(vals[i] && vals[i].date) || 0));
      } else {
        localKeys[t] = new Set((await asPromise(os.getAllKeys())).map(String));
      }
    }

    const serverDates = new Map((server.recents || []).map((e) => [String(e.id), Number(e.date) || 0]));
    const serverNewer = new Set();
    const localNewer = new Set();
    for (const [id, d] of serverDates) if (localDates.has(id) && d > localDates.get(id)) serverNewer.add(id);
    for (const [id, d] of localDates) if (serverDates.has(id) && d > serverDates.get(id)) localNewer.add(id);

    const toRestore = [];
    for (const [t, items] of Object.entries(server)) {
      for (const e of items) {
        const id = String(e.id);
        if (!(localKeys[t] && localKeys[t].has(id)) || serverNewer.has(id)) toRestore.push([t, id]);
      }
    }

    if (toRestore.length) {
      const missing = [...new Set(toRestore.map(([t]) => t))].filter((t) => !names.includes(t));
      if (missing.length) {
        const v = db.version;
        db.close();
        db = await openDb(v + 1, (d) => { for (const t of missing) if (!d.objectStoreNames.contains(t)) d.createObjectStore(t); });
        for (const t of missing) localKeys[t] = new Set();
      }
      let restored = 0;
      for (const [t, id] of toRestore) {
        try {
          const value = decode(await (await fetchJson(url(t, id), 30000)).text());
          const tx = db.transaction(t, "readwrite");
          tx.objectStore(t).put(value, id);
          await txDone(tx);
          localKeys[t].add(id);
          if (t === "documents") restored++;
        } catch (e) { console.warn("[oneead] restore failed", t, id, e); }
      }
      if (restored) notify("restored", { count: restored });
    }

    // Collect local-only / newer-local items for upload after the app is running.
    const serverKeys = {};
    for (const [t, items] of Object.entries(server)) serverKeys[t] = new Set(items.map((e) => String(e.id)));
    const toPush = [];
    for (const t of db.objectStoreNames) {
      const os = db.transaction(t, "readonly").objectStore(t);
      const keys = await asPromise(os.getAllKeys());
      for (const k of keys) {
        const id = String(k);
        if (!(serverKeys[t] && serverKeys[t].has(id)) || localNewer.has(id)) {
          toPush.push([t, id, await asPromise(db.transaction(t, "readonly").objectStore(t).get(k))]);
        }
      }
    }
    // Remember existing work names so new documents continue the Untitled numbering.
    if (db.objectStoreNames.contains("recents")) {
      const recents = await asPromise(db.transaction("recents", "readonly").objectStore("recents").getAll());
      for (const r of recents) if (r && r.id !== undefined && r.name) savedNames.set(String(r.id), r.name);
    }
    db.close();
    return toPush;
  }

  /* ---- live mirroring ---- */
  const pending = new Map();
  let flushTimer = null, flushing = false;

  function enqueue(table, id, op, value) {
    if (table === "recents") {
      if (op === "put" && value && value.name) savedNames.set(id, value.name);
      else if (op === "delete") savedNames.delete(id);
    }
    pending.set(table + "\u0000" + id, { table, id, op, value });
    notify("saving");
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 400);
  }
  async function flush() {
    if (flushing) return;
    flushing = true;
    try {
      for (const [k, it] of [...pending]) {
        try {
          if (it.op === "delete") await deleteItem(it.table, it.id);
          else await putItem(it.table, it.id, it.value);
          if (pending.get(k) === it) pending.delete(k);
        } catch (e) { console.warn("[oneead] backup failed", it.table, it.id, e); }
      }
    } finally { flushing = false; }
    if (pending.size) { notify("error"); clearTimeout(flushTimer); flushTimer = setTimeout(flush, 5000); }
    else notify("saved", { at: Date.now() });
  }

  function installHooks() {
    const P = IDBObjectStore.prototype;
    const origPut = P.put, origAdd = P.add, origDelete = P.delete;
    function track(store, op, value, key) {
      if (store.transaction.db.name !== DB_NAME) return;
      let k = key;
      if (k === undefined && op !== "delete" && typeof store.keyPath === "string") k = value && value[store.keyPath];
      if (k === undefined || k === null || typeof k === "object") return;
      store.transaction.addEventListener("complete", () => enqueue(store.name, String(k), op, value));
    }
    P.put = function (value, key) { const r = origPut.apply(this, arguments); try { track(this, "put", value, key); } catch (_) {} return r; };
    P.add = function (value, key) { const r = origAdd.apply(this, arguments); try { track(this, "put", value, key); } catch (_) {} return r; };
    P.delete = function (key) { const r = origDelete.apply(this, arguments); try { track(this, "delete", undefined, key); } catch (_) {} return r; };
    window.addEventListener("pagehide", () => { if (pending.size) flush(); });
  }

  /* ---- boot ---- */
  // Chili3D assumes it is hosted at the site root (e.g. fetch("/videos.json")); here the
  // root is the portal, which answers with a JSON 404. Re-root such requests to the app folder.
  function reRootFetch() {
    const base = new URL(".", location.href).pathname;
    const origFetch = window.fetch;
    window.fetch = function (input, init) {
      if (typeof input === "string" && input.startsWith("/") && !input.startsWith("//")
          && !/^\/(api|modules|shared)\//.test(input)) {
        input = base + input.slice(1);
      }
      return origFetch.call(this, input, init);
    };
  }

  function launch() {
    for (const name of ["home-tweaks", "doc-switcher", "autosave"]) {
      const helper = document.createElement("script");
      helper.src = `/modules/chili3d/${name}.js`;
      document.body.appendChild(helper);
    }
    for (const s of appScripts) {
      const el = document.createElement("script");
      el.src = s.src;
      if (s.module) el.type = "module";
      el.async = false;
      document.body.appendChild(el);
    }
  }
  const domReady = () => document.readyState !== "loading"
    ? Promise.resolve() : new Promise((r) => document.addEventListener("DOMContentLoaded", r, { once: true }));

  (async () => {
    let toPush = [];
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (_) {}
    try {
      toPush = await Promise.race([reconcile(), new Promise((r) => setTimeout(() => r([]), 25000))]);
    } catch (e) {
      console.warn("[oneead] disk backup unavailable, continuing", e);
      notify("error");
    }
    installHooks();
    reRootFetch();
    await domReady();
    launch();
    for (const [t, id, value] of toPush) enqueue(t, id, "put", value);
    if (!toPush.length) notify("saved", { at: Date.now() });
  })();
})();
