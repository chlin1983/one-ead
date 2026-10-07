/* HXML Viewer — upload .hxml files, browse curve blocks, plot with Plotly. */

const state = {
  blocks: [],
  files: [],
  selectedBis: new Set(),
  customYScales: {},
  customXScales: {},
  customTitles: {},
  customCurveNames: {},
  customColors: {},
  customLineWidths: {},
  customLineDashes: {},
  plotRevisions: {},
  plotsPerRow: 3,
  mergedGroups: [],
  dragBi: null,
  dragMode: null,   // "reorder" | "merge"
  plotOrder: [],    // ordered array of bi values for display sequence
  fsPlotInfo: null,
  leftPaneSplitPercent: null,
  calculatedCurves: {}, // { [bi]: [ traceObj, ... ] }
};

let activeCurveSearch = null;

const PERSIST_KEY = "hxmlViewer.state.v1";

function schedulePersist() {
  clearTimeout(schedulePersist._t);
  schedulePersist._t = setTimeout(persistState, 1500);
}

function persistState() {
  try {
    const snapshot = {
      blocks: state.blocks,
      files: state.files,
      selectedBis: Array.from(state.selectedBis),
      customYScales: state.customYScales,
      customXScales: state.customXScales,
      customTitles: state.customTitles,
      customCurveNames: state.customCurveNames,
      customColors: state.customColors,
      customLineWidths: state.customLineWidths,
      customLineDashes: state.customLineDashes,
      calculatedCurves: state.calculatedCurves,
      plotsPerRow: state.plotsPerRow,
      mergedGroups: state.mergedGroups,
      plotOrder: state.plotOrder,
      leftPaneSplitPercent: state.leftPaneSplitPercent,
    };
    sessionStorage.setItem(PERSIST_KEY, JSON.stringify(snapshot));
  } catch (e) {
    console.warn("HXML Viewer: could not persist state to sessionStorage", e);
  }
}

function restorePersistedState() {
  let raw;
  try {
    raw = sessionStorage.getItem(PERSIST_KEY);
  } catch (e) {
    return false;
  }
  if (!raw) return false;
  try {
    const snapshot = JSON.parse(raw);
    if (!snapshot || !Array.isArray(snapshot.blocks) || !snapshot.blocks.length) return false;
    state.blocks = snapshot.blocks;
    state.files = Array.isArray(snapshot.files) ? snapshot.files : [];
    state.selectedBis = new Set((snapshot.selectedBis || []).filter((bi) => Number.isInteger(bi) && state.blocks[bi]));
    state.customYScales = snapshot.customYScales || {};
    state.customXScales = snapshot.customXScales || {};
    state.customTitles = snapshot.customTitles || {};
    state.customCurveNames = {};
    if (snapshot.customCurveNames && typeof snapshot.customCurveNames === "object") {
      Object.entries(snapshot.customCurveNames).forEach(([k, v]) => {
        if (k.includes("::")) state.customCurveNames[k] = v;
      });
    }
    state.customColors = {};
    if (snapshot.customColors && typeof snapshot.customColors === "object") {
      Object.entries(snapshot.customColors).forEach(([k, v]) => {
        if (k.includes("::")) state.customColors[k] = v;
      });
    }
    state.customLineWidths = snapshot.customLineWidths || {};
    state.customLineDashes = snapshot.customLineDashes || {};
    state.plotsPerRow = Number(snapshot.plotsPerRow) || 3;
    state.mergedGroups = Array.isArray(snapshot.mergedGroups) ? snapshot.mergedGroups : [];
    state.plotOrder = Array.isArray(snapshot.plotOrder) ? snapshot.plotOrder : [];
    state.leftPaneSplitPercent = snapshot.leftPaneSplitPercent || null;
    state.calculatedCurves = (snapshot.calculatedCurves && typeof snapshot.calculatedCurves === "object") ? snapshot.calculatedCurves : {};
    return true;
  } catch (e) {
    return false;
  }
}

const el = {
  openBtn: document.getElementById("open-btn"),
  clearBtn: document.getElementById("clear-btn"),
  fileInput: document.getElementById("file-input"),
  status: document.getElementById("status"),
  dropzone: document.getElementById("dropzone"),
  leftPane: document.getElementById("left-pane"),
  leftPaneContent: document.getElementById("left-pane-content"),
  dutSection: document.getElementById("dut-section"),
  dutList: document.getElementById("dut-list"),
  dutCountBadge: document.getElementById("dut-count-badge"),
  leftPaneSplitter: document.getElementById("left-pane-splitter"),
  paneResizer: document.getElementById("pane-resizer"),
  splitEl: document.querySelector(".split"),
  explorerSection: document.getElementById("explorer-section"),
  explorerTitle: document.getElementById("explorer-title"),
  selectAllBtn: document.getElementById("select-all-btn"),
  clearSelBtn: document.getElementById("clear-sel-btn"),
  clearPlotsBtn: document.getElementById("clear-plots-btn"),
  tree: document.getElementById("tree"),
  empty: document.getElementById("empty"),
  plotWrap: document.getElementById("plot-wrap"),
  plotToolbar: document.getElementById("plot-toolbar"),
  plotBlocksSummary: document.getElementById("plot-blocks-summary"),
  plotInfoBadge: document.getElementById("plot-info-badge"),
  plotsPerRowSelect: document.getElementById("plots-per-row-select"),
  plotsGrid: document.getElementById("plots-grid"),
  curveSearchInput: document.getElementById("curve-search-input"),
  curveSearchNextBtn: document.getElementById("curve-search-next-btn"),
  curveSearchStatus: document.getElementById("curve-search-status"),
  curveSearchResults: document.getElementById("curve-search-results"),
  scalarCard: document.getElementById("scalar-card"),
  scalarSub: document.getElementById("scalar-sub"),
  scalarTablesWrap: document.getElementById("scalar-tables-wrap"),
  yModalBackdrop: document.getElementById("yaxis-modal-backdrop"),
  yModal: document.getElementById("yaxis-modal"),
  yModalClose: document.getElementById("yaxis-modal-close"),
  yModalTargetPlot: document.getElementById("yaxis-target-plot"),
  plotTitleInput: document.getElementById("plot-title-input"),
  yMinInput: document.getElementById("yaxis-min-input"),
  yMaxInput: document.getElementById("yaxis-max-input"),
  yStepInput: document.getElementById("yaxis-step-input"),
  yScaleSelect: document.getElementById("yaxis-scale-type"),
  yResetBtn: document.getElementById("yaxis-reset-btn"),
  yCancelBtn: document.getElementById("yaxis-cancel-btn"),
  yApplyBtn: document.getElementById("yaxis-apply-btn"),
  xMinInput: document.getElementById("xaxis-min-input"),
  xMaxInput: document.getElementById("xaxis-max-input"),
  xStepInput: document.getElementById("xaxis-step-input"),
  xScaleSelect: document.getElementById("xaxis-scale-type"),
  axisPanelY: document.getElementById("axis-panel-y"),
  axisPanelX: document.getElementById("axis-panel-x"),
  axisPanelLines: document.getElementById("axis-panel-lines"),
  axisTabY: document.getElementById("axis-tab-y"),
  axisTabX: document.getElementById("axis-tab-x"),
  axisTabLines: document.getElementById("axis-tab-lines"),
  axisTabCurves: document.getElementById("axis-tab-curves"),
  modalLinesList: document.getElementById("modal-lines-list"),
  axisPanelCurves: document.getElementById("axis-panel-curves"),
  modalCurvesList: document.getElementById("modal-curves-list"),
  fsOverlay: document.getElementById("fs-overlay"),
  fsTitle: document.getElementById("fs-title"),
  fsPlotDiv: document.getElementById("fs-plot-div"),
  fsPlotWrap: document.getElementById("fs-plot-wrap"),
  fsCurveTable: document.getElementById("fs-curve-table"),
  fsCopyBtn: document.getElementById("fs-copy-btn"),
  fsSaveBtn: document.getElementById("fs-save-btn"),
  fsResetSizeBtn: document.getElementById("fs-reset-size-btn"),
  fsHxmlBtn: document.getElementById("fs-hxml-btn"),
  fsToggleAllBtn: document.getElementById("fs-toggle-all-btn"),
  fsRefreshBtn: document.getElementById("fs-refresh-btn"),
  fsScaleBtn: document.getElementById("fs-scale-btn"),
  fsCloseBtn: document.getElementById("fs-close-btn"),
  fsMathBtn: document.getElementById("fs-math-btn"),
  fsMathPanel: document.getElementById("fs-math-panel"),
  fsMathCloseBtn: document.getElementById("fs-math-close-btn"),
  fsMathCatSelect: document.getElementById("fs-math-cat-select"),
  fsMathSubSelect: document.getElementById("fs-math-sub-select"),
  fsMathDetailsContainer: document.getElementById("fs-math-details-container"),
  fsMathCalcCount: document.getElementById("fs-math-calc-count"),
  fsMathCalcList: document.getElementById("fs-math-calc-list"),
  fsMathClearAllBtn: document.getElementById("fs-math-clear-all-btn"),
};

const FREQ_X = new Set(["f", "f48"]);
const PALETTE = [
  "#0000ff", // 1. Pure Blue (SF1_SS1)
  "#0080ff", // 2. Azure / Sky Blue (SF3_SS1)
  "#00cccc", // 3. Cyan / Turquoise (SF6_SS1)
  "#80ff80", // 4. Mint / Spring Light Green (SF9_SS1)
  "#cccc00", // 5. Yellow-Olive / Gold (SF12_SS1)
  "#ff8000", // 6. Vivid Orange (SF3_SS2)
  "#ff0000", // 7. Pure Red
  "#cc00cc", // 8. Magenta
  "#008080", // 9. Dark Teal
  "#808000", // 10. Dark Olive
  "#800080", // 11. Dark Violet
  "#000080", // 12. Navy Blue
  "#800000", // 13. Maroon
  "#008000", // 14. Forest Green
  "#ff6699", // 15. Coral Rose
  "#111827", // 16. Dark Slate
];

el.openBtn.addEventListener("click", () => el.fileInput.click());
el.fileInput.addEventListener("change", () => uploadFiles(el.fileInput.files));
el.clearBtn.addEventListener("click", clearAll);
el.selectAllBtn?.addEventListener("click", selectAllBlocks);
el.clearSelBtn?.addEventListener("click", clearSelectedBlocks);
el.clearPlotsBtn?.addEventListener("click", clearSelectedBlocks);
el.plotsPerRowSelect?.addEventListener("change", (e) => {
  state.plotsPerRow = parseInt(e.target.value, 10) || 3;
  renderSelectedPlots();
});
el.curveSearchNextBtn?.addEventListener("click", navigateCurveSearch);
el.curveSearchInput?.addEventListener("input", resetCurveSearch);
el.curveSearchInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    navigateCurveSearch();
  }
});

el.yModalClose?.addEventListener("click", closeYAxisModal);
el.yCancelBtn?.addEventListener("click", closeYAxisModal);
el.yApplyBtn?.addEventListener("click", applyAxisSettings);
el.yResetBtn?.addEventListener("click", resetAxisSettings);
el.yModalBackdrop?.addEventListener("click", (e) => {
  if (e.target === el.yModalBackdrop) closeYAxisModal();
});
[el.plotTitleInput, el.yMinInput, el.yMaxInput, el.yStepInput, el.xMinInput, el.xMaxInput, el.xStepInput].forEach((inp) => {
  inp?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") applyAxisSettings();
  });
});
function handleEscapeKey() {
  if (el.yModalBackdrop && !el.yModalBackdrop.hidden) {
    closeYAxisModal();
  } else if (el.fsMathPanel && !el.fsMathPanel.hidden) {
    toggleFsMathPanel();
  } else if (el.fsOverlay && !el.fsOverlay.hidden) {
    closeFullscreen();
  }
}

// Capture phase so nothing inside the plot can swallow the key.
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    handleEscapeKey();
  } else if ((e.key === "m" || e.key === "M") && el.fsOverlay && !el.fsOverlay.hidden) {
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (tag !== "input" && tag !== "textarea" && tag !== "select") {
      e.preventDefault();
      toggleFsMathPanel();
    }
  }
}, true);

// The portal shell forwards ESC here when keyboard focus is outside this iframe.
window.addEventListener("message", (e) => {
  if (e.origin === window.location.origin && e.data && e.data.type === "ead:escape") handleEscapeKey();
});

initPropertyModalDraggable();
initFsCurveMathEvents();

// Fullscreen overlay button wiring
el.fsCloseBtn?.addEventListener("click", closeFullscreen);
el.fsResetSizeBtn?.addEventListener("click", () => resetFsPlotSize(false));
el.fsCopyBtn?.addEventListener("click", () => {
  if (el.fsPlotDiv) copyPlotToClipboard(el.fsPlotDiv, el.fsCopyBtn);
});
el.fsSaveBtn?.addEventListener("click", () => {
  if (el.fsPlotDiv) {
    const curName = (state.fsPlotInfo && state.customTitles && state.customTitles[state.fsPlotInfo.bi]) || state.fsPlotInfo?.blockName || "plot";
    savePlotWithCustomName(el.fsPlotDiv, curName);
  }
});
el.fsHxmlBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (activeHxmlMenu) {
    closeHxmlMenu();
    return;
  }
  if (!state.fsPlotInfo) return;
  const mgMatch = state.mergedGroups.find((g) => g.id === state.fsPlotInfo.bi);
  if (mgMatch) {
    handleMergedHxmlExport(el.fsHxmlBtn, mgMatch);
  } else {
    const block = state.blocks[state.fsPlotInfo.bi];
    if (block) handleHxmlExport(el.fsHxmlBtn, block, state.fsPlotInfo.bi);
  }
});
el.fsToggleAllBtn?.addEventListener("click", () => {
  toggleAllFullscreenCurves();
});
el.fsRefreshBtn?.addEventListener("click", () => {
  if (state.fsPlotInfo && el.fsPlotDiv) {
    const { bi, blockName } = state.fsPlotInfo;
    resetPlotView(bi, el.fsPlotDiv, () => {
      renderSelectedPlots();
      openFullscreen(bi, blockName);
    });
  }
});
el.fsScaleBtn?.addEventListener("click", () => {
  if (state.fsPlotInfo) {
    openPropertyModal(state.fsPlotInfo.bi, state.fsPlotInfo.blockName, el.fsPlotDiv);
  }
});
function getTraceIndexFromLegendElement(traceG, div) {
  if (!traceG || !div || !div.data) return -1;
  const traceObj = traceG.__data__?.[0]?.trace;
  if (traceObj) {
    if (typeof traceObj.index === "number" && div.data[traceObj.index] === traceObj) {
      return traceObj.index;
    }
    const idx = div.data.indexOf(traceObj);
    if (idx !== -1) return idx;
    if (traceObj.calcId) {
      const cIdx = div.data.findIndex((t) => t.calcId === traceObj.calcId);
      if (cIdx !== -1) return cIdx;
    }
    if (traceObj.name) {
      const nIdx = div.data.findIndex((t) => t.name === traceObj.name);
      if (nIdx !== -1) return nIdx;
    }
  }
  const textEl = traceG.querySelector("text");
  if (textEl && textEl.textContent) {
    const txt = textEl.textContent.trim();
    const tIdx = div.data.findIndex((t) => (t.name || "").trim() === txt);
    if (tIdx !== -1) return tIdx;
  }
  return -1;
}

let lastLegendToggleTime = 0;
let lastToggledCurveNumber = -1;

function toggleFullscreenTraceVisibility(curveNumber) {
  const div = el.fsPlotDiv;
  if (!div || !div.data || typeof curveNumber !== "number" || !div.data[curveNumber]) return;
  const now = Date.now();
  if (lastToggledCurveNumber === curveNumber && (now - lastLegendToggleTime < 250)) return;
  lastLegendToggleTime = now;
  lastToggledCurveNumber = curveNumber;

  const curVis = div.data[curveNumber].visible;
  const nextVis = (curVis === "legendonly" || curVis === false) ? true : "legendonly";

  try {
    Plotly.restyle(div, { visible: nextVis }, [curveNumber]);
  } catch (err) {
    console.warn("Error restyling trace visibility:", err);
  }

  // Ensure div.data reflects nextVis immediately
  div.data[curveNumber].visible = nextVis;

  const bi = state.fsPlotInfo?.bi;
  const trace = div.data[curveNumber];
  if (bi !== undefined && bi !== null && trace && state.calculatedCurves && state.calculatedCurves[bi]) {
    const calc = state.calculatedCurves[bi].find((c) =>
      (trace.calcId && c.calcId === trace.calcId) ||
      c.name === trace.name
    );
    if (calc) {
      calc.visible = nextVis;
      if (calc.pv) {
        if (nextVis === true) drawPvOverlay(calc.calcId, calc.pv);
        else removePvOverlay(calc.calcId);
      }
      renderFsCalculatedCurvesList(bi);
      renderFsFeatureDetails();
      schedulePersist();
    }
  }

  syncPvOverlays();
  updateToggleAllBtnState();
}

if (el.fsPlotDiv) {
  el.fsPlotDiv.addEventListener("pointerdown", (e) => {
    if (e.button !== 2 || !state.fsPlotInfo) return;
    openPropertyFromPlotPointer(e, state.fsPlotInfo.bi, state.fsPlotInfo.blockName, el.fsPlotDiv);
  }, true);
  el.fsPlotDiv.addEventListener("contextmenu", suppressPlotContextMenu, true);

  // Direct legend click fallback to ensure curve toggling ALWAYS works in fullscreen
  el.fsPlotDiv.addEventListener("click", (e) => {
    const traceG = e.target && e.target.closest && e.target.closest("g.traces");
    if (!traceG) return;
    const traceIdx = getTraceIndexFromLegendElement(traceG, el.fsPlotDiv);
    if (traceIdx >= 0) {
      toggleFullscreenTraceVisibility(traceIdx);
    }
  }, true);
}

// Tab switching inside Axis Scale Modal
let currentAxisTab = "y";

function updateModalFooterState() {
  if (el.yResetBtn) {
    if (currentAxisTab === "curves") {
      el.yResetBtn.textContent = "Reset Names";
      el.yResetBtn.title = "Reset curve names for this plot back to default";
    } else if (currentAxisTab === "lines") {
      el.yResetBtn.textContent = "Reset Colors";
      el.yResetBtn.title = "Reset line colors and styles to default palette";
    } else {
      el.yResetBtn.textContent = "Reset to Auto";
      el.yResetBtn.title = "Reset active axis to automatic autoscaling";
    }
  }
}

function switchAxisTab(tabName) {
  currentAxisTab = tabName;
  const tabDefs = [
    { btn: el.axisTabY, panel: el.axisPanelY, name: "y" },
    { btn: el.axisTabX, panel: el.axisPanelX, name: "x" },
    { btn: el.axisTabLines, panel: el.axisPanelLines, name: "lines" },
    { btn: el.axisTabCurves, panel: el.axisPanelCurves, name: "curves" },
  ];
  tabDefs.forEach(({ btn, panel, name }) => {
    const isActive = name === tabName;
    if (btn) btn.classList.toggle("active", isActive);
    if (panel) panel.hidden = !isActive;
  });
  updateModalFooterState();
}

[el.axisTabY, el.axisTabX, el.axisTabLines, el.axisTabCurves].forEach((tab) => {
  tab?.addEventListener("click", () => {
    if (tab.dataset.axis) switchAxisTab(tab.dataset.axis);
  });
});

window.addEventListener("resize", resizeAllPlots);

function resizeAllPlots() {
  if (el.plotsGrid) {
    const activePlots = el.plotsGrid.querySelectorAll(".plot-item");
    activePlots.forEach((p) => {
      try { Plotly.Plots.resize(p); } catch (e) {}
    });
  }
  if (el.fsOverlay && !el.fsOverlay.hidden) {
    adjustFsPlotToContentWidth();
  }
  syncScalarFirstColWidth();
}

["dragover", "dragenter"].forEach((ev) =>
  el.dropzone.addEventListener(ev, (e) => { e.preventDefault(); el.dropzone.classList.add("drag"); })
);
["dragleave", "drop"].forEach((ev) =>
  el.dropzone.addEventListener(ev, (e) => { e.preventDefault(); el.dropzone.classList.remove("drag"); })
);
el.dropzone.addEventListener("drop", (e) => {
  if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files);
});

async function uploadFiles(fileList) {
  const files = [...fileList].filter((f) => f.name.toLowerCase().endsWith(".hxml"));
  if (!files.length) return;
  el.status.textContent = "Parsing…";
  const fd = new FormData();
  files.forEach((f) => fd.append("files", f));
  try {
    const res = await fetch("/api/hxml-viewer/parse", { method: "POST", body: fd });
    const data = await res.json();
    if (data.errors?.length) console.warn("HXML parse errors:", data.errors);
    state.blocks = data.blocks || [];
    state.files = data.files || [];
    el.status.textContent = `${state.files.length} DUT(s), ${state.blocks.length} block(s)`;
    el.clearBtn.disabled = false;

    // Start with every parsed plot block selected, matching the All control.
    state.selectedBis = new Set(state.blocks.map((_, index) => index));
    if (state.blocks.length > 0) lastClickedBi = 0;
    renderTree();
    renderSelectedPlots();
  } catch (err) {
    el.status.textContent = "Parse failed";
    console.error(err);
  }
  el.fileInput.value = "";
}

function clearAll() {
  state.blocks = [];
  state.files = [];
  state.selectedBis.clear();
  state.customYScales = {};
  state.customXScales = {};
  state.customTitles = {};
  state.customColors = {};
  state.customCurveNames = {};
  state.calculatedCurves = {};
  state.mergedGroups = [];
  state.dragBi = null;
  state.dragMode = null;
  state.plotOrder = [];
  lastClickedBi = 0;
  try { sessionStorage.removeItem(PERSIST_KEY); } catch (e) {}
  if (el.leftPaneContent) el.leftPaneContent.hidden = true;
  if (el.dutList) el.dutList.innerHTML = "";
  if (el.dutCountBadge) el.dutCountBadge.textContent = "";
  el.tree.innerHTML = "";
  if (el.explorerTitle) el.explorerTitle.hidden = true;
  el.dropzone.hidden = false;
  el.scalarCard.hidden = true;
  if (el.scalarTablesWrap) el.scalarTablesWrap.innerHTML = "";
  el.clearBtn.disabled = true;
  el.status.textContent = "No files loaded";
  if (el.plotsGrid) {
    const oldPlots = el.plotsGrid.querySelectorAll(".plot-item");
    oldPlots.forEach((p) => {
      try { Plotly.purge(p); } catch (e) {}
    });
    el.plotsGrid.innerHTML = "";
  }
  showEmpty(true, "No curve blocks selected.");
}

let lastClickedBi = 0;

function renderDutList() {
  if (!el.dutList) return;
  el.dutList.innerHTML = "";
  const numDuts = state.files.length;
  if (el.dutCountBadge) {
    el.dutCountBadge.textContent = numDuts ? `${numDuts} DUT${numDuts === 1 ? "" : "s"}` : "";
  }
  state.files.forEach((file, idx) => {
    const cleanName = file.replace(/\.hxml$/i, "");
    const defaultColor = PALETTE[idx % PALETTE.length];
    const color = (state.customColors && (state.customColors[file] || state.customColors[cleanName])) || defaultColor;

    const item = document.createElement("div");
    item.className = "dut-item";
    item.title = `${cleanName}\nFile: ${file}\nDUT #${idx + 1}`;

    const colorDot = document.createElement("span");
    colorDot.className = "dut-item-color";
    colorDot.style.backgroundColor = color;

    const nameSpan = document.createElement("span");
    nameSpan.className = "dut-item-name";
    nameSpan.textContent = cleanName;

    const idxSpan = document.createElement("span");
    idxSpan.className = "dut-item-idx";
    idxSpan.textContent = `#${idx + 1}`;

    item.appendChild(colorDot);
    item.appendChild(nameSpan);
    item.appendChild(idxSpan);
    el.dutList.appendChild(item);
  });
}

function renderTree() {
  const hasData = state.blocks.length > 0 || state.files.length > 0;
  if (el.dropzone) el.dropzone.hidden = hasData;
  if (el.leftPaneContent) el.leftPaneContent.hidden = !hasData;
  if (el.explorerTitle) el.explorerTitle.hidden = state.blocks.length === 0;

  renderDutList();
  initLeftPaneSplitter();
  initPaneResizer();
  if (state.leftPaneSplitPercent && el.dutSection && el.explorerSection) {
    el.dutSection.style.flex = `0 0 ${state.leftPaneSplitPercent}%`;
    el.explorerSection.style.flex = `0 0 ${100 - state.leftPaneSplitPercent}%`;
  }

  el.tree.innerHTML = "";

  state.blocks.forEach((block, bi) => {
    const isSelected = state.selectedBis.has(bi);
    const row = document.createElement("div");
    row.className = `tree-row block-item${isSelected ? " selected" : ""}`;
    row.dataset.bi = String(bi);
    row.title = `${block.name}\nClick to select single plot (Ctrl+Click to select multiple)`;

    // Multi-select checkbox
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.className = "block-chk";
    chk.checked = isSelected;
    chk.title = "Click to select single plot (Ctrl+Click to select multiple)";
    chk.addEventListener("click", (e) => {
      e.stopPropagation();
      handleBlockClick(bi, e);
    });

    const nameSpan = document.createElement("span");
    nameSpan.className = "name";
    nameSpan.title = block.name;
    nameSpan.textContent = block.name;

    const countSpan = document.createElement("span");
    countSpan.className = "count";
    countSpan.textContent = `${block.dutCount} DUT${block.dutCount === 1 ? "" : "s"}`;

    row.appendChild(chk);
    row.appendChild(nameSpan);
    row.appendChild(countSpan);

    row.addEventListener("click", (e) => {
      handleBlockClick(bi, e);
    });

    el.tree.appendChild(row);
  });

  schedulePersist();
}

function updateTreeSelectionState() {
  const rows = el.tree.querySelectorAll(".tree-row.block-item");
  rows.forEach((row) => {
    const bi = parseInt(row.dataset.bi, 10);
    const isSel = state.selectedBis.has(bi);
    row.classList.toggle("selected", isSel);
    const chk = row.querySelector(".block-chk");
    if (chk) chk.checked = isSel;
  });
}

function handleBlockClick(bi, e) {
  const isCtrl = e && (e.ctrlKey || e.metaKey);
  const isShift = e && e.shiftKey;

  if (isShift && lastClickedBi !== null && state.blocks.length > 0) {
    const start = Math.min(lastClickedBi, bi);
    const end = Math.max(lastClickedBi, bi);
    if (!isCtrl) {
      state.selectedBis.clear();
    }
    for (let i = start; i <= end; i++) {
      state.selectedBis.add(i);
    }
    lastClickedBi = bi;
  } else if (isCtrl) {
    // Multi-selection: toggle this block with Ctrl / Cmd
    if (state.selectedBis.has(bi)) {
      state.selectedBis.delete(bi);
    } else {
      state.selectedBis.add(bi);
    }
    lastClickedBi = bi;
  } else {
    // Single-click without Ctrl: disable all other curves, enable ONLY this curve
    state.selectedBis.clear();
    state.selectedBis.add(bi);
    lastClickedBi = bi;
  }

  updateTreeSelectionState();
  renderSelectedPlots();
}

function selectAllBlocks() {
  state.selectedBis = new Set(state.blocks.map((_, i) => i));
  updateTreeSelectionState();
  renderSelectedPlots();
}

function clearSelectedBlocks() {
  state.selectedBis.clear();
  updateTreeSelectionState();
  renderSelectedPlots();
}

function formatXLabel(xName, unit) {
  const cleanUnit = (unit || "").replace(/^[\s\[\(]+|[\s\]\)]+$/g, "");
  if (FREQ_X.has(xName) || (xName && /^f(48)?$/i.test(xName)) || (cleanUnit && /^hz$/i.test(cleanUnit))) {
    return cleanUnit ? `Frequency (${cleanUnit})` : "Frequency (Hz)";
  }
  if (xName && (xName.toLowerCase() === "t" || xName.toLowerCase().startsWith("time"))) {
    return cleanUnit ? `Time (${cleanUnit})` : "Time (s)";
  }
  if (!cleanUnit) return xName || "";
  return `${xName} (${cleanUnit})`;
}

function formatYLabel(nonXSeriesMeta, blockName) {
  const primary = nonXSeriesMeta[0];
  const rawUnit = primary?.unit || "";
  const cleanUnit = rawUnit.replace(/^[\s\[\(]+|[\s\]\)]+$/g, "");
  const name = primary?.name || "";
  const bName = (blockName || "").toUpperCase();

  if (/dbspl/i.test(cleanUnit) || /dbspl/i.test(name) || bName.includes("SPL") || bName.includes("LEVEL")) {
    return cleanUnit ? `Level (${cleanUnit})` : "Level (dBSPL)";
  }
  if (cleanUnit === "%" || /thd/i.test(name) || bName.includes("THD") || bName.includes("DISTORTION")) {
    return cleanUnit ? `THD (${cleanUnit})` : "THD (%)";
  }
  if (/ohm|Ω/i.test(cleanUnit) || bName.includes("IMPEDANCE")) {
    return cleanUnit ? `Impedance (${cleanUnit})` : "Impedance (Ω)";
  }
  if (/^db$/i.test(cleanUnit)) {
    if (bName.includes("GAIN")) return "Gain (dB)";
    if (bName.includes("SENS")) return "Sensitivity (dB)";
    return name ? `${name} (dB)` : "Level (dB)";
  }
  if (cleanUnit) {
    return name && name !== cleanUnit ? `${name} (${cleanUnit})` : `(${cleanUnit})`;
  }
  return name || "";
}

function buildTracesForBlock(block, numPlots, bi) {
  if (bi === undefined && block) {
    bi = block.bi !== undefined ? block.bi : state.blocks.indexOf(block);
    if (bi < 0) bi = undefined;
  }
  const traces = [];
  let xIsFreq = false;
  let xLabel = "";
  const multiDut = block.instances.length > 1;

  const seriesMeta = block.curves.filter((c) => c.kind === "series");
  const nonXSeriesMeta = seriesMeta.filter((c) => {
    const firstInst = block.instances[0];
    return !firstInst || c.name !== firstInst.xName;
  });
  const multiSeries = nonXSeriesMeta.length > 1;

  block.instances.forEach((inst, instIdx) => {
    // Retain consistent DUT color across all plots
    const dutIdx = state.files.indexOf(inst.file);
    const baseColorIdx = dutIdx >= 0 ? dutIdx : instIdx;

    const xName = inst.xName;
    const xCurve = xName ? inst.curves[xName] : null;
    if (!xCurve || !xCurve.values || !xCurve.values.length) return;
    if (FREQ_X.has(xName) || (xName && /^f(48)?$/i.test(xName))) xIsFreq = true;
    xLabel = formatXLabel(xName, xCurve.unit);

    nonXSeriesMeta.forEach((meta, metaIdx) => {
      const c = inst.curves[meta.name];
      if (!c || !c.values || c.values.length !== xCurve.values.length) return;

      const cleanFile = inst.file.replace(/\.hxml$/i, "");
      let traceName;
      if (multiDut && multiSeries) {
        traceName = `${cleanFile} · ${meta.name}`;
      } else if (multiDut) {
        traceName = cleanFile;
      } else if (multiSeries) {
        traceName = meta.name;
      } else {
        traceName = cleanFile || meta.name;
      }

      // Assign consistent color by DUT (or by series if single DUT has multiple series)
      const colorIdx = multiSeries && !multiDut ? metaIdx : (baseColorIdx + metaIdx * 3) % PALETTE.length;
      const defaultColor = PALETTE[colorIdx];
      const defaultWidth = numPlots === 1 ? 3.2 : numPlots === 2 ? 2.8 : 2.5;

      // When there are more DUTs than PALETTE colors, cycle line dash patterns so curves remain distinct
      const cycle = Math.floor((baseColorIdx + metaIdx * 3) / PALETTE.length);
      const dashStyles = ["solid", "dash", "dot", "dashdot"];
      const defaultDash = cycle > 0 ? dashStyles[cycle % dashStyles.length] : "solid";

      // Custom color / width / dash lookup
      state.customColors = state.customColors || {};
      state.customLineWidths = state.customLineWidths || {};
      state.customLineDashes = state.customLineDashes || {};

      const biKey = bi !== undefined ? `${bi}::${traceName}` : null;
      const biCleanKey = bi !== undefined ? `${bi}::${cleanFile}` : null;
      const biInstKey = bi !== undefined ? `${bi}::${inst.file}` : null;

      const color = (biKey && state.customColors[biKey])
        || (biCleanKey && state.customColors[biCleanKey])
        || (biInstKey && state.customColors[biInstKey])
        || defaultColor;

      const lineWidth = (bi !== undefined && state.customLineWidths[bi] !== undefined)
        ? state.customLineWidths[bi]
        : (biKey && state.customLineWidths[biKey] !== undefined ? state.customLineWidths[biKey] : defaultWidth);

      const lineDash = (bi !== undefined && state.customLineDashes[bi] !== undefined)
        ? state.customLineDashes[bi]
        : (biKey && state.customLineDashes[biKey] !== undefined ? state.customLineDashes[biKey] : defaultDash);

      const cleanUnit = (meta.unit || "").replace(/^[\s\[\(]+|[\s\]\)]+$/g, "");
      const unitSuffix = cleanUnit ? ` ${cleanUnit}` : "";

      const rawTraceName = traceName;
      state.customCurveNames = state.customCurveNames || {};
      const customTraceName = bi !== undefined
        ? (state.customCurveNames[`${bi}::${rawTraceName}`] || state.customCurveNames[`${bi}::${cleanFile}`] || state.customCurveNames[`${bi}::${inst.file}`])
        : null;
      const displayTraceName = (customTraceName && customTraceName.trim()) ? customTraceName.trim() : rawTraceName;

      traces.push({
        x: xCurve.values,
        y: c.values,
        mode: "lines",
        name: displayTraceName,
        origName: rawTraceName,
        instFile: inst.file,
        line: { width: lineWidth, color: color, dash: lineDash },
        hovertemplate: `%{y:.2f}${unitSuffix}<extra></extra>`,
      });
    });
  });

  return { traces, xIsFreq, xLabel };
}

function autoLegendLayout(traces, isLogX = false, fontSize = 12, yRange = null, plotDiv = null, plotsPerRow = 3) {
  const validTraces = (traces || []).filter(
    (t) => t && t.showlegend !== false && Array.isArray(t.x) && Array.isArray(t.y) && t.x.length > 0 && t.y.length > 0
  );

  const defaultLegend = {
    orientation: "v",
    x: 0.03,
    y: 0.03,
    xanchor: "left",
    yanchor: "bottom",
    bgcolor: "#ffffff",
    bordercolor: "#000000",
    borderwidth: 1,
    itemsizing: "constant",
    itemwidth: 18,
    tracegroupgap: 0,
    font: { size: fontSize, color: "#000000", family: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif' },
  };

  if (!validTraces.length) return defaultLegend;

  // 1. Determine actual X and Y bounds of the curves
  let xMin = Infinity, xMax = -Infinity;
  let dataYMin = Infinity, dataYMax = -Infinity;

  validTraces.forEach((t) => {
    const len = Math.min(t.x.length, t.y.length);
    for (let i = 0; i < len; i++) {
      const xv = t.x[i];
      const yv = t.y[i];
      if (typeof xv !== "number" || isNaN(xv) || typeof yv !== "number" || isNaN(yv)) continue;
      if (isLogX && xv <= 0) continue;
      if (xv < xMin) xMin = xv;
      if (xv > xMax) xMax = xv;
      if (yv < dataYMin) dataYMin = yv;
      if (yv > dataYMax) dataYMax = yv;
    }
  });

  if (!isFinite(xMin) || xMax <= xMin || !isFinite(dataYMin) || dataYMax <= dataYMin) {
    return defaultLegend;
  }

  // Use the plot's actual display Y range if available
  let yMin = dataYMin;
  let yMax = dataYMax;
  if (Array.isArray(yRange) && yRange.length === 2 && isFinite(yRange[0]) && isFinite(yRange[1]) && yRange[1] > yRange[0]) {
    yMin = yRange[0];
    yMax = yRange[1];
  } else {
    const pad = (dataYMax - dataYMin) * 0.06;
    yMin -= pad;
    yMax += pad;
  }

  const logXMin = isLogX ? Math.log10(xMin) : xMin;
  const logXMax = isLogX ? Math.log10(xMax) : xMax;
  const xSpan = logXMax - logXMin;
  const ySpan = yMax - yMin;

  if (xSpan <= 0 || ySpan <= 0) return defaultLegend;

  // 2. Estimate canvas dimensions & legend size in normalized paper coordinates
  const clientW = plotDiv ? plotDiv.clientWidth : 0;
  const clientH = plotDiv ? plotDiv.clientHeight : 0;
  const plotW = clientW > 100 ? clientW : (plotsPerRow >= 4 ? 350 : plotsPerRow === 3 ? 430 : plotsPerRow === 2 ? 650 : 1000);
  const plotH = clientH > 100 ? clientH : (plotsPerRow >= 4 ? 400 : plotsPerRow === 3 ? 425 : plotsPerRow === 2 ? 490 : 550);

  const canvasW = Math.max(200, plotW - 75);
  const canvasH = Math.max(150, plotH - 80);

  const nItems = validTraces.length;
  const maxChars = Math.max(...validTraces.map((t) => (t.name ? String(t.name).length : 8)), 10);
  // Item width (18) + marker gap (6) + chars (~6.6px per char) + border padding (10)
  const estLegendWidthPx = Math.min(canvasW * 0.75, Math.max(120, 18 + 6 + maxChars * 6.6 + 10));
  // Row height (~17.5px) + border padding (8)
  const estLegendHeightPx = Math.min(canvasH * 0.75, Math.max(45, nItems * 17.5 + 8));

  const legendW = estLegendWidthPx / canvasW;
  const legendH = estLegendHeightPx / canvasH;

  // 3. Dense point sampling along curves in normalized paper coordinates [0, 1] x [0, 1]
  const curvePoints = [];
  validTraces.forEach((t) => {
    const len = Math.min(t.x.length, t.y.length);
    let prevPx = null, prevPy = null;

    for (let i = 0; i < len; i++) {
      const xv = t.x[i];
      const yv = t.y[i];
      if (typeof xv !== "number" || isNaN(xv) || typeof yv !== "number" || isNaN(yv)) continue;
      if (isLogX && xv <= 0) continue;

      const lx = isLogX ? Math.log10(xv) : xv;
      const px = Math.max(0, Math.min(1, (lx - logXMin) / xSpan));
      const py = Math.max(0, Math.min(1, (yv - yMin) / ySpan));

      // Interpolate if gap between adjacent points is noticeable to avoid missing box crossings
      if (prevPx !== null) {
        const dist = Math.hypot(px - prevPx, py - prevPy);
        if (dist > 0.02) {
          const steps = Math.min(10, Math.ceil(dist / 0.015));
          for (let s = 1; s < steps; s++) {
            const frac = s / steps;
            curvePoints.push([prevPx + (px - prevPx) * frac, prevPy + (py - prevPy) * frac]);
          }
        }
      }

      curvePoints.push([px, py]);
      prevPx = px;
      prevPy = py;
    }
  });

  if (!curvePoints.length) return defaultLegend;

  // 4. Candidate positions with exact bounding boxes in paper coordinates
  const insetX = 0.025;
  const insetY = 0.025;

  const candidates = [
    {
      id: "bottom-left",
      x: insetX,
      y: insetY,
      xanchor: "left",
      yanchor: "bottom",
      box: [insetX, insetX + legendW, insetY, insetY + legendH],
      bias: 40, // Standard preference for acoustic response curves
    },
    {
      id: "top-right",
      x: 1 - insetX,
      y: 1 - insetY,
      xanchor: "right",
      yanchor: "top",
      box: [1 - insetX - legendW, 1 - insetX, 1 - insetY - legendH, 1 - insetY],
      bias: 35, // Excellent when high frequencies roll off
    },
    {
      id: "bottom-right",
      x: 1 - insetX,
      y: insetY,
      xanchor: "right",
      yanchor: "bottom",
      box: [1 - insetX - legendW, 1 - insetX, insetY, insetY + legendH],
      bias: 15,
    },
    {
      id: "top-left",
      x: insetX,
      y: 1 - insetY,
      xanchor: "left",
      yanchor: "top",
      box: [insetX, insetX + legendW, 1 - insetY - legendH, 1 - insetY],
      bias: 5,
    },
    {
      id: "middle-left",
      x: insetX,
      y: 0.5,
      xanchor: "left",
      yanchor: "middle",
      box: [insetX, insetX + legendW, Math.max(0, 0.5 - legendH / 2), Math.min(1, 0.5 + legendH / 2)],
      bias: 2,
    },
    {
      id: "middle-right",
      x: 1 - insetX,
      y: 0.5,
      xanchor: "right",
      yanchor: "middle",
      box: [1 - insetX - legendW, 1 - insetX, Math.max(0, 0.5 - legendH / 2), Math.min(1, 0.5 + legendH / 2)],
      bias: 2,
    },
  ];

  function distToBox(px, py, [bx0, bx1, by0, by1]) {
    const dx = Math.max(0, bx0 - px, px - bx1);
    const dy = Math.max(0, by0 - py, py - by1);
    return Math.hypot(dx, dy);
  }

  // 5. Evaluate each candidate: strictly prioritize 0-overlap, then maximum clearance
  let bestCand = candidates[0];
  let bestScore = -Infinity;

  candidates.forEach((cand) => {
    let insideCount = 0;
    let nearCount = 0;
    let minDist = Infinity;
    let sumDist = 0;

    for (let i = 0; i < curvePoints.length; i++) {
      const [px, py] = curvePoints[i];
      const d = distToBox(px, py, cand.box);

      if (d === 0) {
        insideCount++;
      } else if (d < 0.02) {
        nearCount++;
      }

      if (d < minDist) minDist = d;
      sumDist += d;
    }

    const avgDist = sumDist / curvePoints.length;

    // Heavily penalize any overlap so a non-overlapping position always wins
    let score = 0;
    if (insideCount > 0 || nearCount > 0) {
      score = -50000 * insideCount - 10000 * nearCount - (1 / (minDist + 0.005)) * 1000 + cand.bias;
    } else {
      score = 100000 + minDist * 5000 + avgDist * 100 + cand.bias;
    }

    if (score > bestScore) {
      bestScore = score;
      bestCand = cand;
    }
  });

  return {
    orientation: "v",
    x: bestCand.x,
    y: bestCand.y,
    xanchor: bestCand.xanchor,
    yanchor: bestCand.yanchor,
    bgcolor: "#ffffff",
    bordercolor: "#000000",
    borderwidth: 1,
    itemsizing: "constant",
    itemwidth: 18,
    tracegroupgap: 0,
    itemclick: "toggle",
    itemdoubleclick: false,
    font: {
      size: fontSize,
      color: "#000000",
      family: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
    },
  };
}

function getBlockYRange(block) {
  let globalYMin = Infinity;
  let globalYMax = -Infinity;
  block.instances.forEach((inst) => {
    const xName = inst.xName;
    block.curves.forEach((meta) => {
      if (meta.kind !== "series" || meta.name === xName) return;
      const c = inst.curves[meta.name];
      if (!c || !Array.isArray(c.values)) return;
      for (let i = 0; i < c.values.length; i++) {
        const v = c.values[i];
        if (typeof v === "number" && !isNaN(v) && isFinite(v)) {
          if (v < globalYMin) globalYMin = v;
          if (v > globalYMax) globalYMax = v;
        }
      }
    });
  });
  if (isFinite(globalYMin) && isFinite(globalYMax) && globalYMax > globalYMin) {
    const pad = (globalYMax - globalYMin) * 0.06;
    return [globalYMin - pad, globalYMax + pad];
  }
  return null;
}

async function copyPlotToClipboard(plotDiv, btnEl) {
  if (!plotDiv) return;
  const origHtml = btnEl ? btnEl.innerHTML : null;
  try {
    if (btnEl) btnEl.textContent = "Copying…";
    // Match exact size as displayed in browser so fonts and legend are 1:1 scale
    const rect = plotDiv.getBoundingClientRect();
    const w = Math.round(rect.width) || plotDiv.clientWidth || 800;
    const h = Math.round(rect.height) || plotDiv.clientHeight || 450;
    const dataUrl = await Plotly.toImage(plotDiv, {
      format: "png",
      width: w,
      height: h,
    });
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": blob }),
    ]);
    if (btnEl) {
      btnEl.innerHTML = `<span style="color:#059669;font-weight:700">✓ Copied!</span>`;
      setTimeout(() => { btnEl.innerHTML = origHtml; }, 1800);
    }
  } catch (err) {
    console.error("Clipboard copy failed:", err);
    if (btnEl) btnEl.innerHTML = origHtml;
    alert("Could not write directly to clipboard (browser permission required). You can click Save to download the image file.");
  }
}

async function savePlotWithCustomName(plotDiv, defaultName = "plot") {
  if (!plotDiv) return;
  const cleanDefault = (defaultName || "plot").replace(/[\/\\:*?"<>|]/g, "_").trim();
  const inputName = window.prompt("Enter file name for saved plot:", cleanDefault);
  if (inputName === null) return; // User cancelled
  const trimmed = inputName.trim();
  const finalName = (trimmed || cleanDefault).replace(/\.png$/i, "");

  // Match exact size as displayed in browser
  const rect = plotDiv.getBoundingClientRect();
  const w = Math.round(rect.width) || plotDiv.clientWidth || 800;
  const h = Math.round(rect.height) || plotDiv.clientHeight || 450;
  await Plotly.downloadImage(plotDiv, {
    format: "png",
    filename: finalName,
    width: w,
    height: h,
  });
}

function escapeXml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildHxmlForPlot(block, instancesToInclude, customPlotTitle = null) {
  const instances = instancesToInclude && instancesToInclude.length ? instancesToInclude : block.instances;
  if (!instances || !instances.length) return "";

  const firstInst = instances[0];
  const dataVersion = escapeXml(firstInst.dataVersion || "0.0.0.1");
  const dataType = escapeXml(firstInst.dataType || "hiCurve");
  // Set WorkingTitle to the plot's CurveDataName / custom plot title
  const workingTitle = escapeXml(customPlotTitle || block.name || "workingTitle");

  let xml = '<?xml version="1.0" encoding="utf-8"?>\n';
  xml += '<hxml>\n';
  xml += '  <head>\n';
  xml += '    <Document>\n';
  xml += `      <DataVersion XsdVersion="${dataVersion}">${dataVersion}</DataVersion>\n`;
  xml += `      <DataType>${dataType}</DataType>\n`;
  xml += '      <LDocNode>//hxml/data</LDocNode>\n';
  xml += '      <PlatformVersion>n.a.</PlatformVersion>\n';
  xml += '    </Document>\n';
  xml += '  </head>\n';
  xml += '  <data>\n';
  xml += `    <dataset WorkingTitle="${workingTitle}">\n`;
  xml += '      <longDataSetDesc/>\n';
  xml += '      <shortDataSetDesc/>\n';
  xml += '      <acpEarhookType/>\n';
  xml += '      <v-curvedata>\n';

  instances.forEach((inst) => {
    const attrs = { ...(inst.attributes || {}) };
    // Put imported file name into each DUT's CurveDataName so user can differentiate the curve from which DUT
    const cleanFile = inst.file ? inst.file.replace(/\.hxml$/i, "") : (attrs.CurveDataName || block.name);
    attrs.CurveDataName = cleanFile;

    let attrStr = `CurveDataName="${escapeXml(attrs.CurveDataName)}"`;
    Object.keys(attrs).forEach((k) => {
      if (k !== "CurveDataName") {
        attrStr += ` ${escapeXml(k)}="${escapeXml(attrs[k])}"`;
      }
    });

    xml += `        <curvedata ${attrStr}>\n`;
    xml += '          <longCurveDesc/>\n';
    xml += '          <shortCurveDesc/>\n';

    (block.curves || []).forEach((meta) => {
      const c = inst.curves ? inst.curves[meta.name] : null;
      if (!c) return;

      const unitAttr = c.unit !== undefined && c.unit !== null ? ` unit="${escapeXml(c.unit)}"` : (meta.unit ? ` unit="${escapeXml(meta.unit)}"` : "");
      let curveText = "";
      if (c.raw !== undefined && c.raw !== null && String(c.raw).trim() !== "") {
        const rawStr = String(c.raw).trim();
        curveText = rawStr.startsWith("[") && rawStr.endsWith("]") ? rawStr : `[${rawStr}]`;
      } else if (Array.isArray(c.values) && c.values.length > 0) {
        curveText = `[${c.values.join(" ")}]`;
      } else {
        curveText = "[]";
      }

      xml += `          <curve name="${escapeXml(meta.name)}"${unitAttr}>${curveText}</curve>\n`;
    });

    xml += '        </curvedata>\n';
  });

  xml += '      </v-curvedata>\n';
  xml += '    </dataset>\n';
  xml += '  </data>\n';
  xml += '  <environment/>\n';
  xml += '</hxml>\n';

  return xml;
}

function downloadHxmlFile(content, fileName = "plot.hxml") {
  const blob = new Blob([content], { type: "application/xml;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName.endsWith(".hxml") ? fileName : `${fileName}.hxml`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let activeHxmlMenu = null;

function closeHxmlMenu() {
  if (activeHxmlMenu) {
    activeHxmlMenu.remove();
    activeHxmlMenu = null;
  }
}

document.addEventListener("click", (e) => {
  if (activeHxmlMenu && !activeHxmlMenu.contains(e.target)) {
    closeHxmlMenu();
  }
});

function handleHxmlExport(anchorBtn, block, bi) {
  if (!block || !block.instances || !block.instances.length) return;
  const currentTitle = (state.customTitles && state.customTitles[bi]) || block.name;

  if (block.instances.length === 1) {
    const inst = block.instances[0];
    const cleanFile = (inst.file || "plot").replace(/\.hxml$/i, "");
    const defaultName = `${currentTitle}_${cleanFile}`.replace(/[\/\\:*?"<>|]/g, "_").trim();
    const chosenName = window.prompt("Enter file name for exported HXML:", `${defaultName}.hxml`);
    if (chosenName === null) return;
    const finalName = (chosenName.trim() || defaultName).replace(/\.hxml$/i, "") + ".hxml";
    const xml = buildHxmlForPlot(block, [inst], currentTitle);
    downloadHxmlFile(xml, finalName);
    return;
  }

  showHxmlExportMenu(anchorBtn, block, bi, currentTitle);
}

function showHxmlExportMenu(anchorBtn, block, bi, currentTitle) {
  closeHxmlMenu();

  const menu = document.createElement("div");
  menu.className = "hxml-dropdown-menu";

  const header = document.createElement("div");
  header.className = "hxml-dropdown-header";
  header.textContent = `Export .HXML (${block.instances.length} DUTs)`;
  menu.appendChild(header);

  // Option 1: All DUTs combined
  const allItem = document.createElement("button");
  allItem.className = "hxml-dropdown-item";
  allItem.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg><span><b>All DUTs</b> (${block.instances.length} curves combined)</span>`;
  allItem.addEventListener("click", () => {
    closeHxmlMenu();
    const defaultName = `${currentTitle}_all_DUTs`.replace(/[\/\\:*?"<>|]/g, "_").trim();
    const chosenName = window.prompt("Enter file name for exported HXML (all DUTs):", `${defaultName}.hxml`);
    if (chosenName === null) return;
    const finalName = (chosenName.trim() || defaultName).replace(/\.hxml$/i, "") + ".hxml";
    const xml = buildHxmlForPlot(block, block.instances, currentTitle);
    downloadHxmlFile(xml, finalName);
  });
  menu.appendChild(allItem);

  const divider = document.createElement("hr");
  divider.className = "hxml-dropdown-divider";
  menu.appendChild(divider);

  // Individual DUT options
  block.instances.forEach((inst, idx) => {
    const cleanFile = inst.file ? inst.file.replace(/\.hxml$/i, "") : `DUT_${idx + 1}`;
    const dutIdx = state.files.indexOf(inst.file);
    const defaultColor = PALETTE[(dutIdx >= 0 ? dutIdx : idx) % PALETTE.length];
    const color = (state.customColors && (state.customColors[inst.file] || state.customColors[cleanFile])) || defaultColor;

    const item = document.createElement("button");
    item.className = "hxml-dropdown-item";
    item.title = `Export only ${cleanFile}`;
    item.innerHTML = `<span class="item-dot" style="background:${color}"></span><span>#${idx + 1}: ${escapeHtml(cleanFile)}</span>`;
    item.addEventListener("click", () => {
      closeHxmlMenu();
      const defaultName = `${cleanFile}_${currentTitle}`.replace(/[\/\\:*?"<>|]/g, "_").trim();
      const chosenName = window.prompt(`Enter file name for exported HXML (${cleanFile}):`, `${defaultName}.hxml`);
      if (chosenName === null) return;
      const finalName = (chosenName.trim() || defaultName).replace(/\.hxml$/i, "") + ".hxml";
      const xml = buildHxmlForPlot(block, [inst], currentTitle);
      downloadHxmlFile(xml, finalName);
    });
    menu.appendChild(item);
  });

  const calcs = ((state.calculatedCurves && state.calculatedCurves[bi]) || []).filter((c) => !c.pv);
  if (calcs.length) {
    const calcDivider = document.createElement("hr");
    calcDivider.className = "hxml-dropdown-divider";
    menu.appendChild(calcDivider);

    const calcHeader = document.createElement("div");
    calcHeader.className = "hxml-dropdown-header";
    calcHeader.textContent = `Calculated Curves (${calcs.length})`;
    menu.appendChild(calcHeader);

    calcs.forEach((ct) => {
      const item = document.createElement("button");
      item.className = "hxml-dropdown-item";
      item.title = `Export calculated curve: ${ct.name}`;
      const color = ct.line?.color || "#ef4444";
      item.innerHTML = `<span class="item-dot" style="background:${color}"></span><span>${escapeHtml(ct.name)}</span>`;
      item.addEventListener("click", () => {
        closeHxmlMenu();
        const cleanName = ct.name.replace(/[\/\\:*?"<>|]/g, "_").trim();
        const defaultName = `${currentTitle}_${cleanName}`;
        const chosenName = window.prompt(`Enter file name for exported HXML (${ct.name}):`, `${defaultName}.hxml`);
        if (chosenName === null) return;
        const finalName = (chosenName.trim() || defaultName).replace(/\.hxml$/i, "") + ".hxml";
        const xml = buildHxmlForCalculatedCurve(block, ct, currentTitle);
        downloadHxmlFile(xml, finalName);
      });
      menu.appendChild(item);
    });
  }

  document.body.appendChild(menu);
  activeHxmlMenu = menu;

  const rect = anchorBtn.getBoundingClientRect();
  const menuWidth = 280;
  let top = rect.bottom + 4;
  let left = rect.left;

  if (left + menuWidth > window.innerWidth - 12) {
    left = window.innerWidth - menuWidth - 12;
  }
  if (top + 250 > window.innerHeight && rect.top > 250) {
    top = rect.top - menu.offsetHeight - 4;
  }

  menu.style.top = `${Math.max(8, top)}px`;
  menu.style.left = `${Math.max(8, left)}px`;
}

function buildHxmlForCalculatedCurve(block, calcTrace, workingTitle) {
  const firstInst = block?.instances?.[0] || {};
  const dataVersion = escapeXml(firstInst.dataVersion || "0.0.0.1");
  const dataType = escapeXml(firstInst.dataType || "hiCurve");
  const wt = escapeXml(workingTitle || "workingTitle");
  const xName = firstInst.xName || "f";
  const xUnit = firstInst.curves?.[xName]?.unit || "Hz";
  const yName = calcTrace.name;

  let xml = '<?xml version="1.0" encoding="utf-8"?>\n';
  xml += '<hxml>\n';
  xml += '  <head>\n';
  xml += '    <Document>\n';
  xml += `      <DataVersion XsdVersion="${dataVersion}">${dataVersion}</DataVersion>\n`;
  xml += `      <DataType>${dataType}</DataType>\n`;
  xml += '      <LDocNode>//hxml/data</LDocNode>\n';
  xml += '      <PlatformVersion>n.a.</PlatformVersion>\n';
  xml += '    </Document>\n';
  xml += '  </head>\n';
  xml += '  <data>\n';
  xml += `    <dataset WorkingTitle="${wt}">\n`;
  xml += '      <longDataSetDesc/>\n';
  xml += '      <shortDataSetDesc/>\n';
  xml += '      <acpEarhookType/>\n';
  xml += '      <v-curvedata>\n';
  xml += `        <curvedata CurveDataName="${escapeXml(calcTrace.name)}">\n`;
  xml += '          <longCurveDesc/>\n';
  xml += '          <shortCurveDesc/>\n';
  xml += `          <curve name="${escapeXml(xName)}" unit="${escapeXml(xUnit)}">[${(calcTrace.x || []).join(" ")}]</curve>\n`;
  xml += `          <curve name="${escapeXml(yName)}" unit="dBSPL">[${(calcTrace.y || []).map((v) => (v !== null && isFinite(v)) ? v : 0).join(" ")}]</curve>\n`;
  xml += '        </curvedata>\n';
  xml += '      </v-curvedata>\n';
  xml += '    </dataset>\n';
  xml += '  </data>\n';
  xml += '  <environment/>\n';
  xml += '</hxml>\n';
  return xml;
}

function handleMergedHxmlExport(anchorBtn, mg) {
  const validBis = mg.bis.filter((b) => state.selectedBis.has(b) && state.blocks[b]);
  if (!validBis.length) return;
  const currentTitle = (state.customTitles && state.customTitles[mg.id]) || mg.label;
  const defaultName = `${currentTitle}_merged`.replace(/[\/\\:*?"<>|]/g, "_").trim();
  const chosenName = window.prompt("Enter file name for exported merged HXML:", `${defaultName}.hxml`);
  if (chosenName === null) return;
  const finalName = (chosenName.trim() || defaultName).replace(/\.hxml$/i, "") + ".hxml";

  const firstBlock = state.blocks[validBis[0]];
  const firstInst = firstBlock.instances[0] || {};
  const dataVersion = escapeXml(firstInst.dataVersion || "0.0.0.1");
  const dataType = escapeXml(firstInst.dataType || "hiCurve");
  const workingTitle = escapeXml(currentTitle || "workingTitle");

  let xml = '<?xml version="1.0" encoding="utf-8"?>\n';
  xml += '<hxml>\n';
  xml += '  <head>\n';
  xml += '    <Document>\n';
  xml += `      <DataVersion XsdVersion="${dataVersion}">${dataVersion}</DataVersion>\n`;
  xml += `      <DataType>${dataType}</DataType>\n`;
  xml += '      <LDocNode>//hxml/data</LDocNode>\n';
  xml += '      <PlatformVersion>n.a.</PlatformVersion>\n';
  xml += '    </Document>\n';
  xml += '  </head>\n';
  xml += '  <data>\n';
  xml += `    <dataset WorkingTitle="${workingTitle}">\n`;
  xml += '      <longDataSetDesc/>\n';
  xml += '      <shortDataSetDesc/>\n';
  xml += '      <acpEarhookType/>\n';
  xml += '      <v-curvedata>\n';

  validBis.forEach((bIdx) => {
    const blk = state.blocks[bIdx];
    blk.instances.forEach((inst) => {
      const attrs = { ...(inst.attributes || {}) };
      const cleanFile = inst.file ? inst.file.replace(/\.hxml$/i, "") : (attrs.CurveDataName || blk.name);
      const cdName = `[${blk.name}] ${cleanFile}`;
      attrs.CurveDataName = cdName;
      let attrStr = `CurveDataName="${escapeXml(attrs.CurveDataName)}"`;
      Object.keys(attrs).forEach((k) => {
        if (k !== "CurveDataName") {
          attrStr += ` ${escapeXml(k)}="${escapeXml(attrs[k])}"`;
        }
      });
      xml += `        <curvedata ${attrStr}>\n`;
      xml += '          <longCurveDesc/>\n';
      xml += '          <shortCurveDesc/>\n';
      (blk.curves || []).forEach((meta) => {
        const c = inst.curves ? inst.curves[meta.name] : null;
        if (!c) return;
        const unitAttr = c.unit !== undefined && c.unit !== null ? ` unit="${escapeXml(c.unit)}"` : (meta.unit ? ` unit="${escapeXml(meta.unit)}"` : "");
        let curveText = "";
        if (c.raw !== undefined && c.raw !== null && String(c.raw).trim() !== "") {
          const rawStr = String(c.raw).trim();
          curveText = rawStr.startsWith("[") && rawStr.endsWith("]") ? rawStr : `[${rawStr}]`;
        } else if (Array.isArray(c.values) && c.values.length > 0) {
          curveText = `[${c.values.join(" ")}]`;
        } else {
          curveText = "[]";
        }
        xml += `          <curve name="${escapeXml(meta.name)}"${unitAttr}>${curveText}</curve>\n`;
      });
      xml += '        </curvedata>\n';
    });
  });

  xml += '      </v-curvedata>\n';
  xml += '    </dataset>\n';
  xml += '  </data>\n';
  xml += '  <environment/>\n';
  xml += '</hxml>\n';

  downloadHxmlFile(xml, finalName);
}

function resetPlotView(bi, plotDiv, reRenderFn) {
  if (!plotDiv) return;
  // Clear any custom scales for this plot so it restores the default scale
  if (state.customYScales) delete state.customYScales[bi];
  if (state.customXScales) delete state.customXScales[bi];

  state.plotRevisions = state.plotRevisions || {};
  state.plotRevisions[bi] = (state.plotRevisions[bi] || 0) + 1;

  // Fully purge plotDiv so Plotly discards all zoom, pan, autorange, and user interaction states
  try {
    Plotly.purge(plotDiv);
  } catch (e) {}

  if (typeof reRenderFn === "function") {
    reRenderFn();
  }
}

function initLeftPaneSplitter() {
  const splitter = el.leftPaneSplitter;
  if (!splitter || splitter._hasInit) return;
  splitter._hasInit = true;

  let startY = 0;
  let startTopHeight = 0;
  let isDragging = false;

  splitter.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    isDragging = true;
    startY = e.clientY;
    startTopHeight = el.dutSection ? el.dutSection.offsetHeight : 0;
    splitter.classList.add("is-dragging");
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (ev) => {
      if (!isDragging) return;
      const deltaY = ev.clientY - startY;
      const totalAvailable = el.leftPaneContent ? el.leftPaneContent.clientHeight - splitter.offsetHeight : 400;
      const newTopPx = Math.max(50, Math.min(totalAvailable - 60, startTopHeight + deltaY));
      const topPercent = (newTopPx / totalAvailable) * 100;
      const bottomPercent = 100 - topPercent;

      state.leftPaneSplitPercent = topPercent;
      if (el.dutSection) el.dutSection.style.flex = `0 0 ${topPercent}%`;
      if (el.explorerSection) el.explorerSection.style.flex = `0 0 ${bottomPercent}%`;
    };

    const onMouseUp = () => {
      isDragging = false;
      splitter.classList.remove("is-dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  });
}

// Drag the handle between the left pane (DUT list + Data Explorer) and the plot pane to
// resize their widths; width is kept in the --pane-w CSS var that .split's grid track reads.
function initPaneResizer() {
  const resizer = el.paneResizer;
  const splitEl = el.splitEl;
  if (!resizer || !splitEl || resizer._hasInit) return;
  resizer._hasInit = true;

  let isDragging = false;
  let startX = 0;
  let startWidth = 0;

  resizer.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    isDragging = true;
    startX = e.clientX;
    startWidth = el.leftPane ? el.leftPane.offsetWidth : 320;
    resizer.classList.add("is-dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (ev) => {
      if (!isDragging) return;
      const maxWidth = splitEl.clientWidth - 200;
      const w = Math.max(220, Math.min(maxWidth, startWidth + (ev.clientX - startX)));
      splitEl.style.setProperty("--pane-w", `${w}px`);
    };

    const onMouseUp = () => {
      isDragging = false;
      resizer.classList.remove("is-dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  });
}

function renderSelectedPlots() {
  resetCurveSearch();
  const selectedIndices = Array.from(state.selectedBis).sort((a, b) => a - b);
  const selectedBlocks = selectedIndices.map((i) => ({ bi: i, block: state.blocks[i] })).filter((x) => !!x.block);

  if (!selectedBlocks.length) {
    showEmpty(true, "Select one or more curve data blocks on the left to plot them.");
    if (el.plotsGrid) el.plotsGrid.innerHTML = "";
    el.scalarCard.hidden = true;
    if (el.scalarTablesWrap) el.scalarTablesWrap.innerHTML = "";
    schedulePersist();
    return;
  }

  const plottableBlocks = [];
  const blocksWithScalars = [];

  selectedBlocks.forEach(({ bi, block }) => {
    const seriesMeta = block.curves.filter((c) => c.kind === "series");
    const nonXSeriesMeta = seriesMeta.filter((c) => {
      const firstInst = block.instances[0];
      return !firstInst || c.name !== firstInst.xName;
    });

    let hasSeries = false;
    block.instances.forEach((inst) => {
      nonXSeriesMeta.forEach((meta) => {
        const c = inst.curves[meta.name];
        if (c && c.values && c.values.length > 0) hasSeries = true;
      });
    });

    const scalarCols = block.curves.filter((c) => c.kind !== "series");

    if (hasSeries) {
      plottableBlocks.push({ bi, block, nonXSeriesMeta });
    }
    if (scalarCols.length > 0) {
      blocksWithScalars.push({ bi, block, scalarCols });
    }
  });

  // Sync plotOrder: keep existing order, strip deselected, append newcomers at end
  const allSelectedBis = Array.from(state.selectedBis);
  state.plotOrder = [
    ...state.plotOrder.filter((b) => state.selectedBis.has(b) && state.blocks[b]),
    ...allSelectedBis.filter((b) => !state.plotOrder.includes(b)),
  ];

  // Sort plottableBlocks to match plotOrder
  plottableBlocks.sort((a, b) => {
    const ia = state.plotOrder.indexOf(a.bi);
    const ib = state.plotOrder.indexOf(b.bi);
    return (ia === -1 ? 9999 : ia) - (ib === -1 ? 9999 : ib);
  });

  const numPlots = plottableBlocks.length;

  if (numPlots === 0) {
    el.plotWrap.hidden = true;
    if (blocksWithScalars.length > 0) {
      el.empty.hidden = true;
    } else {
      showEmpty(true, "No plottable series or scalar values in selected block(s).");
    }
    renderScalarTables(blocksWithScalars);
    return;
  }

  el.empty.hidden = true;
  el.plotWrap.hidden = false;

  // Set grid layout class: cols-1, cols-2, cols-3, cols-4
  const targetCols = numPlots === 1 ? 1 : Math.min(numPlots, state.plotsPerRow || 3);
  const gridClass = `cols-${targetCols}${numPlots === 1 ? " single-plot" : ""}`;
  el.plotsGrid.className = `plots-grid ${gridClass}`;

  if (el.plotsPerRowSelect && String(state.plotsPerRow) !== el.plotsPerRowSelect.value) {
    el.plotsPerRowSelect.value = String(state.plotsPerRow);
  }

  // Purge old Plotly instances to avoid memory leaks
  const oldPlots = el.plotsGrid.querySelectorAll(".plot-item");
  oldPlots.forEach((p) => {
    try { Plotly.purge(p); } catch (e) {}
  });
  el.plotsGrid.innerHTML = "";

  // Update plot toolbar status
  if (el.plotBlocksSummary) {
    if (numPlots === 1) {
      el.plotBlocksSummary.textContent = plottableBlocks[0].block.name;
    } else {
      el.plotBlocksSummary.textContent = `${numPlots} Plots Active`;
    }
  }

  if (el.plotInfoBadge) {
    const numDuts = state.files.length;
    if (numPlots === 1) {
      el.plotInfoBadge.textContent = `${numDuts} DUT${numDuts === 1 ? "" : "s"} · Single plot`;
    } else {
      const inRow = targetCols;
      el.plotInfoBadge.textContent = `${numDuts} DUT${numDuts === 1 ? "" : "s"} · ${numPlots} plots (${inRow} in a row)`;
    }
  }

  // Create card and plot for each selected curve block
  plottableBlocks.forEach(({ bi, block, nonXSeriesMeta }, idx) => {
    const card = document.createElement("div");
    card.className = "plot-card";

    // Card header (action buttons & drag grip)
    const cardHeader = document.createElement("div");
    cardHeader.className = "plot-card-header";

    const actionsDiv = document.createElement("div");
    actionsDiv.className = "plot-card-actions";

    // Plot element
    const plotDiv = document.createElement("div");
    plotDiv.className = "plot-item";
    plotDiv.id = `plot-item-block-${bi}`;

    const copyBtn = document.createElement("button");
    copyBtn.className = "plot-card-btn";
    copyBtn.title = "Copy plot to clipboard as PNG image";
    copyBtn.innerHTML = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:2px"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy`;
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      copyPlotToClipboard(plotDiv, copyBtn);
    });

    const saveBtn = document.createElement("button");
    saveBtn.className = "plot-card-btn";
    saveBtn.title = "Save plot as PNG (prompts for file name)";
    saveBtn.innerHTML = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:2px"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>Save`;
    saveBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const currentName = (state.customTitles && state.customTitles[bi]) || block.name;
      savePlotWithCustomName(plotDiv, currentName);
    });

    const hxmlBtn = document.createElement("button");
    hxmlBtn.className = "plot-card-btn";
    hxmlBtn.title = "Export this plot as .hxml file";
    hxmlBtn.innerHTML = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:2px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>HXML`;
    hxmlBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      handleHxmlExport(hxmlBtn, block, bi);
    });

    const propBtn = document.createElement("button");
    propBtn.className = "plot-card-btn";
    propBtn.title = "Configure plot properties & axis scales (or right-click plot)";
    propBtn.innerHTML = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:2px"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>Property`;
    propBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openPropertyModal(bi, block.name, plotDiv);
    });

    const closeBtn = document.createElement("button");
    closeBtn.className = "plot-card-close";
    closeBtn.title = `Close plot for ${block.name}`;
    closeBtn.innerHTML = "&times;";
    closeBtn.addEventListener("click", () => {
      state.selectedBis.delete(bi);
      updateTreeSelectionState();
      renderSelectedPlots();
    });

    const expandBtn = document.createElement("button");
    expandBtn.className = "plot-card-expand";
    expandBtn.title = "View in fullscreen (F key or double-click)";
    expandBtn.innerHTML = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
    expandBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const currentName = (state.customTitles && state.customTitles[bi]) || block.name;
      openFullscreen(bi, currentName);
    });

    const refreshBtn = document.createElement("button");
    refreshBtn.className = "plot-card-btn";
    refreshBtn.title = "Reset plot view & zoom to default (refresh plot)";
    refreshBtn.innerHTML = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:2px"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>Refresh`;
    refreshBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      resetPlotView(bi, plotDiv, () => {
        const curYRange = getBlockYRange(block);
        drawSinglePlot(plotDiv, { traces, xIsFreq, xLabel, yLabel, yRange: curYRange }, block.name, numPlots, bi, targetCols);
      });
    });

    actionsDiv.appendChild(copyBtn);
    actionsDiv.appendChild(saveBtn);
    actionsDiv.appendChild(hxmlBtn);
    actionsDiv.appendChild(refreshBtn);
    actionsDiv.appendChild(expandBtn);
    actionsDiv.appendChild(propBtn);
    actionsDiv.appendChild(closeBtn);

    // --- Grip icon for reorder drag ---
    const gripIcon = document.createElement("div");
    gripIcon.className = "drag-grip";
    gripIcon.title = "Drag to reorder plot";
    gripIcon.innerHTML = `<svg viewBox="0 0 10 16" width="10" height="16" fill="currentColor"><circle cx="3" cy="3" r="1.2"/><circle cx="7" cy="3" r="1.2"/><circle cx="3" cy="8" r="1.2"/><circle cx="7" cy="8" r="1.2"/><circle cx="3" cy="13" r="1.2"/><circle cx="7" cy="13" r="1.2"/></svg>`;

    cardHeader.appendChild(gripIcon);
    cardHeader.appendChild(actionsDiv);
    card.appendChild(cardHeader);

    card.appendChild(plotDiv);

    wirePlotPropertyContextMenu(plotDiv, bi, block.name);

    el.plotsGrid.appendChild(card);

    const { traces, xIsFreq, xLabel } = buildTracesForBlock(block, numPlots, bi);
    const yLabel = formatYLabel(nonXSeriesMeta, block.name);
    const yRange = getBlockYRange(block);

    drawSinglePlot(plotDiv, { traces, xIsFreq, xLabel, yLabel, yRange }, block.name, numPlots, bi, targetCols);

    // Double-click plot to open fullscreen. Plotly's drag layer swallows the native
    // "dblclick" event entirely, so detect the double-click manually from two "click"
    // events instead - "click" reliably bubbles out of Plotly.
    let lastClickTime = 0;
    plotDiv.addEventListener("click", () => {
      const now = Date.now();
      if (now - lastClickTime < 400) {
        lastClickTime = 0;
        openFullscreen(bi, block.name);
      } else {
        lastClickTime = now;
      }
    }, true);

    // --- Drag-to-reorder & drag-to-merge wiring ---
    let dragEnterCount = 0;
    let nextDragIsReorder = false;
    card.draggable = true;
    card.dataset.dragBi = String(bi);

    // Grip icon or header mousedown marks the NEXT drag as a reorder
    cardHeader.addEventListener("mousedown", (e) => {
      if (e.target.closest("button") || e.target.closest(".action-btn")) return;
      nextDragIsReorder = true;
    });
    cardHeader.addEventListener("mouseup", () => { nextDragIsReorder = false; });
    window.addEventListener("mouseup", () => { nextDragIsReorder = false; });

    card.addEventListener("dragstart", (e) => {
      // Never initiate plot-card drag when interacting inside the plot legend
      const inLegend = (e.target && e.target.closest && e.target.closest("g.legend")) ||
                       (document.elementFromPoint(e.clientX, e.clientY)?.closest("g.legend"));
      if (inLegend) {
        e.preventDefault();
        nextDragIsReorder = false;
        return;
      }

      state.dragBi = bi;
      state.dragMode = nextDragIsReorder ? "reorder" : "merge";
      nextDragIsReorder = false;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(bi));
      const cls = state.dragMode === "reorder" ? "is-reordering" : "is-dragging";
      setTimeout(() => card.classList.add(cls), 0);
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("is-dragging", "is-reordering");
      state.dragBi = null;
      state.dragMode = null;
      document.querySelectorAll(".plot-card.drop-target, .plot-card.reorder-target")
        .forEach((c) => c.classList.remove("drop-target", "reorder-target"));
    });
    card.addEventListener("dragover", (e) => {
      if (state.dragBi === null || state.dragBi === bi) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });
    card.addEventListener("dragenter", (e) => {
      if (state.dragBi === null || state.dragBi === bi) return;
      e.preventDefault();
      dragEnterCount++;
      card.classList.add(state.dragMode === "reorder" ? "reorder-target" : "drop-target");
    });
    card.addEventListener("dragleave", () => {
      dragEnterCount--;
      if (dragEnterCount <= 0) {
        dragEnterCount = 0;
        card.classList.remove("drop-target", "reorder-target");
      }
    });
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      dragEnterCount = 0;
      card.classList.remove("drop-target", "reorder-target");
      const srcBi = state.dragBi;
      const mode = state.dragMode;
      if (srcBi === null || srcBi === bi) return;
      state.dragBi = null;
      state.dragMode = null;

      if (mode === "reorder") {
        // --- Reorder: move srcBi to position of bi in plotOrder ---
        const fromIdx = state.plotOrder.indexOf(srcBi);
        const toIdx   = state.plotOrder.indexOf(bi);
        if (fromIdx !== -1 && toIdx !== -1) {
          state.plotOrder.splice(fromIdx, 1);
          state.plotOrder.splice(toIdx, 0, srcBi);
        }
        renderSelectedPlots();
        return;
      }

      // --- Merge: combine plots ---
      const alreadyMerged = state.mergedGroups.some(
        (g) => g.bis.includes(srcBi) && g.bis.includes(bi)
      );
      if (alreadyMerged) return;

      const existingGroup = state.mergedGroups.find(
        (g) => g.bis.includes(srcBi) || g.bis.includes(bi)
      );
      if (existingGroup) {
        if (!existingGroup.bis.includes(srcBi)) existingGroup.bis.push(srcBi);
        if (!existingGroup.bis.includes(bi)) existingGroup.bis.push(bi);
        existingGroup.label = existingGroup.bis.map((b) => state.blocks[b]?.name ?? b).join(" + ");
      } else {
        const newId = `mg-${Date.now()}`;
        const label = [srcBi, bi].map((b) => state.blocks[b]?.name ?? b).join(" + ");
        state.mergedGroups.push({ id: newId, bis: [srcBi, bi], label });
      }

      renderSelectedPlots();
    });
  });

  // --- Render merged plots ---
  state.mergedGroups.forEach((mg) => {
    // Only render if all blocks in the group are still selected
    const validBis = mg.bis.filter((b) => state.selectedBis.has(b) && state.blocks[b]);
    if (validBis.length < 2) return;

    const mgCard = document.createElement("div");
    mgCard.className = "plot-card plot-card-merged";

    const mgHeader = document.createElement("div");
    mgHeader.className = "plot-card-header";

    const mgGrip = document.createElement("div");
    mgGrip.className = "drag-grip";
    mgGrip.title = "Drag to reorder plot";
    mgGrip.innerHTML = `<svg viewBox="0 0 10 16" width="10" height="16" fill="currentColor"><circle cx="3" cy="3" r="1.2"/><circle cx="7" cy="3" r="1.2"/><circle cx="3" cy="8" r="1.2"/><circle cx="7" cy="8" r="1.2"/><circle cx="3" cy="13" r="1.2"/><circle cx="7" cy="13" r="1.2"/></svg>`;

    const mgBadge = document.createElement("span");
    mgBadge.className = "merged-badge";
    mgBadge.textContent = "MERGED";
    mgBadge.style.marginLeft = "4px";

    const mgLeftWrap = document.createElement("div");
    mgLeftWrap.style.display = "flex";
    mgLeftWrap.style.alignItems = "center";
    mgLeftWrap.appendChild(mgGrip);
    mgLeftWrap.appendChild(mgBadge);

    const mgActions = document.createElement("div");
    mgActions.className = "plot-card-actions";

    const mgPropBtn = document.createElement("button");
    mgPropBtn.className = "plot-card-btn";
    mgPropBtn.title = "Configure plot properties & axis scales";
    mgPropBtn.innerHTML = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:2px"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>Property`;

    const closeBtn = document.createElement("button");
    closeBtn.className = "plot-card-close";
    closeBtn.title = "Remove merged plot";
    closeBtn.innerHTML = "&times;";
    closeBtn.addEventListener("click", () => {
      state.mergedGroups = state.mergedGroups.filter((g) => g.id !== mg.id);
      renderSelectedPlots();
    });

    const mgExpandBtn = document.createElement("button");
    mgExpandBtn.className = "plot-card-expand";
    mgExpandBtn.title = "View merged plot in fullscreen";
    mgExpandBtn.innerHTML = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
    mgExpandBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const currentName = (state.customTitles && state.customTitles[mg.id]) || mg.label;
      openFullscreen(mg.id, currentName);
    });

    const mgPlotDiv = document.createElement("div");
    mgPlotDiv.className = "plot-item";
    mgPlotDiv.id = `plot-item-merged-${mg.id}`;

    const mgCopyBtn = document.createElement("button");
    mgCopyBtn.className = "plot-card-btn";
    mgCopyBtn.title = "Copy merged plot to clipboard as PNG image";
    mgCopyBtn.innerHTML = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:2px"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy`;
    mgCopyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      copyPlotToClipboard(mgPlotDiv, mgCopyBtn);
    });

    const mgSaveBtn = document.createElement("button");
    mgSaveBtn.className = "plot-card-btn";
    mgSaveBtn.title = "Save merged plot as PNG (prompts for file name)";
    mgSaveBtn.innerHTML = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:2px"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>Save`;
    mgSaveBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const currentName = (state.customTitles && state.customTitles[mg.id]) || mg.label;
      savePlotWithCustomName(mgPlotDiv, currentName);
    });

    const mgHxmlBtn = document.createElement("button");
    mgHxmlBtn.className = "plot-card-btn";
    mgHxmlBtn.title = "Export merged plot as .hxml file";
    mgHxmlBtn.innerHTML = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:2px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>HXML`;
    mgHxmlBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      handleMergedHxmlExport(mgHxmlBtn, mg);
    });

    const mgRefreshBtn = document.createElement("button");
    mgRefreshBtn.className = "plot-card-btn";
    mgRefreshBtn.title = "Reset plot view & zoom to default (refresh plot)";
    mgRefreshBtn.innerHTML = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:2px"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>Refresh`;
    mgRefreshBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      resetPlotView(mg.id, mgPlotDiv, () => {
        drawSinglePlot(mgPlotDiv, { traces: mergedTraces, xIsFreq: mergedXIsFreq, xLabel: mergedXLabel, yLabel: mergedYLabel, yRange: mergedYRange }, mg.label, mgTotalPlots, mg.id, targetCols);
      });
    });

    mgActions.appendChild(mgCopyBtn);
    mgActions.appendChild(mgSaveBtn);
    mgActions.appendChild(mgHxmlBtn);
    mgActions.appendChild(mgRefreshBtn);
    mgActions.appendChild(mgExpandBtn);
    mgActions.appendChild(mgPropBtn);
    mgActions.appendChild(closeBtn);
    mgHeader.appendChild(mgLeftWrap);
    mgHeader.appendChild(mgActions);
    mgCard.appendChild(mgHeader);
    mgCard.appendChild(mgPlotDiv);

    // Wire Property button and context menu after plotDiv is created
    mgPropBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openPropertyModal(mg.id, mg.label, mgPlotDiv);
    });
    wirePlotPropertyContextMenu(mgPlotDiv, mg.id, mg.label);
    // Double-click plot to open fullscreen (same behavior as a regular single-DUT plot).
    // Plotly's drag layer swallows the native "dblclick" event entirely, so detect the
    // double-click manually from two "click" events instead.
    let mgLastClickTime = 0;
    mgPlotDiv.addEventListener("click", () => {
      const now = Date.now();
      if (now - mgLastClickTime < 400) {
        mgLastClickTime = 0;
        const currentName = (state.customTitles && state.customTitles[mg.id]) || mg.label;
        openFullscreen(mg.id, currentName);
      } else {
        mgLastClickTime = now;
      }
    }, true);

    const memberPositions = mg.bis
      .map((memberBi) => plottableBlocks.findIndex((item) => item.bi === memberBi))
      .filter((position) => position >= 0);
    const laterPosition = Math.max(...memberPositions);
    const nextPlot = plottableBlocks[laterPosition + 1];
    const nextPlotCard = nextPlot
      ? document.getElementById(`plot-item-block-${nextPlot.bi}`)?.closest(".plot-card")
      : null;
    if (nextPlotCard) el.plotsGrid.insertBefore(mgCard, nextPlotCard);
    else el.plotsGrid.appendChild(mgCard);

    // Build merged traces: combine all blocks
    const mgTotalPlots = numPlots + state.mergedGroups.length;
    let mergedTraces = [];
    let mergedXIsFreq = false;
    let mergedXLabel = "";
    let mergedYMin = Infinity, mergedYMax = -Infinity;

    validBis.forEach((b) => {
      const blk = state.blocks[b];
      const { traces: bt, xIsFreq: bxf, xLabel: bxl } = buildTracesForBlock(blk, mgTotalPlots, b);
      if (bxf) mergedXIsFreq = true;
      if (bxl) mergedXLabel = bxl;
      // Prefix trace names with block name for clarity
      bt.forEach((t) => {
        mergedTraces.push({ ...t, name: `[${escapeHtml(blk.name)}] ${t.name}` });
      });
      blk.instances.forEach((inst) => {
        const xName = inst.xName;
        blk.curves.forEach((meta) => {
          if (meta.kind !== "series" || meta.name === xName) return;
          const c = inst.curves[meta.name];
          if (!c || !Array.isArray(c.values)) return;
          c.values.forEach((v) => {
            if (typeof v === "number" && isFinite(v)) {
              if (v < mergedYMin) mergedYMin = v;
              if (v > mergedYMax) mergedYMax = v;
            }
          });
        });
      });
    });

    const mergedYRange = (isFinite(mergedYMin) && isFinite(mergedYMax) && mergedYMax > mergedYMin)
      ? (() => { const pad = (mergedYMax - mergedYMin) * 0.06; return [mergedYMin - pad, mergedYMax + pad]; })()
      : null;

    const mergedNonXMeta = validBis.flatMap((b) => {
      const blk = state.blocks[b];
      return blk.curves.filter((c) => c.kind === "series" && (!blk.instances[0] || c.name !== blk.instances[0].xName));
    });
    const mergedYLabel = formatYLabel(mergedNonXMeta, mg.label);

    drawSinglePlot(mgPlotDiv, { traces: mergedTraces, xIsFreq: mergedXIsFreq, xLabel: mergedXLabel, yLabel: mergedYLabel, yRange: mergedYRange }, mg.label, mgTotalPlots, mg.id, targetCols);
  });

  renderScalarTables(blocksWithScalars);

  window.requestAnimationFrame(() => {
    resizeAllPlots();
  });
  schedulePersist();
}

const EYE_OPEN_SVG = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_OFF_SVG = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.45;"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

function updateToggleAllBtnState(knownVisible) {
  if (!el.fsToggleAllBtn) return;
  let anyVisible = knownVisible;
  if (anyVisible === undefined) {
    const traces = el.fsPlotDiv?.data || [];
    anyVisible = traces.some((t) => t.visible !== "legendonly" && t.visible !== false);
  }
  if (anyVisible) {
    el.fsToggleAllBtn.innerHTML = `${EYE_OPEN_SVG} Hide All`;
    el.fsToggleAllBtn.title = "Hide all curves at once";
  } else {
    el.fsToggleAllBtn.innerHTML = `${EYE_OFF_SVG} Show All`;
    el.fsToggleAllBtn.title = "Unhide / show all curves at once";
  }
}

function toggleAllFullscreenCurves() {
  if (!el.fsPlotDiv || !el.fsPlotDiv.data) return;
  const traces = el.fsPlotDiv.data;
  if (!traces.length) return;

  const anyVisible = traces.some((t) => t.visible !== "legendonly" && t.visible !== false);
  const nextVis = anyVisible ? "legendonly" : true;

  try {
    Plotly.restyle(el.fsPlotDiv, { visible: nextVis });
  } catch (e) {}

  const bi = state.fsPlotInfo?.bi;
  if (bi !== undefined && bi !== null && state.calculatedCurves && state.calculatedCurves[bi]) {
    state.calculatedCurves[bi].forEach((c) => {
      c.visible = nextVis;
      if (c.pv) {
        if (nextVis === true) drawPvOverlay(c.calcId, c.pv);
        else removePvOverlay(c.calcId);
      }
    });
    renderFsCalculatedCurvesList(bi);
    renderFsFeatureDetails();
    schedulePersist();
  }

  updateToggleAllBtnState(!anyVisible);
}

function adjustFsPlotToContentWidth() {
  const plotDiv = el.fsPlotDiv || document.getElementById("fs-plot-div");
  const wrap = el.fsPlotWrap || document.getElementById("fs-plot-wrap");
  const content = document.getElementById("fs-content");
  if (!plotDiv || !content || !el.fsOverlay || el.fsOverlay.hidden) return;

  const isCustom = wrap && wrap.classList.contains("is-custom-size");
  const contentW = content.clientWidth;

  if (isCustom) {
    // If custom width exceeds available content space, constrain it to prevent overflowing behind right panel
    const maxW = Math.max(360, contentW - 20);
    if (wrap.offsetWidth > maxW) {
      wrap.style.width = `${maxW}px`;
      const plotW = Math.max(320, maxW - 28);
      plotDiv.style.width = `${plotW}px`;
      Plotly.relayout(plotDiv, { width: plotW })
        .catch(() => {})
        .finally(() => {
          try { Plotly.Plots.resize(plotDiv); } catch (e) {}
        });
    } else {
      try { Plotly.Plots.resize(plotDiv); } catch (e) {}
    }
  } else {
    // Default fullscreen view (auto-width):
    if (plotDiv.layout) {
      delete plotDiv.layout.width;
      delete plotDiv.layout.height;
      plotDiv.layout.autosize = true;
    }
    if (wrap) {
      wrap.style.width = "";
      wrap.style.height = "";
    }
    plotDiv.style.width = "";
    plotDiv.style.height = "";

    // Never delete _fullLayout.width/height: Plotly copies them on every later react() and throws NaN axis-scaling errors.
    try { Plotly.Plots.resize(plotDiv); } catch (e) {}
  }
}

function resetFsPlotSize(isClosing = false) {
  const isExplicitClosing = isClosing === true;
  const wrap = el.fsPlotWrap || document.getElementById("fs-plot-wrap");
  const plotDiv = el.fsPlotDiv || document.getElementById("fs-plot-div");
  const resetBtn = el.fsResetSizeBtn || document.getElementById("fs-reset-size-btn");
  const badge = document.getElementById("fs-resize-badge");

  if (wrap) {
    wrap.style.width = "";
    wrap.style.height = "";
    wrap.classList.remove("is-custom-size");
  }

  if (resetBtn) resetBtn.hidden = true;
  if (badge) badge.hidden = true;

  const handleBorderR = document.getElementById("fs-border-handle-r");
  const handleBorderB = document.getElementById("fs-border-handle-b");
  const handleBorderC = document.getElementById("fs-border-handle-c");
  [handleBorderR, handleBorderB, handleBorderC].forEach((h) => {
    if (h) {
      h.style.left = "";
      h.style.top = "";
      h.style.right = "";
      h.style.bottom = "";
      h.style.width = "";
      h.style.height = "";
    }
  });

  if (plotDiv) {
    plotDiv.style.width = "";
    plotDiv.style.height = "";

    if (plotDiv.layout) {
      delete plotDiv.layout.width;
      delete plotDiv.layout.height;
      plotDiv.layout.autosize = true;
    }

    if (!isExplicitClosing) {
      requestAnimationFrame(() => {
        adjustFsPlotToContentWidth();
      });
    }
  }
}

function initFsPlotResizer() {
  const wrap = el.fsPlotWrap || document.getElementById("fs-plot-wrap");
  const plotDiv = el.fsPlotDiv || document.getElementById("fs-plot-div");
  const handleBorderR = document.getElementById("fs-border-handle-r");
  const handleBorderB = document.getElementById("fs-border-handle-b");
  const handleBorderC = document.getElementById("fs-border-handle-c");
  const badge = document.getElementById("fs-resize-badge");
  const resetBtn = el.fsResetSizeBtn || document.getElementById("fs-reset-size-btn");

  if (!wrap || !plotDiv) return;

  // Clear any inline styles so clean CSS coordinates apply
  [handleBorderR, handleBorderB, handleBorderC].forEach((h) => {
    if (h) {
      h.style.left = "";
      h.style.top = "";
      h.style.right = "";
      h.style.bottom = "";
      h.style.width = "";
      h.style.height = "";
    }
  });

  if (wrap._hasResizerInit) return;
  wrap._hasResizerInit = true;

  let activeHandle = null;
  let activeHandleEl = null;
  let startX = 0, startY = 0;
  let startW = 0, startH = 0;
  let isRelayouting = false;
  let pendingRelayout = null;

  // Protect the plot legend from being obscured or blocked by the border resize handles
  wrap.addEventListener("mousemove", (e) => {
    if (activeHandle) return;
    const legend = plotDiv.querySelector("g.legend");
    if (!legend) return;
    const lRect = legend.getBoundingClientRect();
    const inLegend = (
      e.clientX >= lRect.left - 4 &&
      e.clientX <= lRect.right + 4 &&
      e.clientY >= lRect.top - 4 &&
      e.clientY <= lRect.bottom + 4
    );
    const pointerVal = inLegend ? "none" : "";
    if (handleBorderB && handleBorderB.style.pointerEvents !== pointerVal) {
      handleBorderB.style.pointerEvents = pointerVal;
    }
    if (handleBorderR && handleBorderR.style.pointerEvents !== pointerVal) {
      handleBorderR.style.pointerEvents = pointerVal;
    }
    if (handleBorderC && handleBorderC.style.pointerEvents !== pointerVal) {
      handleBorderC.style.pointerEvents = pointerVal;
    }
  });

  function applyPlotlySize(w, h) {
    if (!plotDiv) return;
    if (isRelayouting) {
      pendingRelayout = { w, h };
      return;
    }
    isRelayouting = true;
    Plotly.relayout(plotDiv, { width: w, height: h })
      .catch((err) => console.warn("Plotly resize error", err))
      .finally(() => {
        isRelayouting = false;
        if (pendingRelayout) {
          const next = pendingRelayout;
          pendingRelayout = null;
          applyPlotlySize(next.w, next.h);
        }
      });
  }

  function updateBadge(w, h) {
    if (!badge) return;
    badge.textContent = `${Math.round(w)} × ${Math.round(h)} px`;
    badge.hidden = false;
  }

  const ruler = document.getElementById("fs-ruler");
  const rulerContent = document.getElementById("fs-content");
  const RULER_ORIGIN = 14; // plot-div's left offset inside the wrap
  let rulerMark = null;

  function showRuler() {
    if (!ruler || !rulerContent) return;
    const contentW = rulerContent.clientWidth;
    ruler.innerHTML = "";
    ruler.style.width = `${contentW}px`;
    for (let px = 0; RULER_ORIGIN + px <= contentW; px += 50) {
      const major = px % 100 === 0;
      const tick = document.createElement("span");
      tick.className = "fs-ruler-tick" + (major ? " major" : "");
      tick.style.left = `${RULER_ORIGIN + px}px`;
      ruler.appendChild(tick);
      if (major) {
        const lbl = document.createElement("span");
        lbl.className = "fs-ruler-label";
        lbl.style.left = `${RULER_ORIGIN + px}px`;
        lbl.textContent = String(px);
        ruler.appendChild(lbl);
      }
    }
    const maxPlotW = contentW - 48;
    const maxMark = document.createElement("span");
    maxMark.className = "fs-ruler-max";
    maxMark.style.left = `${RULER_ORIGIN + maxPlotW}px`;
    maxMark.textContent = `max ${maxPlotW}`;
    ruler.appendChild(maxMark);
    rulerMark = document.createElement("span");
    rulerMark.className = "fs-ruler-mark";
    ruler.appendChild(rulerMark);
    ruler.hidden = false;
  }

  function updateRuler(plotW) {
    if (!rulerMark) return;
    rulerMark.style.left = `${RULER_ORIGIN + plotW}px`;
    rulerMark.textContent = String(Math.round(plotW));
  }

  function hideRuler() {
    if (ruler) ruler.hidden = true;
  }

  function onPointerDown(e, type, targetEl) {
    if (e.button !== 0) return;
    if (activeHandle) return;
    e.preventDefault();
    e.stopPropagation();

    activeHandle = type;
    activeHandleEl = targetEl;
    startX = e.clientX;
    startY = e.clientY;

    const rect = wrap.getBoundingClientRect();
    startW = rect.width;
    startH = rect.height;

    wrap.classList.add("is-custom-size");
    if (resetBtn) resetBtn.hidden = false;

    if (activeHandleEl) activeHandleEl.classList.add("is-dragging");

    document.body.style.userSelect = "none";
    if (type === "r") document.body.style.cursor = "ew-resize";
    else if (type === "b") document.body.style.cursor = "ns-resize";
    else document.body.style.cursor = "nwse-resize";

    const plotW = Math.max(300, Math.round(startW - 28));
    const plotH = Math.max(200, Math.round(startH - 36));
    updateBadge(plotW, plotH);
    showRuler();
    updateRuler(plotW);

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("mousemove", onPointerMove);
    window.addEventListener("mouseup", onPointerUp);
  }

  function onPointerMove(e) {
    if (!activeHandle) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    let targetW = startW;
    let targetH = startH;

    if (activeHandle === "r") {
      targetW = Math.max(360, Math.round(startW + dx));
    } else if (activeHandle === "b") {
      targetH = Math.max(240, Math.round(startH + dy));
    } else if (activeHandle === "c") {
      targetW = Math.max(360, Math.round(startW + dx));
      targetH = Math.max(240, Math.round(startH + dy));
    }

    wrap.style.width = `${targetW}px`;
    wrap.style.height = `${targetH}px`;

    const plotW = Math.max(320, Math.round(targetW - 28));
    const plotH = Math.max(200, Math.round(targetH - 36));

    plotDiv.style.width = `${plotW}px`;
    plotDiv.style.height = `${plotH}px`;

    updateBadge(plotW, plotH);
    updateRuler(plotW);
    applyPlotlySize(plotW, plotH);
  }

  function onPointerUp(e) {
    if (!activeHandle) return;
    if (activeHandleEl) {
      activeHandleEl.classList.remove("is-dragging");
      activeHandleEl = null;
    }

    activeHandle = null;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    hideRuler();

    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    window.removeEventListener("mousemove", onPointerMove);
    window.removeEventListener("mouseup", onPointerUp);

    const curRect = plotDiv.getBoundingClientRect();
    const finalW = Math.round(curRect.width);
    const finalH = Math.round(curRect.height);
    applyPlotlySize(finalW, finalH);

    if (badge) {
      setTimeout(() => {
        if (!activeHandle && badge) badge.hidden = true;
      }, 1200);
    }
  }

  function attachHandle(handleEl, type) {
    if (!handleEl) return;
    handleEl.addEventListener("pointerdown", (e) => onPointerDown(e, type, handleEl));
    handleEl.addEventListener("mousedown", (e) => onPointerDown(e, type, handleEl));
  }

  attachHandle(handleBorderR, "r");
  attachHandle(handleBorderB, "b");
  attachHandle(handleBorderC, "c");
}

function buildFullscreenPlotData(bi, blockName) {
  // Resolve plot data from regular block or merged group
  let plotTraces, plotXIsFreq, plotXLabel, plotYLabel, plotYRange;

  const mgMatch = state.mergedGroups.find((g) => g.id === bi);
  if (mgMatch) {
    // Merged group
    const validBis = mgMatch.bis.filter((b) => state.selectedBis.has(b) && state.blocks[b]);
    let mergedTraces = [], mergedXIsFreq = false, mergedXLabel = "", mergedYMin = Infinity, mergedYMax = -Infinity;
    validBis.forEach((b) => {
      const blk = state.blocks[b];
      const { traces: bt, xIsFreq: bxf, xLabel: bxl } = buildTracesForBlock(blk, 1, b);
      if (bxf) mergedXIsFreq = true;
      if (bxl) mergedXLabel = bxl;
      bt.forEach((t) => mergedTraces.push({ ...t, name: `[${escapeHtml(blk.name)}] ${t.name}` }));
      blk.instances.forEach((inst) => {
        const xName = inst.xName;
        blk.curves.forEach((meta) => {
          if (meta.kind !== "series" || meta.name === xName) return;
          const c = inst.curves[meta.name];
          if (!c || !Array.isArray(c.values)) return;
          c.values.forEach((v) => { if (typeof v === "number" && isFinite(v)) { if (v < mergedYMin) mergedYMin = v; if (v > mergedYMax) mergedYMax = v; } });
        });
      });
    });
    const pad = isFinite(mergedYMin) && isFinite(mergedYMax) && mergedYMax > mergedYMin ? (mergedYMax - mergedYMin) * 0.06 : 0;
    const mergedNonXMeta = validBis.flatMap((b) => {
      const blk = state.blocks[b];
      return blk.curves.filter((c) => c.kind === "series" && (!blk.instances[0] || c.name !== blk.instances[0].xName));
    });
    plotTraces = mergedTraces;
    plotXIsFreq = mergedXIsFreq;
    plotXLabel = mergedXLabel;
    plotYLabel = formatYLabel(mergedNonXMeta, blockName);
    plotYRange = (isFinite(mergedYMin) && mergedYMax > mergedYMin) ? [mergedYMin - pad, mergedYMax + pad] : null;
  } else {
    // Regular block
    const block = state.blocks[bi];
    if (!block) return null;
    const seriesMeta = block.curves.filter((c) => c.kind === "series");
    const nonXSeriesMeta = seriesMeta.filter((c) => !block.instances[0] || c.name !== block.instances[0].xName);
    const { traces, xIsFreq, xLabel } = buildTracesForBlock(block, 1, bi);
    plotTraces = traces;
    plotXIsFreq = xIsFreq;
    plotXLabel = xLabel;
    plotYLabel = formatYLabel(nonXSeriesMeta, blockName);
    plotYRange = getBlockYRange(block);
  }

  if (!plotTraces || !plotTraces.length) return null;

  // Preserve existing measurement traces' visibility from current plot
  if (el.fsPlotDiv && el.fsPlotDiv.data && el.fsPlotDiv.data.length) {
    plotTraces.forEach((t) => {
      const match = el.fsPlotDiv.data.find((old) => !old.isCalculated && old.name === t.name);
      if (match && match.visible !== undefined) {
        t.visible = match.visible;
      }
    });
  }

  // Inject any existing calculated traces for this plot
  const calcs = state.calculatedCurves[bi] || [];
  calcs.forEach((ct) => {
    if (ct.pv) {
      plotTraces.push({ ...ct });
      return;
    }
    plotTraces.push({
      x: ct.x,
      y: ct.y,
      mode: "lines",
      name: ct.name,
      origName: ct.origName || ct.name,
      isCalculated: true,
      calcId: ct.calcId,
      opId: ct.opId,
      line: ct.line,
      visible: ct.visible !== undefined ? ct.visible : true,
      hovertemplate: ct.hovertemplate || "%{y:.2f}<extra></extra>",
    });
  });

  return { plotTraces, plotXIsFreq, plotXLabel, plotYLabel, plotYRange, blockName };
}

function updateFullscreenPlotTraces(bi) {
  if (!el.fsPlotDiv || !state.fsPlotInfo) return;
  const blockName = state.fsPlotInfo.blockName;
  const data = buildFullscreenPlotData(bi, blockName);
  if (!data || !data.plotTraces) return;

  drawSinglePlot(
    el.fsPlotDiv,
    {
      traces: data.plotTraces,
      xIsFreq: data.plotXIsFreq,
      xLabel: data.plotXLabel,
      yLabel: data.plotYLabel,
      yRange: data.plotYRange
    },
    blockName,
    1,
    bi,
    1
  );

  // Guarantee that all traces strictly match their intended visibility state on the plot
  const visArray = data.plotTraces.map((t) => (t.visible !== undefined ? t.visible : true));
  try {
    Plotly.restyle(el.fsPlotDiv, { visible: visArray });
  } catch (e) {}

  bindPvVisibilitySync();
  restorePvOverlays(bi);
  renderFullscreenCurveTable(bi);
  updateToggleAllBtnState();
}

function openFullscreen(bi, blockName) {
  if (!el.fsOverlay || !el.fsPlotDiv) return;

  const data = buildFullscreenPlotData(bi, blockName);
  if (!data || !data.plotTraces) return;

  state.fsPlotInfo = { bi, blockName };

  if (el.fsTitle) el.fsTitle.textContent = blockName;
  el.fsOverlay.hidden = false;
  // Make sure this iframe, not the portal shell, receives the keyboard (ESC to exit)
  window.focus();

  // Purge any previous plot and render fresh at full size
  try { Plotly.purge(el.fsPlotDiv); } catch (e) {}

  // Use requestAnimationFrame to let overlay render first (so clientWidth/Height are correct)
  requestAnimationFrame(() => {
    drawSinglePlot(
      el.fsPlotDiv,
      {
        traces: data.plotTraces,
        xIsFreq: data.plotXIsFreq,
        xLabel: data.plotXLabel,
        yLabel: data.plotYLabel,
        yRange: data.plotYRange
      },
      blockName,
      1,
      bi,
      1
    );
    bindPvVisibilitySync();
    initFsCurveMathPanel(bi);
    initFsPlotResizer();
    updateToggleAllBtnState();
    // Render sample/scalar table without delay or redundant plot redraws
    renderFullscreenCurveTable(bi);
  });
}

function closeFullscreen() {
  if (!el.fsOverlay) return;
  el.fsOverlay.hidden = true;
  if (el.fsMathPanel) el.fsMathPanel.hidden = true;
  if (el.fsMathBtn) el.fsMathBtn.classList.remove("active");
  state.fsPlotInfo = null;
  if (el.fsCurveTable) {
    el.fsCurveTable.hidden = true;
    el.fsCurveTable.innerHTML = "";
  }
  resetFsPlotSize(true);
  try { Plotly.purge(el.fsPlotDiv); } catch (e) {}
}

// ══════════════════════════════════════════════════════════════════════════
// ── FULLSCREEN CURVE MATH & POST-PROCESSING ENGINE ───────────────────────
// ══════════════════════════════════════════════════════════════════════════

const FS_MATH_PALETTE = ["#ef4444", "#8b5cf6", "#10b981", "#f59e0b", "#ec4899", "#06b6d4", "#6366f1", "#14b8a6"];
let fsMathColorIdx = 0;

function toggleFsMathPanel() {
  if (!el.fsMathPanel) return;
  const willShow = el.fsMathPanel.hidden;
  el.fsMathPanel.hidden = !willShow;
  if (el.fsMathBtn) el.fsMathBtn.classList.toggle("active", willShow);
  if (willShow && state.fsPlotInfo) {
    initFsCurveMathPanel(state.fsPlotInfo.bi);
  }
  requestAnimationFrame(() => {
    adjustFsPlotToContentWidth();
    setTimeout(() => {
      adjustFsPlotToContentWidth();
    }, 60);
  });
}

function applyOctaveSmoothing(xArr, yArr, fraction = 3) {
  if (!xArr || !yArr || xArr.length < 3) return [...(yArr || [])];
  const factor = Math.pow(2, 1 / (2 * fraction));
  const len = xArr.length;
  const outY = new Array(len);

  for (let i = 0; i < len; i++) {
    const f0 = xArr[i];
    const fMin = f0 / factor;
    const fMax = f0 * factor;

    let sum = 0;
    let count = 0;

    for (let j = 0; j < len; j++) {
      const f = xArr[j];
      if (f >= fMin && f <= fMax) {
        const val = yArr[j];
        if (typeof val === "number" && isFinite(val)) {
          sum += val;
          count++;
        }
      } else if (f > fMax && j > i) {
        break;
      }
    }

    outY[i] = count > 0 ? sum / count : yArr[i];
  }
  return outY;
}

function applyMedianFilter(yArr, windowSize = 5) {
  if (!yArr || yArr.length < 3) return [...(yArr || [])];
  const half = Math.floor(windowSize / 2);
  const len = yArr.length;
  const outY = new Array(len);

  for (let i = 0; i < len; i++) {
    const vals = [];
    const start = Math.max(0, i - half);
    const end = Math.min(len - 1, i + half);
    for (let j = start; j <= end; j++) {
      const v = yArr[j];
      if (typeof v === "number" && isFinite(v)) vals.push(v);
    }
    if (vals.length) {
      vals.sort((a, b) => a - b);
      outY[i] = vals[Math.floor(vals.length / 2)];
    } else {
      outY[i] = yArr[i];
    }
  }
  return outY;
}

function applyButterworthFilter(yArr, cutoffRatio = 0.15) {
  if (!yArr || yArr.length < 4) return [...(yArr || [])];
  const wc = Math.max(0.01, Math.min(0.95, parseFloat(cutoffRatio) || 0.15));
  const K = Math.tan((Math.PI * wc) / 2);
  const sqrt2 = Math.SQRT2;
  const norm = 1 / (1 + sqrt2 * K + K * K);
  const b0 = K * K * norm;
  const b1 = 2 * b0;
  const b2 = b0;
  const a1 = 2 * (K * K - 1) * norm;
  const a2 = (1 - sqrt2 * K + K * K) * norm;

  const len = yArr.length;
  const fwd = new Array(len);

  // Forward pass
  let y_1 = (typeof yArr[0] === "number" && isFinite(yArr[0])) ? yArr[0] : 0;
  let y_2 = y_1;
  let x_1 = y_1;
  let x_2 = y_1;

  for (let i = 0; i < len; i++) {
    const rawVal = yArr[i];
    const x0 = (typeof rawVal === "number" && isFinite(rawVal)) ? rawVal : x_1;
    const out = b0 * x0 + b1 * x_1 + b2 * x_2 - a1 * y_1 - a2 * y_2;
    fwd[i] = out;
    x_2 = x_1;
    x_1 = x0;
    y_2 = y_1;
    y_1 = out;
  }

  // Backward pass (zero-phase filtering)
  const bwd = new Array(len);
  y_1 = fwd[len - 1];
  y_2 = y_1;
  x_1 = y_1;
  x_2 = y_1;

  for (let i = len - 1; i >= 0; i--) {
    const x0 = fwd[i];
    const out = b0 * x0 + b1 * x_1 + b2 * x_2 - a1 * y_1 - a2 * y_2;
    bwd[i] = (typeof yArr[i] === "number" && isFinite(yArr[i])) ? out : yArr[i];
    x_2 = x_1;
    x_1 = x0;
    y_2 = y_1;
    y_1 = out;
  }

  return bwd;
}

function applyCxxSmoothing(xArr, yArr, fraction = 6) {
  if (!xArr || !yArr || xArr.length < 3) return [...(yArr || [])];
  const len = xArr.length;
  const outY = new Array(len);
  const b = parseFloat(fraction) || 6;
  const sigma = 1 / (2.355 * b);
  const twoSigmaSq = 2 * sigma * sigma;

  for (let i = 0; i < len; i++) {
    const f0 = xArr[i];
    if (f0 <= 0) {
      outY[i] = yArr[i];
      continue;
    }
    const logF0 = Math.log2(f0);
    let sumWeight = 0;
    let sumVal = 0;

    for (let j = 0; j < len; j++) {
      const fj = xArr[j];
      const yj = yArr[j];
      if (fj <= 0 || typeof yj !== "number" || !isFinite(yj)) continue;
      const dOct = Math.log2(fj) - logF0;
      if (Math.abs(dOct) > 2.5 / b) continue;
      const w = Math.exp(-(dOct * dOct) / twoSigmaSq);
      sumWeight += w;
      sumVal += w * yj;
    }

    outY[i] = sumWeight > 0 ? sumVal / sumWeight : yArr[i];
  }
  return outY;
}

function computeBinaryCurveOp(traceA, traceB, opFn) {
  if (!traceA || !traceB || !traceA.x || !traceB.x || !traceA.y || !traceB.y) {
    return { x: [], y: [] };
  }

  const xA = traceA.x;
  const yA = traceA.y;
  const xB = traceB.x;
  const yB = traceB.y;

  // Fast path: identical frequency axes
  if (xA.length === xB.length && Math.abs(xA[0] - xB[0]) < 1e-4 && Math.abs(xA[xA.length - 1] - xB[xB.length - 1]) < 1e-4) {
    const resY = new Array(xA.length);
    for (let i = 0; i < xA.length; i++) {
      const a = yA[i];
      const b = yB[i];
      resY[i] = (typeof a === "number" && typeof b === "number" && isFinite(a) && isFinite(b)) ? opFn(a, b) : null;
    }
    return { x: [...xA], y: resY };
  }

  // Interpolated path across overlap frequency range
  const minF = Math.max(xA[0], xB[0]);
  const maxF = Math.min(xA[xA.length - 1], xB[xB.length - 1]);

  const outX = [];
  const outY = [];

  let j = 0;
  for (let i = 0; i < xA.length; i++) {
    const f = xA[i];
    if (f < minF || f > maxF) continue;

    while (j < xB.length - 2 && xB[j + 1] < f) {
      j++;
    }

    const x0 = xB[j];
    const x1 = xB[j + 1];
    const y0 = yB[j];
    const y1 = yB[j + 1];

    let bInterp = y0;
    if (x1 > x0 && typeof y0 === "number" && typeof y1 === "number") {
      const logX = Math.log10(f);
      const log0 = Math.log10(x0);
      const log1 = Math.log10(x1);
      const t = (logX - log0) / (log1 - log0);
      bInterp = y0 + t * (y1 - y0);
    }

    const a = yA[i];
    const resVal = (typeof a === "number" && typeof bInterp === "number" && isFinite(a) && isFinite(bInterp))
      ? opFn(a, bInterp)
      : null;

    outX.push(f);
    outY.push(resVal);
  }

  return { x: outX, y: outY };
}

function computeMultiCurveOp(traces, opType = "mean") {
  if (!traces || !traces.length) return { x: [], y: [] };
  const refTrace = traces[0];
  const x = [...refTrace.x];
  const len = x.length;
  const y = new Array(len);

  for (let i = 0; i < len; i++) {
    const vals = [];
    for (let t = 0; t < traces.length; t++) {
      const v = traces[t].y ? traces[t].y[i] : null;
      if (typeof v === "number" && isFinite(v)) vals.push(v);
    }
    if (!vals.length) {
      y[i] = null;
    } else if (opType === "mean") {
      y[i] = vals.reduce((sum, v) => sum + v, 0) / vals.length;
    } else if (opType === "median") {
      vals.sort((a, b) => a - b);
      y[i] = vals[Math.floor(vals.length / 2)];
    } else if (opType === "max") {
      y[i] = Math.max(...vals);
    } else if (opType === "min") {
      y[i] = Math.min(...vals);
    }
  }

  return { x, y };
}

// ── EXTENSIBLE OPERATOR REGISTRY ──
// Easily add any custom filter, smoothing, or arithmetic calculation here!
const CURVE_MATH_OPERATORS = {
  // ── 1. Single Curve (Unary) ──
  offset: {
    id: "offset",
    name: "Y-Offset (± dB / Value)",
    mode: "single",
    description: "Add or subtract a fixed level offset (e.g. +3 dB or -6 dB)",
    params: [
      { id: "offset", label: "Offset Value (dB)", type: "number", default: 3, step: 0.5 }
    ],
    calc: (traceA, _, params) => {
      const val = parseFloat(params.offset) || 0;
      return {
        x: [...traceA.x],
        y: traceA.y.map((y) => (typeof y === "number" && isFinite(y) ? y + val : y)),
        defaultName: `${traceA.name} [${val >= 0 ? "+" : ""}${val}dB]`
      };
    }
  },
  scale: {
    id: "scale",
    name: "Scale / Multiply (Y × Factor)",
    mode: "single",
    description: "Multiply all curve values by a constant scale factor",
    params: [
      { id: "factor", label: "Multiplication Factor", type: "number", default: 2, step: 0.1 }
    ],
    calc: (traceA, _, params) => {
      const factor = parseFloat(params.factor) || 1;
      return {
        x: [...traceA.x],
        y: traceA.y.map((y) => (typeof y === "number" && isFinite(y) ? y * factor : y)),
        defaultName: `${traceA.name} [×${factor}]`
      };
    }
  },
  invert: {
    id: "invert",
    name: "Invert Polarity (-Y)",
    mode: "single",
    description: "Invert polarity of the curve by multiplying by -1",
    params: [],
    calc: (traceA) => {
      return {
        x: [...traceA.x],
        y: traceA.y.map((y) => (typeof y === "number" && isFinite(y) ? -y : y)),
        defaultName: `${traceA.name} [Inverted]`
      };
    }
  },
  smooth_octave: {
    id: "smooth_octave",
    name: "Octave Band Smoothing (RTA)",
    mode: "single",
    description: "Smooth frequency curve using fractional octave energy averaging",
    params: [
      {
        id: "fraction",
        label: "Octave Fraction",
        type: "select",
        options: [
          { value: "3", label: "1/3 Octave (Standard)" },
          { value: "6", label: "1/6 Octave (Detailed)" },
          { value: "12", label: "1/12 Octave (Fine)" },
          { value: "1", label: "1/1 Octave (Broad)" }
        ],
        default: "3"
      }
    ],
    calc: (traceA, _, params) => {
      const frac = parseFloat(params.fraction) || 3;
      return {
        x: [...traceA.x],
        y: applyOctaveSmoothing(traceA.x, traceA.y, frac),
        defaultName: `${traceA.name} [1/${frac} Oct]`
      };
    }
  },
  smooth_median: {
    id: "smooth_median",
    name: "Median Filter Smoothing",
    mode: "single",
    description: "Eliminate narrow spikes and noise using a moving median window",
    params: [
      { id: "window", label: "Window Size (points)", type: "number", default: 5, step: 2, min: 3, max: 41 }
    ],
    calc: (traceA, _, params) => {
      const win = Math.max(3, parseInt(params.window, 10) || 5);
      return {
        x: [...traceA.x],
        y: applyMedianFilter(traceA.y, win),
        defaultName: `${traceA.name} [Median ${win}pt]`
      };
    }
  },
  butterSmoothing: {
    id: "butterSmoothing",
    name: "Butterworth Smoothing (butterSmoothing)",
    mode: "single",
    description: "Zero-phase 2nd-order Butterworth low-pass filter smoothing",
    params: [
      { id: "cutoff", label: "Cutoff Ratio Wc (0.02 - 0.50)", type: "number", default: 0.15, step: 0.02, min: 0.01, max: 0.8 }
    ],
    calc: (traceA, _, params) => {
      const wc = parseFloat(params.cutoff) || 0.15;
      return {
        x: [...traceA.x],
        y: applyButterworthFilter(traceA.y, wc),
        defaultName: `${traceA.name} [Butterworth Wc=${wc}]`
      };
    }
  },
  CxxSmoothing: {
    id: "CxxSmoothing",
    name: "Continuous Octave Smoothing (CxxSmoothing)",
    mode: "single",
    description: "Gaussian-weighted continuous fractional-octave band smoothing",
    params: [
      {
        id: "fraction",
        label: "Octave Bandwidth",
        type: "select",
        options: [
          { value: "6", label: "1/6 Octave" },
          { value: "3", label: "1/3 Octave" },
          { value: "12", label: "1/12 Octave" },
          { value: "1", label: "1/1 Octave" }
        ],
        default: "6"
      }
    ],
    calc: (traceA, _, params) => {
      const frac = parseFloat(params.fraction) || 6;
      return {
        x: [...traceA.x],
        y: applyCxxSmoothing(traceA.x, traceA.y, frac),
        defaultName: `${traceA.name} [Cxx 1/${frac} Oct]`
      };
    }
  },

  // ── 2. Two Curves (Binary) ──
  minus: {
    id: "minus",
    name: "Difference (Curve A - Curve B)",
    mode: "two",
    description: "Subtract Curve B from Curve A (e.g. Delta vs Golden Unit, Insertion Loss)",
    params: [],
    calc: (traceA, traceB) => {
      const { x, y } = computeBinaryCurveOp(traceA, traceB, (a, b) => a - b);
      return {
        x,
        y,
        defaultName: `[Diff] ${traceA.name} - ${traceB.name}`
      };
    }
  },
  plus: {
    id: "plus",
    name: "Sum (Curve A + Curve B)",
    mode: "two",
    description: "Add Curve A and Curve B together point by point",
    params: [],
    calc: (traceA, traceB) => {
      const { x, y } = computeBinaryCurveOp(traceA, traceB, (a, b) => a + b);
      return {
        x,
        y,
        defaultName: `[Sum] ${traceA.name} + ${traceB.name}`
      };
    }
  },
  multiply: {
    id: "multiply",
    name: "Multiply (Curve A × Curve B)",
    mode: "two",
    description: "Multiply Curve A by Curve B point by point",
    params: [],
    calc: (traceA, traceB) => {
      const { x, y } = computeBinaryCurveOp(traceA, traceB, (a, b) => a * b);
      return {
        x,
        y,
        defaultName: `[Mult] ${traceA.name} × ${traceB.name}`
      };
    }
  },
  divide: {
    id: "divide",
    name: "Divide / Ratio (Curve A / Curve B)",
    mode: "two",
    description: "Divide Curve A by Curve B point by point (relative transfer ratio)",
    params: [],
    calc: (traceA, traceB) => {
      const { x, y } = computeBinaryCurveOp(traceA, traceB, (a, b) => (b !== 0 ? a / b : null));
      return {
        x,
        y,
        defaultName: `[Ratio] ${traceA.name} / ${traceB.name}`
      };
    }
  },

  // ── 3. Multi-Curve Stats (Aggregate across all active curves) ──
  mean: {
    id: "mean",
    name: "Average / Mean Curve",
    mode: "multi",
    description: "Compute the arithmetic mean across all active measurement curves",
    params: [],
    calcMulti: (traces) => {
      const { x, y } = computeMultiCurveOp(traces, "mean");
      return {
        x,
        y,
        defaultName: `[Mean] Average (${traces.length} curves)`
      };
    }
  },
  median: {
    id: "median",
    name: "Median Curve",
    mode: "multi",
    description: "Compute the statistical median curve (outlier-resistant typical curve)",
    params: [],
    calcMulti: (traces) => {
      const { x, y } = computeMultiCurveOp(traces, "median");
      return {
        x,
        y,
        defaultName: `[Median] (${traces.length} curves)`
      };
    }
  },
  max: {
    id: "max",
    name: "Max Envelope (Broadband)",
    mode: "multi",
    description: "Compute upper envelope across all curves over full broadband",
    params: [],
    calcMulti: (traces) => {
      const { x, y } = computeMultiCurveOp(traces, "max");
      return {
        x,
        y,
        defaultName: `[Max Envelope (Broadband)] (${traces.length} curves)`
      };
    }
  },
  segmented_envelope: {
    id: "segmented_envelope",
    name: "Segmented Envelope (Limit Curve)",
    mode: "segmented",
    description: "Set limit curve with custom frequency segments and offsets on any curve"
  },
  peakvalley: {
    id: "peakvalley",
    name: "Peak-Valley Distance (1st / 2nd)",
    mode: "analysis"
  },
  min: {
    id: "min",
    name: "Min Envelope (Broadband)",
    mode: "multi",
    description: "Compute lower envelope across all curves over full broadband",
    params: [],
    calcMulti: (traces) => {
      const { x, y } = computeMultiCurveOp(traces, "min");
      return {
        x,
        y,
        defaultName: `[Min Envelope (Broadband)] (${traces.length} curves)`
      };
    }
  }
};

let fsMathSelectedCurveA = 0;
let fsMathSelectedCurveB = 1;
let fsMathSelectedTarget = 0;
const fsPvParams = { fmin: "", fmax: "" };
let fsMathParamOffset = "3";

const FS_MATH_CATEGORY_OPS = {
  single: [
    { id: "offset", name: "Y-Offset (± dB / Level Shift)" },
    { id: "segmented_envelope", name: "Segmented Envelope (Limit Curve)" },
    { id: "butterSmoothing", name: "Butterworth Smoothing (Lowpass)" },
    { id: "CxxSmoothing", name: "Continuous Octave Smoothing (Cxx IEC)" },
    { id: "smooth_octave", name: "Fractional Octave Smoothing (RTA)" },
    { id: "smooth_median", name: "Median Filter Smoothing" },
    { id: "scale", name: "Scale / Multiply (Y × Factor)" },
    { id: "invert", name: "Invert Polarity (-Y)" }
  ],
  two: [
    { id: "minus", name: "Difference (Curve A − Curve B)" },
    { id: "plus", name: "Sum (Curve A + Curve B)" },
    { id: "multiply", name: "Multiply (Curve A × Curve B)" },
    { id: "divide", name: "Divide / Ratio (Curve A / Curve B)" }
  ],
  multi: [
    { id: "max", name: "Max Envelope (Broadband)" },
    { id: "min", name: "Min Envelope (Broadband)" },
    { id: "mean", name: "Average / Mean Curve" },
    { id: "median", name: "Median Curve" }
  ],
  analysis: [
    { id: "peakvalley", name: "Peak-Valley Distance (1st / 2nd)" }
  ]
};

function populateFsCurveSelect(selectEl, selectedIdx, defaultIdx = 0) {
  if (!selectEl) return;
  selectEl.innerHTML = "";
  const allPlotTraces = el.fsPlotDiv?.data || [];
  const rawTraces = allPlotTraces.map((t, idx) => ({ t, idx })).filter((x) => !x.t.isCalculated);
  const calcTraces = allPlotTraces.map((t, idx) => ({ t, idx })).filter((x) => !!x.t.isCalculated);

  if (calcTraces.length > 0) {
    const rawGroup = document.createElement("optgroup");
    rawGroup.label = "Measurement Curves";
    rawTraces.forEach(({ t, idx }) => {
      const opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = t.name || `Curve ${idx + 1}`;
      rawGroup.appendChild(opt);
    });
    selectEl.appendChild(rawGroup);

    const calcGroup = document.createElement("optgroup");
    calcGroup.label = "Calculated Curves";
    calcTraces.forEach(({ t, idx }) => {
      const opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = `📊 ${t.name || `Calculated ${idx + 1}`}`;
      calcGroup.appendChild(opt);
    });
    selectEl.appendChild(calcGroup);
  } else {
    allPlotTraces.forEach((t, idx) => {
      const opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = t.name || `Curve ${idx + 1}`;
      selectEl.appendChild(opt);
    });
  }

  const validIndices = allPlotTraces.map((_, i) => i);
  if (validIndices.includes(selectedIdx)) {
    selectEl.value = String(selectedIdx);
  } else if (validIndices.includes(defaultIdx)) {
    selectEl.value = String(defaultIdx);
  } else if (validIndices.length > 0) {
    selectEl.value = String(validIndices[0]);
  }
}

function initFsCurveMathPanel(bi) {
  if (!el.fsPlotDiv || !el.fsPlotDiv.data) return;

  populateFsMathSubFeatures(true);
  renderFsCalculatedCurvesList(bi);
  restorePvOverlays(bi);
}

function populateFsMathSubFeatures(preserve = true) {
  if (!el.fsMathCatSelect || !el.fsMathSubSelect) return;
  const cat = el.fsMathCatSelect.value || "single";
  const ops = FS_MATH_CATEGORY_OPS[cat] || [];
  const prevVal = el.fsMathSubSelect.value;

  el.fsMathSubSelect.innerHTML = "";
  ops.forEach((item) => {
    const opt = document.createElement("option");
    opt.value = item.id;
    opt.textContent = item.name;
    el.fsMathSubSelect.appendChild(opt);
  });

  if (preserve && prevVal && ops.some((o) => o.id === prevVal)) {
    el.fsMathSubSelect.value = prevVal;
  } else if (ops.length) {
    el.fsMathSubSelect.value = ops[0].id;
  }

  renderFsFeatureDetails();
}

function renderPillButtonGroup(label, inputId, options, defaultValue, onChange) {
  const row = document.createElement("div");
  row.className = "fs-math-row";

  if (label) {
    const lbl = document.createElement("label");
    lbl.textContent = label;
    row.appendChild(lbl);
  }

  const hiddenInput = document.createElement("input");
  hiddenInput.type = "hidden";
  hiddenInput.id = inputId;
  hiddenInput.value = defaultValue;
  row.appendChild(hiddenInput);

  const pills = document.createElement("div");
  pills.className = "fs-math-pills";

  options.forEach((opt) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fs-math-pill-btn" + (String(opt.value) === String(defaultValue) ? " active" : "");
    btn.textContent = opt.label;
    btn.dataset.val = opt.value;
    btn.addEventListener("click", () => {
      pills.querySelectorAll(".fs-math-pill-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      hiddenInput.value = opt.value;
      if (onChange) onChange(opt.value);
    });
    pills.appendChild(btn);
  });

  row.appendChild(pills);
  return row;
}

function renderFsFeatureDetails() {
  if (!el.fsMathDetailsContainer || !el.fsMathSubSelect) return;
  const opId = el.fsMathSubSelect.value || "offset";
  const op = CURVE_MATH_OPERATORS[opId];
  if (!op) return;

  const bi = state.fsPlotInfo?.bi;
  const nonCalcTraces = (el.fsPlotDiv?.data || []).filter((t) => !t.isCalculated);
  const existingCalcs = state.calculatedCurves[bi] || [];

  el.fsMathDetailsContainer.innerHTML = "";

  // 1. Header with Feature Name
  const header = document.createElement("div");
  header.className = "fs-math-details-header";

  const title = document.createElement("span");
  title.className = "fs-math-details-title";
  const icon = op.mode === "multi" ? "📊" : op.mode === "two" ? "⚖️" : op.mode === "analysis" ? "📐" : "🎛️";
  title.textContent = `${icon} ${op.name}`;
  header.appendChild(title);
  el.fsMathDetailsContainer.appendChild(header);


  // 3. Dynamic Controls based on Feature Type
  if (op.mode === "multi") {
    // ── Multi-Curve Statistics (Envelopes / Averages) ──
    const scopeBadge = document.createElement("div");
    scopeBadge.className = "fs-math-scope-badge";
    scopeBadge.textContent = `⚡ Applies automatically across all ${nonCalcTraces.length} active measurement curves.`;
    el.fsMathDetailsContainer.appendChild(scopeBadge);

    const existingStat = existingCalcs.find((c) => c.opId === opId);
    if (existingStat) {
      const activeBadge = document.createElement("div");
      activeBadge.className = "fs-math-active-badge";
      activeBadge.innerHTML = `<span>✓ Currently active on plot: <strong>${existingStat.name}</strong></span>`;
      el.fsMathDetailsContainer.appendChild(activeBadge);

      const btnRow = document.createElement("div");
      btnRow.className = "fs-math-btn-row";

      const updateBtn = document.createElement("button");
      updateBtn.type = "button";
      updateBtn.className = "btn primary btn-sm fs-math-card-btn";
      updateBtn.textContent = "🔄 Re-calculate";
      updateBtn.addEventListener("click", () => applyStatEnvelope(opId));

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn outline btn-sm fs-math-card-btn";
      removeBtn.style.color = "var(--danger)";
      removeBtn.style.borderColor = "rgba(239, 68, 68, 0.4)";
      removeBtn.textContent = "🗑️ Remove";
      removeBtn.addEventListener("click", () => removeStatEnvelope(opId));

      btnRow.appendChild(updateBtn);
      btnRow.appendChild(removeBtn);
      el.fsMathDetailsContainer.appendChild(btnRow);
    } else {
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "btn primary btn-sm fs-math-card-btn";
      addBtn.textContent = `⚡ Add ${op.name}`;
      addBtn.addEventListener("click", () => applyStatEnvelope(opId));
      el.fsMathDetailsContainer.appendChild(addBtn);
    }
  } else if (op.mode === "two") {
    // ── Two Curves Comparison (Difference / Sum / Ratio) ──
    const rowA = document.createElement("div");
    rowA.className = "fs-math-row";
    rowA.innerHTML = '<label for="fs-math-cmp-a">Curve A (Reference)</label>';
    const selA = document.createElement("select");
    selA.id = "fs-math-cmp-a";
    selA.className = "fs-math-select";

    const rowB = document.createElement("div");
    rowB.className = "fs-math-row";
    rowB.innerHTML = '<label for="fs-math-cmp-b">Curve B (Target)</label>';
    const selB = document.createElement("select");
    selB.id = "fs-math-cmp-b";
    selB.className = "fs-math-select";

    populateFsCurveSelect(selA, fsMathSelectedCurveA, 0);
    populateFsCurveSelect(selB, fsMathSelectedCurveB, 1);

    selA.addEventListener("change", () => { fsMathSelectedCurveA = parseInt(selA.value, 10); });
    selB.addEventListener("change", () => { fsMathSelectedCurveB = parseInt(selB.value, 10); });

    rowA.appendChild(selA);
    rowB.appendChild(selB);
    el.fsMathDetailsContainer.appendChild(rowA);
    el.fsMathDetailsContainer.appendChild(rowB);

    const calcBtn = document.createElement("button");
    calcBtn.type = "button";
    calcBtn.className = "btn primary btn-sm fs-math-card-btn";
    calcBtn.textContent = `⚡ Calculate & Plot ${op.name.split(" ")[0]}`;
    calcBtn.addEventListener("click", () => applyTwoCurveOp(opId));
    el.fsMathDetailsContainer.appendChild(calcBtn);
  } else if (op.mode === "single") {
    // ── Single Curve Adjustment ──
    const rowTarget = document.createElement("div");
    rowTarget.className = "fs-math-row";
    rowTarget.innerHTML = '<label for="fs-math-target-curve">Target Curve</label>';
    const selTarget = document.createElement("select");
    selTarget.id = "fs-math-target-curve";
    selTarget.className = "fs-math-select";

    populateFsCurveSelect(selTarget, fsMathSelectedTarget, 0);
    selTarget.addEventListener("change", () => { fsMathSelectedTarget = parseInt(selTarget.value, 10); });
    rowTarget.appendChild(selTarget);
    el.fsMathDetailsContainer.appendChild(rowTarget);

    if (opId === "offset") {
      const offsetInputRow = document.createElement("div");
      offsetInputRow.className = "fs-math-row";
      const currentOffsetVal = fsMathParamOffset !== undefined ? fsMathParamOffset : "3";
      offsetInputRow.innerHTML = `
        <label for="fs-math-param-offset">Offset Value (dB)</label>
        <input type="text" id="fs-math-param-offset" class="fs-math-input" placeholder="e.g. input +3 or -3 to offset curve" value="${currentOffsetVal}">
        <span style="font-size:11px; color:var(--text-dim); margin-top:3px; display:block;">Note: Input e.g. +3 or -3 to offset the curve</span>
      `;
      offsetInputRow.querySelector("#fs-math-param-offset")?.addEventListener("input", (e) => {
        fsMathParamOffset = e.target.value;
      });
      el.fsMathDetailsContainer.appendChild(offsetInputRow);
    } else if (opId === "butterSmoothing") {
      el.fsMathDetailsContainer.appendChild(
        renderPillButtonGroup("Cutoff Ratio Wc", "fs-math-param-cutoff", [
          { value: "0.05", label: "0.05 (Heavy)" },
          { value: "0.15", label: "0.15 (Default)" },
          { value: "0.30", label: "0.30 (Light)" },
          { value: "0.50", label: "0.50 (Fine)" }
        ], "0.15")
      );
    } else if (opId === "CxxSmoothing") {
      el.fsMathDetailsContainer.appendChild(
        renderPillButtonGroup("Smoothing Bandwidth", "fs-math-param-cxx-fraction", [
          { value: "3", label: "1/3 Octave" },
          { value: "6", label: "1/6 Oct (IEC)" },
          { value: "12", label: "1/12 Octave" },
          { value: "24", label: "1/24 Octave" }
        ], "6")
      );
    } else if (opId === "smooth_octave") {
      el.fsMathDetailsContainer.appendChild(
        renderPillButtonGroup("Octave Fraction", "fs-math-param-oct-fraction", [
          { value: "1", label: "1/1 Octave" },
          { value: "3", label: "1/3 Octave" },
          { value: "6", label: "1/6 Octave" },
          { value: "12", label: "1/12 Octave" }
        ], "3")
      );
    } else if (opId === "smooth_median") {
      el.fsMathDetailsContainer.appendChild(
        renderPillButtonGroup("Filter Window (Points)", "fs-math-param-window", [
          { value: "3", label: "3 Pts (Light)" },
          { value: "5", label: "5 Pts (Medium)" },
          { value: "9", label: "9 Pts (Strong)" },
          { value: "15", label: "15 Pts (Heavy)" }
        ], "5")
      );
    } else if (opId === "scale") {
      el.fsMathDetailsContainer.appendChild(
        renderPillButtonGroup("Multiplier Factor", "fs-math-param-factor", [
          { value: "0.5", label: "0.5× (Half)" },
          { value: "2.0", label: "2.0× (Double)" },
          { value: "5.0", label: "5.0×" },
          { value: "10.0", label: "10.0×" }
        ], "2.0")
      );
    }

    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className = "btn primary btn-sm fs-math-card-btn";
    applyBtn.textContent = `⚡ Apply ${op.name.split(" ")[0]}`;
    applyBtn.addEventListener("click", () => {
      applySingleCurveOp(opId);
      const prev = applyBtn.textContent;
      applyBtn.textContent = "✓ Applied!";
      setTimeout(() => { if (applyBtn) applyBtn.textContent = prev; }, 800);
    });
    el.fsMathDetailsContainer.appendChild(applyBtn);
  } else if (op.mode === "analysis") {
    // ── Peak-Valley Distance (1st / 2nd) ──
    const rowTarget = document.createElement("div");
    rowTarget.className = "fs-math-row";
    rowTarget.innerHTML = '<label for="fs-math-target-curve">Target Curve</label>';
    const selTarget = document.createElement("select");
    selTarget.id = "fs-math-target-curve";
    selTarget.className = "fs-math-select";
    populateFsCurveSelect(selTarget, fsMathSelectedTarget, 0);
    selTarget.addEventListener("change", () => { fsMathSelectedTarget = parseInt(selTarget.value, 10); });
    rowTarget.appendChild(selTarget);
    el.fsMathDetailsContainer.appendChild(rowTarget);

    const rangeRow = document.createElement("div");
    rangeRow.className = "fs-math-row";
    rangeRow.innerHTML = `
      <label for="fs-math-param-pv-fmin">Search Range (Hz)</label>
      <div style="display:flex; gap:6px;">
        <input type="text" id="fs-math-param-pv-fmin" class="fs-math-input" placeholder="Min (blank = full)" value="${fsPvParams.fmin}">
        <input type="text" id="fs-math-param-pv-fmax" class="fs-math-input" placeholder="Max (blank = full)" value="${fsPvParams.fmax}">
      </div>
    `;
    rangeRow.querySelector("#fs-math-param-pv-fmin").addEventListener("input", (e) => { fsPvParams.fmin = e.target.value; });
    rangeRow.querySelector("#fs-math-param-pv-fmax").addEventListener("input", (e) => { fsPvParams.fmax = e.target.value; });
    el.fsMathDetailsContainer.appendChild(rangeRow);

    const runBtn = document.createElement("button");
    runBtn.type = "button";
    runBtn.className = "btn primary btn-sm fs-math-card-btn";
    runBtn.textContent = "📐 Measure Peak-Valley Distance";
    runBtn.addEventListener("click", applyPeakValley);
    el.fsMathDetailsContainer.appendChild(runBtn);

    existingCalcs.filter((c) => c.pv).forEach((c) => {
      const box = document.createElement("div");
      box.className = "fs-math-active-badge";
      box.style.display = "block";
      box.style.cursor = "pointer";
      box.style.color = "#dc2626";
      box.style.background = "rgba(220, 38, 38, 0.08)";
      box.style.borderColor = "rgba(220, 38, 38, 0.35)";
      box.title = "Click to show only this curve and its peak-valley result";
      if (c.visible !== false && c.visible !== "legendonly") box.style.boxShadow = "0 0 0 2px #dc2626";
      box.addEventListener("click", () => {
        showOnlyPvTraces(bi, c.pv.srcKey || `raw:${c.pv.srcName}`, c.calcId);
      });
      box.innerHTML =
        `<strong>${escapeHtml(c.pv.srcName)}</strong><br>` +
        `① Valley 1 below peak line: <strong>${c.pv.d1.value.toFixed(2)} dB</strong> @ ${fmtPvHz(c.pv.V1.x)}<br>` +
        `② Peak 2 above valley line: <strong>${c.pv.d2.value.toFixed(2)} dB</strong> @ ${fmtPvHz(c.pv.P2.x)}`;
      el.fsMathDetailsContainer.appendChild(box);
    });
  } else if (op.mode === "segmented" || opId === "segmented_envelope") {
    renderFsSegmentedEnvelopeDetails();
  }
}

let fsSegmentRows = [
  { fmin: 100, fmax: 1000, offset: 3.0 },
  { fmin: 1000, fmax: 5000, offset: 2.0 },
  { fmin: 5000, fmax: 10000, offset: 4.0 }
];

function renderFsSegmentedEnvelopeDetails() {
  const container = el.fsMathDetailsContainer;
  if (!container) return;

  // 1. Target Curve Selector (Any curve can set this limit curve)
  const rowTarget = document.createElement("div");
  rowTarget.className = "fs-math-row";
  rowTarget.innerHTML = '<label for="fs-math-target-curve">Target / Base Curve</label>';
  const selTarget = document.createElement("select");
  selTarget.id = "fs-math-target-curve";
  selTarget.className = "fs-math-select";
  populateFsCurveSelect(selTarget, fsMathSelectedTarget, 0);
  selTarget.addEventListener("change", () => { fsMathSelectedTarget = parseInt(selTarget.value, 10); });
  rowTarget.appendChild(selTarget);
  container.appendChild(rowTarget);

  // 2. Frequency Segments Container
  const segContainer = document.createElement("div");
  segContainer.className = "fs-math-row";
  segContainer.style.marginTop = "6px";

  const segHeader = document.createElement("div");
  segHeader.style.display = "flex";
  segHeader.style.justifyContent = "space-between";
  segHeader.style.alignItems = "center";
  segHeader.style.marginBottom = "4px";
  segHeader.innerHTML = `
    <label style="margin:0;">Frequency Ranges & Limits</label>
    <span style="font-size:10px; color:var(--text-dim);">From (Hz) → To (Hz) : ±Offset (dB)</span>
  `;
  segContainer.appendChild(segHeader);

  const segListDiv = document.createElement("div");
  segListDiv.id = "fs-seg-list";
  segListDiv.style.display = "flex";
  segListDiv.style.flexDirection = "column";
  segListDiv.style.gap = "5px";

  function createSegRow(fmin, fmax, offset) {
    const row = document.createElement("div");
    row.className = "fs-seg-row";
    row.style.display = "flex";
    row.style.gap = "5px";
    row.style.alignItems = "center";

    row.innerHTML = `
      <input type="number" class="fs-math-input fs-seg-from" value="${fmin}" placeholder="From" style="flex:1; min-width:55px;" title="Start frequency in Hz">
      <span style="font-size:11px; color:var(--text-dim); flex:none;">→</span>
      <input type="number" class="fs-math-input fs-seg-to" value="${fmax}" placeholder="To" style="flex:1; min-width:55px;" title="End frequency in Hz">
      <input type="number" class="fs-math-input fs-seg-offset" step="0.5" value="${offset}" placeholder="±dB" style="width:68px; flex:none;" title="Offset in dB (e.g. +3 or -3)">
      <button type="button" class="btn outline btn-sm fs-seg-del" style="padding:2px 7px; color:var(--danger); border-color:rgba(239,68,68,0.3); font-size:11px;" title="Remove this segment">✕</button>
    `;

    row.querySelector(".fs-seg-del").addEventListener("click", () => {
      if (segListDiv.querySelectorAll(".fs-seg-row").length > 1) {
        row.remove();
      } else {
        alert("At least one frequency segment is required.");
      }
    });

    return row;
  }

  // Populate initial rows
  fsSegmentRows.forEach((s) => {
    segListDiv.appendChild(createSegRow(s.fmin, s.fmax, s.offset));
  });

  segContainer.appendChild(segListDiv);

  // Quick Action Buttons (+ Add Segment / 3-Band Preset / Invert Sign)
  const btnRow = document.createElement("div");
  btnRow.style.display = "flex";
  btnRow.style.gap = "5px";
  btnRow.style.marginTop = "6px";

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "btn outline btn-sm";
  addBtn.style.flex = "1";
  addBtn.style.fontSize = "11px";
  addBtn.textContent = "➕ Add Band";
  addBtn.addEventListener("click", () => {
    const rows = segListDiv.querySelectorAll(".fs-seg-row");
    const lastTo = rows.length ? parseFloat(rows[rows.length - 1].querySelector(".fs-seg-to")?.value) || 10000 : 1000;
    segListDiv.appendChild(createSegRow(lastTo, lastTo * 2, 3.0));
  });

  const presetBtn = document.createElement("button");
  presetBtn.type = "button";
  presetBtn.className = "btn outline btn-sm";
  presetBtn.style.flex = "1";
  presetBtn.style.fontSize = "11px";
  presetBtn.textContent = "⚡ 3-Band Preset";
  presetBtn.addEventListener("click", () => {
    segListDiv.innerHTML = "";
    segListDiv.appendChild(createSegRow(100, 1000, 3.0));
    segListDiv.appendChild(createSegRow(1000, 5000, 2.0));
    segListDiv.appendChild(createSegRow(5000, 10000, 4.0));
  });

  const invertBtn = document.createElement("button");
  invertBtn.type = "button";
  invertBtn.className = "btn outline btn-sm";
  invertBtn.style.flex = "1";
  invertBtn.style.fontSize = "11px";
  invertBtn.textContent = "± Invert Sign";
  invertBtn.title = "Flip offsets between Upper Limit (+dB) and Lower Limit (-dB)";
  invertBtn.addEventListener("click", () => {
    segListDiv.querySelectorAll(".fs-seg-offset").forEach((inp) => {
      const v = parseFloat(inp.value);
      if (!isNaN(v)) inp.value = (-v).toString();
    });
  });

  btnRow.appendChild(addBtn);
  btnRow.appendChild(presetBtn);
  btnRow.appendChild(invertBtn);
  segContainer.appendChild(btnRow);

  container.appendChild(segContainer);

  // 3. Optional Custom Name
  const nameRow = document.createElement("div");
  nameRow.className = "fs-math-row";
  nameRow.style.marginTop = "6px";
  nameRow.innerHTML = `
    <label for="fs-seg-name">Limit Curve Name (Optional)</label>
    <input type="text" id="fs-seg-name" class="fs-math-input" placeholder="e.g. Upper Limit or Tolerance Mask">
  `;
  container.appendChild(nameRow);

  // 4. Action Button
  const applyBtn = document.createElement("button");
  applyBtn.type = "button";
  applyBtn.className = "btn primary btn-sm fs-math-card-btn";
  applyBtn.style.marginTop = "8px";
  applyBtn.textContent = "⚡ Add Segmented Envelope";
  applyBtn.addEventListener("click", applySegmentedEnvelope);
  container.appendChild(applyBtn);
}

function applySegmentedEnvelope() {
  if (!state.fsPlotInfo || !el.fsPlotDiv || !el.fsPlotDiv.data) return;
  const bi = state.fsPlotInfo.bi;
  const allPlotTraces = el.fsPlotDiv.data || [];
  if (!allPlotTraces.length) {
    alert("No active curves found on plot.");
    return;
  }

  const idx = parseInt(document.getElementById("fs-math-target-curve")?.value, 10);
  const baseTrace = allPlotTraces[idx];
  if (!baseTrace || !Array.isArray(baseTrace.x) || !Array.isArray(baseTrace.y)) {
    alert("Please select a valid target curve.");
    return;
  }

  // Parse frequency segments
  const rows = el.fsMathDetailsContainer?.querySelectorAll(".fs-seg-row") || [];
  const segments = [];
  rows.forEach((r) => {
    const fmin = parseFloat(r.querySelector(".fs-seg-from")?.value);
    const fmax = parseFloat(r.querySelector(".fs-seg-to")?.value);
    const offset = parseFloat(r.querySelector(".fs-seg-offset")?.value);
    if (!isNaN(fmin) && !isNaN(fmax) && fmax > fmin && !isNaN(offset)) {
      segments.push({ fmin, fmax, offset });
    }
  });

  if (!segments.length) {
    alert("Please configure at least one valid frequency segment (e.g. 100 to 1000 Hz).");
    return;
  }

  // Save current segments for persistence across renders
  fsSegmentRows = segments.map((s) => ({ ...s }));

  // Sort segments by starting frequency
  segments.sort((a, b) => a.fmin - b.fmin);

  // Interpolate Y value on base curve at frequency targetF
  function interp(targetF) {
    const xs = baseTrace.x;
    const ys = baseTrace.y;
    if (targetF <= xs[0]) return ys[0];
    if (targetF >= xs[xs.length - 1]) return ys[ys.length - 1];
    for (let i = 0; i < xs.length - 1; i++) {
      if (xs[i] <= targetF && targetF <= xs[i + 1]) {
        if (xs[i + 1] === xs[i]) return ys[i];
        const t = (targetF - xs[i]) / (xs[i + 1] - xs[i]);
        return ys[i] + t * (ys[i + 1] - ys[i]);
      }
    }
    return ys[0];
  }

  const outX = [];
  const outY = [];

  segments.forEach((seg, sIdx) => {
    if (sIdx > 0 && seg.fmin > segments[sIdx - 1].fmax) {
      // Disconnected gap between segments: break line with null
      outX.push(null);
      outY.push(null);
    }

    // Start of segment
    outX.push(seg.fmin);
    outY.push(interp(seg.fmin) + seg.offset);

    // Intermediate points inside (seg.fmin, seg.fmax)
    for (let i = 0; i < baseTrace.x.length; i++) {
      const fx = baseTrace.x[i];
      const fy = baseTrace.y[i];
      if (fx > seg.fmin && fx < seg.fmax && typeof fy === "number" && isFinite(fy)) {
        outX.push(fx);
        outY.push(fy + seg.offset);
      }
    }

    // End of segment
    outX.push(seg.fmax);
    outY.push(interp(seg.fmax) + seg.offset);
  });

  if (!outX.length) {
    alert("No points generated for the specified frequency segments.");
    return;
  }

  const color = FS_MATH_PALETTE[fsMathColorIdx % FS_MATH_PALETTE.length];
  fsMathColorIdx++;

  const allPositive = segments.every((s) => s.offset >= 0);
  const allNegative = segments.every((s) => s.offset <= 0);
  const tag = allPositive ? "Upper Limit" : allNegative ? "Lower Limit" : "Limit";
  const defaultTitle = `[${tag}] ${baseTrace.name}`;
  const customName = document.getElementById("fs-seg-name")?.value?.trim() || defaultTitle;

  const newTrace = {
    x: outX,
    y: outY,
    mode: "lines",
    name: customName,
    origName: customName,
    isCalculated: true,
    calcId: `calc_seg_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
    opId: "segmented_envelope",
    line: {
      color: color,
      dash: "dash",
      width: 2.2
    },
    visible: true
  };

  addOrUpdateCalculatedCurve(bi, newTrace);
}

// ── PEAK / VALLEY DISTANCE ANALYSIS ──────────────────────────────────────

function fmtPvHz(f) {
  return f >= 1000 ? `${(f / 1000).toFixed(2)} kHz` : `${f.toFixed(1)} Hz`;
}

// Zig-zag extrema detector: a turn only counts after the curve moves >= delta dB from the last extremum.
function detectExtrema(ys, delta) {
  const ext = [];
  let mn = Infinity, mx = -Infinity, mnI = -1, mxI = -1, lookMax = true;
  for (let i = 0; i < ys.length; i++) {
    const v = ys[i];
    if (v > mx) { mx = v; mxI = i; }
    if (v < mn) { mn = v; mnI = i; }
    if (lookMax) {
      if (v < mx - delta) { ext.push({ i: mxI, type: "peak" }); mn = v; mnI = i; lookMax = false; }
    } else if (v > mn + delta) {
      ext.push({ i: mnI, type: "valley" }); mx = v; mxI = i; lookMax = true;
    }
  }
  return ext.filter((e) => e.i > 0 && e.i < ys.length - 1);
}

function computePeakValley(trace, { fmin, fmax, delta, smoothFrac, useLog }) {
  const ySrc = smoothFrac > 0 ? applyOctaveSmoothing(trace.x, trace.y, smoothFrac) : trace.y;
  const xs = [];
  const ys = [];
  for (let i = 0; i < trace.x.length; i++) {
    const xv = Number(trace.x[i]);
    const yv = Number(ySrc[i]);
    if (!isFinite(xv) || !isFinite(yv) || xv <= 0 || xv < fmin || xv > fmax) continue;
    xs.push(xv);
    ys.push(yv);
  }
  if (xs.length < 5) throw new Error("Not enough data points in the selected range.");

  const ext = detectExtrema(ys, delta);
  const allPeaks = ext.filter((e) => e.type === "peak");
  const allValleys = ext.filter((e) => e.type === "valley");
  if (allPeaks.length < 2 || allValleys.length < 2) {
    throw new Error(`Found ${allPeaks.length} peak(s) and ${allValleys.length} valley(s); need at least 2 of each. Lower the prominence or widen the search range.`);
  }
  const toPt = (e) => ({ x: xs[e.i], y: ys[e.i] });
  const [P1, P2] = allPeaks.slice(0, 2).map(toPt);
  const [V1, V2] = allValleys.slice(0, 2).map(toPt);

  const U = (f) => (useLog ? Math.log10(f) : f);
  const fromU = (u) => (useLog ? Math.pow(10, u) : u);
  const lineThrough = (a, b) => {
    const m = (b.y - a.y) / (U(b.x) - U(a.x));
    return (f) => a.y + m * (U(f) - U(a.x));
  };
  const upperAt = lineThrough(P1, P2); // peak line through peak 1 and peak 2
  const lowerAt = lineThrough(V1, V2); // valley line through valley 1 and valley 2

  const uAll = [P1, P2, V1, V2].map((p) => U(p.x));
  const uMin = Math.min(...uAll);
  const uMax = Math.max(...uAll);
  const pad = (uMax - uMin) * 0.15;
  const fS = fromU(uMin - pad);
  const fE = fromU(uMax + pad);

  return {
    srcName: trace.name,
    P1, V1, P2, V2,
    upper: { x0: fS, y0: upperAt(fS), x1: fE, y1: upperAt(fE) },
    lower: { x0: fS, y0: lowerAt(fS), x1: fE, y1: lowerAt(fE) },
    // 1: valley 1 depth below the peak line; 2: peak 2 height above the valley line
    d1: { x: V1.x, yTop: upperAt(V1.x), yBot: V1.y, value: upperAt(V1.x) - V1.y },
    d2: { x: P2.x, yTop: P2.y, yBot: lowerAt(P2.x), value: P2.y - lowerAt(P2.x) }
  };
}

function buildPvTrace(name, calcId, pv) {
  const pts = [
    { k: "P1", ...pv.P1 }, { k: "V1", ...pv.V1 },
    { k: "P2", ...pv.P2 }, { k: "V2", ...pv.V2 }
  ];
  const isPeak = (p) => p.k[0] === "P";
  return {
    x: pts.map((p) => p.x),
    y: pts.map((p) => p.y),
    mode: "markers+text",
    name,
    origName: name,
    isCalculated: true,
    calcId,
    opId: "peakvalley",
    pv,
    text: pts.map((p) => p.k),
    textposition: pts.map((p) => (isPeak(p) ? "top center" : "bottom center")),
    textfont: { size: 11, color: "#111827" },
    marker: { size: 9, color: pts.map((p) => (isPeak(p) ? "#dc2626" : "#2563eb")), line: { color: "#ffffff", width: 1 } },
    line: { color: "#dc2626", width: 2 },
    visible: true
  };
}

function applyPeakValley() {
  if (!state.fsPlotInfo || !el.fsPlotDiv || !el.fsPlotDiv.data) return;
  const bi = state.fsPlotInfo.bi;
  const idx = parseInt(document.getElementById("fs-math-target-curve")?.value, 10);
  const src = el.fsPlotDiv.data[idx];
  if (!src || src.pv) {
    alert("Please select a curve to analyse.");
    return;
  }

  const fminRaw = parseFloat(document.getElementById("fs-math-param-pv-fmin")?.value);
  const fmaxRaw = parseFloat(document.getElementById("fs-math-param-pv-fmax")?.value);
  const useLog = el.fsPlotDiv.layout?.xaxis?.type === "log";

  let pv;
  try {
    pv = computePeakValley(src, {
      fmin: isFinite(fminRaw) ? fminRaw : 0,
      fmax: isFinite(fmaxRaw) ? fmaxRaw : Infinity,
      delta: 1,
      smoothFrac: 0,
      useLog
    });
  } catch (err) {
    alert("Peak-valley error: " + (err.message || String(err)));
    return;
  }

  const srcKey = src.calcId || `raw:${src.name}`;
  pv.srcKey = srcKey;
  const calcId = `calc_peakvalley_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
  addOrUpdateCalculatedCurve(bi, buildPvTrace(`[P/V] ${src.name}`, calcId, pv));
  drawPvOverlay(calcId, pv);
  showOnlyPvTraces(bi, srcKey, calcId);
}

// Hide every curve except the analysed one and its P/V result so the overlay is readable.
function showOnlyPvTraces(bi, srcKey, pvCalcId) {
  const div = el.fsPlotDiv;
  const traces = div?.data || [];
  const vis = traces.map((t) => ((t.calcId || `raw:${t.name}`) === srcKey || t.calcId === pvCalcId ? true : "legendonly"));
  try {
    Plotly.restyle(div, { visible: vis });
  } catch (e) {}

  (state.calculatedCurves[bi] || []).forEach((c) => {
    const idx = traces.findIndex((t) => t.calcId === c.calcId);
    if (idx === -1) return;
    c.visible = vis[idx];
    if (c.pv) {
      if (vis[idx] === true) drawPvOverlay(c.calcId, c.pv);
      else removePvOverlay(c.calcId);
    }
  });
  renderFsCalculatedCurvesList(bi);
  renderFsFeatureDetails();
  updateToggleAllBtnState();
  schedulePersist();
}

function setPvAnnotations(keepFn, added) {
  const div = el.fsPlotDiv;
  if (!div || !div.layout) return;
  const kept = (div.layout.annotations || []).filter(keepFn);
  try {
    Plotly.relayout(div, { annotations: kept.concat(added) });
  } catch (e) {}
}

function removePvOverlay(calcId) {
  const tag = `pv_${calcId}`;
  setPvAnnotations((a) => a.name !== tag, []);
}

function removeAllPvOverlays() {
  setPvAnnotations((a) => !(a.name || "").startsWith("pv_"), []);
}

// Legend clicks toggle trace visibility inside Plotly; keep all calculated curves & eye icons in sync.
function syncPvOverlays() {
  const div = el.fsPlotDiv;
  const bi = state.fsPlotInfo?.bi;
  if (!div || !div.data || bi === undefined) return;
  const anns = div.layout?.annotations || [];
  let changed = false;
  (state.calculatedCurves[bi] || []).forEach((c) => {
    const t = div.data.find((tr) => (tr.calcId && tr.calcId === c.calcId) || tr.name === c.name);
    if (!t) return;
    const shown = t.visible === true || t.visible === undefined;
    const vis = t.visible === undefined ? true : t.visible;
    if (c.visible !== vis) {
      c.visible = vis;
      changed = true;
    }
    if (c.pv) {
      const has = anns.some((a) => a.name === `pv_${c.calcId}`);
      if (shown && !has) { drawPvOverlay(c.calcId, c.pv); changed = true; }
      else if (!shown && has) { removePvOverlay(c.calcId); changed = true; }
    }
  });
  if (changed) {
    renderFsCalculatedCurvesList(bi);
    renderFsFeatureDetails();
    schedulePersist();
  }
  updateToggleAllBtnState();
}

function onLegendClickSync(data) {
  if (data && typeof data.curveNumber === "number") {
    toggleFullscreenTraceVisibility(data.curveNumber);
    return false; // Tells Plotly the click was handled, canceling any internal delayed toggle
  }
  setTimeout(() => {
    syncPvOverlays();
  }, 60);
}

function bindPvVisibilitySync() {
  const div = el.fsPlotDiv;
  if (!div || typeof div.on !== "function") return;
  try {
    div.removeListener?.("plotly_restyle", syncPvOverlays);
    div.on("plotly_restyle", syncPvOverlays);
    div.removeListener?.("plotly_legendclick", onLegendClickSync);
    div.on("plotly_legendclick", onLegendClickSync);
  } catch (e) {}
}

function restorePvOverlays(bi) {
  (state.calculatedCurves[bi] || []).forEach((c) => {
    if (c.pv && c.visible !== false && c.visible !== "legendonly") drawPvOverlay(c.calcId, c.pv);
  });
}

function drawPvOverlay(calcId, pv) {
  const div = el.fsPlotDiv;
  if (!div || !div.layout) return;
  const tag = `pv_${calcId}`;
  // Plotly annotations on log axes take log10 values
  const cx = (v) => (div.layout.xaxis?.type === "log" ? Math.log10(v) : v);
  const cy = (v) => (div.layout.yaxis?.type === "log" ? Math.log10(v) : v);
  const seg = (x0, y0, x1, y1, opts) => ({
    name: tag, xref: "x", yref: "y", axref: "x", ayref: "y",
    x: cx(x1), y: cy(y1), ax: cx(x0), ay: cy(y0),
    showarrow: true, text: "", ...opts
  });
  const lineOpts = { arrowhead: 0, arrowwidth: 1.5, arrowcolor: "#475569" };
  const arrowOpts = { arrowhead: 2, startarrowhead: 2, arrowsize: 1, arrowwidth: 1.8, arrowcolor: "#dc2626" };
  const label = (d, n) => ({
    name: tag, xref: "x", yref: "y", x: cx(d.x), y: cy((d.yTop + d.yBot) / 2),
    xanchor: "left", xshift: 8, showarrow: false,
    text: `<b>${n}</b> = ${d.value.toFixed(2)} dB`,
    font: { size: 12, color: "#dc2626" },
    bgcolor: "rgba(255,255,255,0.88)", bordercolor: "#dc2626", borderwidth: 1, borderpad: 2
  });

  const added = [
    seg(pv.upper.x0, pv.upper.y0, pv.upper.x1, pv.upper.y1, lineOpts),
    seg(pv.lower.x0, pv.lower.y0, pv.lower.x1, pv.lower.y1, lineOpts),
    seg(pv.d1.x, pv.d1.yTop, pv.d1.x, pv.d1.yBot, arrowOpts),
    seg(pv.d2.x, pv.d2.yTop, pv.d2.x, pv.d2.yBot, arrowOpts),
    label(pv.d1, "1"),
    label(pv.d2, "2")
  ];
  setPvAnnotations((a) => a.name !== tag, added);
}

function applyStatEnvelope(opId) {
  if (!state.fsPlotInfo || !el.fsPlotDiv || !el.fsPlotDiv.data) return;
  const bi = state.fsPlotInfo.bi;

  const nonCalcTraces = el.fsPlotDiv.data.filter((t) => !t.isCalculated);
  if (!nonCalcTraces.length) {
    alert("No active measurement curves found to calculate.");
    return;
  }

  const op = CURVE_MATH_OPERATORS[opId];
  if (!op || !op.calcMulti) return;

  const result = op.calcMulti(nonCalcTraces);
  if (!result || !result.x || !result.y || !result.x.length) {
    alert("Calculation did not produce valid points.");
    return;
  }

  const styleMap = {
    max: { color: "#ef4444", dash: "dash" },
    min: { color: "#10b981", dash: "dash" },
    mean: { color: "#3b82f6", dash: "dashdot" },
    median: { color: "#8b5cf6", dash: "dot" }
  };
  const st = styleMap[opId] || { color: "#ef4444", dash: "dash" };

  const newTrace = {
    x: result.x,
    y: result.y,
    mode: "lines",
    name: result.defaultName,
    origName: result.defaultName,
    isCalculated: true,
    calcId: `calc_${opId}_${Date.now()}`,
    opId: opId,
    line: {
      color: st.color,
      dash: st.dash,
      width: 2.5
    },
    visible: true
  };

  addOrUpdateCalculatedCurve(bi, newTrace);
}

function removeStatEnvelope(opId) {
  if (!state.fsPlotInfo) return;
  const bi = state.fsPlotInfo.bi;
  const calcs = state.calculatedCurves[bi] || [];
  const existingIdx = calcs.findIndex((c) => c.opId === opId);

  if (existingIdx !== -1) {
    const targetCalc = calcs[existingIdx];
    if (targetCalc.pv) removePvOverlay(targetCalc.calcId);
    calcs.splice(existingIdx, 1);
    state.calculatedCurves[bi] = calcs;
    updateFullscreenPlotTraces(bi);
    renderFsFeatureDetails();
    renderFsCalculatedCurvesList(bi);
    schedulePersist();
  }
}

function applyTwoCurveOp(opId) {
  if (!state.fsPlotInfo || !el.fsPlotDiv || !el.fsPlotDiv.data) return;
  const bi = state.fsPlotInfo.bi;

  const allPlotTraces = el.fsPlotDiv.data || [];
  if (allPlotTraces.length < 2) {
    alert("At least 2 curves are required on the plot for comparison.");
    return;
  }

  const idx1 = parseInt(document.getElementById("fs-math-cmp-a")?.value, 10);
  const idx2 = parseInt(document.getElementById("fs-math-cmp-b")?.value, 10);
  const traceA = allPlotTraces[idx1];
  const traceB = allPlotTraces[idx2];

  if (!traceA || !traceB) {
    alert("Please select both Curve A and Curve B.");
    return;
  }

  const op = CURVE_MATH_OPERATORS[opId];
  if (!op || !op.calc) return;

  let result;
  try {
    result = op.calc(traceA, traceB, {});
  } catch (err) {
    alert("Comparison error: " + (err.message || String(err)));
    return;
  }

  if (!result || !result.x || !result.y || !result.x.length) {
    alert("Calculation did not produce valid points.");
    return;
  }

  const color = FS_MATH_PALETTE[fsMathColorIdx % FS_MATH_PALETTE.length];
  fsMathColorIdx++;

  const newTrace = {
    x: result.x,
    y: result.y,
    mode: "lines",
    name: result.defaultName,
    origName: result.defaultName,
    isCalculated: true,
    calcId: `calc_${opId}_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
    opId: opId,
    line: {
      color: color,
      dash: "solid",
      width: 2.5
    },
    visible: true
  };

  addOrUpdateCalculatedCurve(bi, newTrace);
}

function applySingleCurveOp(opId) {
  if (!state.fsPlotInfo || !el.fsPlotDiv || !el.fsPlotDiv.data) return;
  const bi = state.fsPlotInfo.bi;

  const allPlotTraces = el.fsPlotDiv.data || [];
  if (!allPlotTraces.length) {
    alert("No active curves found on the plot.");
    return;
  }

  const idx = parseInt(document.getElementById("fs-math-target-curve")?.value, 10);
  const traceA = allPlotTraces[idx];
  if (!traceA) {
    alert("Please select a target curve.");
    return;
  }

  const op = CURVE_MATH_OPERATORS[opId];
  if (!op || !op.calc) return;

  const params = {};
  if (opId === "offset") {
    const rawVal = document.getElementById("fs-math-param-offset")?.value?.trim();
    if (!rawVal) {
      alert("Please input an offset value in dB (e.g. +3 or -3).");
      return;
    }
    const val = parseFloat(rawVal);
    if (isNaN(val)) {
      alert("Invalid offset value. Please input a number (e.g. +3 or -3).");
      return;
    }
    params.offset = val;
  } else if (opId === "butterSmoothing") {
    const val = parseFloat(document.getElementById("fs-math-param-cutoff")?.value);
    params.cutoff = isNaN(val) ? 0.15 : val;
  } else if (opId === "CxxSmoothing") {
    params.fraction = document.getElementById("fs-math-param-cxx-fraction")?.value || "6";
  } else if (opId === "smooth_octave") {
    params.fraction = document.getElementById("fs-math-param-oct-fraction")?.value || "3";
  } else if (opId === "smooth_median") {
    params.window = document.getElementById("fs-math-param-window")?.value || "5";
  } else if (opId === "scale") {
    const val = parseFloat(document.getElementById("fs-math-param-factor")?.value);
    params.factor = isNaN(val) ? 1 : val;
  }

  let result;
  try {
    result = op.calc(traceA, null, params);
  } catch (err) {
    alert("Adjustment error: " + (err.message || String(err)));
    return;
  }

  if (!result || !result.x || !result.y || !result.x.length) {
    alert("Calculation did not produce valid points.");
    return;
  }

  const color = FS_MATH_PALETTE[fsMathColorIdx % FS_MATH_PALETTE.length];
  fsMathColorIdx++;

  const newTrace = {
    x: result.x,
    y: result.y,
    mode: "lines",
    name: result.defaultName,
    origName: result.defaultName,
    isCalculated: true,
    calcId: `calc_${opId}_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
    opId: opId,
    line: {
      color: color,
      dash: opId.includes("smooth") ? "solid" : "dash",
      width: 2.5
    },
    visible: true
  };

  addOrUpdateCalculatedCurve(bi, newTrace);
}

function addOrUpdateCalculatedCurve(bi, newTrace) {
  if (bi === undefined || bi === null) {
    bi = state.fsPlotInfo?.bi;
  }
  if (bi === undefined || bi === null) return;

  // Newly calculated or recalculated curves MUST be visible on the plot
  newTrace.visible = true;

  state.calculatedCurves = state.calculatedCurves || {};
  const existingCalcs = state.calculatedCurves[bi] || [];

  // Detect duplicate or replacement if exact same name or if multi-curve statistical operation matches
  const isMultiStat = ["max", "min", "mean", "median"].includes(newTrace.opId);
  const matchIdx = existingCalcs.findIndex((c) => {
    return (c.name && c.name.trim().toLowerCase() === newTrace.name.trim().toLowerCase()) ||
           (isMultiStat && c.opId === newTrace.opId);
  });

  if (matchIdx !== -1) {
    const old = existingCalcs[matchIdx];
    if (old.pv) removePvOverlay(old.calcId);
    existingCalcs.splice(matchIdx, 1, newTrace);
  } else {
    existingCalcs.push(newTrace);
  }

  // 1. Immediately store into state
  state.calculatedCurves[bi] = existingCalcs;

  // 2. Increment plotRevision so Plotly react clears stale user GUI overrides for traces
  state.plotRevisions = state.plotRevisions || {};
  state.plotRevisions[bi] = (state.plotRevisions[bi] || 0) + 1;

  // 3. Cleanly re-render the plot with Plotly.react, preserving legend coordinates and visibility
  updateFullscreenPlotTraces(bi);

  // 4. Update right panel details and curve list
  renderFsFeatureDetails();
  renderFsCalculatedCurvesList(bi);
  schedulePersist();
}

function renderFsCalculatedCurvesList(bi) {
  if (!el.fsMathCalcList) return;
  el.fsMathCalcList.innerHTML = "";

  const calcs = state.calculatedCurves[bi] || [];
  if (el.fsMathCalcCount) el.fsMathCalcCount.textContent = String(calcs.length);

  if (!calcs.length) {
    const empty = document.createElement("div");
    empty.className = "fs-math-empty-note";
    empty.textContent = "No calculated curves yet.";
    el.fsMathCalcList.appendChild(empty);
    return;
  }

  calcs.forEach((ct) => {
    const item = document.createElement("div");
    item.className = "fs-math-calc-item";

    const left = document.createElement("div");
    left.className = "fs-math-calc-left";

    const swatch = document.createElement("span");
    swatch.style.cssText = `display:inline-block; width:12px; height:3px; background:${ct.line?.color || "#ef4444"}; border-radius:1px; flex-shrink:0;`;

    const name = document.createElement("span");
    name.className = "fs-math-calc-name";
    name.textContent = ct.name;
    name.title = ct.name;

    left.appendChild(swatch);
    left.appendChild(name);

    const btns = document.createElement("div");
    btns.className = "fs-math-calc-btns";

    // Toggle Visibility Button
    const eyeBtn = document.createElement("button");
    eyeBtn.type = "button";
    eyeBtn.className = "fs-math-icon-btn";
    const isVisible = ct.visible !== false && ct.visible !== "legendonly";
    eyeBtn.innerHTML = isVisible ? EYE_OPEN_SVG : EYE_OFF_SVG;
    eyeBtn.title = isVisible ? "Hide calculated curve" : "Show calculated curve";
    if (!isVisible) eyeBtn.style.opacity = "0.5";
    else eyeBtn.style.opacity = "1";

    eyeBtn.addEventListener("click", () => {
      const traceIdx = (el.fsPlotDiv?.data || []).findIndex((t) => (t.calcId && t.calcId === ct.calcId) || t.name === ct.name);
      if (traceIdx >= 0) {
        toggleFullscreenTraceVisibility(traceIdx);
      }
    });

    // Delete Button
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "fs-math-icon-btn delete";
    delBtn.innerHTML = "🗑️";
    delBtn.title = "Delete calculated curve";
    delBtn.addEventListener("click", () => {
      if (ct.pv) removePvOverlay(ct.calcId);
      const calcs = state.calculatedCurves[bi] || [];
      const itemIdx = calcs.findIndex((c) => c.calcId === ct.calcId);
      if (itemIdx !== -1) {
        calcs.splice(itemIdx, 1);
        state.calculatedCurves[bi] = calcs;
      }
      updateFullscreenPlotTraces(bi);
      renderFsFeatureDetails();
      renderFsCalculatedCurvesList(bi);
      schedulePersist();
    });

    btns.appendChild(eyeBtn);
    btns.appendChild(delBtn);

    item.appendChild(left);
    item.appendChild(btns);
    el.fsMathCalcList.appendChild(item);
  });
}

function initFsCurveMathEvents() {
  el.fsMathBtn?.addEventListener("click", toggleFsMathPanel);
  el.fsMathCloseBtn?.addEventListener("click", toggleFsMathPanel);

  el.fsMathCatSelect?.addEventListener("change", () => populateFsMathSubFeatures(false));
  el.fsMathSubSelect?.addEventListener("change", renderFsFeatureDetails);

  el.fsMathClearAllBtn?.addEventListener("click", async () => {
    if (!state.fsPlotInfo) return;
    const bi = state.fsPlotInfo.bi;
    const calcs = state.calculatedCurves[bi] || [];
    if (!calcs.length) return;

    const ok = await showConfirmDialog({
      title: "Remove Calculated Curves",
      message: `Are you sure you want to remove all ${calcs.length} calculated curves from this plot?`,
      yesText: "Yes, Remove",
      noText: "Cancel",
      isDanger: true
    });

    if (!ok) return;

    removeAllPvOverlays();
    state.calculatedCurves[bi] = [];
    updateFullscreenPlotTraces(bi);
    renderFsFeatureDetails();
    renderFsCalculatedCurvesList(bi);
    schedulePersist();
  });
}

function drawSinglePlot(plotDiv, { traces, xIsFreq, xLabel, yLabel, yRange }, blockName, numPlots, bi, plotsPerRow = 3) {
  if (!traces.length) return;

  const isMulti = numPlots > 1;
  const isQuad = plotsPerRow >= 4;
  const isTriple = plotsPerRow >= 3;

  const legendFontSize = isQuad ? 10.5 : isTriple ? 12 : isMulti ? 12 : 12;

  // Plot title placed above the plot (red circle area)
  const customTitle = (state.customTitles && state.customTitles[bi] !== undefined && state.customTitles[bi] !== null)
    ? state.customTitles[bi]
    : blockName;
  const titleText = customTitle ? customTitle.trim() : "";

  // Check for custom Y-axis scale defined by user
  const custom = state.customYScales[bi];
  let finalYRange = yRange;
  let finalDtick = undefined;
  let finalYType = "linear";
  let finalAutorange = false;

  if (custom && !custom.isAuto) {
    finalYType = custom.type || "linear";
    if (finalYType === "log") {
      const minLog = custom.min > 0 ? Math.log10(custom.min) : -2;
      const maxLog = custom.max > 0 ? Math.log10(custom.max) : 2;
      finalYRange = [minLog, maxLog];
    } else {
      finalYRange = [custom.min, custom.max];
    }
    finalDtick = custom.step || undefined;
    finalAutorange = false;
  } else if (finalYRange) {
    finalAutorange = false;
  } else {
    // Robust fallback: compute default range across all plotted trace values
    if (traces && traces.length) {
      let tMin = Infinity;
      let tMax = -Infinity;
      traces.forEach((tr) => {
        if (!Array.isArray(tr.y)) return;
        for (let i = 0; i < tr.y.length; i++) {
          const val = tr.y[i];
          if (typeof val === "number" && !isNaN(val) && isFinite(val)) {
            if (val < tMin) tMin = val;
            if (val > tMax) tMax = val;
          }
        }
      });
      if (isFinite(tMin) && isFinite(tMax) && tMax > tMin) {
        const pad = (tMax - tMin) * 0.06;
        finalYRange = [tMin - pad, tMax + pad];
        finalAutorange = false;
      } else {
        finalAutorange = true;
      }
    } else {
      finalAutorange = true;
    }
  }

  // Check for custom X-axis scale defined by user
  const customX = state.customXScales[bi];
  let finalXRange = null;
  let finalXDtick = undefined;
  let finalXType = xIsFreq ? "log" : "linear";
  let finalXAutorange = false;

  if (customX && !customX.isAuto) {
    finalXType = customX.type || (xIsFreq ? "log" : "linear");
    if (finalXType === "log") {
      const minLog = customX.min > 0 ? Math.log10(customX.min) : -2;
      const maxLog = customX.max > 0 ? Math.log10(customX.max) : 5;
      finalXRange = [minLog, maxLog];
    } else {
      finalXRange = [customX.min, customX.max];
    }
    finalXDtick = customX.step || undefined;
    finalXAutorange = false;
  } else {
    finalXAutorange = true;
  }

  const curL = plotDiv?.layout?.legend;
  const hasExistingLegendPos = curL && typeof curL.x === "number" && typeof curL.y === "number";
  const legendConfig = hasExistingLegendPos
    ? {
        orientation: curL.orientation || "v",
        x: curL.x,
        y: curL.y,
        xanchor: curL.xanchor || "left",
        yanchor: curL.yanchor || "bottom",
        bgcolor: curL.bgcolor || "#ffffff",
        bordercolor: curL.bordercolor || "#000000",
        borderwidth: curL.borderwidth !== undefined ? curL.borderwidth : 1,
        itemsizing: "constant",
        itemwidth: curL.itemwidth || 18,
        tracegroupgap: 0,
        font: { size: legendFontSize, color: "#000000", family: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif' },
      }
    : autoLegendLayout(traces, xIsFreq, legendFontSize, finalYRange, plotDiv, plotsPerRow);
  const isFullscreen = (plotDiv === el.fsPlotDiv) || (plotDiv && plotDiv.id === "fs-plot-div");

  const layout = {
    autosize: true,
    dragmode: "zoom",
    uirevision: (state.plotRevisions && state.plotRevisions[bi]) || 0,
    hovermode: "x unified",
    hoverdistance: isFullscreen ? -1 : 60,
    hoverlabel: {
      bgcolor: "rgba(255, 255, 255, 0.96)",
      bordercolor: "#111827",
      font: {
        family: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        size: isQuad ? 10 : isTriple ? 11 : isMulti ? 11.5 : 12.5,
        color: "#111827",
      },
      namelength: -1,
    },
    title: titleText
      ? {
          text: `<b>${titleText}</b>`,
          xref: "paper",
          x: 0.5,
          xanchor: "center",
          yref: "paper",
          y: 1.0,
          yanchor: "bottom",
          pad: { b: 10 },
          font: {
            size: isQuad ? 12 : isTriple ? 13 : isMulti ? 13.5 : 14.5,
            color: "#111827",
            family: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          },
        }
      : undefined,
    margin: isQuad
      ? { l: 48, r: 14, t: titleText ? 32 : 16, b: 38 }
      : isTriple
      ? { l: 56, r: 18, t: titleText ? 34 : 20, b: 42 }
      : isMulti
      ? { l: 64, r: 24, t: titleText ? 36 : 24, b: 46 }
      : { l: 72, r: 35, t: titleText ? 38 : 30, b: 54 },
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
    font: {
      family: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      size: isQuad ? 10 : isTriple ? 11 : isMulti ? 11.5 : 12.5,
      color: "#111827",
    },
    xaxis: {
      fixedrange: isFullscreen,
      showspikes: true,
      spikemode: "across",
      spikesnap: "cursor",
      spikethickness: 1,
      spikedash: "dot",
      spikecolor: "#4b5563",
      title: {
        text: xLabel,
        font: {
          size: isQuad ? 11 : isTriple ? 12 : isMulti ? 13 : 14,
          color: "#111827",
          family: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        },
        standoff: isQuad ? 6 : isTriple ? 8 : 12,
      },
      type: finalXType,
      showline: true,
      linewidth: 1.5,
      linecolor: "#111827",
      mirror: true,
      ticks: "outside",
      ticklen: isQuad ? 3.5 : isTriple ? 4 : 5,
      tickwidth: 1.5,
      tickcolor: "#111827",
      tickfont: {
        size: isQuad ? 9.5 : isTriple ? 10.5 : isMulti ? 11.5 : 12.5,
        color: "#111827",
        family: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      },
      gridcolor: "#e5e7eb",
      gridwidth: 1,
      griddash: "dash",
      zeroline: false,
      ...(finalXRange ? { range: finalXRange, autorange: false } : { autorange: finalXAutorange }),
      ...(finalXDtick ? { dtick: finalXDtick } : {}),
      // Frequency-specific defaults (only when no custom overrides)
      ...(!customX || customX.isAuto
        ? (xIsFreq
          ? {
              dtick: "D1",
              exponentformat: "none",
              showexponent: "none",
              minor: {
                ticks: "outside",
                ticklen: isTriple ? 2.5 : 3,
                tickwidth: 1,
                tickcolor: "#111827",
                showgrid: true,
                gridcolor: "#f1f5f9",
                gridwidth: 1,
                griddash: "dash",
              },
            }
          : {
              minor: {
                ticks: "outside",
                ticklen: 3,
                tickwidth: 1,
                tickcolor: "#111827",
              },
            })
        : {}),
    },
    yaxis: {
      fixedrange: isFullscreen,
      title: {
        text: yLabel,
        font: {
          size: isQuad ? 11 : isTriple ? 12 : isMulti ? 13 : 14,
          color: "#111827",
          family: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        },
        standoff: isQuad ? 6 : isTriple ? 8 : 12,
      },
      type: finalYType,
      ...(finalDtick ? { dtick: finalDtick } : {}),
      showline: true,
      linewidth: 1.5,
      linecolor: "#111827",
      mirror: true,
      ticks: "outside",
      ticklen: isQuad ? 3.5 : isTriple ? 4 : 5,
      tickwidth: 1.5,
      tickcolor: "#111827",
      tickfont: {
        size: isQuad ? 9.5 : isTriple ? 10.5 : isMulti ? 11.5 : 12.5,
        color: "#111827",
        family: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      },
      gridcolor: "#e5e7eb",
      gridwidth: 1,
      griddash: "dash",
      zeroline: false,
      ...(finalYRange ? { range: finalYRange, autorange: finalAutorange } : { autorange: true }),
    },
    legend: legendConfig,
    showlegend: true,
  };

  const plotConfig = {
    responsive: true,
    displaylogo: false,
    doubleClick: false,
    scrollZoom: false,
    modeBarButtonsToRemove: isFullscreen
      ? ["toImage", "zoom2d", "pan2d", "select2d", "lasso2d", "zoomIn2d", "zoomOut2d", "autoScale2d", "resetScale2d"]
      : ["toImage"],
    modeBarButtonsToAdd: [
      {
        name: "Save plot as PNG (choose file name)",
        icon: Plotly.Icons.camera,
        click: (gd) => savePlotWithCustomName(gd, blockName),
      },
    ],
  };

  const pPromise = Plotly.react(plotDiv, traces, layout, plotConfig);
  if (pPromise && typeof pPromise.then === "function") {
    pPromise.then(() => {
      makeLegendDraggable(plotDiv);
      tightenLegendBox(plotDiv);
    }).catch(() => {
      makeLegendDraggable(plotDiv);
      tightenLegendBox(plotDiv);
    });
  } else {
    makeLegendDraggable(plotDiv);
    tightenLegendBox(plotDiv);
  }

}

function openPropertyFromPlotPointer(e, bi, blockName, plotDiv) {
  e.preventDefault();
  e.stopPropagation();
  suppressNextPlotContextMenu = true;
  clearTimeout(plotContextMenuSuppressionTimer);
  plotContextMenuSuppressionTimer = setTimeout(() => {
    suppressNextPlotContextMenu = false;
  }, 2000);
  closePlotContextMenu();
  openPropertyModal(bi, blockName, plotDiv);
}

function suppressPlotContextMenu(e) {
  e.preventDefault();
  e.stopPropagation();
}

function wirePlotPropertyContextMenu(plotDiv, bi, blockName) {
  plotDiv.addEventListener("pointerdown", (e) => {
    if (e.button === 2) openPropertyFromPlotPointer(e, bi, blockName, plotDiv);
  }, true);
  plotDiv.addEventListener("contextmenu", suppressPlotContextMenu, true);
}

let suppressNextPlotContextMenu = false;
let plotContextMenuSuppressionTimer = null;
document.addEventListener("contextmenu", (e) => {
  if (!suppressNextPlotContextMenu) return;
  suppressNextPlotContextMenu = false;
  clearTimeout(plotContextMenuSuppressionTimer);
  suppressPlotContextMenu(e);
}, true);

let activeContextMenu = null;

function closePlotContextMenu() {
  if (activeContextMenu) {
    activeContextMenu.remove();
    activeContextMenu = null;
  }
}

document.addEventListener("click", (e) => {
  if (activeContextMenu && !activeContextMenu.contains(e.target)) {
    closePlotContextMenu();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closePlotContextMenu();
});

const MATLAB_QUICK_COLORS = [
  "#0000ff", // Pure Blue
  "#0080ff", // Sky Blue
  "#00cccc", // Cyan
  "#80ff80", // Light Green
  "#cccc00", // Yellow-Olive
  "#ff8000", // Vivid Orange
  "#ff0000", // Vivid Red
  "#cc00cc", // Magenta
  "#111827", // Dark / Black
];

function openPlotContextMenu(e, bi, blockName, plotDiv) {
  closePlotContextMenu();
  if (typeof closeHxmlMenu === "function") closeHxmlMenu();

  const data = plotDiv?.data || [];
  if (!data.length) {
    openPropertyModal(bi, blockName, plotDiv);
    return;
  }

  const menu = document.createElement("div");
  menu.className = "plot-context-menu";

  // Header
  const header = document.createElement("div");
  header.className = "pcm-header";
  header.innerHTML = `
    <span class="pcm-title">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 17l6-6 4 4 8-8"/></svg>
      ${escapeHtml(blockName || "Plot")}
    </span>
    <button class="pcm-close" title="Close">&times;</button>
  `;
  header.querySelector(".pcm-close").addEventListener("click", closePlotContextMenu);
  menu.appendChild(header);

  // Line Colors section
  const colorsTitle = document.createElement("div");
  colorsTitle.className = "pcm-section-title";
  colorsTitle.textContent = "Line Colors (Click swatch or preset)";
  menu.appendChild(colorsTitle);

  const traceList = document.createElement("div");
  traceList.className = "pcm-trace-list";

  data.forEach((trace, traceIdx) => {
    const row = document.createElement("div");
    row.className = "pcm-trace-row";

    const top = document.createElement("div");
    top.className = "pcm-trace-top";

    const label = document.createElement("span");
    label.className = "pcm-trace-label";
    label.textContent = trace.name || `Trace ${traceIdx + 1}`;
    label.title = trace.name || `Trace ${traceIdx + 1}`;

    const btnWrap = document.createElement("div");
    btnWrap.className = "pcm-color-btn-wrap";

    const curColor = (trace.line && trace.line.color) || PALETTE[traceIdx % PALETTE.length];

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.className = "pcm-color-input";
    colorInput.value = rgbOrNamedToHex(curColor);
    colorInput.title = "Choose custom color";

    colorInput.addEventListener("input", (ev) => {
      applyColorChange(bi, trace.name, ev.target.value, plotDiv, traceIdx);
    });

    btnWrap.appendChild(colorInput);
    top.appendChild(label);
    top.appendChild(btnWrap);
    row.appendChild(top);

    // Quick swatches
    const swatches = document.createElement("div");
    swatches.className = "pcm-quick-swatches";
    MATLAB_QUICK_COLORS.forEach((hex) => {
      const sw = document.createElement("span");
      sw.className = "pcm-swatch";
      sw.style.backgroundColor = hex;
      sw.title = hex;
      sw.addEventListener("click", () => {
        colorInput.value = hex;
        applyColorChange(bi, trace.name, hex, plotDiv, traceIdx);
      });
      swatches.appendChild(sw);
    });
    row.appendChild(swatches);

    traceList.appendChild(row);
  });
  menu.appendChild(traceList);

  // Line Thickness
  const widthTitle = document.createElement("div");
  widthTitle.className = "pcm-section-title";
  widthTitle.textContent = "Line Thickness";
  menu.appendChild(widthTitle);

  const widthRow = document.createElement("div");
  widthRow.className = "pcm-btn-row";
  [1.5, 2.0, 2.5, 3.0, 3.5, 4.0].forEach((w) => {
    const btn = document.createElement("button");
    btn.className = "pcm-pill-btn";
    btn.textContent = `${w}px`;
    btn.addEventListener("click", () => {
      applyWidthChange(bi, w, plotDiv);
      closePlotContextMenu();
    });
    widthRow.appendChild(btn);
  });
  menu.appendChild(widthRow);

  // Line Style
  const styleTitle = document.createElement("div");
  styleTitle.className = "pcm-section-title";
  styleTitle.textContent = "Line Style";
  menu.appendChild(styleTitle);

  const styleRow = document.createElement("div");
  styleRow.className = "pcm-btn-row";
  [
    { label: "Solid ──", val: "solid" },
    { label: "Dashed - -", val: "dash" },
    { label: "Dotted · ·", val: "dot" },
    { label: "Dash-Dot — ·", val: "dashdot" },
  ].forEach((st) => {
    const btn = document.createElement("button");
    btn.className = "pcm-pill-btn";
    btn.textContent = st.label;
    btn.addEventListener("click", () => {
      applyDashChange(bi, st.val, plotDiv);
      closePlotContextMenu();
    });
    styleRow.appendChild(btn);
  });
  menu.appendChild(styleRow);

  // Divider & Actions
  const divider = document.createElement("div");
  divider.className = "hxml-dropdown-divider";
  menu.appendChild(divider);

  const propBtn = document.createElement("button");
  propBtn.className = "pcm-action-btn";
  propBtn.innerHTML = `
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
    Axis Properties & Scales...
  `;
  propBtn.addEventListener("click", () => {
    closePlotContextMenu();
    openPropertyModal(bi, blockName, plotDiv);
  });
  menu.appendChild(propBtn);

  const resetBtn = document.createElement("button");
  resetBtn.className = "pcm-action-btn";
  resetBtn.innerHTML = `
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
    Reset to Default Colors
  `;
  resetBtn.addEventListener("click", () => {
    closePlotContextMenu();
    resetPlotColors(bi, blockName, plotDiv);
  });
  menu.appendChild(resetBtn);

  document.body.appendChild(menu);
  activeContextMenu = menu;

  // Position at cursor with boundary protection
  const rect = menu.getBoundingClientRect();
  let left = e.clientX;
  let top = e.clientY;
  if (left + rect.width > window.innerWidth - 10) {
    left = Math.max(10, window.innerWidth - rect.width - 10);
  }
  if (top + rect.height > window.innerHeight - 10) {
    top = Math.max(10, window.innerHeight - rect.height - 10);
  }
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function applyColorChange(bi, traceName, newColor, plotDiv, traceIdx) {
  state.customColors = state.customColors || {};
  if (bi !== undefined && traceName) {
    state.customColors[`${bi}::${traceName}`] = newColor;
  }

  // Live update the current Plotly graph immediately
  if (plotDiv && typeof traceIdx === "number") {
    try {
      Plotly.restyle(plotDiv, { "line.color": newColor, "marker.color": newColor }, [traceIdx]);
    } catch (err) {
      console.warn("Plotly restyle color error", err);
    }
  }
}

function applyWidthChange(bi, newWidth, plotDiv) {
  state.customLineWidths = state.customLineWidths || {};
  if (bi !== undefined) {
    state.customLineWidths[bi] = newWidth;
  }
  if (plotDiv) {
    try {
      Plotly.restyle(plotDiv, { "line.width": newWidth });
    } catch (err) {
      console.warn("Plotly restyle width error", err);
    }
  }
}

function applyDashChange(bi, newDash, plotDiv) {
  state.customLineDashes = state.customLineDashes || {};
  if (bi !== undefined) {
    state.customLineDashes[bi] = newDash;
  }
  if (plotDiv) {
    try {
      Plotly.restyle(plotDiv, { "line.dash": newDash });
    } catch (err) {
      console.warn("Plotly restyle dash error", err);
    }
  }
}

function resetPlotColors(bi, blockName, plotDiv) {
  state.customColors = state.customColors || {};
  state.customLineWidths = state.customLineWidths || {};
  state.customLineDashes = state.customLineDashes || {};

  delete state.customLineWidths[bi];
  delete state.customLineDashes[bi];

  Object.keys(state.customColors).forEach((k) => {
    if (k.startsWith(`${bi}::`)) delete state.customColors[k];
  });

  renderSelectedPlots();
  renderDutList();
}

function rgbOrNamedToHex(col) {
  if (!col) return "#0000ff";
  if (typeof col === "string" && col.startsWith("#")) {
    if (col.length === 4) {
      return "#" + col[1] + col[1] + col[2] + col[2] + col[3] + col[3];
    }
    return col;
  }
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = col;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return "#" + ((1 << 24) + (d[0] << 16) + (d[1] << 8) + d[2]).toString(16).slice(1);
}

let currentModalBi = null;
let currentModalPlotDiv = null;

function openPropertyModal(bi, blockName, plotDiv) {
  currentModalBi = bi;
  currentModalPlotDiv = plotDiv;

  const currentTitle = (state.customTitles && state.customTitles[bi] !== undefined)
    ? state.customTitles[bi]
    : blockName;

  if (el.yModalTargetPlot) {
    el.yModalTargetPlot.textContent = blockName;
  }
  if (el.plotTitleInput) {
    el.plotTitleInput.value = currentTitle || "";
  }

  // Populate Lines panel in property modal
  if (el.modalLinesList) {
    el.modalLinesList.innerHTML = "";
    const data = plotDiv?.data || [];
    if (!data.length) {
      el.modalLinesList.innerHTML = '<span style="color:var(--text-mute);font-size:12px;padding:8px;">No active traces in this plot.</span>';
    } else {
      data.forEach((trace, traceIdx) => {
        const row = document.createElement("div");
        row.className = "pcm-trace-row";
        const top = document.createElement("div");
        top.className = "pcm-trace-top";

        const label = document.createElement("span");
        label.className = "pcm-trace-label";
        label.textContent = trace.name || `Trace ${traceIdx + 1}`;

        const curColor = (trace.line && trace.line.color) || PALETTE[traceIdx % PALETTE.length];
        const colorInput = document.createElement("input");
        colorInput.type = "color";
        colorInput.className = "pcm-color-input";
        colorInput.value = rgbOrNamedToHex(curColor);

        colorInput.addEventListener("input", (ev) => {
          applyColorChange(bi, trace.name, ev.target.value, plotDiv, traceIdx);
        });

        top.appendChild(label);
        top.appendChild(colorInput);
        row.appendChild(top);

        const swatches = document.createElement("div");
        swatches.className = "pcm-quick-swatches";
        MATLAB_QUICK_COLORS.forEach((hex) => {
          const sw = document.createElement("span");
          sw.className = "pcm-swatch";
          sw.style.backgroundColor = hex;
          sw.title = hex;
          sw.addEventListener("click", () => {
            colorInput.value = hex;
            applyColorChange(bi, trace.name, hex, plotDiv, traceIdx);
          });
          swatches.appendChild(sw);
        });
        row.appendChild(swatches);
        el.modalLinesList.appendChild(row);
      });
    }
  }

  // Populate Curve Names panel in property modal
  if (el.modalCurvesList) {
    el.modalCurvesList.innerHTML = "";
    const data = plotDiv?.data || [];
    if (!data.length) {
      el.modalCurvesList.innerHTML = '<span style="color:var(--text-mute);font-size:12px;padding:8px;">No active traces in this plot.</span>';
    } else {
      data.forEach((trace, traceIdx) => {
        const row = document.createElement("div");
        row.className = "pcm-curve-row";
        row.style.cssText = "display:flex; flex-direction:column; gap:5px; padding:8px 10px; background:var(--surface-2); border:1px solid var(--border); border-radius:var(--radius-sm);";

        const origName = trace.origName || trace.instFile || trace.name || `Trace ${traceIdx + 1}`;
        const cleanOrig = origName.replace(/\.hxml$/i, "");
        state.customCurveNames = state.customCurveNames || {};
        const savedCustom = (bi !== undefined ? state.customCurveNames[`${bi}::${origName}`] : null)
          || (bi !== undefined ? state.customCurveNames[`${bi}::${cleanOrig}`] : null)
          || "";

        const currentDisplayName = savedCustom || trace.name || origName;
        const curColor = (trace.line && trace.line.color) || PALETTE[traceIdx % PALETTE.length];

        const top = document.createElement("div");
        top.style.cssText = "display:flex; align-items:center; justify-content:space-between; gap:8px;";

        const left = document.createElement("div");
        left.style.cssText = "display:flex; align-items:center; gap:6px; min-width:0; overflow:hidden;";

        const dot = document.createElement("span");
        dot.className = "dut-dot";
        dot.style.cssText = `display:inline-block; width:10px; height:10px; border-radius:2px; background:${curColor}; flex-shrink:0;`;

        const origLabel = document.createElement("span");
        origLabel.style.cssText = "font-size:11.5px; color:var(--text-mute); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:monospace;";
        origLabel.textContent = `Default: ${cleanOrig}`;
        origLabel.title = `Original name: ${origName}`;

        left.appendChild(dot);
        left.appendChild(origLabel);
        top.appendChild(left);

        const revertBtn = document.createElement("button");
        revertBtn.type = "button";
        revertBtn.style.cssText = "background:transparent; border:none; color:var(--text-mute); font-size:11px; cursor:pointer; padding:2px 6px; border-radius:4px; transition:all 0.15s; display:inline-flex; align-items:center; gap:3px;";
        revertBtn.innerHTML = "↺ Reset";
        revertBtn.title = "Reset this curve to its original default name";
        revertBtn.addEventListener("mouseover", () => { revertBtn.style.color = "var(--text)"; revertBtn.style.background = "var(--surface-3)"; });
        revertBtn.addEventListener("mouseout", () => { revertBtn.style.color = "var(--text-mute)"; revertBtn.style.background = "transparent"; });

        top.appendChild(revertBtn);
        row.appendChild(top);

        const input = document.createElement("input");
        input.type = "text";
        input.className = "pcm-curve-name-input";
        input.dataset.traceIdx = String(traceIdx);
        input.dataset.origName = origName;
        input.dataset.cleanOrig = cleanOrig;
        input.value = currentDisplayName;
        input.placeholder = cleanOrig;
        input.style.cssText = "width:100%; box-sizing:border-box; padding:6px 9px; font-size:12.5px; border:1px solid var(--border); border-radius:var(--radius-sm); outline:none; background:var(--surface); color:var(--text);";

        revertBtn.addEventListener("click", () => {
          input.value = cleanOrig;
          const orig = input.dataset.origName;
          const clean = input.dataset.cleanOrig;

          state.customCurveNames = state.customCurveNames || {};
          if (bi !== undefined) {
            delete state.customCurveNames[`${bi}::${orig}`];
            delete state.customCurveNames[`${bi}::${clean}`];
          }

          if (plotDiv && !isNaN(traceIdx)) {
            try {
              Plotly.restyle(plotDiv, { name: cleanOrig }, [traceIdx]);
            } catch (e) {}
          }
          schedulePersist();
          input.focus();
        });

        row.appendChild(input);
        el.modalCurvesList.appendChild(row);
      });
    }
  }

  // --- Populate Y-axis fields ---
  const yaxis = plotDiv._fullLayout?.yaxis;
  const currentYType = yaxis?.type || "linear";
  const customY = state.customYScales[bi];

  let yMin = "", yMax = "", yStep = "", yScaleType = "linear";

  if (customY && !customY.isAuto) {
    yMin = customY.min;
    yMax = customY.max;
    yStep = customY.step ?? "";
    yScaleType = customY.type || "linear";
  } else {
    yScaleType = currentYType;
    if (yaxis?.range && yaxis.range.length >= 2) {
      let lo = yaxis.range[0], hi = yaxis.range[1];
      if (currentYType === "log") { lo = Math.pow(10, lo); hi = Math.pow(10, hi); }
      yMin = typeof lo === "number" && !isNaN(lo) ? Math.round(lo * 100) / 100 : "";
      yMax = typeof hi === "number" && !isNaN(hi) ? Math.round(hi * 100) / 100 : "";
    }
    yStep = yaxis?.dtick || "";
  }

  if (el.yMinInput) el.yMinInput.value = yMin !== "" ? yMin : "";
  if (el.yMaxInput) el.yMaxInput.value = yMax !== "" ? yMax : "";
  if (el.yStepInput) el.yStepInput.value = yStep !== "" ? yStep : "";
  if (el.yScaleSelect) el.yScaleSelect.value = yScaleType;

  // --- Populate X-axis fields ---
  const xaxis = plotDiv._fullLayout?.xaxis;
  const currentXType = xaxis?.type || "linear";
  const customX = state.customXScales[bi];

  let xMin = "", xMax = "", xStep = "", xScaleType = currentXType;

  if (customX && !customX.isAuto) {
    xMin = customX.min;
    xMax = customX.max;
    xStep = customX.step ?? "";
    xScaleType = customX.type || currentXType;
  } else {
    if (xaxis?.range && xaxis.range.length >= 2) {
      let lo = xaxis.range[0], hi = xaxis.range[1];
      if (currentXType === "log") { lo = Math.pow(10, lo); hi = Math.pow(10, hi); }
      xMin = typeof lo === "number" && !isNaN(lo) ? Math.round(lo * 100) / 100 : "";
      xMax = typeof hi === "number" && !isNaN(hi) ? Math.round(hi * 100) / 100 : "";
    }
    xStep = "";
  }

  if (el.xMinInput) el.xMinInput.value = xMin !== "" ? xMin : "";
  if (el.xMaxInput) el.xMaxInput.value = xMax !== "" ? xMax : "";
  if (el.xStepInput) el.xStepInput.value = xStep !== "" ? xStep : "";
  if (el.xScaleSelect) el.xScaleSelect.value = xScaleType;

  // Reset exclusively to Y-axis tab when modal opens
  switchAxisTab("y");

  if (el.yModalBackdrop) {
    el.yModalBackdrop.hidden = false;
    centerPropertyModal(false);
  }

  setTimeout(() => {
    el.plotTitleInput?.focus();
    el.plotTitleInput?.select();
  }, 50);
}

const openYAxisModal = openPropertyModal;

function initPropertyModalDraggable() {
  const modal = el.yModal || document.getElementById("yaxis-modal");
  if (!modal) return;
  const header = modal.querySelector(".modal-header");
  if (!header) return;

  header.setAttribute("title", "Click and drag to relocate window (Double-click to re-center)");

  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let initialLeft = 0;
  let initialTop = 0;

  header.addEventListener("pointerdown", (e) => {
    if (e.target.closest("#yaxis-modal-close") || e.target.closest("button") || e.target.closest("input")) {
      return;
    }
    if (e.button !== 0) return;

    isDragging = true;
    modal.classList.add("is-dragging");
    startX = e.clientX;
    startY = e.clientY;

    const rect = modal.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;

    try {
      header.setPointerCapture(e.pointerId);
    } catch (_) {}
    e.preventDefault();
  });

  header.addEventListener("pointermove", (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    let newLeft = initialLeft + dx;
    let newTop = initialTop + dy;

    const modalWidth = modal.offsetWidth || 520;
    const pad = 8;
    const maxLeft = Math.max(pad, window.innerWidth - modalWidth - pad);
    const maxTop = Math.max(pad, window.innerHeight - 60);

    newLeft = Math.min(Math.max(pad, newLeft), maxLeft);
    newTop = Math.min(Math.max(pad, newTop), maxTop);

    modal.style.left = `${newLeft}px`;
    modal.style.top = `${newTop}px`;
    modal.style.right = "auto";
    modal.style.bottom = "auto";
    modal.style.margin = "0";
    modal._hasCustomPosition = true;
  });

  const stopDrag = (e) => {
    if (!isDragging) return;
    isDragging = false;
    modal.classList.remove("is-dragging");
    try {
      if (header.hasPointerCapture(e.pointerId)) {
        header.releasePointerCapture(e.pointerId);
      }
    } catch (_) {}
  };

  header.addEventListener("pointerup", stopDrag);
  header.addEventListener("pointercancel", stopDrag);

  // Double-click header to re-center window
  header.addEventListener("dblclick", (e) => {
    if (e.target.closest("#yaxis-modal-close") || e.target.closest("button")) return;
    centerPropertyModal(true);
  });

  window.addEventListener("resize", clampPropertyModalToScreen);
}

function centerPropertyModal(force = false) {
  const modal = el.yModal || document.getElementById("yaxis-modal");
  if (!modal) return;
  if (force || !modal._hasCustomPosition) {
    modal._hasCustomPosition = false;
    requestAnimationFrame(() => {
      const modalWidth = modal.offsetWidth || 520;
      const modalHeight = modal.offsetHeight || 480;
      const left = Math.max(10, Math.round((window.innerWidth - modalWidth) / 2));
      const top = Math.max(20, Math.round((window.innerHeight - modalHeight) / 2));
      modal.style.left = `${left}px`;
      modal.style.top = `${top}px`;
      modal.style.right = "auto";
      modal.style.bottom = "auto";
      modal.style.margin = "0";
    });
  } else {
    clampPropertyModalToScreen();
  }
}

function clampPropertyModalToScreen() {
  const modal = el.yModal || document.getElementById("yaxis-modal");
  if (!modal || !modal._hasCustomPosition) return;
  const rect = modal.getBoundingClientRect();
  const pad = 8;
  const maxLeft = Math.max(pad, window.innerWidth - rect.width - pad);
  const maxTop = Math.max(pad, window.innerHeight - 60);

  const clampedLeft = Math.min(Math.max(pad, rect.left), maxLeft);
  const clampedTop = Math.min(Math.max(pad, rect.top), maxTop);

  modal.style.left = `${clampedLeft}px`;
  modal.style.top = `${clampedTop}px`;
}

function applyAxisSettings() {
  if (currentModalBi === null) return;
  const modalBi = currentModalBi;
  const block = state.blocks[modalBi];
  const blockName = block ? block.name : (state.fsPlotInfo?.blockName || "");
  const fullscreenBlockName = state.fsPlotInfo?.bi === modalBi ? state.fsPlotInfo.blockName : null;

  const combinedRelayout = {};

  // 1. Save and update custom title in-place
  if (el.plotTitleInput) {
    const newTitle = el.plotTitleInput.value.trim();
    const prevTitle = (state.customTitles && state.customTitles[modalBi]) || "";
    if (newTitle) {
      state.customTitles[modalBi] = newTitle;
    } else {
      delete state.customTitles[modalBi];
    }
    const displayTitle = newTitle || blockName;
    const card = currentModalPlotDiv?.closest(".plot-card");
    if (card) {
      const titleEl = card.querySelector(".plot-card-title");
      if (titleEl) titleEl.textContent = displayTitle;
    }
    if (newTitle !== prevTitle) {
      combinedRelayout["title.text"] = displayTitle ? `<b>${displayTitle}</b>` : undefined;
    }
  }

  // 2. Save and update custom curve names ONLY if curve tab is active, strictly for this plot (modalBi)
  if (currentAxisTab === "curves" && el.modalCurvesList) {
    const inputs = el.modalCurvesList.querySelectorAll(".pcm-curve-name-input");
    state.customCurveNames = state.customCurveNames || {};

    const finalNamesMap = {};
    let hasNameChange = false;

    inputs.forEach((inp) => {
      const orig = inp.dataset.origName;
      const clean = inp.dataset.cleanOrig;
      const traceIdx = parseInt(inp.dataset.traceIdx, 10);
      const val = inp.value.trim();
      const finalName = (val && val !== orig && val !== clean) ? val : (clean || orig);

      if (val && val !== orig && val !== clean) {
        state.customCurveNames[`${modalBi}::${orig}`] = val;
        state.customCurveNames[`${modalBi}::${clean}`] = val;
      } else {
        delete state.customCurveNames[`${modalBi}::${orig}`];
        delete state.customCurveNames[`${modalBi}::${clean}`];
      }

      if (!isNaN(traceIdx)) {
        finalNamesMap[traceIdx] = finalName;
        if (currentModalPlotDiv?.data?.[traceIdx]?.name !== finalName) {
          hasNameChange = true;
        }
      }
    });

    // Instant single-call restyle of this single plot ONLY
    if (currentModalPlotDiv && currentModalPlotDiv.data && hasNameChange) {
      const allNames = currentModalPlotDiv.data.map((tr, idx) => finalNamesMap[idx] !== undefined ? finalNamesMap[idx] : tr.name);
      try {
        Plotly.restyle(currentModalPlotDiv, { name: allNames });
      } catch (e) {}
    }
  }

  // 3. Y-Axis Scale in-place for this plot
  if (currentAxisTab === "y") {
    const minValStr = el.yMinInput.value.trim();
    const maxValStr = el.yMaxInput.value.trim();
    if (minValStr !== "" || maxValStr !== "") {
      const rawMin = parseFloat(minValStr);
      const rawMax = parseFloat(maxValStr);
      const rawStep = parseFloat(el.yStepInput.value);
      const scaleType = el.yScaleSelect.value || "linear";

      if (isNaN(rawMin) || isNaN(rawMax)) {
        alert("Please enter valid numbers for Y-axis Min and Max values (or leave blank for auto).");
        return;
      }
      if (rawMin >= rawMax) {
        alert("Y-axis Min value must be less than Max value.");
        return;
      }
      if (scaleType === "log" && rawMin <= 0) {
        alert("Logarithmic scale requires Y-axis Min to be strictly greater than 0.");
        return;
      }

      const cfg = { min: rawMin, max: rawMax, step: !isNaN(rawStep) && rawStep > 0 ? rawStep : null, type: scaleType, isAuto: false };
      const yUpdate = {};
      if (cfg.type === "log") {
        yUpdate["yaxis.type"] = "log";
        yUpdate["yaxis.range"] = [cfg.min > 0 ? Math.log10(cfg.min) : -2, cfg.max > 0 ? Math.log10(cfg.max) : 2];
      } else {
        yUpdate["yaxis.type"] = "linear";
        yUpdate["yaxis.range"] = [cfg.min, cfg.max];
      }
      yUpdate["yaxis.autorange"] = false;
      if (cfg.step) yUpdate["yaxis.dtick"] = cfg.step;

      Object.assign(combinedRelayout, yUpdate);
      state.customYScales[modalBi] = cfg;
    }
  } else if (currentAxisTab === "x") {
    // 4. X-Axis Scale in-place for this plot
    const minValStr = el.xMinInput.value.trim();
    const maxValStr = el.xMaxInput.value.trim();
    if (minValStr !== "" || maxValStr !== "") {
      const rawMin = parseFloat(minValStr);
      const rawMax = parseFloat(maxValStr);
      const rawStep = parseFloat(el.xStepInput.value);
      const scaleType = el.xScaleSelect.value || "linear";

      if (isNaN(rawMin) || isNaN(rawMax)) {
        alert("Please enter valid numbers for X-axis Min and Max values (or leave blank for auto).");
        return;
      }
      if (rawMin >= rawMax) {
        alert("X-axis Min value must be less than Max value.");
        return;
      }
      if (scaleType === "log" && rawMin <= 0) {
        alert("Logarithmic scale requires X-axis Min to be strictly greater than 0.");
        return;
      }

      const cfg = { min: rawMin, max: rawMax, step: !isNaN(rawStep) && rawStep > 0 ? rawStep : null, type: scaleType, isAuto: false };
      const xUpdate = {};
      if (cfg.type === "log") {
        xUpdate["xaxis.type"] = "log";
        xUpdate["xaxis.range"] = [cfg.min > 0 ? Math.log10(cfg.min) : -2, cfg.max > 0 ? Math.log10(cfg.max) : 5];
      } else {
        xUpdate["xaxis.type"] = "linear";
        xUpdate["xaxis.range"] = [cfg.min, cfg.max];
      }
      xUpdate["xaxis.autorange"] = false;
      if (cfg.step) xUpdate["xaxis.dtick"] = cfg.step;

      Object.assign(combinedRelayout, xUpdate);
      state.customXScales[modalBi] = cfg;
    }
  }

  // Execute combined relayout on currentModalPlotDiv in one single instantaneous call
  if (currentModalPlotDiv && Object.keys(combinedRelayout).length > 0) {
    try { Plotly.relayout(currentModalPlotDiv, combinedRelayout); } catch (e) {}
  }

  // 5. Fullscreen update if active
  if (fullscreenBlockName !== null && el.fsPlotDiv && currentModalPlotDiv !== el.fsPlotDiv) {
    const curTitle = (state.customTitles && state.customTitles[modalBi]) || fullscreenBlockName;
    try { Plotly.relayout(el.fsPlotDiv, { "title.text": curTitle ? `<b>${curTitle}</b>` : undefined }); } catch (e) {}
  }

  // Provide brief visual feedback on the Apply button while keeping property window open
  if (el.yApplyBtn) {
    const originalText = el.yApplyBtn.textContent;
    el.yApplyBtn.textContent = "✓ Applied";
    el.yApplyBtn.style.pointerEvents = "none";
    setTimeout(() => {
      if (el.yApplyBtn) {
        el.yApplyBtn.textContent = originalText;
        el.yApplyBtn.style.pointerEvents = "";
      }
    }, 900);
  }

  schedulePersist();
}

function showConfirmDialog({ title = "Confirm Reset", message, yesText = "Yes, Reset", noText = "No, Cancel", isDanger = true }) {
  return new Promise((resolve) => {
    const backdrop = document.getElementById("confirm-modal-backdrop");
    const titleEl = document.getElementById("confirm-modal-title");
    const msgEl = document.getElementById("confirm-modal-message");
    const yesBtn = document.getElementById("confirm-modal-yes-btn");
    const noBtn = document.getElementById("confirm-modal-no-btn");

    if (!backdrop || !yesBtn || !noBtn) {
      const result = window.confirm(message);
      resolve(result);
      return;
    }

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    if (yesBtn) {
      yesBtn.textContent = yesText;
      yesBtn.className = isDanger ? "btn danger btn-sm" : "btn primary btn-sm";
    }
    if (noBtn) noBtn.textContent = noText;

    let cleanup = null;

    const onYes = () => {
      cleanup();
      resolve(true);
    };

    const onNo = () => {
      cleanup();
      resolve(false);
    };

    const onBackdrop = (e) => {
      if (e.target === backdrop) onNo();
    };

    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onNo();
      }
    };

    cleanup = () => {
      backdrop.hidden = true;
      yesBtn.removeEventListener("click", onYes);
      noBtn.removeEventListener("click", onNo);
      backdrop.removeEventListener("click", onBackdrop);
      window.removeEventListener("keydown", onKey, true);
    };

    yesBtn.addEventListener("click", onYes);
    noBtn.addEventListener("click", onNo);
    backdrop.addEventListener("click", onBackdrop);
    window.addEventListener("keydown", onKey, true);

    backdrop.hidden = false;
    setTimeout(() => {
      noBtn.focus();
    }, 40);
  });
}

async function resetAxisSettings() {
  if (currentModalBi === null) return;
  const modalBi = currentModalBi;
  const block = state.blocks[modalBi];
  const blockName = block ? block.name : (state.fsPlotInfo?.blockName || "");

  let confirmMsg = "Are you sure you want to reset all customized settings for this plot?";
  if (currentAxisTab === "curves") {
    confirmMsg = "Are you sure you want to reset ALL customized curve names for this plot back to their original defaults?";
  } else if (currentAxisTab === "lines") {
    confirmMsg = "Are you sure you want to reset ALL line colors, widths, and styles for this plot back to their defaults?";
  } else if (currentAxisTab === "y") {
    confirmMsg = "Are you sure you want to reset the Y-axis scale to Auto for this plot?";
  } else if (currentAxisTab === "x") {
    confirmMsg = "Are you sure you want to reset the X-axis scale to Auto for this plot?";
  }

  const ok = await showConfirmDialog({
    title: "Confirm Reset",
    message: confirmMsg,
    yesText: "Yes, Reset",
    noText: "No, Cancel",
    isDanger: true
  });

  if (!ok) return;

  if (currentAxisTab === "lines") {
    state.customLineWidths = state.customLineWidths || {};
    state.customLineDashes = state.customLineDashes || {};
    state.customColors = state.customColors || {};
    delete state.customLineWidths[modalBi];
    delete state.customLineDashes[modalBi];
    Object.keys(state.customColors).forEach((k) => {
      if (k.startsWith(`${modalBi}::`)) delete state.customColors[k];
    });

    if (currentModalPlotDiv && currentModalPlotDiv.data) {
      const colors = currentModalPlotDiv.data.map((_, tIdx) => PALETTE[tIdx % PALETTE.length]);
      const dashes = currentModalPlotDiv.data.map(() => "solid");
      try {
        Plotly.restyle(currentModalPlotDiv, { "line.color": colors, "marker.color": colors, "line.dash": dashes });
      } catch (e) {}
    }

    if (el.modalLinesList) {
      const rows = el.modalLinesList.querySelectorAll(".pcm-trace-row");
      rows.forEach((row, rIdx) => {
        const colorInp = row.querySelector(".pcm-color-input");
        const defaultColor = PALETTE[rIdx % PALETTE.length];
        if (colorInp) colorInp.value = rgbOrNamedToHex(defaultColor);
      });
    }
    renderDutList();
    schedulePersist();
    return;
  }

  if (currentAxisTab === "curves") {
    state.customCurveNames = state.customCurveNames || {};
    Object.keys(state.customCurveNames).forEach((k) => {
      if (k.startsWith(`${modalBi}::`)) {
        delete state.customCurveNames[k];
      }
    });

    const resetNames = [];

    if (el.modalCurvesList) {
      const inputs = el.modalCurvesList.querySelectorAll(".pcm-curve-name-input");
      inputs.forEach((inp) => {
        const resetVal = inp.dataset.cleanOrig || inp.dataset.origName || "";
        inp.value = resetVal;
        resetNames.push(resetVal);
      });
    }

    // Instant single-call restyle of current plot ONLY
    if (currentModalPlotDiv && currentModalPlotDiv.data && resetNames.length > 0) {
      try {
        Plotly.restyle(currentModalPlotDiv, { name: resetNames });
      } catch (e) {}
    }

    schedulePersist();
    return;
  }

  // Y-axis reset (target plot only)
  if (currentAxisTab === "y") {
    delete state.customYScales[modalBi];
    const yReset = { "yaxis.autorange": true, "yaxis.dtick": null };
    if (currentModalPlotDiv) {
      try { Plotly.relayout(currentModalPlotDiv, yReset); } catch (e) {}
    }
    if (el.yMinInput) el.yMinInput.value = "";
    if (el.yMaxInput) el.yMaxInput.value = "";
    if (el.yStepInput) el.yStepInput.value = "";
    if (el.yScaleSelect) el.yScaleSelect.value = "linear";
  } else if (currentAxisTab === "x") {
    // X-axis reset (target plot only)
    delete state.customXScales[modalBi];
    const xReset = { "xaxis.autorange": true, "xaxis.dtick": null };
    if (currentModalPlotDiv) {
      try { Plotly.relayout(currentModalPlotDiv, xReset); } catch (e) {}
    }
    if (el.xMinInput) el.xMinInput.value = "";
    if (el.xMaxInput) el.xMaxInput.value = "";
    if (el.xStepInput) el.xStepInput.value = "";
    if (el.xScaleSelect) el.xScaleSelect.value = "linear";
  }

  schedulePersist();
}

function closeYAxisModal() {
  if (el.yModalBackdrop) {
    el.yModalBackdrop.hidden = true;
  }
  currentModalBi = null;
  currentModalPlotDiv = null;
}

function tightenLegendBox(plotDiv) {
  if (!plotDiv) return;
  requestAnimationFrame(() => {
    const legendG = plotDiv.querySelector("g.legend");
    if (!legendG) return;
    const bg = legendG.querySelector("rect.bg");
    const scrollbox = legendG.querySelector("g.scrollbox");
    if (!bg || !scrollbox) return;

    try {
      const sBBox = scrollbox.getBBox();
      if (sBBox.width > 0 && sBBox.height > 0) {
        const padX = 4;
        const padY = 3;
        bg.setAttribute("x", String(Math.round(sBBox.x - padX)));
        bg.setAttribute("y", String(Math.round(sBBox.y - padY)));
        bg.setAttribute("width", String(Math.round(sBBox.width + padX * 2)));
        bg.setAttribute("height", String(Math.round(sBBox.height + padY * 2)));
      }
    } catch (e) {}
  });
}

function makeLegendDraggable(plotDiv) {
  if (!plotDiv || plotDiv._hasDraggableLegend) return;
  plotDiv._hasDraggableLegend = true;

  let isDragging = false;
  let dragLegend = null;
  let startX = 0, startY = 0;
  let origTx = 0, origTy = 0;
  let currentTx = 0, currentTy = 0;

  // Manage parent plot card draggable state so hovering/dragging legend keeps the plot static
  const setCardDraggable = (canDrag) => {
    const card = plotDiv.closest(".plot-card");
    if (card) card.draggable = canDrag;
  };

  plotDiv.addEventListener("mouseover", (e) => {
    if (e.target && e.target.closest && e.target.closest("g.legend")) {
      setCardDraggable(false);
    } else if (!isDragging) {
      setCardDraggable(true);
    }
  });

  plotDiv.addEventListener("mouseout", (e) => {
    if (isDragging) return;
    const toLegend = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest("g.legend");
    if (!toLegend) {
      setCardDraggable(true);
    }
  });

  plotDiv.addEventListener("mouseleave", () => {
    if (!isDragging) {
      setCardDraggable(true);
    }
  });

  plotDiv.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const legend = e.target.closest("g.legend");
    if (!legend) return;

    // Immediately disable card drag mode so the plot card stays completely static
    setCardDraggable(false);

    dragLegend = legend;
    startX = e.clientX;
    startY = e.clientY;

    const match = /translate\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/.exec(legend.getAttribute("transform") || "");
    origTx = match ? parseFloat(match[1]) : 0;
    origTy = match ? parseFloat(match[2]) : 0;
    currentTx = origTx;
    currentTy = origTy;
    isDragging = false;

    const onMouseMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!isDragging && Math.hypot(dx, dy) > 8) {
        isDragging = true;
        dragLegend.classList.add("is-dragging");
        document.body.style.userSelect = "none";
        setCardDraggable(false);
      }
      if (isDragging) {
        currentTx = origTx + dx;
        currentTy = origTy + dy;
        dragLegend.setAttribute("transform", `translate(${currentTx}, ${currentTy})`);
      }
    };

    const onMouseUp = (ev) => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);

      if (isDragging && dragLegend) {
        dragLegend.classList.remove("is-dragging");
        document.body.style.userSelect = "";

        const size = plotDiv._fullLayout?._size;
        const plotL = size?.l ?? 72;
        const plotT = size?.t ?? 50;
        const plotW = size?.w ?? Math.max(100, plotDiv.clientWidth - 107);
        const plotH = size?.h ?? Math.max(100, plotDiv.clientHeight - 104);

        const newX = (currentTx - plotL) / plotW;
        const newY = 1 - (currentTy - plotT) / plotH;

        Plotly.relayout(plotDiv, {
          "legend.x": Math.max(-0.05, Math.min(1.05, newX)),
          "legend.y": Math.max(-0.05, Math.min(1.05, newY)),
          "legend.xanchor": "left",
          "legend.yanchor": "top",
        });

        const killClick = (kEv) => {
          kEv.stopPropagation();
          kEv.preventDefault();
          window.removeEventListener("click", killClick, true);
        };
        window.addEventListener("click", killClick, true);
        setTimeout(() => window.removeEventListener("click", killClick, true), 80);
      }

      isDragging = false;
      dragLegend = null;

      // Restore card draggable if mouse has left the legend
      const elAtPoint = ev ? document.elementFromPoint(ev.clientX, ev.clientY) : null;
      if (!elAtPoint || !elAtPoint.closest("g.legend")) {
        setCardDraggable(true);
      }
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  });
}

function renderScalarTables(blocksWithScalars) {
  if (!blocksWithScalars || !blocksWithScalars.length) {
    el.scalarCard.hidden = true;
    if (el.scalarTablesWrap) el.scalarTablesWrap.innerHTML = "";
    return;
  }

  el.scalarCard.hidden = false;
  el.scalarTablesWrap.innerHTML = "";

  const totalDuts = state.files.length;
  el.scalarSub.textContent = `${totalDuts} DUT${totalDuts === 1 ? "" : "s"} · ${blocksWithScalars.length} block${blocksWithScalars.length === 1 ? "" : "s"} with scalars`;

  blocksWithScalars.forEach(({ bi, block, scalarCols }) => {
    const blockSection = document.createElement("div");
    blockSection.id = `scalar-table-block-${bi}`;
    blockSection.className = "scalar-block";
    blockSection.style.marginBottom = "14px";

    if (blocksWithScalars.length > 1) {
      const blockTitle = document.createElement("div");
      blockTitle.className = "scalar-block-label";
      blockTitle.innerHTML = `<b>${escapeHtml(block.name)}</b> <span style="font-size:11.5px;color:var(--text-mute);font-weight:normal;">(${scalarCols.length} scalar metric${scalarCols.length === 1 ? "" : "s"})</span>`;
      blockSection.appendChild(blockTitle);
    }

    const scrollDiv = document.createElement("div");
    scrollDiv.className = "scalar-scroll";

    const table = document.createElement("table");
    table.className = "data";

    const numScalarCols = scalarCols.length;
    const initialFirstColW = calculateScalarFirstColWidth();
    const colWidthCalc = numScalarCols > 0
      ? `calc((100% - var(--scalar-first-col-w, ${initialFirstColW}px)) / ${numScalarCols})`
      : "auto";

    let colgroup = "<colgroup>";
    colgroup += `<col class="sticky-col" style="width:var(--scalar-first-col-w, ${initialFirstColW}px);min-width:var(--scalar-first-col-w, ${initialFirstColW}px);max-width:var(--scalar-first-col-w, ${initialFirstColW}px);">`;
    if (numScalarCols > 0) {
      for (let i = 0; i < numScalarCols; i++) {
        colgroup += `<col style="width:${colWidthCalc};min-width:85px;">`;
      }
    }
    colgroup += "</colgroup>";

    let thead = "<thead><tr>";
    thead += `<th class="sticky-col" style="width:var(--scalar-first-col-w, ${initialFirstColW}px);min-width:var(--scalar-first-col-w, ${initialFirstColW}px);max-width:var(--scalar-first-col-w, ${initialFirstColW}px);">DUT / File</th>`;
    scalarCols.forEach((col) => {
      const isNum = col.kind === "scalar";
      const unitHtml = col.unit ? ` <span class="th-unit">[${escapeHtml(col.unit)}]</span>` : "";
      thead += `<th class="${isNum ? "num-col" : ""}" style="width:${colWidthCalc};min-width:85px;">${escapeHtml(col.name)}${unitHtml}</th>`;
    });
    thead += "</tr></thead>";

    let tbody = "<tbody>";
    block.instances.forEach((inst, instIdx) => {
      const cleanFile = inst.file.replace(/\.hxml$/i, "");
      const dutIdx = state.files.indexOf(inst.file);
      const colorIdx = dutIdx >= 0 ? dutIdx : instIdx;
      const defaultColor = PALETTE[colorIdx % PALETTE.length];
      const color = (state.customColors && (state.customColors[inst.file] || state.customColors[cleanFile])) || defaultColor;
      tbody += "<tr>";
      tbody += `<td class="sticky-col" title="${escapeHtml(inst.file)}"><span class="dut-dot" style="background:${color};" title="DUT curve color"></span><code>${escapeHtml(cleanFile)}</code></td>`;

      scalarCols.forEach((col) => {
        const isNum = col.kind === "scalar";
        const c = inst.curves ? inst.curves[col.name] : null;
        let cellContent = '<span class="cell-null">—</span>';

        if (c) {
          if (isNum) {
            const val = c.values && c.values.length > 0 ? c.values[0] : null;
            cellContent = formatScalarValue(val);
          } else {
            const raw = c.raw || (c.values && c.values[0]);
            cellContent = raw ? escapeHtml(String(raw)) : '<span class="cell-null">—</span>';
          }
        }

        tbody += `<td class="${isNum ? "num-cell" : ""}">${cellContent}</td>`;
      });
      tbody += "</tr>";
    });
    tbody += "</tbody>";

    table.innerHTML = colgroup + thead + tbody;
    scrollDiv.appendChild(table);
    blockSection.appendChild(scrollDiv);
    el.scalarTablesWrap.appendChild(blockSection);
  });

  window.requestAnimationFrame(() => {
    syncScalarFirstColWidth();
  });
  setTimeout(syncScalarFirstColWidth, 50);
}

function calculateScalarFirstColWidth() {
  let maxTextW = 0;

  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.font = "600 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

      // 1. Header width: 'DUT / File'
      const thW = ctx.measureText("DUT / File").width;
      if (thW > maxTextW) maxTextW = thW;

      // 2. Check all files in state.files
      if (state.files && state.files.length) {
        state.files.forEach((file) => {
          const clean = file.replace(/\.hxml$/i, "");
          const tw = ctx.measureText(clean).width;
          if (tw > maxTextW) maxTextW = tw;
        });
      }

      // 3. Check all rendered code tags in scalar tables
      const codes = el.scalarTablesWrap?.querySelectorAll("td.sticky-col code");
      codes?.forEach((c) => {
        const text = (c.textContent || "").trim();
        if (text) {
          const tw = ctx.measureText(text).width;
          if (tw > maxTextW) maxTextW = tw;
        }
      });
    }
  } catch (e) {}

  // Fallback if canvas is unavailable: estimate by character count
  if (maxTextW === 0 && state.files && state.files.length) {
    let maxLen = 10;
    state.files.forEach((file) => {
      const clean = file.replace(/\.hxml$/i, "");
      if (clean.length > maxLen) maxLen = clean.length;
    });
    maxTextW = maxLen * 8.5;
  }

  // Cell components:
  // dot: 10px + margin 8px = 18px
  // cell padding: 12px left + 12px right = 24px
  // border: 2px
  // safety buffer: 20px so text never touches the border or gets truncated
  const neededWidth = Math.ceil(maxTextW + 18 + 24 + 2 + 20);

  // Minimum 270px, or the needed width
  return Math.max(neededWidth, 270);
}

function syncScalarFirstColWidth() {
  if (!el.scalarTablesWrap) return;
  const tables = el.scalarTablesWrap.querySelectorAll("table.data");
  if (!tables || tables.length === 0) return;

  // 1. Calculate required width to ensure full filenames are clearly visible without truncation
  const targetW = calculateScalarFirstColWidth();
  const widthPx = `${targetW}px`;

  // 2. Set container CSS variable so all scalar tables inherit this width
  el.scalarTablesWrap.style.setProperty("--scalar-first-col-w", widthPx);

  // 3. Set explicit inline width/min-width/max-width on all sticky-col elements across all tables
  const allSticky = el.scalarTablesWrap.querySelectorAll(".sticky-col");
  allSticky.forEach((c) => {
    c.style.width = widthPx;
    c.style.minWidth = widthPx;
    c.style.maxWidth = widthPx;
  });

  // 4. Distribute remaining table width equally between all value (non-sticky) columns in each table
  tables.forEach((table) => {
    const nonStickyThs = table.querySelectorAll("thead th:not(.sticky-col)");
    const numCols = nonStickyThs.length;
    if (numCols === 0) return;

    const equalWidthStyle = `calc((100% - ${widthPx}) / ${numCols})`;
    const nonStickyCols = table.querySelectorAll("colgroup col:not(.sticky-col)");
    nonStickyCols.forEach((col) => {
      col.style.width = equalWidthStyle;
      col.style.minWidth = "85px";
    });
    nonStickyThs.forEach((th) => {
      th.style.width = equalWidthStyle;
      th.style.minWidth = "85px";
    });
  });
}

function navigateCurveSearch() {
  const query = (el.curveSearchInput?.value || "").trim().toLocaleLowerCase();
  if (!query) {
    el.curveSearchStatus.textContent = "Enter a curve name";
    return;
  }

  if (!activeCurveSearch || activeCurveSearch.query !== query) {
    const matches = findCurveSearchTargets(query);
    const tableMatches = findScalarTableSearchTargets(query);
    if (!matches.length && !tableMatches.length) {
      activeCurveSearch = null;
      el.curveSearchResults.hidden = true;
      el.curveSearchResults.innerHTML = "";
      el.curveSearchStatus.textContent = "No matching plot or table";
      return;
    }
    activeCurveSearch = { query, matches, tableMatches, index: 0, phase: matches.length ? "plots" : "tables" };
    if (activeCurveSearch.phase === "plots") navigateToSearchPlot();
    else navigateToSearchTable();
    return;
  }

  if (activeCurveSearch.phase === "plots") {
    if (activeCurveSearch.index < activeCurveSearch.matches.length - 1) {
      activeCurveSearch.index += 1;
      navigateToSearchPlot();
      return;
    }
    if (!activeCurveSearch.tableMatches.length) {
      activeCurveSearch.index = 0;
      navigateToSearchPlot();
      return;
    }
    activeCurveSearch.phase = "tables";
    activeCurveSearch.index = 0;
    navigateToSearchTable();
    return;
  }

  if (activeCurveSearch.index < activeCurveSearch.tableMatches.length - 1) {
    activeCurveSearch.index += 1;
    navigateToSearchTable();
    return;
  }

  activeCurveSearch.phase = activeCurveSearch.matches.length ? "plots" : "tables";
  activeCurveSearch.index = 0;
  if (activeCurveSearch.phase === "plots") navigateToSearchPlot();
  else navigateToSearchTable();
}

function navigateToSearchPlot() {
  const match = activeCurveSearch.matches[activeCurveSearch.index];
  const plotCard = document.getElementById(`plot-item-block-${match.bi}`)?.closest(".plot-card");
  document.querySelectorAll(".plot-card.curve-search-target").forEach((card) => card.classList.remove("curve-search-target"));
  plotCard?.classList.add("curve-search-target");
  plotCard?.scrollIntoView({ behavior: "smooth", block: "center" });
  document.querySelectorAll(".scalar-block.curve-search-target").forEach((section) => section.classList.remove("curve-search-target"));
  const nextAction = activeCurveSearch.index < activeCurveSearch.matches.length - 1
    ? "Next finds more plots"
    : activeCurveSearch.tableMatches.length ? "Next searches tables" : "Next returns to first plot";
  el.curveSearchStatus.textContent = `Plot ${activeCurveSearch.index + 1}/${activeCurveSearch.matches.length} · ${activeCurveSearch.matches.length} plots · ${activeCurveSearch.tableMatches.length} tables; ${nextAction}`;
}

function navigateToSearchTable() {
  const match = activeCurveSearch.tableMatches[activeCurveSearch.index];
  const tableSection = document.getElementById(`scalar-table-block-${match.bi}`);
  document.querySelectorAll(".scalar-block.curve-search-target").forEach((section) => section.classList.remove("curve-search-target"));
  tableSection?.classList.add("curve-search-target");
  tableSection?.scrollIntoView({ behavior: "smooth", block: "center" });
  document.querySelectorAll(".plot-card.curve-search-target").forEach((card) => card.classList.remove("curve-search-target"));
  const nextAction = activeCurveSearch.index < activeCurveSearch.tableMatches.length - 1
    ? "Next finds more tables"
    : activeCurveSearch.matches.length ? "Next returns to plots" : "Next returns to first table";
  el.curveSearchStatus.textContent = `Table ${activeCurveSearch.index + 1}/${activeCurveSearch.tableMatches.length} · ${activeCurveSearch.matches.length} plots · ${activeCurveSearch.tableMatches.length} tables; ${nextAction}`;
}

function findScalarTableSearchTargets(query) {
  const tableMatches = [];
  state.selectedBis.forEach((bi) => {
    const block = state.blocks[bi];
    if (!block) return;
    const scalarCols = block.curves.filter((curve) => curve.kind !== "series");
    if (!scalarCols.length) return;
    const text = [block.name, ...scalarCols.map((curve) => curve.name), ...block.instances.map((inst) => inst.file || "")]
      .join(" ")
      .toLocaleLowerCase();
    if (text.includes(query)) tableMatches.push({ bi, block, scalarCols });
  });
  return tableMatches;
}

function findCurveSearchTargets(query) {
  const matches = [];
  const blockIndices = [
    ...state.plotOrder.filter((bi) => state.selectedBis.has(bi)),
    ...Array.from(state.selectedBis).filter((bi) => !state.plotOrder.includes(bi)),
  ];

  for (const bi of blockIndices) {
    const block = state.blocks[bi];
    if (!block) continue;
    const firstInstance = block.instances[0];
    const series = block.curves.filter((curve) => curve.kind === "series" && (!firstInstance || curve.name !== firstInstance.xName));
    const availableCurves = series.filter((curve) => block.instances.some((inst) => {
      const xCurve = inst.curves?.[inst.xName];
      const yCurve = inst.curves?.[curve.name];
      return xCurve?.values?.length && yCurve?.values?.length;
    }));
    if (!availableCurves.length) continue;

    const blockMatches = block.name.toLocaleLowerCase().includes(query);
    const curveMatches = availableCurves.filter((curve) => curve.name.toLocaleLowerCase().includes(query));
    let curve = curveMatches[0] || (blockMatches ? availableCurves[0] : null);
    let instances = curve ? block.instances.filter((inst) => {
      const xCurve = inst.curves?.[inst.xName];
      const yCurve = inst.curves?.[curve.name];
      return xCurve?.values?.length && yCurve?.values?.length;
    }) : [];

    if (!curve && !blockMatches) {
      instances = block.instances.filter((inst) => {
        const fileName = (inst.file || "").replace(/\.hxml$/i, "");
        return fileName.toLocaleLowerCase().includes(query) && inst.curves?.[inst.xName]?.values?.length;
      });
      if (instances.length) curve = availableCurves[0];
    }

    if (curve && instances.length) matches.push({ bi, block, curve, instances });
  }
  return matches;
}

function renderCurveSearchResults(match) {
  el.curveSearchResults.innerHTML = renderCurveSearchTable(match);
}

function renderFullscreenCurveTable(bi) {
  if (!el.fsCurveTable) return;
  const block = state.blocks[bi];
  if (block) {
    const scalarCols = block.curves.filter((curve) => curve.kind !== "series");
    if (scalarCols.length) {
      el.fsCurveTable.hidden = false;
      el.fsCurveTable.innerHTML = renderFullscreenScalarTable(block, scalarCols);
      return;
    }
  }

  const match = activeCurveSearch?.matches?.find((item) => item.bi === bi);
  const firstInstance = block?.instances?.[0];
  const curve = block?.curves?.find((item) => item.kind === "series" && (!firstInstance || item.name !== firstInstance.xName));
  const instances = curve ? block.instances.filter((inst) => inst.curves?.[inst.xName]?.values?.length && inst.curves?.[curve.name]?.values?.length) : [];
  const sampleMatch = match || (instances.length ? { bi, block, curve, instances } : null);
  el.fsCurveTable.hidden = !sampleMatch;
  el.fsCurveTable.innerHTML = sampleMatch ? renderCurveSearchTable(sampleMatch) : "";
}

function renderFullscreenScalarTable(block, scalarCols) {
  let html = '<div class="scalar-header"><span class="scalar-title">Scalar Values</span>';
  html += `<span class="scalar-sub">${block.instances.length} DUT${block.instances.length === 1 ? "" : "s"} · ${scalarCols.length} metric${scalarCols.length === 1 ? "" : "s"}</span></div>`;
  html += `<div class="scalar-block-label"><b>${escapeHtml(block.name)}</b></div>`;
  html += '<div class="scalar-scroll"><table class="data"><thead><tr><th class="sticky-col">DUT / File</th>';
  scalarCols.forEach((col) => {
    const unitHtml = col.unit ? ` <span class="th-unit">[${escapeHtml(col.unit)}]</span>` : "";
    html += `<th class="${col.kind === "scalar" ? "num-col" : ""}">${escapeHtml(col.name)}${unitHtml}</th>`;
  });
  html += "</tr></thead><tbody>";
  block.instances.forEach((inst, instIdx) => {
    const cleanFile = (inst.file || "DUT").replace(/\.hxml$/i, "");
    const dutIdx = state.files.indexOf(inst.file);
    const colorIdx = dutIdx >= 0 ? dutIdx : instIdx;
    const color = (state.customColors && (state.customColors[inst.file] || state.customColors[cleanFile])) || PALETTE[colorIdx % PALETTE.length];
    html += `<tr><td class="sticky-col" title="${escapeHtml(inst.file || cleanFile)}"><span class="dut-dot" style="background:${color};" title="DUT curve color"></span><code>${escapeHtml(cleanFile)}</code></td>`;
    scalarCols.forEach((col) => {
      const curve = inst.curves?.[col.name];
      let value = '<span class="cell-null">—</span>';
      if (curve) {
        if (col.kind === "scalar") {
          value = formatScalarValue(curve.values?.[0]);
        } else {
          const raw = curve.raw || curve.values?.[0];
          value = raw ? escapeHtml(String(raw)) : value;
        }
      }
      html += `<td class="${col.kind === "scalar" ? "num-cell" : ""}">${value}</td>`;
    });
    html += "</tr>";
  });
  html += "</tbody></table></div>";
  return html;
}

function renderCurveSearchTable(match) {
  const samples = match.instances.map((inst) => ({
    file: (inst.file || "DUT").replace(/\.hxml$/i, ""),
    xLabel: formatXLabel(inst.xName, inst.curves[inst.xName]?.unit),
    xValues: inst.curves[inst.xName]?.values || [],
    yValues: inst.curves[match.curve.name]?.values || [],
  }));
  const sampleCount = samples.reduce((total, item) => total + Math.min(item.xValues.length, item.yValues.length), 0);
  const yLabel = match.curve.unit ? `${match.curve.name} (${match.curve.unit})` : match.curve.name;
  let html = `<div class="curve-search-results-header"><span class="curve-search-results-title">${escapeHtml(match.block.name)} · ${escapeHtml(match.curve.name)}</span><span class="curve-search-results-note">${sampleCount.toLocaleString()} samples</span></div>`;
  html += '<div class="curve-search-table-wrap"><table class="data"><thead><tr><th class="sticky-col">DUT / File</th><th class="num-col">Sample</th><th class="num-col">X</th><th class="num-col">Y</th></tr></thead><tbody>';
  samples.forEach((sample) => {
    const count = Math.min(sample.xValues.length, sample.yValues.length);
    for (let index = 0; index < count; index++) {
      html += `<tr><td class="sticky-col"><code>${escapeHtml(sample.file)}</code></td><td class="num-cell">${(index + 1).toLocaleString()}</td><td class="num-cell">${formatScalarValue(sample.xValues[index])}</td><td class="num-cell">${formatScalarValue(sample.yValues[index])}</td></tr>`;
    }
  });
  html += "</tbody></table></div>";
  return html;
}

function resetCurveSearch() {
  activeCurveSearch = null;
  if (el.curveSearchStatus) el.curveSearchStatus.textContent = "";
  if (el.curveSearchResults) {
    el.curveSearchResults.hidden = true;
    el.curveSearchResults.innerHTML = "";
  }
  if (el.fsCurveTable && (!state.fsPlotInfo || el.fsOverlay?.hidden)) {
    el.fsCurveTable.hidden = true;
    el.fsCurveTable.innerHTML = "";
  }
  document.querySelectorAll(".plot-card.curve-search-target").forEach((card) => card.classList.remove("curve-search-target"));
  document.querySelectorAll(".scalar-block.curve-search-target").forEach((section) => section.classList.remove("curve-search-target"));
}

function formatScalarValue(val) {
  if (val === null || val === undefined || val === "") return '<span class="cell-null">—</span>';
  if (typeof val === "number") {
    if (isNaN(val)) return '<span class="cell-null">—</span>';
    if (!isFinite(val)) return String(val);
    if (Math.round(val) === val) {
      return val.toLocaleString("en-US");
    }
    if (Math.abs(val) < 0.01 && val !== 0) {
      return val.toExponential(2);
    }
    return val.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  return escapeHtml(String(val));
}

function showEmpty(show, msg) {
  el.empty.hidden = !show;
  el.plotWrap.hidden = show;
  if (show) {
    el.scalarCard.hidden = true;
  }
  if (msg) el.empty.textContent = msg;
  else if (show) el.empty.textContent = "Select one or more curve data blocks on the left to plot them.";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ── Startup: restore the last loaded dataset (if any) so a plain page refresh doesn't lose
// the user's work. The shell's top-right "Reload" button marks its navigation with
// "_reload=1" (distinct from the cache-busting "_v" used on every open) to mean "give me a
// clean page" - honor that by wiping any persisted state instead of restoring it.
const isExplicitReload = new URLSearchParams(window.location.search).get("_reload") === "1";
if (isExplicitReload) {
  try { sessionStorage.removeItem(PERSIST_KEY); } catch (e) {}
} else if (restorePersistedState()) {
  el.clearBtn.disabled = false;
  el.status.textContent = `${state.files.length} DUT(s), ${state.blocks.length} block(s)`;
  renderTree();
  renderSelectedPlots();
}
