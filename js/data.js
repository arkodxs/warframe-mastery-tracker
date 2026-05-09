'use strict';

const ITEM_EXPECTED_COUNTS = {
  'Warframes':115,'Primary':192,'Secondary':146,'Melee':221,'Zaws':11,'Kitguns':6,
  'Archwing':5,'Arch-Gun':20,'Arch-Melee':8,'Necramechs':2,'Kubrow':6,'Kavat':5,'Vulpaphyla':3,
  'Predasite':3,'MOAs':4,'Hounds':3,'Sentinels':17,'Sentinel Weapons':24,'Amps':10,'K-Drive':5
};

const DB_CONFIG = {
  VALID_CATS: [
    'Warframes','Primary','Secondary','Melee','Archwing','Arch-Gun','Arch-Melee',
    'Sentinels','Sentinel Weapons','Pets','Amps','Necramechs','Zaws','Kitguns',
    'MOAs','Hounds','Kubrow','Kavat','Vulpaphyla','Predasite','K-Drive','Plexus'
  ],
  KITGUN_CHAMBERS: ['catchmoon','gaze','rattleguts','tombfinger','sporelacer','vermisplicer'],
  ZAW_STRIKES: ['balla','cyath','dehtat','dokrahm','kronsh','mewan','ooltha','rabvee','sepfahn','plague keewar','plague kripath'],
  RESCUE_LIST: ['mausolon','morgha','cortege','mandonel','grimoire','bo prime','kuva ghoulsaw','ghoulsaw','dark split-sword','bo','mk1-bo','prisma veritux','prisma dual decurions','imperator','imperator vandal','prisma imperator','jat kittag','innodem','wyrm prime','quassus prime','prisma sybaris','prisma gammacor','rathbone','lato','strun','paris','lex','enkaus','phahd','runway'],
};

// expose for legacy consumers
window.DB_CONFIG = DB_CONFIG;
window.__wfData = Object.assign(window.__wfData || {}, { DB_CONFIG });

function getMajorVersion(rawIntro) {
  if (!rawIntro) return '0';
  const match = String(rawIntro).match(/(\d+)/);
  return match ? match[1] : '0';
}

function classifyItem(item) {
  const name = item.name || '';
  const nameKey = name.toLowerCase();
  const path = (item.uniqueName || '').toLowerCase();
  const apiCat = item.category || 'Other';

  const FORCE_INCLUDE_BY_NAME = new Set(['innodem', 'jat kittag']);
  const FORCE_INCLUDE_BY_PATH = [
    '/lotus/weapons/tenno/zariman/melee/dagger/zarimandaggerweapon'
  ];
  const FORCE_EXCLUDE_BY_NAME = new Set(['plague akwin', 'plague bokwin']);
  const FORCE_EXCLUDE_PATH_PARTS = ['/handles/'];

  if (FORCE_EXCLUDE_BY_NAME.has(nameKey) || FORCE_EXCLUDE_PATH_PARTS.some(p => path.includes(p))) {
    return { isJunk:true };
  }

  if (FORCE_INCLUDE_BY_NAME.has(nameKey) || FORCE_INCLUDE_BY_PATH.some(p => path.includes(p))) {
    return { finalCat:'Melee', isRescued:true, scoreBoost:400000, isJunk:false };
  }

  if (nameKey === 'runway') return { finalCat:'K-Drive', isRescued:true, scoreBoost:500000 };
  if (nameKey === 'helminth charger') return { finalCat:'Kubrow', isRescued:true, scoreBoost:500000 };
  if (nameKey === 'jat kittag') return { finalCat:'Melee', isRescued:true, scoreBoost:400000, isJunk:false };

  const ZAW_SLOP = ['jai','ruhang','ekwana','vargeet','jayap','laka','korb','shtung','peye','kwath','kroostra','seekalla'];
  const junkKeywords = [
    'glyph','noggle','theme','shawzin','floof','mandala','pattern','narta','display','poster','scene',
    'extractor','decoration','syandana','finish','lacquer','ephemera','sigil','skin','blueprint',
    'helmet','stencil','vignette','globule','token','steel path','domestik','pedestal','maggot',
    'ascaris','tag','casing','capsule','engine','weapon pod','barrel','receiver','stock','statue',
    'necramite','cells','component','node','misc','resource','gear','fish','quest','box','basket',
    'book','bop','trophy','shard','instrument','debt-bond','booster','segment','pizza','lunch',
    'cardboard','theorem','lure','pheromone','genetic','upgrade','bust','egg','collar','code',
    'specter','howl of','lucky','twin kavats','core','gyro','bracket','stabilizer','mutagen',
    'antigen','incarnon genesis','helminth'
  ];

  const ZERO_MASTERY = [
    'plexus', 'bondi k-drive',
    "garuda's talons", "garuda prime talons", 'iron staff', 'iron staff prime',
    'regulators', 'regulators prime', 'dex pixia', 'dex pixia prime',
    'desert wind', 'desert wind prime', 'artemis bow', 'artemis bow prime',
    'balefire charger', 'diwata', 'diwata prime', 'valkyr talons', 'valkyr prime talons',
    'shadow claws', 'noctowl'
  ];

  if (ZERO_MASTERY.includes(nameKey) || junkKeywords.some(k => nameKey.includes(k)) || ZAW_SLOP.some(s => nameKey.includes(s)) || apiCat === 'Mods' || path.includes('/upgrades/'))
    return { isJunk:true };

  const isZaw = DB_CONFIG.ZAW_STRIKES.includes(nameKey);
  const isKitgun = DB_CONFIG.KITGUN_CHAMBERS.includes(nameKey);
  const isMoa = path.includes('moapethead') || (path.includes('/moapets/') && (nameKey.includes('moa') || path.includes('head')));
  const isHound = path.includes('zanukapetparthead') || nameKey.includes('hound');
  const isKDrive = path.includes('kdrives/boards') || ['bad baby','feverspine','flatbelly','needlenose','runway'].some(k => nameKey.includes(k));
  const isMech = nameKey === 'voidrig' || nameKey === 'bonewidow' || path.includes('entratimech');
  const isAmp = (nameKey.includes('prism') && !nameKey.includes('prisma')) || nameKey === 'sirocco' || nameKey.includes('phahd') || apiCat === 'Amps';
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
  else if (nameKey.includes('kavat') || nameKey.includes('venari')) finalCat = 'Kavat';
  else if (nameKey.includes('kubrow')) finalCat = 'Kubrow';
  else if (nameKey === 'wyrm prime' || (apiCat === 'Sentinels' && !isSentinelWep)) finalCat = 'Sentinels';
  else if (nameKey.includes('sybaris') || ['strun','paris','enkaus'].includes(nameKey)) finalCat = 'Primary';
  else if (nameKey.includes('gammacor') || ['lato','lex'].includes(nameKey) || nameKey === 'grimoire') finalCat = 'Secondary';

  const isRescued = DB_CONFIG.RESCUE_LIST.includes(nameKey) || isMoa || isHound || isKDrive || isMech || isZaw || isKitgun || isSentinelWep || isAmp || isVulp || isPred;

  return { finalCat, isRescued, isZaw, isKitgun, isMoa, isHound, isKDrive, isMech, isAmp, scoreBoost: isRescued ? 400000 : 0, isJunk:false };
}

async function fetchItemDb() {
  try {
    const cached = await dbGet('cache', 'item_db');
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
    if (cached && (Date.now() - cached.t) < CACHE_TTL) return normalizeRank40Items(cached.v);

    const resp = await fetch('https://raw.githubusercontent.com/wfcd/warframe-items/master/data/json/All.json');
    const items = await resp.json();
    const db = {}, dbByName = {};

    items.forEach(item => {
      if (!item || !item.uniqueName || !item.name) return;
      const res = classifyItem(item);
      if (res.isJunk) return;

      const { finalCat, isRescued, isZaw, isKitgun, isMoa, isHound, isVulpaphyla, isPredasite, isKDrive, isMech, isAmp, scoreBoost } = res;
      const pathLower = item.uniqueName.toLowerCase();
      const isModular = pathLower.includes('/modular/') || pathLower.includes('/modularmelee') || pathLower.includes('/zaw/') || pathLower.includes('/kitgun/') || pathLower.includes('/kdrive/') || pathLower.includes('/pets/');
      if (isModular && !isZaw && !isKitgun && !isMoa && !isHound && !isKDrive && !isMech && !isAmp && !isRescued) return;

      const isRecognized = DB_CONFIG.VALID_CATS.some(c => c === finalCat || (c.endsWith('s') && c.slice(0, -1) === finalCat));
      if (!isRecognized && !isRescued) return;

      let score = (item.masteryExp || 0) + scoreBoost;
      if (item.introduced) score += 5000;
      if (pathLower.includes('/npc/')) score -= 500000;

      const nameKey = item.name.toLowerCase();
      if (dbByName[nameKey] && score <= dbByName[nameKey].score) return;

      const rawIntro = item.introduced
        ? (typeof item.introduced === 'object' ? (item.introduced.name || '') : String(item.introduced))
        : 'Unknown';
      const majorVer = getMajorVersion(rawIntro);

      dbByName[nameKey] = {
        path: pathLower, score,
        data: {
          name: item.name,
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
    await dbSet('cache', 'item_db', db);
    return db;
  } catch (err) { return {}; }
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

window.__wfData = Object.assign(window.__wfData || {}, {
  ITEM_EXPECTED_COUNTS,
  classifyItem,
  fetchItemDb,
  fetchUpdateNames,
  validateItemCounts,
  explainCategoryMismatch,
});

async function fetchMissionDb() {
  if (ST.missionDb) return ST.missionDb;
  if (ST._missionDbPromise) return ST._missionDbPromise;

  ST._missionDbPromise = (async () => {
    try {
      const cached = await dbGet('cache', 'mission_db');
      if (cached && (Date.now() - cached.t) < MISSION_DB_TTL) {
        ST.missionDb = cached.v;
        return ST.missionDb;
      }

      const resp = await fetch('https://wiki.warframe.com/api.php?action=parse&page=Module:Missions/data&prop=wikitext&format=json&origin=*');
      if (!resp.ok) throw new Error('Mission wiki fetch failed');
      const data = await resp.json();
      const text = data.parse?.wikitext?.['*'] || '';

      const db = {};
      const blocks = text.split(/(?=\s*\{[^{}]*InternalName)/);
      blocks.forEach(block => {
        const internalName = block.match(/InternalName\s*=\s*"([^"]+)"/)?.[1];
        if (!internalName) return;
        const masteryExp  = block.match(/MasteryExp\s*=\s*(\d+)/)?.[1];
        const name        = block.match(/\bName\s*=\s*"([^"]+)"/)?.[1];
        const planet      = block.match(/Planet\s*=\s*"([^"]+)"/)?.[1];
        const type        = block.match(/\bType\s*=\s*"([^"]+)"/)?.[1];
        const enemy       = block.match(/Enemy\s*=\s*"([^"]+)"/)?.[1];
        const minLevel    = block.match(/MinLevel\s*=\s*(\d+)/)?.[1];
        const maxLevel    = block.match(/MaxLevel\s*=\s*(\d+)/)?.[1];
        db[internalName] = {
          name:      name || internalName,
          planet:    planet || '',
          type:      type || '',
          enemy:     enemy || '',
          minLevel:  minLevel ? parseInt(minLevel) : 0,
          maxLevel:  maxLevel ? parseInt(maxLevel) : 0,
          masteryExp: masteryExp ? parseInt(masteryExp) : 0,
        };
      });

      ST.missionDb = db;
      await dbSet('cache', 'mission_db', db);
      return db;
    } catch (e) {
      console.warn('Mission DB fetch failed:', e);
      ST.missionDb = {};
      return ST.missionDb;
    } finally {
      ST._missionDbPromise = null;
    }
  })();

  return ST._missionDbPromise;
}

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
