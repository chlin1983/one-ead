(function () {
  'use strict';

  const API_BASE = '/api/artcraft';

  const state = {
    apps: [],
    installedCount: 0,
    totalApps: 12,
    updatesAvailableCount: 0,
    checkingUpdates: false,
    job: null,
    selectedCategory: 'all',
    searchQuery: '',
    activeWorkbenchApp: null,
    pollTimer: null,
    theme: 'light', // Light is the default
  };

  // Icons for theme toggle
  const ICONS = {
    moon: `
      <svg class="theme-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    `,
    sun: `
      <svg class="theme-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="5"/>
        <line x1="12" y1="1" x2="12" y2="3"/>
        <line x1="12" y1="21" x2="12" y2="23"/>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
        <line x1="1" y1="12" x2="3" y2="12"/>
        <line x1="21" y1="12" x2="23" y2="12"/>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
      </svg>
    `,
  };

  // DOM Elements
  const els = {
    hubView: document.getElementById('hub-view'),
    workbenchView: document.getElementById('workbench-view'),
    suiteStatusBadge: document.getElementById('suite-status-badge'),
    btnCheckUpdates: document.getElementById('btn-check-updates'),
    checkUpdatesText: document.getElementById('check-updates-text'),
    btnInstallAll: document.getElementById('btn-install-all'),
    btnThemeToggle: document.getElementById('btn-theme-toggle'),
    btnRefresh: document.getElementById('btn-refresh'),
    progressBanner: document.getElementById('progress-banner'),
    progressMsg: document.getElementById('progress-msg'),
    progressBarFill: document.getElementById('progress-bar-fill'),
    categoryPills: document.getElementById('category-pills'),
    searchInput: document.getElementById('search-input'),
    appsGrid: document.getElementById('apps-grid'),
    wbBtnBack: document.getElementById('wb-btn-back'),
    wbAppIcon: document.getElementById('wb-app-icon'),
    wbAppTitle: document.getElementById('wb-app-title'),
    wbAppVer: document.getElementById('wb-app-ver'),
    wbAppTagline: document.getElementById('wb-app-tagline'),
    wbSwitcher: document.getElementById('wb-switcher'),
    wbBtnOpenTab: document.getElementById('wb-btn-open-tab'),
    wbBtnFullscreen: document.getElementById('wb-btn-fullscreen'),
    appIframe: document.getElementById('app-iframe'),
  };

  /* --------------------------------------------------------------------------
     Theme Management (White / Light as default, Black / Dark selectable)
     -------------------------------------------------------------------------- */
  function initTheme() {
    // Check localStorage (prefer ead-portal theme or artcraft theme, default to light)
    const stored = localStorage.getItem('artcraft-theme') || localStorage.getItem('ead-portal:theme') || 'light';
    setTheme(stored);

    // Sync with parent portal theme if updated in another tab/iframe
    window.addEventListener('storage', (e) => {
      if (e.key === 'ead-portal:theme' || e.key === 'artcraft-theme') {
        if (e.newValue && (e.newValue === 'light' || e.newValue === 'dark')) {
          setTheme(e.newValue);
        }
      }
    });

    // Also check parent portal document attribute if accessible
    try {
      if (window.parent && window.parent.document && window.parent.document.documentElement) {
        const parentTheme = window.parent.document.documentElement.getAttribute('data-theme');
        if (parentTheme) {
          setTheme(parentTheme);
        }
      }
    } catch (_) {}
  }

  function setTheme(theme) {
    state.theme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', state.theme);
    localStorage.setItem('artcraft-theme', state.theme);
    localStorage.setItem('ead-portal:theme', state.theme);

    // Update parent portal document if in same origin
    try {
      if (window.parent && window.parent.document && window.parent.document.documentElement) {
        window.parent.document.documentElement.setAttribute('data-theme', state.theme);
      }
    } catch (_) {}

    // Update button icon & tooltip
    if (els.btnThemeToggle) {
      if (state.theme === 'light') {
        els.btnThemeToggle.innerHTML = ICONS.moon;
        els.btnThemeToggle.title = 'Switch to Dark (Black) theme';
      } else {
        els.btnThemeToggle.innerHTML = ICONS.sun;
        els.btnThemeToggle.title = 'Switch to Light (White) theme';
      }
    }
  }

  function toggleTheme() {
    const next = state.theme === 'light' ? 'dark' : 'light';
    setTheme(next);
  }

  /* --------------------------------------------------------------------------
     Data Fetching & Status Polling
     -------------------------------------------------------------------------- */
  async function fetchStatus() {
    try {
      const res = await fetch(`${API_BASE}/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      state.apps = data.apps || [];
      state.installedCount = data.installed_count || 0;
      state.totalApps = data.total_apps || state.apps.length;
      state.updatesAvailableCount = data.updates_available_count || 0;
      state.checkingUpdates = Boolean(data.checking_updates);
      state.job = data.job || null;
      render();

      if ((state.job && state.job.state === 'running') || state.checkingUpdates) {
        startPolling();
      } else {
        stopPolling();
      }
    } catch (err) {
      console.error('Failed to load ArtCraft status:', err);
      els.suiteStatusBadge.textContent = 'Connection Error';
    }
  }

  function startPolling() {
    if (state.pollTimer) return;
    state.pollTimer = setInterval(fetchStatus, 1500);
  }

  function stopPolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  /* --------------------------------------------------------------------------
     Rendering
     -------------------------------------------------------------------------- */
  function render() {
    renderHeader();
    renderProgressBanner();
    renderGrid();
    renderSwitcher();
  }

  function renderHeader() {
    if (state.installedCount === state.totalApps && state.totalApps > 0) {
      if (state.updatesAvailableCount > 0) {
        els.suiteStatusBadge.textContent = `${state.updatesAvailableCount} Update${state.updatesAvailableCount > 1 ? 's' : ''} Available`;
        els.suiteStatusBadge.className = 'badge suite-badge';
        els.suiteStatusBadge.style.color = 'var(--accent-amber)';
        els.suiteStatusBadge.style.borderColor = 'rgba(217, 119, 6, 0.4)';
      } else {
        els.suiteStatusBadge.textContent = `All 12 Apps Installed & Ready`;
        els.suiteStatusBadge.className = 'badge suite-badge all-installed';
        els.suiteStatusBadge.style.color = '';
        els.suiteStatusBadge.style.borderColor = '';
      }

      const isJobRunning = state.job && state.job.state === 'running';
      if (state.updatesAvailableCount > 0) {
        els.btnInstallAll.innerHTML = `
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          <span>Update All (${state.updatesAvailableCount})</span>
        `;
      } else {
        els.btnInstallAll.innerHTML = `
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <span>All 12 Installed</span>
        `;
      }
      els.btnInstallAll.disabled = isJobRunning;
    } else {
      els.suiteStatusBadge.textContent = `${state.installedCount} / ${state.totalApps} Installed`;
      els.suiteStatusBadge.className = 'badge suite-badge';
      const remaining = state.totalApps - state.installedCount;
      const isJobRunning = state.job && state.job.state === 'running';
      els.btnInstallAll.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        <span>${isJobRunning ? 'Installing Apps…' : `Install All Apps (${remaining})`}</span>
      `;
      els.btnInstallAll.disabled = isJobRunning;
    }

    // Check updates button text / spinner
    if (state.checkingUpdates) {
      els.btnCheckUpdates.disabled = true;
      els.checkUpdatesText.textContent = 'Checking…';
    } else if (state.updatesAvailableCount > 0) {
      els.btnCheckUpdates.disabled = false;
      els.checkUpdatesText.textContent = `${state.updatesAvailableCount} Update${state.updatesAvailableCount > 1 ? 's' : ''}!`;
    } else {
      els.btnCheckUpdates.disabled = false;
      els.checkUpdatesText.textContent = 'Check Updates';
    }
  }

  function renderProgressBanner() {
    const job = state.job;
    if (job && job.state === 'running') {
      els.progressBanner.style.display = 'block';
      els.progressMsg.textContent = job.message || 'Installing WebAssembly applications…';
      const queuedCount = (job.queue ? job.queue.length : 0) + (job.active_app ? 1 : 0);
      const doneCount = state.totalApps - queuedCount;
      const pct = Math.max(10, Math.min(100, Math.round((doneCount / state.totalApps) * 100)));
      els.progressBarFill.style.width = `${pct}%`;
    } else {
      els.progressBanner.style.display = 'none';
    }
  }

  function renderGrid() {
    const q = state.searchQuery.toLowerCase().trim();
    const cat = state.selectedCategory;

    const filtered = state.apps.filter((app) => {
      if (cat !== 'all' && app.category !== cat) {
        return false;
      }
      if (q) {
        const matchesName = app.name.toLowerCase().includes(q);
        const matchesTag = (app.tagline || '').toLowerCase().includes(q);
        const matchesDesc = (app.description || '').toLowerCase().includes(q);
        const matchesCat = (app.category || '').toLowerCase().includes(q);
        if (!matchesName && !matchesTag && !matchesDesc && !matchesCat) {
          return false;
        }
      }
      return true;
    });

    if (filtered.length === 0) {
      els.appsGrid.innerHTML = `
        <div class="loading-state">
          <span>No ArtCraft applications match your filter.</span>
        </div>
      `;
      return;
    }

    els.appsGrid.innerHTML = filtered.map((app) => renderCard(app)).join('');

    // Attach card event listeners
    filtered.forEach((app) => {
      const card = document.getElementById(`card-${app.id}`);
      if (!card) return;

      const launchBtn = card.querySelector('.btn-launch-app');
      if (launchBtn) {
        launchBtn.addEventListener('click', () => launchApp(app.id));
      }

      const installBtn = card.querySelector('.btn-install-app');
      if (installBtn) {
        installBtn.addEventListener('click', () => installApp(app.id, false));
      }

      const updateBtn = card.querySelector('.btn-update-app');
      if (updateBtn) {
        updateBtn.addEventListener('click', () => installApp(app.id, true));
      }

      const popoutBtn = card.querySelector('.btn-popout-app');
      if (popoutBtn) {
        popoutBtn.addEventListener('click', () => {
          window.open(app.app_url, '_blank', 'noopener,noreferrer');
        });
      }

      const uninstallBtn = card.querySelector('.btn-uninstall-app');
      if (uninstallBtn) {
        uninstallBtn.addEventListener('click', () => uninstallApp(app.id));
      }

      const openSrcBtn = card.querySelector('.btn-open-source');
      if (openSrcBtn) {
        openSrcBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            await fetch(`${API_BASE}/open-source/${app.id}`, { method: 'POST' });
          } catch (err) {
            console.error('Failed to open source folder:', err);
          }
        });
      }
    });
  }

  function renderCard(app) {
    const isInstalled = Boolean(app.installed);
    const hasUpdate = Boolean(app.has_update);
    const isJobActive = state.job && state.job.active_app === app.id;
    const isQueued = state.job && state.job.queue && state.job.queue.includes(app.id);

    let statusHtml = '';
    let actionBtnHtml = '';

    if (isJobActive) {
      statusHtml = `
        <span class="card-status-indicator">
          <span class="status-dot busy"></span>
          <span style="color: var(--accent-amber);">Downloading…</span>
        </span>
      `;
      actionBtnHtml = `
        <button class="btn card-btn-install is-installing" disabled>
          <span class="spinner-sm"></span>
          <span>Installing…</span>
        </button>
      `;
    } else if (isQueued) {
      statusHtml = `
        <span class="card-status-indicator">
          <span class="status-dot busy"></span>
          <span style="color: var(--text-muted);">In Queue…</span>
        </span>
      `;
      actionBtnHtml = `
        <button class="btn card-btn-install is-installing" disabled>
          <span>Queued…</span>
        </button>
      `;
    } else if (isInstalled) {
      if (hasUpdate) {
        statusHtml = `
          <span class="card-status-indicator">
            <span class="status-dot update-available"></span>
            <span style="color: var(--accent-amber);">v${app.latest_version} Available</span>
          </span>
        `;
        actionBtnHtml = `
          <button class="btn card-btn-launch btn-launch-app" type="button" title="Launch ${app.name}">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            <span>Launch</span>
          </button>
          <button class="btn card-btn-update btn-update-app" type="button" title="Update to latest version v${app.latest_version}">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
            <span>Update</span>
          </button>
          <button class="btn icon-only ghost btn-popout-app" type="button" title="Open in new browser tab">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </button>
          <button class="btn icon-only ghost btn-uninstall-app" type="button" title="Uninstall ${app.name} from this PC">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              <line x1="10" y1="11" x2="10" y2="17"/>
              <line x1="14" y1="11" x2="14" y2="17"/>
            </svg>
          </button>
        `;
      } else {
        statusHtml = `
          <span class="card-status-indicator">
            <span class="status-dot installed"></span>
            <span style="color: var(--accent-green);">Ready to Launch</span>
          </span>
        `;
        actionBtnHtml = `
          <button class="btn card-btn-launch btn-launch-app" type="button" title="Launch ${app.name} inside workbench">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            <span>Launch ${app.name}</span>
          </button>
          <button class="btn icon-only ghost btn-popout-app" type="button" title="Open in new browser tab">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </button>
          <button class="btn icon-only ghost btn-uninstall-app" type="button" title="Uninstall ${app.name} from this PC">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              <line x1="10" y1="11" x2="10" y2="17"/>
              <line x1="14" y1="11" x2="14" y2="17"/>
            </svg>
          </button>
        `;
      }
    } else {
      statusHtml = `
        <span class="card-status-indicator">
          <span class="status-dot"></span>
          <span>Not Installed</span>
        </span>
      `;
      actionBtnHtml = `
        <button class="btn card-btn-install btn-install-app" type="button" title="Download and install ${app.name}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          <span>Install (~${app.size_mb || 10} MB)</span>
        </button>
      `;
    }

    return `
      <div class="app-card" id="card-${app.id}">
        <div class="card-top">
          <img class="app-card-icon" src="${app.icon_url}" alt="${app.name} Icon" loading="lazy" />
          <div class="card-title-col">
            <div class="card-name-row">
              <span class="card-app-name" title="${app.name}">${app.name}</span>
              <span class="card-ver-tag">v${app.installed_version || app.version}</span>
            </div>
            <span class="card-tagline" title="${app.tagline}">${app.tagline}</span>
          </div>
        </div>

        <span class="card-category-badge">${app.category}</span>
        <p class="card-desc" title="${app.description}">${app.description}</p>

        <div class="card-meta-row">
          ${statusHtml}
          <span>Rust / WASM</span>
        </div>

        <div class="card-source-row">
          <div class="card-source-left" title="Git Commit: ${app.source && app.source.commit_message ? app.source.commit_message : 'Latest official upstream'}">
            <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
            </svg>
            <a href="${app.source ? app.source.fork_url : `https://github.com/chlin1983/${app.id}`}" target="_blank" rel="noopener" style="color: inherit; text-decoration: underline;" title="View your fork on GitHub">${app.source && app.source.commit ? `commit ${app.source.commit}` : 'Source Cloned'}</a>
          </div>
          <button class="btn-open-source" type="button" title="Open local Rust source directory">Open Source</button>
        </div>

        <div class="card-actions">
          ${actionBtnHtml}
        </div>
      </div>
    `;
  }

  function renderSwitcher() {
    if (!els.wbSwitcher) return;
    const currentVal = els.wbSwitcher.value;
    els.wbSwitcher.innerHTML = state.apps
      .map((a) => {
        const tag = a.installed ? '' : ' (Not Installed)';
        return `<option value="${a.id}">${a.name}${tag}</option>`;
      })
      .join('');
    if (state.activeWorkbenchApp) {
      els.wbSwitcher.value = state.activeWorkbenchApp.id;
    } else if (currentVal) {
      els.wbSwitcher.value = currentVal;
    }
  }

  /* --------------------------------------------------------------------------
     Workbench App Launcher & Runner
     -------------------------------------------------------------------------- */
  function launchApp(appId) {
    const app = state.apps.find((a) => a.id === appId);
    if (!app) return;

    if (!app.installed) {
      installApp(appId, false);
      return;
    }

    state.activeWorkbenchApp = app;

    els.wbAppIcon.src = app.icon_url;
    els.wbAppTitle.textContent = app.name;
    els.wbAppVer.textContent = `v${app.installed_version || app.version}`;
    els.wbAppTagline.textContent = app.tagline;
    els.wbSwitcher.value = app.id;

    // Load iframe
    els.appIframe.src = app.app_url;

    // Switch views
    els.hubView.style.display = 'none';
    els.workbenchView.style.display = 'flex';
  }

  function closeWorkbench() {
    // Reset iframe to stop WASM / rendering / audio loops
    els.appIframe.src = 'about:blank';
    state.activeWorkbenchApp = null;

    els.workbenchView.style.display = 'none';
    els.hubView.style.display = 'block';
  }

  /* --------------------------------------------------------------------------
     Installations & Updates
     -------------------------------------------------------------------------- */
  async function installApp(appId, force = false) {
    try {
      const res = await fetch(`${API_BASE}/install/${appId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchStatus();
      startPolling();
    } catch (err) {
      console.error(`Failed to trigger install for ${appId}:`, err);
      alert(`Could not start installation for ${appId}: ${err.message}`);
    }
  }

  async function uninstallApp(appId) {
    const app = state.apps.find((a) => a.id === appId);
    const name = app ? app.name : appId;
    if (!confirm(`Are you sure you want to uninstall ${name}? This will free up disk space and remove its WebAssembly bundle.`)) {
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/uninstall/${appId}`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      await fetchStatus();
    } catch (err) {
      console.error(`Failed to uninstall ${appId}:`, err);
      alert(`Could not uninstall ${name}: ${err.message}`);
    }
  }

  async function installAll(force = false) {
    try {
      const res = await fetch(`${API_BASE}/install-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchStatus();
      startPolling();
    } catch (err) {
      console.error('Failed to trigger install-all:', err);
      alert(`Could not start batch installation: ${err.message}`);
    }
  }

  async function checkUpdates() {
    try {
      els.btnCheckUpdates.disabled = true;
      els.checkUpdatesText.textContent = 'Checking…';
      await fetch(`${API_BASE}/check-updates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ background: true }),
      });
      await fetchStatus();
      startPolling();
    } catch (err) {
      console.error('Failed to check updates:', err);
    }
  }

  /* --------------------------------------------------------------------------
     Event Listeners
     -------------------------------------------------------------------------- */
  function setupEventListeners() {
    // Theme toggle
    if (els.btnThemeToggle) {
      els.btnThemeToggle.addEventListener('click', toggleTheme);
    }

    // Category pills
    els.categoryPills.addEventListener('click', (e) => {
      const pill = e.target.closest('.pill');
      if (!pill) return;
      els.categoryPills.querySelectorAll('.pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      state.selectedCategory = pill.dataset.category || 'all';
      renderGrid();
    });

    // Search
    els.searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      renderGrid();
    });

    // Check updates
    if (els.btnCheckUpdates) {
      els.btnCheckUpdates.addEventListener('click', checkUpdates);
    }

    // Install all / Update all
    els.btnInstallAll.addEventListener('click', () => {
      const hasUpdates = state.updatesAvailableCount > 0;
      installAll(hasUpdates);
    });

    // Refresh
    els.btnRefresh.addEventListener('click', () => {
      fetchStatus();
    });

    // Workbench Back button
    els.wbBtnBack.addEventListener('click', closeWorkbench);

    // Workbench Switcher dropdown
    els.wbSwitcher.addEventListener('change', (e) => {
      const targetId = e.target.value;
      if (targetId && targetId !== (state.activeWorkbenchApp && state.activeWorkbenchApp.id)) {
        launchApp(targetId);
      }
    });

    // Workbench Pop Out button
    els.wbBtnOpenTab.addEventListener('click', () => {
      if (state.activeWorkbenchApp) {
        window.open(state.activeWorkbenchApp.app_url, '_blank', 'noopener,noreferrer');
      }
    });

    // Workbench Fullscreen toggle
    els.wbBtnFullscreen.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        els.workbenchView.requestFullscreen().catch((err) => {
          console.warn('Fullscreen request failed:', err);
        });
      } else {
        document.exitFullscreen().catch((err) => {
          console.warn('Exit fullscreen failed:', err);
        });
      }
    });
  }

  // Initialize
  initTheme();
  setupEventListeners();
  fetchStatus();
})();
