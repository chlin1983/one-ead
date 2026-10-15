/**
 * PdfCraft Workbench wrapper controller for One EAD.
 */

(function () {
  "use strict";

  const state = {
    installed: false,
    installedVersion: "0.8.0",
    docs: [],
    activeDoc: null,
    isCollapsed: false,
    pollTimer: null,
  };

  const el = {
    root: document.getElementById("craft-root"),
    bar: document.getElementById("craft-bar"),
    handle: document.getElementById("bar-handle"),
    frame: document.getElementById("app-frame"),
    versionChip: document.getElementById("chip-version"),
    docSelect: document.getElementById("doc-select"),
    fileInput: document.getElementById("file-input"),
    uploadBtn: document.getElementById("btn-upload"),
    newTabBtn: document.getElementById("btn-new-tab"),
    fsBtn: document.getElementById("btn-fullscreen"),
    fsLabel: document.getElementById("fs-label"),
    collapseBtn: document.getElementById("btn-collapse"),
    settingsBtn: document.getElementById("btn-settings"),
    menu: document.getElementById("menu"),
    checkUpdatesBtn: document.getElementById("btn-check-updates"),
    reinstallBtn: document.getElementById("btn-reinstall"),
    deleteDocBtn: document.getElementById("btn-delete-doc"),
    deleteQuickBtn: document.getElementById("btn-delete-active-doc"),
    revealFolderBtn: document.getElementById("btn-reveal-folder"),
    openFolderBtn: document.getElementById("btn-open-folder"),
    libraryModal: document.getElementById("library-modal"),
    closeModalBtn: document.getElementById("btn-close-modal"),
    modalUploadBtn: document.getElementById("btn-modal-upload"),
    modalOpenExplorerBtn: document.getElementById("btn-modal-open-explorer"),
    modalCopyPathBtn: document.getElementById("btn-modal-copy-path"),
    libPathCode: document.getElementById("lib-path-code"),
    libFileList: document.getElementById("lib-file-list"),
    installer: document.getElementById("installer"),
    instTitle: document.getElementById("inst-title"),
    instMsg: document.getElementById("inst-msg"),
    instLog: document.getElementById("inst-log"),
    retryBtn: document.getElementById("btn-retry"),
    toast: document.getElementById("toast"),
  };

  async function init() {
    wireEvents();
    restorePreferences();
    await checkStatus();
  }

  function showToast(message, duration = 3000) {
    if (!el.toast) return;
    el.toast.textContent = message;
    el.toast.hidden = false;
    el.toast.style.opacity = "1";
    setTimeout(() => {
      el.toast.style.opacity = "0";
      setTimeout(() => {
        el.toast.hidden = true;
      }, 200);
    }, duration);
  }

  function restorePreferences() {
    const collapsed = localStorage.getItem("one-ead:pdfcraft:collapsed") === "true";
    if (collapsed) {
      state.isCollapsed = true;
      el.root.classList.add("bar-collapsed");
    }
  }

  async function checkStatus() {
    try {
      const res = await fetch("/api/pdfcraft/status");
      const data = await res.json();
      state.installed = data.installed;
      state.installedVersion = data.installed_version || "0.8.0";

      if (el.versionChip) {
        el.versionChip.textContent = `v${state.installedVersion}`;
      }

      if (data.job && data.job.state === "running") {
        showInstaller(data.job.message || "Installing...", data.job_log || []);
        startPolling();
        return;
      }

      if (!state.installed) {
        showInstaller("PdfCraft engine not found. Click below to install.", []);
        if (el.retryBtn) el.retryBtn.hidden = false;
        return;
      }

      hideInstaller();
      await loadDocuments();
    } catch (err) {
      console.warn("[pdfcraft] Error checking status:", err);
      // Fallback: still try loading documents
      await loadDocuments();
    }
  }

  async function loadDocuments() {
    try {
      const res = await fetch("/api/pdfcraft/docs");
      state.docs = await res.json();
      renderDocSelect();
    } catch (err) {
      console.warn("[pdfcraft] Error loading docs:", err);
    }
  }

  function renderDocSelect() {
    el.docSelect.innerHTML = "";
    if (!state.docs || !state.docs.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No documents found";
      el.docSelect.appendChild(opt);
      loadInFrame(null);
      return;
    }

    state.docs.forEach((d) => {
      const opt = document.createElement("option");
      opt.value = d.name;
      opt.textContent = d.name;
      el.docSelect.appendChild(opt);
    });

    // Keep active doc if still in list, otherwise select first
    const target = state.docs.some((d) => d.name === state.activeDoc)
      ? state.activeDoc
      : state.docs[0].name;

    el.docSelect.value = target;
    selectDoc(target);
  }

  function selectDoc(docName) {
    state.activeDoc = docName;
    const docObj = state.docs.find((d) => d.name === docName);
    if (!docObj) {
      loadInFrame(null);
      return;
    }
    loadInFrame(docObj.url);
  }

  function loadInFrame(fileUrl) {
    if (!el.frame) return;
    let targetUrl = "app/index.html";
    if (fileUrl) {
      targetUrl += `?file=${encodeURIComponent(fileUrl)}`;
    }
    // Only reload if URL actually changed
    const currentSrc = el.frame.getAttribute("src");
    if (currentSrc !== targetUrl) {
      el.frame.src = targetUrl;
    }
  }

  function showInstaller(msg, logs = []) {
    if (!el.installer) return;
    el.installer.hidden = false;
    if (el.instMsg) el.instMsg.textContent = msg;
    if (el.instLog) el.instLog.textContent = logs.join("\n");
  }

  function hideInstaller() {
    if (el.installer) el.installer.hidden = true;
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function startPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(async () => {
      try {
        const res = await fetch("/api/pdfcraft/status");
        const data = await res.json();
        if (el.instLog && data.job_log) {
          el.instLog.textContent = data.job_log.join("\n");
          el.instLog.scrollTop = el.instLog.scrollHeight;
        }
        if (data.job && data.job.state === "done") {
          hideInstaller();
          showToast("PdfCraft ready!");
          await checkStatus();
        } else if (data.job && data.job.state === "error") {
          if (el.instMsg) el.instMsg.textContent = `Error: ${data.job.error}`;
          if (el.retryBtn) el.retryBtn.hidden = false;
          clearInterval(state.pollTimer);
          state.pollTimer = null;
        }
      } catch (e) {
        console.warn("[pdfcraft] Polling error:", e);
      }
    }, 1500);
  }

  function wireEvents() {
    // Document dropdown change
    el.docSelect?.addEventListener("change", (e) => {
      selectDoc(e.target.value);
    });

    // Upload button
    el.uploadBtn?.addEventListener("click", () => {
      el.fileInput?.click();
    });

    // File input change
    el.fileInput?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const fd = new FormData();
      fd.append("file", file);

      showToast(`Uploading ${file.name}…`);
      try {
        const res = await fetch("/api/pdfcraft/upload", {
          method: "POST",
          body: fd,
        });
        if (!res.ok) throw new Error("Upload failed");
        const doc = await res.json();
        showToast(`Saved to workbench library: ${doc.name}`);
        state.activeDoc = doc.name;
        await loadDocuments();
      } catch (err) {
        showToast(`Failed to upload: ${err.message}`);
      } finally {
        el.fileInput.value = "";
      }
    });

    // Pop out in new tab
    el.newTabBtn?.addEventListener("click", () => {
      const src = el.frame?.src;
      if (src) {
        window.open(src, "_blank");
      }
    });

    // Full screen toggle
    el.fsBtn?.addEventListener("click", () => {
      if (!document.fullscreenElement) {
        el.root?.requestFullscreen().catch((err) => {
          showToast(`Full screen error: ${err.message}`);
        });
      } else {
        document.exitFullscreen();
      }
    });

    document.addEventListener("fullscreenchange", () => {
      const isFs = Boolean(document.fullscreenElement);
      if (el.fsLabel) {
        el.fsLabel.textContent = isFs ? "Exit Full Screen" : "Full Screen";
      }
    });

    // Toolbar collapse / expand
    el.collapseBtn?.addEventListener("click", () => {
      state.isCollapsed = true;
      el.root.classList.add("bar-collapsed");
      localStorage.setItem("one-ead:pdfcraft:collapsed", "true");
      showToast("Toolbar collapsed. Hover top edge to restore.");
    });

    el.handle?.addEventListener("click", () => {
      state.isCollapsed = false;
      el.root.classList.remove("bar-collapsed");
      localStorage.setItem("one-ead:pdfcraft:collapsed", "false");
    });

    // Settings dropdown
    el.settingsBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      const isHidden = el.menu.hidden;
      el.menu.hidden = !isHidden;
      el.settingsBtn.setAttribute("aria-expanded", String(!isHidden));
    });

    document.addEventListener("click", (e) => {
      if (el.menu && !el.menu.hidden && !el.menu.contains(e.target) && e.target !== el.settingsBtn) {
        el.menu.hidden = true;
        el.settingsBtn?.setAttribute("aria-expanded", "false");
      }
    });

    // Check updates
    el.checkUpdatesBtn?.addEventListener("click", async () => {
      el.menu.hidden = true;
      showToast("Checking GitHub for newer releases…");
      try {
        const res = await fetch("/api/pdfcraft/check", { method: "POST" });
        const data = await res.json();
        if (data.has_update) {
          showToast(`New version available: v${data.latest_version}`);
        } else {
          showToast(`Up to date! Current: v${data.installed_version}`);
        }
      } catch (err) {
        showToast("Could not check updates");
      }
    });

    // Reinstall engine
    el.reinstallBtn?.addEventListener("click", async () => {
      el.menu.hidden = true;
      if (!confirm("Re-download and refresh the PdfCraft WebAssembly bundle?")) return;
      showToast("Starting engine refresh…");
      try {
        const res = await fetch("/api/pdfcraft/install", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force: true }),
        });
        const data = await res.json();
        showInstaller("Downloading engine...", data.job_log || []);
        startPolling();
      } catch (err) {
        showToast("Error starting installation");
      }
    });

    // Unified document deletion function
    async function deleteCurrentDocument() {
      if (!state.activeDoc) return;
      if (state.activeDoc === "Welcome_to_PdfCraft.pdf" && state.docs.length <= 1) {
        showToast("Cannot delete the only starter specimen.");
        return;
      }
      if (!confirm(`Delete "${state.activeDoc}" from your workbench library?`)) return;
      try {
        const res = await fetch(`/api/pdfcraft/doc/${encodeURIComponent(state.activeDoc)}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error("Delete failed");
        showToast(`Deleted ${state.activeDoc}`);
        state.activeDoc = null;
        await loadDocuments();
      } catch (err) {
        showToast(`Could not delete: ${err.message}`);
      }
    }

    // Delete doc from menu
    el.deleteDocBtn?.addEventListener("click", () => {
      el.menu.hidden = true;
      deleteCurrentDocument();
    });

    // Delete doc from inline quick button
    el.deleteQuickBtn?.addEventListener("click", () => {
      deleteCurrentDocument();
    });

    // Reveal storage folder in Explorer
    let storedFolderPath = "C:\\Users\\Z00314DJ\\Downloads\\AntigravityProject\\one-ead\\modules\\pdfcraft\\data\\docs";

    async function openStorageFolder() {
      try {
        const res = await fetch("/api/pdfcraft/reveal", { method: "POST" });
        const data = await res.json();
        if (data.path) {
          storedFolderPath = data.path;
          if (el.libPathCode) el.libPathCode.textContent = data.path;
          try {
            await navigator.clipboard.writeText(data.path);
            showToast(`Opened Explorer. Copied path: ${data.path}`, 6000);
            return;
          } catch (_) {}
          showToast(`Opened Explorer: ${data.path}`, 5000);
        } else {
          showToast("Opened PDF folder in Explorer");
        }
      } catch (err) {
        showToast("Could not open folder");
      }
    }

    function formatBytes(bytes) {
      if (!bytes || bytes === 0) return "0 Bytes";
      const k = 1024;
      const sizes = ["Bytes", "KB", "MB", "GB"];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
    }

    function renderLibraryModal() {
      if (!el.libFileList) return;
      el.libFileList.innerHTML = "";
      if (el.libPathCode) el.libPathCode.textContent = storedFolderPath;

      if (!state.docs || !state.docs.length) {
        el.libFileList.innerHTML = '<p class="empty-note" style="padding: 24px; text-align: center; color: var(--text-mute);">No PDF documents found in library.</p>';
        return;
      }

      state.docs.forEach((doc) => {
        const row = document.createElement("div");
        row.className = "lib-file-row";
        const sizeStr = formatBytes(doc.size || 0);
        const isSpecimen = doc.name === "Welcome_to_PdfCraft.pdf";
        const isCurrent = doc.name === state.activeDoc;

        row.innerHTML = `
          <div class="lib-file-info">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lib-file-icon">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            <div class="lib-file-meta">
              <div class="lib-file-name" title="${doc.name}">${doc.name} ${isCurrent ? '<span class="chip" style="font-size: 10px; padding: 1px 6px;">Active</span>' : ''}</div>
              <div class="lib-file-sub">${sizeStr} &middot; ${new Date(doc.modified).toLocaleDateString()}</div>
            </div>
          </div>
          <div class="lib-file-actions">
            <button class="btn btn-sm btn-open-doc" type="button">Open</button>
            <a class="btn btn-sm ghost" href="${doc.url}" download="${doc.name}" title="Download local copy">Save</a>
            ${isSpecimen && state.docs.length <= 1 ? '' : `<button class="btn btn-sm ghost btn-del-doc" type="button" style="color: var(--danger, #d64545);" title="Delete file">🗑</button>`}
          </div>
        `;

        row.querySelector(".btn-open-doc")?.addEventListener("click", () => {
          selectDoc(doc.name);
          el.docSelect.value = doc.name;
          closeLibraryModal();
        });

        row.querySelector(".btn-del-doc")?.addEventListener("click", async () => {
          if (!confirm(`Delete "${doc.name}" from your workbench library?`)) return;
          try {
            const res = await fetch(`/api/pdfcraft/doc/${encodeURIComponent(doc.name)}`, { method: "DELETE" });
            if (!res.ok) throw new Error("Delete failed");
            showToast(`Deleted ${doc.name}`);
            if (state.activeDoc === doc.name) state.activeDoc = null;
            await loadDocuments();
            renderLibraryModal();
          } catch (err) {
            showToast(`Could not delete: ${err.message}`);
          }
        });

        el.libFileList.appendChild(row);
      });
    }

    function openLibraryModal() {
      if (!el.libraryModal) return;
      renderLibraryModal();
      el.libraryModal.hidden = false;
      // Also request reveal path in background to ensure up-to-date path
      fetch("/api/pdfcraft/reveal", { method: "POST" })
        .then(r => r.json())
        .then(data => {
          if (data.path) {
            storedFolderPath = data.path;
            if (el.libPathCode) el.libPathCode.textContent = data.path;
          }
        }).catch(() => {});
    }

    function closeLibraryModal() {
      if (el.libraryModal) el.libraryModal.hidden = true;
    }

    el.openFolderBtn?.addEventListener("click", openLibraryModal);
    el.closeModalBtn?.addEventListener("click", closeLibraryModal);
    el.modalUploadBtn?.addEventListener("click", () => el.fileInput?.click());
    el.modalOpenExplorerBtn?.addEventListener("click", openStorageFolder);
    el.modalCopyPathBtn?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(storedFolderPath);
        showToast(`Copied path to clipboard: ${storedFolderPath}`, 4000);
      } catch (_) {
        showToast(storedFolderPath, 5000);
      }
    });

    // Close modal on click backdrop
    el.libraryModal?.addEventListener("click", (e) => {
      if (e.target === el.libraryModal) closeLibraryModal();
    });

    el.revealFolderBtn?.addEventListener("click", () => {
      el.menu.hidden = true;
      openLibraryModal();
    });

    // Retry install button
    el.retryBtn?.addEventListener("click", async () => {
      el.retryBtn.hidden = true;
      try {
        const res = await fetch("/api/pdfcraft/install", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force: true }),
        });
        const data = await res.json();
        showInstaller("Downloading engine...", data.job_log || []);
        startPolling();
      } catch (err) {
        showToast("Error starting installation");
      }
    });
  }

  // Auto-init
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
