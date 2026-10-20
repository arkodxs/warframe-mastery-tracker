'use strict';

// Last verified 2026-10-20 against WFCD warframe-items master.
const ITEM_EXPECTED_COUNTS = {
  'Warframes':120,'Primary':196,'Secondary':148,'Melee':224,'Zaws':11,'Kitguns':6,
  'Archwing':5,'Arch-Gun':20,'Arch-Melee':9,'Necramechs':2,'Kubrow':6,'Kavat':5,'Vulpaphyla':3,
  'Predasite':3,'MOAs':4,'Hounds':3,'Sentinels':17,'Sentinel Weapons':24,'Amps':9,'K-Drive':5
};

const DB_CONFIG = {
  KITGUN_CHAMBERS: ['catchmoon','gaze','rattleguts','tombfinger','sporelacer','vermisplicer'],
  ZAW_STRIKES: ['balla','cyath','dehtat','dokrahm','kronsh','mewan','ooltha','rabvee','sepfahn','plague keewar','plague kripath'],
};

// WFCD stopped publishing the combined All.json (too large), so the item DB is
// assembled from the per-category files that can contain mastery items.
const ITEM_SOURCE_BASE = 'https://raw.githubusercontent.com/wfcd/warframe-items/master/data/json/';
const ITEM_SOURCE_FILES = [
  'Warframes','Primary','Secondary','Melee','Arch-Gun','Arch-Melee','Archwing',
  'Pets','Sentinels','SentinelWeapons','Misc'
];
const ITEM_DB_KEY = 'item_db_v2';
const PARTIAL_CACHE_TTL = 12 * 60 * 60 * 1000;

// WFCD flags these as not masterable, but they grant mastery in game.
const MASTERABLE_PATH_ADDBACKS = [
  p => p.includes('/operatoramplifiers/') && p.includes('barrel'), // amp prisms
  p => p.includes('/infkitgun/barrels/'),                            // Sporelacer, Vermisplicer
  p => p.includes('/khora/kavat/'),                                   // Venari, Venari Prime
];
// Enemy copies of player gear, e.g. TnDoppelgangerGrimoire (used by the Whisper).
const NON_PLAYER_PATH_PARTS = ['doppelganger'];

function isTrackable(item) {
  const path = (item.uniqueName || '').toLowerCase();
  if (NON_PLAYER_PATH_PARTS.some(p => path.includes(p))) return false;
  return item.masterable === true || MASTERABLE_PATH_ADDBACKS.some(rule => rule(path));
}

// expose for legacy consumers
window.DB_CONFIG = DB_CONFIG;
window.__wfData = Object.assign(window.__wfData || {}, { DB_CONFIG });

function getMajorVersion(rawIntro) {
  if (!rawIntro) return '0';
  const match = String(rawIntro).match(/(\d+)/);
  return match ? match[1] : '0';
}

// Inclusion is decided by isTrackable(); this only maps WFCD's coarse
// categories (Pets, Misc, ...) onto the tracker's mastery categories.
function classifyItem(item) {
  const name = item.name || '';
  const nameKey = name.toLowerCase();
  const path = (item.uniqueName || '').toLowerCase();
  const apiCat = item.category || 'Other';

  const isZaw = DB_CONFIG.ZAW_STRIKES.includes(nameKey);
  const isKitgun = DB_CONFIG.KITGUN_CHAMBERS.includes(nameKey);
  const isMoa = path.includes('moapethead') || (path.includes('/moapets/') && (nameKey.includes('moa') || path.includes('head')));
  const isHound = path.includes('zanukapetparthead') || nameKey.includes('hound');
  const isKDrive = path.includes('kdrives/boards') || ['bad baby','feverspine','flatbelly','needlenose','runway'].some(k => nameKey.includes(k));
  const isMech = nameKey === 'voidrig' || nameKey === 'bonewidow' || path.includes('entratimech');
  const isAmp = (nameKey.includes('prism') && !nameKey.includes('prisma')) || nameKey === 'sirocco' || apiCat === 'Amps';
  const isSentinelWep = apiCat === 'Sentinel Weapons' || path.includes('sentinelweapons') || ['akaten','batoten','cryotra','helstrum','lacerten','multron','tazicor','vulcax','deconstructor','verglas','sweeper','stinger','vulklok','artax','burst laser'].some(k => nameKey.includes(k));
  const isVulp = nameKey.includes('vulpaphyla');
  const isPred = nameKey.includes('predasite');

  let finalCat = apiCat;
  if (isMech) finalCat = 'Necramechs';
  else if (isAmp) finalCat = 'Amps';
  else if (isMoa) finalCat = 'MOAs';
  else if (isHound) finalCat = 'Hounds';
  else if (isZaw) finalCat = 'Zaws';
  else if (isKitgun) finalCat = 'Kitguns';
  else if (isKDrive) finalCat = 'K-Drive';
  else if (isSentinelWep) finalCat = 'Sentinel Weapons';
  else if (isVulp) finalCat = 'Vulpaphyla';
  else if (isPred) finalCat = 'Predasite';
  else if (nameKey === 'helminth charger') finalCat = 'Kubrow';
  else if (nameKey.includes('kavat') || nameKey.includes('venari')) finalCat = 'Kavat';
  else if (nameKey.includes('kubrow')) finalCat = 'Kubrow';
  else if (nameKey === 'wyrm prime' || (apiCat === 'Sentinels' && !isSentinelWep)) finalCat = 'Sentinels';
  else if (nameKey.includes('sybaris') || ['strun','paris','enkaus'].includes(nameKey)) finalCat = 'Primary';
  else if (nameKey.includes('gammacor') || ['lato','lex'].includes(nameKey) || nameKey === 'grimoire') finalCat = 'Secondary';

  return { finalCat, isZaw, isKitgun, isMoa, isHound, isKDrive, isMech, isAmp };
}

// Fetches every source file in parallel. A failed file is reported in
// `missing` rather than failing the whole DB.
async function fetchItemSources() {
  const results = await Promise.all(ITEM_SOURCE_FILES.map(async file => {
    try {
      const resp = await fetch(ITEM_SOURCE_BASE + encodeURIComponent(file) + '.json');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const items = await resp.json();
      if (!Array.isArray(items)) throw new Error('Unexpected response shape');
      return { file, items };
    } catch (err) {
      console.warn(`Item source ${file} failed:`, err);
      return { file, items: null };
    }
  }));
  return {
    items: results.flatMap(r => r.items || []),
    missing: results.filter(r => !r.items).map(r => r.file),
  };
}

async function fetchItemDb() {
  try {
    const cached = await dbGet('cache', ITEM_DB_KEY);
    const normalizeRank40Items = (db) => {
      if (!db || typeof db !== 'object') return db;
      for (const [path, item] of Object.entries(db)) {
        if (!item || typeof item !== 'object') continue;
        const nameKey = String(item.name || '').toLowerCase();
        const p = String(path).toLowerCase();
        if (nameKey === 'paracesis' || p.includes('paracesis') || nameKey.startsWith('tenet ') || p.includes('tenet')) {
          item.maxRank = 40;
        }
      }
      return db;
    };
    if (cached?.v?.items) {
      // A partial DB (some source files failed) expires sooner so it gets retried.
      const missing = cached.v.missing || [];
      const ttl = missing.length ? PARTIAL_CACHE_TTL : CACHE_TTL;
      if ((Date.now() - cached.t) < ttl) {
        ST.itemDbMissing = missing;
        return normalizeRank40Items(cached.v.items);
      }
    }

    const { items, missing } = await fetchItemSources();
    ST.itemDbMissing = missing;
    if (!items.length) return {}; // total failure: nothing worth caching
    const db = {}, dbByName = {};

    items.forEach(item => {
      if (!item || !item.uniqueName || !item.name) return;
      if (!isTrackable(item)) return;

      const { finalCat, isMech } = classifyItem(item);
      const pathLower = item.uniqueName.toLowerCase();

      let score = item.masteryExp || 0;
      if (item.introduced) score += 5000;
      if (pathLower.includes('/npc/')) score -= 500000;

      const displayName = item.name;
      const nameKey = displayName.toLowerCase();
      if (dbByName[nameKey] && score <= dbByName[nameKey].score) return;

      const rawIntro = item.introduced
        ? (typeof item.introduced === 'object' ? (item.introduced.name || '') : String(item.introduced))
        : 'Unknown';
      const majorVer = getMajorVersion(rawIntro);

      dbByName[nameKey] = {
        path: pathLower, score,
        data: {
          name: displayName,
          apiCat: finalCat,
          introduced: rawIntro,
          majorUpdate: majorVer,
          maxRank: (pathLower.includes('kuva') || pathLower.includes('tenet') || pathLower.includes('lich') || pathLower.includes('coda') || isMech || pathLower.includes('paracesis') || nameKey.startsWith('tenet ') || item.name === 'Paracesis') ? 40 : 30
        }
      };
    });

    Object.values(dbByName).forEach(winner => { db[winner.path] = winner.data; });
    normalizeRank40Items(db);
    // Optional developer auto-audit: set localStorage 'wft_auto_audit' to '1'
    if (typeof localStorage !== 'undefined' && localStorage.getItem('wft_auto_audit') === '1') {
      try { validateItemCounts(db); } catch (e) { console.warn('Auto-audit failed', e); }
    }
    await dbSet('cache', ITEM_DB_KEY, { items: db, missing });
    return db;
  } catch (err) {
    console.error('Item DB build failed:', err);
    ST.itemDbMissing = ITEM_SOURCE_FILES.slice();
    return {};
  }
}

function validateItemCounts(db) {
  const actualCounts = {};
  Object.values(db).forEach(item => {
    const cat = item.apiCat || 'Unknown';
    actualCounts[cat] = (actualCounts[cat] || 0) + 1;
  });
  
  let mismatchFound = false;
  for (const [cat, expected] of Object.entries(ITEM_EXPECTED_COUNTS)) {
    const actual = actualCounts[cat] || 0;
    if (actual !== expected) {
      console.warn(`Item count mismatch: ${cat} — expected ${expected}, got ${actual} (diff: ${actual - expected})`);
      mismatchFound = true;
    }
  }
  if (!mismatchFound) console.log('✓ All item category counts match expected values');
}

function explainCategoryMismatch(category, dbInput) {
  const db = dbInput || ST.itemDb || {};
  const currentDb = db.v || db;
  const cat = String(category || '').trim();
  const catLower = cat.toLowerCase();
  if (!cat) {
    console.warn('Provide a category name. Example: explainCategoryMismatch("Melee")');
    return null;
  }

  const dbValues = Object.values(currentDb || {});
  const source = dbValues.length > 0 ? dbValues : (Array.isArray(ST.items) ? ST.items : []);
  const items = source.filter(i => {
    if (!i) return false;
    const a = String(i.apiCat || '').toLowerCase();
    const b = String(i.category || '').toLowerCase();
    const c = String(i.cat || '').toLowerCase();
    return a === catLower || b === catLower || c === catLower;
  });
  const expected = ITEM_EXPECTED_COUNTS[cat];
  const actual = items.length;
  const diff = (expected == null) ? null : (actual - expected);

  console.log(`Category ${cat}: current ${actual}${expected == null ? '' : ` / expected ${expected} (diff ${diff >= 0 ? '+' : ''}${diff})`}`);
  console.table(items.map(i => ({ name: i.name, path: i.path || '', maxRank: i.maxRank })));
  return { category: cat, expected, actual, diff, names: items.map(i => i.name) };
}

async function fetchUpdateNames() {
  try {
    const cached = await dbGet('cache', 'update_names');
    if (cached && (Date.now() - cached.t) < CACHE_TTL) return cached.v;

    const resp = await fetch('https://raw.githubusercontent.com/WFCD/warframe-patchlogs/master/data/patchlogs.json');
    if (!resp.ok) throw new Error('Patchlog fetch failed');
    const logs = await resp.json();
    const map = {};

    logs.filter(l => l.type === 'Update').forEach(l => {
      const m = l.name.match(/Update\s+(\d+)[.\d]*\s*[:\-–]?\s*(.+)|(.+?)\s*[:\-–]\s*Update\s+(\d+)/i);
      if (m) {
        const ver = m[1] || m[4];
        const title = (m[2] || m[3] || '').replace(/\s*\|\s*Warframe.*/i, '').trim();
        if (ver && title && !map[ver]) map[ver] = title;
      }
    });

    const fallbacks = {
      '18':'The Second Dream',
      '19':'The War Within',
      '20':"Octavia's Anthem",
      '21':'Chains of Harrow',
      '22':'Plains of Eidolon',
      '23':'The Sacrifice',
      '24':'Fortuna',
      '25':'The Jovian Concord',
      '26':'Empyrean',
      '27':'Heart of Deimos',
      '28':'The Deadlock Protocol',
      '29':'Sisters of Parvos',
      '30':'The New War',
      '31':'Angels of the Zariman',
      '32':'Veilbreaker',
      '33':"Citrine's Last Wish",
      '34':'Whispers in the Walls',
      '35':'Dante Unbound',
      '36':'Jade Shadows',
    };
    Object.entries(fallbacks).forEach(([v, t]) => { if (!map[v]) map[v] = t; });

    await dbSet('cache', 'update_names', map);
    return map;
  } catch (e) {
    console.warn('Update names fetch failed:', e);
    return {};
  }
}

const MISSION_DB_KEY = 'mission_db_v3';
const NODES_URL = 'data/nodes.json';

// Node metadata + mastery XP come from data/nodes.json, which a scheduled build
// (build_nodes.py) merges from DE's export and the wiki. Always revalidate so a
// rebuilt file reaches users on their next load; the cached copy is only used
// when the request fails.
async function fetchMissionDb() {
  if (ST.missionDb) return ST.missionDb;
  if (ST._missionDbPromise) return ST._missionDbPromise;

  ST._missionDbPromise = (async () => {
    try {
      const resp = await fetch(NODES_URL, { cache: 'no-cache' });
      if (!resp.ok) throw new Error(`Node data fetch failed (HTTP ${resp.status})`);
      const data = await resp.json();
      if (!data?.nodes || !Object.keys(data.nodes).length) throw new Error('Node data has no nodes');
      ST.missionDb = data.nodes;
      ST.missionDbError = null;
      try { await dbSet('cache', MISSION_DB_KEY, data.nodes); } catch (_) {}
    } catch (e) {
      console.warn('Node data fetch failed, using cached copy if any:', e);
      let cached = null;
      try { cached = await dbGet('cache', MISSION_DB_KEY); } catch (_) {}
      ST.missionDb = cached?.v || {};
      ST.missionDbError = cached ? 'stale' : 'missing';
    } finally {
      ST._missionDbPromise = null;
    }
    return ST.missionDb;
  })();

  return ST._missionDbPromise;
}

window.__wfData = Object.assign(window.__wfData || {}, {
  ITEM_EXPECTED_COUNTS,
  ITEM_DB_KEY,
  ITEM_SOURCE_FILES,
  isTrackable,
  classifyItem,
  fetchItemDb,
  fetchUpdateNames,
  fetchMissionDb,
  validateItemCounts,
  explainCategoryMismatch,
});

function parseProfile(text) {
  const data = JSON.parse(text);
  const r = data.Results?.[0] || data;
  const srcA = (r.XPInfo || r.xpInfo || []).filter(e => e && (e.ItemType || e.itemType) && (e.XP || e.xp))
    .map(e => ({ path: e.ItemType || e.itemType, xp: e.XP || e.xp }));
  const srcB = (data.Stats?.Weapons || []).filter(w => w && w.type && (w.xp || 0) > 0)
    .map(w => ({ path: w.type, xp: w.xp }));
  const seen = new Set(srcA.map(e => e.path));
  const xpData = [...srcA];
  for (const e of srcB) if (!seen.has(e.path)) { xpData.push(e); seen.add(e.path); }
  const missions = (r.Missions || [])
    .filter(m => m && (m.Tag || m.tag))
    .map(m => ({
      tag:      m.Tag      || m.tag      || '',
      tier:     m.Tier     || m.tier     || 0,
      completes:m.Completes|| m.completes|| 1,
    }));
  return {
    playerName:  r.DisplayName || r.displayName || 'Tenno',
    playerLevel: r.PlayerLevel || r.playerLevel || 0,
    xpData, missions,
  };
}

function detectAcq(path, name) {
  const p = (path || '').toLowerCase();
  const n = (name || '').toLowerCase();
  if (p.includes('infestationlich') || p.includes('coda')) return 'coda';
  if (p.includes('kuvalich')) return 'lich';
  if (p.includes('tenet') || p.includes('sister')) return 'sister';
  if (n.endsWith(' prime')) return 'relic';
  if (p.includes('voidtrader')) return 'baro';
  if (p.includes('clantech')) return 'clan';
  if (['rakta','sancti','vaykor','telos','synoid','secura'].some(pfx => n.startsWith(pfx + ' '))) return 'syndicate';
  return 'standard';
}

function enrichAll(xpData, itemDb) {
  if (!itemDb || Object.keys(itemDb).length === 0) return [];
  const userXPMap = {};
  xpData.forEach(e => { if (e.path) userXPMap[e.path.toLowerCase()] = e.xp; });

  return Object.entries(itemDb).map(([dbPath, api]) => {
    const userXP = userXPMap[dbPath] || 0;
    const { finalCat } = classifyItem({ name: api.name, uniqueName: dbPath, category: api.apiCat });
    const catKey = API_CAT_MAP[finalCat] || 'other';
    const multiplier = masteryMult(catKey);
    const maxR = api.maxRank || 30;
    const rank = xpToRank(userXP, multiplier, maxR);
    const mastery = rank * multiplier;
    return {
      path: dbPath,
      name: api.name,
      cat: catKey,
      category: finalCat,
      maxRank: maxR,
      rank,
      mastery,
      xp: userXP,
      isOwned: userXP > 0,
      isPrime: /prime$/i.test(api.name),
      acq: detectAcq(dbPath, api.name),
      introduced: api.introduced || 'Unknown',
      majorUpdate: api.majorUpdate || '0',
      needsGilding: false,
      isGilded: false,
      isRescued: false,
      isJunk: false,
      categoryLabel: finalCat,
    };
  });
}
