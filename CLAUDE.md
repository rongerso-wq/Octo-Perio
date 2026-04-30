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

- **`vendor/`** holds locally-vendored React 18.3.1, ReactDOM 18.3.1, Babel Standalone 7.25.6, and Tailwind Play 3.4.5. Plus `vendor/fonts/` with self-hosted Heebo + Inter + Caveat woff2 (no Google Fonts request at runtime). **Never reintroduce CDN URLs** — the strict CSP (`connect-src 'none'`) makes this a true zero-third-party offline artifact for clinical use. To add a new font: download woff2 to `vendor/fonts/`, append `@font-face` rules to `vendor/fonts/google-fonts.css` with relative `url(...)`.
- **`<script type="text/babel">`** — JSX is compiled in-browser. This forces `script-src 'unsafe-eval'` in the CSP. If you ever pre-compile, you can drop Babel and tighten CSP.

### Tabs (6 total)

`Clinical Input | Periodontal Chart | Diagnosis | IDRA | Output (referral letter) | References`. **The chart is index 1** — between Input and Diagnosis. If you add or reorder tabs, also update: (a) the `tabs` array in `TabBar`, (b) the `activeTab===N` switch in `App`, (c) the `setActiveTab(2)` call on the InputTab compute button (it routes to Diagnosis, currently index 2), (d) the `TAB_NAMES` array in App's `useEffect` that sets `body.tab-{name}` class.

The References tab (`RefsTab`) reads from a `REFERENCES = [...]` constant — every entry has authors/year/journal/PMID/DOI/`usedHe`/`usedEn`/`url` and links out to PubMed/WHO/MoH (`target="_blank" rel="noopener noreferrer"`). Add a new citation here whenever you anchor a new threshold to a paper.

### Code regions (in order, inside the single `<script>` block)

1. **`STRINGS = { he: {...}, en: {...} }`** — every user-facing string is keyed; `t(key)` is the lookup. Medical terms (Stage, Grade, IDRA, BOP, CAL, RBL, PD, SPT, ICD-10) intentionally stay in English in both languages. When adding a new UI string, add it to **both** `he` and `en`.
2. **`REFERENCES`** — citation list backing the References tab.
3. **`AXES`** — the 8 IDRA vectors as `\n`-split labels for SVG wrapping.
4. **Core algorithms** — `computeDiagnosis`, `computeIDRARisk`, `computePeriImplantDx`, `autoCaseType`, `autoTxStatus`, `icd10For`, `s3Steps`, `validIsraeliID`, `sptIntervalKey`, `computeChartDerived`. **Each is annotated with the source paper PMID/DOI.** When changing a threshold, update the citation comment AND the matching `REFERENCES` entry.
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
5. Grade Score = %RBL / age → A/B/C; smoking ≥10/day or HbA1c ≥7.0% auto-upgrade to C
6. Extent: <30% teeth affected = localized, ≥30% = generalized

### IDRA octagon — risk classification

`computeIDRARisk(scores)` per Heitz-Mayfield 2020: **LOW** = all scores 1; **HIGH** = any score 3 OR ≥3 scores of 2; **MODERATE** = otherwise. The 4th vector (BL/Age ratio) auto-computes from `rblPercent / age` if blank. When the chart is filled, `bopScore` and `pdSitesScore` come from `chartDerived` instead of manual selects.

### Periodontal chart (6-PPC) — chart is the source of truth

The chart is the canonical clinical-data layer; manual worst-site fields on InputTab are fallback-only.

**Data shape** — `chart` state is FDI-keyed (`'18'..'48'`). Each tooth: `{missing, implant, mobility:0..3, furcation:0..3, sites:{mb,b,db,ml,l,dl}}`. Each site: `{pd:null|number, gm:null|number, bop, sup, plaque}`. CAL is **derived** per-site (`pd + gm`, signed `gm`: positive = recession, negative = overgrowth) — never stored. `null` distinguishes "not measured" from "0mm".

**Derivation rule** — `computeChartDerived(chart)` aggregates the 192-site grid into the summary stats the engine consumes. App computes `chartFilled = chartDerived.measured > 0`. When `chartFilled`, `dx`/`idraScores`/`makeLetter` all consume derived values (`calWorst`, `maxPD`, `bopPercent`, `teethAffected`, `furcationMax`, `mobilityMax`, `pdSitesScore`); when not filled, manual InputTab fields flow through unchanged. **Don't bypass this.** New chart-driven stats should be added to `computeChartDerived` and threaded through the same `chartFilled` gate.

**FMBS / FMPS** — full-mouth bleeding score and full-mouth plaque score. Same denominator (measured sites) but different numerators. Only surface in DiagTab and the letter when `chartFilled` is true. Color-thresholds for FMBS pill: green ≤10, amber 11–30, red >30 (Chapple 2018 stability buckets).

**Coordinate space** — chart container is always `direction:ltr` regardless of UI language (FDI quadrants are spatial — same rule as the IDRA octagon). Site rows: maxilla buccal-above-crown / lingual-below; mandible mirror so buccal sites are always on the OUTER aspect of each arch.

**Chart-tab placement caveat** — the new tab landed at index 1 (between InputTab and DiagTab). When wiring new tabs, remember the `setActiveTab(2)` call on the InputTab Compute button retargets to Diagnosis; if you reorder tabs again, update that hop.

**Phase status** — All four phases shipped: Phase 1 (UI + capture), Phase 2 (derivation + integration), Phase 3 (SVG PD/GM line overlays + keyboard hotkeys + last-action toast + aria-live), Phase 4 (view toggle Full/Maxilla/Mandible/Q1–Q4 with viewport-aware default + auto-resize-until-touched, landscape print page via `@page chart-landscape` + `body.tab-chart` print rules, full ARIA grid roles). The plan file at `C:\Users\litbe\.claude\plans\act-as-a-senior-sunny-puddle.md` has the full spec.

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

- **CSP** (`<meta http-equiv="Content-Security-Policy">`): `connect-src 'none'`, `frame-ancestors 'none'`, `form-action 'none'`, `font-src 'self'`, `script-src 'self' 'unsafe-eval' 'unsafe-inline'` (Babel + Tailwind Play need both). Don't loosen without thinking.
- **No persistence** — no `localStorage`, `sessionStorage`, `cookie`, `fetch`, `XMLHttpRequest`, `sendBeacon`. State lives in React memory and dies on tab close. Patient data never leaves the browser. Don't add network calls.
- **XSS** — patient input is rendered via JSX text interpolation or `<textarea readOnly value={letter}>`. No `dangerouslySetInnerHTML`, no `innerHTML`. Don't introduce them.

## Print pipeline

Two-element pattern: the screen shows `<textarea>` editable-feel; print swaps to `<pre className="print-only print-letter">` for clean page-break-aware flow. CSS in the `<style>` block hides `.no-print` and the textarea on print, reveals `.print-only`. There is also a `.print-header` block (patient name + diagnosis + date) that only appears on the printed page. The author signature watermark uses `.no-print` so it never lands on a clinical document.

## Author signature watermark

`.author-signature` is a fixed-position element rendered once at the end of `App` (after the active tab content). It uses Caveat (handwriting font, vendored woff2) for the name and Inter for the "CREATED BY" prefix. It is positioned via `inset-inline-end` so it tracks the active language direction automatically, has `pointer-events:none`, and carries `.no-print`. Don't move it into individual tabs — it lives at the App root precisely so it appears on every tab without duplication.

## Conventions

- All thresholds are anchored to a citation comment (PMID or DOI). Match this style for any new clinical logic.
- Adding a new UI feature: thread props through App → child tab → component. Don't add new top-level state outside `App`.
- Adding a new bilingual string: add to both `STRINGS.he` and `STRINGS.en`. Never hardcode Hebrew or English in JSX — use `t('key')`.
- Vendoring more libraries: drop the file into `vendor/`, reference with relative path, never use `unpkg`/`cdn` URLs.
