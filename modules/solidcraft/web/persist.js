/* One EAD: Persistent disk mirror for SolidCraft
   Ensures all SolidCraft 3D CAD designs, OPFS virtual files, recovery saves,
   and preferences are safely mirrored to One EAD backend disk store
   (/api/solidcraft/store) so they survive restarts, browser cache clears,
   and origin changes.
*/
(() => {
  "use strict";

  const API = "/api/solidcraft/store";
  const syncedFiles = new Map(); // filename -> { size, mtime }
  let syncTimer = null;
  let isSyncing = false;

  const notify = (state, extra = {}) => {
    try {
      if (parent !== window) {
        parent.postMessage({ source: "oneead-solidcraft", state, ...extra }, location.origin);
      }
    } catch (_) {}
  };

  /* ------------------- OPFS Helpers ------------------- */
  async function getOpfsRoot() {
    if (!navigator.storage || !navigator.storage.getDirectory) return null;
    try {
      return await navigator.storage.getDirectory();
    } catch (e) {
      console.warn("[One EAD SolidCraft] OPFS not available:", e);
      return null;
    }
  }

  async function listOpfsFiles(root, prefix = "") {
    const list = [];
    if (!root) return list;
    try {
      for await (const [name, handle] of root.entries()) {
        const relPath = prefix ? `${prefix}/${name}` : name;
        if (handle.kind === "file") {
          const file = await handle.getFile();
          list.push({ name: relPath, size: file.size, mtime: file.lastModified, handle });
        } else if (handle.kind === "directory") {
          const sub = await listOpfsFiles(handle, relPath);
          list.push(...sub);
        }
      }
    } catch (e) {
      console.warn("[One EAD SolidCraft] Error reading OPFS directory:", e);
    }
    return list;
  }

  async function writeOpfsFile(root, path, buffer) {
    if (!root) return;
    try {
      const parts = path.split("/").filter(Boolean);
      const filename = parts.pop();
      let dir = root;
      for (const part of parts) {
        dir = await dir.getDirectoryHandle(part, { create: true });
      }
      const handle = await dir.getFileHandle(filename, { create: true });
      const writable = await handle.createWritable();
      await writable.write(buffer);
      await writable.close();
    } catch (e) {
      console.warn("[One EAD SolidCraft] Error writing OPFS file", path, e);
    }
  }

  async function readOpfsFile(root, path) {
    if (!root) return null;
    try {
      const parts = path.split("/").filter(Boolean);
      const filename = parts.pop();
      let dir = root;
      for (const part of parts) {
        dir = await dir.getDirectoryHandle(part);
      }
      const handle = await dir.getFileHandle(filename);
      const file = await handle.getFile();
      return await file.arrayBuffer();
    } catch (e) {
      return null;
    }
  }

  /* ------------------- Startup Reconciliation ------------------- */
  async function reconcile() {
    notify("syncing", { message: "Reconciling disk backup..." });
    const root = await getOpfsRoot();

    // 1. Restore preferences from disk
    try {
      const prefsRes = await fetch(`${API}/prefs`);
      if (prefsRes.ok) {
        const prefs = await prefsRes.json();
        for (const [k, v] of Object.entries(prefs)) {
          if (k.startsWith("solidcraft.") || k.startsWith("solvecraft.")) {
            localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
          }
        }
      }
    } catch (e) {
      console.warn("[One EAD SolidCraft] Could not restore prefs:", e);
    }

    if (!root) {
      notify("saved", { message: "Local storage active (OPFS fallback)" });
      return;
    }

    // 2. Reconcile OPFS files with Server Disk Store
    try {
      const idxRes = await fetch(`${API}/index`);
      if (!idxRes.ok) throw new Error(`HTTP ${idxRes.status}`);
      const idx = await idxRes.json();
      const serverProjects = idx.projects || [];
      const localFiles = await listOpfsFiles(root);
      const localMap = new Map(localFiles.map((f) => [f.name, f]));

      let restoredCount = 0;

      // Restore server files missing or older in OPFS
      for (const sp of serverProjects) {
        const local = localMap.get(sp.filename);
        const serverMtimeMs = sp.mtime * 1000;
        if (!local || serverMtimeMs > local.mtime + 2000) {
          try {
            const encoded = sp.filename.split("/").map(encodeURIComponent).join("/");
            const fileRes = await fetch(`${API}/file/${encoded}`);
            if (fileRes.ok) {
              const buffer = await fileRes.arrayBuffer();
              await writeOpfsFile(root, sp.filename, buffer);
              syncedFiles.set(sp.filename, { size: buffer.byteLength, mtime: serverMtimeMs });
              restoredCount++;
            }
          } catch (err) {
            console.warn("[One EAD SolidCraft] Failed to restore project:", sp.filename, err);
          }
        } else {
          syncedFiles.set(sp.filename, { size: local.size, mtime: local.mtime });
        }
      }

      // Upload any local files that are missing on the server
      const serverNames = new Set(serverProjects.map((p) => p.filename));
      for (const lf of localFiles) {
        if (!serverNames.has(lf.name)) {
          const buffer = await readOpfsFile(root, lf.name);
          if (buffer) {
            await uploadFile(lf.name, buffer);
            syncedFiles.set(lf.name, { size: lf.size, mtime: lf.mtime });
          }
        }
      }

      if (restoredCount > 0) {
        notify("restored", { count: restoredCount });
      }
      notify("saved", { at: Date.now() });
    } catch (e) {
      console.warn("[One EAD SolidCraft] Startup reconciliation failed:", e);
      notify("error", { message: "Disk backup unreachable" });
    }
  }

  /* ------------------- Continuous Disk Sync ------------------- */
  async function uploadFile(filename, arrayBuffer) {
    const encoded = filename.split("/").map(encodeURIComponent).join("/");
    const res = await fetch(`${API}/file/${encoded}`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: arrayBuffer,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async function syncOpfsToDisk() {
    if (isSyncing) return;
    const root = await getOpfsRoot();
    if (!root) return;

    isSyncing = true;
    let anyChanges = false;

    try {
      const localFiles = await listOpfsFiles(root);
      for (const lf of localFiles) {
        const last = syncedFiles.get(lf.name);
        if (!last || last.size !== lf.size || Math.abs(last.mtime - lf.mtime) > 1000) {
          anyChanges = true;
          notify("saving", { filename: lf.name });
          const buffer = await readOpfsFile(root, lf.name);
          if (buffer) {
            await uploadFile(lf.name, buffer);
            syncedFiles.set(lf.name, { size: lf.size, mtime: lf.mtime });
          }
        }
      }

      // Also mirror solidcraft preferences from localStorage
      const prefs = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith("solidcraft.") || key.startsWith("solvecraft."))) {
          prefs[key] = localStorage.getItem(key);
        }
      }
      if (Object.keys(prefs).length > 0) {
        fetch(`${API}/prefs`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(prefs),
        }).catch(() => {});
      }

      if (anyChanges) {
        notify("saved", { at: Date.now() });
      }
    } catch (e) {
      console.warn("[One EAD SolidCraft] Background sync failed:", e);
      notify("error", { message: "Disk backup error" });
    } finally {
      isSyncing = false;
    }
  }

  function scheduleSync(delay = 3000) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      await syncOpfsToDisk();
      scheduleSync(4000); // Poll every 4 seconds for CAD autosaves
    }, delay);
  }

  /* ------------------- Messaging with Parent Wrapper ------------------- */
  window.addEventListener("message", async (evt) => {
    if (!evt.data || evt.data.target !== "oneead-solidcraft") return;
    const { action } = evt.data;

    if (action === "force-sync") {
      await syncOpfsToDisk();
    } else if (action === "load-file") {
      const root = await getOpfsRoot();
      if (root && evt.data.filename) {
        const res = await fetch(`${API}/file/${encodeURIComponent(evt.data.filename)}`);
        if (res.ok) {
          const buf = await res.arrayBuffer();
          await writeOpfsFile(root, evt.data.filename, buf);
          notify("loaded", { filename: evt.data.filename });
        }
      }
    }
  });

  // Ensure disk sync before tab closes or changes visibility
  window.addEventListener("pagehide", () => syncOpfsToDisk());
  window.addEventListener("beforeunload", () => syncOpfsToDisk());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") syncOpfsToDisk();
  });

  // Handle F11 key when keyboard focus is inside SolidCraft canvas
  window.addEventListener("keydown", (e) => {
    if (e.key === "F11") {
      e.preventDefault();
      try {
        if (parent !== window) {
          parent.postMessage({ type: "ead:toggle-fullscreen" }, location.origin);
        } else {
          if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
          else document.exitFullscreen().catch(() => {});
        }
      } catch (_) {}
    }
  });

  // Boot sequence
  (async () => {
    try {
      if (navigator.storage && navigator.storage.persist) {
        await navigator.storage.persist();
      }
    } catch (_) {}

    await reconcile();
    scheduleSync(2500);
  })();
})();
