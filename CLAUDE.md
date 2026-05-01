# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**OctoPerio** — Hebrew/English bilingual clinical decision support tool for Rambam Medical Center (Haifa) periodontics residents. Implements AAP/EFP 2018 staging/grading, IDRA implant-risk octagon (Heitz-Mayfield 2020), Berglundh 2018 peri-implant case definitions, Chapple 2018 stability, Tonetti 2018 case-type triage, and EFP S3 stepwise treatment recommendations (Sanz/Herrera 2020). Generates a chart-ready bilingual referral letter with ICD-10, Israeli ID, and signing-clinician block per MoH Circular 2/2012.

## Run / Build

There is no build, package manager, or test runner. To run:

- Open `index.html` directly in Chrome (`file://` works — the CSP and vendored assets are designed for offline operation).
- For testing: enter CAL 6mm, RBL 40%, Age 45, PD 7mm, Furcation III, Smoking 15 cig/day → expect Stage IV Grade C.

## Architecture — Single-File Standalone Artifact

The entire app is one HTML file (~2,300 lines) with everything inline:

- **`vendor/`** holds locally-vendored React 18.3.1, ReactDOM 18.3.1, Babel Standalone 7.25.6, and Tailwind Play 3.4.5. Plus `vendor/fonts/` with self-hosted Heebo + Inter + Caveat woff2 (no Google Fonts request at runtime). Phase 7B reserves `vendor/onnxruntime-web/` (for `ort.min.js` + WASM kernels) and `vendor/models/` (for `perio-rbl.onnx`) — both folders are referenced by lazy-loaders, so the app still works if the assets are absent (UI shows "model missing" / "runtime missing"). **Never reintroduce CDN URLs** — the CSP is `connect-src 'self'` (Phase 7B), which only permits same-origin model fetches. To add a new font: download woff2 to `vendor/fonts/`, append `@font-face` rules to `vendor/fonts/google-fonts.css` with relative `url(...)`.
- **`<script type="text/babel">`** — JSX is compiled in-browser. This forces `script-src 'unsafe-eval'` in the CSP. If you ever pre-compile, you can drop Babel and tighten CSP.

### Tabs (7 total — Phase 7A added Imaging at index 1)

`Clinical Input (0) | Imaging (1) | Periodontal Chart (2) | Diagnosis (3) | IDRA (4) | Output (5) | References (6)`. The Compute button on InputTab routes to **index 3 (Diagnosis)**. If you add or reorder tabs, update: (a) the `tabs` array in `TabBar`, (b) the `activeTab===N` switch in `App`, (c) the `setActiveTab(3)` call on the InputTab Compute button, (d) the `TAB_NAMES` array in App's `useEffect` that sets `body.tab-{name}` class.

The References tab (`RefsTab`) reads from a `REFERENCES = [...]` constant — every entry has authors/year/journal/PMID/DOI/`usedHe`/`usedEn`/`url` and links out to PubMed/WHO/MoH (`target="_blank" rel="noopener noreferrer"`). Add a new citation here whenever you anchor a new threshold to a paper.

### Code regions (in order, inside the single `<script>` block)

1. **`STRINGS = { he: {...}, en: {...} }`** — every user-facing string is keyed; `t(key)` is the lookup. Medical terms (Stage, Grade, IDRA, BOP, CAL, RBL, PD, SPT, ICD-10) intentionally stay in English in both languages. When adding a new UI string, add it to **both** `he` and `en`.
2. **`REFERENCES`** — citation list backing the References tab.
3. **`AXES`** — the 8 IDRA vectors as `\n`-split labels for SVG wrapping.
4. **Core algorithms** — `computeDiagnosis`, `computeIDRARisk`, `computePeriImplantDx`, `praRecall`, `autoCaseType`, `autoTxStatus`, `icd10For`, `s3Steps`, `validIsraeliID`, `sptIntervalKey`, `computeChartDerived`. **Each is annotated with the source paper PMID/DOI.** When changing a threshold, update the citation comment AND the matching `REFERENCES` entry.
5. **Periodontal chart constants & helpers** — `FDI_MAXILLA`/`FDI_MANDIBLE` (16-tooth arrays), `SITE_KEYS`/`BUCCAL_KEYS`/`LINGUAL_KEYS`, `blankSite`/`blankTooth`/`createBlankChart`/`loadDemoChart`. See "Periodontal chart" section below.
6. **Octagon SVG helpers** — `CX/CY/ZONE_R/LABEL_R` constants + `axPt/pts/zonePts/dataPts`. Polar coordinates, axis 0 points up, 45° clockwise per axis. Coordinate space is always LTR even in Hebrew.
7. **`makeLetter({...})`** — bilingual referral-letter generator. Two large branches (`if (lang === 'he')` / `else`). When changing letter content, change both branches. Accepts `chartFilled` + `chartDerived` so the findings block can append FMBS/FMPS/sites-≥5mm lines when the chart has data.
8. **Components** — inline SVG icons, then `FInput/FSelect/FCheck/Card/StageBadge/GradeBadge/RiskBadge/OctagonSVG/ReasoningPanel/SiteCell/ToothColumn/PerioChartTab/InputTab/DiagTab/IDRATab/OutputTab/RefsTab/Navbar/TabBar/App`. All state lives in `App` and is passed down via the `state` object + `set(key, val)` setter dispatcher. The chart has its own dedicated `chart`/`setChart` state passed through directly (not via the dispatcher).

### Staging/Grading flow (Tonetti et al. 2018)

`computeDiagnosis()` runs only when `caseType === 'periodontitis'`. Order:

1. CAL → initial stage (1=I, 2-4=II, ≥5=III)
2. %RBL → initial stage (<15=I, 15-33=II, >33=III)
3. Base stage = `max(stageCAL, stageRBL)` — never lower
4. Complexity upgrades (PD≥6, VBL≥3, Furc II/III, Mob≥2, MastDys, teeth-lost) only raise the stage
5. Grade Score = %RBL / age → A/B/C; modifiers: pack-years ≥20→C / ≥10→B (Leite 2018, PMID 29728276); HbA1c ≥8.0%→C / 7.0–7.9%→B floor (Graziani 2018, PMID 29280184); cig/day ≥10→C (Tonetti 2018)
5b. Stage IV subclassification: `stageIVSubtype` = 'IVA' (default) / 'IVB' (mobility≥2) / 'IVC' (mastDys) — returned by `computeDiagnosis`, displayed in DiagTab and letter
6. Extent: <30% teeth affected = localized, ≥30% = generalized

### IDRA octagon — risk classification

`computeIDRARisk(scores)` per Heitz-Mayfield 2020: **LOW** = all scores 1; **HIGH** = any score 3 OR ≥3 scores of 2; **MODERATE** = otherwise. The 4th vector (BL/Age ratio) auto-computes from `rblPercent / age` if blank. When the chart is filled, `bopScore` and `pdSitesScore` come from `chartDerived` instead of manual selects.

### Periodontal chart (6-PPC) — chart is the source of truth

The chart is the canonical clinical-data layer; manual worst-site fields on InputTab are fallback-only.

**Data shape** — `chart` state is FDI-keyed (`'18'..'48'`). Each tooth: `{missing, implant, mobility:0..3, furcation:0..3, prognosis:''|'G'|'F'|'Q'|'P'|'H', sites:{mb,b,db,ml,l,dl}}`. Prognosis cycles via the `px` button in `ToothCrown` (Kwok-Caton 2007, PMID 17970677); colors in `PROG_COLOR` constant. Each site: `{pd:null|number, gm:null|number, bop, sup, plaque}`. CAL is **derived** per-site (`pd + gm`, signed `gm`: positive = recession, negative = overgrowth) — never stored. `null` distinguishes "not measured" from "0mm".

**Derivation rule** — `computeChartDerived(chart)` aggregates the 192-site grid into the summary stats the engine consumes. App computes `chartFilled = chartDerived.measured > 0`. When `chartFilled`, `dx`/`idraScores`/`makeLetter` all consume derived values (`calWorst`, `maxPD`, `bopPercent`, `teethAffected`, `furcationMax`, `mobilityMax`, `pdSitesScore`); when not filled, manual InputTab fields flow through unchanged. **Don't bypass this.** New chart-driven stats should be added to `computeChartDerived` and threaded through the same `chartFilled` gate.

**FMBS / FMPS** — full-mouth bleeding score and full-mouth plaque score. Same denominator (measured sites) but different numerators. Only surface in DiagTab and the letter when `chartFilled` is true. Color-thresholds for FMBS pill: green ≤10, amber 11–30, red >30 (Chapple 2018 stability buckets).

**Coordinate space** — chart container is always `direction:ltr` regardless of UI language (FDI quadrants are spatial — same rule as the IDRA octagon). Site rows: maxilla buccal-above-crown / lingual-below; mandible mirror so buccal sites are always on the OUTER aspect of each arch.

**Chart-tab placement caveat** — the new tab landed at index 1 (between InputTab and DiagTab). When wiring new tabs, remember the `setActiveTab(2)` call on the InputTab Compute button retargets to Diagnosis; if you reorder tabs again, update that hop.

**Phase status** — Phases 1–6 shipped. Phase 5: chart heatmap, color split, touch targets, headers. Phase 6 (triad consensus): pack-years + stratified HbA1c grading, Stage IV subtypes, EFP 2023 peri-implantitis CPG (PD≥6mm criterion), per-tooth prognosis, keratinized mucosa + cement/screw fields, EFP S3 treatment plan card, PRA recall spider (Lang & Tonetti 2003), patient plain-language summary. Plan file: `C:\Users\litbe\.claude\plans\act-as-a-senior-sunny-puddle.md`.

**Phase 4 view-toggle behavior** — `chartView` initial value picks `full` (≥1024px) / `maxilla` (768–1023) / `q1` (<768) from `window.innerWidth`. A `userTouchedView` ref tracks whether the user clicked a toggle button; while it's false, a resize listener follows the viewport across breakpoints, and once it flips true the user's choice sticks across all subsequent resizes/rotations. Don't add a "reset view" button without also clearing this ref.

**Phase 3 layout note** — The arch is rendered as three full-width strips per arch (top sites / crowns / bottom sites) inside `.arch-strip-content` (the inline-flex content wrapper). A `<RowOverlay>` SVG sits absolutely-positioned inside each sites strip and draws PD/GM polylines using analytical x-positions (tooth pitch 71px, cell pitch 23px, first-cell offset 11px, PD center y=9, GM center y=28, row height 47). Missing teeth render as a `tooth-sites missing` placeholder so strip alignment with the crown row is preserved. If you change cell/tooth widths in CSS, update the `RowOverlay` constants to match.

**Phase 3 keyboard map** — Cells expose stable IDs `perio-${fdi}-${siteKey}-${field}` so the keyboard navigator (in `PerioChartTab.handleKey`) can refocus across teeth without ref plumbing. ←→ jumps sites within the same row+arch (skipping missing teeth); ↑↓ swaps PD↔GM within the same site; Enter advances PD→GM→next-site-PD; b/s/p toggle BOP/SUP/Plaque; f/m cycle furcation/mobility on the focused tooth; x/i toggle missing/implant; g switches PD↔GM (alias for ↑↓); Esc blurs. Modifier keys (ctrl/alt/meta) are skipped so OS combos still work. Every tooth-level write announces via the `<div className="last-action-toast">` (1.5s fade) AND a sr-only `role="status" aria-live="polite"` region for screen readers.

### RTL / LTR rules (don't break these)

- `<html lang dir>` flips at runtime via `toggleLang()`. Always flip both attributes.
- Number inputs hard-locked to `direction:ltr; font-family:Inter` via the global `input[type="number"]` rule.
- Stage/Grade/Risk badges, the diagnosis line, and the entire SVG octagon are explicitly `direction:ltr` regardless of language.
- Hebrew numerics in body text use the `.clinical-num` utility class (LTR + Inter + tabular-nums).
- SVG axis labels are always English in LTR coordinate space.

### Bilingual letter

`makeLetter()` non-periodontitis branches (health/gingivitis/NPD/endo-perio) emit a different body — do not assume `stage`/`grade` are present. Always check `caseType === 'periodontitis'` before accessing `dx.stage`.

## Security posture

- **CSP** (`<meta http-equiv="Content-Security-Policy">`): `connect-src 'self'` (Phase 7B — same-origin only, no third-party network), `frame-ancestors 'none'`, `form-action 'none'`, `font-src 'self'`, `script-src 'self' 'unsafe-eval' 'unsafe-inline' 'wasm-unsafe-eval'` (Babel + Tailwind Play + ONNX Runtime WASM), `worker-src 'self' blob:` (ONNX Runtime spawns workers from blob URLs), `img-src 'self' data: blob:`. Phase 7C will add `https://api.anthropic.com` to `connect-src` for opt-in cloud mode. Don't loosen further without thinking.
- **No persistence** — no `localStorage`, `sessionStorage`, `cookie`, `XMLHttpRequest`, `sendBeacon`. State lives in React memory and dies on tab close. The only network call permitted in Phase 7B is a same-origin `fetch()` for `vendor/models/perio-rbl.onnx` and `vendor/onnxruntime-web/ort.min.js` — patient images never leave the browser in offline mode. Don't add other network calls.
- **XSS** — patient input is rendered via JSX text interpolation or `<textarea readOnly value={letter}>`. No `dangerouslySetInnerHTML`, no `innerHTML`. Don't introduce them.

## Print pipeline

Two-element pattern: the screen shows `<textarea>` editable-feel; print swaps to `<pre className="print-only print-letter">` for clean page-break-aware flow. CSS in the `<style>` block hides `.no-print` and the textarea on print, reveals `.print-only`. There is also a `.print-header` block (patient name + diagnosis + date) that only appears on the printed page. The author signature watermark uses `.no-print` so it never lands on a clinical document.

## Author signature watermark

`.author-signature` is a fixed-position element rendered once at the end of `App` (after the active tab content). It uses Caveat (handwriting font, vendored woff2) for the name and Inter for the "CREATED BY" prefix. It is positioned via `inset-inline-end` so it tracks the active language direction automatically, has `pointer-events:none`, and carries `.no-print`. Don't move it into individual tabs — it lives at the App root precisely so it appears on every tab without duplication.

## DiagTab props (Phase 6+)

`DiagTab` now requires: `dx, caseType, txStatus, icd, chartFilled, chartDerived, risk, st, age, blAgeComp, lang, t`. The `lang` prop is **required** for language branching inside JSX — do not use `t('btnLang')==='EN'` as a language check (that returns the button label, not the language code).

## makeLetter signature (Phase 6+)

Now accepts `stageIVSubtype`, `kmWidth`, `cementRetained` in addition to the Phase 1–5 params. Update both `he` and `en` branches when adding new findings lines.

## Peri-implant (Phase 6+)

`computePeriImplantDx` now accepts `piPD` (implant probing depth). EFP 2023 criterion: peri-implantitis = BOP/SUP + (BL≥3mm or BL≥2mm with baseline, **OR** PD≥6mm). New InputTab fields: `piPD`, `kmWidth`, `cementRetained` — all in App state and SETTERS map.

## PRA recall (Phase 6+)

`praRecall({bopPct, sites5plus, teethLost, blAge, smokingCigs, packYears, hba1c})` returns `{scores, highN, recallEn, recallHe, FACTORS}`. Called in DiagTab — needs `blAgeComp` passed from App, not recomputed inside the tab.

## Phase 7 — Imaging tab (radiographic AI)

**Status:** Phase 7A (file viewer) and Phase 7B (offline ONNX path scaffold) shipped. Phase 7C (cloud opt-in) and 7D (polish + a11y) deferred.

**Tab placement:** Imaging is at index 1 (between InputTab and PerioChartTab). All `setActiveTab(N)` calls and the `TAB_NAMES` array assume this ordering — see the Tabs section above.

**State (App-level, all in React memory, never persisted):**
- `imagingFile = { name, type, size, dataUrl, width, height } | null`
- `imagingMode = 'offline' | 'cloud'` (cloud disabled until 7C)
- `imagingResult = { rblEstimate, worstSiteRbl, vblEstimate, perToothMedian, confidence, source } | null`
- `imagingApplied = boolean` — flips true only when user explicitly clicks Apply

**Derived gate (`imagingFilled` / `imagingDerived`)** mirrors the chart pattern. Crucial rule: `imagingFilled = imagingApplied && !imagingDerived.isDemo`. Demo results never reach the engine or the letter — they exist purely to test the pipeline before a real `.onnx` lands.

**Inference plumbing:**
- `loadOnnxRuntime()` lazy-loads `vendor/onnxruntime-web/ort.min.js` once. Throws `RUNTIME_MISSING` if absent.
- `getOnnxSession()` creates an `ort.InferenceSession` from `vendor/models/perio-rbl.onnx` with `executionProviders: ['webgpu', 'wasm']`. Throws `MODEL_MISSING` if file absent.
- `canvasToTensor(canvas, 640, ort)` does letterboxed resize → CHW Float32Array normalized to [0,1].
- `runOnnxInference(canvas)` returns `{rblEstimate, worstSiteRbl, vblEstimate, perToothMedian, confidence, source:'onnx'}` or throws (`RUNTIME_MISSING` / `MODEL_MISSING` / `INFERENCE_FAILED`). The UI maps each error to a specific bilingual message.
- **`postprocessOnnxOutput(_output)` is a stub that returns `[]`** — this forces `INFERENCE_FAILED` until you replace its body with NMS + landmark grouping (CEJ / ABC / apex per tooth) matching whatever model head actually ships. Per-tooth %RBL = (ABC.y − CEJ.y) / (apex.y − CEJ.y) × 100; median = overall, max = worst-site, VBL ≈ (worst − median) scaled.

**Demo path** (`generateDemoImagingResult`) returns hard-coded numbers tagged `source:'demo'`. The Findings panel renders a "DEMO" badge and the `imagingFilled` gate excludes demo results — so the letter never picks them up. Use this to exercise Findings → Apply → InputTab pill → letter end-to-end without the real model.

**Apply flow:**
- ImagingTab Apply button: writes `rblEstimate → rblPercent` and `vblEstimate → vbl` via `handleImagingApply`, then sets `imagingApplied=true` locally.
- InputTab pill (top of Periodontal Findings card): only renders when `imagingResult && !imagingApplied`. Clicking it calls `handleImagingApplyFromInputPill` which does the same write **and** flips `imagingApplied`. The pill disappears after one click.
- Both routes converge — never write to `rblPercent`/`vbl` automatically. Click-through is mandatory.

**makeLetter signature** now takes `imagingFilled, imagingDerived` in addition to Phase 1–6 params. Both `he` and `en` branches emit a "Radiographic Findings (AI-assisted)" / "ממצאים רדיוגרפיים (בסיוע AI)" block with confidence label and a "Suggestion only — clinician confirmation required" disclaimer. Block only appears when `imagingFilled` is true.

**Vendor assets to ship for production offline path:**
- `vendor/onnxruntime-web/ort.min.js` (+ accompanying `.wasm` files in same folder) — ONNX Runtime Web, MIT license
- `vendor/models/perio-rbl.onnx` — quantized YOLOv8s finetuned on DENTEX + Tufts Dental
- Replace `postprocessOnnxOutput` body to match the model's actual output head

**CSP changes (Phase 7B):** `connect-src 'none'` → `'self'`; added `'wasm-unsafe-eval'` (script-src) and `worker-src 'self' blob:` (ONNX Runtime spawns Web Workers from blob URLs); `img-src` extended with `blob:`. See Security posture above.

**References added:** Krois 2019 (PMID 31186466) — CNN bone-loss detection. Schwendicke 2020 (PMID 32092430) — DL/clinician concordance, justifies "AI-assisted" framing.

## Session recovery tip

If a session was compacted mid-implementation, triad-debate and subagent outputs live in `.claude/projects/<session-id>/subagents/*.jsonl`. Grep for `"text":` to recover consensus proposals without re-running the debate.

## Conventions

- All thresholds are anchored to a citation comment (PMID or DOI). Match this style for any new clinical logic.
- Adding a new UI feature: thread props through App → child tab → component. Don't add new top-level state outside `App`.
- Adding a new bilingual string: add to both `STRINGS.he` and `STRINGS.en`. Never hardcode Hebrew or English in JSX — use `t('key')`.
- Vendoring more libraries: drop the file into `vendor/`, reference with relative path, never use `unpkg`/`cdn` URLs.
- **Language detection in JSX**: use the `lang` prop directly (e.g., `lang==='he'`), not `t('btnLang')`. Pass `lang` explicitly to any tab component that needs to branch on language inside JSX.
