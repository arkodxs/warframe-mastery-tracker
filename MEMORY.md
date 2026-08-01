# Repository Memory (AI-Oriented)

## Purpose
- Browser-only Warframe mastery tracker.
- Local-first; no project backend.

## Runtime architecture
- Main entry: `index.html`.
- Core runtime state/persistence: `js/app.js`.
- Item data normalization/classification: `js/data.js`.
- Supplementary modules: `js/math.js`, `js/calculator.js`, `js/starchart.js`, `js/planner.js`.

## Storage model
- IndexedDB cache DB: `wft3-cache`, store `cache`.
- IndexedDB user DB: `wft3-user`, store `user`.
- Cache record shape: `{ k, v, t }`.
- Primary user record: key `userData`, payload `ST.userData`.
- User fallback backup: localStorage key `wft3_userdata`.

## LocalStorage keys in active use
- `wft3_playerid` (saved player id)
- `wft3_profile` (last imported raw profile JSON)
- `wft3_calc_open` (UI state)
- `wft_auto_audit` (optional dev auto-audit switch)

## Cache policy (code truth)
- `CACHE_TTL = 7 days`
- `MISSION_DB_TTL = 30 days`
- Applies to cached remote datasets; stale/missing cache triggers re-fetch.

## External runtime data sources
- Item feed: `wfcd/warframe-items` -> `All.json`.
- Patchlog/update names: `WFCD/warframe-patchlogs`.
- Node data: `WFCD/warframe-worldstate-data` -> `solNodes.json`.
- Mission data: Warframe wiki parse endpoint (`Module:Missions/data`).
- Player profile import source: DE profile endpoint with `playerId`.

## Item extraction + counting pipeline
- Runtime item catalog built from external item feed, not static bundle.
- Pipeline: classify -> filter junk/noise -> rescue edge cases -> dedupe by name -> normalize.
- Final map cached as `item_db` and consumed by `enrichAll()`.
- Category counts are computed from normalized final set, not raw upstream length.
- Validation helpers:
  - `validateItemCounts(db)`
  - `explainCategoryMismatch(category, db)`

## Testharness scope (non-runtime)
- `testharness/` scripts are analysis/research tooling only.
- Includes crafting/blueprint scraping and weapon tag lab outputs.
- Outputs to `testharness/out/`; does not persist end-user app state.

## Important invariants
- All end-user app data stays client-side unless user exports file.
- Cache DB and user DB intentionally separated.
- Rank-40 items may require manual rank overrides (XP alone can mislead).

## Known limitations / risks
- Mission wiki parsing is brittle to wiki format changes.
- Third-party upstream feeds are availability/schema dependency.
- User state is browser/device scoped unless exported/imported.
- `saveUserData()` is event-driven and can be write-heavy.

## Current improvement priorities
- Replace brittle mission parsing with bundled/versioned mission dataset.
- Add schema validation for imported profile JSON.
- Consider write coalescing/debouncing for user persistence paths.
