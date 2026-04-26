# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**OctoPerio** — Hebrew/English bilingual clinical decision support tool for Rambam Medical Center (Haifa) periodontics residents. Implements AAP/EFP 2018 staging/grading, IDRA implant-risk octagon (Heitz-Mayfield 2020), Berglundh 2018 peri-implant case definitions, Chapple 2018 stability, Tonetti 2018 case-type triage, and EFP S3 stepwise treatment recommendations (Sanz/Herrera 2020). Generates a chart-ready bilingual referral letter with ICD-10, Israeli ID, and signing-clinician block per MoH Circular 2/2012.

## Run / Build

There is no build, package manager, or test runner. To run:

- Open `OctoPerio.html` directly in Chrome (`file://` works — the CSP and vendored assets are designed for offline operation).
- For testing: enter CAL 6mm, RBL 40%, Age 45, PD 7mm, Furcation III, Smoking 15 cig/day → expect Stage IV Grade C.

## Architecture — Single-File Standalone Artifact

The entire app is one HTML file (~1,500 lines) with everything inline:

- **`vendor/`** holds locally-vendored React 18.3.1, ReactDOM 18.3.1, Babel Standalone 7.25.6, and Tailwind Play 3.4.5. Plus `vendor/fonts/` with self-hosted Heebo + Inter + Caveat woff2 (no Google Fonts request at runtime). **Never reintroduce CDN URLs** — the strict CSP (`connect-src 'none'`) makes this a true zero-third-party offline artifact for clinical use. To add a new font: download woff2 to `vendor/fonts/`, append `@font-face` rules to `vendor/fonts/google-fonts.css` with relative `url(...)`.
- **`<script type="text/babel">`** — JSX is compiled in-browser. This forces `script-src 'unsafe-eval'` in the CSP. If you ever pre-compile, you can drop Babel and tighten CSP.

### Tabs (5 total)

`Clinical Input | Diagnosis | IDRA | Output (referral letter) | References`. The References tab (`RefsTab`) reads from a `REFERENCES = [...]` constant — every entry has authors/year/journal/PMID/DOI/`usedHe`/`usedEn`/`url` and links out to PubMed/WHO/MoH (`target="_blank" rel="noopener noreferrer"`). Add a new citation here whenever you anchor a new threshold to a paper.

### Code regions (in order, inside the single `<script>` block)

1. **`STRINGS = { he: {...}, en: {...} }`** — every user-facing string is keyed; `t(key)` is the lookup. Medical terms (Stage, Grade, IDRA, BOP, CAL, RBL, PD, SPT, ICD-10) intentionally stay in English in both languages. When adding a new UI string, add it to **both** `he` and `en`.
2. **`REFERENCES`** — citation list backing the References tab.
3. **`AXES`** — the 8 IDRA vectors as `\n`-split labels for SVG wrapping.
4. **Core algorithms** — `computeDiagnosis`, `computeIDRARisk`, `computePeriImplantDx`, `autoCaseType`, `autoTxStatus`, `icd10For`, `s3Steps`, `validIsraeliID`, `sptIntervalKey`. **Each is annotated with the source paper PMID/DOI.** When changing a threshold, update the citation comment AND the matching `REFERENCES` entry.
5. **Octagon SVG helpers** — `CX/CY/ZONE_R/LABEL_R` constants + `axPt/pts/zonePts/dataPts`. Polar coordinates, axis 0 points up, 45° clockwise per axis. Coordinate space is always LTR even in Hebrew.
6. **`makeLetter({...})`** — bilingual referral-letter generator. Two large branches (`if (lang === 'he')` / `else`). When changing letter content, change both branches.
7. **Components** — inline SVG icons, then `FInput/FSelect/FCheck/Card/StageBadge/GradeBadge/RiskBadge/OctagonSVG/ReasoningPanel/InputTab/DiagTab/IDRATab/OutputTab/RefsTab/Navbar/TabBar/App`. All state lives in `App` and is passed down via the `state` object + `set(key, val)` setter dispatcher.

### Staging/Grading flow (Tonetti et al. 2018)

`computeDiagnosis()` runs only when `caseType === 'periodontitis'`. Order:

1. CAL → initial stage (1=I, 2-4=II, ≥5=III)
2. %RBL → initial stage (<15=I, 15-33=II, >33=III)
3. Base stage = `max(stageCAL, stageRBL)` — never lower
4. Complexity upgrades (PD≥6, VBL≥3, Furc II/III, Mob≥2, MastDys, teeth-lost) only raise the stage
5. Grade Score = %RBL / age → A/B/C; smoking ≥10/day or HbA1c ≥7.0% auto-upgrade to C
6. Extent: <30% teeth affected = localized, ≥30% = generalized

### IDRA octagon — risk classification

`computeIDRARisk(scores)` per Heitz-Mayfield 2020: **LOW** = all scores 1; **HIGH** = any score 3 OR ≥3 scores of 2; **MODERATE** = otherwise. The 4th vector (BL/Age ratio) auto-computes from `rblPercent / age` if blank.

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
