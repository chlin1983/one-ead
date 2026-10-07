/**
 * Balanced Armature Receiver Simulator
 * Physics & Acoustic Engine based on "BA.pdf" (Tyll Hertsens / Knowles & Sonion)
 */

(function () {
  'use strict';

  // --- Global State ---
  const state = {
    viewMode: 'cutaway', // 'cutaway' | 'flux' | 'vintage'
    frequency: 1000,     // Hz
    amplitude: 1.5,      // mA drive current
    waveform: 'sine',    // 'sine' | 'square' | 'sweep'
    sweepDirection: 1,
    speed: 0.05,         // slow motion factor
    isPaused: false,
    
    // Internal Transducer Parameters (BA.pdf p.3-6)
    armatureType: 'standard', // 'standard' | 'wideband' | 'highmass'
    ferrofluidDamping: 0,     // 0, 3, 5, 8, 10 dB
    housingVented: false,
    diaphragmLaserHoles: false,
    
    // External IEM Tuning Parameters (BA.pdf p.7-9)
    tubeLength: 10,           // mm (0 to 25)
    tubeDiameter: 1.35,       // mm (1.35 or 1.91)
    acousticFilter: 0,        // 0, 320, 680, 1000, 1500, 2200 Ohms
    filterPosition: 'near',   // 'near' | 'far'
    driverCount: 1,           // 1, 2, 3
    
    // Mechanical Shock Test
    shockActive: false,
    shockTimer: 0,
    
    // Audio Synth
    audioActive: false,
    audioVolume: 0.15,

    // Animation time
    simTime: 0,
    hoveredComponent: null
  };

  // --- Audio Context ---
  let audioCtx = null;
  let oscNode = null;
  let gainNode = null;

  function initAudio() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContextClass();
      oscNode = audioCtx.createOscillator();
      gainNode = audioCtx.createGain();

      oscNode.type = 'sine';
      oscNode.frequency.setValueAtTime(state.frequency, audioCtx.currentTime);
      gainNode.gain.setValueAtTime(0, audioCtx.currentTime);

      oscNode.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscNode.start();
    }
  }

  function updateAudio() {
    if (!audioCtx) return;
    if (state.audioActive) {
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      oscNode.frequency.setTargetAtTime(state.frequency, audioCtx.currentTime, 0.03);
      
      // Calculate realistic volume output relative to frequency response curve!
      const spl = calculateSPL(state.frequency);
      // Normalize SPL: 100dB -> 1.0, 115dB -> 1.5, 90dB -> 0.4
      const responseMultiplier = Math.pow(10, (spl - 105) / 30);
      const targetGain = Math.min(0.3, state.audioVolume * responseMultiplier);
      gainNode.gain.setTargetAtTime(targetGain, audioCtx.currentTime, 0.05);
    } else {
      if (gainNode) {
        gainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.03);
      }
    }
  }

  // --- DOM Elements ---
  const transducerCanvas = document.getElementById('transducer-canvas');
  const tCtx = transducerCanvas.getContext('2d');

  const responseCanvas = document.getElementById('response-canvas');
  const rCtx = responseCanvas.getContext('2d');

  const freqSlider = document.getElementById('freq-slider');
  const freqDisplay = document.getElementById('freq-display');
  const ampSlider = document.getElementById('amp-slider');
  const ampDisplay = document.getElementById('amp-display');
  const ferrofluidSelect = document.getElementById('ferrofluid-select');
  const ferrofluidDisplay = document.getElementById('ferrofluid-display');
  const housingVentToggle = document.getElementById('housing-vent-toggle');
  const diaphragmHolesToggle = document.getElementById('diaphragm-holes-toggle');
  const tubeLengthSlider = document.getElementById('tube-length-slider');
  const tubeLenDisplay = document.getElementById('tube-len-display');
  const filterSelect = document.getElementById('filter-select');
  const filterDisplay = document.getElementById('filter-display');
  const simSpeedSelect = document.getElementById('sim-speed-select');
  const playPauseBtn = document.getElementById('play-pause-btn');
  const playIcon = document.getElementById('play-icon');
  const stepForwardBtn = document.getElementById('step-forward-btn');
  const shockTestBtn = document.getElementById('shock-test-btn');
  const audioToggleBtn = document.getElementById('audio-toggle-btn');
  const audioBtnLabel = document.getElementById('audio-btn-label');
  const audioVolumeSlider = document.getElementById('audio-volume');
  const shockBanner = document.getElementById('shock-banner');
  const inspectorTooltip = document.getElementById('inspector-tooltip');
  const presetsBtn = document.getElementById('preset-selector-btn');
  const presetsMenu = document.getElementById('presets-menu');
  const tourBtn = document.getElementById('tour-btn');
  const tourModal = document.getElementById('tour-modal');
  const closeTourBtn = document.getElementById('close-tour-btn');
  const prevTourBtn = document.getElementById('prev-tour-btn');
  const nextTourBtn = document.getElementById('next-tour-btn');
  const tourStepNum = document.getElementById('tour-step-num');
  const tourTitle = document.getElementById('tour-title');
  const tourContent = document.getElementById('tour-content');
  const tourDots = document.getElementById('tour-dots');

  // Telemetry HUD Elements
  const hudPhase = document.getElementById('hud-phase');
  const hudDeflection = document.getElementById('hud-deflection');
  const hudForce = document.getElementById('hud-force');
  const hudPressure = document.getElementById('hud-pressure');
  const currentOpFreq = document.getElementById('current-op-freq');
  const armatureExplanation = document.getElementById('armature-explanation');
  const multidriverDesc = document.getElementById('multidriver-desc');

  // Components registry for interactive hovering
  const componentsList = [
    {
      id: 'armature',
      num: 2,
      name: 'U-Shaped Armature (Diving Board)',
      desc: 'The permeable metallic motor core. The top branch is fixed to the housing, while the lower cantilever flexes up and down like a diving board between the magnets.',
      citation: 'BA.pdf page 2-3 (Armature Variables)'
    },
    {
      id: 'coil',
      num: 1,
      name: 'Drive Coil',
      desc: 'Stationary copper wire coil wrapping around the armature. Audio AC current flowing through this coil induces dynamic magnetic flux throughout the armature.',
      citation: 'BA.pdf page 3 (Motor Principle)'
    },
    {
      id: 'magnets',
      num: 'M',
      name: 'Permanent Magnets (N/S Poles)',
      desc: 'Two high-strength permanent magnets create a static magnetic bias field. In neutral state, magnetic attraction balances. Signal flux unbalances the force, deflecting the cantilever.',
      citation: 'BA.pdf page 2-3 (Unstable Balance)'
    },
    {
      id: 'ferrofluid',
      num: 'FF',
      name: 'Knowles Ferrofluid Damping Drops',
      desc: 'Liquid magnetic fluid suspended by the magnetic field between magnets and armature. Damps high-Q resonance peaks (3-10 dB) and cushions mechanical drop shocks.',
      citation: 'BA.pdf page 5-6 (Ferrofluid Damped ED)'
    },
    {
      id: 'pin',
      num: 3,
      name: 'Drive Pin',
      desc: 'Stiff linkage pin welded to the moving tip of the armature. Transfers vertical mechanical vibrations directly to the acoustic diaphragm.',
      citation: 'BA.pdf page 3 (Drive Pin Linkage)'
    },
    {
      id: 'diaphragm',
      num: 4,
      name: 'Diaphragm & Membrane',
      desc: 'Lightweight metal plate suspended by a compliant perimeter membrane. Separates the front and back acoustic chambers and displaces air to create sound pressure.',
      citation: 'BA.pdf page 3-5 (Diaphragm Variables)'
    },
    {
      id: 'cavities',
      num: 5,
      name: 'Front & Back Acoustic Cavities',
      desc: 'Back volume acts as an acoustic air-spring (stiffer in small cavities). Front volume channels compressed air through the sound nozzle.',
      citation: 'BA.pdf page 3 (Internal Volume)'
    },
    {
      id: 'nozzle',
      num: 6,
      name: 'Sound Outlet Nozzle & Tubing',
      desc: 'Acoustic port exiting into IEM earphone tubing. Tube length and diameter create external standing-wave resonances (2nd acoustic peak).',
      citation: 'BA.pdf page 7-8 (Tubing Length & Diameter)'
    },
    {
      id: 'damper',
      num: 'R',
      name: 'Acoustic Damper Plug',
      desc: 'Resistive acoustic screen calibrated in acoustic Ohms (320Ω - 2200Ω). Placed in sound tube to smooth out harsh resonant peaks between 1kHz and 8kHz.',
      citation: 'BA.pdf page 7-8 (In-tube Sound Damping Filters)'
    }
  ];

  // --- High DPI Canvas Setup ---
  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    
    // Transducer Canvas
    const tRect = transducerCanvas.parentElement.getBoundingClientRect();
    transducerCanvas.width = Math.floor(tRect.width * dpr);
    transducerCanvas.height = Math.floor(tRect.height * dpr);
    tCtx.setTransform(1, 0, 0, 1, 0, 0);
    tCtx.scale(dpr, dpr);

    // Response Canvas
    const rRect = responseCanvas.parentElement.getBoundingClientRect();
    responseCanvas.width = Math.floor(rRect.width * dpr);
    responseCanvas.height = Math.floor(rRect.height * dpr);
    rCtx.setTransform(1, 0, 0, 1, 0, 0);
    rCtx.scale(dpr, dpr);
  }

  window.addEventListener('resize', resizeCanvas);

  // --- Mathematical Transfer Function / SPL Curve Calculation ---
  // Accurately reproduces the acoustic measurements shown in BA.pdf (Sonion & Knowles)
  function calculateSPL(f, overrideParams = null) {
    const p = overrideParams || state;

    // 1. Armature mechanical parameters
    let f1_res = 2200; // Hz base armature resonance
    let q1 = 3.8;      // Q factor of 1st peak
    let baselineGain = 104; // dB SPL

    if (p.armatureType === 'wideband') {
      // Thicker (stiffer) + narrower (lighter) Sonion 2600
      f1_res = 2800;
      q1 = 3.0;
      baselineGain = 102;
    } else if (p.armatureType === 'highmass') {
      // Increased mass for flux carrying ability -> higher bass, lower resonance
      f1_res = 1800;
      q1 = 4.2;
      baselineGain = 108;
    }

    // Housing venting / back volume effect
    if (p.housingVented) {
      // Enlarged back volume relieves air-spring stiffness -> +4dB deep bass
      if (f < 500) {
        baselineGain += 4 * (1 - f / 500);
      }
    } else {
      // Sealed back volume acts as acoustic stiffness, rolling off below 100Hz
      if (f < 100) {
        baselineGain -= 5 * (1 - f / 100);
      }
    }

    // Laser compensation holes in diaphragm membrane (BA.pdf p.7)
    if (p.diaphragmLaserHoles) {
      if (f < 800) {
        baselineGain -= 4.5 * (1 - f / 800);
      }
    }

    // 2. Knowles Ferrofluid Damping (FED) effect (BA.pdf p.6)
    // Damps resonant peaks without dropping baseline sensitivity
    const ffDamp = p.ferrofluidDamping || 0; // 0, 3, 5, 8, 10 dB
    const effectiveQ1 = Math.max(0.8, q1 * Math.pow(10, -ffDamp / 20));

    // 1st Resonance Peak calculation (second order mechanical system)
    const ratio1 = f / f1_res;
    const denom1 = Math.sqrt(Math.pow(1 - ratio1 * ratio1, 2) + Math.pow(ratio1 / effectiveQ1, 2));
    const peak1Gain = 20 * Math.log10(1 / Math.max(0.001, denom1));
    const peak1Contribution = Math.min(18 - ffDamp * 0.9, peak1Gain);

    // 3. 2nd Resonance Peak (Diaphragm + IEM Tubing standing wave) (BA.pdf p.7)
    // Tubing length shifts peak frequency downwards:
    // 0mm -> ~7200 Hz; 10mm -> ~5500 Hz; 15mm -> ~4200 Hz; 20mm -> ~3200 Hz
    let f2_res = 7500;
    if (p.tubeLength > 0) {
      // Acoustic 1/4 wavelength quarter-wave pipe resonance
      f2_res = 343000 / (4 * (p.tubeLength + 10)); // approximate acoustic tube resonance
      f2_res = Math.max(2500, Math.min(7500, f2_res));
    }

    // Tubing diameter effect (BA.pdf p.7)
    // 1.91mm is peakier/sharper Q than 1.35mm
    let q2 = (p.tubeDiameter === 1.91) ? 5.2 : 3.4;

    // Acoustic Damper Filter (Ohms) (BA.pdf p.7-8)
    // Higher acoustic ohms drastically smooth 1kHz - 8kHz peaks
    let damperDamp = 0;
    if (p.acousticFilter > 0) {
      const ohmsFactor = p.acousticFilter / 1000;
      // Position effect: Near driver = stiff air = max push through filter
      const posFactor = (p.filterPosition === 'near') ? 1.0 : 0.65;
      damperDamp = (ohmsFactor * 7.5) * posFactor;
    }

    // Combined damping on 2nd peak (ferrofluid also helps tube resonance + damper)
    const totalDamp2 = Math.min(22, damperDamp + (ffDamp * 0.6));
    const effectiveQ2 = Math.max(0.7, q2 * Math.pow(10, -totalDamp2 / 20));

    const ratio2 = f / f2_res;
    const denom2 = Math.sqrt(Math.pow(1 - ratio2 * ratio2, 2) + Math.pow(ratio2 / effectiveQ2, 2));
    let peak2Gain = 20 * Math.log10(1 / Math.max(0.001, denom2));
    peak2Gain = Math.min(16 - totalDamp2 * 0.8, peak2Gain);

    // If diaphragm laser holes punched, reduce 2nd peak
    if (p.diaphragmLaserHoles) {
      peak2Gain -= 3.5;
    }

    // 4. High-frequency roll-off (armature inductance and mass limits)
    let highRollOff = 0;
    const f_cutoff = (p.armatureType === 'wideband') ? 14000 : 9000;
    if (f > f_cutoff) {
      const octaves = Math.log2(f / f_cutoff);
      highRollOff = -octaves * 24; // 24 dB/octave steep drop
    }

    // 5. Multi-Driver Architecture (BA.pdf p.9)
    let multiDriverBonus = 0;
    if (p.driverCount === 2) {
      // Woofer adds bass authority + Tweeter extends high end
      if (f < 300) multiDriverBonus += 5;
      if (f > 8000) multiDriverBonus += Math.min(14, (f - 8000) / 700);
    } else if (p.driverCount === 3) {
      // Super Woofer + Woofer + Tweeter (Sony XBA-4 style)
      if (f < 150) multiDriverBonus += 9;
      else if (f < 500) multiDriverBonus += 5;
      if (f > 7000) multiDriverBonus += Math.min(18, (f - 7000) / 500);
    }

    const totalSPL = baselineGain + (peak1Contribution * 0.75) + (peak2Gain * 0.8) + highRollOff + multiDriverBonus;
    return totalSPL;
  }

  // --- Rendering: Transducer Canvas Engine ---
  function drawTransducer(width, height) {
    tCtx.clearRect(0, 0, width, height);

    if (state.viewMode === 'cutaway') {
      drawModernCutaway(width, height);
    } else if (state.viewMode === 'flux') {
      drawMagneticFluxMode(width, height);
    } else if (state.viewMode === 'vintage') {
      drawVintageSeeSaw(width, height);
    }
  }

  // Draw modern U-shaped cantilever ("diving board") balanced armature receiver
  function drawModernCutaway(width, height) {
    const cx = width * 0.44;
    const cy = height * 0.52;
    const scale = Math.min(width / 750, height / 480);

    // Calculate dynamic physical displacement
    // Phase calculation:
    const omega = 2 * Math.PI * state.frequency;
    let signalPhase = state.simTime * omega;
    let driveCurrent = Math.sin(signalPhase);

    if (state.waveform === 'square') {
      driveCurrent = Math.sign(driveCurrent);
    } else if (state.waveform === 'sweep') {
      driveCurrent = Math.sin(signalPhase);
    }

    // Net instantaneous force and deflection
    const maxDeflectionPixels = 24 * scale;
    let normalizedExcursion = driveCurrent * (state.amplitude / 2.5);

    // If shock test is active, force excessive excursion that hits bumpers
    if (state.shockActive) {
      const shockDecay = Math.exp(-state.shockTimer * 4);
      const shockOsc = Math.sin(state.shockTimer * 45) * shockDecay * 2.8;
      normalizedExcursion += shockOsc;
    }

    // Damp excursion if ferrofluid is present
    if (state.ferrofluidDamping > 0) {
      const dampFactor = 1 - (state.ferrofluidDamping * 0.04);
      normalizedExcursion *= dampFactor;
    }

    // Mechanical bumper excursion clamping (BA.pdf p.5)
    const bumperLimit = 1.35;
    let hitBumper = false;
    if (Math.abs(normalizedExcursion) > bumperLimit) {
      normalizedExcursion = Math.sign(normalizedExcursion) * bumperLimit;
      hitBumper = true;
    }

    const deflection = normalizedExcursion * maxDeflectionPixels;

    // Telemetry HUD updates
    const deflectionUm = (normalizedExcursion * 12.5).toFixed(2);
    const forceMn = (driveCurrent * state.amplitude * 4.2).toFixed(2);
    const pressurePa = (-normalizedExcursion * 8.4).toFixed(2);
    const phaseDeg = ((signalPhase * (180 / Math.PI)) % 360).toFixed(0);

    hudPhase.textContent = `${phaseDeg}° (${driveCurrent >= 0 ? '+' : '-'})`;
    hudDeflection.textContent = `${deflectionUm} µm`;
    hudForce.textContent = `${forceMn} mN`;
    hudPressure.textContent = `${pressurePa} Pa`;
    if (hitBumper && state.shockActive) {
      shockBanner.classList.remove('hidden');
    } else if (!state.shockActive) {
      shockBanner.classList.add('hidden');
    }

    // --- 1. Housing & Enclosure ---
    const caseW = 420 * scale;
    const caseH = 260 * scale;
    const caseX = cx - caseW * 0.52;
    const caseY = cy - caseH * 0.5;

    // Outer case shadow & glow
    tCtx.save();
    tCtx.fillStyle = '#0f172a';
    tCtx.strokeStyle = '#334155';
    tCtx.lineWidth = 4 * scale;
    roundRect(tCtx, caseX, caseY, caseW, caseH, 12 * scale);
    tCtx.fill();
    tCtx.stroke();

    // Housing Cover (Top lid)
    tCtx.fillStyle = '#1e293b';
    roundRect(tCtx, caseX, caseY, caseW, 14 * scale, 6 * scale);
    tCtx.fill();
    tCtx.stroke();

    // Laser Vent in Housing (BA.pdf p.3)
    if (state.housingVented) {
      tCtx.fillStyle = '#00d2ff';
      tCtx.beginPath();
      tCtx.arc(caseX + 28 * scale, caseY + 45 * scale, 4 * scale, 0, Math.PI * 2);
      tCtx.fill();
      tCtx.fillStyle = '#38bdf8';
      tCtx.font = `${10 * scale}px var(--font-mono)`;
      tCtx.fillText('Laser Vent', caseX + 38 * scale, caseY + 48 * scale);
    }

    // --- 2. Acoustic Cavities Air Pressure Heatmap ---
    // Diaphragm position
    const diaY = caseY + 55 * scale;
    const frontVolumeY = caseY + 16 * scale;
    const frontVolumeH = diaY - frontVolumeY;

    // Dynamic front chamber acoustic pressure gradient
    const pressureAlpha = Math.min(0.5, Math.abs(normalizedExcursion) * 0.35);
    const pressureColor = normalizedExcursion < 0 
      ? `rgba(239, 68, 68, ${pressureAlpha})`   // Compression (diaphragm pushed up)
      : `rgba(0, 210, 255, ${pressureAlpha})`; // Rarefaction (diaphragm pulled down)

    tCtx.fillStyle = pressureColor;
    roundRect(tCtx, caseX + 10 * scale, frontVolumeY, caseW - 20 * scale, frontVolumeH, 4 * scale);
    tCtx.fill();

    // Rear Volume (Back Volume - between diaphragm and bottom casing)
    tCtx.fillStyle = 'rgba(15, 23, 42, 0.6)';
    roundRect(tCtx, caseX + 10 * scale, diaY + 8 * scale, caseW - 20 * scale, caseH - (diaY - caseY) - 16 * scale, 4 * scale);
    tCtx.fill();

    // --- 3. Diaphragm & Compliant Suspension Membrane ---
    const diaPlateW = 260 * scale;
    const diaPlateX = caseX + 70 * scale;
    const diaDeflection = deflection * 0.75; // pin displacement

    // Compliant membrane / suspension surround
    tCtx.beginPath();
    tCtx.moveTo(caseX + 16 * scale, diaY);
    tCtx.quadraticCurveTo(diaPlateX - 10 * scale, diaY, diaPlateX, diaY - diaDeflection);
    tCtx.lineTo(diaPlateX + diaPlateW, diaY - diaDeflection);
    tCtx.quadraticCurveTo(diaPlateX + diaPlateW + 10 * scale, diaY, caseX + caseW - 16 * scale, diaY);
    tCtx.strokeStyle = '#94a3b8';
    tCtx.lineWidth = 2.5 * scale;
    tCtx.stroke();

    // Diaphragm Stiff Plate
    tCtx.fillStyle = '#cbd5e1';
    tCtx.strokeStyle = '#f8fafc';
    tCtx.lineWidth = 2 * scale;
    roundRect(tCtx, diaPlateX, diaY - diaDeflection - 2 * scale, diaPlateW, 4 * scale, 2 * scale);
    tCtx.fill();
    tCtx.stroke();

    // Laser compensation holes in diaphragm (BA.pdf p.7)
    if (state.diaphragmLaserHoles) {
      tCtx.fillStyle = '#07090e';
      tCtx.beginPath();
      tCtx.arc(diaPlateX + 35 * scale, diaY - diaDeflection, 2.5 * scale, 0, Math.PI * 2);
      tCtx.arc(diaPlateX + diaPlateW - 35 * scale, diaY - diaDeflection, 2.5 * scale, 0, Math.PI * 2);
      tCtx.fill();
    }

    // --- 4. Drive Pin (Transmission Linkage) ---
    const pinX = caseX + 115 * scale;
    const pinTopY = diaY - diaDeflection + 2 * scale;
    const armatureTipY = cy + 42 * scale - deflection;

    tCtx.strokeStyle = '#f59e0b';
    tCtx.lineWidth = 3 * scale;
    tCtx.beginPath();
    tCtx.moveTo(pinX, pinTopY);
    tCtx.lineTo(pinX, armatureTipY);
    tCtx.stroke();

    // Pin weld joints
    tCtx.fillStyle = '#fbbf24';
    tCtx.beginPath();
    tCtx.arc(pinX, pinTopY, 3.5 * scale, 0, Math.PI * 2);
    tCtx.arc(pinX, armatureTipY, 3.5 * scale, 0, Math.PI * 2);
    tCtx.fill();

    // --- 5. Permanent Magnets & Pole Pieces ---
    const magW = 100 * scale;
    const magH = 34 * scale;
    const magX = caseX + 75 * scale;
    const topMagY = cy - 25 * scale;
    const btmMagY = cy + 65 * scale;

    // Top Magnet (North pole facing armature)
    const topGrad = tCtx.createLinearGradient(magX, topMagY, magX, topMagY + magH);
    topGrad.addColorStop(0, '#991b1b');
    topGrad.addColorStop(1, '#ef4444');
    tCtx.fillStyle = topGrad;
    tCtx.strokeStyle = '#b91c1c';
    tCtx.lineWidth = 2 * scale;
    roundRect(tCtx, magX, topMagY, magW, magH, 4 * scale);
    tCtx.fill();
    tCtx.stroke();

    tCtx.fillStyle = '#ffffff';
    tCtx.font = `bold ${12 * scale}px var(--font-display)`;
    tCtx.textAlign = 'center';
    tCtx.fillText('N  (Top Magnet)', magX + magW * 0.5, topMagY + magH * 0.65);

    // Bottom Magnet (South pole facing armature)
    const btmGrad = tCtx.createLinearGradient(magX, btmMagY, magX, btmMagY + magH);
    btmGrad.addColorStop(0, '#0284c7');
    btmGrad.addColorStop(1, '#0369a1');
    tCtx.fillStyle = btmGrad;
    tCtx.strokeStyle = '#0284c7';
    roundRect(tCtx, magX, btmMagY, magW, magH, 4 * scale);
    tCtx.fill();
    tCtx.stroke();

    tCtx.fillStyle = '#ffffff';
    tCtx.fillText('S  (Bottom Magnet)', magX + magW * 0.5, btmMagY + magH * 0.65);

    // Mechanical Limit Bumpers (BA.pdf p.5)
    tCtx.fillStyle = '#e2e8f0';
    // Top bumper
    roundRect(tCtx, magX + 15 * scale, topMagY + magH - 2 * scale, 8 * scale, 5 * scale, 2 * scale);
    roundRect(tCtx, magX + magW - 23 * scale, topMagY + magH - 2 * scale, 8 * scale, 5 * scale, 2 * scale);
    // Bottom bumper
    roundRect(tCtx, magX + 15 * scale, btmMagY - 3 * scale, 8 * scale, 5 * scale, 2 * scale);
    roundRect(tCtx, magX + magW - 23 * scale, btmMagY - 3 * scale, 8 * scale, 5 * scale, 2 * scale);
    tCtx.fill();

    // --- 6. Knowles Ferrofluid Droplets (BA.pdf p.5-6) ---
    if (state.ferrofluidDamping > 0) {
      const ffSize = (6 + state.ferrofluidDamping * 1.5) * scale;
      const ffTopY = topMagY + magH + (armatureTipY - (topMagY + magH)) * 0.5;
      const ffBtmY = armatureTipY + (btmMagY - armatureTipY) * 0.5;

      tCtx.fillStyle = 'rgba(20, 24, 33, 0.95)';
      tCtx.strokeStyle = 'rgba(0, 210, 255, 0.7)';
      tCtx.lineWidth = 1.5 * scale;

      // Top droplet (between top magnet and armature)
      tCtx.beginPath();
      tCtx.ellipse(magX + 50 * scale, (topMagY + magH + armatureTipY) / 2, ffSize, ffSize * 0.45, 0, 0, Math.PI * 2);
      tCtx.fill();
      tCtx.stroke();

      // Bottom droplet (between bottom magnet and armature)
      tCtx.beginPath();
      tCtx.ellipse(magX + 50 * scale, (btmMagY + armatureTipY) / 2, ffSize, ffSize * 0.45, 0, 0, Math.PI * 2);
      tCtx.fill();
      tCtx.stroke();
    }

    // --- 7. U-Shaped Cantilever Armature ("Diving Board") ---
    // Top leg is fixed. Bottom leg flexes.
    const armFixedX = caseX + 270 * scale;
    const armCurveX = caseX + 310 * scale;
    const armTopY = cy - 25 * scale;
    const armBtmY = cy + 42 * scale;
    const armTipX = caseX + 45 * scale;

    let armThickness = 6 * scale;
    if (state.armatureType === 'wideband') {
      armThickness = 8 * scale; // 0.19mm thicker
    } else if (state.armatureType === 'highmass') {
      armThickness = 7.5 * scale;
    }

    // Dynamic color based on induced magnetic flux polarity
    let armatureStroke = '#94a3b8';
    if (driveCurrent > 0.05) {
      armatureStroke = `rgba(239, 68, 68, ${0.4 + driveCurrent * 0.6})`; // North polarized tip
    } else if (driveCurrent < -0.05) {
      armatureStroke = `rgba(0, 210, 255, ${0.4 + Math.abs(driveCurrent) * 0.6})`; // South polarized tip
    }

    tCtx.beginPath();
    // 1. Top fixed branch
    tCtx.moveTo(armFixedX, armTopY);
    tCtx.lineTo(armCurveX, armTopY);
    // 2. Rear U-Bend
    tCtx.arcTo(armCurveX + 24 * scale, armTopY, armCurveX + 24 * scale, armTopY + 35 * scale, 18 * scale);
    tCtx.arcTo(armCurveX + 24 * scale, armBtmY, armCurveX, armBtmY, 18 * scale);
    // 3. Cantilever diving board beam with flex equation
    const flexAnchorX = armCurveX;
    const flexAnchorY = armBtmY;
    const flexControlX = (flexAnchorX + armTipX) * 0.55;
    const flexControlY = armBtmY;
    tCtx.quadraticCurveTo(flexControlX, flexControlY, armTipX, armBtmY - deflection);

    tCtx.strokeStyle = armatureStroke;
    tCtx.lineWidth = armThickness;
    tCtx.lineCap = 'round';
    tCtx.lineJoin = 'round';
    tCtx.stroke();

    // Armature fixed anchor support mount
    tCtx.fillStyle = '#475569';
    roundRect(tCtx, armFixedX - 25 * scale, armTopY - 12 * scale, 35 * scale, 24 * scale, 4 * scale);
    tCtx.fill();

    // --- 8. Drive Coil (Copper Wire Windings) ---
    const coilX = caseX + 195 * scale;
    const coilW = 60 * scale;
    const coilH = 50 * scale;
    const coilY = armBtmY - coilH * 0.5;

    // Draw coil wire loops in cross-section
    const turns = 8;
    for (let i = 0; i < turns; i++) {
      const turnX = coilX + (i / turns) * coilW + 3 * scale;
      // Top turn bundle
      tCtx.fillStyle = '#d97706';
      tCtx.strokeStyle = '#b45309';
      tCtx.lineWidth = 1.5 * scale;
      tCtx.beginPath();
      tCtx.arc(turnX, coilY + 6 * scale, 3.2 * scale, 0, Math.PI * 2);
      tCtx.fill();
      tCtx.stroke();

      // Bottom turn bundle
      tCtx.beginPath();
      tCtx.arc(turnX, coilY + coilH - 6 * scale, 3.2 * scale, 0, Math.PI * 2);
      tCtx.fill();
      tCtx.stroke();

      // Animated current electron indicators
      if (Math.abs(driveCurrent) > 0.05) {
        tCtx.fillStyle = driveCurrent > 0 ? '#ffedd5' : '#e0f2fe';
        tCtx.beginPath();
        tCtx.arc(turnX, coilY + 6 * scale, 1.2 * scale, 0, Math.PI * 2);
        tCtx.fill();
      }
    }

    // Coil label
    tCtx.fillStyle = '#fbbf24';
    tCtx.font = `bold ${10 * scale}px var(--font-mono)`;
    tCtx.fillText('Coil (1)', coilX + coilW * 0.5, coilY + coilH + 16 * scale);

    // --- 9. Sound Nozzle, IEM Tubing & Acoustic Damper Filter ---
    const nozzleW = 60 * scale;
    const nozzleH = 24 * scale;
    const nozzleX = caseX + caseW - 4 * scale;
    const nozzleY = frontVolumeY + (frontVolumeH - nozzleH) * 0.5;

    // Metal Sound Nozzle
    tCtx.fillStyle = '#475569';
    tCtx.strokeStyle = '#64748b';
    tCtx.lineWidth = 2 * scale;
    roundRect(tCtx, nozzleX, nozzleY, nozzleW, nozzleH, 4 * scale);
    tCtx.fill();
    tCtx.stroke();

    // Sound Tubing attached to nozzle (BA.pdf p.7)
    if (state.tubeLength > 0) {
      const tubeW = (state.tubeLength * 7.5) * scale;
      const tubeH = (state.tubeDiameter === 1.91 ? 30 : 22) * scale;
      const tubeX = nozzleX + nozzleW;
      const tubeY = nozzleY + (nozzleH - tubeH) * 0.5;

      tCtx.fillStyle = 'rgba(56, 189, 248, 0.15)';
      tCtx.strokeStyle = 'rgba(56, 189, 248, 0.6)';
      tCtx.lineWidth = 2 * scale;
      roundRect(tCtx, tubeX, tubeY, tubeW, tubeH, 6 * scale);
      tCtx.fill();
      tCtx.stroke();

      // In-tube Acoustic Damper Filter (Ohms) (BA.pdf p.7-8)
      if (state.acousticFilter > 0) {
        let filterColor = '#94a3b8';
        if (state.acousticFilter === 320) filterColor = '#9ca3af'; // Grey
        else if (state.acousticFilter === 680) filterColor = '#f97316'; // Orange
        else if (state.acousticFilter === 1000) filterColor = '#92400e'; // Brown
        else if (state.acousticFilter === 1500) filterColor = '#16a34a'; // Green
        else if (state.acousticFilter === 2200) filterColor = '#dc2626'; // Red

        const filterOffset = (state.filterPosition === 'near') ? 12 * scale : tubeW - 20 * scale;
        const filterX = tubeX + filterOffset;
        const filterW = 8 * scale;

        tCtx.fillStyle = filterColor;
        tCtx.strokeStyle = '#ffffff';
        tCtx.lineWidth = 1 * scale;
        roundRect(tCtx, filterX, tubeY + 2 * scale, filterW, tubeH - 4 * scale, 2 * scale);
        tCtx.fill();
        tCtx.stroke();

        // Mesh lines inside filter
        tCtx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        tCtx.beginPath();
        tCtx.moveTo(filterX + 4 * scale, tubeY + 2 * scale);
        tCtx.lineTo(filterX + 4 * scale, tubeY + tubeH - 2 * scale);
        tCtx.stroke();
      }

      // Radiating sound pressure waves escaping the tube tip
      const waveStartX = tubeX + tubeW;
      const waveCenterY = tubeY + tubeH * 0.5;
      drawAcousticWavefronts(waveStartX, waveCenterY, scale, deflection);
    } else {
      // Direct nozzle output without tube
      drawAcousticWavefronts(nozzleX + nozzleW, nozzleY + nozzleH * 0.5, scale, deflection);
    }

    tCtx.restore();
  }

  // Draw acoustic pressure wave ripples escaping nozzle
  function drawAcousticWavefronts(originX, originY, scale, deflection) {
    const waveCount = 5;
    for (let i = 0; i < waveCount; i++) {
      const radius = ((state.simTime * 150 + i * 28) % 140) * scale;
      const alpha = Math.max(0, 1 - radius / (140 * scale)) * Math.min(1, Math.abs(deflection) / 10 + 0.3);
      
      tCtx.beginPath();
      tCtx.arc(originX, originY, radius, -Math.PI * 0.35, Math.PI * 0.35);
      tCtx.strokeStyle = `rgba(0, 210, 255, ${alpha})`;
      tCtx.lineWidth = 2.5 * scale;
      tCtx.stroke();
    }
  }

  // Mode 2: Magnetic Flux Vector Field (Dynamic cancellation & reinforcement)
  function drawMagneticFluxMode(width, height) {
    const cx = width * 0.5;
    const cy = height * 0.5;
    const scale = Math.min(width / 750, height / 480);

    const omega = 2 * Math.PI * state.frequency;
    let driveCurrent = Math.sin(state.simTime * omega);
    if (state.waveform === 'square') driveCurrent = Math.sign(driveCurrent);

    tCtx.save();
    // Title
    tCtx.fillStyle = '#ffffff';
    tCtx.font = `bold ${16 * scale}px var(--font-display)`;
    tCtx.textAlign = 'center';
    tCtx.fillText('Magnetic Flux Superposition: B_total = B_static ± B_coil', cx, 40 * scale);

    tCtx.fillStyle = '#94a3b8';
    tCtx.font = `${11 * scale}px var(--font-body)`;
    tCtx.fillText('Static Magnet Field + AC Coil Dynamic Flux = Net Deflection Force F ∝ 4·B_bias·B_signal', cx, 60 * scale);

    // Magnets Top and Bottom
    const magW = 200 * scale;
    const magH = 45 * scale;
    const magX = cx - magW * 0.5;
    const topMagY = cy - 110 * scale;
    const btmMagY = cy + 65 * scale;

    // Top Magnet (North pole facing armature)
    tCtx.fillStyle = '#ef4444';
    roundRect(tCtx, magX, topMagY, magW, magH, 6 * scale);
    tCtx.fill();
    tCtx.fillStyle = '#ffffff';
    tCtx.font = `bold ${14 * scale}px var(--font-display)`;
    tCtx.fillText('PERMANENT MAGNET (NORTH POLE)', cx, topMagY + 28 * scale);

    // Bottom Magnet (South pole facing armature)
    tCtx.fillStyle = '#0284c7';
    roundRect(tCtx, magX, btmMagY, magW, magH, 6 * scale);
    tCtx.fill();
    tCtx.fillStyle = '#ffffff';
    tCtx.fillText('PERMANENT MAGNET (SOUTH POLE)', cx, btmMagY + 28 * scale);

    // Central Armature Cantilever
    const armY = cy - (driveCurrent * 20 * scale);
    const armH = 14 * scale;
    tCtx.fillStyle = '#64748b';
    roundRect(tCtx, magX - 30 * scale, armY - armH * 0.5, magW + 60 * scale, armH, 4 * scale);
    tCtx.fill();
    tCtx.fillStyle = '#f8fafc';
    tCtx.font = `bold ${12 * scale}px var(--font-mono)`;
    tCtx.fillText(`Armature (Permeable Core) [${driveCurrent >= 0 ? 'N-induced' : 'S-induced'}]`, cx, armY + 4 * scale);

    // Draw Magnetic Field Lines
    // Static Bias Field: flows from Top North down through bottom South
    // Dynamic Coil Flux: opposes one gap and reinforces other!
    const lines = 7;
    const topGapField = 1.0 + driveCurrent * 0.8; // Reinforced when driveCurrent > 0
    const btmGapField = 1.0 - driveCurrent * 0.8; // Weakened when driveCurrent > 0

    // Top Gap Field Lines
    for (let i = 0; i < lines; i++) {
      const lineX = magX + 25 * scale + (i / (lines - 1)) * (magW - 50 * scale);
      tCtx.beginPath();
      tCtx.moveTo(lineX, topMagY + magH);
      tCtx.lineTo(lineX, armY - armH * 0.5);
      
      const alpha = Math.max(0.1, Math.min(1.0, topGapField * 0.6));
      tCtx.strokeStyle = driveCurrent > 0 ? `rgba(239, 68, 68, ${alpha})` : `rgba(0, 210, 255, ${alpha})`;
      tCtx.lineWidth = (1 + topGapField * 2.5) * scale;
      tCtx.stroke();

      // Arrow head pointing down
      drawArrowHead(tCtx, lineX, (topMagY + magH + armY) * 0.5, 0, 1, 4 * scale);
    }

    // Bottom Gap Field Lines
    for (let i = 0; i < lines; i++) {
      const lineX = magX + 25 * scale + (i / (lines - 1)) * (magW - 50 * scale);
      tCtx.beginPath();
      tCtx.moveTo(lineX, armY + armH * 0.5);
      tCtx.lineTo(lineX, btmMagY);
      
      const alpha = Math.max(0.1, Math.min(1.0, btmGapField * 0.6));
      tCtx.strokeStyle = driveCurrent < 0 ? `rgba(239, 68, 68, ${alpha})` : `rgba(0, 210, 255, ${alpha})`;
      tCtx.lineWidth = (1 + btmGapField * 2.5) * scale;
      tCtx.stroke();

      drawArrowHead(tCtx, lineX, (armY + btmMagY) * 0.5, 0, 1, 4 * scale);
    }

    // Field strength text labels
    tCtx.font = `bold ${12 * scale}px var(--font-mono)`;
    tCtx.fillStyle = topGapField > 1.0 ? '#f87171' : '#38bdf8';
    tCtx.fillText(`Top Gap Flux Density: ${(topGapField * 1.2).toFixed(2)} Tesla (REINFORCED)`, cx, cy - 45 * scale);

    tCtx.fillStyle = btmGapField > 1.0 ? '#f87171' : '#38bdf8';
    tCtx.fillText(`Bottom Gap Flux Density: ${(btmGapField * 1.2).toFixed(2)} Tesla (OPPOSED)`, cx, cy + 45 * scale);

    tCtx.restore();
  }

  // Mode 3: 1920s Vintage "See-Saw" Pivoting Armature (Crystal Radio era)
  function drawVintageSeeSaw(width, height) {
    const cx = width * 0.5;
    const cy = height * 0.5;
    const scale = Math.min(width / 750, height / 480);

    const omega = 2 * Math.PI * state.frequency;
    let driveCurrent = Math.sin(state.simTime * omega);
    if (state.waveform === 'square') driveCurrent = Math.sign(driveCurrent);

    const tiltAngle = driveCurrent * 0.12; // radians of see-saw rotation

    tCtx.save();
    // Title
    tCtx.fillStyle = '#ffffff';
    tCtx.font = `bold ${16 * scale}px var(--font-display)`;
    tCtx.textAlign = 'center';
    tCtx.fillText('1920s Historical "See-Saw" Pivoting Armature (Crystal Radio / Military Phone)', cx, 40 * scale);

    tCtx.fillStyle = '#94a3b8';
    tCtx.font = `${11 * scale}px var(--font-body)`;
    tCtx.fillText('Unlike modern cantilever diving boards, vintage drivers pivoted on a central knife-edge axis between 4 pole pieces.', cx, 60 * scale);

    // Central Rocker Pivot Armature
    tCtx.save();
    tCtx.translate(cx, cy);
    tCtx.rotate(tiltAngle);

    // Rocker beam
    const beamW = 280 * scale;
    const beamH = 14 * scale;
    tCtx.fillStyle = '#94a3b8';
    tCtx.strokeStyle = '#cbd5e1';
    tCtx.lineWidth = 2 * scale;
    roundRect(tCtx, -beamW * 0.5, -beamH * 0.5, beamW, beamH, 4 * scale);
    tCtx.fill();
    tCtx.stroke();

    // Drive linkage to mica diaphragm on right end
    tCtx.strokeStyle = '#f59e0b';
    tCtx.lineWidth = 3 * scale;
    tCtx.beginPath();
    tCtx.moveTo(beamW * 0.5 - 10 * scale, 0);
    tCtx.lineTo(beamW * 0.5 - 10 * scale, 90 * scale);
    tCtx.stroke();

    tCtx.restore();

    // Central Pivot Pin
    tCtx.fillStyle = '#e2e8f0';
    tCtx.strokeStyle = '#64748b';
    tCtx.lineWidth = 3 * scale;
    tCtx.beginPath();
    tCtx.arc(cx, cy, 10 * scale, 0, Math.PI * 2);
    tCtx.fill();
    tCtx.stroke();
    tCtx.fillStyle = '#0f172a';
    tCtx.beginPath();
    tCtx.arc(cx, cy, 4 * scale, 0, Math.PI * 2);
    tCtx.fill();

    // 4 Fixed Magnet Pole Faces around the rocker
    const pW = 80 * scale;
    const pH = 35 * scale;
    // Top Left (N)
    tCtx.fillStyle = '#ef4444';
    roundRect(tCtx, cx - 140 * scale, cy - 75 * scale, pW, pH, 4 * scale);
    tCtx.fill();
    // Bottom Left (S)
    tCtx.fillStyle = '#0284c7';
    roundRect(tCtx, cx - 140 * scale, cy + 40 * scale, pW, pH, 4 * scale);
    tCtx.fill();
    // Top Right (S)
    tCtx.fillStyle = '#0284c7';
    roundRect(tCtx, cx + 60 * scale, cy - 75 * scale, pW, pH, 4 * scale);
    tCtx.fill();
    // Bottom Right (N)
    tCtx.fillStyle = '#ef4444';
    roundRect(tCtx, cx + 60 * scale, cy + 40 * scale, pW, pH, 4 * scale);
    tCtx.fill();

    // Coil around rocker center
    tCtx.fillStyle = '#d97706';
    roundRect(tCtx, cx - 45 * scale, cy - 35 * scale, 90 * scale, 70 * scale, 6 * scale);
    tCtx.strokeStyle = '#f59e0b';
    tCtx.stroke();

    // Labels
    tCtx.fillStyle = '#ffffff';
    tCtx.font = `bold ${10 * scale}px var(--font-mono)`;
    tCtx.fillText('Knife-Edge Pivot Axis', cx, cy + 25 * scale);
    tCtx.fillText('Mica Diaphragm Link', cx + 130 * scale, cy + 95 * scale);

    tCtx.restore();
  }

  function drawArrowHead(ctx, x, y, dx, dy, size) {
    const angle = Math.atan2(dy, dx);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-size, -size * 0.6);
    ctx.lineTo(-size, size * 0.6);
    ctx.closePath();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // --- Rendering: Acoustic Frequency Response Curve (Bode Plot) ---
  function drawFrequencyResponse(width, height) {
    rCtx.clearRect(0, 0, width, height);

    const padding = { top: 20, right: 30, bottom: 35, left: 50 };
    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;

    // Frequency range: 20 Hz to 20,000 Hz (logarithmic)
    const minF = 20;
    const maxF = 20000;
    const logMinF = Math.log10(minF);
    const logMaxF = Math.log10(maxF);

    // SPL range: 75 dB to 130 dB
    const minSPL = 75;
    const maxSPL = 130;

    function xFromFreq(f) {
      return padding.left + ((Math.log10(f) - logMinF) / (logMaxF - logMinF)) * plotW;
    }

    function yFromSPL(spl) {
      return padding.top + (1 - (spl - minSPL) / (maxSPL - minSPL)) * plotH;
    }

    function freqFromX(x) {
      const frac = Math.max(0, Math.min(1, (x - padding.left) / plotW));
      return Math.pow(10, logMinF + frac * (logMaxF - logMinF));
    }

    // --- 1. Grid Lines and Labels ---
    rCtx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    rCtx.lineWidth = 1;
    rCtx.fillStyle = '#64748b';
    rCtx.font = '10px var(--font-mono)';

    // Vertical frequency grid
    const fTicks = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    fTicks.forEach(f => {
      const x = xFromFreq(f);
      rCtx.beginPath();
      rCtx.moveTo(x, padding.top);
      rCtx.lineTo(x, padding.top + plotH);
      rCtx.stroke();

      rCtx.textAlign = 'center';
      const label = f >= 1000 ? `${f / 1000}k` : `${f}`;
      rCtx.fillText(label, x, height - 12);
    });

    // Horizontal SPL grid (every 10 dB)
    for (let spl = 80; spl <= 125; spl += 10) {
      const y = yFromSPL(spl);
      rCtx.beginPath();
      rCtx.moveTo(padding.left, y);
      rCtx.lineTo(padding.left + plotW, y);
      rCtx.stroke();

      rCtx.textAlign = 'right';
      rCtx.fillText(`${spl} dB`, padding.left - 8, y + 3);
    }

    // --- 2. Baseline Response Curve (Sonion 26A01C unvarnished) ---
    const defaultParams = {
      armatureType: 'standard',
      ferrofluidDamping: 0,
      housingVented: false,
      diaphragmLaserHoles: false,
      tubeLength: 10,
      tubeDiameter: 1.35,
      acousticFilter: 0,
      filterPosition: 'near',
      driverCount: 1
    };

    rCtx.beginPath();
    rCtx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    rCtx.setLineDash([4, 4]);
    rCtx.lineWidth = 1.5;

    for (let px = 0; px <= plotW; px += 2) {
      const f = freqFromX(padding.left + px);
      const spl = calculateSPL(f, defaultParams);
      const py = yFromSPL(spl);
      if (px === 0) rCtx.moveTo(padding.left + px, py);
      else rCtx.lineTo(padding.left + px, py);
    }
    rCtx.stroke();
    rCtx.setLineDash([]); // Reset dash

    // --- 3. Active Tuned Profile Curve ---
    rCtx.beginPath();
    rCtx.strokeStyle = '#00d2ff';
    rCtx.lineWidth = 2.5;
    rCtx.shadowColor = 'rgba(0, 210, 255, 0.6)';
    rCtx.shadowBlur = 8;

    for (let px = 0; px <= plotW; px += 2) {
      const f = freqFromX(padding.left + px);
      const spl = calculateSPL(f);
      const py = yFromSPL(spl);
      if (px === 0) rCtx.moveTo(padding.left + px, py);
      else rCtx.lineTo(padding.left + px, py);
    }
    rCtx.stroke();
    rCtx.shadowBlur = 0; // Reset glow

    // --- 4. Operating Point Cursor ---
    const opX = xFromFreq(state.frequency);
    const currentSPL = calculateSPL(state.frequency);
    const opY = yFromSPL(currentSPL);

    // Vertical crosshair line
    rCtx.strokeStyle = 'rgba(255, 51, 102, 0.4)';
    rCtx.lineWidth = 1;
    rCtx.beginPath();
    rCtx.moveTo(opX, padding.top);
    rCtx.lineTo(opX, padding.top + plotH);
    rCtx.stroke();

    // Cursor dot
    rCtx.fillStyle = '#ff3366';
    rCtx.shadowColor = '#ff3366';
    rCtx.shadowBlur = 10;
    rCtx.beginPath();
    rCtx.arc(opX, opY, 5, 0, Math.PI * 2);
    rCtx.fill();
    rCtx.shadowBlur = 0;

    // Value tag
    rCtx.fillStyle = '#ffffff';
    rCtx.font = 'bold 11px var(--font-mono)';
    rCtx.textAlign = opX > width - 100 ? 'right' : 'left';
    rCtx.fillText(`${currentSPL.toFixed(1)} dB SPL @ ${Math.round(state.frequency)} Hz`, opX + (opX > width - 100 ? -10 : 10), opY - 8);

    currentOpFreq.textContent = `Operating Point: ${Math.round(state.frequency)} Hz (${currentSPL.toFixed(1)} dB)`;
  }

  // Allow user to click directly on the Bode plot to change frequency
  responseCanvas.addEventListener('mousedown', (e) => {
    const rect = responseCanvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const paddingLeft = 50;
    const paddingRight = 30;
    const plotW = rect.width - paddingLeft - paddingRight;

    if (clickX >= paddingLeft && clickX <= rect.width - paddingRight) {
      const frac = (clickX - paddingLeft) / plotW;
      const minF = 20;
      const maxF = 20000;
      const logF = Math.log10(minF) + frac * (Math.log10(maxF) - Math.log10(minF));
      const targetFreq = Math.round(Math.pow(10, logF));
      setFrequency(targetFreq);
    }
  });

  // --- Main Animation Loop ---
  let lastTimestamp = 0;

  function animate(timestamp) {
    if (!lastTimestamp) lastTimestamp = timestamp;
    const dt = (timestamp - lastTimestamp) / 1000;
    lastTimestamp = timestamp;

    if (!state.isPaused) {
      // Frequency sweep handling
      if (state.waveform === 'sweep') {
        state.frequency += state.sweepDirection * state.frequency * 0.4 * dt;
        if (state.frequency >= 18000) {
          state.frequency = 18000;
          state.sweepDirection = -1;
        } else if (state.frequency <= 40) {
          state.frequency = 40;
          state.sweepDirection = 1;
        }
        updateFrequencyDisplay();
      }

      state.simTime += dt * state.speed;

      if (state.shockActive) {
        state.shockTimer += dt;
        if (state.shockTimer > 2.0) {
          state.shockActive = false;
          state.shockTimer = 0;
          shockBanner.classList.add('hidden');
        }
      }
    }

    // Render both viewports
    const dpr = window.devicePixelRatio || 1;
    drawTransducer(transducerCanvas.width / dpr, transducerCanvas.height / dpr);
    drawFrequencyResponse(responseCanvas.width / dpr, responseCanvas.height / dpr);

    requestAnimationFrame(animate);
  }

  // --- UI Event Handlers & Binding ---
  function setFrequency(f) {
    state.frequency = Math.max(20, Math.min(20000, f));
    freqSlider.value = state.frequency;
    updateFrequencyDisplay();
    updateAudio();
  }

  function updateFrequencyDisplay() {
    freqDisplay.textContent = state.frequency >= 1000 
      ? `${(state.frequency / 1000).toFixed(state.frequency >= 10000 ? 1 : 2)} kHz`
      : `${Math.round(state.frequency)} Hz`;
  }

  freqSlider.addEventListener('input', (e) => {
    setFrequency(Number(e.target.value));
    document.querySelectorAll('.freq-btn').forEach(btn => btn.classList.remove('active'));
  });

  document.querySelectorAll('.freq-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.freq-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setFrequency(Number(btn.dataset.freq));
    });
  });

  ampSlider.addEventListener('input', (e) => {
    state.amplitude = Number(e.target.value);
    ampDisplay.textContent = `${state.amplitude.toFixed(2)} mA`;
  });

  // Waveform selector
  document.querySelectorAll('#waveform-selector .pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#waveform-selector .pill-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.waveform = btn.dataset.wave;
    });
  });

  // View modes
  document.querySelectorAll('.view-tabs-bar .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-tabs-bar .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.viewMode = btn.dataset.view;
    });
  });

  // Armature Type Selector
  document.querySelectorAll('#armature-type-selector .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#armature-type-selector .seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.armatureType = btn.dataset.armature;

      if (state.armatureType === 'standard') {
        armatureExplanation.innerHTML = '<strong>Standard Sonion 26A01C</strong>: 0.16mm thickness, well-balanced compliance and flux capacity.';
      } else if (state.armatureType === 'wideband') {
        armatureExplanation.innerHTML = '<strong>Wideband Sonion 2600</strong>: 0.19mm thicker to increase stiffness, narrower to decrease mass. Extends high frequencies beyond 10kHz.';
      } else if (state.armatureType === 'highmass') {
        armatureExplanation.innerHTML = '<strong>High-Mass Armature</strong>: Heavy core increases magnetic flux carrying capacity for elevated bass output.';
      }
    });
  });

  // Knowles Ferrofluid Damping Selector (BA.pdf p.5-6)
  ferrofluidSelect.addEventListener('change', (e) => {
    state.ferrofluidDamping = Number(e.target.value);
    ferrofluidDisplay.textContent = state.ferrofluidDamping === 0 ? '0 dB (None)' : `${state.ferrofluidDamping} dB Damping`;
  });

  // Toggles
  housingVentToggle.addEventListener('change', (e) => {
    state.housingVented = e.target.checked;
  });

  diaphragmHolesToggle.addEventListener('change', (e) => {
    state.diaphragmLaserHoles = e.target.checked;
  });

  // Tubing Length (BA.pdf p.7)
  tubeLengthSlider.addEventListener('input', (e) => {
    state.tubeLength = Number(e.target.value);
    tubeLenDisplay.textContent = state.tubeLength === 0 ? '0 mm (Direct)' : `${state.tubeLength} mm`;
  });

  // Tubing Diameter (BA.pdf p.7)
  document.querySelectorAll('#tube-diameter-selector .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#tube-diameter-selector .seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.tubeDiameter = Number(btn.dataset.diameter);
    });
  });

  // Acoustic Damper Filter (Ohms) (BA.pdf p.7-8)
  filterSelect.addEventListener('change', (e) => {
    state.acousticFilter = Number(e.target.value);
    filterDisplay.textContent = state.acousticFilter === 0 ? 'Undamped' : `${state.acousticFilter} Ω`;
  });

  // Filter Position (Near vs Far)
  document.querySelectorAll('#filter-pos-selector .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#filter-pos-selector .seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.filterPosition = btn.dataset.pos;
    });
  });

  // Multi-Driver Architecture
  document.querySelectorAll('.driver-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.driver-preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.driverCount = Number(btn.dataset.drivers);

      if (state.driverCount === 1) {
        multidriverDesc.textContent = 'Single driver carries entire frequency spectrum. Limited sub-bass and drops off above 10 kHz.';
      } else if (state.driverCount === 2) {
        multidriverDesc.textContent = '2-Way Woofer + Tweeter: Dedicated bass driver lifts low frequencies with low distortion; Tweeter extends highs.';
      } else if (state.driverCount === 3) {
        multidriverDesc.textContent = '3-Way Super Woofer + Woofer + Tweeter: Extreme sub-bass extension (Sony XBA-4 style) with smooth flat midrange and pristine air.';
      }
    });
  });

  // Playback Controls
  playPauseBtn.addEventListener('click', () => {
    state.isPaused = !state.isPaused;
    playIcon.textContent = state.isPaused ? '▶' : '⏸';
  });

  stepForwardBtn.addEventListener('click', () => {
    state.simTime += 0.01;
  });

  simSpeedSelect.addEventListener('change', (e) => {
    state.speed = Number(e.target.value);
  });

  shockTestBtn.addEventListener('click', () => {
    state.shockActive = true;
    state.shockTimer = 0;
  });

  // Audio Controls
  audioToggleBtn.addEventListener('click', () => {
    initAudio();
    state.audioActive = !state.audioActive;
    if (state.audioActive) {
      audioToggleBtn.classList.add('active');
      audioBtnLabel.textContent = 'Sound ON';
    } else {
      audioToggleBtn.classList.remove('active');
      audioBtnLabel.textContent = 'Sound Off';
    }
    updateAudio();
  });

  audioVolumeSlider.addEventListener('input', (e) => {
    state.audioVolume = Number(e.target.value);
    updateAudio();
  });

  // Presets Menu Toggle
  presetsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    presetsMenu.classList.toggle('hidden');
  });

  window.addEventListener('click', (e) => {
    if (!presetsMenu.contains(e.target) && e.target !== presetsBtn) {
      presetsMenu.classList.add('hidden');
    }
  });

  // Presets Application
  document.querySelectorAll('#presets-menu .dropdown-item').forEach(item => {
    item.addEventListener('click', () => {
      const presetKey = item.dataset.preset;
      applyPreset(presetKey);
      presetsMenu.classList.add('hidden');
    });
  });

  function applyPreset(key) {
    if (key === 'standard') {
      state.viewMode = 'cutaway';
      state.armatureType = 'standard';
      state.ferrofluidDamping = 0;
      state.housingVented = false;
      state.diaphragmLaserHoles = false;
      state.tubeLength = 10;
      state.tubeDiameter = 1.35;
      state.acousticFilter = 0;
      state.driverCount = 1;
      setFrequency(1000);
    } else if (key === 'wideband') {
      state.viewMode = 'cutaway';
      state.armatureType = 'wideband';
      state.ferrofluidDamping = 3;
      state.housingVented = false;
      state.diaphragmLaserHoles = false;
      state.tubeLength = 10;
      state.tubeDiameter = 1.35;
      state.acousticFilter = 680;
      state.driverCount = 1;
      setFrequency(2800);
    } else if (key === 'highmass') {
      state.viewMode = 'cutaway';
      state.armatureType = 'highmass';
      state.ferrofluidDamping = 0;
      state.housingVented = true;
      state.diaphragmLaserHoles = false;
      state.tubeLength = 10;
      state.acousticFilter = 0;
      state.driverCount = 1;
      setFrequency(150);
    } else if (key === 'ferrofluid') {
      state.viewMode = 'cutaway';
      state.armatureType = 'standard';
      state.ferrofluidDamping = 8;
      state.housingVented = false;
      state.diaphragmLaserHoles = false;
      state.tubeLength = 10;
      state.acousticFilter = 0;
      state.driverCount = 1;
      setFrequency(2200);
    } else if (key === 'iem-acoustic') {
      state.viewMode = 'cutaway';
      state.armatureType = 'standard';
      state.ferrofluidDamping = 5;
      state.housingVented = true;
      state.diaphragmLaserHoles = true;
      state.tubeLength = 15;
      state.tubeDiameter = 1.35;
      state.acousticFilter = 1000;
      state.driverCount = 1;
      setFrequency(4200);
    } else if (key === 'vintage-radio') {
      state.viewMode = 'vintage';
      setFrequency(800);
    }

    // Sync all form elements with state
    syncUIWithState();
  }

  function syncUIWithState() {
    document.querySelectorAll('.view-tabs-bar .tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.view === state.viewMode);
    });
    document.querySelectorAll('#armature-type-selector .seg-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.armature === state.armatureType);
    });
    ferrofluidSelect.value = state.ferrofluidDamping;
    ferrofluidDisplay.textContent = state.ferrofluidDamping === 0 ? '0 dB (None)' : `${state.ferrofluidDamping} dB Damping`;
    housingVentToggle.checked = state.housingVented;
    diaphragmHolesToggle.checked = state.diaphragmLaserHoles;
    tubeLengthSlider.value = state.tubeLength;
    tubeLenDisplay.textContent = `${state.tubeLength} mm`;
    filterSelect.value = state.acousticFilter;
    filterDisplay.textContent = state.acousticFilter === 0 ? 'Undamped' : `${state.acousticFilter} Ω`;
    document.querySelectorAll('.driver-preset-btn').forEach(b => {
      b.classList.toggle('active', Number(b.dataset.drivers) === state.driverCount);
    });
    updateFrequencyDisplay();
  }

  // --- Interactive Canvas Component Inspector ---
  transducerCanvas.addEventListener('mousemove', (e) => {
    if (state.viewMode !== 'cutaway') {
      inspectorTooltip.classList.add('hidden');
      return;
    }

    const rect = transducerCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const dpr = window.devicePixelRatio || 1;
    const width = transducerCanvas.width / dpr;
    const height = transducerCanvas.height / dpr;
    const cx = width * 0.44;
    const cy = height * 0.52;
    const scale = Math.min(width / 750, height / 480);
    const caseW = 420 * scale;
    const caseH = 260 * scale;
    const caseX = cx - caseW * 0.52;
    const caseY = cy - caseH * 0.5;

    let hit = null;

    // Detect hovered component
    // 1. Coil
    if (mx >= caseX + 195 * scale && mx <= caseX + 255 * scale && my >= cy + 15 * scale && my <= cy + 70 * scale) {
      hit = 'coil';
    }
    // 2. Magnets
    else if (mx >= caseX + 75 * scale && mx <= caseX + 175 * scale && ((my >= cy - 25 * scale && my <= cy + 10 * scale) || (my >= cy + 65 * scale && my <= cy + 100 * scale))) {
      hit = 'magnets';
    }
    // 3. Ferrofluid
    else if (state.ferrofluidDamping > 0 && mx >= caseX + 105 * scale && mx <= caseX + 145 * scale && my >= cy + 10 * scale && my <= cy + 65 * scale) {
      hit = 'ferrofluid';
    }
    // 4. Armature
    else if (mx >= caseX + 45 * scale && mx <= caseX + 320 * scale && my >= cy - 30 * scale && my <= cy + 55 * scale) {
      hit = 'armature';
    }
    // 5. Drive Pin
    else if (mx >= caseX + 105 * scale && mx <= caseX + 125 * scale && my >= caseY + 50 * scale && my <= cy + 45 * scale) {
      hit = 'pin';
    }
    // 6. Diaphragm
    else if (mx >= caseX + 60 * scale && mx <= caseX + 350 * scale && my >= caseY + 45 * scale && my <= caseY + 70 * scale) {
      hit = 'diaphragm';
    }
    // 7. Nozzle & Tube
    else if (mx >= caseX + caseW - 10 * scale) {
      hit = state.acousticFilter > 0 ? 'damper' : 'nozzle';
    }
    // 8. Cavities
    else if (mx >= caseX && mx <= caseX + caseW && my >= caseY && my <= caseY + caseH) {
      hit = 'cavities';
    }

    if (hit) {
      const comp = componentsList.find(c => c.id === hit);
      if (comp) {
        document.getElementById('tooltip-number').textContent = comp.num;
        document.getElementById('tooltip-title').textContent = comp.name;
        document.getElementById('tooltip-desc').textContent = comp.desc;
        document.getElementById('tooltip-citation').textContent = comp.citation;

        inspectorTooltip.style.left = `${e.clientX - rect.left}px`;
        inspectorTooltip.style.top = `${e.clientY - rect.top - 15}px`;
        inspectorTooltip.classList.remove('hidden');
        return;
      }
    }

    inspectorTooltip.classList.add('hidden');
  });

  transducerCanvas.addEventListener('mouseleave', () => {
    inspectorTooltip.classList.add('hidden');
  });

  // --- Guided Educational Tour ---
  const tourSteps = [
    {
      title: '1. The Balanced Armature Principle',
      content: `
        <p>A balanced armature driver differs fundamentally from a traditional dynamic driver. Instead of a voice coil attached directly to a cone, it uses an <strong>electromagnetically balanced motor</strong>.</p>
        <h4>The Unstable Balance</h4>
        <p>A permeable U-shaped armature is poised directly between two permanent magnet poles. In rest position, the upward and downward magnetic pulls cancel each other out. This unstable balance makes the armature <strong>extremely quick and responsive</strong>, yielding unmatched efficiency from minuscule electrical signals.</p>
      `,
      action: () => { applyPreset('standard'); }
    },
    {
      title: '2. Cantilever "Diving Board" Mechanics',
      content: `
        <p>In historical 1920s earphones, armatures pivoted on a central see-saw knife edge. Modern BA receivers use a <strong>U-shaped cantilever</strong> where the top leg is fixed and the bottom leg flexes up and down like a diving board.</p>
        <h4>Drive Pin & Diaphragm</h4>
        <p>A tiny vertical <strong>drive pin (3)</strong> transfers deflection from the vibrating armature tip to a stiff metal <strong>diaphragm (4)</strong>. A compliant perimeter membrane seals the front and rear acoustic cavities.</p>
      `,
      action: () => { state.viewMode = 'cutaway'; syncUIWithState(); setFrequency(1000); }
    },
    {
      title: '3. Dual Resonance Peaks (BA.pdf p.3)',
      content: `
        <p>Because balanced armature drivers operate on an unstable magnetic spring, they produce strong resonant behavior characterized by <strong>two distinct peaks</strong>:</p>
        <ul>
          <li><strong>1st Peak (~2.2 kHz):</strong> Mechanical resonance of the armature mass and stiffness combined with rear back volume air stiffness.</li>
          <li><strong>2nd Peak (~5.5 kHz):</strong> Acoustic resonance of the diaphragm, front air volume, and sound tube.</li>
        </ul>
      `,
      action: () => { setFrequency(2200); }
    },
    {
      title: '4. Knowles Ferrofluid Damping (BA.pdf p.5-6)',
      content: `
        <p>BA armatures are delicate; mechanical shocks from dropping an earphone can permanently bend the armature past its elastic limit.</p>
        <h4>Magnetic Liquid Cushion</h4>
        <p>Knowles introduced <strong>Ferrofluid (FED)</strong>: droplets of magnetic liquid held in place by the magnet poles. The fluid damps the sharp resonant spikes by <strong>3 dB to 10 dB</strong> and provides fluid shock absorption without reducing overall sensitivity!</p>
      `,
      action: () => { applyPreset('ferrofluid'); }
    },
    {
      title: '5. External IEM Tubing & Acoustic Dampers',
      content: `
        <p>When IEM manufacturers package a BA receiver into an earphone, external tuning methods sculpt the sound:</p>
        <ul>
          <li><strong>Tube Length:</strong> Longer tubing shifts the 2nd resonance peak downwards in frequency.</li>
          <li><strong>Tube Diameter:</strong> Wider tubing creates a narrower, peakier treble spike.</li>
          <li><strong>Acoustic Ohms Dampers:</strong> Resistive mesh plugs (320Ω to 2200Ω) smooth out harshness between 1 kHz and 8 kHz.</li>
        </ul>
      `,
      action: () => { applyPreset('iem-acoustic'); }
    }
  ];

  let currentTourStep = 0;

  function showTourStep(idx) {
    currentTourStep = Math.max(0, Math.min(tourSteps.length - 1, idx));
    const step = tourSteps[currentTourStep];

    tourStepNum.textContent = currentTourStep + 1;
    tourTitle.textContent = step.title;
    tourContent.innerHTML = step.content;

    // Dots
    tourDots.innerHTML = '';
    tourSteps.forEach((_, i) => {
      const dot = document.createElement('div');
      dot.className = `tour-dot ${i === currentTourStep ? 'active' : ''}`;
      tourDots.appendChild(dot);
    });

    prevTourBtn.disabled = currentTourStep === 0;
    nextTourBtn.textContent = currentTourStep === tourSteps.length - 1 ? 'Finish' : 'Next';

    if (step.action) step.action();
  }

  tourBtn.addEventListener('click', () => {
    tourModal.classList.remove('hidden');
    showTourStep(0);
  });

  closeTourBtn.addEventListener('click', () => {
    tourModal.classList.add('hidden');
  });

  prevTourBtn.addEventListener('click', () => {
    if (currentTourStep > 0) showTourStep(currentTourStep - 1);
  });

  nextTourBtn.addEventListener('click', () => {
    if (currentTourStep < tourSteps.length - 1) {
      showTourStep(currentTourStep + 1);
    } else {
      tourModal.classList.add('hidden');
    }
  });


  // ====================================================================
  // KIM & ALLEN (2013) ADVANCED PHYSICS ENGINE
  // Reference: "Two-port network analysis and modeling of a balanced
  //   armature receiver", Hearing Research 301 (2013) pp. 156–167.
  //
  // Architecture:
  //   LINEAR PATH  : ABCD matrix cascade → Z_in(f), Z_out, Transfer H(f)
  //   NONLINEAR PATH: RK4 ODE solver with Bl(x), k(x) → THD(%)
  // ====================================================================

  // ── Kim & Allen Physics State ─────────────────────────────────────────
  const kaState = {
    // Electrical domain
    Re:    22.0,       // Coil DC resistance [Ω]
    Le:    0.13e-3,    // Coil inductance [H]
    Re2:   10.0,       // Eddy-current semi-inductor resistance [Ω]
    Le2:   0.050e-3,   // Eddy-current semi-inductor inductance [H]
    // Coupling
    Bl:    0.36,       // Force factor [T·m]
    // Mechanical domain
    m_eff: 1.8e-6,     // Effective moving mass [kg]  → f_res ≈ 2199 Hz
    Rm:    6.5e-3,     // Mechanical damping [N·s/m]   → Q ≈ 3.73
    Km:    343.0,      // Linear stiffness [N/m]
    // Nonlinear THD coefficients
    k2:    0.0,        // 2nd-order asymmetric stiffness [N/m²] (0 = symmetric)
    k3:    8.0e11,     // 3rd-order stiffness hardening [N/m³]
    kBl:   1.0e10,     // Bl displacement curvature [/m²]
    // Acoustic geometry
    Ad:    5.0e-6,     // Diaphragm effective area [m²]
    Vf:    50.0e-9,    // Front cavity volume [m³]
    Vr:    30.0e-9,    // Rear cavity volume [m³]
  };

  // ── Complex Number Utilities ──────────────────────────────────────────
  // Represent complex numbers as [real, imag] 2-element arrays.
  const C = {
    add:  (a, b)  => [a[0]+b[0], a[1]+b[1]],
    sub:  (a, b)  => [a[0]-b[0], a[1]-b[1]],
    mul:  (a, b)  => [a[0]*b[0] - a[1]*b[1],  a[0]*b[1] + a[1]*b[0]],
    div:  (a, b)  => {
      const d = b[0]*b[0] + b[1]*b[1];
      if (d < 1e-290) return [0, 0];
      return [(a[0]*b[0] + a[1]*b[1])/d, (a[1]*b[0] - a[0]*b[1])/d];
    },
    abs:  (a)     => Math.sqrt(a[0]*a[0] + a[1]*a[1]),
    arg:  (a)     => Math.atan2(a[1], a[0]) * 180 / Math.PI,
    R:    (r)     => [r, 0],         // scalar real → complex
    jX:   (x)     => [0, x],         // scalar imaginary → complex
    neg:  (a)     => [-a[0], -a[1]],
    sqrtC:(a)     => {               // complex square root
      const r = Math.sqrt(C.abs(a));
      const theta = Math.atan2(a[1], a[0]) / 2;
      return [r*Math.cos(theta), r*Math.sin(theta)];
    },
  };

  // 2×2 complex matrix multiply: returns A ⊗ B
  function matMul2x2(A, B) {
    return [
      [ C.add(C.mul(A[0][0], B[0][0]), C.mul(A[0][1], B[1][0])),
        C.add(C.mul(A[0][0], B[0][1]), C.mul(A[0][1], B[1][1])) ],
      [ C.add(C.mul(A[1][0], B[0][0]), C.mul(A[1][1], B[1][0])),
        C.add(C.mul(A[1][0], B[0][1]), C.mul(A[1][1], B[1][1])) ],
    ];
  }

  // ── Two-Port ABCD Matrix Cascade (Kim & Allen 2013) ───────────────────
  //
  // Chain: T_e ⊗ T_gyrator ⊗ T_mech ⊗ T_area ⊗ T_acoustic
  //
  // Domains:
  //   T_e       : electrical  (V, I)    [Ω]
  //   T_gyrator : coupling    (V→F/v→I) anti-reciprocal, GYRATOR not transformer
  //   T_mech    : mechanical  (F, v)    [N·s/m]
  //   T_area    : area xfmr   mech→acoustic (P=F/Ad, U=v·Ad)
  //   T_acoustic: acoustic    (P, U)    [Pa·s/m³]
  //
  function computeSystemResponse(f, kap) {
    const ONE  = C.R(1),  ZERO = C.R(0);
    const rho  = 1.21,    c_s  = 343.0;  // air density & speed of sound
    const omega = 2 * Math.PI * Math.max(f, 0.01);
    const jw    = C.jX(omega);

    // ── 1. Electrical Stage ────────────────────────────────────────────
    // Semi-inductor models eddy current skin effect in armature core:
    // Z_si = Re2 · √(jω/ω_eddy)  = Re2·√(ξ) · (1+j)/√2
    // where ξ = ω/ω_eddy,  ω_eddy = Re2/Le2
    const omega_eddy = kap.Re2 / kap.Le2;
    const xi = omega / omega_eddy;
    const sqXi = Math.sqrt(Math.max(0, xi)) / Math.SQRT2;
    const Z_si = [kap.Re2 * sqXi, kap.Re2 * sqXi];   // semi-inductor

    // Ze = Re + jω·Le + Z_si   (total electrical impedance)
    const Ze = C.add(C.add(C.R(kap.Re), C.mul(jw, C.R(kap.Le))), Z_si);

    // T_e = [[1, Ze], [0, 1]]  (series impedance ABCD)
    const T_e = [[ONE, Ze], [ZERO, ONE]];

    // ── 2. Gyrator (EM Coupling) ───────────────────────────────────────
    // Anti-reciprocal transducer:  V_back = Bl·v,  F = Bl·I
    // ABCD: [[0, Bl], [1/Bl, 0]]
    // This is a GYRATOR (not transformer) — key Kim & Allen (2013) insight.
    // A transformer ABCD would be [[n,0],[0,1/n]], producing no impedance peak.
    // The gyrator correctly predicts the Z_in rise at mechanical resonance.
    const Bl_c  = C.R(kap.Bl);
    const T_gyr = [[ZERO, Bl_c], [C.div(ONE, Bl_c), ZERO]];

    // ── 3. Mechanical Stage ────────────────────────────────────────────
    // Zm = Rm + jω·m - jKm/ω   (mass + damping + stiffness)
    const Zm_re = kap.Rm;
    const Zm_im = omega * kap.m_eff - kap.Km / omega;
    const Zm    = [Zm_re, Zm_im];

    // T_m = [[1, Zm], [0, 1]]
    const T_m = [[ONE, Zm], [ZERO, ONE]];

    // ── 4. Area Transformer (mechanical ↔ acoustic) ────────────────────
    // P = F/Ad,  U = v·Ad
    // T_area = [[1/Ad, 0], [0, Ad]]
    const Ad_c    = C.R(kap.Ad);
    const T_area  = [[C.div(ONE, Ad_c), ZERO], [ZERO, Ad_c]];

    // ── 5. Acoustic Stage (front volume + nozzle) ─────────────────────
    // Acoustic compliance of front volume: Ca_f = Vf/(ρ·c²)
    const Ca_f  = kap.Vf / (rho * c_s * c_s);
    const Za_f  = C.div(ONE, C.mul(jw, C.R(Ca_f)));  // 1/(jω·Ca_f)

    // Nozzle parameters from active state (user-tuned in existing UI)
    const L_nz  = Math.max(1e-3, state.tubeLength  * 1e-3);   // [m]
    const r_nz  = (state.tubeDiameter / 2) * 1e-3;            // [m]
    const A_nz  = Math.PI * r_nz * r_nz;
    const Ma_nz = rho * L_nz / A_nz;                          // acoustic mass
    const Ra_nz = state.acousticFilter;                        // acoustic resistance
    const Za_nz = C.add(C.mul(jw, C.R(Ma_nz)), C.R(Ra_nz));  // jω·Ma + Ra

    const Za_tot = C.add(Za_f, Za_nz);
    // T_a = [[1, Za_tot], [0, 1]]
    const T_a = [[ONE, Za_tot], [ZERO, ONE]];

    // ── Cascade: T = T_e ⊗ T_gyr ⊗ T_m ⊗ T_area ⊗ T_a ─────────────
    const T = matMul2x2(T_e,
              matMul2x2(T_gyr,
              matMul2x2(T_m,
              matMul2x2(T_area, T_a))));

    const A_t = T[0][0], B_t = T[0][1];
    const C_t = T[1][0], D_t = T[1][1];

    // ── Acoustic Load (IEC 711 2cc coupler approximation) ─────────────
    // Ca_2cc ≈ 1.42e-11 m³/Pa,  Ra_2cc ≈ 5e5 Pa·s/m³
    const Ca_2cc = 1.42e-11;
    const Ra_2cc = 5e5;
    const Za_load = C.add(C.R(Ra_2cc), C.div(ONE, C.mul(jw, C.R(Ca_2cc))));

    // ── Derived Quantities ────────────────────────────────────────────
    // Input impedance: Z_in = (A·ZL + B) / (C·ZL + D)
    const Zin  = C.div(C.add(C.mul(A_t, Za_load), B_t),
                        C.add(C.mul(C_t, Za_load), D_t));

    // Acoustic output impedance (looking back into nozzle, Zs=0): Z_out = B/D
    const Zout = C.div(B_t, D_t);

    // Pressure transfer function: H = P_out/V_in = 1/(C·ZL + D)
    const H    = C.div(ONE, C.add(C.mul(C_t, Za_load), D_t));

    return {
      Zin_mag:  C.abs(Zin),
      Zin_arg:  C.arg(Zin),
      Zout_mag: C.abs(Zout),
      H_dB:     20 * Math.log10(Math.max(1e-20, C.abs(H))),
    };
  }

  // ── Impedance Canvas Setup ────────────────────────────────────────────
  const impedanceCanvas = document.getElementById('impedance-canvas');
  const iCtx = impedanceCanvas ? impedanceCanvas.getContext('2d') : null;

  function resizeImpedanceCanvas() {
    if (!impedanceCanvas || !iCtx) return;
    const dpr  = window.devicePixelRatio || 1;
    const rect = impedanceCanvas.parentElement.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    impedanceCanvas.width  = Math.floor(rect.width  * dpr);
    impedanceCanvas.height = Math.floor(rect.height * dpr);
    iCtx.setTransform(1, 0, 0, 1, 0, 0);
    iCtx.scale(dpr, dpr);
    const w = impedanceCanvas.width / dpr;
    const h = impedanceCanvas.height / dpr;
    drawImpedanceResponse(w, h);
  }

  // ── Impedance Chart Renderer ──────────────────────────────────────────
  function drawImpedanceResponse(width, height) {
    if (!iCtx || width < 10 || height < 10) return;
    iCtx.clearRect(0, 0, width, height);

    const PAD = { top: 30, right: 48, bottom: 40, left: 58 };
    const pw  = width  - PAD.left - PAD.right;
    const ph  = height - PAD.top  - PAD.bottom;

    const minF = 20, maxF = 20000;
    const logMin = Math.log10(minF), logMax = Math.log10(maxF);
    const minZ = 0, maxZ = 100;    // Ω axis
    const minPh = -90, maxPh = 90; // phase axis [°]

    const xF  = f  => PAD.left + ((Math.log10(Math.max(minF, f)) - logMin) / (logMax - logMin)) * pw;
    const yZ  = z  => PAD.top  + (1 - (Math.min(maxZ, Math.max(minZ, z)) - minZ) / (maxZ - minZ)) * ph;
    const yPh = ph_deg => PAD.top + (1 - (Math.max(minPh, Math.min(maxPh, ph_deg)) - minPh) / (maxPh - minPh)) * ph;

    // ── Background ────────────────────────────────────────────────────
    iCtx.fillStyle = 'rgba(7,9,14,0.8)';
    iCtx.fillRect(0, 0, width, height);

    // ── Frequency grid lines + labels ─────────────────────────────────
    const fTicks = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    iCtx.strokeStyle = 'rgba(255,255,255,0.055)';
    iCtx.lineWidth = 1;
    iCtx.fillStyle = '#475569';
    iCtx.font = '9.5px var(--font-mono)';
    iCtx.textAlign = 'center';
    fTicks.forEach(f => {
      const x = xF(f);
      iCtx.beginPath(); iCtx.moveTo(x, PAD.top); iCtx.lineTo(x, PAD.top + ph); iCtx.stroke();
      iCtx.fillStyle = '#475569';
      iCtx.fillText(f >= 1000 ? `${f/1000}k` : `${f}`, x, PAD.top + ph + 14);
    });

    // ── Impedance grid lines + left labels ───────────────────────────
    const zTicks = [0, 20, 40, 60, 80, 100];
    iCtx.textAlign = 'right';
    zTicks.forEach(z => {
      const y = yZ(z);
      iCtx.strokeStyle = z === 0 ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.055)';
      iCtx.beginPath(); iCtx.moveTo(PAD.left, y); iCtx.lineTo(PAD.left + pw, y); iCtx.stroke();
      iCtx.fillStyle = '#475569';
      iCtx.fillText(`${z}Ω`, PAD.left - 6, y + 3.5);
    });

    // ── Right axis: phase tick labels ─────────────────────────────────
    const phTicks = [-90, -45, 0, 45, 90];
    iCtx.textAlign = 'left';
    phTicks.forEach(deg => {
      const y = yPh(deg);
      if (deg === 0) {
        iCtx.strokeStyle = 'rgba(0,210,255,0.15)';
        iCtx.setLineDash([4, 4]);
        iCtx.beginPath(); iCtx.moveTo(PAD.left, y); iCtx.lineTo(PAD.left + pw, y); iCtx.stroke();
        iCtx.setLineDash([]);
      }
      iCtx.fillStyle = 'rgba(0,210,255,0.55)';
      iCtx.fillText(`${deg}°`, PAD.left + pw + 5, y + 3.5);
    });

    // ── Axis labels ───────────────────────────────────────────────────
    iCtx.fillStyle = '#64748b';
    iCtx.font = '10px var(--font-mono)';
    iCtx.textAlign = 'center';
    iCtx.fillText('Frequency  [Hz]', PAD.left + pw / 2, height - 2);
    iCtx.save();
    iCtx.translate(13, PAD.top + ph / 2);
    iCtx.rotate(-Math.PI / 2);
    iCtx.fillStyle = '#f59e0b';
    iCtx.fillText('|Z_in(f)|  [Ω]', 0, 0);
    iCtx.restore();
    iCtx.save();
    iCtx.translate(width - 6, PAD.top + ph / 2);
    iCtx.rotate(Math.PI / 2);
    iCtx.fillStyle = 'rgba(0,210,255,0.65)';
    iCtx.font = '10px var(--font-mono)';
    iCtx.textAlign = 'center';
    iCtx.fillText('∠Z_in(f)  [°]', 0, 0);
    iCtx.restore();

    // ── Compute curves (300 log-spaced frequency points) ──────────────
    const N_pts  = 300;
    const points = [];
    for (let i = 0; i <= N_pts; i++) {
      const f    = Math.pow(10, logMin + (i / N_pts) * (logMax - logMin));
      const resp = computeSystemResponse(f, kaState);
      points.push({ f, z: resp.Zin_mag, arg: resp.Zin_arg });
    }

    // ── Phase curve (dashed, teal) ─────────────────────────────────────
    iCtx.save();
    iCtx.setLineDash([3, 5]);
    iCtx.strokeStyle = 'rgba(0, 210, 255, 0.5)';
    iCtx.lineWidth = 1.5;
    iCtx.shadowColor = 'rgba(0, 210, 255, 0.2)';
    iCtx.shadowBlur = 4;
    iCtx.beginPath();
    points.forEach(({ f, arg }, idx) => {
      const x = xF(f), y = yPh(arg);
      idx === 0 ? iCtx.moveTo(x, y) : iCtx.lineTo(x, y);
    });
    iCtx.stroke();
    iCtx.setLineDash([]);
    iCtx.restore();

    // ── Magnitude curve (solid, amber, glowing) ────────────────────────
    iCtx.strokeStyle = '#f59e0b';
    iCtx.lineWidth = 2.5;
    iCtx.shadowColor = 'rgba(245, 158, 11, 0.45)';
    iCtx.shadowBlur = 8;
    iCtx.beginPath();
    points.forEach(({ f, z }, idx) => {
      const x = xF(f), y = yZ(z);
      idx === 0 ? iCtx.moveTo(x, y) : iCtx.lineTo(x, y);
    });
    iCtx.stroke();
    iCtx.shadowBlur = 0;

    // ── Operating-point marker (red dot + vertical line) ──────────────
    const opF    = state.frequency;
    const opResp = computeSystemResponse(opF, kaState);
    const opZ    = Math.min(maxZ, opResp.Zin_mag);
    const opX    = xF(opF), opY = yZ(opZ);

    iCtx.strokeStyle = 'rgba(255, 51, 102, 0.35)';
    iCtx.lineWidth = 1;
    iCtx.setLineDash([4, 4]);
    iCtx.beginPath(); iCtx.moveTo(opX, PAD.top); iCtx.lineTo(opX, PAD.top + ph); iCtx.stroke();
    iCtx.setLineDash([]);

    iCtx.fillStyle = '#ff3366';
    iCtx.shadowColor = '#ff3366'; iCtx.shadowBlur = 10;
    iCtx.beginPath(); iCtx.arc(opX, opY, 4.5, 0, Math.PI * 2); iCtx.fill();
    iCtx.shadowBlur = 0;

    // Label at operating point
    const labelRight = opX > width * 0.72;
    iCtx.fillStyle = '#fff';
    iCtx.font = 'bold 10px var(--font-mono)';
    iCtx.textAlign = labelRight ? 'right' : 'left';
    iCtx.fillText(
      `${opZ.toFixed(1)} Ω  @  ${Math.round(opF)} Hz`,
      opX + (labelRight ? -9 : 9), opY - 9
    );

    // ── Legend ─────────────────────────────────────────────────────────
    iCtx.textAlign = 'left';
    iCtx.font = '11.5px var(--font-mono)';
    iCtx.strokeStyle = '#f59e0b'; iCtx.lineWidth = 2.5;
    iCtx.beginPath(); iCtx.moveTo(PAD.left + 5, PAD.top + 6); iCtx.lineTo(PAD.left + 24, PAD.top + 6); iCtx.stroke();
    iCtx.fillStyle = '#94a3b8';
    iCtx.fillText('|Z_in(f)|  magnitude [Ω]', PAD.left + 28, PAD.top + 9);

    iCtx.save();
    iCtx.setLineDash([3, 5]);
    iCtx.strokeStyle = 'rgba(0,210,255,0.6)'; iCtx.lineWidth = 1.5;
    iCtx.beginPath(); iCtx.moveTo(PAD.left + 5, PAD.top + 20); iCtx.lineTo(PAD.left + 24, PAD.top + 20); iCtx.stroke();
    iCtx.setLineDash([]);
    iCtx.restore();
    iCtx.fillStyle = '#94a3b8';
    iCtx.fillText('∠Z_in(f)  phase [°]', PAD.left + 28, PAD.top + 23);

    // ── Live computed panel update ─────────────────────────────────────
    _updateKAComputedDisplay(opResp);
  }

  function _updateKAComputedDisplay(resp) {
    const fres  = (1 / (2 * Math.PI)) * Math.sqrt(kaState.Km / kaState.m_eff);
    const Q     = Math.sqrt(kaState.Km * kaState.m_eff) / kaState.Rm;
    const Zpeak = kaState.Re + (kaState.Bl * kaState.Bl) / kaState.Rm;

    const safe = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    safe('ka-fres-display', `${Math.round(fres)} Hz`);
    safe('ka-q-display',    Q.toFixed(2));
    safe('ka-zdc-display',  `${kaState.Re.toFixed(0)} Ω`);
    safe('ka-zpeak-display', `~${Math.round(Zpeak)} Ω`);
  }

  // ====================================================================
  // NONLINEAR RK4 TIME-DOMAIN SOLVER — Total Harmonic Distortion (THD)
  // ====================================================================
  //
  // Model: constant-current drive  i(t) = I_amp · sin(ωt)
  //   This matches hearing aid amplifier topology (current source).
  //
  // State vector: sv = [x, v]   (displacement [m], velocity [m/s])
  //
  // ODE system:
  //   dx/dt = v
  //   dv/dt = [Bl(x)·I·sin(ωt) − Rm·v − k(x)·x] / m_eff
  //
  // Nonlinear functions (Kim & Allen eq. 10-12):
  //   Bl(x) = Bl₀ / (1 + kBl·x²)          symmetric → odd harmonics
  //   k(x)  = Km + k₂·x + k₃·x²           k₃ term → odd harmonics
  //
  // THD is extracted via DFT on steady-state displacement signal.
  // ====================================================================

  function _Bl_of_x(x, kap) {
    return kap.Bl / (1.0 + kap.kBl * x * x);
  }

  function _k_of_x(x, kap) {
    return kap.Km + kap.k2 * x + kap.k3 * x * x;
  }

  // ODE right-hand side (2-state: [x, v])
  function _baOdes(sv, I_t, kap) {
    const [x, v] = sv;
    const Bl_x = _Bl_of_x(x, kap);
    const km_x = _k_of_x(x, kap);
    const dxdt = v;
    const dvdt = (Bl_x * I_t - kap.Rm * v - km_x * x) / kap.m_eff;
    return [dxdt, dvdt];
  }

  // RK4 step — current I at t is provided (input at each sub-step)
  function _rk4Step(sv, t, dt, I_amp, omega, kap) {
    const It  = tt => I_amp * Math.sin(omega * tt);
    const k1  = _baOdes(sv,                                        It(t),            kap);
    const k2  = _baOdes(sv.map((s, j) => s + 0.5*dt*k1[j]),      It(t + 0.5*dt),   kap);
    const k3  = _baOdes(sv.map((s, j) => s + 0.5*dt*k2[j]),      It(t + 0.5*dt),   kap);
    const k4  = _baOdes(sv.map((s, j) => s + dt*k3[j]),           It(t + dt),       kap);
    return sv.map((s, j) => s + (dt/6) * (k1[j] + 2*k2[j] + 2*k3[j] + k4[j]));
  }

  // Run full THD simulation for given drive current (mA) and test frequency
  function _runTHDAnalysis(freq, amp_mA, kap) {
    const I_amp = amp_mA * 1e-3;               // [A] current amplitude
    const omega = 2 * Math.PI * freq;
    const SPP   = 200;                          // samples per period (>20× Nyquist for H10)
    const N_warm = 15, N_anal = 10;             // warmup periods, analysis periods
    const dt    = 1.0 / (freq * SPP);
    const N_tot = (N_warm + N_anal) * SPP;
    const N_st  = N_warm * SPP;
    const buf   = new Float64Array(N_anal * SPP);

    let sv = [0, 0];  // [x=0, v=0]

    for (let n = 0; n < N_tot; n++) {
      const t = n * dt;
      sv = _rk4Step(sv, t, dt, I_amp, omega, kap);
      // Clamp to ±15 µm (physical bumper stops) to prevent divergence
      if (Math.abs(sv[0]) > 15e-6) {
        sv[0] = Math.sign(sv[0]) * 15e-6;
        sv[1] *= -0.3; // inelastic bounce
      }
      if (n >= N_st) {
        // Record acoustic pressure ∝ displacement  (quasi-static front volume)
        const rho = 1.21, c_s = 343.0;
        const Ca_f = kap.Vf / (rho * c_s * c_s);
        buf[n - N_st] = sv[0] * kap.Ad / Ca_f;   // [Pa]
      }
    }

    return _extractTHD(buf, freq, freq * SPP, 10);
  }

  // Extract harmonics H1–H10 via direct DFT, compute THD%
  function _extractTHD(signal, f0, fs, numH) {
    const N = signal.length;
    const amps = [];

    for (let h = 1; h <= numH; h++) {
      const fh = h * f0;
      let re = 0, im = 0;
      const dphi = 2 * Math.PI * fh / fs;
      for (let n = 0; n < N; n++) {
        re += signal[n] * Math.cos(dphi * n);
        im -= signal[n] * Math.sin(dphi * n);
      }
      amps.push(2 * Math.sqrt(re*re + im*im) / N);
    }

    const A1 = amps[0];
    let sumSq = 0;
    for (let h = 1; h < amps.length; h++) sumSq += amps[h] * amps[h];
    const thd = A1 > 1e-30 ? Math.sqrt(sumSq) / A1 * 100 : 0;
    const dBr = amps.map(a => A1 > 1e-30 ? 20 * Math.log10(Math.max(1e-20, a / A1)) : -120);

    return { thd, amps, dBr };
  }

  // ── THD Canvas Setup ──────────────────────────────────────────────────
  const thdCanvas = document.getElementById('thd-canvas');
  const thdCtx    = thdCanvas ? thdCanvas.getContext('2d') : null;
  let   _thdData  = null;    // last computed THD result
  let   _thdBusy  = false;

  function resizeTHDCanvas() {
    if (!thdCanvas || !thdCtx) return;
    const dpr  = window.devicePixelRatio || 1;
    const rect = thdCanvas.parentElement.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    thdCanvas.width  = Math.floor(rect.width  * dpr);
    thdCanvas.height = Math.floor(rect.height * dpr);
    thdCtx.setTransform(1, 0, 0, 1, 0, 0);
    thdCtx.scale(dpr, dpr);
    const w = thdCanvas.width / dpr, h = thdCanvas.height / dpr;
    drawTHDChart(w, h);
  }

  // ── THD Chart Renderer ────────────────────────────────────────────────
  function drawTHDChart(width, height) {
    if (!thdCtx || width < 10 || height < 10) return;
    thdCtx.clearRect(0, 0, width, height);

    if (!_thdData) {
      try {
        const driveSel = document.getElementById('thd-drive-select');
        const freqSel  = document.getElementById('thd-freq-select');
        const amp  = parseFloat(driveSel ? driveSel.value : 1.5) || 1.5;
        const freq = parseFloat(freqSel  ? freqSel.value  : 1000) || 1000;
        _thdData = _runTHDAnalysis(freq, amp, kaState);
        const badge  = document.getElementById('thd-badge');
        if (badge && _thdData) {
          badge.classList.remove('hidden');
          const thd = _thdData.thd;
          const col = thd < 1 ? '#10b981' : thd < 5 ? '#f59e0b' : '#ef4444';
          badge.textContent = `THD = ${thd.toFixed(2)} %`;
          badge.style.color = col;
          badge.style.borderColor = col;
        }
      } catch (e) {
        console.warn('Auto THD compute:', e);
      }
    }

    if (!_thdData) {
      thdCtx.fillStyle = 'rgba(7,9,14,0.85)';
      thdCtx.fillRect(0, 0, width, height);
      thdCtx.fillStyle = '#334155';
      thdCtx.font = '13px var(--font-body)';
      thdCtx.textAlign = 'center';
      thdCtx.fillText('Click "Run THD Analysis" to compute harmonic distortion', width/2, height/2 - 10);
      thdCtx.fillStyle = '#1e293b';
      thdCtx.font = '10px var(--font-mono)';
      thdCtx.fillText('RK4 nonlinear ODE solver  •  Bl(x) & k(x) polynomials  •  DFT harmonic extraction', width/2, height/2 + 12);
      return;
    }

    const { thd, dBr } = _thdData;
    const numH = dBr.length;

    const PAD = { top: 44, right: 24, bottom: 58, left: 60 };
    const pw  = width  - PAD.left - PAD.right;
    const ph  = height - PAD.top  - PAD.bottom;
    const minDB = -80, maxDB = 0;

    const yDB  = db => PAD.top + (1 - (db - minDB) / (maxDB - minDB)) * ph;
    const barW = (pw / numH) * 0.72;
    const bSpc = pw / numH;

    // Background
    thdCtx.fillStyle = 'rgba(7,9,14,0.92)';
    thdCtx.fillRect(0, 0, width, height);

    // dB grid
    const dbTicks = [-80, -60, -40, -20, 0];
    thdCtx.textAlign = 'right';
    thdCtx.font = '9px var(--font-mono)';
    dbTicks.forEach(db => {
      const y = yDB(db);
      thdCtx.strokeStyle = db === 0 ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.055)';
      thdCtx.lineWidth = 1;
      thdCtx.beginPath(); thdCtx.moveTo(PAD.left, y); thdCtx.lineTo(PAD.left + pw, y); thdCtx.stroke();
      thdCtx.fillStyle = '#475569';
      thdCtx.fillText(`${db} dB`, PAD.left - 5, y + 3.5);
    });

    // Harmonic bar colors (H1=cyan, H2=amber, H3-H10=gradient)
    const H_COLORS = [
      '#00d2ff', '#f59e0b', '#f97316', '#ef4444',
      '#ec4899', '#a855f7', '#3b82f6', '#10b981', '#84cc16', '#06b6d4'
    ];
    const H_LABELS = ['H1\n(Fund)', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'H9', 'H10'];

    dBr.forEach((db, idx) => {
      const bx   = PAD.left + idx * bSpc + (bSpc - barW) / 2;
      const clDB = Math.max(minDB, Math.min(0, db));
      const bTop = yDB(clDB);
      const bH   = Math.max(1, yDB(minDB) - bTop);
      const col  = H_COLORS[idx % H_COLORS.length];

      // Bar with vertical gradient
      const grad = thdCtx.createLinearGradient(bx, bTop, bx, yDB(minDB));
      grad.addColorStop(0,   col);
      grad.addColorStop(0.6, col + '99');
      grad.addColorStop(1,   col + '22');
      thdCtx.fillStyle = grad;
      thdCtx.fillRect(bx, bTop, barW, bH);

      // Top glow stripe
      thdCtx.fillStyle = col + 'cc';
      thdCtx.fillRect(bx, bTop, barW, 2);

      // Value label above bar
      thdCtx.fillStyle = '#e2e8f0';
      thdCtx.font = 'bold 9px var(--font-mono)';
      thdCtx.textAlign = 'center';
      if (idx === 0) {
        thdCtx.fillStyle = col;
        thdCtx.fillText('0 dB', bx + barW/2, bTop - 6);
      } else if (db > minDB + 4) {
        thdCtx.fillStyle = col;
        thdCtx.fillText(`${db.toFixed(1)}`, bx + barW/2, bTop - 6);
      }

      // X-axis label (multi-line via two fills)
      thdCtx.fillStyle = '#64748b';
      thdCtx.font = '9px var(--font-mono)';
      const lParts = H_LABELS[idx].split('\n');
      lParts.forEach((ln, li) => thdCtx.fillText(ln, bx + barW/2, PAD.top + ph + 14 + li * 11));
    });

    // ── THD% result badge (top right) ─────────────────────────────────
    const color = thd < 1 ? '#10b981' : thd < 5 ? '#f59e0b' : '#ef4444';
    const bW = 158, bH2 = 26;
    const bX = PAD.left + pw - bW - 2, bY = PAD.top - 36;
    // Badge background
    thdCtx.fillStyle = thd < 1
      ? 'rgba(16,185,129,0.12)'
      : thd < 5 ? 'rgba(245,158,11,0.12)' : 'rgba(239,68,68,0.12)';
    _roundRect(thdCtx, bX, bY, bW, bH2, 6);
    thdCtx.fill();
    thdCtx.strokeStyle = color;
    thdCtx.lineWidth = 1;
    thdCtx.stroke();
    thdCtx.fillStyle = color;
    thdCtx.font = 'bold 14px var(--font-mono)';
    thdCtx.textAlign = 'left';
    thdCtx.fillText(`THD  =  ${thd.toFixed(2)} %`, bX + 8, bY + 17);

    // ── Axis labels ───────────────────────────────────────────────────
    thdCtx.fillStyle = '#475569';
    thdCtx.font = '10px var(--font-mono)';
    thdCtx.textAlign = 'center';
    thdCtx.fillText('Harmonic Order', PAD.left + pw/2, height - 2);
    thdCtx.save();
    thdCtx.translate(13, PAD.top + ph/2);
    thdCtx.rotate(-Math.PI/2);
    thdCtx.fillText('Level relative to H1  [dBr]', 0, 0);
    thdCtx.restore();
  }

  function _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x+r, y); ctx.lineTo(x+w-r, y);
    ctx.quadraticCurveTo(x+w, y, x+w, y+r);
    ctx.lineTo(x+w, y+h-r);
    ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
    ctx.lineTo(x+r, y+h);
    ctx.quadraticCurveTo(x, y+h, x, y+h-r);
    ctx.lineTo(x, y+r);
    ctx.quadraticCurveTo(x, y, x+r, y);
    ctx.closePath();
  }

  // ====================================================================
  // KIM & ALLEN UI BINDINGS
  // ====================================================================

  // ── Analysis Tab Switching ────────────────────────────────────────────
  function switchAdvTab(view) {
    document.querySelectorAll('.adv-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.adv === view);
    });
    const vImp = document.getElementById('adv-view-impedance');
    const vThd = document.getElementById('adv-view-thd');
    if (vImp) vImp.classList.toggle('hidden', view !== 'impedance');
    if (vThd) vThd.classList.toggle('hidden', view !== 'thd');

    // If switching to THD and not yet calculated, run it immediately
    if (view === 'thd' && !_thdData) {
      _executeTHDAnalysis();
    }

    // Resize and redraw newly visible canvas
    setTimeout(() => {
      if (view === 'impedance') resizeImpedanceCanvas();
      else                      resizeTHDCanvas();
    }, 40);
  }
  window.switchAdvTab = switchAdvTab;

  document.querySelectorAll('.adv-tab').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      switchAdvTab(btn.dataset.adv);
    });
  });

  // ── Run THD Button ────────────────────────────────────────────────────
  const _thdRunBtn = document.getElementById('run-thd-btn');

  function _executeTHDAnalysis() {
    if (_thdBusy) return;
    _thdBusy = true;
    const badge  = document.getElementById('thd-badge');
    const status = document.getElementById('thd-status');
    if (_thdRunBtn) {
      _thdRunBtn.textContent = '⏳ Computing…';
      _thdRunBtn.disabled = true;
    }
    if (status) status.textContent = 'Running RK4 solver… (25 periods × 200 samples/period = 5 000 time-steps per run)';

    setTimeout(() => {
      try {
        const driveSel = document.getElementById('thd-drive-select');
        const freqSel  = document.getElementById('thd-freq-select');
        const amp  = parseFloat(driveSel ? driveSel.value : 1.5) || 1.5;
        const freq = parseFloat(freqSel  ? freqSel.value  : 1000) || 1000;
        _thdData = _runTHDAnalysis(freq, amp, kaState);
        const dpr = window.devicePixelRatio || 1;
        resizeTHDCanvas();
        drawTHDChart(thdCanvas.width/dpr, thdCanvas.height/dpr);
        if (badge) {
          badge.classList.remove('hidden');
          const thd = _thdData.thd;
          const col = thd < 1 ? '#10b981' : thd < 5 ? '#f59e0b' : '#ef4444';
          badge.textContent = `THD = ${thd.toFixed(2)} %`;
          badge.style.color = col;
          badge.style.borderColor = col;
        }
        if (status) status.textContent =
          `Solved at ${freq} Hz · ${amp} mA drive · ` +
          `THD = ${_thdData.thd.toFixed(3)} %  ` +
          `(H3: ${_thdData.dBr[2].toFixed(1)} dBr,  H5: ${_thdData.dBr[4].toFixed(1)} dBr)`;
      } catch (err) {
        if (status) status.textContent = `Solver error: ${err.message}`;
      }
      if (_thdRunBtn) {
        _thdRunBtn.textContent = '⚙ Run THD Analysis';
        _thdRunBtn.disabled = false;
      }
      _thdBusy = false;
    }, 25);
  }

  if (_thdRunBtn) {
    _thdRunBtn.addEventListener('click', _executeTHDAnalysis);
  }

  // ── Kim & Allen Parameter Sliders ────────────────────────────────────
  function _bindKASlider(sliderId, key, scale, dispId, fmtFn) {
    const slider = document.getElementById(sliderId);
    const disp   = document.getElementById(dispId);
    if (!slider) return;
    slider.addEventListener('input', () => {
      kaState[key] = parseFloat(slider.value) * scale;
      if (disp) disp.textContent = fmtFn(kaState[key]);
      // Live-update impedance chart if visible
      const vImp = document.getElementById('adv-view-impedance');
      if (vImp && !vImp.classList.contains('hidden')) {
        const dpr = window.devicePixelRatio || 1;
        drawImpedanceResponse(impedanceCanvas.width/dpr, impedanceCanvas.height/dpr);
      }
    });
  }

  _bindKASlider('ka-bl-slider',   'Bl',    1,       'ka-bl-display',
                v => `${v.toFixed(2)} T·m`);
  _bindKASlider('ka-re2-slider',  'Re2',   1,       'ka-re2-display',
                v => `${v.toFixed(0)} Ω`);
  _bindKASlider('ka-le2-slider',  'Le2',   1e-3,    'ka-le2-display',
                v => `${(v * 1e3).toFixed(3)} mH`);
  _bindKASlider('ka-mass-slider', 'm_eff', 1e-6,    'ka-mass-display',
                v => `${(v * 1e6).toFixed(1)} µg`);
  _bindKASlider('ka-km-slider',   'Km',    1,       'ka-km-display',
                v => `${v.toFixed(0)} N/m`);
  _bindKASlider('ka-rm-slider',   'Rm',    1e-3,    'ka-rm-display',
                v => `${(v * 1e3).toFixed(1)} mNs/m`);
  _bindKASlider('ka-k3-slider',   'k3',    1e11,    'ka-k3-display',
                v => `${(v / 1e11).toFixed(1)} ×10¹¹`);
  _bindKASlider('ka-kbl-slider',  'kBl',   1e10,    'ka-kbl-display',
                v => `${(v / 1e10).toFixed(1)} ×10¹⁰`);

  // ── Resize listener (both canvases) ───────────────────────────────────
  window.addEventListener('resize', () => {
    resizeImpedanceCanvas();
    const vThd = document.getElementById('adv-view-thd');
    if (vThd && !vThd.classList.contains('hidden')) resizeTHDCanvas();
  });

  // ── Live Impedance Animation Loop ─────────────────────────────────────
  // Keeps the impedance chart updated continuously (follows frequency slider)
  (function impedanceLoop() {
    const vImp = document.getElementById('adv-view-impedance');
    if (vImp && !vImp.classList.contains('hidden') && impedanceCanvas && iCtx) {
      const dpr = window.devicePixelRatio || 1;
      const w = impedanceCanvas.width / dpr;
      const h = impedanceCanvas.height / dpr;
      if (w > 10 && h > 10) drawImpedanceResponse(w, h);
    }
    requestAnimationFrame(impedanceLoop);
  })();

  // ── Initialise on DOM Ready ────────────────────────────────────────────
  // Uses ResizeObserver so the canvas draws as soon as the container
  // gains actual layout dimensions (robust against deferred layout).
  function _initKACanvases() {
    // Immediate attempt
    resizeImpedanceCanvas();
    resizeTHDCanvas();
    _updateKAComputedDisplay(computeSystemResponse(state.frequency, kaState));

    // Pre-calculate initial THD so switching to the tab renders immediately
    try {
      _thdData = _runTHDAnalysis(1000, 1.5, kaState);
      const badge = document.getElementById('thd-badge');
      if (badge && _thdData) {
        badge.classList.remove('hidden');
        const thd = _thdData.thd;
        const col = thd < 1 ? '#10b981' : thd < 5 ? '#f59e0b' : '#ef4444';
        badge.textContent = `THD = ${thd.toFixed(2)} %`;
        badge.style.color = col;
        badge.style.borderColor = col;
      }
    } catch (e) {
      console.warn('Initial THD analysis:', e);
    }

    // ResizeObserver on both wrappers — fires when container gets dimensions
    if (typeof ResizeObserver !== 'undefined') {
      if (impedanceCanvas && impedanceCanvas.parentElement) {
        const ro1 = new ResizeObserver(() => {
          resizeImpedanceCanvas();
          _updateKAComputedDisplay(computeSystemResponse(state.frequency, kaState));
        });
        ro1.observe(impedanceCanvas.parentElement);
      }
      if (thdCanvas && thdCanvas.parentElement) {
        const ro2 = new ResizeObserver(() => {
          resizeTHDCanvas();
        });
        ro2.observe(thdCanvas.parentElement);
      }
    }

    // Belt-and-suspenders fallback
    setTimeout(resizeImpedanceCanvas, 300);
    setTimeout(resizeImpedanceCanvas, 800);
  }

  // --- Initial Startup ---
  function _startApp() {
    resizeCanvas();
    updateFrequencyDisplay();
    requestAnimationFrame(animate);
    // Initialise Kim & Allen canvases once layout has settled
    setTimeout(_initKACanvases, 100);
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', _startApp);
  } else {
    _startApp();
  }

})();
