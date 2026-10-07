# Component Database Plugin: Implementation Plan

> **Plugin ID:** `component_database`  
> **Target Platform:** One EAD Portal (FastAPI backend + Vanilla JS/CSS frontend)  
> **Primary Audience:** Electrical & Electroacoustic Engineers  
> **Status:** Planned / Architecture Phase  

---

## 1. Executive Summary & Purpose

Electrical and acoustic engineers frequently need to evaluate and compare dozens of component datasheets (microphones, balanced armature receivers, op-amps, codecs, passives) from multiple vendors (e.g., Knowles, Sonion, STMicroelectronics, Texas Instruments, Murata, TDK).

### The Core Challenges
1. **Layout & Format Diversity**: Datasheet formats vary wildly between vendors and product revisions. Some use 2-column key-value tables; others use 6-column tables with `Min / Nom / Max / Unit / Conditions`.
2. **Terminology Inconsistency (Synonym Problem)**:
   - Knowles: `Sensitivity @ 1 kHz`
   - Sonion: `Sens (1kHz)`
   - ST: `S_1k` or `Free-field Sensitivity`
   - Supply Voltage: `Vdd`, `Vcc`, `Supply Voltage`, `Operating Voltage`
3. **Condition-Dependent Specifications**: A sensitivity or current value is meaningless without its test condition (e.g., `@ 1 kHz, 94 dB SPL, Vdd = 0.9 V, T = 20 °C`).
4. **Accuracy Criticality**: In hardware engineering, an automated OCR/AI error (e.g., mistaking an *Absolute Maximum* rating for a *Nominal Operating* rating) can cause PCB redesigns.

### The Solution: A 3-Tiered Ingestion & Comparison Engine
* **Tier 1: Canonical Taxonomy & Parameter Dictionary**: Defines standard parameters, units, and vendor aliases per component class.
* **Tier 2: Hybrid Ingestion Pipeline with Split-Screen Staging**: Extracts parameters via `pdfplumber` geometry detection and fuzzy matching, then presents a side-by-side verification interface where the engineer reviews values against the original PDF before committing.
* **Tier 3: Dynamic Comparison Matrix UI**: A fast, responsive comparison table with "Difference-Only" toggles, best-in-class highlights, and click-to-source traceability back to the exact PDF page.

---

## 2. Component Taxonomy & Schema Design

Components are organized into **Categories**. Each category defines its canonical parameter definitions in schema configuration files (`schemas/*.json`).

### 2.1 Value Data Model
Every parametric value is stored as a rich structured object rather than a plain string:

```json
{
  "min": 0.88,
  "nom": 0.90,
  "max": 1.40,
  "unit": "V",
  "condition": "Operating range including supply noise and transients",
  "source_page": 2,
  "status": "verified"
}
```

### 2.2 Category 1: Microphones (e.g., Knowles MM60, Sonion MEMS)
* **Electrical**:
  * `supply_voltage`: Min, Nom, Max (`V`) [Aliases: `Supply Voltage`, `Vdd`, `Operating Voltage`]
  * `current_consumption`: Min, Nom, Max (`µA` or `mA`) [Aliases: `Current Consumption`, `Idd`, `Supply Current`, `Current Drain`]
  * `output_impedance`: Min, Nom, Max (`Ω` / `kΩ`) [Aliases: `Output Impedance`, `Zout`]
  * `output_dc_bias`: Min, Nom, Max (`V`) [Aliases: `Output Load Voltage (VL)`, `DC Output Voltage`]
* **Acoustic & Performance**:
  * `sensitivity_1k`: Min, Nom, Max (`dBV/Pa` or `mV/Pa`) [Condition: `@ 1 kHz, 94 dB SPL`]
  * `sensitivity_100hz_rel`: Min, Nom, Max (`dBV`) [Relative to 1 kHz]
  * `sensitivity_10k_rel`: Min, Nom, Max (`dBV`) [Relative to 1 kHz]
  * `snr`: Nom (`dBA`) [Condition: `20 Hz - 20 kHz A-weighted`]
  * `aop`: Min, Nom (`dB SPL`) [Condition: `10% THD`]
  * `thd_94db`: Typ, Max (`%`) [Condition: `94 dB SPL @ 1 kHz`]
  * `polarity`: String [Increasing voltage with positive pressure]
* **Timing & Start-up**:
  * `supply_ramp_time`: Max (`ms`) [$t_r$]
  * `supply_off_time`: Min (`ms`) [$t_{off}$]
  * `register_loading_time`: Max (`ms`) [$t_{ld}$]
* **Physical & Environmental**:
  * `dimensions`: $L \times W \times H$ (`mm`)
  * `port_location`: `Top` | `Bottom`
  * `operating_temperature`: Min, Max (`°C`)
  * `weight`: Typ (`g`)

### 2.3 Category 2: Receivers / Balanced Armatures
* **Acoustic / Electroacoustic**:
  * `nominal_impedance`: Nom (`Ω` @ 500 Hz or 1 kHz)
  * `dcr`: Nom, Max (`Ω` DC resistance)
  * `sensitivity_spl`: Nom (`dB SPL` @ 1 kHz / 1 mW or 100 mV)
  * `max_power`: Max (`mW`)
  * `mpo_peak_spl`: Typ (`dB SPL`)
  * `thd`: Typ, Max (`%`)
* **Physical**:
  * `dimensions`: $L \times W \times H$ (`mm`)
  * `spout_type`: Dimensions, angle, placement

---

## 3. Architecture & Directory Structure

Following One EAD's modular architecture:

```
modules/component_database/
├── __init__.py
├── module.py                       # PortalModule definition, FastAPI routes
├── IMPLEMENTATION_PLAN.md          # This plan
├── config.py                       # App paths, settings
├── db.py                           # SQLite connection & schema migrations
├── schemas/                        # Canonical parameter schemas & aliases
│   ├── microphone.json
│   ├── receiver.json
│   └── generic_ic.json
├── parsers/                        # Extraction logic
│   ├── base.py                     # BaseParser interface
│   ├── table_extractor.py          # pdfplumber table bounding & text clustering
│   ├── alias_matcher.py            # Fuzzy matching & synonym dictionary
│   └── unit_normalizer.py          # Conversion (uA <-> mA, dBV <-> mV, ohm <-> kohm)
├── data/                           # Local storage (gitignored/persistent)
│   ├── components.db               # SQLite database
│   └── datasheets/                 # Uploaded PDF files organized by category
│       ├── microphone/
│       └── receiver/
└── web/                            # Frontend UI
    ├── index.html                  # Main SPA entry
    ├── style.css                   # Premium One EAD styling
    ├── app.js                      # Core frontend application logic
    ├── components/
    │   ├── catalog_view.js         # Browse, search, filter cards
    │   ├── comparison_matrix.js    # Side-by-side comparison table
    │   └── ingestion_inspector.js  # Split-screen PDF vs form verification
    └── vendor/                     # Any local assets or helpers (e.g. pdf.js)
```

---

## 4. Ingestion & Extraction Workflow

```
1. PDF Upload 
   │
   ▼
2. Category Selection & Fast Text/Table Extraction (pdfplumber)
   │
   ▼
3. Alias & Parameter Mapping Engine
   ├── Matches table row headers against Category Alias Dictionary
   ├── Normalizes Min / Nom / Max / Units
   └── Calculates Confidence Score (Exact, Fuzzy, Unmatched)
   │
   ▼
4. Split-Screen Verification Staging (Human-in-the-Loop)
   ├── Left: Embedded PDF Viewer at extracted page
   ├── Right: Editable Form with color-coded confidence
   └── "Save & Add Alias Pattern" button (system remembers vendor nuances)
   │
   ▼
5. Persist to SQLite Database & Archive PDF in Data Vault
```

### Why this ensures speed and accuracy:
- **Instant Extraction**: `pdfplumber` runs locally in under 1 second.
- **100% Accuracy Guarantee**: The engineer sees the detected value highlighted directly next to the source PDF before committing.
- **Continuous Learning**: When the user edits or manually selects a mapping, the alias pattern is stored in the vendor profile so subsequent datasheets from that vendor map automatically.

---

## 5. Comparison Matrix UI Features

The Comparison Matrix is the central workspace for engineering decisions:

1. **Multi-Component Pinning**:
   - Compare 2 to 6 components side-by-side.
   - Quick "Pin to Compare" action from the catalog list.
2. **Difference-Only Mode**:
   - One-click toggle (`[x] Hide Identical Parameters`) collapses all rows where all compared parts share the same value.
3. **Smart Engineering Highlights**:
   - **Best in Class**: Automatically highlights the most favorable value (e.g., lowest $I_{dd}$, highest SNR, lowest THD).
   - **Out-of-Spec Warning**: Optional design threshold overlays (e.g., flag in yellow/red any component whose $V_{dd}$ max is $< 1.2\text{ V}$).
4. **Source Traceability (Click-to-PDF)**:
   - Clicking on any cell opens a modal/drawer showing the original datasheet page and snippet where that exact spec was extracted.
5. **Export & Sharing**:
   - Export comparison table directly to **Excel (`.xlsx`)**, **CSV**, or **Markdown**.
   - Direct integration hooks for the F1 Filter Simulator and HXML Viewer.

---

## 6. Phased Implementation Roadmap

### Phase 1: Database Foundation & Schema Definitions
- [ ] Initialize SQLite database (`components.db`) with tables: `components`, `categories`, `parameters`, `aliases`, `vendor_templates`.
- [ ] Implement `microphone.json` and `receiver.json` canonical parameter schemas with alias dictionaries.
- [ ] Build FastAPI CRUD endpoints: list components, get details, delete, update specs.

### Phase 2: Ingestion & Parser Engine
- [ ] Implement `table_extractor.py` using `pdfplumber` for multi-column spec tables.
- [ ] Implement `alias_matcher.py` with case-insensitive and regex-based synonym matching.
- [ ] Implement `unit_normalizer.py` for standard engineering unit conversions.
- [ ] Validate parser using the existing Knowles datasheets:
  - `D00343759_V2_DATA SHEET MIC MM60-63230-B66 KNOWLES.pdf`
  - `MM08-36139-B66 Rev 5 preliminary datasheet.pdf`

### Phase 3: Frontend Experience
- [ ] **Catalog View**: Searchable list/grid of components with tags (Category, Manufacturer, Project, Status).
- [ ] **Ingestion Inspector**: Split-view upload wizard displaying the PDF on the left and extracted fields on the right.
- [ ] **Comparison Matrix**: Side-by-side parametric comparison with Difference-Only toggle, search bar, and unit toggles.

### Phase 4: Advanced Capabilities & Extensibility
- [ ] Curve/Chart digitization or image clipping (extracting frequency response graphs and overlaying them).
- [ ] Category Manager UI: Allow engineers to add new component categories (e.g., Inductors, Batteries, Power ICs) and customize alias dictionaries directly in the web UI.
- [ ] Export to Excel/CSV and One EAD inter-plugin links.
