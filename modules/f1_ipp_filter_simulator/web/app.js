/* F1 Filter Simulator — control panel + tabbed Plotly views over the Python pipeline. */

const state = { data: null, running: false, pendingRerun: false, hxmlInput: null, hxmlAfter: null, hxmlFilter: null };

const el = {
  runBtn: document.getElementById("run-btn"),
  statusBar: document.getElementById("status-bar"),
};

const plotEls = {
  pipeline: document.getElementById("plot-pipeline"),
  orders: document.getElementById("plot-orders"),
  quant: document.getElementById("plot-quant"),
  pz: document.getElementById("plot-pz"),
  ba: document.getElementById("plot-ba"),
  smooth: document.getElementById("plot-smooth"),
};

const C = {
  raw: "#ff0000",        // MATLAB Pure Red
  target: "#0000ff",     // MATLAB Pure Blue (SF1)
  iir: "#0080ff",        // MATLAB Azure / Sky Blue (SF3)
  quant: "#80ff80",      // MATLAB Mint Green (SF9)
  residual: "#00cccc",   // MATLAB Cyan / Teal (SF6)
  realResid: "#ff8000",  // MATLAB Vivid Orange (SS2)
  deviceFilt: "#cc00cc", // MATLAB Magenta
  mp: "#ff8000",         // Vivid Orange
  error: "#ff8000",      // Vivid Orange
  zero: "#0000ff",       // Pure Blue
  pole: "#ff0000",       // Pure Red
};

const ORDER_CONFIG = {
  12: { color: "#0000ff", dash: "solid", name: "Order 12 (6 biq)" }, // Deep Blue
  10: { color: "#0080ff", dash: "solid", name: "Order 10 (5 biq)" }, // Azure / Sky Blue
  8:  { color: "#ff8000", dash: "solid", name: "Order 8 (4 biq)"  }, // Vivid Orange
  6:  { color: "#cccc00", dash: "solid", name: "Order 6 (3 biq)"  }, // Yellow-Olive / Gold
};
const ORDER_COLORS = { 12: "#0000ff", 10: "#0080ff", 8: "#ff8000", 6: "#cccc00" };

// Segmented controls: update selection and immediately recompute (matches the
// desktop app, where every radio/checkbox/slider calls run_pipeline directly).
document.querySelectorAll(".seg").forEach((seg) => {
  seg.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    seg.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    seg.dataset.value = btn.dataset.v;
    if (seg.id === "smooth_method") syncSmoothControls();
    if (seg.id !== "input_source") requestRun();
  });
});

// The SmoothFactor (fractional-octave N) slider only applies to Frac oct (SmoothSelect=1);
// 16-band and None ignore it (matches F1InputFilterDesign.m / GenerateFilterCoefs).
function syncSmoothControls() {
  const method = parseInt(document.getElementById("smooth_method").dataset.value);
  const slider = document.getElementById("smooth_n");
  const field = slider.closest(".field");
  const enabled = method === 1;
  slider.disabled = !enabled;
  if (field) field.style.opacity = enabled ? "1" : "0.45";
}
syncSmoothControls();

// Range value labels + debounced auto-run (avoids flooding the backend while dragging).
let _runDebounce = null;
function scheduleRun(delay = 300) {
  clearTimeout(_runDebounce);
  _runDebounce = setTimeout(requestRun, delay);
}

["amp", "smooth_n", "fir_taps", "tol_db"].forEach((id) => {
  const input = document.getElementById(id);
  const label = document.getElementById(`${id}-val`);
  const fmt = { amp: (v) => `${(+v).toFixed(1)}×`, smooth_n: (v) => v, fir_taps: (v) => v, tol_db: (v) => `${(+v).toFixed(2)} dB` }[id];
  input.addEventListener("input", () => { label.textContent = fmt(input.value); scheduleRun(); });
  input.addEventListener("change", () => scheduleRun(0));
});

// Other controls that auto-run immediately on change.
document.getElementById("shape").addEventListener("change", () => requestRun());
document.getElementById("quantize").addEventListener("change", () => requestRun());

el.runBtn.addEventListener("click", requestRun);

// Smoothing compare is expensive (6 full pipeline runs), so it's computed on
// demand via its own button rather than on every parameter change.
document.getElementById("smooth-run-btn").addEventListener("click", renderSmoothCompare);

// Input source toggle: show shape picker vs HXML loader.
const inputSourceSeg = document.getElementById("input_source");
inputSourceSeg.addEventListener("click", (e) => {
  if (!e.target.closest("button")) return;
  const isHxml = inputSourceSeg.dataset.value === "hxml";
  document.getElementById("shape-field").hidden = isHxml;
  document.getElementById("hxml-field").hidden = !isHxml;
  requestRun();
});

// HXML file loaders (mic input + after-IPP measurement).
setupHxmlLoader("input", (payload) => { state.hxmlInput = payload; });
setupHxmlLoader("after", (payload) => { state.hxmlAfter = payload; });

// Real device IIR filter overlay loader (f + magnitude curves, e.g. SF3_SS2_*).
setupFilterLoader();

function setupFilterLoader() {
  const btn = document.getElementById("load-filter-btn");
  const clearBtn = document.getElementById("clear-filter-btn");
  const fileInput = document.getElementById("filter-file");
  const labelEl = document.getElementById("filter-label");

  async function process(fd, displayName) {
    labelEl.textContent = `Loading ${displayName}…`;
    labelEl.style.color = "var(--text-mute)";
    try {
      const res = await fetch("/api/f1-ipp-filter-simulator/load-filter-hxml", { method: "POST", body: fd });
      let data;
      try { data = await res.json(); } catch { throw new Error(`Server error (HTTP ${res.status})`); }
      if (!res.ok || data.error) {
        labelEl.textContent = `Load failed: ${data?.error || "HTTP " + res.status}`;
        labelEl.style.color = "var(--danger)";
        return;
      }
      if (!data.freq || !Array.isArray(data.freq) || !data.freq.length) {
        labelEl.textContent = "Load failed: No valid filter curve in HXML";
        labelEl.style.color = "var(--danger)";
        return;
      }
      state.hxmlFilter = { freq: data.freq, mag: data.mag, label: data.label, serial: data.serial };
      labelEl.textContent = `${data.label}${data.serial ? " · SN " + data.serial : ""} (${data.freq.length} pts)`;
      labelEl.style.color = "var(--accent)";
      clearBtn.disabled = false;
      renderAll();  // overlay only; no pipeline recompute needed
    } catch (err) {
      labelEl.textContent = `Load failed: ${err.message || "Network error"}`;
      labelEl.style.color = "var(--danger)";
      console.error(err);
    }
  }

  btn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    await process(fd, file.name);
    fileInput.value = "";
  });
  clearBtn.addEventListener("click", () => {
    state.hxmlFilter = null;
    labelEl.textContent = "No file loaded";
    labelEl.style.color = "var(--text-mute)";
    clearBtn.disabled = true;
    renderAll();
  });
}

function setupHxmlLoader(kind, onLoaded) {
  const btn = document.getElementById(`load-${kind}-btn`);
  const clearBtn = document.getElementById(`clear-${kind}-btn`);
  const fileInput = document.getElementById(`${kind}-file`);
  const labelEl = document.getElementById(`${kind}-label`);
  const emptyText = kind === "after" ? "Simulation only" : "No file loaded";

  async function processHxml(fetchOptions, displayName) {
    labelEl.textContent = `Loading ${displayName}…`;
    labelEl.style.color = "var(--text-mute)";
    try {
      const res = await fetch("/api/f1-ipp-filter-simulator/load-hxml", fetchOptions);
      let data;
      try {
        data = await res.json();
      } catch {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Server error (HTTP ${res.status})`);
      }

      if (!res.ok || data.error) {
        const err = data?.error || (typeof data?.detail === "string" ? data.detail : JSON.stringify(data?.detail)) || `HTTP ${res.status}`;
        labelEl.textContent = `Load failed: ${err}`;
        labelEl.style.color = "var(--danger)";
        return;
      }

      if (!data.freq || !Array.isArray(data.freq) || !data.freq.length) {
        labelEl.textContent = "Load failed: No valid frequency curve in HXML";
        labelEl.style.color = "var(--danger)";
        return;
      }

      onLoaded({ freq: data.freq, tf: data.tf, label: data.label, serial: data.serial });
      labelEl.textContent = `${data.label}${data.serial ? " · SN " + data.serial : ""} (${data.freq.length} pts)`;
      labelEl.style.color = "var(--accent)";
      clearBtn.disabled = false;
      requestRun();
    } catch (err) {
      const isNetwork = err.message?.includes("Failed to fetch") || err.name === "TypeError";
      const hint = isNetwork ? " (is the server running at 127.0.0.1:8100?)" : "";
      labelEl.textContent = `Load failed: ${err.message || "Network error"}${hint}`;
      labelEl.style.color = "var(--danger)";
      console.error(err);
    }
  }

  btn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    await processHxml({ method: "POST", body: fd }, file.name);
    fileInput.value = "";
  });

  clearBtn.addEventListener("click", () => {
    onLoaded(null);
    labelEl.textContent = emptyText;
    labelEl.style.color = "var(--text-mute)";
    clearBtn.disabled = true;
    requestRun();
  });
}

function collectParams() {
  const useHxml = inputSourceSeg.dataset.value === "hxml" && state.hxmlInput;
  return {
    shape: document.getElementById("shape").value,
    amp: parseFloat(document.getElementById("amp").value),
    fnorm: parseInt(document.getElementById("fnorm").dataset.value),
    floor_hz: parseInt(document.getElementById("floor_hz").dataset.value),
    smooth_method: parseInt(document.getElementById("smooth_method").dataset.value),
    smooth_n: parseInt(document.getElementById("smooth_n").value),
    fir_taps: parseInt(document.getElementById("fir_taps").value),
    force_order: parseInt(document.getElementById("force_order").dataset.value),
    tol_db: parseFloat(document.getElementById("tol_db").value),
    quantize: document.getElementById("quantize").checked,
    hxml_freq: useHxml ? state.hxmlInput.freq : null,
    hxml_tf: useHxml ? state.hxmlInput.tf : null,
  };
}

async function run() {
  // If a request is already in flight, don't drop this change: flag it so the
  // in-progress run's completion immediately re-runs with the latest params
  // (matches the desktop app, where no control change is ever lost).
  if (state.running) {
    state.pendingRerun = true;
    return;
  }
  state.running = true;
  state.pendingRerun = false;
  el.runBtn.disabled = true;
  el.statusBar.innerHTML = '<span class="status">Running pipeline…</span>';
  try {
    const res = await fetch("/api/f1-ipp-filter-simulator/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(collectParams()),
    });
    let data;
    try {
      data = await res.json();
    } catch {
      const text = await res.text().catch(() => "");
      throw new Error(text || `Server returned HTTP ${res.status}`);
    }
    if (!res.ok || data.error) {
      const msg = data?.error || (typeof data?.detail === "string" ? data.detail : JSON.stringify(data?.detail)) || `HTTP ${res.status}`;
      el.statusBar.innerHTML = `<span class="status" style="color:var(--danger)">Pipeline failed: ${escapeHtml(msg)}</span>`;
      state.data = null;
    } else {
      state.data = data;
      renderStatus();
      renderAll();
    }
  } catch (err) {
    const hint = err.message?.includes("Failed to fetch") ? " — is python run.py running?" : "";
    el.statusBar.innerHTML = `<span class="status" style="color:var(--danger)">Pipeline request failed: ${escapeHtml(err.message || "")}${hint}</span>`;
    console.error(err);
  }
  state.running = false;
  el.runBtn.disabled = false;
  if (state.pendingRerun) {
    state.pendingRerun = false;
    run();
  }
}

// Public entry point for all control handlers: never silently drops a change.
function requestRun() {
  run();
}

function renderStatus() {
  const d = state.data;
  el.statusBar.innerHTML =
    `<span class="badge">Selected order ${d.chosen_ord} · ${d.chosen_ord / 2} biquads</span>` +
    `<span class="badge ${d.stable ? "ok" : "bad"}">${d.stable ? "Stable" : "Unstable"}</span>` +
    `<span class="badge ${d.min_ph ? "ok" : "bad"}">${d.min_ph ? "Min-phase" : "Non-min-phase"}</span>` +
    `<span class="status">fnorm = ${d.fnorm} Hz</span>`;
}

function autoLegendLayout(traces, isLogX = false, fontSize = 14, options = {}) {
  const validTraces = (traces || []).filter(
    (t) => t && t.showlegend !== false && Array.isArray(t.x) && Array.isArray(t.y) && t.x.length > 0 && t.y.length > 0
  );

  const defaultLegend = {
    orientation: "v",
    x: 0.98,
    y: 0.98,
    xanchor: "right",
    yanchor: "top",
    bgcolor: "rgba(255, 255, 255, 0.92)",
    bordercolor: "#cfd8e6",
    borderwidth: 1,
    itemsizing: "constant",
    font: { size: fontSize, color: "#111827", family: "Segoe UI, -apple-system, BlinkMacSystemFont, sans-serif" },
  };

  if (!validTraces.length) return defaultLegend;

  const domains = options.domains || {};
  const axisBounds = {};
  let globalXMin = Infinity, globalXMax = -Infinity;

  validTraces.forEach((t) => {
    const yAxisKey = t.yaxis || "y";
    if (!axisBounds[yAxisKey]) {
      axisBounds[yAxisKey] = {
        minY: Infinity,
        maxY: -Infinity,
        domain: domains[yAxisKey] || [0, 1],
      };
    }
    const b = axisBounds[yAxisKey];
    const len = Math.min(t.x.length, t.y.length);
    for (let i = 0; i < len; i++) {
      const xv = t.x[i];
      const yv = t.y[i];
      if (typeof xv !== "number" || isNaN(xv) || typeof yv !== "number" || isNaN(yv)) continue;
      if (isLogX && xv <= 0) continue;
      const lx = isLogX ? Math.log10(xv) : xv;
      if (lx < globalXMin) globalXMin = lx;
      if (lx > globalXMax) globalXMax = lx;
      if (yv < b.minY) b.minY = yv;
      if (yv > b.maxY) b.maxY = yv;
    }
  });

  if (!isFinite(globalXMin) || globalXMax <= globalXMin) return defaultLegend;

  const points = [];
  const maxSamples = 120;

  validTraces.forEach((t) => {
    const yAxisKey = t.yaxis || "y";
    const b = axisBounds[yAxisKey];
    if (!b || b.maxY <= b.minY) return;
    const len = Math.min(t.x.length, t.y.length);
    const step = Math.max(1, Math.floor(len / maxSamples));
    const [d0, d1] = b.domain;
    let prevNx = null, prevNy = null;

    for (let i = 0; i < len; i += step) {
      const xv = t.x[i];
      const yv = t.y[i];
      if (typeof xv !== "number" || isNaN(xv) || typeof yv !== "number" || isNaN(yv)) continue;
      if (isLogX && xv <= 0) continue;
      const lx = isLogX ? Math.log10(xv) : xv;
      const nx = Math.max(0, Math.min(1, (lx - globalXMin) / (globalXMax - globalXMin)));
      const normYInPanel = Math.max(0, Math.min(1, (yv - b.minY) / (b.maxY - b.minY)));
      const ny = Math.max(0, Math.min(1, d0 + normYInPanel * (d1 - d0)));

      if (prevNx !== null) {
        const gap = Math.hypot(nx - prevNx, ny - prevNy);
        if (gap > 0.05) {
          points.push([(prevNx + nx) / 2, (prevNy + ny) / 2]);
        }
      }
      points.push([nx, ny]);
      prevNx = nx;
      prevNy = ny;
    }
  });

  if (!points.length) return defaultLegend;

  const nItems = validTraces.length;
  const maxLabelLen = Math.max(...validTraces.map((t) => (t.name ? String(t.name).length : 8)), 10);
  const estWidth = Math.min(0.55, Math.max(0.20, (maxLabelLen * 8.6 + 72) / 950));
  const estHeight = Math.min(0.62, Math.max(0.16, (nItems * 27 + 26) / 460));

  const padX = 0.02;
  const padY = 0.02;

  const candidates = [
    {
      id: "top-right",
      x: 0.98,
      y: 0.98,
      xanchor: "right",
      yanchor: "top",
      box: [1.0 - estWidth - padX, 1.0, 1.0 - estHeight - padY, 1.0],
      bias: 0.05,
    },
    {
      id: "top-left",
      x: 0.02,
      y: 0.98,
      xanchor: "left",
      yanchor: "top",
      box: [0.0, estWidth + padX, 1.0 - estHeight - padY, 1.0],
      bias: 0.03,
    },
    {
      id: "bottom-left",
      x: 0.02,
      y: 0.04,
      xanchor: "left",
      yanchor: "bottom",
      box: [0.0, estWidth + padX, 0.0, estHeight + padY],
      bias: 0.02,
    },
    {
      id: "bottom-right",
      x: 0.98,
      y: 0.04,
      xanchor: "right",
      yanchor: "bottom",
      box: [1.0 - estWidth - padX, 1.0, 0.0, estHeight + padY],
      bias: 0.0,
    },
  ];

  function distToBox(px, py, [x0, x1, y0, y1]) {
    const dx = Math.max(0, x0 - px, px - x1);
    const dy = Math.max(0, y0 - py, py - y1);
    return Math.hypot(dx, dy);
  }

  let bestCand = candidates[0];
  let bestScore = -Infinity;

  candidates.forEach((cand) => {
    let insideCount = 0;
    let minDist = Infinity;
    let sumDist = 0;

    for (let i = 0; i < points.length; i++) {
      const [px, py] = points[i];
      const d = distToBox(px, py, cand.box);
      if (d <= 0.005) insideCount++;
      if (d < minDist) minDist = d;
      sumDist += d;
    }

    const avgDist = sumDist / points.length;
    const score = (insideCount > 0 ? -insideCount * 1000 : 1000)
                  + minDist * 500
                  + avgDist * 50
                  + cand.bias;

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
    bgcolor: "rgba(255, 255, 255, 0.92)",
    bordercolor: "#cfd8e6",
    borderwidth: 1,
    itemsizing: "constant",
    font: {
      size: fontSize,
      color: "#111827",
      family: "Segoe UI, -apple-system, BlinkMacSystemFont, sans-serif",
    },
  };
}

const BASE_LAYOUT = () => ({
  margin: { l: 60, r: 25, t: 40, b: 46 },
  paper_bgcolor: "#ffffff",
  plot_bgcolor: "#ffffff",
  font: { family: "Segoe UI, sans-serif", size: 12, color: "#47546a" },
});

// Boxed black-frame axis look (matches the HXML Viewer's Plotly styling) so all
// module plots share the same visual language.
const BOX_AXIS = {
  showline: true, linewidth: 1.5, linecolor: "#111827", mirror: true,
  ticks: "outside", tickwidth: 1.2, tickcolor: "#111827",
};

function logAxis(title) {
  return { title, type: "log", gridcolor: "#e3e9f2", zerolinecolor: "#cfd8e6", ...BOX_AXIS };
}

function makeLegendDraggable(plotDiv) {
  if (!plotDiv || plotDiv._hasDraggableLegend) return;
  plotDiv._hasDraggableLegend = true;

  let isDragging = false;
  let dragLegend = null;
  let startX = 0, startY = 0;
  let origTx = 0, origTy = 0;
  let currentTx = 0, currentTy = 0;

  plotDiv.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const legend = e.target.closest("g.legend");
    if (!legend) return;

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
      if (!isDragging && Math.hypot(dx, dy) > 4) {
        isDragging = true;
        dragLegend.classList.add("is-dragging");
        document.body.style.userSelect = "none";
      }
      if (isDragging) {
        currentTx = origTx + dx;
        currentTy = origTy + dy;
        dragLegend.setAttribute("transform", `translate(${currentTx}, ${currentTy})`);
      }
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);

      if (isDragging && dragLegend) {
        dragLegend.classList.remove("is-dragging");
        document.body.style.userSelect = "";

        const size = plotDiv._fullLayout?._size;
        const plotL = size?.l ?? 60;
        const plotT = size?.t ?? 40;
        const plotW = size?.w ?? Math.max(100, plotDiv.clientWidth - 85);
        const plotH = size?.h ?? Math.max(100, plotDiv.clientHeight - 90);

        const newX = (currentTx - plotL) / plotW;
        const newY = 1 - (currentTy - plotT) / plotH;

        Plotly.relayout(plotDiv, {
          "legend.x": Math.max(-0.05, Math.min(1.05, newX)),
          "legend.y": Math.max(-0.05, Math.min(1.05, newY)),
          "legend.xanchor": "left",
          "legend.yanchor": "top",
        });

        const killClick = (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          window.removeEventListener("click", killClick, true);
        };
        window.addEventListener("click", killClick, true);
        setTimeout(() => window.removeEventListener("click", killClick, true), 80);
      }
      isDragging = false;
      dragLegend = null;
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  });
}

function renderAll() {
  if (!state.data) {
    Object.entries(plotEls).forEach(([k, p]) => { if (k !== "smooth") Plotly.purge(p); });
    return;
  }
  renderPipeline();
  renderOrders();
  renderQuant();
  renderPZ();
  renderBeforeAfter();
  // Smoothing compare is expensive (6 pipeline runs) — only recomputed via its own button.
}

// Overlay the simulated IIR correction for several smoothing configs
// (fractional-octave SF=1/3/6/9/12 vs 16-band). Runs 6 pipelines server-side.
let _smoothReqId = 0;
async function renderSmoothCompare() {
  const reqId = ++_smoothReqId;
  const target = plotEls.smooth;
  const runBtn = document.getElementById("smooth-run-btn");
  runBtn.disabled = true;
  runBtn.textContent = "Computing…";
  const params = collectParams();
  try {
    const res = await fetch("/api/f1-ipp-filter-simulator/run-smoothing-compare", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params),
    });
    const data = await res.json();
    if (reqId !== _smoothReqId) return;  // a newer request superseded this one
    if (data.error) {
      el.statusBar.innerHTML = `<span class="status" style="color:var(--danger)">Compare failed: ${escapeHtml(data.error)}</span>`;
      return;
    }
    const fe = data.freq_eval || [];
    const colors = ["#0000ff", "#0080ff", "#00cccc", "#80ff80", "#cccc00", "#ff8000"];
    const traces = [];
    (data.curves || []).forEach((cv, i) => {
      if (cv.error) return;
      const is16 = cv.smooth_method === 2;
      traces.push({
        x: fe, y: cv.H_iir_db,
        name: `${cv.label} · order ${cv.chosen_ord}`,
        mode: "lines",
        line: { color: colors[i % colors.length], width: is16 ? 3.0 : 2.6, dash: "solid" },
      });
    });
    const layout = Object.assign(BASE_LAYOUT(), {
      title: { text: "Smoothing comparison — simulated IIR correction", font: { size: 14, color: "#131a23" } },
      xaxis: logAxis("Frequency [Hz]"),
      yaxis: { title: "Magnitude [dB]", gridcolor: "#e3e9f2", zerolinecolor: "#cfd8e6", ...BOX_AXIS },
      legend: autoLegendLayout(traces, true, 13),
    });
    Plotly.react(target, traces, layout, { responsive: true, displaylogo: false });
    makeLegendDraggable(target);
  } catch (err) {
    if (reqId !== _smoothReqId) return;
    el.statusBar.innerHTML = `<span class="status" style="color:var(--danger)">Compare request failed: ${escapeHtml(err.message || "")}</span>`;
  } finally {
    if (reqId === _smoothReqId) { runBtn.disabled = false; runBtn.textContent = "Run comparison"; }
  }
}

function getNormalizedRealFilter(fnorm = 1000) {
  if (!state.hxmlFilter || !state.hxmlFilter.freq || !state.hxmlFilter.mag) return null;
  const f = state.hxmlFilter.freq, m = state.hxmlFilter.mag;
  let i1k = 0, best = Infinity;
  for (let i = 0; i < f.length; i++) {
    const dd = Math.abs(f[i] - fnorm);
    if (dd < best) { best = dd; i1k = i; }
  }
  const off = m[i1k] || 0;
  return { freq: f, mag: m.map((v) => v - off), label: state.hxmlFilter.label };
}

function renderPipeline() {
  const target = plotEls.pipeline;
  const d = state.data;
  const traces = [
    { x: d.freq, y: d.stages.tf_norm, name: "Raw deviation", mode: "lines", line: { color: C.raw, width: 2.6 } },
    { x: d.freq, y: d.stages.tf_smooth, name: "Correction target (smoothed)", mode: "lines", line: { color: C.target, width: 2.8 } },
    { x: d.freq_eval, y: d.responses.H_iir_db, name: "IIR correction (simulated)", mode: "lines", line: { color: C.iir, width: 2.8 } },
    { x: d.freq_eval, y: d.responses.residual, name: "Residual after IPP (simulated)", mode: "lines", line: { color: C.residual, width: 3.0 } },
  ];

  // Overlay real measured after-IPP hardware result if loaded under VALIDATION
  if (state.hxmlAfter && state.hxmlAfter.freq && state.hxmlAfter.tf) {
    const at = interp(d.freq_eval, state.hxmlAfter.freq, state.hxmlAfter.tf);
    traces.push({
      x: d.freq_eval,
      y: at,
      name: "Residual after IPP (REAL hardware)",
      mode: "lines",
      line: { color: C.realResid, width: 2.8, dash: "solid" },
    });
  }

  // Overlay the real device IIR filter FR (re-zeroed at fnorm to match the simulated one).
  const realFilt = getNormalizedRealFilter(d.fnorm || 1000);
  if (realFilt) {
    traces.push({ x: realFilt.freq, y: realFilt.mag, name: "Real IIR filter (device)", mode: "lines", line: { color: C.deviceFilt, width: 2.8, dash: "solid" } });
  }

  const layout = Object.assign(BASE_LAYOUT(), {
    title: { text: `Correction pipeline — order ${d.chosen_ord}`, font: { size: 14, color: "#131a23" } },
    xaxis: logAxis("Frequency [Hz]"),
    yaxis: { title: "Magnitude [dB]", gridcolor: "#e3e9f2", zerolinecolor: "#cfd8e6", ...BOX_AXIS },
    legend: autoLegendLayout(traces, true, 13),
  });
  Plotly.react(target, traces, layout, { responsive: true, displaylogo: false });
  makeLegendDraggable(target);
}

function renderOrders() {
  const target = plotEls.orders;
  const d = state.data;
  const traces = [];
  d.orders.forEach((o) => {
    if (o.status === "failed") return;
    const sel = o.selected;
    const cfg = ORDER_CONFIG[o.order] || { color: ORDER_COLORS[o.order] || "#0000ff" };
    traces.push({
      x: d.freq_eval, y: o.H_db, mode: "lines",
      name: `Order ${o.order} (${o.biquads} biq)${sel ? " ✓" : ""}` +
        (o.max_dev != null ? ` · Δ${o.max_dev.toFixed(3)}dB` : "") + (o.stable ? "" : " ⚠unstable"),
      line: {
        color: cfg.color,
        width: sel ? 3.6 : 2.5,
        dash: "solid",
      },
    });
  });

  // Overlay the real device IIR filter FR if loaded
  const realFilt = getNormalizedRealFilter(d.fnorm || 1000);
  if (realFilt) {
    traces.push({
      x: realFilt.freq,
      y: realFilt.mag,
      name: "Real IIR filter (device)",
      mode: "lines",
      line: { color: C.deviceFilt, width: 3.0, dash: "solid" },
    });
  }

  const layout = Object.assign(BASE_LAYOUT(), {
    title: { text: "IIR order comparison", font: { size: 13, color: "#131a23" } },
    xaxis: logAxis("Frequency [Hz]"),
    yaxis: { title: "Magnitude [dB]", gridcolor: "#e3e9f2", zerolinecolor: "#cfd8e6", ...BOX_AXIS },
    legend: autoLegendLayout(traces, true, 11),
  });
  Plotly.react(target, traces, layout, { responsive: true, displaylogo: false });
  makeLegendDraggable(target);
}

function renderQuant() {
  const target = plotEls.quant;
  const d = state.data;
  const traces = [
    { x: d.freq_eval, y: d.quant.H_iir_db, name: "Float IIR", mode: "lines", line: { color: C.target, width: 2.8, dash: "solid" } },
    { x: d.freq_eval, y: d.quant.H_q_db, name: "ME-quantized", mode: "lines", line: { color: C.quant, width: 2.8, dash: "solid" } },
    { x: d.freq_eval, y: d.quant.error, name: "Quantization error", mode: "lines", yaxis: "y2", line: { color: C.error, width: 2.2, dash: "solid" } },
  ];
  const layout = Object.assign(BASE_LAYOUT(), {
    title: { text: `ME quantization ${d.quant.on ? "(19-bit)" : "(off)"}`, font: { size: 13, color: "#131a23" } },
    margin: { l: 55, r: 55, t: 36, b: 40 },
    xaxis: logAxis("Frequency [Hz]"),
    yaxis: { title: "Magnitude [dB]", gridcolor: "#e3e9f2", zerolinecolor: "#cfd8e6", ...BOX_AXIS },
    yaxis2: { title: "Error [dB]", overlaying: "y", side: "right", showgrid: false, zerolinecolor: "#f0d9b5", ...BOX_AXIS },
    legend: autoLegendLayout(traces, true, 11),
  });
  Plotly.react(target, traces, layout, { responsive: true, displaylogo: false });
  makeLegendDraggable(target);
}

function renderPZ() {
  const target = plotEls.pz;
  const d = state.data;
  const th = [];
  for (let i = 0; i <= 100; i++) th.push((2 * Math.PI * i) / 100);
  const circle = { x: th.map(Math.cos), y: th.map(Math.sin), mode: "lines", name: "unit circle", line: { color: "#cbd5e1", width: 1.5 }, hoverinfo: "skip", showlegend: false };
  const traces = [
    circle,
    { x: d.pz.zeros.map((z) => z.re), y: d.pz.zeros.map((z) => z.im), mode: "markers", name: "Zeros", marker: { symbol: "circle-open", size: 12, color: C.zero, line: { width: 2.5 } } },
    { x: d.pz.poles.map((z) => z.re), y: d.pz.poles.map((z) => z.im), mode: "markers", name: "Poles", marker: { symbol: "x", size: 12, color: C.pole, line: { width: 2.5 } } },
  ];
  const layout = Object.assign(BASE_LAYOUT(), {
    title: { text: `Pole–zero (order ${d.chosen_ord})`, font: { size: 13, color: "#131a23" } },
    xaxis: { title: "Real", gridcolor: "#e3e9f2", zerolinecolor: "#cfd8e6", scaleanchor: "y", scaleratio: 1, range: [-1.4, 1.4], ...BOX_AXIS },
    yaxis: { title: "Imaginary", gridcolor: "#e3e9f2", zerolinecolor: "#cfd8e6", range: [-1.4, 1.4], ...BOX_AXIS },
    legend: autoLegendLayout(traces, false, 11),
  });
  Plotly.react(target, traces, layout, { responsive: true, displaylogo: false });
  makeLegendDraggable(target);
}

// Tab 5 — Before / After IPP Correction. Two stacked panels: output level
// (dBSPL) and the correction filter (dB). Overlays the real after-IPP
// measurement when one is loaded (validation mode).
function renderBeforeAfter() {
  const target = plotEls.ba;
  const d = state.data;
  const fe = d.freq_eval;
  const ba = d.beforeAfter;
  const tfAbs = ba.tf_abs;
  const rawDb = tfAbs.map((v) => 70 + v);
  const idealFilter = tfAbs.map((v) => -v);
  const maxBefore = Math.max(...tfAbs.map(Math.abs));
  const maxAfterSim = Math.max(...d.responses.residual.map(Math.abs));
  const imprSim = maxBefore > 0 ? Math.max(0, ((maxBefore - maxAfterSim) / maxBefore) * 100) : 0;

  // Optional real after-IPP measurement, interpolated onto the eval grid.
  let afterLevel = null, realFilter = null, maxAfterReal = null, imprReal = null;
  if (state.hxmlAfter) {
    const at = interp(fe, state.hxmlAfter.freq, state.hxmlAfter.tf);
    afterLevel = at.map((v) => 70 + v);
    realFilter = at.map((v, i) => v - tfAbs[i]);
    maxAfterReal = Math.max(...at.map(Math.abs));
    imprReal = maxBefore > 0 ? Math.max(0, ((maxBefore - maxAfterReal) / maxBefore) * 100) : 0;
  }

  const traces = [
    // Top panel — output level (dBSPL)
    { x: fe, y: fe.map(() => 70), name: "Target 70 dBSPL", mode: "lines", line: { color: "#16a34a", width: 2.2, dash: "solid" }, xaxis: "x", yaxis: "y" },
    { x: fe, y: rawDb, name: "Before IPP (raw mic)", mode: "lines", line: { color: C.raw, width: 3.0, dash: "solid" }, xaxis: "x", yaxis: "y" },
    { x: fe, y: ba.level_corrected_db, name: `After IPP — simulated (order ${d.chosen_ord})`, mode: "lines", line: { color: "#0080ff", width: 2.8, dash: "solid" }, xaxis: "x", yaxis: "y" },
    // Bottom panel — correction filter (dB)
    { x: fe, y: idealFilter, name: "Ideal target = −TF(f)", mode: "lines", line: { color: "#475569", width: 2.4, dash: "solid" }, xaxis: "x2", yaxis: "y2" },
    { x: fe, y: d.quant.H_q_db, name: `Simulated IIR (order ${d.chosen_ord})`, mode: "lines", line: { color: C.target, width: 2.8, dash: "solid" }, xaxis: "x2", yaxis: "y2" },
  ];
  if (afterLevel) {
    traces.push({ x: fe, y: afterLevel, name: `After IPP — REAL hardware (±${maxAfterReal.toFixed(1)} dB, ${imprReal.toFixed(0)}%)`, mode: "lines", line: { color: C.realResid, width: 3.0, dash: "solid" }, xaxis: "x", yaxis: "y" });
    traces.push({ x: fe, y: realFilter, name: "Real hardware correction (after − before)", mode: "lines", line: { color: C.realResid, width: 2.8, dash: "solid" }, xaxis: "x2", yaxis: "y2" });
  }

  const realFilt = getNormalizedRealFilter(d.fnorm || 1000);
  if (realFilt) {
    traces.push({
      x: realFilt.freq,
      y: realFilt.mag,
      name: "Real IIR filter (device)",
      mode: "lines",
      line: { color: C.deviceFilt, width: 2.8, dash: "solid" },
      xaxis: "x2",
      yaxis: "y2",
    });
  }

  const src = ba.is_real_hxml ? "HXML" : document.getElementById("shape").value;
  const title = afterLevel
    ? `Before/After — ${src} · before ±${maxBefore.toFixed(1)} dB → real ±${maxAfterReal.toFixed(1)} dB (${imprReal.toFixed(0)}%), sim ±${maxAfterSim.toFixed(1)} dB (${imprSim.toFixed(0)}%)`
    : `Before/After — ${src} · before ±${maxBefore.toFixed(1)} dB → after ±${maxAfterSim.toFixed(1)} dB (${imprSim.toFixed(0)}% corrected) · load After-IPP HXML for real result`;

  const layout = Object.assign(BASE_LAYOUT(), {
    title: { text: title, font: { size: 12, color: "#131a23" } },
    margin: { l: 55, r: 20, t: 42, b: 42 },
    xaxis: { type: "log", domain: [0, 1], anchor: "y", gridcolor: "#e3e9f2", showticklabels: false, ...BOX_AXIS },
    yaxis: { title: "Output [dBSPL]", domain: [0.53, 1.0], anchor: "x", gridcolor: "#e3e9f2", zerolinecolor: "#cfd8e6", ...BOX_AXIS },
    xaxis2: { title: "Frequency [Hz]", type: "log", domain: [0, 1], anchor: "y2", gridcolor: "#e3e9f2", ...BOX_AXIS },
    yaxis2: { title: "Correction [dB]", domain: [0.0, 0.47], anchor: "x2", gridcolor: "#e3e9f2", zerolinecolor: "#cfd8e6", ...BOX_AXIS },
    legend: autoLegendLayout(traces, true, 11, { domains: { y: [0.53, 1.0], y2: [0.0, 0.47] } }),
  });
  Plotly.newPlot(target, traces, layout, { responsive: true, displaylogo: false });
  makeLegendDraggable(target);
}


// Linear interpolation of ys(xs) onto the query grid xq (xs assumed ascending).
function interp(xq, xs, ys) {
  return xq.map((x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
    let lo = 0, hi = xs.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid; else hi = mid;
    }
    const t = (x - xs[lo]) / (xs[hi] - xs[lo]);
    return ys[lo] + t * (ys[hi] - ys[lo]);
  });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Run once on load so the user sees a result immediately.
run();
