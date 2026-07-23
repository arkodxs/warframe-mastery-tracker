# FraME — Project Memory
<!-- Evolving state only. Pointers under 15 words. Stable conventions go in .continue/rules/, not here. -->

## Active work
<!-- what's being worked on right now, branch names, current focus -->

## Decisions (dated)
<!-- durable choices + when, e.g. "2026-07: chose X over Y for Z -->

## Known issues
# FraME — Project Memory
<!-- Evolving state only. Pointers under 15 words. Stable conventions go in .continue/rules/, not here. -->

## Active work
- Refactor item DB: bundle static data, reduce GitHub dependency
- Refactor mission DB: replace wiki scraping with bundled JSON
- Add schema validation for DE profile JSON parsing
- Improve error handling and graceful degradation
- Create test harness for profile parsing validation

## Decisions (dated)
<!-- durable choices + when, e.g. "2026-07: chose X over Y for Z -->

## Known issues
- Player ID only retrievable on Windows via EE.log
- Rank-40 items (Kuva/Tenet/Necramech) require manual rank input
- Star chart node counts may differ from in-game due to DE changes
- Steel Path completions cannot be separated from Normal in profile format
- Wiki scraping brittle; breaks on structure changes
- Item DB relies on third-party GitHub repo (wfcd/warframe-items)

## Discovered conventions
- Item DB cached in IndexedDB with CACHE_TTL (30 min)
- Mission DB cached with MISSION_DB_TTL (7 days)
- All data stays client-side; nothing sent to servers
- Item classification via classifyItem() in data.js
- Modular weapons filtered unless explicitly rescued (Zaws/Kitguns/etc)
- Player ID auto-saved for 7 days in localStorage
- User data in IndexedDB with localStorage backup
- Zero-mastery items explicitly excluded (plexus, talons, etc.)
- Rank-40 items (Kuva/Tenet/Necramech) require manual rank input
- Star chart node counts may differ from in-game due to DE changes
## Discovered conventions
- Item DB cached in IndexedDB with CACHE_TTL (30 min)
- Mission DB cached with MISSION_DB_TTL (7 days)
- All data stays client-side; nothing sent to servers
- Item classification via classifyItem() in data.js
- Modular weapons filtered unless explicitly rescued (Zaws/Kitguns/etc)
- Player ID auto-saved for 7 days in localStorage
- User data in IndexedDB with localStorage backup
- Zero-mastery items explicitly excluded (plexus, talons, etc.)
