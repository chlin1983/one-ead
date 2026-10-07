/**
 * Component Database Frontend Logic
 * Modern, responsive, high-legibility interface with interactive comparison dock and dual views.
 */

const API_BASE = '/api/component_database';

const state = {
  activeTab: 'catalog',
  activeCategory: 'all',
  searchQuery: '',
  viewMode: 'grid', // 'grid' | 'table'
  components: [],
  schemas: {},
  pinnedIds: new Set(),
  knownIds: new Set(), // ids already seen by loadComponents(), so new ones can be auto-pinned
  diffOnly: false,
  bestInClass: true,
  availableDatasheets: [],
  stagedItems: [],
  currentInspectorPdfBaseUrl: '',
  currentInspectorPdfZoom: 'FitH',
  stagingSearchQuery: '',
  stagingFilterCategory: 'all',
  collapsedGroups: new Set(),
  commitMode: 'create', // 'create' | 'update'
  commitTargetId: '',
  comparePdfMode: false,
  stagingPanelHidden: false,
};

// ── DOM References ────────────────────────────────────────────────────────────
const els = {
  // Navigation & Tabs
  tabs: document.querySelectorAll('.segment-tab'),
  panels: document.querySelectorAll('.tab-panel'),
  filterBar: document.getElementById('catalog-filter-bar'),
  categoryPills: document.querySelectorAll('.filter-pill'),
  searchWrap: document.querySelector('.modern-search'),
  search: document.getElementById('catalog-search'),
  clearSearchBtn: document.getElementById('btn-clear-search'),
  statusResultsCount: document.getElementById('status-results-count'),
  btnPinAll: document.getElementById('btn-pin-all'),

  // View mode toggles
  btnModeGrid: document.getElementById('btn-mode-grid'),
  btnModeTable: document.getElementById('btn-mode-table'),
  cardsContainer: document.getElementById('cards-container'),
  tableContainer: document.getElementById('catalog-table-container'),
  tableTbody: document.getElementById('catalog-table-tbody'),

  // Badges & Counters
  badgeTotalParts: document.getElementById('badge-total-parts'),
  badgePinnedParts: document.getElementById('badge-pinned-parts'),
  catCountAll: document.getElementById('cat-count-all'),
  catCountMic: document.getElementById('cat-count-mic'),
  catCountRec: document.getElementById('cat-count-rec'),
  catCountTel: document.getElementById('cat-count-tel'),

  // Matrix Elements
  pinnedTags: document.getElementById('matrix-pinned-tags'),
  switchDiffOnly: document.getElementById('switch-diff-only'),
  switchBestInClass: document.getElementById('switch-best-in-class'),
  matrixScrollPane: document.getElementById('matrix-scroll-pane'),
  btnExportCsv: document.getElementById('btn-export-csv'),

  // Inspector Elements
  selectPdf: document.getElementById('select-inspector-pdf'),
  pdfFrame: document.getElementById('inspector-pdf-frame'),
  pdfEmptyHero: document.getElementById('pdf-empty-hero'),
  btnLoadSampleMm60: document.getElementById('btn-load-sample-mm60'),
  btnReRunExtract: document.getElementById('btn-re-run-extract'),
  btnCommitDb: document.getElementById('btn-commit-database'),

  // Inspector: side-by-side PDF compare
  btnComparePdf: document.getElementById('btn-compare-pdf'),
  pdfCompareWorkspace: document.getElementById('pdf-compare-workspace'),
  pdfColumnCompare: document.getElementById('pdf-column-compare'),
  pdfCompareResizer: document.getElementById('pdf-compare-resizer'),
  selectPdfCompare: document.getElementById('select-inspector-pdf-compare'),
  pdfFrameCompare: document.getElementById('inspector-pdf-frame-compare'),
  pdfEmptyHeroCompare: document.getElementById('pdf-empty-hero-compare'),
  btnCloseCompare: document.getElementById('btn-close-compare'),
  btnToggleStaging: document.getElementById('btn-toggle-staging'),
  btnToggleStagingLabel: document.getElementById('btn-toggle-staging-label'),

  badgeStagedCount: document.getElementById('badge-staged-count'),
  badgeStagedMatched: document.getElementById('badge-staged-matched'),
  badgeStagedReview: document.getElementById('badge-staged-review'),
  stagingSectionsContainer: document.getElementById('staging-sections-container'),
  stagingSearch: document.getElementById('staging-search'),
  btnClearStagingSearch: document.getElementById('btn-clear-staging-search'),
  filterCntAll: document.getElementById('filter-cnt-all'),
  filterCntAcoustic: document.getElementById('filter-cnt-acoustic'),
  filterCntElectrical: document.getElementById('filter-cnt-electrical'),
  filterCntMechanical: document.getElementById('filter-cnt-mechanical'),
  filterCntReview: document.getElementById('filter-cnt-review'),
  inspectorSplitWorkspace: document.getElementById('inspector-split-workspace'),
  btnPdfPopout: document.getElementById('btn-pdf-popout'),
  btnPdfClearHighlight: document.getElementById('btn-pdf-clear-highlight'),
  commitSuccessNote: document.getElementById('commit-success-note'),
  inputHeaderPdfUpload: document.getElementById('input-header-pdf-upload'),
  selectHeaderUploadCat: document.getElementById('select-header-upload-category'),
  inputStagingPart: document.getElementById('input-staging-part'),
  inputStagingMfr: document.getElementById('input-staging-mfr'),
  selectStagingCat: document.getElementById('select-staging-category'),
  inputStagingPkg: document.getElementById('input-staging-package'),
  btnModeCreate: document.getElementById('btn-mode-create'),
  btnModeUpdate: document.getElementById('btn-mode-update'),
  commitTargetItem: document.getElementById('commit-target-item'),
  selectUpdateTarget: document.getElementById('select-update-target'),

  // Modal Elements
  modal: document.getElementById('specs-modal'),
  btnModalClose: document.getElementById('btn-modal-close'),
  modalTitlePart: document.getElementById('modal-title-part'),
  modalTagMfr: document.getElementById('modal-tag-mfr'),
  modalTagCat: document.getElementById('modal-tag-cat'),
  modalSpecsContent: document.getElementById('modal-specs-content'),

  // Toast
  toast: document.getElementById('app-toast'),
};

// ── Application Initialization ───────────────────────────────────────────────
async function init() {
  bindEvents();
  await loadSchemas();
  await loadDatasheets();
  await loadComponents();
  updateCounters();
  renderCatalog();
}

// ── Event Binding ────────────────────────────────────────────────────────────
function bindEvents() {
  // Navigation Tabs
  els.tabs.forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Category Filtering
  els.categoryPills.forEach(pill => {
    pill.addEventListener('click', () => {
      els.categoryPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.activeCategory = pill.dataset.category;
      updateCounters();
      renderCatalog();
    });
  });

  // Search Input
  els.search.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.trim().toLowerCase();
    els.clearSearchBtn.hidden = !state.searchQuery;
    renderCatalog();
  });

  els.clearSearchBtn.addEventListener('click', () => {
    els.search.value = '';
    state.searchQuery = '';
    els.clearSearchBtn.hidden = true;
    renderCatalog();
  });

  if (els.btnPinAll) {
    els.btnPinAll.addEventListener('click', togglePinAll);
  }

  // View Mode: Grid vs Table
  els.btnModeGrid.addEventListener('click', () => {
    state.viewMode = 'grid';
    els.btnModeGrid.classList.add('active');
    els.btnModeTable.classList.remove('active');
    els.cardsContainer.hidden = false;
    els.tableContainer.hidden = true;
  });

  els.btnModeTable.addEventListener('click', () => {
    state.viewMode = 'table';
    els.btnModeTable.classList.add('active');
    els.btnModeGrid.classList.remove('active');
    els.cardsContainer.hidden = true;
    els.tableContainer.hidden = false;
  });

  // Matrix Switches
  els.switchDiffOnly.addEventListener('change', (e) => {
    state.diffOnly = e.target.checked;
    renderMatrix();
  });

  els.switchBestInClass.addEventListener('change', (e) => {
    state.bestInClass = e.target.checked;
    renderMatrix();
  });

  // Matrix Export
  els.btnExportCsv.addEventListener('click', exportCsv);

  // Inspector
  els.selectPdf.addEventListener('change', (e) => {
    if (e.target.value) openDatasheetInInspector(e.target.value);
  });

  els.btnLoadSampleMm60.addEventListener('click', () => {
    const opt = Array.from(els.selectPdf.options).find(o => o.value.includes('MM60'));
    if (opt) {
      els.selectPdf.value = opt.value;
      openDatasheetInInspector(opt.value);
    }
  });

  els.btnReRunExtract.addEventListener('click', () => {
    if (els.selectPdf.value) openDatasheetInInspector(els.selectPdf.value);
  });

  // Compare: load a second datasheet PDF side by side with the source document
  if (els.btnComparePdf) {
    els.btnComparePdf.addEventListener('click', toggleComparePdf);
  }
  if (els.selectPdfCompare) {
    els.selectPdfCompare.addEventListener('change', (e) => {
      if (e.target.value) openDatasheetInCompare(e.target.value);
    });
  }
  if (els.btnCloseCompare) {
    els.btnCloseCompare.addEventListener('click', () => {
      if (state.comparePdfMode) toggleComparePdf();
    });
  }
  if (els.btnToggleStaging) {
    els.btnToggleStaging.addEventListener('click', () => setStagingPanelHidden(!state.stagingPanelHidden));
  }

  els.btnCommitDb.addEventListener('click', commitStaging);
  if (els.inputHeaderPdfUpload) {
    els.inputHeaderPdfUpload.addEventListener('change', (e) => {
      handleUpload(e, els.selectHeaderUploadCat ? els.selectHeaderUploadCat.value : 'microphone');
    });
  }

  // Commit Mode: Create New vs Update Existing
  if (els.btnModeCreate) {
    els.btnModeCreate.addEventListener('click', () => setCommitMode('create'));
  }
  if (els.btnModeUpdate) {
    els.btnModeUpdate.addEventListener('click', () => setCommitMode('update'));
  }
  if (els.selectUpdateTarget) {
    els.selectUpdateTarget.addEventListener('change', (e) => {
      state.commitTargetId = e.target.value;
    });
  }

  // Staging Filter & Search
  if (els.stagingSearch) {
    els.stagingSearch.addEventListener('input', (e) => {
      state.stagingSearchQuery = e.target.value.trim().toLowerCase();
      if (els.btnClearStagingSearch) els.btnClearStagingSearch.hidden = !state.stagingSearchQuery;
      renderStagingTable();
    });
  }

  if (els.btnClearStagingSearch) {
    els.btnClearStagingSearch.addEventListener('click', () => {
      if (els.stagingSearch) els.stagingSearch.value = '';
      state.stagingSearchQuery = '';
      els.btnClearStagingSearch.hidden = true;
      renderStagingTable();
    });
  }

  document.querySelectorAll('.staging-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.staging-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.stagingFilterCategory = pill.dataset.filter;
      renderStagingTable();
    });
  });

  // Modal Close
  els.btnModalClose.addEventListener('click', () => { els.modal.hidden = true; });
  els.modal.addEventListener('click', (e) => {
    if (e.target === els.modal) els.modal.hidden = true;
  });

  // Matrix Side-by-side PDF Close
  const btnCloseMatrixPdf = document.getElementById('btn-close-matrix-pdf');
  if (btnCloseMatrixPdf) {
    btnCloseMatrixPdf.addEventListener('click', () => { closeMatrixPdf(); });
  }

  // Initialize Draggable Splitters
  initMatrixResizer();
  initInspectorResizer();
  initCompareResizer();
}

// ── Tab Navigation ───────────────────────────────────────────────────────────
function switchTab(tabId) {
  state.activeTab = tabId;
  updateCounters();

  if (tabId !== 'matrix') {
    closeMatrixPdf();
  }

  els.tabs.forEach(t => {
    const isActive = t.dataset.tab === tabId;
    t.classList.toggle('active', isActive);
    t.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  els.panels.forEach(p => {
    p.classList.toggle('active', p.id === `panel-${tabId}`);
  });

  // Only show catalog filter sub-bar, Pin All button, and part search on the Catalog view -
  // Matrix/Inspector have their own dedicated search/filter controls, so this one did nothing
  // (just looked broken/dead) when left visible on those tabs.
  els.filterBar.style.display = (tabId === 'catalog') ? 'flex' : 'none';
  if (els.btnPinAll) els.btnPinAll.hidden = (tabId !== 'catalog');
  if (els.searchWrap) els.searchWrap.hidden = (tabId !== 'catalog');

  if (tabId === 'catalog') {
    renderCatalog();
  } else if (tabId === 'matrix') {
    renderMatrix();
  }
}

// ── Data Loading ─────────────────────────────────────────────────────────────
async function loadSchemas() {
  try {
    const res = await fetch(`${API_BASE}/schemas`);
    state.schemas = await res.json();
  } catch (e) {
    console.error('Schema error:', e);
  }
}

async function loadDatasheets() {
  try {
    const res = await fetch(`${API_BASE}/available-datasheets`);
    state.availableDatasheets = await res.json();
    populatePdfSelect();
  } catch (e) {
    console.error('Datasheet error:', e);
  }
}

function populatePdfSelect() {
  els.selectPdf.innerHTML = '<option value="">Select a datasheet...</option>';
  if (els.selectPdfCompare) {
    els.selectPdfCompare.innerHTML = '<option value="">Select a datasheet...</option>';
  }
  state.availableDatasheets.forEach(ds => {
    const val = JSON.stringify({ category: ds.category, filename: ds.filename, url: ds.relative_url });
    const label = `${ds.filename} (${ds.category})`;
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = label;
    els.selectPdf.appendChild(opt);
    if (els.selectPdfCompare) {
      const opt2 = document.createElement('option');
      opt2.value = val;
      opt2.textContent = label;
      els.selectPdfCompare.appendChild(opt2);
    }
  });
}

// Clear the Inspector back to its empty state (e.g. after its loaded datasheet was deleted).
function resetInspector() {
  els.selectPdf.value = '';
  els.pdfFrame.src = '';
  els.pdfEmptyHero.hidden = false;
  if (els.btnPdfPopout) els.btnPdfPopout.hidden = true;
  if (els.btnPdfClearHighlight) els.btnPdfClearHighlight.hidden = true;
  els.btnReRunExtract.disabled = true;
  els.btnCommitDb.disabled = true;
  state.currentInspectorPdfBaseUrl = '';
  state.stagedItems = [];
  els.inputStagingPart.value = '';
  els.inputStagingMfr.value = '';
  els.inputStagingPkg.value = '';
  setCommitMode('create');
  renderStagingTable();
}

async function loadComponents() {
  try {
    const res = await fetch(`${API_BASE}/components`);
    state.components = await res.json();
    const currentIds = new Set(state.components.map(c => c.id));

    // Default every newly-seen component (including all of them on first load) to pinned.
    for (const id of currentIds) {
      if (!state.knownIds.has(id)) {
        state.pinnedIds.add(id);
      }
    }
    state.knownIds = currentIds;

    // Auto-Sync: remove any pinned IDs that were removed from the catalog
    for (const pid of Array.from(state.pinnedIds)) {
      if (!currentIds.has(pid)) {
        state.pinnedIds.delete(pid);
      }
    }
    populateUpdateTargetSelect();
  } catch (e) {
    console.error('Components error:', e);
  }
}

// ── Commit Mode: Create New vs Update Existing ───────────────────────────────
function setCommitMode(mode) {
  state.commitMode = mode;
  if (els.btnModeCreate) els.btnModeCreate.classList.toggle('active', mode === 'create');
  if (els.btnModeUpdate) els.btnModeUpdate.classList.toggle('active', mode === 'update');
  if (els.commitTargetItem) els.commitTargetItem.hidden = mode !== 'update';
  if (mode !== 'update') {
    state.commitTargetId = '';
    if (els.selectUpdateTarget) els.selectUpdateTarget.value = '';
  }
}

function populateUpdateTargetSelect() {
  if (!els.selectUpdateTarget) return;
  const prevValue = els.selectUpdateTarget.value;
  els.selectUpdateTarget.innerHTML = '<option value="">Select existing component...</option>';
  state.components
    .slice()
    .sort((a, b) => a.part_number.localeCompare(b.part_number))
    .forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.part_number} — ${c.manufacturer} (${c.category_id})`;
      els.selectUpdateTarget.appendChild(opt);
    });
  if (prevValue && state.components.some(c => c.id === prevValue)) {
    els.selectUpdateTarget.value = prevValue;
  }
}

// Suggest "update existing" when a staged Part Number already matches a catalog entry exactly.
function detectExistingMatch(partNumber) {
  const norm = (s) => (s || '').trim().toLowerCase();
  const match = state.components.find(c => norm(c.part_number) === norm(partNumber));
  if (match) {
    setCommitMode('update');
    state.commitTargetId = match.id;
    if (els.selectUpdateTarget) els.selectUpdateTarget.value = match.id;
  } else {
    setCommitMode('create');
  }
}

function updateCounters() {
  const total = state.components.length;
  const pinned = getMatrixPinnedIds().length;
  const mics = state.components.filter(c => c.category_id === 'microphone').length;
  const recs = state.components.filter(c => c.category_id === 'receiver').length;
  const tels = state.components.filter(c => c.category_id === 'telecoil').length;

  els.badgeTotalParts.textContent = total;
  els.badgePinnedParts.textContent = pinned;
  els.catCountAll.textContent = total;
  els.catCountMic.textContent = mics;
  els.catCountRec.textContent = recs;
  els.catCountTel.textContent = tels;
  updatePinAllButton();
}

function getMatrixPinnedIds() {
  return Array.from(state.pinnedIds).filter(id => {
    const component = state.components.find(c => c.id === id);
    return component && (state.activeCategory === 'all' || component.category_id === state.activeCategory);
  });
}

// ── View 1: Catalog Rendering ────────────────────────────────────────────────

// Pulls the "dB re 1V / 1 Pa" / "dB re 1V / 0.1 Pa" reference pressure verbatim from the
// spec's stored condition text (as extracted from that part's own datasheet).
function extractSensitivityRef(condition) {
  if (!condition) return '';
  const m = condition.match(/dB\s*re\s*1\s*V\s*\/\s*[\d.]*\s*Pa/i);
  if (m) return m[0].replace(/\s+/g, ' ').trim();
  return condition.split(',')[0].trim();
}

function renderCatalog() {
  const filtered = state.components.filter(c => {
    if (state.activeCategory !== 'all' && c.category_id !== state.activeCategory) return false;
    if (state.searchQuery) {
      const q = state.searchQuery;
      const haystack = `${c.part_number} ${c.manufacturer} ${c.description} ${c.tags}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  els.statusResultsCount.textContent = `${filtered.length} components listed`;

  if (filtered.length === 0) {
    els.cardsContainer.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 60px 20px; text-align: center; color: var(--text-muted);">
        <h3 style="font-size: 18px; margin-bottom: 8px;">No components match your search query</h3>
        <p>Try clearing filters or searching for Knowles, Sonion, or part numbers.</p>
      </div>
    `;
    els.tableTbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 40px;">No components found.</td></tr>';
    return;
  }

  // 1. Render Cards Grid
  els.cardsContainer.innerHTML = filtered.map(comp => {
    const isPinned = state.pinnedIds.has(comp.id);
    const mfrClass = comp.manufacturer.toLowerCase().includes('knowles') ? 'knowles' : 'sonion';
    const keySpecs = comp.key_specs || {};

    let specsHtml = '';
    if (comp.category_id === 'microphone') {
      const snr = keySpecs.snr ? `${keySpecs.snr.nom_val || keySpecs.snr.min_val} dBA` : '--';
      const vdd = keySpecs.supply_voltage ? `${keySpecs.supply_voltage.nom_val || '0.9'} V` : '--';
      const sens = keySpecs.sensitivity_1k ? `${keySpecs.sensitivity_1k.nom_val} dBV` : '--';
      const sensRef = keySpecs.sensitivity_1k ? extractSensitivityRef(keySpecs.sensitivity_1k.condition) : '';
      const aop = keySpecs.aop ? `${keySpecs.aop.nom_val} dB SPL` : '--';

      specsHtml = `
        <div class="spec-cell"><span class="spec-label">SNR (A-weighted)</span><span class="spec-value">${snr}</span></div>
        <div class="spec-cell"><span class="spec-label">Supply Voltage</span><span class="spec-value">${vdd}</span></div>
        <div class="spec-cell"><span class="spec-label">Sensitivity @ 1kHz</span><span class="spec-value">${sens}</span>${sensRef ? `<span class="spec-ref" title="Reference condition, per datasheet">${escapeHtml(sensRef)}</span>` : ''}</div>
        <div class="spec-cell"><span class="spec-label">AOP (10% THD)</span><span class="spec-value">${aop}</span></div>
      `;
    } else {
      const sens = keySpecs.sensitivity_spl ? `${keySpecs.sensitivity_spl.nom_val} dB` : '--';
      const z = keySpecs.nominal_impedance ? `${keySpecs.nominal_impedance.nom_val} Ω` : '--';
      specsHtml = `
        <div class="spec-cell"><span class="spec-label">Sensitivity SPL</span><span class="spec-value">${sens}</span></div>
        <div class="spec-cell"><span class="spec-label">Nominal Impedance</span><span class="spec-value">${z}</span></div>
      `;
    }

    return `
      <article class="component-card ${isPinned ? 'pinned' : ''}" data-id="${comp.id}">
        <div class="card-top">
          <div class="card-title-box">
            <h3 class="card-part-num">${escapeHtml(comp.part_number)}</h3>
            <div class="card-tags">
              <span class="tag-mfr ${mfrClass}">${escapeHtml(comp.manufacturer)}</span>
              <span class="tag-category">${escapeHtml(comp.category_id)}</span>
              <button type="button" class="tag-verified-toggle ${comp.verified ? 'is-verified' : ''}" onclick="toggleVerified('${comp.id}', ${!comp.verified})" title="Click to mark as ${comp.verified ? 'unverified' : 'verified'}">
                ${comp.verified ? '✓ Verified' : 'Unverified'}
              </button>
            </div>
          </div>
          <label class="card-pin-checkbox" title="Pin component to Comparison Matrix">
            <input type="checkbox" ${isPinned ? 'checked' : ''} onchange="togglePin('${comp.id}')" />
            <span>Pin</span>
          </label>
        </div>

        <p class="card-description">${escapeHtml(comp.description || 'Parametric component datasheet profile.')}</p>

        <div class="specs-callout-grid">
          ${specsHtml}
        </div>

        <div class="card-footer">
          <button class="btn-card-pin ${isPinned ? 'is-pinned' : ''}" onclick="togglePin('${comp.id}')">
            ${isPinned ? '✓ Pinned to Matrix' : '+ Pin to Compare'}
          </button>
          <div class="card-action-links">
            ${comp.datasheet_filename ? `
            <button class="link-btn" onclick="openDatasheetForComponent('${comp.id}')" title="Inspect datasheet PDF (${escapeHtml(comp.datasheet_filename)})">
              Datasheet ↗
            </button>` : ''}
            <button class="link-btn link-danger icon-only" onclick="deleteComponent('${comp.id}')" title="Permanently delete this component, its database record, and its PDF">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            </button>
          </div>
        </div>
      </article>
    `;
  }).join('');

  // 2. Render Table View
  els.tableTbody.innerHTML = filtered.map(comp => {
    const isPinned = state.pinnedIds.has(comp.id);
    const keySpecs = comp.key_specs || {};
    let primarySpecText = '--';
    if (comp.category_id === 'microphone' && keySpecs.snr) {
      primarySpecText = `SNR: ${keySpecs.snr.nom_val} dBA | Sens: ${keySpecs.sensitivity_1k?.nom_val || '--'} dBV`;
    } else if (keySpecs.sensitivity_spl) {
      primarySpecText = `Sens: ${keySpecs.sensitivity_spl.nom_val} dB | Z: ${keySpecs.nominal_impedance?.nom_val || '--'} Ω`;
    }

    return `
      <tr>
        <td>
          <input type="checkbox" ${isPinned ? 'checked' : ''} onchange="togglePin('${comp.id}')" />
        </td>
        <td style="font-weight: 700; color: var(--primary); font-size: 14.5px;">${escapeHtml(comp.part_number)}</td>
        <td>
          <span class="tag-mfr ${comp.manufacturer.toLowerCase().includes('knowles') ? 'knowles' : 'sonion'}">${escapeHtml(comp.manufacturer)}</span>
          <button type="button" class="tag-verified-toggle ${comp.verified ? 'is-verified' : ''}" onclick="toggleVerified('${comp.id}', ${!comp.verified})" title="Click to mark as ${comp.verified ? 'unverified' : 'verified'}">
            ${comp.verified ? '✓ Verified' : 'Unverified'}
          </button>
        </td>
        <td>${escapeHtml(comp.category_id)}</td>
        <td style="font-family: var(--font-mono); font-weight: 600;">${escapeHtml(primarySpecText)}</td>
        <td>${escapeHtml(comp.package_type || 'Standard')}</td>
        <td>
          ${comp.datasheet_filename ? `<button class="link-btn" onclick="openDatasheetForComponent('${comp.id}')">PDF ↗</button>` : '<span style="color: var(--text-faint);">None</span>'}
        </td>
        <td style="text-align: right;">
          <button class="action-btn action-btn-danger icon-only" onclick="deleteComponent('${comp.id}')" title="Permanently delete this component, its database record, and its PDF">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

window.togglePin = function(id) {
  if (state.pinnedIds.has(id)) {
    state.pinnedIds.delete(id);
    showToast('Removed part from comparison');
  } else {
    state.pinnedIds.add(id);
    showToast('Pinned part to comparison matrix');
  }
  updateCounters();
  renderCatalog();
};

window.toggleVerified = async function(id, newVal) {
  try {
    const res = await fetch(`${API_BASE}/components/${id}/verified`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verified: newVal })
    });
    if (res.ok) {
      const comp = state.components.find(c => c.id === id);
      if (comp) comp.verified = newVal;
      renderCatalog();
      showToast(newVal ? 'Marked as verified' : 'Marked as unverified');
    } else {
      showToast('Failed to update verified status');
    }
  } catch (err) {
    console.error(err);
    showToast('Failed to update verified status');
  }
};

function updatePinAllButton() {
  if (!els.btnPinAll) return;
  const allPinned = state.components.length > 0 && state.components.every(c => state.pinnedIds.has(c.id));
  els.btnPinAll.textContent = allPinned ? '📌 Unpin All' : '📌 Pin All';
  els.btnPinAll.classList.toggle('active', allPinned);
}

window.togglePinAll = function() {
  const allPinned = state.components.length > 0 && state.components.every(c => state.pinnedIds.has(c.id));
  if (allPinned) {
    state.pinnedIds.clear();
    showToast('Unpinned all components from comparison');
  } else {
    state.pinnedIds = new Set(state.components.map(c => c.id));
    showToast('Pinned all components to comparison matrix');
  }
  updateCounters();
  renderCatalog();
};

window.deleteComponent = async function(id) {
  const comp = state.components.find(c => c.id === id);
  if (!comp) return;

  const warning = `Permanently delete "${comp.part_number}" (${comp.manufacturer})?\n\n` +
    `This will remove:\n` +
    `• The catalog database record\n` +
    `• Its datasheet PDF file${comp.datasheet_filename ? ` ("${comp.datasheet_filename}")` : ''} from disk\n\n` +
    `This action CANNOT be undone.`;
  if (!confirm(warning)) return;

  try {
    // Capture the Inspector's current selection before loadDatasheets() rebuilds the <select>
    // and implicitly clears it.
    const inspectorDs = els.selectPdf.value ? JSON.parse(els.selectPdf.value) : null;

    const res = await fetch(`${API_BASE}/components/${id}`, { method: 'DELETE' });
    if (res.ok) {
      const result = await res.json();
      state.pinnedIds.delete(id);
      await loadComponents();
      await loadDatasheets(); // refresh Inspector's datasheet dropdown so deleted PDFs disappear from it
      updateCounters();
      renderCatalog();
      if (state.activeTab === 'matrix') renderMatrix();

      // If the Inspector was showing the datasheet we just deleted, reset it.
      if (inspectorDs && inspectorDs.filename === comp.datasheet_filename) {
        resetInspector();
      }

      if (comp.datasheet_filename && !result.file_deleted) {
        showToast(`Removed ${comp.part_number} from the catalog, but its PDF is still in use on disk — close any open PDF preview and try again if it reappears.`);
      } else {
        showToast(`Deleted ${comp.part_number} and its datasheet.`);
      }
    } else {
      showToast('Failed to delete component');
    }
  } catch (err) {
    console.error(err);
    showToast('Failed to delete component');
  }
};

window.openDatasheetForComponent = function(comp_id) {
  const comp = state.components.find(c => c.id === comp_id);
  if (!comp) return;

  switchTab('inspector');
  if (comp.datasheet_filename) {
    const dsObj = {
      category: comp.datasheet_category || comp.category_id,
      filename: comp.datasheet_filename,
      url: `/api/component_database/datasheet-file/${comp.datasheet_category || comp.category_id}/${comp.datasheet_filename}`
    };
    openDatasheetInInspector(JSON.stringify(dsObj));
  } else {
    showToast(`No local PDF attached for ${comp.part_number}. Please choose one from dropdown.`);
  }
};

// ── View 2: Comparison Matrix Rendering ──────────────────────────────────────
async function renderMatrix() {
  const pinnedList = getMatrixPinnedIds();

  // Render Pinned Chips in Header with drag-and-drop support
  els.pinnedTags.innerHTML = pinnedList.map((id, index) => {
    const comp = state.components.find(c => c.id === id);
    const name = comp ? comp.part_number : id;
    return `
      <span class="pinned-tag" draggable="true" data-index="${index}" data-id="${id}" title="Drag to reorder comparison columns">
        <span class="tag-drag-handle" title="Drag to reorder">⋮⋮</span>
        <span class="tag-name">${escapeHtml(name)}</span>
        <button type="button" class="btn-tag-remove" onpointerdown="event.stopPropagation()" onclick="event.preventDefault(); event.stopPropagation(); togglePin('${id}'); renderMatrix();" title="Remove from comparison" aria-label="Remove ${escapeHtml(name)} from comparison">&times;</button>
      </span>
    `;
  }).join('');

  initPinnedTagsDragAndDrop();

  if (pinnedList.length === 0) {
    els.matrixScrollPane.innerHTML = `
      <div style="padding: 80px 20px; text-align: center; color: var(--text-muted); background: var(--surface-card); border-radius: var(--radius-md); border: 1px solid var(--border-light); max-width: 600px; margin: 40px auto;">
        <h3 style="font-size: 20px; font-weight: 700; color: var(--text-main); margin-bottom: 8px;">No Components Pinned for Comparison</h3>
        <p style="margin-bottom: 20px; font-size: 14px;">Select components from the Catalog to compare their parametric specifications side by side.</p>
        <button class="btn-primary-action" onclick="switchTab('catalog')">
          Browse Catalog
        </button>
      </div>
    `;
    return;
  }

  // Load detailed specifications for all pinned parts
  const fullComps = [];
  for (const id of pinnedList) {
    try {
      const res = await fetch(`${API_BASE}/components/${id}`);
      if (res.ok) fullComps.push(await res.json());
    } catch (e) {
      console.error(e);
    }
  }

  if (fullComps.length === 0) return;

  const dominantCat = fullComps[0].category_id || 'microphone';
  const schema = state.schemas[dominantCat] || { groups: [] };

  let tableHtml = `
    <table class="modern-matrix-table">
      <thead>
        <tr>
          <th class="matrix-sticky-param">Specification / Parameter</th>
          ${fullComps.map((c, idx) => `
            <th class="matrix-col-comp" draggable="true" data-index="${idx}" data-id="${c.id}" title="Drag column to reorder">
              <div class="col-part-card">
                <span class="col-drag-indicator" title="Drag to reorder">⋮⋮</span>
                <span class="col-part-number">${escapeHtml(c.part_number)}</span>
                <span class="col-part-meta">${escapeHtml(c.manufacturer)} · ${escapeHtml(c.package_type || 'Standard')}</span>
              </div>
            </th>
          `).join('')}
        </tr>
      </thead>
      <tbody>
  `;

  let visibleCount = 0;

  // Helper to extract canonical spec info for smart consolidation across datasheets
  function getCanonicalSpecInfo(s) {
    if (!s) return { canonKey: '', cleanLabel: '', unit: '' };
    const rawLbl = (s.param_label || s.param_key || '').trim();
    // Strip leading asterisks, bullet points, hyphens, and whitespace
    let cleanLabel = rawLbl.replace(/^[*•\-–\s]+/, '').trim();

    // Check if frequency already in label
    const hasFreq = /\b\d+(?:\.\d+)?\s*(?:k?hz|g?hz)\b/i.test(cleanLabel);
    if (!hasFreq && /(?:octave|noise|vibration|sensitivity|psrr|phase)/i.test(cleanLabel)) {
      const cond = s.condition || '';
      // Check 10 kHz before 1 kHz to avoid partial regex match
      const mFreq = cond.match(/@?\s*(10\s*k?hz|1\s*k?hz|100\s*hz|30\s*hz|250\s*hz)/i);
      if (mFreq) {
        let freqStr = mFreq[1].trim().replace(/(\d+)\s*(k?hz)/i, '$1 $2');
        freqStr = freqStr.replace(/khz/i, 'kHz').replace(/hz/i, 'Hz');
        cleanLabel = `${cleanLabel} ${freqStr}`;
      }
    }

    // Vibration axis/port clarification if needed
    if (/vibration/i.test(cleanLabel) && !/[xyz]\s*axis/i.test(cleanLabel)) {
      const cond = s.condition || '';
      const mAxis = cond.match(/\b([xyz])[- ]?axis\b/i);
      if (mAxis) {
        cleanLabel = `${cleanLabel} ${mAxis[1].toUpperCase()} axis`;
      } else if (/open\s*port/i.test(cond) && !/open\s*port/i.test(cleanLabel)) {
        cleanLabel = `${cleanLabel} (Open Port)`;
      } else if (/blocked\s*port/i.test(cond) && !/blocked\s*port/i.test(cleanLabel)) {
        cleanLabel = `${cleanLabel} (Blocked Port)`;
      }
    }

    // Smart consolidation for 30 Hz sensitivity and Peak sensitivity
    if (/sensitivity/i.test(cleanLabel) || /sensitivity/i.test(s.param_key || '')) {
      const fullSensStr = `${cleanLabel} ${s.param_key || ''} ${s.condition || ''}`.toLowerCase();
      if (fullSensStr.includes('30hz') || fullSensStr.includes('30 hz')) {
        return {
          canonKey: 'sensitivity_30hz',
          cleanLabel: 'Sensitivity @ 30 Hz',
          unit: s.unit || 'dB'
        };
      } else if (fullSensStr.includes('peak')) {
        return {
          canonKey: 'sensitivity_peak',
          cleanLabel: 'Sensitivity Peak 1 kHz',
          unit: s.unit || 'dB'
        };
      }
    }

    // Smart consolidation for Input-Referred Noise 1/3rd Octave across frequency bands
    const isOctaveNoise = /1\/3(?:rd)?\s*octave/i.test(cleanLabel) || /1_3rd_octave/i.test(s.param_key || '');
    if (isOctaveNoise) {
      const fullNoiseStr = `${cleanLabel} ${s.param_key || ''} ${s.condition || ''}`.toLowerCase();
      if (fullNoiseStr.includes('100') && fullNoiseStr.includes('hz')) {
        return {
          canonKey: 'input_referred_noise_1_3rd_octave_100_hz',
          cleanLabel: 'Input-Referred Noise, 1/3rd Octave 100 Hz',
          unit: s.unit || 'dB SPL'
        };
      } else if (fullNoiseStr.includes('10') && (fullNoiseStr.includes('khz') || fullNoiseStr.includes('k hz'))) {
        return {
          canonKey: 'input_referred_noise_1_3rd_octave_10_khz',
          cleanLabel: 'Input-Referred Noise, 1/3rd Octave 10 kHz',
          unit: s.unit || 'dB SPL'
        };
      } else if ((fullNoiseStr.includes('1') || fullNoiseStr.includes('1k')) && (fullNoiseStr.includes('khz') || fullNoiseStr.includes('k hz'))) {
        return {
          canonKey: 'input_referred_noise_1_3rd_octave_1_khz',
          cleanLabel: 'Input-Referred Noise, 1/3rd Octave 1 kHz',
          unit: s.unit || 'dB SPL'
        };
      }
    }

    // Smart consolidation for Input-Referred EMI Noise across frequency bands
    const isEmi = /emi/i.test(cleanLabel) || /emi/i.test(s.param_key || '');
    if (isEmi) {
      const fullEmiStr = `${cleanLabel} ${s.param_key || ''} ${s.condition || ''}`.toLowerCase();
      if (fullEmiStr.includes('0.7') && fullEmiStr.includes('0.96')) {
        return {
          canonKey: 'input_referred_emi_0_7_0_96_ghz',
          cleanLabel: 'Input-Referred EMI Noise 0.7-0.96 GHz',
          unit: s.unit || 'dB SPL'
        };
      } else if (fullEmiStr.includes('1.4') && fullEmiStr.includes('2.0')) {
        return {
          canonKey: 'input_referred_emi_1_4_2_0_ghz',
          cleanLabel: 'Input-Referred EMI Noise 1.4-2.0 GHz',
          unit: s.unit || 'dB SPL'
        };
      } else if (fullEmiStr.includes('2.0') && fullEmiStr.includes('2.7')) {
        return {
          canonKey: 'input_referred_emi_2_0_2_7_ghz',
          cleanLabel: 'Input-Referred EMI Noise 2.0-2.7 GHz',
          unit: s.unit || 'dB SPL'
        };
      }
    }

    // Smart consolidation for Acoustic Port Dimension
    if (/acoustic\s*port|port\s*dimension/i.test(cleanLabel) || /acoustic_port/i.test(s.param_key || '')) {
      return {
        canonKey: 'acoustic_port_dim',
        cleanLabel: 'Acoustic Port Dimension',
        unit: s.unit || 'mm'
      };
    }

    const canonKey = cleanLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return {
      canonKey,
      cleanLabel,
      unit: s.unit || ''
    };
  }

  // Build groups to render: standard schema groups + dynamic extra specs present on compared components
  const schemaKeySet = new Set();
  (schema.groups || []).forEach(g => {
    (g.parameters || []).forEach(p => schemaKeySet.add(p.key));
  });

  const extraSpecsMap = new Map();
  fullComps.forEach(comp => {
    if (comp.specs && Array.isArray(comp.specs)) {
      comp.specs.forEach(s => {
        const canon = getCanonicalSpecInfo(s);
        // Consolidate non-schema specs smartly by canonKey
        if (!schemaKeySet.has(s.param_key) && !schemaKeySet.has(canon.canonKey)) {
          if (!extraSpecsMap.has(canon.canonKey)) {
            extraSpecsMap.set(canon.canonKey, {
              key: canon.canonKey,
              label: canon.cleanLabel,
              unit: canon.unit,
              direction: 'nominal',
              rawKeys: new Set([s.param_key])
            });
          } else {
            const existing = extraSpecsMap.get(canon.canonKey);
            existing.rawKeys.add(s.param_key);
            if (!existing.unit && canon.unit) existing.unit = canon.unit;
            if (canon.cleanLabel.length > existing.label.length) {
              existing.label = canon.cleanLabel;
            }
          }
        }
      });
    }
  });

  const groupsToRender = [...(schema.groups || [])];
  if (extraSpecsMap.size > 0) {
    const extraParams = Array.from(extraSpecsMap.values());
    const emiOrder = [
      'input_referred_emi_0_7_0_96_ghz',
      'input_referred_emi_1_4_2_0_ghz',
      'input_referred_emi_2_0_2_7_ghz'
    ];
    extraParams.sort((a, b) => {
      const idxA = emiOrder.indexOf(a.key);
      const idxB = emiOrder.indexOf(b.key);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return 0;
    });
    groupsToRender.push({
      id: 'additional',
      name: 'Additional Extracted Specifications',
      parameters: extraParams
    });
  }

  groupsToRender.forEach(group => {
    let groupRowsHtml = '';

    group.parameters.forEach(paramDef => {
      const displayLabel = (paramDef.label || paramDef.key || '').replace(/^[*•\-–\s]+/, '').trim();

      const cellValues = fullComps.map(comp => {
        if (!comp.specs || !Array.isArray(comp.specs)) return null;

        // 1. Direct match by exact param_key (matches schema definition or exact extracted key)
        let found = comp.specs.find(s => s.param_key === paramDef.key);

        // 2. Match by canonical key comparison (precise condition/axis/frequency match)
        if (!found) {
          found = comp.specs.find(s => {
            const sCanon = getCanonicalSpecInfo(s);
            return sCanon.canonKey === paramDef.key;
          });
        }

        // 3. Fallback: match by raw key only if rawKeys has it AND spec is not claimed by another canonical key
        if (!found && paramDef.rawKeys) {
          found = comp.specs.find(s => {
            if (!paramDef.rawKeys.has(s.param_key)) return false;
            const sCanon = getCanonicalSpecInfo(s);
            return !sCanon.canonKey || sCanon.canonKey === paramDef.key;
          });
        }

        return found ? {
          min: found.min_val,
          nom: found.nom_val,
          max: found.max_val,
          unit: found.unit || paramDef.unit,
          cond: found.condition,
          page: found.source_page,
          rawLabel: found.param_label || found.param_key || displayLabel,
          paramKey: found.param_key || paramDef.key
        } : null;
      });

      // Helper to check if a value has meaningful data
      const hasValue = (v) => {
        if (!v) return false;
        return [v.nom, v.min, v.max].some(x => x !== null && x !== undefined && String(x).trim() !== '' && String(x).trim() !== '--' && String(x).trim() !== '-');
      };

      // Check if identical across all columns
      const valuesStr = cellValues.map(v => hasValue(v) ? `${v.min}|${v.nom}|${v.max}|${v.unit}` : 'null');
      const isIdentical = valuesStr.every(v => v === valuesStr[0]);

      if (state.diffOnly && isIdentical && fullComps.length > 1) {
        return; // Filter out identical rows
      }

      // Best in class calculation
      let bestIndices = new Set();
      if (state.bestInClass && fullComps.length > 1 && paramDef.direction !== 'nominal') {
        const numericValues = cellValues.map(v => {
          if (!hasValue(v)) return null;
          // Prefer nominal value; fallback to min or max
          const rawStr = (v.nom !== null && v.nom !== undefined && v.nom !== '' && v.nom !== '--') ? v.nom : (v.min || v.max);
          if (rawStr === null || rawStr === undefined || rawStr === '' || rawStr === '--') return null;
          let num = parseFloat(rawStr);
          if (isNaN(num)) return null;

          // Unit normalization if applicable
          const unit = (v.unit || '').trim().toLowerCase();
          if (paramDef.key === 'startup_time' && unit === 's') {
            num *= 1000; // normalize seconds to ms
          }
          return num;
        });

        const validEntries = numericValues
          .map((num, idx) => ({ num, idx }))
          .filter(e => e.num !== null);

        if (validEntries.length > 1) {
          const uniqueVals = new Set(validEntries.map(e => e.num));
          if (uniqueVals.size > 1) {
            const optimalVal = (paramDef.direction === 'highest')
              ? Math.max(...validEntries.map(e => e.num))
              : Math.min(...validEntries.map(e => e.num));

            const winners = validEntries.filter(e => Math.abs(e.num - optimalVal) < 1e-5);
            if (winners.length === 1) {
              bestIndices.add(winners[0].idx);
            }
          }
        }
      }

      visibleCount++;

      // First component that actually HAS this value for row-level click
      const validFirstIdx = cellValues.findIndex(v => hasValue(v));
      const targetComp = validFirstIdx !== -1 ? fullComps[validFirstIdx] : fullComps[0];
      const validFirst = validFirstIdx !== -1 ? cellValues[validFirstIdx] : null;
      const firstPage = validFirst ? (validFirst.page || 1) : 1;
      const firstVal = validFirst ? ((validFirst.nom !== null && validFirst.nom !== undefined && validFirst.nom !== '' && validFirst.nom !== '--') ? validFirst.nom : (validFirst.min || validFirst.max || '')) : '';
      const firstMin = validFirst ? (validFirst.min || '') : '';
      const firstMax = validFirst ? (validFirst.max || '') : '';
      const firstKey = validFirst ? (validFirst.paramKey || paramDef.key) : paramDef.key;
      const firstRaw = validFirst && validFirst.rawLabel ? validFirst.rawLabel : displayLabel;

      groupRowsHtml += `
        <tr>
          <td class="matrix-sticky-param param-clickable" title="Click to view and highlight '${escapeHtml(displayLabel)}' in datasheet" onclick="openMatrixPdf('${escapeHtml(targetComp.id)}', ${firstPage}, '${escapeHtml(firstKey)}', '${escapeHtml(displayLabel)}', '${escapeHtml(firstVal)}', this, '${escapeHtml(firstMin)}', '${escapeHtml(firstMax)}', '${escapeHtml(firstRaw)}')">
            <span class="param-label-text">${escapeHtml(displayLabel)}</span>
            ${paramDef.unit ? `<span class="param-unit-tag">${escapeHtml(paramDef.unit)}</span>` : ''}
          </td>
          ${cellValues.map((val, idx) => {
            const comp = fullComps[idx];
            if (!hasValue(val)) {
              return `<td class="matrix-col-comp cell-empty"><span class="val-na" title="Specification not available in this datasheet">NA</span></td>`;
            }

            const isBest = bestIndices.has(idx);
            // Temperature specs' "Nom" column is just the ambient test condition, not a
            // meaningful typical value - always show the Min~Max operating/storage range.
            const isTempRangeParam = paramDef.key === 'operating_temp' || paramDef.key === 'storage_temp';
            let displayVal = (isTempRangeParam && val.min && val.max)
              ? `${val.min} ~ ${val.max}`
              : (val.nom !== null && val.nom !== undefined && val.nom !== '' && val.nom !== '--') ? val.nom : (val.min && val.max ? `${val.min} ~ ${val.max}` : val.min || val.max || 'NA');
            let rangeSub = '';
            if (!isTempRangeParam && val.min && val.max && val.nom && (val.min !== val.nom || val.max !== val.nom)) {
              rangeSub = `[${val.min} .. ${val.max}]`;
            }
            const cellVal = (val.nom !== null && val.nom !== undefined && val.nom !== '' && val.nom !== '--') ? val.nom : ((val.min !== null && val.min !== undefined && val.min !== '' && val.min !== '--') ? val.min : (val.max || ''));
            const cellMin = val.min || '';
            const cellMax = val.max || '';
            const cellKey = val.paramKey || paramDef.key;
            const cellRaw = val.rawLabel || displayLabel;

            return `
              <td class="matrix-col-comp cell-interactive ${isBest ? 'best-cell-highlight' : ''}" title="Click to view & highlight ${escapeHtml(comp.part_number)} value in datasheet" onclick="openMatrixPdf('${escapeHtml(comp.id)}', ${val.page}, '${escapeHtml(cellKey)}', '${escapeHtml(displayLabel)}', '${escapeHtml(cellVal)}', this, '${escapeHtml(cellMin)}', '${escapeHtml(cellMax)}', '${escapeHtml(cellRaw)}')">
                <div class="cell-inner-wrap" title="${escapeHtml(val.cond || '')}">
                  <div class="metric-val-block">
                    <div class="metric-main-line">
                      <span class="metric-main-val">${escapeHtml(displayVal)}</span>
                      <span class="metric-unit-text">${escapeHtml(val.unit || '')}</span>
                      ${isBest ? '<span class="best-badge-indicator">★ Best</span>' : ''}
                    </div>
                    ${rangeSub ? `<div class="metric-sub-range">${escapeHtml(rangeSub)}</div>` : ''}
                  </div>
                  ${val.page ? `
                    <button class="citation-chip" title="View ${escapeHtml(comp.part_number)} datasheet with yellow highlight" onclick="event.stopPropagation(); openMatrixPdf('${escapeHtml(comp.id)}', ${val.page}, '${escapeHtml(cellKey)}', '${escapeHtml(displayLabel)}', '${escapeHtml(cellVal)}', this.closest('.matrix-col-comp'), '${escapeHtml(cellMin)}', '${escapeHtml(cellMax)}', '${escapeHtml(cellRaw)}')">
                      Page ${val.page} ↗
                    </button>
                  ` : ''}
                </div>
              </td>
            `;
          }).join('')}
        </tr>
      `;
    });

    if (groupRowsHtml) {
      tableHtml += `
        <tr class="matrix-section-divider">
          <td colspan="${fullComps.length + 1}">${escapeHtml(group.name)}</td>
        </tr>
        ${groupRowsHtml}
      `;
    }
  });

  tableHtml += `</tbody></table>`;

  if (visibleCount === 0 && state.diffOnly) {
    els.matrixScrollPane.innerHTML = `
      <div style="padding: 60px 20px; text-align: center; color: var(--text-muted); background: var(--surface-card); border-radius: var(--radius-md);">
        <h3>All parameters are identical across the selected parts!</h3>
        <p style="margin-top: 6px;">Uncheck "Hide Identical Specs" to view all values.</p>
      </div>
    `;
  } else {
    els.matrixScrollPane.innerHTML = tableHtml;
    initMatrixColumnsDragAndDrop();
  }
}

// ── Reorder Pinned Components & Drag-and-Drop Handlers ───────────────────────
function reorderPinned(fromIndex, toIndex) {
  const allPinned = Array.from(state.pinnedIds);
  const visiblePinned = getMatrixPinnedIds();
  if (fromIndex < 0 || fromIndex >= visiblePinned.length || toIndex < 0 || toIndex >= visiblePinned.length) return;
  if (fromIndex === toIndex) return;

  const [moved] = visiblePinned.splice(fromIndex, 1);
  visiblePinned.splice(toIndex, 0, moved);
  const visibleSet = new Set(visiblePinned);
  let visibleIndex = 0;
  state.pinnedIds = new Set(allPinned.map(id => visibleSet.has(id) ? visiblePinned[visibleIndex++] : id));

  renderMatrix();
}

function initPinnedTagsDragAndDrop() {
  const container = els.pinnedTags;
  if (!container) return;

  const tags = container.querySelectorAll('.pinned-tag');
  let draggedIndex = null;

  tags.forEach(tag => {
    tag.addEventListener('dragstart', (e) => {
      if (e.target.closest('.btn-tag-remove')) {
        e.preventDefault();
        return;
      }
      draggedIndex = parseInt(tag.dataset.index, 10);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(draggedIndex));
      setTimeout(() => tag.classList.add('is-dragging'), 0);
    });

    tag.addEventListener('dragend', () => {
      tag.classList.remove('is-dragging');
      tags.forEach(t => t.classList.remove('drag-target-active'));
      draggedIndex = null;
    });

    tag.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const targetIndex = parseInt(tag.dataset.index, 10);
      if (draggedIndex === null || isNaN(targetIndex) || draggedIndex === targetIndex) {
        tag.classList.remove('drag-target-active');
        return;
      }

      tags.forEach(t => {
        if (t !== tag) t.classList.remove('drag-target-active');
      });
      tag.classList.add('drag-target-active');
    });

    tag.addEventListener('dragleave', (e) => {
      if (!tag.contains(e.relatedTarget)) {
        tag.classList.remove('drag-target-active');
      }
    });

    tag.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      tags.forEach(t => t.classList.remove('drag-target-active'));
      if (draggedIndex === null) return;

      const targetIndex = parseInt(tag.dataset.index, 10);
      if (isNaN(targetIndex)) return;

      if (draggedIndex !== targetIndex) {
        reorderPinned(draggedIndex, targetIndex);
      }
      draggedIndex = null;
    });
  });

  // Container drop handler: catches drops between tabs or past the end
  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });

  container.addEventListener('drop', (e) => {
    const targetTag = e.target.closest('.pinned-tag');
    if (targetTag) return; // Handled by tag listener

    e.preventDefault();
    tags.forEach(t => t.classList.remove('drag-target-active'));
    if (draggedIndex === null) return;

    // Find closest tag by horizontal center
    const allTags = Array.from(tags);
    if (allTags.length === 0) return;

    let closestIdx = 0;
    let minDistance = Infinity;
    allTags.forEach(t => {
      const idx = parseInt(t.dataset.index, 10);
      const rect = t.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      const dist = Math.abs(e.clientX - midX);
      if (dist < minDistance) {
        minDistance = dist;
        closestIdx = idx;
      }
    });

    if (draggedIndex !== closestIdx) {
      reorderPinned(draggedIndex, closestIdx);
    }
    draggedIndex = null;
  });
}

function initMatrixColumnsDragAndDrop() {
  const table = els.matrixScrollPane.querySelector('.modern-matrix-table');
  if (!table) return;

  const ths = table.querySelectorAll('th.matrix-col-comp');
  let draggedColIndex = null;

  ths.forEach(th => {
    th.addEventListener('dragstart', (e) => {
      draggedColIndex = parseInt(th.dataset.index, 10);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(draggedColIndex));
      setTimeout(() => th.classList.add('col-is-dragging'), 0);
    });

    th.addEventListener('dragend', () => {
      th.classList.remove('col-is-dragging');
      ths.forEach(t => t.classList.remove('col-drag-target-active'));
      draggedColIndex = null;
    });

    th.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const targetIndex = parseInt(th.dataset.index, 10);
      if (draggedColIndex === null || isNaN(targetIndex) || draggedColIndex === targetIndex) {
        th.classList.remove('col-drag-target-active');
        return;
      }

      ths.forEach(t => {
        if (t !== th) t.classList.remove('col-drag-target-active');
      });
      th.classList.add('col-drag-target-active');
    });

    th.addEventListener('dragleave', (e) => {
      if (!th.contains(e.relatedTarget)) {
        th.classList.remove('col-drag-target-active');
      }
    });

    th.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      ths.forEach(t => t.classList.remove('col-drag-target-active'));
      if (draggedColIndex === null) return;

      const targetIndex = parseInt(th.dataset.index, 10);
      if (isNaN(targetIndex)) return;

      if (draggedColIndex !== targetIndex) {
        reorderPinned(draggedColIndex, targetIndex);
      }
      draggedColIndex = null;
    });
  });
}

// ── Side-by-Side Matrix PDF & Vector Page Viewer (Continuous Multi-Page) ────────
const matrixDocState = {
  comp: null,
  loadedDocKey: null,
  page: 1,
  targetPage: 1,
  totalPages: 1,
  paramKey: null,
  paramLabel: null,
  nominalVal: null,
  minVal: null,
  maxVal: null,
  rawLabel: null,
  highlightRatio: 0,
  zoomPercent: 100, // 100 = Fit Width
  mode: 'vector',   // 'vector' (Fit Width continuous scroll) or 'iframe' (PDF Plugin)
  pageCache: new Map(),
  loadingPages: new Set(),
  scrollListenerAttached: false,
  userHasScrolled: false,
  pageObserver: null,
};

// Smooth & exact target section scroll function (scrolls directly to the highlighted row/section)
function scrollToMatrixTargetSection(targetPage, ratio = null, behavior = 'auto') {
  const wrapper = document.getElementById('matrix-vector-wrapper');
  const targetCard = document.getElementById(`matrix-page-card-${targetPage}`);
  if (!wrapper || !targetCard) return;

  const effectiveRatio = (ratio !== null && ratio !== undefined) ? ratio : (matrixDocState.highlightRatio || 0);
  const wrapperRect = wrapper.getBoundingClientRect();
  const cardRect = targetCard.getBoundingClientRect();

  let targetOffset = 0;
  if (effectiveRatio > 0.02) {
    const highlightYOnCard = cardRect.height * effectiveRatio;
    const viewportOffset = wrapperRect.height * 0.38; // Place highlighted row in upper-middle viewport
    targetOffset = wrapper.scrollTop + (cardRect.top - wrapperRect.top) + highlightYOnCard - viewportOffset;
  } else {
    if (targetPage === 1) {
      wrapper.scrollTo({ top: 0, behavior: behavior });
      return;
    }
    targetOffset = wrapper.scrollTop + (cardRect.top - wrapperRect.top) - 14;
  }

  wrapper.scrollTo({
    top: Math.max(0, targetOffset),
    behavior: behavior,
  });
}

function scrollToMatrixTargetPage(targetPage, behavior = 'auto', ratio = null) {
  scrollToMatrixTargetSection(targetPage, ratio, behavior);
}

// Check which page is currently in view during manual mouse wheel scrolling
function updateActiveMatrixPageBadge() {
  const wrapper = document.getElementById('matrix-vector-wrapper');
  if (!wrapper || !matrixDocState.totalPages || matrixDocState.mode !== 'vector') return;

  const cards = wrapper.querySelectorAll('.matrix-page-card');
  if (!cards.length) return;

  const wrapperRect = wrapper.getBoundingClientRect();
  const targetY = wrapperRect.top + wrapperRect.height * 0.35; // 35% viewport depth

  let activePage = matrixDocState.page || 1;
  let minDiff = Infinity;

  cards.forEach(card => {
    const rect = card.getBoundingClientRect();
    if (rect.top <= targetY && rect.bottom >= targetY) {
      activePage = parseInt(card.dataset.page, 10);
      minDiff = 0;
    } else if (minDiff !== 0) {
      const midY = (rect.top + rect.bottom) / 2;
      const diff = Math.abs(midY - targetY);
      if (diff < minDiff) {
        minDiff = diff;
        activePage = parseInt(card.dataset.page, 10);
      }
    }
  });

  if (activePage && activePage !== matrixDocState.page) {
    matrixDocState.page = activePage;
    const pageBadge = document.getElementById('matrix-pdf-page-badge');
    if (pageBadge) {
      pageBadge.textContent = `Page ${activePage} of ${matrixDocState.totalPages}`;
    }
  }
}

let matrixScrollThrottle = null;
function onMatrixVectorScroll() {
  if (matrixScrollThrottle) return;
  matrixScrollThrottle = setTimeout(() => {
    matrixScrollThrottle = null;
    // Only update badge when the user is actively scrolling manually
    if (matrixDocState.userHasScrolled) {
      updateActiveMatrixPageBadge();
    }
  }, 40);
}

function initScrollListeners(vectorWrapper) {
  if (!vectorWrapper || matrixDocState.scrollListenerAttached) return;
  vectorWrapper.addEventListener('scroll', onMatrixVectorScroll, { passive: true });
  vectorWrapper.addEventListener('wheel', () => { matrixDocState.userHasScrolled = true; }, { passive: true });
  vectorWrapper.addEventListener('touchstart', () => { matrixDocState.userHasScrolled = true; }, { passive: true });
  vectorWrapper.addEventListener('mousedown', () => { matrixDocState.userHasScrolled = true; }, { passive: true });
  matrixDocState.scrollListenerAttached = true;
}

// Scope SVG IDs and references with page-specific prefix (pg{pageNum}_)
// to prevent cross-page clipPath, mask, and defs collisions in browser DOM
function scopeSvgIds(svgText, pageNum) {
  if (!svgText) return '';
  const prefix = `pg${pageNum}_`;
  if (svgText.includes(`id="${prefix}`)) {
    return svgText; // Already scoped by server
  }
  return svgText
    .replace(/\bid="([^"]+)"/g, `id="${prefix}$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${prefix}$1)`)
    .replace(/url\('#([^']+)'\)/g, `url('#${prefix}$1')`)
    .replace(/url\("#([^"]+)"\)/g, `url("#${prefix}$1")`)
    .replace(/href="#([^"]+)"/g, `href="#${prefix}$1"`);
}

// Progressive lazy loader for individual datasheet pages
async function loadMatrixPageSvg(pageNum, highlightParams = null) {
  const comp = matrixDocState.comp;
  if (!comp || !comp.datasheet_filename) return 0;

  // CRITICAL GUARD: Never overwrite the active target page with an unhighlighted clean page!
  const hasActiveHighlight = Boolean(matrixDocState.paramKey || matrixDocState.paramLabel || matrixDocState.nominalVal);
  if (!highlightParams && pageNum === matrixDocState.targetPage && hasActiveHighlight) {
    return matrixDocState.highlightRatio || 0;
  }

  const category = comp.datasheet_category || comp.category_id || 'microphone';
  const holder = document.getElementById(`matrix-page-svg-${pageNum}`);
  if (!holder) return 0;

  const cacheKey = highlightParams
    ? `${comp.id}_p${pageNum}_${highlightParams.get('param') || ''}_${highlightParams.get('val') || ''}_${highlightParams.get('min') || ''}_${highlightParams.get('max') || ''}`
    : `${comp.id}_p${pageNum}_clean`;

  if (matrixDocState.pageCache.has(cacheKey)) {
    const cachedItem = matrixDocState.pageCache.get(cacheKey);
    const cachedSvg = typeof cachedItem === 'string' ? cachedItem : cachedItem.svgText;
    const cachedRatio = typeof cachedItem === 'object' ? cachedItem.ratio : 0;
    holder.innerHTML = cachedSvg;
    if (highlightParams && pageNum === matrixDocState.targetPage) {
      matrixDocState.highlightRatio = cachedRatio;
      scrollToMatrixTargetSection(pageNum, cachedRatio, 'smooth');
    }
    return cachedRatio;
  }

  if (matrixDocState.loadingPages.has(cacheKey)) return 0;
  matrixDocState.loadingPages.add(cacheKey);

  try {
    const params = new URLSearchParams(highlightParams ? highlightParams.toString() : '');
    params.set('page', pageNum);
    if (!highlightParams) {
      params.set('_clean', '1');
    }
    params.set('_t', Date.now());

    const pageUrl = `/api/component_database/datasheet-page/${category}/${encodeURIComponent(comp.datasheet_filename)}?${params.toString()}`;
    const resp = await fetch(pageUrl);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const ratioHeader = parseFloat(resp.headers.get('X-Highlight-Ratio') || '0');
    let pageRatio = (!isNaN(ratioHeader) && ratioHeader > 0) ? ratioHeader : 0;

    const rawSvgText = await resp.text();
    if (!pageRatio && rawSvgText) {
      const match = rawSvgText.match(/data-highlight-ratio=["']([0-9.]+)["']/);
      if (match) pageRatio = parseFloat(match[1]) || 0;
    }

    const svgText = scopeSvgIds(rawSvgText, pageNum);
    matrixDocState.pageCache.set(cacheKey, { svgText, ratio: pageRatio });
    matrixDocState.loadingPages.delete(cacheKey);

    // Re-check guard right before DOM injection to prevent race condition
    if (!highlightParams && pageNum === matrixDocState.targetPage && hasActiveHighlight) {
      return matrixDocState.highlightRatio || 0;
    }

    const currentHolder = document.getElementById(`matrix-page-svg-${pageNum}`);
    if (currentHolder) {
      currentHolder.innerHTML = svgText;
    }

    if (highlightParams && pageNum === matrixDocState.targetPage) {
      matrixDocState.highlightRatio = pageRatio;
      scrollToMatrixTargetSection(pageNum, pageRatio, 'smooth');
    } else if (pageNum < matrixDocState.page && !matrixDocState.userHasScrolled) {
      scrollToMatrixTargetSection(matrixDocState.page, matrixDocState.highlightRatio || 0, 'auto');
    }

    return pageRatio;
  } catch (err) {
    matrixDocState.loadingPages.delete(cacheKey);
    console.warn(`[loadMatrixPageSvg] Failed to load page ${pageNum}:`, err);
    return 0;
  }
}

function loadAllRemainingPages() {
  const total = matrixDocState.totalPages || 1;
  const target = matrixDocState.page || 1;

  // Stagger loading pages: prioritize pages *after* target page first, then earlier pages
  const order = [];
  for (let p = target + 1; p <= total; p++) order.push(p);
  for (let p = target - 1; p >= 1; p--) order.push(p);

  let delay = 35;
  order.forEach(p => {
    setTimeout(() => {
      if (matrixDocState.comp && matrixDocState.mode === 'vector') {
        loadMatrixPageSvg(p);
      }
    }, delay);
    delay += 45;
  });
}

function initPageIntersectionObserver(vectorWrapper) {
  if (matrixDocState.pageObserver) {
    matrixDocState.pageObserver.disconnect();
    matrixDocState.pageObserver = null;
  }
  if (!('IntersectionObserver' in window) || !vectorWrapper) return;

  matrixDocState.pageObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const p = parseInt(entry.target.dataset.page, 10);
        // Only lazy-load non-target pages (target page is already loaded with highlight)
        if (p && p !== matrixDocState.targetPage) {
          loadMatrixPageSvg(p);
        }
      }
    });
  }, {
    root: vectorWrapper,
    rootMargin: '600px 0px 600px 0px',
    threshold: 0.01,
  });

  const cards = vectorWrapper.querySelectorAll('.matrix-page-card');
  cards.forEach(card => matrixDocState.pageObserver.observe(card));
}

async function renderMatrixDocContent(targetPageOverride) {
  const comp = matrixDocState.comp;
  if (!comp || !comp.datasheet_filename) return;

  const category = comp.datasheet_category || comp.category_id || 'microphone';
  const targetPage = targetPageOverride || matrixDocState.page || 1;
  matrixDocState.page = targetPage;
  matrixDocState.targetPage = targetPage;
  const paramKey = matrixDocState.paramKey;
  const paramLabel = matrixDocState.paramLabel;
  const nominalVal = matrixDocState.nominalVal;
  const minVal = matrixDocState.minVal;
  const maxVal = matrixDocState.maxVal;
  const rawLabel = matrixDocState.rawLabel;

  const params = new URLSearchParams();
  if (paramKey) params.set('param', paramKey);
  if (paramLabel) params.set('label', paramLabel);
  if (rawLabel) params.set('raw', rawLabel);
  if (nominalVal !== undefined && nominalVal !== null && nominalVal !== '') {
    params.set('val', nominalVal);
  }
  if (minVal !== undefined && minVal !== null && minVal !== '') {
    params.set('min', minVal);
  }
  if (maxVal !== undefined && maxVal !== null && maxVal !== '') {
    params.set('max', maxVal);
  }
  params.set('page', targetPage);
  params.set('highlight_page', targetPage);
  params.set('_t', Date.now());

  const vectorWrapper = document.getElementById('matrix-vector-wrapper');
  const pdfWrapper = document.getElementById('matrix-pdf-wrapper');
  const svgHost = document.getElementById('matrix-svg-host');
  const pageStage = document.getElementById('matrix-page-stage');
  const pageBadge = document.getElementById('matrix-pdf-page-badge');
  const popoutLink = document.getElementById('matrix-pdf-popout-link');
  const frame = document.getElementById('matrix-pdf-frame');

  const pdfUrl = `/api/component_database/datasheet-file/${category}/${encodeURIComponent(comp.datasheet_filename)}?${params.toString()}#page=${targetPage}&view=FitH`;
  const popoutUrl = `/api/component_database/datasheet-file/${category}/${encodeURIComponent(comp.datasheet_filename)}?${params.toString()}#page=${targetPage}`;

  if (popoutLink) popoutLink.href = popoutUrl;

  if (matrixDocState.mode === 'vector') {
    if (vectorWrapper) vectorWrapper.style.display = 'flex';
    if (pdfWrapper) pdfWrapper.style.display = 'none';

    initScrollListeners(vectorWrapper);

    const docKey = `${comp.id}::${comp.datasheet_filename}`;

    // Case 1: Same document is already built in DOM
    if (matrixDocState.loadedDocKey === docKey && document.getElementById(`matrix-page-card-${targetPage}`)) {
      document.querySelectorAll('.matrix-page-card').forEach(c => c.classList.remove('is-target-highlight'));
      const targetCard = document.getElementById(`matrix-page-card-${targetPage}`);
      if (targetCard) {
        targetCard.classList.add('is-target-highlight');
      }

      // If switching to a different page, clean up old highlight on previous page
      if (matrixDocState.prevHighlightedPage && matrixDocState.prevHighlightedPage !== targetPage) {
        loadMatrixPageSvg(matrixDocState.prevHighlightedPage, null);
      }
      matrixDocState.prevHighlightedPage = targetPage;

      // Fetch fresh highlighted SVG for this target page
      const pageRatio = await loadMatrixPageSvg(targetPage, params);

      if (pageBadge) {
        pageBadge.textContent = `Page ${targetPage} of ${matrixDocState.totalPages}`;
      }

      // Smoothly scroll the container to the target section
      scrollToMatrixTargetSection(targetPage, pageRatio || matrixDocState.highlightRatio || 0, 'smooth');
      return;
    }

    // Case 2: New document — render initial loading & fetch target page
    if (svgHost) {
      svgHost.innerHTML = '<div class="matrix-doc-loading"><div class="matrix-mini-spinner" style="margin: 0 auto 12px;"></div>Rendering high-definition continuous datasheet...</div>';
    }

    try {
      const pageUrl = `/api/component_database/datasheet-page/${category}/${encodeURIComponent(comp.datasheet_filename)}?${params.toString()}`;
      const resp = await fetch(pageUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const totalPages = parseInt(resp.headers.get('X-Total-Pages') || '1', 10);
      matrixDocState.totalPages = isNaN(totalPages) ? 1 : totalPages;
      if (pageBadge) {
        pageBadge.textContent = `Page ${targetPage} of ${matrixDocState.totalPages}`;
      }

      const ratioHeader = parseFloat(resp.headers.get('X-Highlight-Ratio') || '0');
      let pageRatio = (!isNaN(ratioHeader) && ratioHeader > 0) ? ratioHeader : 0;

      const rawTargetSvg = await resp.text();
      if (!pageRatio && rawTargetSvg) {
        const match = rawTargetSvg.match(/data-highlight-ratio=["']([0-9.]+)["']/);
        if (match) pageRatio = parseFloat(match[1]) || 0;
      }
      matrixDocState.highlightRatio = pageRatio;

      const targetSvg = scopeSvgIds(rawTargetSvg, targetPage);
      const targetCacheKey = `${comp.id}_p${targetPage}_${paramKey || ''}_${nominalVal || ''}_${minVal || ''}_${maxVal || ''}`;
      matrixDocState.pageCache.set(targetCacheKey, { svgText: targetSvg, ratio: pageRatio });

      // Extract viewBox for dynamic aspect-ratio lock across all pages (prevents any layout shift)
      const vbMatch = targetSvg.match(/viewBox=["']\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s*["']/i);
      let cardAspect = '612 / 792';
      if (vbMatch && parseFloat(vbMatch[3]) > 0 && parseFloat(vbMatch[4]) > 0) {
        cardAspect = `${vbMatch[3]} / ${vbMatch[4]}`;
      }

      // Construct all page cards in a continuous multi-page stack with locked aspect-ratio
      let containerHtml = `<div class="matrix-pages-container" id="matrix-pages-container">`;
      for (let p = 1; p <= matrixDocState.totalPages; p++) {
        const isTarget = p === targetPage;
        containerHtml += `
          <div class="matrix-page-card ${isTarget ? 'is-target-highlight' : ''}" id="matrix-page-card-${p}" data-page="${p}" style="aspect-ratio: ${cardAspect};">
            <div class="matrix-page-header-tag">Page ${p} of ${matrixDocState.totalPages}</div>
            <div class="matrix-page-svg-holder" id="matrix-page-svg-${p}" style="aspect-ratio: ${cardAspect};">
              ${isTarget ? targetSvg : `<div class="matrix-page-loading"><div class="matrix-mini-spinner"></div><span>Loading Page ${p}...</span></div>`}
            </div>
          </div>
        `;
      }
      containerHtml += `</div>`;

      if (svgHost) {
        svgHost.innerHTML = containerHtml;
      }
      matrixDocState.loadedDocKey = docKey;

      if (pageStage) {
        pageStage.style.width = matrixDocState.zoomPercent + '%';
      }

      // Immediate and robust target section scroll alignment
      scrollToMatrixTargetSection(targetPage, pageRatio, 'auto');
      requestAnimationFrame(() => {
        scrollToMatrixTargetSection(targetPage, pageRatio, 'auto');
      });
      setTimeout(() => {
        if (!matrixDocState.userHasScrolled) {
          scrollToMatrixTargetSection(targetPage, pageRatio, 'auto');
        }
      }, 50);
      setTimeout(() => {
        if (!matrixDocState.userHasScrolled) {
          scrollToMatrixTargetSection(targetPage, pageRatio, 'smooth');
        }
      }, 180);

      matrixDocState.prevHighlightedPage = targetPage;

      // Initialize observer for lazy loading as user scrolls with mouse wheel
      initPageIntersectionObserver(vectorWrapper);

      // Progressively load all remaining pages in the background
      loadAllRemainingPages();

    } catch (err) {
      console.warn('[renderMatrixDocContent] Vector render failed, falling back to iframe:', err);
      matrixDocState.mode = 'iframe';
      if (vectorWrapper) vectorWrapper.style.display = 'none';
      if (pdfWrapper) pdfWrapper.style.display = 'block';
      if (frame) frame.src = pdfUrl;
      const modeLabel = document.getElementById('matrix-mode-label');
      if (modeLabel) modeLabel.textContent = '📄 Fit Width';
    }
  } else {
    if (vectorWrapper) vectorWrapper.style.display = 'none';
    if (pdfWrapper) pdfWrapper.style.display = 'block';
    if (frame) frame.src = pdfUrl;
    if (pageBadge) {
      pageBadge.textContent = `Page ${targetPage}`;
    }
  }
}

window.openMatrixPdf = function(compId, pageNum, paramKey, paramLabel, nominalVal, clickedEl, minVal = '', maxVal = '', rawLabel = '') {
  const comp = state.components.find(c => c.id === compId) || state.components[0];
  if (!comp || !comp.datasheet_filename) {
    showToast(`No local PDF attached for ${comp ? comp.part_number : 'this part'}.`);
    return;
  }

  // Active selection highlighting in matrix table
  document.querySelectorAll('.active-matrix-cell').forEach(el => el.classList.remove('active-matrix-cell'));
  document.querySelectorAll('.active-matrix-row').forEach(el => el.classList.remove('active-matrix-row'));
  if (clickedEl) {
    if (clickedEl.classList.contains('param-clickable')) {
      clickedEl.classList.add('active-matrix-row');
    } else {
      clickedEl.classList.add('active-matrix-cell');
      const row = clickedEl.closest('tr');
      if (row) {
        const paramTd = row.querySelector('.param-clickable');
        if (paramTd) paramTd.classList.add('active-matrix-row');
      }
    }
  }

  // Clear cached page SVGs if switching to a different component
  if (!matrixDocState.comp || matrixDocState.comp.id !== comp.id) {
    matrixDocState.pageCache.clear();
  }

  const targetPage = pageNum || 1;
  matrixDocState.comp = comp;
  matrixDocState.page = targetPage;
  matrixDocState.targetPage = targetPage;
  matrixDocState.userHasScrolled = false;
  matrixDocState.paramKey = paramKey;
  matrixDocState.paramLabel = paramLabel;
  matrixDocState.nominalVal = nominalVal;
  matrixDocState.minVal = minVal;
  matrixDocState.maxVal = maxVal;
  matrixDocState.rawLabel = rawLabel || paramLabel;
  matrixDocState.highlightRatio = 0;

  const panel = document.getElementById('matrix-pdf-panel');
  const resizer = document.getElementById('matrix-split-resizer');
  const title = document.getElementById('matrix-pdf-title');

  if (panel) {
    if (title) {
      title.textContent = `${comp.part_number} — ${paramLabel || 'Datasheet'}`;
      title.title = `${comp.part_number} (${comp.datasheet_filename})`;
    }

    panel.hidden = false;
    if (resizer) resizer.hidden = false;

    // Set 60:40 split (40% for PDF, 60% for Comparison Matrix)
    if (!panel.style.width || parseFloat(panel.style.width) > 50) {
      panel.style.width = '40%';
    }

    renderMatrixDocContent(targetPage);
    showToast(`Highlighting ${paramLabel || 'parameter'} on ${comp.part_number} datasheet (Page ${targetPage})`);
  }
};

window.changeMatrixPdfPage = function(delta) {
  if (!matrixDocState.comp) return;
  const maxPage = matrixDocState.totalPages || 10;
  const currentPage = matrixDocState.page || 1;
  const newPage = Math.max(1, Math.min(currentPage + delta, maxPage));
  if (newPage === currentPage) return;

  matrixDocState.page = newPage;
  matrixDocState.userHasScrolled = true;
  scrollToMatrixTargetPage(newPage, 'smooth');

  const pageBadge = document.getElementById('matrix-pdf-page-badge');
  if (pageBadge) {
    pageBadge.textContent = `Page ${newPage} of ${matrixDocState.totalPages}`;
  }
};

window.adjustMatrixZoom = function(delta) {
  matrixDocState.zoomPercent = Math.max(80, Math.min(matrixDocState.zoomPercent + delta, 250));
  const pageStage = document.getElementById('matrix-page-stage');
  const zoomBtn = document.getElementById('btn-matrix-zoom-fit');
  if (pageStage) {
    pageStage.style.width = matrixDocState.zoomPercent + '%';
  }
  if (zoomBtn) {
    zoomBtn.textContent = matrixDocState.zoomPercent === 100 ? 'Fit Width' : matrixDocState.zoomPercent + '%';
  }
};

window.resetMatrixZoom = function() {
  matrixDocState.zoomPercent = 100;
  const pageStage = document.getElementById('matrix-page-stage');
  const zoomBtn = document.getElementById('btn-matrix-zoom-fit');
  if (pageStage) {
    pageStage.style.width = '100%';
  }
  if (zoomBtn) {
    zoomBtn.textContent = 'Fit Width';
  }
};

window.toggleMatrixPdfMode = function() {
  matrixDocState.mode = matrixDocState.mode === 'vector' ? 'iframe' : 'vector';
  const modeLabel = document.getElementById('matrix-mode-label');
  if (modeLabel) {
    modeLabel.textContent = matrixDocState.mode === 'vector' ? '📑 PDF Plugin' : '📄 Fit Width';
  }
  matrixDocState.loadedDocKey = null;
  renderMatrixDocContent();
};

window.toggleMatrixPdfExpand = function() {
  const panel = document.getElementById('matrix-pdf-panel');
  const btn = document.getElementById('matrix-pdf-expand-btn');
  if (!panel) return;

  const isExp = panel.classList.toggle('is-expanded');
  if (isExp) {
    panel.dataset.prevWidth = panel.style.width || '40%';
    panel.style.width = '70%';
    if (btn) {
      btn.title = "Restore standard 40% width";
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 14h6m0 0v6m0-6L3 21m17-7h-6m0 0v6m0-6l7 7M14 4h6m-6 0v6m6-6l-7 7M4 10h6m-6 0V4m6 6L3 3"/></svg>`;
    }
  } else {
    panel.style.width = panel.dataset.prevWidth || '40%';
    if (btn) {
      btn.title = "Toggle wide layout view (Expand / Restore)";
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>`;
    }
  }
};

window.closeMatrixPdf = function() {
  const panel = document.getElementById('matrix-pdf-panel');
  const resizer = document.getElementById('matrix-split-resizer');
  const frame = document.getElementById('matrix-pdf-frame');
  const btn = document.getElementById('matrix-pdf-expand-btn');
  if (panel) {
    panel.hidden = true;
    panel.classList.remove('is-expanded');
  }
  if (resizer) resizer.hidden = true;
  if (frame) frame.src = '';
  if (btn) {
    btn.title = "Toggle wide layout view (Expand / Restore)";
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>`;
  }
  if (matrixDocState.pageObserver) {
    matrixDocState.pageObserver.disconnect();
    matrixDocState.pageObserver = null;
  }
  matrixDocState.loadedDocKey = null;
  matrixDocState.pageCache.clear();
  matrixDocState.loadingPages.clear();
};

// ── Draggable Splitter Implementation ─────────────────────────────────────────
function initMatrixResizer() {
  const container = document.getElementById('matrix-split-container');
  const resizer = document.getElementById('matrix-split-resizer');
  const panel = document.getElementById('matrix-pdf-panel');
  const frame = document.getElementById('matrix-pdf-frame');

  if (!container || !resizer || !panel) return;

  let isDragging = false;
  let startX = 0;
  let startWidth = 0;

  resizer.addEventListener('mousedown', (e) => {
    isDragging = true;
    startX = e.clientX;
    startWidth = panel.getBoundingClientRect().width;
    resizer.classList.add('is-dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    if (frame) frame.style.pointerEvents = 'none'; // Prevent iframe from capturing pointer events during drag
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const deltaX = startX - e.clientX; // Dragging left increases width of the right-hand panel
    const containerWidth = container.getBoundingClientRect().width;
    let newWidth = startWidth + deltaX;

    const minWidth = 320;
    const maxWidth = Math.max(minWidth, containerWidth - 320);
    newWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));

    panel.style.width = `${newWidth}px`;
    panel.style.maxWidth = `${maxWidth}px`;
  });

  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      resizer.classList.remove('is-dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (frame) frame.style.pointerEvents = 'auto';
    }
  });
}

window.showCitationToast = function(pageNum) {
  showToast(`Source citation verified against datasheet page ${pageNum}`);
};

// ── Export Features ──────────────────────────────────────────────────────────
// Extract clean "value + unit" text for one matrix cell, deliberately leaving out the
// drag-handle glyph, the "★ Best" badge, and the "Page N ↗" citation chip link.
function cellCsvText(c) {
  if (c.querySelector('.val-na')) return 'NA';

  const paramLabel = c.querySelector('.param-label-text');
  if (paramLabel) {
    const unit = c.querySelector('.param-unit-tag');
    const label = paramLabel.textContent.trim();
    return unit && unit.textContent.trim() ? `${label} (${unit.textContent.trim()})` : label;
  }

  const mainVal = c.querySelector('.metric-main-val');
  if (mainVal) {
    const unit = c.querySelector('.metric-unit-text');
    const range = c.querySelector('.metric-sub-range');
    let text = mainVal.textContent.trim();
    if (unit && unit.textContent.trim()) text += ` ${unit.textContent.trim()}`;
    if (range && range.textContent.trim()) text += ` ${range.textContent.trim()}`;
    return text;
  }

  const partNumber = c.querySelector('.col-part-number');
  if (partNumber) {
    const meta = c.querySelector('.col-part-meta');
    return meta ? `${partNumber.textContent.trim()} ${meta.textContent.trim()}` : partNumber.textContent.trim();
  }

  return (c.innerText || c.textContent || '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
}

function exportCsv() {
  const table = document.querySelector('.modern-matrix-table');
  if (!table) return;

  let csv = [];
  table.querySelectorAll('tr').forEach(r => {
    const cols = r.querySelectorAll('th, td');
    const row = [];
    cols.forEach(c => {
      row.push(`"${cellCsvText(c).replace(/"/g, '""')}"`);
    });
    csv.push(row.join(','));
  });

  // Prepend a UTF-8 BOM so Excel (which ignores the Blob's charset=utf-8 MIME param for
  // local files and otherwise guesses the system codepage) renders °, Ω, ★ etc. correctly
  // instead of mojibake like "Â°"/"Î©"/"â˜…".
  const blob = new Blob(['\ufeff', csv.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `component_comparison_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  showToast('Exported comparison table to CSV');
}

// ── View 3: Ingestion Inspector ──────────────────────────────────────────────
function getCleanPdfUrl(url) {
  if (!url) return '';
  const noHashNoQuery = url.split('#')[0].split('?')[0];
  return encodeURI(decodeURI(noHashNoQuery));
}

// Freely-draggable splitter between the Inspector's PDF pane and staging pane (default 50:50).
function initInspectorResizer() {
  const container = els.inspectorSplitWorkspace;
  const resizer = document.getElementById('inspector-resizer');
  const leftPane = container ? container.querySelector('.split-left') : null;
  if (!container || !resizer || !leftPane) return;

  let isDragging = false;

  resizer.addEventListener('mousedown', (e) => {
    isDragging = true;
    resizer.classList.add('is-dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    if (els.pdfFrame) els.pdfFrame.style.pointerEvents = 'none'; // keep iframe from eating mouse events while dragging
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const rect = container.getBoundingClientRect();
    let leftPct = ((e.clientX - rect.left) / rect.width) * 100;
    leftPct = Math.max(20, Math.min(80, leftPct));
    leftPane.style.flexBasis = `${leftPct}%`;
  });

  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      resizer.classList.remove('is-dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (els.pdfFrame) els.pdfFrame.style.pointerEvents = 'auto';
    }
  });
}

// Toggle a second PDF column on/off so the user can compare two datasheets side by side.
function toggleComparePdf() {
  state.comparePdfMode = !state.comparePdfMode;
  if (els.btnComparePdf) els.btnComparePdf.classList.toggle('active', state.comparePdfMode);
  if (els.pdfColumnCompare) els.pdfColumnCompare.hidden = !state.comparePdfMode;
  if (els.pdfCompareResizer) els.pdfCompareResizer.hidden = !state.comparePdfMode;

  // Reset to an even 50:50 split each time compare mode is (re)opened
  const primaryCol = document.getElementById('pdf-column-primary');
  if (primaryCol) primaryCol.style.flexBasis = '50%';

  if (!state.comparePdfMode) {
    if (els.selectPdfCompare) els.selectPdfCompare.value = '';
    if (els.pdfFrameCompare) els.pdfFrameCompare.src = '';
    if (els.pdfEmptyHeroCompare) els.pdfEmptyHeroCompare.hidden = false;
  }

  // Compare mode needs the width the staging panel normally occupies - hide it while
  // comparing, and restore it automatically once comparison is closed again.
  setStagingPanelHidden(state.comparePdfMode);
}

// Show/hide the right-hand "Automated Parameter Staging" panel so the PDF pane(s) on the
// left can use the full workspace width (most useful in side-by-side compare mode).
function setStagingPanelHidden(hidden) {
  state.stagingPanelHidden = hidden;
  if (els.inspectorSplitWorkspace) {
    els.inspectorSplitWorkspace.classList.toggle('staging-panel-hidden', hidden);
  }
  if (els.btnToggleStaging) els.btnToggleStaging.classList.toggle('active', hidden);
  if (els.btnToggleStagingLabel) els.btnToggleStagingLabel.textContent = hidden ? 'Show Table' : 'Hide Table';
}

// Load the "Compare With" PDF - a plain viewer only, no extraction/staging involved.
function openDatasheetInCompare(jsonVal) {
  try {
    const ds = JSON.parse(jsonVal);
    const cleanUrl = getCleanPdfUrl(ds.url);
    if (els.pdfEmptyHeroCompare) els.pdfEmptyHeroCompare.hidden = true;
    if (els.pdfFrameCompare) els.pdfFrameCompare.src = `${cleanUrl}?_ts=${Date.now()}#view=FitH&toolbar=1`;
  } catch (e) {
    console.error('Compare PDF error:', e);
  }
}

// Freely-draggable splitter between the two compared PDF columns (default 50:50).
function initCompareResizer() {
  const container = els.pdfCompareWorkspace;
  const resizer = els.pdfCompareResizer;
  const primaryCol = document.getElementById('pdf-column-primary');
  if (!container || !resizer || !primaryCol) return;

  let isDragging = false;

  resizer.addEventListener('mousedown', (e) => {
    isDragging = true;
    resizer.classList.add('is-dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    if (els.pdfFrame) els.pdfFrame.style.pointerEvents = 'none';
    if (els.pdfFrameCompare) els.pdfFrameCompare.style.pointerEvents = 'none';
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const rect = container.getBoundingClientRect();
    let leftPct = ((e.clientX - rect.left) / rect.width) * 100;
    leftPct = Math.max(20, Math.min(80, leftPct));
    primaryCol.style.flexBasis = `${leftPct}%`;
  });

  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      resizer.classList.remove('is-dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (els.pdfFrame) els.pdfFrame.style.pointerEvents = 'auto';
      if (els.pdfFrameCompare) els.pdfFrameCompare.style.pointerEvents = 'auto';
    }
  });
}

window.highlightInspectorParam = function(originalIdx, btnEl) {
  const item = state.stagedItems[originalIdx];
  if (!item) return;

  let rawBase = state.currentInspectorPdfBaseUrl;
  if (!rawBase && els.selectPdf && els.selectPdf.value) {
    try {
      rawBase = JSON.parse(els.selectPdf.value).url;
    } catch (e) {}
  }
  if (!rawBase) {
    showToast('Please select a datasheet first');
    return;
  }

  const cleanBase = getCleanPdfUrl(rawBase);
  state.currentInspectorPdfBaseUrl = cleanBase;
  state.currentHighlightedParamIdx = originalIdx;

  const targetPage = parseInt(item.source_page, 10) || 1;
  const zoom = state.currentInspectorPdfZoom || 'FitH';

  const params = new URLSearchParams();
  if (item.param_key) params.set('param', item.param_key);
  if (item.canonical_label) params.set('label', item.canonical_label);
  if (item.raw_label) params.set('raw', item.raw_label);
  const isValidNum = (v) => v != null && v !== '' && v !== 'TBD' && v !== '--' && v !== '-' && v !== 'N/A';

  const val = isValidNum(item.nom) ? item.nom : (isValidNum(item.min) ? item.min : (isValidNum(item.max) ? item.max : ''));
  if (val) params.set('val', String(val).trim());
  if (isValidNum(item.min)) params.set('min', String(item.min).trim());
  if (isValidNum(item.max)) params.set('max', String(item.max).trim());

  params.set('page', targetPage);
  params.set('_ts', Date.now());

  const targetUrl = `${cleanBase}?${params.toString()}#page=${targetPage}&view=${zoom}&toolbar=1`;
  const popoutUrl = `${cleanBase}?${params.toString()}#page=${targetPage}`;

  if (els.pdfFrame) {
    try {
      els.pdfFrame.contentWindow.location.replace(targetUrl);
    } catch (e) {
      els.pdfFrame.src = targetUrl;
    }
  }

  if (els.btnPdfPopout) {
    els.btnPdfPopout.href = popoutUrl;
    els.btnPdfPopout.hidden = false;
  }

  if (els.btnPdfClearHighlight) {
    els.btnPdfClearHighlight.hidden = false;
  }

  // Highlight active row & button in staging table
  document.querySelectorAll('.staging-row').forEach(r => {
    r.classList.remove('row-highlight-active', 'row-jump-active');
  });
  document.querySelectorAll('.btn-source-jump').forEach(b => {
    b.classList.remove('active-jump');
  });

  const row = btnEl ? btnEl.closest('.staging-row') : document.querySelector(`.staging-row[data-idx="${originalIdx}"]`);
  if (row) {
    row.classList.add('row-highlight-active');
    const jumpBtn = row.querySelector('.btn-source-jump');
    if (jumpBtn) jumpBtn.classList.add('active-jump');
  } else if (btnEl) {
    btnEl.classList.add('active-jump');
  }

  showToast(`Highlighted "${item.canonical_label}" on Page ${targetPage} in PDF`);
};

window.clearInspectorPdfHighlight = function() {
  state.currentHighlightedParamIdx = null;

  let rawBase = state.currentInspectorPdfBaseUrl;
  if (!rawBase && els.selectPdf && els.selectPdf.value) {
    try {
      rawBase = JSON.parse(els.selectPdf.value).url;
    } catch (e) {}
  }
  if (!rawBase) return;

  const cleanBase = getCleanPdfUrl(rawBase);
  state.currentInspectorPdfBaseUrl = cleanBase;
  const zoom = state.currentInspectorPdfZoom || 'FitH';

  let currentPage = 1;
  const activeRow = document.querySelector('.staging-row.row-highlight-active');
  if (activeRow && activeRow.dataset.page) {
    currentPage = parseInt(activeRow.dataset.page, 10) || 1;
  }

  const cleanUrl = `${cleanBase}?page=${currentPage}&_ts=${Date.now()}#page=${currentPage}&view=${zoom}&toolbar=1`;
  const popoutUrl = `${cleanBase}#page=${currentPage}`;

  if (els.pdfFrame) {
    try {
      els.pdfFrame.contentWindow.location.replace(cleanUrl);
    } catch (e) {
      els.pdfFrame.src = cleanUrl;
    }
  }

  if (els.btnPdfPopout) {
    els.btnPdfPopout.href = popoutUrl;
  }

  if (els.btnPdfClearHighlight) {
    els.btnPdfClearHighlight.hidden = true;
  }

  document.querySelectorAll('.staging-row').forEach(r => {
    r.classList.remove('row-highlight-active', 'row-jump-active');
  });
  document.querySelectorAll('.btn-source-jump').forEach(b => {
    b.classList.remove('active-jump');
  });

  showToast('Cleared PDF highlights');
};

window.jumpInspectorPdfToPage = function(pageNum, btnEl) {
  if (typeof pageNum === 'number' && state.stagedItems[pageNum]) {
    return window.highlightInspectorParam(pageNum, btnEl);
  }
  const p = parseInt(pageNum, 10) || 1;
  let rawBase = state.currentInspectorPdfBaseUrl;
  if (!rawBase && els.selectPdf && els.selectPdf.value) {
    try {
      rawBase = JSON.parse(els.selectPdf.value).url;
    } catch (e) {}
  }
  if (!rawBase) {
    showToast('Please select a datasheet first');
    return;
  }

  const cleanBase = getCleanPdfUrl(rawBase);
  state.currentInspectorPdfBaseUrl = cleanBase;
  const zoom = state.currentInspectorPdfZoom || 'FitH';
  const targetUrl = `${cleanBase}?page=${p}&_ts=${Date.now()}#page=${p}&view=${zoom}&toolbar=1`;

  if (els.pdfFrame) {
    try {
      els.pdfFrame.contentWindow.location.replace(targetUrl);
    } catch (e) {
      els.pdfFrame.src = targetUrl;
    }
  }

  // Highlight active button and row
  document.querySelectorAll('.btn-source-jump').forEach(b => b.classList.remove('active-jump'));
  document.querySelectorAll('.staging-row').forEach(r => r.classList.remove('row-jump-active'));

  if (btnEl) {
    btnEl.classList.add('active-jump');
    const row = btnEl.closest('.staging-row');
    if (row) row.classList.add('row-jump-active');
  }

  showToast(`Jumped PDF to Page ${p}`);
};

window.deleteStagedItem = function(idx) {
  state.stagedItems.splice(idx, 1);
  renderStagingTable();
  showToast('Removed parameter row');
};

window.toggleStagingGroup = function(groupId) {
  if (state.collapsedGroups.has(groupId)) {
    state.collapsedGroups.delete(groupId);
  } else {
    state.collapsedGroups.add(groupId);
  }
  renderStagingTable();
};

function getParamGroup(paramKey, category) {
  const schema = state.schemas[category] || state.schemas.microphone;
  if (schema && schema.groups) {
    for (const g of schema.groups) {
      if (g.parameters && g.parameters.some(p => p.key === paramKey)) {
        let icon = '📋';
        if (g.id === 'acoustic') icon = '🔊';
        else if (g.id === 'electrical') icon = '⚡';
        else if (g.id === 'mechanical') icon = '📐';
        const orderMap = { acoustic: 1, electrical: 2, mechanical: 3, other: 4 };
        return { id: g.id, name: g.name, icon, order: orderMap[g.id] || 4 };
      }
    }
  }
  const k = (paramKey || '').toLowerCase();
  if (k.includes('sens') || k.includes('snr') || k.includes('noise') || k.includes('ein') || k.includes('aop') || k.includes('thd') || k.includes('freq') || k.includes('polar') || k.includes('acoustic') || k.includes('spl') || k.includes('lfro') || k.includes('roll')) {
    return { id: 'acoustic', name: 'Acoustic Specifications', icon: '🔊', order: 1 };
  }
  if (k.includes('volt') || k.includes('curr') || k.includes('imped') || k.includes('psrr') || k.includes('drain') || k.includes('bias') || k.includes('startup') || k.includes('electr')) {
    return { id: 'electrical', name: 'Electrical Specifications', icon: '⚡', order: 2 };
  }
  if (k.includes('weight') || k.includes('dim') || k.includes('temp') || k.includes('port') || k.includes('size') || k.includes('mass') || k.includes('package') || k.includes('mechanic')) {
    return { id: 'mechanical', name: 'General & Mechanical', icon: '📐', order: 3 };
  }
  return { id: 'other', name: 'Additional Extracted Specifications', icon: '📋', order: 4 };
}

async function openDatasheetInInspector(jsonVal) {
  try {
    const ds = JSON.parse(jsonVal);
    const cleanBase = getCleanPdfUrl(ds.url);
    state.currentInspectorPdfBaseUrl = cleanBase;
    state.currentHighlightedParamIdx = null;
    if (els.btnPdfClearHighlight) {
      els.btnPdfClearHighlight.hidden = true;
    }
    els.pdfEmptyHero.hidden = true;
    const zoom = state.currentInspectorPdfZoom || 'FitH';
    const targetUrl = `${cleanBase}?_ts=${Date.now()}#view=${zoom}&toolbar=1`;
    els.pdfFrame.src = targetUrl;

    if (els.btnPdfPopout) {
      els.btnPdfPopout.href = cleanBase;
      els.btnPdfPopout.hidden = false;
    }

    const filename = ds.filename;
    let guessedPart = filename.replace(/\.pdf$/i, '').replace(/_/g, ' ');
    if (filename.includes('MM60')) {
      guessedPart = 'MM60-63230-B66';
      els.inputStagingMfr.value = 'Knowles';
      els.inputStagingPkg.value = 'LGA Bottom Port';
    } else if (filename.includes('MM08')) {
      guessedPart = 'MM08-36139-B66';
      els.inputStagingMfr.value = 'Knowles';
      els.inputStagingPkg.value = 'LGA Bottom Port';
    } else if (filename.includes('MM20')) {
      guessedPart = 'MM20-62249-B66';
      els.inputStagingMfr.value = 'Knowles';
      els.inputStagingPkg.value = 'LGA Bottom Port';
    }
    els.inputStagingPart.value = guessedPart;
    els.selectStagingCat.value = ds.category === 'vault' ? 'microphone' : ds.category;
    detectExistingMatch(guessedPart);

    els.btnReRunExtract.disabled = false;
    els.btnCommitDb.disabled = false;

    showToast(`Parsing ${ds.filename} with pdfplumber...`);

    const res = await fetch(`${API_BASE}/parse-datasheet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: ds.category, filename: ds.filename })
    });

    if (res.ok) {
      const data = await res.json();
      state.stagedItems = data.items || [];
      renderStagingTable();
      showToast(`Extracted ${state.stagedItems.length} specifications!`);
    } else {
      showToast('Extraction failed');
    }
  } catch (err) {
    console.error('Inspector error:', err);
  }
}

function renderStagingTable() {
  const total = state.stagedItems.length;
  const matched = state.stagedItems.filter(i => i.status === 'matched').length;
  const review = state.stagedItems.filter(i => i.status === 'fuzzy' || i.status === 'unmatched').length;

  if (els.badgeStagedCount) els.badgeStagedCount.textContent = `${total} Specs`;
  if (els.badgeStagedMatched) els.badgeStagedMatched.textContent = `${matched} Matched`;
  if (els.badgeStagedReview) els.badgeStagedReview.textContent = `${review} Review`;

  const cat = els.selectStagingCat ? els.selectStagingCat.value : 'microphone';
  let cntAcoustic = 0;
  let cntElectrical = 0;
  let cntMechanical = 0;

  state.stagedItems.forEach(item => {
    const grp = getParamGroup(item.param_key, cat);
    if (grp.id === 'acoustic') cntAcoustic++;
    else if (grp.id === 'electrical') cntElectrical++;
    else if (grp.id === 'mechanical') cntMechanical++;
  });

  if (els.filterCntAll) els.filterCntAll.textContent = total;
  if (els.filterCntAcoustic) els.filterCntAcoustic.textContent = cntAcoustic;
  if (els.filterCntElectrical) els.filterCntElectrical.textContent = cntElectrical;
  if (els.filterCntMechanical) els.filterCntMechanical.textContent = cntMechanical;
  if (els.filterCntReview) els.filterCntReview.textContent = review;

  if (total === 0) {
    if (els.stagingSectionsContainer) {
      els.stagingSectionsContainer.innerHTML = `
        <div class="staging-empty-state">
          <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.6"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          <h4>No Parameters Staged</h4>
          <p>Select a datasheet on the left to extract tables and parameters automatically.</p>
        </div>
      `;
    }
    return;
  }

  const query = state.stagingSearchQuery;
  const filterCat = state.stagingFilterCategory;

  const filteredItems = [];
  state.stagedItems.forEach((item, originalIdx) => {
    const grp = getParamGroup(item.param_key, cat);

    if (filterCat === 'review') {
      if (item.status === 'matched') return;
    } else if (filterCat !== 'all' && grp.id !== filterCat) {
      return;
    }

    if (query) {
      const matchText = `${item.canonical_label} ${item.raw_label} ${item.condition || ''} ${item.min || ''} ${item.nom || ''} ${item.max || ''} ${item.unit || ''}`.toLowerCase();
      if (!matchText.includes(query)) return;
    }

    filteredItems.push({ item, originalIdx, grp });
  });

  if (filteredItems.length === 0) {
    if (els.stagingSectionsContainer) {
      els.stagingSectionsContainer.innerHTML = `
        <div class="staging-empty-state">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <h4>No Matching Parameters</h4>
          <p>No extracted parameters matched your search filter.</p>
        </div>
      `;
    }
    return;
  }

  const groupsMap = new Map();
  filteredItems.forEach(entry => {
    const gid = entry.grp.id;
    if (!groupsMap.has(gid)) {
      groupsMap.set(gid, {
        id: gid,
        name: entry.grp.name,
        icon: entry.grp.icon,
        order: entry.grp.order,
        entries: []
      });
    }
    groupsMap.get(gid).entries.push(entry);
  });

  const sortedGroups = Array.from(groupsMap.values()).sort((a, b) => a.order - b.order);

  let html = '';
  sortedGroups.forEach(g => {
    const isCollapsed = state.collapsedGroups.has(g.id);
    html += `
      <div class="staging-group-card" data-group-id="${g.id}">
        <div class="staging-group-header" onclick="toggleStagingGroup('${g.id}')">
          <div class="group-header-left">
            <span class="group-icon">${g.icon}</span>
            <span class="group-title">${escapeHtml(g.name)}</span>
            <span class="group-count-pill">${g.entries.length} specs</span>
          </div>
          <div class="group-header-right">
            <span class="group-chevron ${isCollapsed ? 'collapsed' : ''}">▼</span>
          </div>
        </div>
        <div class="staging-group-body" style="display: ${isCollapsed ? 'none' : 'block'};">
          <table class="staging-modern-table">
            <thead>
              <tr>
                <th style="width: 32%;">Parameter Name & Mapping</th>
                <th style="width: 14%;">Match Status</th>
                <th style="width: 11%; text-align: right;">Min</th>
                <th style="width: 14%; text-align: right;">Nominal (Typ)</th>
                <th style="width: 11%; text-align: right;">Max</th>
                <th style="width: 7%; text-align: center;">Unit</th>
                <th style="width: 8%; text-align: center;">Source</th>
                <th style="width: 3%; text-align: center;"></th>
              </tr>
            </thead>
            <tbody>
              ${g.entries.map(({ item, originalIdx }) => {
                const isFuzzy = item.status === 'fuzzy';
                const isNomReal = item.nom != null && item.nom !== '' && item.nom !== 'TBD';
                const isMinReal = item.min != null && item.min !== '' && item.min !== 'TBD';
                const isMaxReal = item.max != null && item.max !== '' && item.max !== 'TBD';
                const isHighlighted = state.currentHighlightedParamIdx === originalIdx;

                return `
                  <tr class="staging-row ${isFuzzy ? 'row-review' : ''} ${isHighlighted ? 'row-highlight-active' : ''}" data-idx="${originalIdx}" data-page="${item.source_page || 1}">
                    <td class="cell-param">
                      <input type="text" class="spec-inline-input spec-label-input" value="${escapeHtml(item.canonical_label)}" onchange="updateStagedItem(${originalIdx}, 'canonical_label', this.value)" title="Click to edit canonical parameter label" />
                      <div class="spec-subtext">
                        <span class="spec-raw-chip" onclick="highlightInspectorParam(${originalIdx}, this)" title="Click to highlight '${escapeHtml(item.canonical_label)}' in PDF">Raw: ${escapeHtml(item.raw_label)}</span>
                        ${item.condition ? `<span class="spec-cond-chip" title="Test Condition">· ${escapeHtml(item.condition)}</span>` : ''}
                      </div>
                    </td>
                    <td class="cell-status">
                      <span class="status-pill ${item.status}">
                        <span class="status-dot"></span>
                        ${item.status === 'matched' ? '100% Match' : (item.status === 'fuzzy' ? `${Math.round((item.confidence || 0.8) * 100)}% Review` : 'Custom')}
                      </span>
                    </td>
                    <td class="cell-num">
                      <input type="text" class="spec-inline-input spec-num-input ${isMinReal ? 'has-val' : 'empty-val'}" value="${escapeHtml(item.min != null ? item.min : '')}" placeholder="--" onchange="updateStagedItem(${originalIdx}, 'min', this.value)" />
                    </td>
                    <td class="cell-num cell-nominal">
                      <input type="text" class="spec-inline-input spec-num-input spec-nominal-input ${isNomReal ? 'has-val' : 'empty-val'}" value="${escapeHtml(item.nom != null ? item.nom : '')}" placeholder="--" onchange="updateStagedItem(${originalIdx}, 'nom', this.value)" />
                    </td>
                    <td class="cell-num">
                      <input type="text" class="spec-inline-input spec-num-input ${isMaxReal ? 'has-val' : 'empty-val'}" value="${escapeHtml(item.max != null ? item.max : '')}" placeholder="--" onchange="updateStagedItem(${originalIdx}, 'max', this.value)" />
                    </td>
                    <td class="cell-unit">
                      <input type="text" class="spec-inline-input spec-unit-input" value="${escapeHtml(item.unit || '')}" placeholder="-" onchange="updateStagedItem(${originalIdx}, 'unit', this.value)" />
                    </td>
                    <td class="cell-source" style="text-align: center;">
                      <button type="button" class="btn-source-jump ${isHighlighted ? 'active-jump' : ''}" onclick="highlightInspectorParam(${originalIdx}, this)" title="Highlight '${escapeHtml(item.canonical_label)}' in yellow on Page ${item.source_page || 1} in PDF">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        P.${item.source_page || 1}
                        <span class="jump-arrow">↗</span>
                      </button>
                    </td>
                    <td class="cell-action" style="text-align: center;">
                      <button type="button" class="btn-row-delete" onclick="deleteStagedItem(${originalIdx})" title="Delete this extracted row">&times;</button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  });

  if (els.stagingSectionsContainer) {
    els.stagingSectionsContainer.innerHTML = html;
  }
}

window.updateStagedItem = function(idx, key, val) {
  if (state.stagedItems[idx]) {
    state.stagedItems[idx][key] = val;
  }
};

async function commitStaging() {
  const partNumber = els.inputStagingPart.value.trim();
  if (!partNumber) {
    alert('Please enter a Part Number');
    return;
  }

  if (state.commitMode === 'update' && !state.commitTargetId) {
    alert('Please select which existing component to update, or switch to "Create New Component".');
    return;
  }

  const selectedDs = els.selectPdf.value ? JSON.parse(els.selectPdf.value) : null;

  const payload = {
    mode: state.commitMode,
    component: {
      part_number: partNumber,
      manufacturer: els.inputStagingMfr.value.trim() || 'Generic',
      category_id: els.selectStagingCat.value,
      package_type: els.inputStagingPkg.value.trim(),
      description: `Verified extraction from datasheet ${selectedDs ? selectedDs.filename : ''}`,
      datasheet_filename: selectedDs ? selectedDs.filename : '',
      datasheet_category: selectedDs ? selectedDs.category : 'microphone',
      verified: true
    },
    specs: state.stagedItems.map(item => ({
      param_key: item.param_key,
      param_label: item.canonical_label,
      min_val: item.min,
      nom_val: item.nom,
      max_val: item.max,
      unit: item.unit,
      condition: item.condition,
      source_page: item.source_page,
      status: 'verified',
      confidence: item.confidence
    }))
  };

  if (state.commitMode === 'update') {
    payload.component.id = state.commitTargetId;
  }

  try {
    const res = await fetch(`${API_BASE}/components`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const data = await res.json();
      state.pinnedIds.add(data.id);
      await loadComponents();
      updateCounters();
      renderCatalog();
      showToast(data.mode === 'update' ? `Updated ${partNumber} in database!` : `Created new catalog entry for ${partNumber}!`);
      flashCommitSuccess();
    }
  } catch (err) {
    console.error(err);
    showToast('Failed to save to database');
  }
}

// Briefly flashes the "Committed!" note beside the Commit to Database button; restarts the
// fade animation on repeat commits instead of only playing once.
function flashCommitSuccess() {
  const el = els.commitSuccessNote;
  if (!el) return;
  el.hidden = true;
  void el.offsetWidth; // force reflow so the CSS animation restarts
  el.hidden = false;
  clearTimeout(flashCommitSuccess._timer);
  flashCommitSuccess._timer = setTimeout(() => { el.hidden = true; }, 2600);
}

async function handleUpload(e, category) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  category = category || (els.selectStagingCat ? els.selectStagingCat.value : 'microphone');

  showToast(files.length > 1 ? `Uploading ${files.length} PDFs into ${category}...` : `Uploading and extracting ${files[0].name}...`);

  let lastData = null;
  let successCount = 0;
  const failedNames = [];

  for (const file of files) {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch(`${API_BASE}/upload-datasheet?category=${category}`, {
        method: 'POST',
        body: formData
      });
      if (res.ok) {
        lastData = await res.json();
        successCount++;
      } else {
        failedNames.push(file.name);
      }
    } catch (err) {
      console.error(err);
      failedNames.push(file.name);
    }
  }

  e.target.value = ''; // allow re-selecting the same file(s) again later

  if (successCount === 0) {
    showToast('Upload failed');
    return;
  }

  await loadDatasheets();
  await loadComponents();
  updateCounters();
  renderCatalog();

  // Show the last uploaded datasheet's extracted specs; switch into "update" mode so
  // further edits + re-commit refine that same row instead of duplicating it.
  state.stagedItems = lastData.items || [];
  renderStagingTable();
  els.inputStagingPart.value = lastData.part_number || '';
  els.inputStagingMfr.value = lastData.manufacturer || 'Generic';
  setCommitMode('update');
  state.commitTargetId = lastData.component_id;
  if (els.selectUpdateTarget) els.selectUpdateTarget.value = lastData.component_id;

  els.btnReRunExtract.disabled = false;
  els.btnCommitDb.disabled = false;

  // Stay on whichever tab the upload was triggered from (e.g. Catalog) instead of
  // force-navigating to the Inspector; the staging table there is updated regardless,
  // ready to review next time the user visits it.
  if (files.length > 1) {
    const failedMsg = failedNames.length ? ` (${failedNames.length} failed: ${failedNames.join(', ')})` : '';
    showToast(`Added ${successCount}/${files.length} PDFs to the catalog${failedMsg}. Open Datasheet Inspector to review "${lastData.part_number}" or pick another from the dropdown.`);
  } else {
    showToast(`Added "${lastData.part_number}" to the catalog — open Datasheet Inspector to review the ${state.stagedItems.length} extracted specs.`);
  }
}

// ── Specs Detail Modal ───────────────────────────────────────────────────────
async function openSpecsModal(comp_id) {
  try {
    const res = await fetch(`${API_BASE}/components/${comp_id}`);
    if (!res.ok) return;
    const comp = await res.json();

    els.modalTitlePart.textContent = comp.part_number;
    els.modalTagMfr.textContent = comp.manufacturer;
    els.modalTagCat.textContent = comp.category_id;

    if (!comp.specs || comp.specs.length === 0) {
      els.modalSpecsContent.innerHTML = '<p style="padding: 20px; color: var(--text-muted);">No parametric specs recorded.</p>';
    } else {
      els.modalSpecsContent.innerHTML = `
        <div class="specs-detail-list">
          ${comp.specs.map(s => `
            <div class="spec-detail-row">
              <div>
                <span class="spec-detail-label">${escapeHtml(s.param_label)}</span>
                ${s.condition ? `<div class="spec-detail-cond">${escapeHtml(s.condition)}</div>` : ''}
              </div>
              <div style="text-align: right;">
                <span class="spec-detail-val">${escapeHtml(s.nom_val || (s.min_val && s.max_val ? `${s.min_val} ~ ${s.max_val}` : s.min_val || s.max_val || '--'))} ${escapeHtml(s.unit || '')}</span>
                ${s.source_page ? `<div style="font-size: 11px; color: var(--primary);">Page ${s.source_page}</div>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    els.modal.hidden = false;
  } catch (e) {
    console.error(e);
  }
}

// ── Utilities ────────────────────────────────────────────────────────────────
function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  setTimeout(() => { els.toast.hidden = true; }, 3200);
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

window.addEventListener('DOMContentLoaded', init);
