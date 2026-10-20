# Project Structure and Data Flow (Current)

## 1) What "database" means in this project

This app does not use a server-side database.

It runs fully in the browser and uses:
- IndexedDB for structured local storage
- localStorage for small values and fallback backup
- Remote JSON sources only for read-only data fetches

Runtime DBs are created client-side via IndexedDB.open:
- `wft3-cache` (object store: `cache`)
- `wft3-user` (object store: `user`)

Implementation references:
- `openCacheDB()` and `openUserDB()` in `js/app.js`

## 2) End-to-end data flow

```mermaid
flowchart TD
  A[User imports profile JSON] --> B[parseProfile]
  B --> C[loadAndShow]
  C --> D[fetchItemDb + fetchUpdateNames]
  C --> E[fetchMissionDb + loadNodeDb]

  D --> F[(IndexedDB wft3-cache)]
  E --> F

  C --> G[enrichAll profile XP with item DB]
  G --> H[Render items, planner, stats]

  I[User actions: stars, notes, lists, rank overrides, settings] --> J[saveUserData]
  J --> K[(IndexedDB wft3-user)]
  J --> L[(localStorage fallback backup)]

  M[App startup] --> N[loadUserData]
  N --> K
  N -->|fallback if needed| L
  N --> O[restore runtime mirrors and UI settings]
```

## 3) Database creation method and when it happens

### IndexedDB creation
- Method: `indexedDB.open(name, version)`
- Trigger: first call to DB helper functions in a browser session
- Object stores are created in `onupgradeneeded`:
  - `wft3-cache` -> `cache`
  - `wft3-user` -> `user`

Where this is defined:
- `js/app.js` in `openCacheDB()` and `openUserDB()`

### Cache records schema (in `cache` store)
Each cache entry is stored as:
- `k`: key (string)
- `v`: payload (object)
- `t`: write timestamp (Date.now ms)

Written through:
- `dbSet('cache', key, value)`

### User records schema (in `user` store)
Main user payload is stored under key `userData`:
- object shape: `{ k: 'userData', v: ST.userData, t: timestamp }`

Written through:
- `userDbSet('userData', ST.userData)` via `saveUserData()`

## 4) How often data is created/refreshed

### On app load
- `window.load` -> `loadUserData()` always runs
- If localStorage has `wft3_profile`, app auto-parses it and runs `loadAndShow()`

### Cache refresh frequency (TTL-based)
Current constants in code:
- `CACHE_TTL = 7 days`

What this affects:
- `item_db_v2` cache validity: 7 days (12 hours if partial)
- `update_names` cache validity: 7 days
- `node_db` cache validity: 7 days
- `mission_db_v3` has no TTL: `data/nodes.json` is revalidated on every load
  (`cache: 'no-cache'`), and the cached copy is only used if that request fails.

Behavior:
- If cached value exists and `Date.now() - t < TTL`, use cache
- Otherwise fetch remote source and overwrite cache entry

### User data write frequency
`saveUserData()` is called on many UI events, including:
- star/unstar
- notes edits
- rank overrides
- list create/delete/add
- planner settings changes
- manual intrinsic/plexus values
- end of `loadAndShow()` sync

Effective frequency:
- Event-driven (immediate writes per action)
- No debounce or batch queue at present

## 5) Where user data is stored

### Primary storage
- IndexedDB DB: `wft3-user`
- Object store: `user`
- Key: `userData`
- Payload: `ST.userData` (versioned; currently version 4)
- Migrations: `migrateUserData()` in `js/app.js` upgrades stored, localStorage-recovered
  and imported data step by step via `USER_DATA_MIGRATIONS` (v3 → v4 moves user data
  off the PvP Zaw tip and Doppelganger Grimoire paths). Data from a newer app version is rejected.

### Fallback/backup storage
- localStorage key: `wft3_userdata`
- Purpose: recovery if IndexedDB user store was cleared
- Recovery path: `loadUserData()` loads localStorage fallback, then rehydrates IndexedDB

### Other localStorage keys in use
- `wft3_playerid`: saved player ID for refresh flow
- `wft3_profile`: last imported raw profile JSON (used for auto-restore on reload)
- `wft3_calc_open`: UI state for calculator panel open/closed
- Legacy migration keys read/removed by `migrateOldData()`:
  - `wft3`
  - `wft3_overrides`
  - `wft3_sp`

## 6) External data sources (read-only)

Fetched at runtime when cache is stale/missing:
- Item database JSON:
  - `https://raw.githubusercontent.com/wfcd/warframe-items/master/data/json/<Category>.json` (11 files, see 7.1)
- Update names/patchlogs:
  - `https://raw.githubusercontent.com/WFCD/warframe-patchlogs/master/data/patchlogs.json`
- Star chart nodes:
  - `https://raw.githubusercontent.com/WFCD/warframe-worldstate-data/master/data/solNodes.json`
- Node metadata + mastery XP (same origin, built offline — see 6.2):
  - `data/nodes.json`

User profile source (manual fetch by user):
- `http://content.warframe.com/dynamic/getProfileViewingData.php?playerId=...`

## 6.1) Explicit consumed fields (star chart pipeline)

This section lists fields currently consumed by code for star chart construction.

### A) `solNodes.json` (WFCD worldstate nodes)

Consumed:
- Object key/tag from `Object.entries(nodeDb)` (used as node ID, e.g. `SolNode130`)
- `node.type` or `node.missionType` (mission type inference)
- `node.value` (parsed into display name and optional planet suffix)
- `node.planet` (primary planet source)
- `node.systemName` (planet fallback source)

Not currently consumed:
- `uniqueName`
- `name`
- `systemIndex`
- `nodeType`
- `masteryReq`
- `missionIndex`
- `factionIndex`
- `minEnemyLevel`
- `maxEnemyLevel`

### B) `data/nodes.json` (mission DB, `ST.missionDb`)

Consumed per node (keyed by node ID):
- `name`, `planet`, `type`, `enemy`, `minLevel`, `maxLevel`
- `masteryExp` (+ `xpSource`: `wiki`, `export` = unconfirmed, or `none`)

Used for:
- Node display metadata enrichment (type/enemy/levels)
- Mastery XP per node

Note: `solNodes.json` still decides which nodes the star chart draws, and junctions
come from the hardcoded `JUNCTION_MANIFEST` in `processStarChart()`.

### C) Imported player profile (`Missions` array)

Consumed per mission row:
- `Tag` (node ID mapping)
- `Tier` (Steel Path inference)
- `Completes` (completion count shown in node detail)

## 6.2) Node data build (`build_nodes.py`, scheduled)

`.github/workflows/build-nodes.yml` runs `build_nodes.py` weekly (Mondays 06:17 UTC,
or manually) and commits `data/nodes.json` when the data changed. Git history is the
backup and version log; each commit is labelled with the latest patchlog update name
and DE's worldstate `BuildLabel`.

Sources:
- Public Export Plus (`calamity-inc/warframe-public-export-plus`, branch `senpai`):
  `ExportRegions.json`, `ExportFactions.json`, `dict.en.json`
- Wiki `Module:Missions/data` (mastery XP)

Field precedence:

| Field | First choice | Fallback |
|---|---|---|
| Which nodes exist | Export, plus any wiki node with XP > 0 | — |
| name, planet | Export + `dict.en.json` | Wiki, then raw ID |
| type | Export `missionName` + dict | Wiki |
| enemy | Wiki (player-facing names, e.g. "Infested") | Export `faction` + `ExportFactions` + dict |
| levels | Export | Wiki |
| masteryExp | Wiki | Export (`xpSource: "export"`, unconfirmed) |

The export reports 0 XP for every junction (real value 1000), so wiki XP wins.
A node only one source knows about, with no evidence of XP, goes in `excluded`.

Failure and alerts:
- A source that can't be fetched or parsed exits 2 without writing; the job fails
  and the previous file stays live.
- Changes that move a mastery total (node with XP added/removed, XP changed, new
  export-only XP node, new wiki/export disagreement) open a GitHub issue.

`data/node-mastery.json` is the previous wiki-only XP map; no longer read by the app.

## 7) How warframe/weapon names, metadata, and recipes are extracted

This project has two separate extraction paths:
- Runtime extraction (used by the live app UI)
- Testharness extraction (used for research/audits, not required for normal app use)

### 7.1 Runtime extraction (names + metadata used in app)

Source feed (WFCD stopped publishing the combined `All.json` in 2026 — "too large"):
- `https://raw.githubusercontent.com/wfcd/warframe-items/master/data/json/<Category>.json`
  for each of `ITEM_SOURCE_FILES`: Warframes, Primary, Secondary, Melee, Arch-Gun,
  Arch-Melee, Archwing, Pets, Sentinels, SentinelWeapons, Misc.
  (`Misc` is required: kitgun chambers and K-Drive decks live there.)

High-level pipeline:
1. `fetchItemDb()` cache-loads, or `fetchItemSources()` downloads all source files in parallel.
   A failed file is recorded in `missing`; the DB is built from the files that loaded.
2. `isTrackable(item)` keeps items with WFCD's `masterable === true`, plus path-based
   add-backs WFCD gets wrong (amp prisms, Infested kitgun chambers, Venari), and drops
   enemy copies (`doppelganger` paths).
3. `classifyItem(item)` maps WFCD's coarse categories onto tracker categories
   (Zaws, Kitguns, MOAs, Hounds, Kubrow/Kavat/etc., Sentinel Weapons, Amps, Necramechs, K-Drive).
4. Entries are deduplicated by lowercase item name, keeping the highest-score candidate.
5. Final map is cached as `item_db_v2` = `{ items, missing }`. A partial DB
   (`missing` non-empty) expires after 12 hours; a complete one after 7 days.
   If every file fails, nothing is cached and the UI shows an error banner.

What is kept for each final item record:
- `name`
- `apiCat` (normalized gameplay category)
- `introduced` (update/version label text)
- `majorUpdate` (parsed major version)
- `maxRank` (30 or 40 based on item rules)

Dedup logic details:
- A score is computed from mastery value plus heuristics.
- Newer/clearer canonical entries are preferred.
- NPC-like entries are penalized.
- Winner per unique lowercase name is persisted.

Resulting runtime structure:
- `item_db` is a path-keyed object used by `enrichAll()` to combine:
  - item metadata (from item DB)
  - player XP/progress (from imported profile JSON)

### 7.2 Recipe/component extraction (testharness path)

Important: the normal app runtime does not currently depend on full recipe extraction for all weapons/warframes.

Recipe-style data is gathered in `testharness/` scripts for analysis work:
- `testharness/scrape-weapon-crafting.js`
  - Calls Warframe wiki API parse endpoint per weapon page
  - Parses infobox fields using Cheerio
  - Extracts blueprint cost/components/source where available
- `testharness/run-weapon-tag-lab.js`
  - Loads baseline item names from `testharness/base_wft3-cache.json`
  - Combines with `testharness/blueprint-data.json`
  - Produces tag and resource outputs under `testharness/out/`

So, for "all item names/categories" the source of truth is runtime item DB extraction,
while recipe/component depth is currently a research pipeline in testharness.

## 8) How category counts are found and checked

Category counts are derived after normalization/classification, not from a raw upstream count.

Process:
1. Build normalized `item_db` from the WFCD category files after filtering/classifying/dedup.
2. Iterate final records and count by `apiCat`.
3. Compare computed counts against `ITEM_EXPECTED_COUNTS` reference values.

Validation helpers:
- `validateItemCounts(db)`
  - Logs mismatches: expected vs actual per category.
- `explainCategoryMismatch(category, db)`
  - Prints category item list and summary for debugging.

When it runs:
- Manual via audit flow (for example `auditDatabase()` calls validation).
- Optional auto-audit if localStorage flag is set:
  - `localStorage['wft_auto_audit'] = '1'`

Why this matters:
- Upstream feeds include non-mastery/noise entries.
- Category count truth in this project is "post-normalization gameplay set," not "raw upstream length."

## 9) Dev/testharness data generation (not runtime user DB)

The `testharness/` scripts are Node-side tooling for analysis/research outputs, e.g.:
- scraping/assembling crafting or tag lab data
- writing JSON/HTML artifacts under `testharness/out/`

This is separate from browser runtime storage and does not store end-user app state.

## 10) Critical review notes

1. No server persistence means all user state is device/browser scoped unless exported.
2. `saveUserData()` is high-frequency and immediate; this is simple but can be write-heavy.
3. Storing `wft3_profile` in localStorage may keep a large raw payload indefinitely unless cleared.
4. Mission XP still comes from parsing wiki Lua text, but only at build time; a format
   change fails the scheduled build instead of reaching users.
5. Existing `MEMORY.md` notes appear to have stale TTL values; current code truth is cache 7 days and node data revalidated every load.

## 11) Quick code map for review

- DB open/create helpers: `js/app.js` (`openCacheDB`, `openUserDB`)
- Cache read/write helpers: `js/app.js` (`dbGet`, `dbSet`, `dbDelete`, `dbClearCache`)
- User persistence: `js/app.js` (`saveUserData`, `loadUserData`, `migrateOldData`)
- Runtime fetch + cache policy: `js/data.js` and `js/app.js`
- Import/sync flow: `js/app.js` (`handleImport`, `confirmRefreshImport`, `loadAndShow`)
