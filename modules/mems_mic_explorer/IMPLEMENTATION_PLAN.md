# MEMS Microphone Acoustic Explorer: Implementation Plan

> **Plugin ID:** `mems-mic-explorer` (package `modules/mems_mic_explorer`)
> **Target Platform:** One EAD Portal (static plugin, no backend)
> **Stack:** React 19 + TypeScript + Vite + Three.js / React Three Fiber / Drei + Tailwind CSS
> **Reference microphone:** Knowles MM20 (`MM20-33366-B116`, datasheet revision A)
> **Primary audience:** Electroacoustic / MEMS engineers and engineering students
> **Status:** Phase 1 complete · Phases 2–5 planned

---

## 1. Purpose

An interactive engineering textbook combined with a 3D laboratory for learning MEMS microphones across three domains: **acoustic**, **mechanical / MEMS** and **electrical / capacitive transduction**.

Central learning chain (must be navigable in both directions):

```
STRUCTURE → PARAMETER → PHYSICAL MECHANISM → EQUATION → RESPONSE → PERFORMANCE
```

Example, forward: Diaphragm → stiffness → mechanical resonance → frequency response.
Example, backward: Frequency response → possible physical causes → diaphragm stiffness → mechanical resonance.

### Explicit non-goals
This is **not** a microphone qualification, design-review, reliability, environmental-test, compliance-checking or automated datasheet-assessment tool. It is purely educational.

---

## 2. Knowledge principles (apply to every phase)

Three kinds of information must always be visibly separated:

| Class | Meaning | Scope value | Example |
|---|---|---|---|
| **A. MM20 manufacturer-published** | Explicitly published by Knowles for the MM20 | `mm20_specific` | Sensitivity, noise, SNR, AOP, package size, supply, output impedance, directivity |
| **B. Generic MEMS knowledge** | Established principles for MEMS microphones in general | `generic_mems` | Diaphragm stiffness, effective mass, damping, acoustic compliance, capacitive transduction |
| **C. Conceptual / derived** | Simplified models created by this application | `conceptual`, `derived` | Illustrative diaphragm mass, simplified response curve |

Hard rules:
- Never present generic or conceptual values as MM20 internals.
- Never invent proprietary MM20 internal geometry or parameters. If undocumented, show exactly: **"Not publicly specified"**.
- Evidence type and confidence are separate fields (a manufacturer-published value has `very_high` confidence; an illustrative simulator mass is `conceptual` with `medium` confidence).

### Data-integrity rules (R1–R10)
These are enforced by `src/knowledge/validate.ts` (run with `npm run validate`, and shown on the Sources tab).

| Rule | Statement | Enforced in validator |
|---|---|---|
| R1 | Never invent an MM20 internal parameter | `mm20_specific` cannot be `not_publicly_specified` |
| R2 | Never present a generic MEMS parameter as an MM20 specification | generic parameters may not hold a value |
| R3 | Never present the conceptual physics curve as measured MM20 data | **Phase 2:** validate `ResponseCurve.curveType` vs source type |
| R4 | Every published numerical value must have a source | value/text without source = error |
| R5 | Every equation has a source or is a clearly identified standard derivation | `sources` or `standardDerivation` required |
| R6 | Every relationship has an evidence level | confidence + mechanism + explanation required |
| R7 | Unknown information says "Not publicly specified" | `NOT_PUBLICLY_SPECIFIED` constant, rendered by `formatParameterValue` |
| R8 | Keep manufacturer data, generic theory and conceptual models separate | `mm20_specific` ⇔ `manufacturer_published` |
| R9 | Do not assign a source that does not support the information | `mm20_specific` must cite a manufacturer datasheet source |
| R10 | No false precision; flag approximate / derived / digitized / conceptual values | derived values need conditions/notes; **Phase 2:** digitized curves record `extractionMethod` |

---

## 3. Architecture

### 3.1 Build and hosting
- Source in `app-src/`, built output in `web/` (`npm run build` inside `app-src/`). The portal only serves `web/`.
- Vite `base: "./"` so the plugin works under `/modules/mems-mic-explorer/`.
- Fully offline: no CDN, no remote fonts, no HDR environment maps (Drei `Environment` presets are intentionally **not** used; they fetch from a CDN).
- No backend. `module.py` only registers the plugin (icon, title, accent, order).
- `node_modules/` stays in `app-src/`. Always commit/keep the rebuilt `web/` after changes.

### 3.2 Layering (knowledge is separate from UI)

```
SOURCE → PARAMETER → EQUATION → RELATIONSHIP → MECHANISM → RESPONSE → PERFORMANCE
```

```
app-src/
  scripts/validate-data.ts          # CLI integrity check (npm run validate)
  src/
    types/                          # evidence, source, parameter, equation, relationship, response, structure
    data/
      sources/                      # sources.ts (aggregate), knowles-mm20.ts, mems-literature.ts
      microphones/mm20.ts           # MM20 identity + published package facts
      parameters/                   # helpers.ts (generic/mm20/derived builders), acoustic, mechanical, electrical, performance
      equations/equations.ts
      relationships/                # helpers.ts, parameter-parameter.ts, parameter-performance.ts
      response/features.ts          # response-curve feature nodes (curve data arrives in Phase 2)
      structure/components.ts       # 12 structure components (3D model + knowledge)
      index.ts                      # aggregates + id maps + knowledge nodes
    knowledge/
      graph.ts                      # edges, bidirectional traversal, lookup helpers
      validate.ts                   # rules R1–R10
    components/
      common/                       # Badges, Section
      SourcePanel/                  # SourceRefs, SourceCard
      EquationPanel/                # EquationList
      RelationshipGraph/            # RelationshipList, RelationshipRow
      ParameterPanel/               # ComponentPanel, ParameterDetail
      Microphone3D/                 # model.ts, MicrophoneScene, ViewControls, Explorer3D
    views/                          # LearnView, ParametersView, SourcesView, Placeholder
    lib/format.ts                   # value formatting ("Not publicly specified")
    App.tsx, main.tsx, index.css
```

Planned additions (create when needed, keep this layout):
`components/AcousticResponse/`, `components/PhysicsModel/`, `components/Learning/`, `components/Experiments/`, `data/response/mm20-response.ts`, `data/lessons/lessonNN.ts`.

### 3.3 Knowledge graph
- Nodes: structure components (`comp.*`), parameters (`ac.*`, `mech.*`, `el.*`, `perf.*`) and response features (`resp.*`). Ids are unique across all node kinds (validator checks this).
- Edges: every `Relationship` (`from` → `to`) plus implicit **structural** edges generated from each component's `parameterIds`. Relationships are the single source of truth; parameters do not hand-maintain relationship lists.
- `traverse(startId, "forward" | "backward", maxDepth)` supports the chain in both directions.
- UI never hard-codes relationships; it reads them via `knowledge/graph.ts`.

### 3.4 Data model (see `src/types/`)
Implemented as specified in the original brief (`Source`, `Parameter`, `Equation`, `Relationship`, `ResponseCurve`) with these deliberate additions:

| Addition | Where | Why |
|---|---|---|
| `mm20Status: "published" \| "not_publicly_specified" \| "not_applicable"` | `Parameter`, `StructureComponent` | Makes Rule 7 explicit and checkable |
| `conditions`, `textValue` | `Parameter` | Test conditions as printed; non-numeric published values (e.g. "Omnidirectional") |
| `standardDerivation` | `Equation` | Satisfies Rule 5 for textbook-standard relations |
| `confidence` | `Equation` | Evidence level for equations |
| `scope` | `Relationship` | Marks generic vs MM20-specific vs conceptual relationships |
| `StructureComponent` | `types/structure.ts` | 3D component ↔ parameters ↔ equations ↔ impact; `mm20Facts` with source ids; `conceptualGeometry` flag |
| `KnowledgeNode` | `types/relationship.ts` | Graph node registry |

Source records for the MM20 datasheet are **location-specific** (one record per sheet/table/figure: `knowles-mm20-table1`, `-fig1`, `-mech`, `-features`, plus the document-level record), so every citation carries page / table / figure.

---

## 4. MM20 source and published facts

**Primary source:** Knowles MM20-33366-B116, Revision A (11/26/2018), published 23 Jan 2019, 10 sheets.
URL: <https://www.knowles.com/docs/default-source/default-document-library/mm20-33366-b116.pdf?Status=Master&sfvrsn=c6b071b1_0>

| Sheet | Content used |
|---|---|
| 1 | Description: "an acoustic sensor, a low noise input buffer, and an output amplifier"; bottom port; features |
| 2 | **Table 1** general specifications (all electrical/acoustic parameters) |
| 3 | **Figure 1** typical frequency response (pressure cavity, nominal; above 10 kHz typical free-field), Figure 2 third-octave noise, Table 2 matching |
| 4 | Mechanical drawing: 3.350 × 2.500 × 1.300 mm (±0.080), weight 0.023 g, port ring diameters Ø0.450 / Ø0.970 / Ø1.478 mm (±0.050), port centre 1.250 / 1.080 mm (±0.100), three terminals OUTPUT / POSITIVE / NEGATIVE |

### Handling notes (do not regress)
- **Sensitivity unit** is reproduced verbatim as printed: `dB re 1V / 0.1 Pa` (Table 1 and the Figure 1 axis). Do not "correct" it silently.
- **Peak Frequency (19.5 kHz) and Peak level (+8 dB re 1 kHz)** are published, but the datasheet does **not** say what causes the peak. Never label it "diaphragm resonance"; present possible mechanisms (mechanical vs acoustic) as generic theory.
- **Dynamic range 97.5 dB** is *derived* (121 − 23.5, nominal values), flagged `derived`, MM20 status `not_publicly_specified`.
- **SNR = 94 − EIN** is consistent with the datasheet (94 − 23.5 = 70.5 dB A); used in `eq.snr_ein`.
- **Output type:** datasheet does not say "analog"; inferred from dB re 1 V sensitivity and output load voltage, marked `derived`, medium confidence, `not_publicly_specified`.
- Internal geometry (diaphragm size/thickness/stiffness/mass, air gap, backplate, perforations, cavity volumes, bias voltage, ASIC gain, bond wires) is **not publicly specified**.
- The 3D model's port hole (Ø0.97 mm) is an illustrative choice; the drawing does not state which of the three rings is the effective aperture.

---

## 5. Parameter library (implemented, 63 parameters)

| Group | Count | Highlights |
|---|---|---|
| Acoustic | 14 | port diameter/geometry (MM20 drawing), port length, resistance, inertance, compliance, cavity volume, damping, resonance, impedance, loading, pressure distribution, coupling, directivity |
| Mechanical / MEMS | 20 | package length/width/height/weight (MM20), diaphragm area/thickness/mass/effective mass/stiffness/tension, compliance, damping, resonance, backplate thickness, perforation size/density, air gap, effective parameters, acoustic force, displacement |
| Electrical | 13 | bias voltage, MEMS capacitance, capacitance change, capacitive transduction, output signal, ASIC gain, supply voltage/current, output impedance, output load voltage, PSRR, output type, electrical noise |
| Performance | 16 | sensitivity, frequency response, response at 100 Hz / 10 kHz, LF roll-off, peak level/frequency, resonance frequency, bandwidth, AOP, dynamic range, THD, EIN (+ third-octave), SNR, phase response |

Generic concepts carry **no value** (Rule 2); only MM20-published and clearly flagged derived entries do.

Equations (14): pressure force, compliance, mass–spring resonance, Q/damping ratio, SDOF displacement response, parallel-plate capacitance, constant-charge transduction, acoustic impedance, cavity compliance, port inertance, port viscous resistance, Helmholtz resonance, sensitivity in dB, SNR from EIN.

Relationships (36): the seven chains required by the brief (stiffness/mass → resonance → response; damping → peak → bandwidth; port geometry → impedance → loading → response; cavity volume → compliance → acoustic resonance → response; area → force → displacement → sensitivity; bias → transduction → output → sensitivity) plus noise/SNR/dynamic-range links.

---

## 6. Phase status

### Phase 1 — Foundation ✅ COMPLETE
- [x] Application shell (top navigation, light/dark theme, offline)
- [x] TypeScript data architecture
- [x] Source architecture (location-specific MM20 records + literature + derived-model source)
- [x] Parameter, equation and relationship architecture
- [x] Conceptual MEMS 3D model (package, lid, port, cavity, die, diaphragm, air gap, backplate, perforations, ASIC, bond wires, pads)
- [x] 3D controls: orbit / pan / zoom, reset camera, select + highlight, hide/show, transparent package, cutaway, exploded-view slider, labels
- [x] MM20 external/package reference (datasheet envelope + port position)
- [x] Component knowledge panel (function, mechanism, MM20 facts, parameters, equations, impact, sources, badges)
- [x] Evidence badges and reusable source panel
- [x] Parameters browser and Sources tab (legend, integrity report, source library)
- [x] Integrity validator (`npm run validate`) and graph traversal helpers

Known limitations carried forward:
- [ ] 3D scene has not been visually reviewed in a browser. Check layout, label positions, exploded offsets, cutaway and click-through behaviour.
- [ ] Textbook / paper citations are book- or paper-level only; pin-point page/section numbers and DOIs are unverified (records are `draft`). Verify and fill before publishing.
- [ ] `latex` is stored on every equation but only the plain `expression` is rendered. Add KaTeX (bundled, no CDN) if rendered math is wanted.
- [ ] Bundle is ~1.25 MB (Three.js); acceptable locally, consider code-splitting the 3D view later.
- [ ] Layer thicknesses in the 3D model are exaggerated; add a visible "not to scale" cue or scale bar if needed.

### Phase 2 — MM20 response ⬜ NEXT
Goal: the response curve becomes a primary feature (the Response tab and the lower half of the main workspace).

1. **MM20 response data** (`data/response/mm20-response.ts`)
   - **Figure 1 on sheet 3 is a vector graphic** (PDF curve paths with ~226 and ~178 points in the plot colour), so the curve can likely be read as `extractionMethod: "digital_data"` instead of manual digitization. First task: extract the path points with `pdfplumber`/PyMuPDF, map PDF coordinates to Hz (log axis) and dB using the axis tick positions, and verify the result against Table 1 (100 Hz −1 dB, 1 kHz −55 dB, 10 kHz 0 dB re 1 kHz, 19.5 kHz peak ≈ +8 dB, LF −3 dB at 55 Hz).
   - Record `source`, `sourceFigure: "Figure 1"`, `sourcePage: 3`, `extractionMethod`, `confidence`, and the note that data above 10 kHz is typical free-field (the datasheet draws it differently), not pressure-cavity.
   - Do the extraction offline (a one-off script under `scratch/` or `app-src/scripts/`) and commit the resulting points as TypeScript data; no PDF parsing at runtime.
   - Axis unit stays `dB re 1V / 0.1 Pa` as printed. Keep a second normalised view ("dB re 1 kHz") that is clearly labelled as derived.
2. **Interactive graph** (`components/AcousticResponse/`)
   - Chart library: Recharts or a small custom SVG/Canvas chart (decide by log-axis + zoom/pan needs; Recharts handles log scale but zoom/pan needs custom work). Must work offline (bundled).
   - Log frequency axis, dB axis, zoom, pan, cursor read-out, grid, frequency markers, tooltips, curve visibility toggles.
   - At least two curves: **MM20 — Manufacturer Typical Response** and **Conceptual Physics Model** (placeholder until Phase 4). Never merge; different colours/line styles and badges (`manufacturer_published` vs `conceptual`). Add R3 to the validator.
3. **Curve annotations and frequency cursor** — mark the published points (100 Hz, 1 kHz, 10 kHz, LF −3 dB at 55 Hz, peak at 19.5 kHz) with their Table 1 source.
4. **Curve anatomy** — select a region (low-frequency, mid-band, high-frequency, peak, bandwidth). For each show: what the curve shows; physical interpretation; possible mechanisms; relevant parameters; related structures; what is known specifically for the MM20; what is generic theory; sources. Use the existing `resp.*` nodes and relationships so it is graph-driven (backward navigation: response feature → possible causes).
5. **Source-linked response information** — every annotation and anatomy statement carries `sources` and a scope badge.
6. **Main workspace** — add the response graph below/next to the 3D view with a shared selection (selecting a response feature highlights candidate components, and vice versa).

Open questions to resolve first:
- Which mechanisms may be listed for the high-frequency peak without asserting a cause (candidates: diaphragm mechanical resonance, port/cavity acoustic resonance, combination); all labelled generic and "origin not specified by the datasheet".
- Whether the LF roll-off can be explained at all from the published data (vent/leak mechanisms are generic theory only; MM20 vent is not published).

### Phase 3 — Knowledge library ⬜
Most of the data layer already exists; Phase 3 is mostly UI depth and content review.
- [ ] Expand/complete acoustic, mechanical, electrical and performance parameters; review every record (`status: reviewed`)
- [ ] Verify literature citations (page/section/DOI), replace book-level notes
- [ ] Equation browser (domain filter, rendered math, "used by" back-links)
- [ ] Relationship browser and **knowledge-graph visualisation** (STRUCTURE → … → PERFORMANCE), forward and backward, with filters by scope/confidence
- [ ] Bidirectional navigation everywhere (3D ↔ parameter ↔ equation ↔ response feature ↔ performance)
- [ ] Signal-path visualisation (sound pressure → port → cavity → diaphragm → motion → transduction → ASIC → output); each stage links to its 3D component, parameters, mechanism, equation, response impact and sources
- [ ] Add MM20 Table 2 (matching) and Figure 2 (third-octave noise) as source records if used

### Phase 4 — Physics lab ⬜
- [ ] Mass–spring–damper simulator (effective mass, stiffness, damping) with Force → Mass → Spring → Damper → Ground diagram; shows resonance frequency, peak, bandwidth, conceptual response. Label: **"Conceptual Physics Model — Not MM20 Measurement"**
- [ ] Simplified acoustic lumped model (resistance, inertance, compliance, cavity compliance, damping). Label: **"Simplified Educational Acoustic Model"**. Not FEM, not a validated MM20 simulation.
- [ ] Conceptual frequency-response simulator feeding the Response tab's conceptual curve
- [ ] Conceptual parameter values (illustrative mass, stiffness, damping, etc.) stored with `scope: "conceptual"`, `evidenceType: "conceptual"`, `confidence: "medium"`, source `app-conceptual-model`. No value may be shown as MM20 internals.
- [ ] Experiments 1–6: stiffness ↑, mass ↑, damping ↑, port resistance, cavity compliance, diaphragm area. Each explains: what changed, why, which mechanism, which performance parameter, generic vs MM20-specific, supporting source. Drive explanations from relationships/equations, not hard-coded text.
- Implementation notes: pure TypeScript model code in `components/PhysicsModel/` (or `lib/physics/`) with unit tests of resonance, Q and the SDOF response against closed-form values.

### Phase 5 — Learning system ⬜
- [ ] Learning mode with the 19 lessons (data in `data/lessons/lessonNN.ts`):
  1. What is a MEMS microphone? 2. Inside a MEMS microphone 3. Acoustic port 4. Package cavity 5. Diaphragm 6. Backplate 7. Air gap and perforations 8. Mass, stiffness and damping 9. Mechanical resonance 10. Acoustic impedance 11. Acoustic–mechanical coupling 12. Capacitive transduction 13. ASIC and electrical output 14. Sensitivity 15. Frequency response 16. Noise / EIN 17. THD and acoustic overload 18. Understanding the MM20 response curve 19. Complete microphone system
- [ ] Each lesson links **theory → 3D structure → parameter → mechanism → equation → response → performance → source** via ids (lesson data holds ids, never duplicate facts)
- [ ] Guided experiments embedded in lessons
- [ ] Integration pass: 3D ↔ parameter, parameter ↔ equation, parameter ↔ response, source traceability throughout the learning flow
- [ ] Validator: lesson references resolve; every lesson step shows its sources

---

## 7. UI conventions

- Engineering-laboratory aesthetic, not marketing: monospace labels, compact panels, subtle motion, light and dark themes (theme persisted under `mems-explorer:theme`).
- Top navigation: **Learn · 3D Explorer · Response · Parameters · Physics · Experiments · Sources** (placeholders show the planned phase until built).
- Main workspace target: 3D microphone + acoustic response + selected component/parameter detail (function, mechanism, parameters, equations, relationships, performance impact, sources).
- Badges (consistent everywhere): `MM20-SPECIFIC`, `MANUFACTURER-PUBLISHED`, `VERY HIGH CONFIDENCE`; `GENERIC MEMS`, `ESTABLISHED THEORY`, `HIGH CONFIDENCE`; `CONCEPTUAL`, `DERIVED MODEL`, `NOT MM20 VALIDATED`; `NOT PUBLICLY SPECIFIED`.
- The 3D view always shows: **"Conceptual MEMS architecture"** plus the statement that only the outer envelope and port position follow the datasheet drawing.

---

## 8. Working agreements for later phases

1. **Data before UI.** Add or change facts in `src/data/**` and `src/types/**` first, then run `npm run validate`, then build UI.
2. **Single source of truth.** Relationships live only in the relationship database; component ↔ parameter links live in `structure/components.ts` and `Parameter.relatedComponents`.
3. **Never auto-assign a source** that does not actually support the statement (Rule 9). Prefer a location-specific source record (page/table/figure).
4. **No guesses about the MM20.** If the datasheet does not say it, store no value and set `mm20Status: "not_publicly_specified"`.
5. **Flag precision.** Derived, digitized, extracted or conceptual numbers carry `conditions`/`notes`/`extractionMethod` and the matching badge.
6. **Keep conceptual and manufacturer curves separate** in data, styling and wording.
7. After changes: `npm run validate`, `npm run build` (type-checks with `tsc -b`), then restart the portal server (`python run.py`) and hard-refresh the plugin.
8. Keep everything offline (no CDNs, no remote fonts, no runtime PDF parsing).

## 9. Backlog / improvement ideas
- KaTeX-rendered equations (bundled).
- Code-split Three.js so non-3D tabs load faster.
- Optional unit-test setup (Vitest) for physics code and the validator.
- Persist selected tab/component in `sessionStorage` (as other portal plugins do).
- Keyboard navigation and accessible labels for the 3D component list.
- Print/export of a lesson or a component sheet with its source list.
- Additional reference microphones (data layer is already keyed by `microphoneId`).
