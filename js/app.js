'use strict';

/* ── CONFIG ─────────────────────────────────── */
const API_BASE  = 'https://api.warframestat.us';
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const MISSION_DB_TTL = 30 * 24 * 60 * 60 * 1000;

const CAT = {
  warframe:        {l:'Warframes',      c:'#c86838', g:'WF'},
  primary:         {l:'Primary',        c:'#b89030', g:'PR'},
  secondary:       {l:'Secondary',      c:'#38a858', g:'SC'},
  melee:           {l:'Melee',          c:'#3aa898', g:'ML'},
  zaw:             {l:'Zaws',           c:'#9a7838', g:'ZW'},
  kitgun:          {l:'Kitguns',        c:'#6070a0', g:'KG'},
  archwing:        {l:'Archwing',       c:'#4878b8', g:'AW'},
  archgun:         {l:'Arch-Gun',       c:'#3868b0', g:'AG'},
  archmelee:       {l:'Arch-Melee',     c:'#2850a0', g:'AME'},
  sentinel:        {l:'Sentinels',      c:'#7848c0', g:'SEN'},
  sentinel_weapon: {l:'Sntnl Wep',      c:'#5878b8', g:'SW'},
  moa:             {l:'MOAs',           c:'#3888c0', g:'MOA'},
  hound:           {l:'Hounds',         c:'#8038b8', g:'HND'},
  kubrow:          {l:'Kubrows',        c:'#b06050', g:'KB'},
  kavat:           {l:'Kavats',         c:'#c07880', g:'KV'},
  vulpaphyla:      {l:'Vulpaphyla',     c:'#a05878', g:'VLP'},
  predasite:       {l:'Predasites',     c:'#906070', g:'PRS'},
  companion:       {l:'Companions',     c:'#c04878', g:'CP'},
  kdrive:          {l:'K-Drives',       c:'#68a038', g:'KD'},
  amp:             {l:'Amps',           c:'#48a8c0', g:'AMP'},
  necramech:       {l:'Necramechs',     c:'#c07018', g:'NM'},
  other:           {l:'Other',          c:'#506070', g:'??'},
};

// Visual groupings for category chip filter
const CAT_GROUPS = [
  { label: 'Warframes',   keys: ['warframe'] },
  { label: 'Weapons',     keys: ['primary','secondary','melee','zaw','kitgun'] },
  { label: 'Arch',        keys: ['archwing','archgun','archmelee'] },
  { label: 'Companions',  keys: ['sentinel','sentinel_weapon','moa','hound','kubrow','kavat','vulpaphyla','predasite','companion'] },
  { label: 'Other',       keys: ['amp','necramech','kdrive','other'] },
];

const API_CAT_MAP = {
  'Warframes':'warframe','Primary':'primary','Secondary':'secondary','Melee':'melee',
  'Zaws':'zaw','Kitguns':'kitgun','Archwing':'archwing','Arch-Gun':'archgun',
  'Arch-Melee':'archmelee','Sentinels':'sentinel','Sentinel Weapons':'sentinel_weapon',
  'Amps':'amp','Necramechs':'necramech','Necramech':'necramech','MOAs':'moa','Hounds':'hound',
  'Kubrow':'kubrow','Kavat':'kavat','Vulpaphyla':'vulpaphyla','Predasite':'predasite',
  'K-Drive':'kdrive','Plexus':'other',
  'Pets':'companion','Robotic':'companion','Companions':'companion','Gear':'other',
};

const ACQ = {
  relic:    {l:'Relic',     c:'#b89030'},
  lich:     {l:'Lich',      c:'#b84040'},
  sister:   {l:'Sister',    c:'#a840c0'},
  coda:     {l:'Coda',      c:'#78c030'},
  syndicate:{l:'Syndicate', c:'#4070c8'},
  clan:     {l:'Clan',      c:'#c07030'},
  baro:     {l:'Baro',      c:'#a8a830'},
  quest:    {l:'Quest',     c:'#38a8a8'},
  event:    {l:'Event ★',   c:'#c05080'},
  login:    {l:'Login',     c:'#506080'},
  standard: {l:'Standard',  c:'#506070'},
};

/* ── STATE ──────────────────────────────────── */
const ST = {
  items:[], missions:[],
  cats: Object.fromEntries(Object.keys(CAT).map(k=>[k,true])),
  acqs: Object.fromEntries(Object.keys(ACQ).map(k=>[k,true])),
  search:'', sort:'mastery-desc', group:'cat', update:'',
  plannerSort:'stars-desc',
  plannerLayout:'columns',
  starred: new Set(),   // runtime mirror of userData.entities starred flags
  overrides: {},        // runtime mirror of userData.entities rank overrides
  updateNames: {},
  nodeDb: null,
  missionDb: null,
  _missionDbPromise: null,
  plannerData: null,
  plannerIndex: null,
  selection: new Set(),
  _lastSelIdx: null,
  _visibleItems: [],
  _hoveredItem: null,
  _plannerVisibleRows: [],
  _plannerHoveredPath: null,
  _plannerSelectedPath: null,
  tab: 'items',
  activeList: null,   // list ID currently being filtered by
  plannerActiveList: null,
  userData: {
    version: 3,
    meta: {},
    entities: {},
    lists: [],
    journal: [],
    settings: {}
  }
};

/* ── HELPERS ─────────────────────────────────── */
function saveOverride(path, rank) {
  const val = Math.max(0, Math.min(40, parseInt(rank) || 0));
  if (!ST.userData.entities[path]) ST.userData.entities[path] = { type: 'item' };
  ST.userData.entities[path].rank = val;
  ST.overrides[path] = val;
  const item = ST.items.find(i => i.path === path);
  if (item) {
    item.rank = val;
    const mult = (item.cat==='warframe'||item.cat==='necramech'||item.cat==='archwing'||item.cat==='sentinel') ? 200 : 100;
    item.mastery = val * mult;
  }
  saveUserData();
  render();
  // Refresh calc panel since mastery totals changed
  const calc = document.querySelector('.mbar-calc');
  if (calc) renderCalcPanel(calc, calcTotalMastery());
}

function xpToRank(xp, multiplier, maxRank) {
  if (!xp || xp <= 0) return 0;
  // Warframe affinity formula: Total XP = constant * rank^2
  const constant = multiplier * 5;
  return Math.min(Math.floor(Math.sqrt(xp / constant)), maxRank);
}

function getMajorVersion(rawIntro) {
  if (!rawIntro) return '0';
  const match = String(rawIntro).match(/(\d+)/);
  return match ? match[1] : '0';
}

// ── MR Threshold ──
// Single source of truth for mastery multipliers
// Confirmed from wiki: Warframes, Companions, Archwings, K-Drives, Necramechs = 200 per rank
// Weapons, Sentinel Weapons, Amps, Zaws, Kitguns = 100 per rank
function masteryMult(cat) {
  const HIGH = ['warframe','necramech','archwing','sentinel',
                'kubrow','kavat','vulpaphyla','predasite','companion',
                'moa','hound','kdrive'];
  return HIGH.includes(cat) ? 200 : 100;
}

function mrThreshold(rank) {
  if (rank <= 0) return 0;
  if (rank <= 30) return 2500 * rank * rank;
  return 2250000 + 147500 * (rank - 30);
}
function rankFromMastery(xp) {
  if (xp <= 0) return 0;
  // Binary search across ranks 1-40
  let lo = 0, hi = 40;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (mrThreshold(mid) <= xp) lo = mid; else hi = mid - 1;
  }
  return lo;
}
function calcTotalMastery() {
  const itemMxp   = ST.items.reduce((s,i) => s+(i.mastery||0), 0);
  const scMxp     = calcStarChartMxp(ST.missions);
  const rjMxp     = (ST.userData.meta?.rjInt || 0) * 1500;
  const drMxp     = (ST.userData.meta?.drInt || 0) * 1500;
  const plexusMxp = ST.userData.meta?.plexusDone ? 6000 : 0;
  return itemMxp + scMxp + rjMxp + drMxp + plexusMxp;
}

function updateManualMxp(key, val) {
  if (!ST.userData.meta) ST.userData.meta = {};
  if (key === 'plexusDone') ST.userData.meta[key] = val;
  else ST.userData.meta[key] = Math.max(0, parseInt(val) || 0);
  saveUserData();
  // Refresh calc panel in-place — don't rebuild whole mbar (preserves bar projection)
  const calc = document.querySelector('.mbar-calc');
  if (calc) renderCalcPanel(calc, calcTotalMastery());
}

// ── Wiki ──
function openWikiPage(name) {
  if (!name) return;
  window.open('https://wiki.warframe.com/w/' + name.replace(/ /g, '_'), '_blank');
}

// ── Entity status ──
function toggleEntityStatus(path, status, btn) {
  const item = ST.items.find(i => i.path === path);
  const e = getOrCreateEntity(path, item?.cat || 'item');
  if (e.status === status) { delete e.status; if (btn) btn.classList.remove('on'); }
  else { e.status = status; if (btn) btn.classList.add('on'); }
  pruneEntity(path);
  saveUserData();
}
function getOrCreateEntity(id, type) {
  if (!ST.userData.entities[id]) ST.userData.entities[id] = { type };
  return ST.userData.entities[id];
}
function pruneEntity(id) {
  const e = ST.userData.entities[id]; if (!e) return;
  if (!Object.keys(e).some(k => k !== 'type')) delete ST.userData.entities[id];
}
function saveEntityNote(id, type, text) {
  const e = getOrCreateEntity(id, type);
  const t = text.trim();
  if (t) e.note = t; else delete e.note;
  pruneEntity(id); saveUserData();
}
function isEntityStarred(id) { return !!ST.userData.entities[id]?.starred; }
function toggleEntityStar(id, type, btn) {
  const e = getOrCreateEntity(id, type);
  e.starred = !e.starred;
  if (!e.starred) delete e.starred;
  pruneEntity(id);
  const on = !!ST.userData.entities[id]?.starred;
  if (btn) btn.classList.toggle('on', on);
  if (type !== 'node') { if (on) ST.starred.add(id); else ST.starred.delete(id); }
  saveUserData();
  return on;
}

// ── Player ID helpers ──
function getPlayerId()  { return localStorage.getItem('wft3_playerid') || ''; }
function savePlayerId(id) { if (id) localStorage.setItem('wft3_playerid', id.trim()); }
function clearSavedId() {
  localStorage.removeItem('wft3_playerid');
  document.getElementById('refresh-panel').classList.remove('visible');
  document.getElementById('id-entry').style.display = 'block';
  document.getElementById('hbtn-refresh').style.display = 'none';
}
function profileUrl(id) { return `http://content.warframe.com/dynamic/getProfileViewingData.php?playerId=${id}`; }
function openProfileUrl() {
  const id = getPlayerId() || document.getElementById('player-id-input')?.value.trim();
  if (!id) { toast('Enter your player ID first'); return; }
  window.open(profileUrl(id), '_blank');
}
function onPlayerIdInput(val) {
  const id = val.trim();
  const preview = document.getElementById('id-url-preview');
  const urlVal  = document.getElementById('id-url-val');
  if (id && preview && urlVal) {
    preview.style.display = 'block';
    urlVal.textContent = id;
  } else if (preview) {
    preview.style.display = 'none';
  }
}
function refreshProfile() {
  // Show import screen in refresh mode (ID already known)
  document.getElementById('app').style.display = 'none';
  document.getElementById('import-screen').style.display = 'flex';
  document.getElementById('json-input').value = '';
  ST.activeList = null;
  ST.search = '';
  initImportScreen();
}

// ── List management ──
function listById(id) { return ST.userData.lists.find(l => l.id === id); }

function promptNewList(initialPaths) {
  const name = prompt('List name:');
  if (!name?.trim()) return;
  const id = 'list_' + Date.now();
  ST.userData.lists.push({ id, name: name.trim(), created: Date.now() });
  if (initialPaths?.size) {
    initialPaths.forEach(path => {
      const e = getOrCreateEntity(path, 'item');
      if (!e.lists) e.lists = [];
      if (!e.lists.includes(id)) e.lists.push(id);
    });
  }
  saveUserData();
  buildListBar();
  toast(`List "${name.trim()}" created`);
}

function deleteList(id) {
  ST.userData.lists = ST.userData.lists.filter(l => l.id !== id);
  Object.values(ST.userData.entities).forEach(e => {
    if (e.lists) e.lists = e.lists.filter(lid => lid !== id);
  });
  if (ST.activeList === id) ST.activeList = null;
  if (ST.plannerActiveList === id) ST.plannerActiveList = null;
  saveUserData();
  buildListBar();
  render();
}

function addSelectionToList(listId) {
  if (!ST.selection.size) return;
  ST.selection.forEach(path => {
    const item = ST.items.find(i => i.path === path);
    const e = getOrCreateEntity(path, item?.cat || 'item');
    if (!e.lists) e.lists = [];
    if (!e.lists.includes(listId)) e.lists.push(listId);
  });
  saveUserData();
  const list = listById(listId);
  toast(`Added ${ST.selection.size} to "${list?.name}"`);
  closeListPop();
}

function toggleListPop(btn) {
  const pop = document.getElementById('ab-list-pop');
  if (!pop) return;
  const isOpen = pop.classList.toggle('open');
  if (!isOpen) return;
  // Build pop contents
  pop.innerHTML = '';
  ST.userData.lists.forEach(l => {
    const opt = document.createElement('button');
    opt.className = 'ab-list-opt';
    opt.textContent = l.name;
    opt.onclick = () => addSelectionToList(l.id);
    pop.appendChild(opt);
  });
  const newOpt = document.createElement('button');
  newOpt.className = 'ab-list-opt new';
  newOpt.textContent = '+ New list';
  newOpt.onclick = () => { promptNewList(ST.selection); closeListPop(); };
  pop.appendChild(newOpt);
  // Close on outside click
  setTimeout(() => {
    const close = e => { if (!pop.contains(e.target) && e.target !== btn) { closeListPop(); document.removeEventListener('click', close); } };
    document.addEventListener('click', close);
  }, 0);
}
function closeListPop() { document.getElementById('ab-list-pop')?.classList.remove('open'); }

function buildListBar() {
  const bar = document.getElementById('list-bar');
  const chips = document.getElementById('list-chips');
  if (!bar || !chips) return;
  const hasLists = ST.userData.lists.length > 0;
  bar.style.display = hasLists ? 'flex' : 'none';
  chips.innerHTML = '';
  ST.userData.lists.forEach(l => {
    const chip = document.createElement('span');
    chip.className = 'list-chip' + (ST.activeList === l.id ? ' active' : '');
    chip.dataset.listId = l.id;
    const nameSpan = document.createElement('span');
    nameSpan.textContent = l.name;
    chip.appendChild(nameSpan);

    // Progress pill: X/Y maxed
    const listItems = ST.items.filter(it => ST.userData.entities[it.path]?.lists?.includes(l.id));
    if (listItems.length > 0) {
      const maxedCount = listItems.filter(i => i.rank >= i.maxRank && i.maxRank > 0).length;
      const prog = document.createElement('span');
      prog.className = 'list-chip-prog';
      prog.textContent = `${maxedCount}/${listItems.length}`;
      chip.appendChild(prog);
    }
    const delBtn = document.createElement('button');
    delBtn.className = 'list-chip-del';
    delBtn.title = 'Delete list';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      // Inline confirm: replace del button with yes/no
      delBtn.style.display = 'none';
      const confirmSpan = document.createElement('span');
      confirmSpan.style.cssText = 'display:inline-flex;gap:3px;align-items:center;margin-left:3px';
      confirmSpan.innerHTML = `<span style="font-size:.6rem;color:var(--err);margin-right:2px">Delete?</span>`;
      const yes = document.createElement('button');
      yes.className = 'list-chip-del'; yes.style.color='var(--err)'; yes.textContent = 'Yes';
      yes.addEventListener('click', ev => { ev.stopPropagation(); deleteList(l.id); });
      const no = document.createElement('button');
      no.className = 'list-chip-del'; no.textContent = 'No';
      no.addEventListener('click', ev => { ev.stopPropagation(); buildListBar(); });
      confirmSpan.appendChild(yes); confirmSpan.appendChild(no);
      chip.appendChild(confirmSpan);
    });
    chip.appendChild(delBtn);
    chip.addEventListener('click', () => {
      ST.activeList = ST.activeList === l.id ? null : l.id;
      buildListBar(); renderMbar(); render();
    });
    chips.appendChild(chip);
  });
  rebuildPlannerFilterOptions();
}

/* ── INDEXEDDB ──────────────────────────────── */
// Two separate databases so clearing cache never touches user data
let _cacheDb = null;
let _userDb  = null;

function openCacheDB() {
  if (_cacheDb) return Promise.resolve(_cacheDb);
  return new Promise((ok,err) => {
    const r = indexedDB.open('wft3-cache', 1);
    r.onupgradeneeded = e => {
      if (!e.target.result.objectStoreNames.contains('cache'))
        e.target.result.createObjectStore('cache', {keyPath:'k'});
    };
    r.onsuccess = () => { _cacheDb = r.result; ok(_cacheDb); };
    r.onerror   = () => err(r.error);
  });
}

function openUserDB() {
  if (_userDb) return Promise.resolve(_userDb);
  return new Promise((ok,err) => {
    const r = indexedDB.open('wft3-user', 1);
    r.onupgradeneeded = e => {
      if (!e.target.result.objectStoreNames.contains('user'))
        e.target.result.createObjectStore('user', {keyPath:'k'});
    };
    r.onsuccess = () => { _userDb = r.result; ok(_userDb); };
    r.onerror   = () => err(r.error);
  });
}

// Cache DB — API responses (item DB, node DB, update names etc.)
async function dbGet(store, key) {
  try {
    const db = await openCacheDB();
    return new Promise(ok => {
      const req = db.transaction('cache','readonly').objectStore('cache').get(key);
      req.onsuccess = () => ok(req.result || null);
      req.onerror   = () => ok(null);
    });
  } catch(e) { return null; }
}
async function dbSet(store, key, val) {
  try {
    const db = await openCacheDB();
    return new Promise((ok,err) => {
      const tx = db.transaction('cache','readwrite');
      tx.objectStore('cache').put({k:key, v:val, t:Date.now()});
      tx.oncomplete = ok; tx.onerror = () => err(tx.error);
    });
  } catch(e) {}
}

// User DB — personal data (notes, stars, lists, settings)
async function userDbGet(key) {
  try {
    const db = await openUserDB();
    return new Promise(ok => {
      const req = db.transaction('user','readonly').objectStore('user').get(key);
      req.onsuccess = () => ok(req.result || null);
      req.onerror   = () => ok(null);
    });
  } catch(e) { return null; }
}
async function userDbSet(key, val) {
  try {
    const db = await openUserDB();
    return new Promise((ok,err) => {
      const tx = db.transaction('user','readwrite');
      tx.objectStore('user').put({k:key, v:val, t:Date.now()});
      tx.oncomplete = ok; tx.onerror = () => err(tx.error);
    });
  } catch(e) {}
}

/* ── USER DATA ───────────────────────────────── */
const LS_USER_KEY = 'wft3_userdata';

async function saveUserData() {
  ST.userData.meta.lastSynced = Date.now();
  // Primary: user IndexedDB
  await userDbSet('userData', ST.userData);
  // Fallback: localStorage (survives IndexedDB being cleared)
  try {
    localStorage.setItem(LS_USER_KEY, JSON.stringify(ST.userData));
  } catch(e) {
    // localStorage full — not critical, IndexedDB is primary
    console.warn('localStorage backup failed (may be full):', e);
  }
}

async function loadUserData() {
  // Try primary source first (user IndexedDB)
  let stored = await userDbGet('userData');

  // Fallback to localStorage if IndexedDB was cleared or empty
  if (!stored?.v?.version) {
    try {
      const ls = localStorage.getItem(LS_USER_KEY);
      if (ls) {
        const parsed = JSON.parse(ls);
        if (parsed?.version === 3) {
          stored = { v: parsed };
          // Restore to IndexedDB since we recovered from localStorage
          await userDbSet('userData', parsed);
          console.info('User data restored from localStorage fallback.');
        }
      }
    } catch(e) {}
  }

  if (stored?.v?.version === 3) {
    ST.userData = stored.v;
  } else {
    migrateOldData();
  }

  // Populate runtime mirrors from userData
  ST.starred = new Set(
    Object.entries(ST.userData.entities)
      .filter(([,e]) => e.starred && e.type !== 'node')
      .map(([k]) => k)
  );
  ST.overrides = Object.fromEntries(
    Object.entries(ST.userData.entities)
      .filter(([,e]) => e.rank !== undefined)
      .map(([k,e]) => [k, e.rank])
  );
  // Restore settings
  const s = ST.userData.settings;
  if (s.cats)  Object.assign(ST.cats, s.cats);
  if (s.acqs)  Object.assign(ST.acqs, s.acqs);
  if (s.sort)  ST.sort  = s.sort;
  if (s.group) ST.group = s.group;
  if (s.plannerSort) ST.plannerSort = s.plannerSort;
  if (s.plannerLayout) ST.plannerLayout = s.plannerLayout;
  if (s.plannerActiveList) ST.plannerActiveList = s.plannerActiveList;
}

function migrateOldData() {
  // Migrate wft3 (settings + starred items)
  try {
    const old = JSON.parse(localStorage.getItem('wft3') || '{}');
    if (old.cats)    ST.userData.settings.cats  = old.cats;
    if (old.acqs)    ST.userData.settings.acqs  = old.acqs;
    if (old.sort)    ST.userData.settings.sort  = old.sort;
    if (old.group)   ST.userData.settings.group = old.group;
    if (old.starred) old.starred.forEach(path => {
      getOrCreateEntity(path, 'item').starred = true;
    });
    localStorage.removeItem('wft3');
  } catch(e) {}
  // Migrate wft3_overrides
  try {
    const ov = JSON.parse(localStorage.getItem('wft3_overrides') || '{}');
    Object.entries(ov).forEach(([path, rank]) => {
      getOrCreateEntity(path, 'item').rank = rank;
    });
    localStorage.removeItem('wft3_overrides');
  } catch(e) {}
  // Migrate wft3_sp (planet-level SP toggles — convert to entity flags)
  try { localStorage.removeItem('wft3_sp'); } catch(e) {}
}

/* ── PROGRESS ────────────────────────────────── */
function setProgress(pct,msg) {
  const bar = document.getElementById('load-bar');
  const txt = document.getElementById('load-msg');
  if(bar) bar.style.width = pct+'%';
  if(txt && msg) txt.textContent = msg;
}

/* ── ITEM CLASSIFICATION ─────────────────────── */
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

function classifyItem(item) {
  const name = item.name || '';
  const nameKey = name.toLowerCase();
  const path = (item.uniqueName || '').toLowerCase();
  const apiCat = item.category || 'Other';

  // Specific rescues
  if (nameKey === 'runway') return { finalCat:'K-Drive', isRescued:true, scoreBoost:500000 };
  if (nameKey === 'helminth charger') return { finalCat:'Kubrow', isRescued:true, scoreBoost:500000 };

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
  
  // Explicitly ban items that track XP but yield 0 Mastery (Venari does give XP)
  const ZERO_MASTERY = [
    'plexus', 'bondi k-drive',
    "garuda's talons", "garuda prime talons", 'iron staff', 'iron staff prime',
    'regulators', 'regulators prime', 'dex pixia', 'dex pixia prime',
    'desert wind', 'desert wind prime', 'artemis bow', 'artemis bow prime',
    'balefire charger', 'diwata', 'diwata prime', 'valkyr talons', 'valkyr prime talons',
    'shadow claws', 'noctowl'
  ];

  if (ZERO_MASTERY.includes(nameKey) || junkKeywords.some(k=>nameKey.includes(k)) || ZAW_SLOP.some(s=>nameKey.includes(s)) || apiCat==='Mods' || path.includes('/upgrades/'))
    return { isJunk:true };

  const isZaw = DB_CONFIG.ZAW_STRIKES.includes(nameKey);
  const isKitgun = DB_CONFIG.KITGUN_CHAMBERS.includes(nameKey);
  const isMoa = path.includes('moapethead') || (path.includes('/moapets/') && (nameKey.includes('moa') || path.includes('head')));
  const isHound = path.includes('zanukapetparthead') || nameKey.includes('hound');
  const isKDrive = path.includes('kdrives/boards') || ['bad baby','feverspine','flatbelly','needlenose','runway'].some(k=>nameKey.includes(k));
  const isMech = nameKey==='voidrig' || nameKey==='bonewidow' || path.includes('entratimech');
  const isAmp = (nameKey.includes('prism') && !nameKey.includes('prisma')) || nameKey==='sirocco' || nameKey.includes('phahd') || apiCat==='Amps';
  const isSentinelWep = apiCat==='Sentinel Weapons' || path.includes('sentinelweapons') || ['akaten','batoten','cryotra','helstrum','lacerten','multron','tazicor','vulcax','deconstructor','verglas','sweeper','stinger','vulklok','artax','burst laser'].some(k=>nameKey.includes(k));
  
  // NEW: Identify Deimos Pets specifically
  const isVulp = nameKey.includes('vulpaphyla');
  const isPred = nameKey.includes('predasite');

  let finalCat = apiCat;
  if (isMech) finalCat='Necramechs';
  else if (isAmp) finalCat='Amps';
  else if (isMoa) finalCat='MOAs';
  else if (isHound) finalCat='Hounds';
  else if (isZaw) finalCat='Zaws';
  else if (isKitgun) finalCat='Kitguns';
  else if (isKDrive) finalCat='K-Drive';
  else if (isSentinelWep) finalCat='Sentinel Weapons';
  else if (isVulp) finalCat='Vulpaphyla';
  else if (isPred) finalCat='Predasite';
  else if (nameKey.includes('kavat') || nameKey.includes('venari')) finalCat='Kavat';
  else if (nameKey.includes('kubrow')) finalCat='Kubrow';
  else if (nameKey==='wyrm prime' || (apiCat==='Sentinels' && !isSentinelWep)) finalCat='Sentinels';
  else if (nameKey.includes('sybaris') || ['strun','paris','enkaus'].includes(nameKey)) finalCat='Primary';
  else if (nameKey.includes('gammacor') || ['lato','lex'].includes(nameKey) || nameKey==='grimoire') finalCat='Secondary';

  const isRescued = DB_CONFIG.RESCUE_LIST.includes(nameKey) || isMoa || isHound || isKDrive || isMech || isZaw || isKitgun || isSentinelWep || isAmp || isVulp || isPred;
  
  return { finalCat, isRescued, isZaw, isKitgun, isMoa, isHound, isKDrive, isMech, isAmp, scoreBoost: isRescued?400000:0, isJunk:false };
}

/* ── API FETCH ──────────────────────────────── */
async function fetchItemDb() {
  try {
    const cached = await dbGet('cache','item_db');
    if (cached && (Date.now()-cached.t)<CACHE_TTL) return cached.v;

    const resp = await fetch('https://raw.githubusercontent.com/wfcd/warframe-items/master/data/json/All.json');
    const items = await resp.json();
    const db = {}, dbByName = {};

    items.forEach(item => {
      if (!item || !item.uniqueName || !item.name) return;
      const res = classifyItem(item);
      if (res.isJunk) return;

      const { finalCat, isRescued, isZaw, isKitgun, isMoa, isHound, isVulpaphyla, isPredasite, isKDrive, isMech, isAmp, scoreBoost } = res;
      const pathLower = item.uniqueName.toLowerCase();

      const isModular = pathLower.includes('/modular/') || pathLower.includes('/zaw/') || pathLower.includes('/kitgun/') || pathLower.includes('/kdrive/') || pathLower.includes('/pets/');
      if (isModular && !isZaw && !isKitgun && !isMoa && !isHound && !isKDrive && !isMech && !isAmp && !isRescued) return;

      const isRecognized = DB_CONFIG.VALID_CATS.some(c => c===finalCat || (c.endsWith('s') && c.slice(0,-1)===finalCat));
      if (!isRecognized && !isRescued) return;

      let score = (item.masteryExp||0) + scoreBoost;
      if (item.introduced) score += 5000;
      if (pathLower.includes('/npc/')) score -= 500000;

      const nameKey = item.name.toLowerCase();
      if (dbByName[nameKey] && score <= dbByName[nameKey].score) return;

      // Fix: store introduced as a plain string
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
          maxRank: (pathLower.includes('kuva') || pathLower.includes('tenet') || pathLower.includes('lich') || pathLower.includes('coda') || isMech || pathLower.includes('paracesis')) ? 40 : 30
        }
      };
    });

    Object.values(dbByName).forEach(winner => { db[winner.path] = winner.data; });
    await dbSet('cache','item_db',db);
    return db;
  } catch(err) { return {}; }
}

/* ── UPDATE NAMES ───────────────────────────── */
async function fetchUpdateNames() {
  try {
    const cached = await dbGet('cache', 'update_names');
    if (cached && (Date.now() - cached.t) < CACHE_TTL) return cached.v;

    const resp = await fetch('https://raw.githubusercontent.com/WFCD/warframe-patchlogs/master/data/patchlogs.json');
    if (!resp.ok) throw new Error('Patchlog fetch failed');
    const logs = await resp.json();
    const map = {};

    logs.filter(l => l.type === 'Update').forEach(l => {
      // Handles both "Update 35: Title" and "Title: Update 35" orderings
      const m = l.name.match(/Update\s+(\d+)[.\d]*\s*[:\-–]?\s*(.+)|(.+?)\s*[:\-–]\s*Update\s+(\d+)/i);
      if (m) {
        const ver = m[1] || m[4];
        const title = (m[2] || m[3] || '').replace(/\s*\|\s*Warframe.*/i, '').trim();
        if (ver && title && !map[ver]) map[ver] = title;
      }
    });

    // Fill well-known older ones the regex may miss
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
  } catch(e) {
    console.warn('Update names fetch failed:', e);
    return {};
  }
}

/* ── MISSION DB (wiki mastery data) ─────────── */
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
      // Split on top-level node blocks — each starts with { and contains InternalName
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
    } catch(e) {
      console.warn('Mission DB fetch failed:', e);
      ST.missionDb = {};
      return ST.missionDb;
    } finally {
      ST._missionDbPromise = null;
    }
  })();

  return ST._missionDbPromise;
}

/* ── PROFILE PARSING ────────────────────────── */
function parseProfile(text) {
  const data = JSON.parse(text);
  const r = data.Results?.[0] || data;
  const srcA = (r.XPInfo||r.xpInfo||[]).filter(e=>e&&(e.ItemType||e.itemType)&&(e.XP||e.xp))
    .map(e=>({path:e.ItemType||e.itemType, xp:e.XP||e.xp}));
  const srcB = (data.Stats?.Weapons||[]).filter(w=>w&&w.type&&(w.xp||0)>0)
    .map(w=>({path:w.type, xp:w.xp}));
  const seen = new Set(srcA.map(e=>e.path));
  const xpData = [...srcA];
  for (const e of srcB) if (!seen.has(e.path)) { xpData.push(e); seen.add(e.path); }
  const missions = (r.Missions||[])
    .filter(m => m && (m.Tag||m.tag))
    .map(m => ({
      tag:      m.Tag      || m.tag      || '',
      tier:     m.Tier     || m.tier     || 0,
      completes:m.Completes|| m.completes|| 1,
    }));
  return {
    playerName:  r.DisplayName||r.displayName||'Tenno',
    playerLevel: r.PlayerLevel||r.playerLevel||0,
    xpData, missions,
  };
}

/* ── ITEM ENRICHMENT ────────────────────────── */
function detectAcq(path, name) {
  const p = (path||'').toLowerCase();
  const n = (name||'').toLowerCase();
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
  if (!itemDb || Object.keys(itemDb).length===0) return [];
  const userXPMap = {};
  xpData.forEach(e => { if (e.path) userXPMap[e.path.toLowerCase()] = e.xp; });

  return Object.entries(itemDb).map(([dbPath, api]) => {
    const userXP = userXPMap[dbPath] || 0;
    const { finalCat } = classifyItem({ name:api.name, uniqueName:dbPath, category:api.apiCat });
    const catKey = API_CAT_MAP[finalCat] || 'other';
    const multiplier = masteryMult(catKey);
    const maxR = api.maxRank || 30;
    // For rank-40 items, XP is cumulative across Forma cycles so xpToRank can mislead.
    // Cap the XP-derived rank at 30; user sets the real rank via the input.
    const xpCap = maxR === 40 ? 30 : maxR;
    const rank = ST.overrides[dbPath] !== undefined
      ? ST.overrides[dbPath]
      : xpToRank(userXP, multiplier, xpCap);


    // Items requiring gilding before they grant mastery
    const GILD_CATS = new Set(['amp','zaw','kitgun','moa','predasite','vulpaphyla']);
    const requiresGilding = GILD_CATS.has(catKey);
    const isGilded = requiresGilding
      ? (ST.userData.entities[dbPath]?.gilded ?? (userXP > 0))
      : true; // assume gilded if owned; user can uncheck if not
    const effectiveMastery = isGilded ? rank * multiplier : 0;

    return {
      path: dbPath,
      name: api.name,
      cat: catKey,
      acq: detectAcq(dbPath, api.name),
      xp: userXP,
      rank,
      maxRank: maxR,
      mastery: effectiveMastery,
      requiresGilding,
      isGilded,
      isOwned: userXP > 0,
      isFounder: api.isFounder,
      update: api.introduced || 'Unknown',
      majorUpdate: api.majorUpdate || '0',
    };
  });
}

/* ── STAR CHART ─────────────────────────────── */

async function loadStarChartData() {
  await Promise.all([loadNodeDb(), fetchMissionDb()]);
}

async function loadNodeDb() {
  if (ST.nodeDb) return;
  try {
    const cached = await dbGet('cache', 'node_db');
    if (cached && (Date.now() - cached.t) < CACHE_TTL) { ST.nodeDb = cached.v; return; }
    const resp = await fetch('https://raw.githubusercontent.com/WFCD/warframe-worldstate-data/master/data/solNodes.json');
    if (!resp.ok) throw new Error('Nodes fetch failed');
    const raw = await resp.json();
    // Normalise: static data is already an object keyed by node ID
    const db = Array.isArray(raw)
      ? Object.fromEntries(raw.map(n => [n.id || n.tag, n]))
      : raw;
    ST.nodeDb = db;
    await dbSet('cache', 'node_db', db);
  } catch(e) {
    console.warn('Node DB failed:', e);
    ST.nodeDb = {};
  }
}

function processStarChart(missions, nodeDb, missionDb) {
  const PLANET_ORDER = [
    'Mercury','Venus','Earth','Mars','Phobos','Ceres','Jupiter','Europa',
    'Saturn','Uranus','Neptune','Pluto','Sedna','Eris','Lua',
    'Kuva Fortress','Void','Deimos','Zariman','Duviri'
  ];
  const JUNCTION_MANIFEST = [
    {tag:'VenusToMercuryJunction',  planet:'Venus',   dest:'Mercury'  },
    {tag:'EarthToVenusJunction',    planet:'Earth',   dest:'Venus'    },
    {tag:'EarthToMarsJunction',     planet:'Earth',   dest:'Mars'     },
    {tag:'MarsToPhobosJunction',    planet:'Mars',    dest:'Phobos'   },
    {tag:'MarsToCeresJunction',     planet:'Mars',    dest:'Ceres'    },
    {tag:'CeresToJupiterJunction',  planet:'Ceres',   dest:'Jupiter'  },
    {tag:'JupiterToEuropaJunction', planet:'Jupiter', dest:'Europa'   },
    {tag:'JupiterToSaturnJunction', planet:'Jupiter', dest:'Saturn'   },
    {tag:'SaturnToUranusJunction',  planet:'Saturn',  dest:'Uranus'   },
    {tag:'UranusToNeptuneJunction', planet:'Uranus',  dest:'Neptune'  },
    {tag:'NeptuneToPlutoJunction',  planet:'Neptune', dest:'Pluto'    },
    {tag:'PlutoToErisJunction',     planet:'Pluto',   dest:'Eris'     },
    {tag:'ErisToSednaJunction',     planet:'Eris',    dest:'Sedna'    },
  ];
  const manifestTags  = new Set(JUNCTION_MANIFEST.map(j => j.tag));
  const JUNK_TYPES    = new Set(['ancient retribution','conclave','pvp']);
  // Explicit node exclusions — social spaces + non-mastery modes
  const EXCLUDE_TAGS  = new Set(['SolNode234']); // Dormizone (Zariman social space)
  const EXCLUDE_NAMES = ['index endurance']; // Index variant that doesn't count

  const baseDone     = new Set(missions.map(m => m.tag).filter(Boolean));
  const spDone       = new Set(missions.filter(m => m.tier >= 1).map(m => m.tag));
  const completesMap = Object.fromEntries(missions.map(m => [m.tag, m.completes]));
  const planets = {}, railjack = [];

  const mkNode = (tag, name, type, extra, md) => ({
    tag, name, type,
    enemy:     md?.enemy     || '',
    minLevel:  md?.minLevel  || 0,
    maxLevel:  md?.maxLevel  || 0,
    done:      baseDone.has(tag),
    spDone:    spDone.has(tag),
    completes: completesMap[tag] || 0,
    masteryExp:md?.masteryExp || 0,
    isJunction:false,
    ...extra,
  });

  const seenNodes = new Set();

  for (const [tag, node] of Object.entries(nodeDb)) {
    if (!node) continue;
    if (/hub/i.test(tag)) continue;
    if (EXCLUDE_TAGS.has(tag)) continue;

    const mdata    = missionDb?.[tag] || {};
    const rawType  = node.type || node.missionType || '';
    const effType  = (mdata.type || rawType).toLowerCase();

    if (JUNK_TYPES.has(effType)) continue;
    if (effType === 'relay' && !mdata.type) continue;
    if (!rawType && !mdata.type && !baseDone.has(tag)) continue;

    const rawValue = node.value || '';
    const planet   = node.planet || (rawValue.match(/\(([^)]+)\)$/)?.[1] || '') || mdata.planet || node.systemName || '';
    const name     = rawValue.replace(/\s*\([^)]+\)$/, '').trim() || mdata.name || tag;

    if (EXCLUDE_NAMES.some(n => name.toLowerCase().includes(n))) continue;

    const isRJ = tag.startsWith('CrewBattle') || effType.includes('proxima') || planet.toLowerCase().includes('proxima');

    if (!baseDone.has(tag) && !missionDb?.[tag]) continue;

    // Deduplicate by name+planet — keep completed version if dupes exist
    const dedupKey = name + '||' + planet;
    if (seenNodes.has(dedupKey) && !baseDone.has(tag)) continue;
    seenNodes.add(dedupKey);
    const nd = mkNode(tag, name, mdata.type || rawType, {}, mdata);
    if (isRJ) railjack.push(nd);
    else if (planet) { if (!planets[planet]) planets[planet]=[]; planets[planet].push(nd); }
  }

  JUNCTION_MANIFEST.forEach(j => {
    if (!planets[j.planet]) planets[j.planet] = [];
    planets[j.planet].push(mkNode(j.tag, j.dest + ' Junction', 'Junction',
      {isJunction:true, masteryExp:1000}, null));
  });

  missions.forEach(m => {
    if (!m.tag.endsWith('Junction') || manifestTags.has(m.tag)) return;
    const match = m.tag.match(/^([A-Z][a-zA-Z]+?)To([A-Z][a-zA-Z]+?)Junction$/);
    if (!match) return;
    const planet = PLANET_ORDER.find(p => p.replace(/\s/g,'') === match[1]) || match[1].replace(/([A-Z])/g,' $1').trim();
    const dest   = match[2].replace(/([A-Z])/g,' $1').trim();
    if (!planets[planet]) planets[planet] = [];
    planets[planet].push(mkNode(m.tag, dest + ' Junction', 'Junction',
      {isJunction:true, masteryExp:1000}, null));
    manifestTags.add(m.tag);
  });

  Object.values(planets).forEach(nodes =>
    nodes.sort((a,b)=>(a.isJunction===b.isJunction)?a.name.localeCompare(b.name):a.isJunction?-1:1)
  );
  const sorted = Object.entries(planets).sort(([a],[b])=>{
    const ai=PLANET_ORDER.indexOf(a),bi=PLANET_ORDER.indexOf(b);
    if(ai===-1&&bi===-1)return a.localeCompare(b);
    return(ai===-1)?1:(bi===-1)?-1:ai-bi;
  });
  return {planets:sorted.map(([name,nodes])=>({name,nodes})),railjack:railjack.sort((a,b)=>a.name.localeCompare(b.name))};
}


function renderStarChart() {
  const el = document.getElementById('scgrid');
  if (!el) return;
  el.innerHTML = '';

  if (!ST.nodeDb || !Object.keys(ST.nodeDb).length) {
    el.innerHTML = '<div style="color:var(--tx3);font-size:.88rem;padding:2rem 0">Loading star chart data…</div>';
    return;
  }

  const { planets, railjack } = processStarChart(ST.missions, ST.nodeDb, ST.missionDb);

  // Tallies
  let totalNodes=0,doneNodes=0,spTotal=0,spDoneCount=0,junctionTotal=0,junctionDone=0,mxpAvailable=0;
  planets.forEach(p=>p.nodes.forEach(n=>{
    totalNodes++; if(n.done)doneNodes++;
    if(n.isJunction){junctionTotal++;if(n.done)junctionDone++;}
    if(n.done){spTotal++;if(n.spDone)spDoneCount++;}
    if(n.masteryExp>0&&(n.isJunction?!n.done:!n.spDone))mxpAvailable+=n.masteryExp;
  }));
  const overallPct = totalNodes ? Math.round(doneNodes/totalNodes*100) : 0;
  const spOverallPct = spTotal ? Math.round(spDoneCount/spTotal*100) : 0;
  const isOverallBaseDone = overallPct === 100;
  const displayOverallPct = isOverallBaseDone ? spOverallPct : overallPct;
  const overallLabel = isOverallBaseDone ? `${displayOverallPct}% SP` : `${displayOverallPct}%`;
  const overallBarColor = isOverallBaseDone ? '#8866e8' : 'var(--acc)';

  // Summary bar
  const summary = document.createElement('div'); summary.className='sc-summary';
  summary.innerHTML=`
    <div class="sc-sum-stat"><div class="sc-sum-num">${doneNodes}/${totalNodes}</div><div class="sc-sum-lbl">Base nodes</div></div>
    <div style="width:1px;height:28px;background:var(--bd2);flex-shrink:0"></div>
    <div class="sc-sum-stat"><div class="sc-sum-num">${spDoneCount}/${spTotal}</div><div class="sc-sum-lbl">Steel Path</div></div>
    <div style="width:1px;height:28px;background:var(--bd2);flex-shrink:0"></div>
    <div class="sc-sum-stat"><div class="sc-sum-num">${junctionDone}/${junctionTotal}</div><div class="sc-sum-lbl">Junctions</div></div>
    ${mxpAvailable>0?`<div style="width:1px;height:28px;background:var(--bd2);flex-shrink:0"></div><div class="sc-sum-stat"><div class="sc-sum-num sc-mxp-available">+${fmtM(mxpAvailable)}</div><div class="sc-sum-lbl">MXP available</div></div>`:''}
    <div class="scbw" style="flex:1;height:6px"><div class="scb" style="width:${displayOverallPct}%;background:${overallBarColor}"></div></div>
    <div class="sc-sum-stat" style="align-items:flex-end"><div class="sc-sum-num" style="color:${overallBarColor}">${overallLabel}</div><div class="sc-sum-lbl">Overall</div></div>`;
  el.appendChild(summary);

  // Controls row
  const cols = ST.userData.settings?.scCols ?? 3;
  const controls = document.createElement('div'); controls.className = 'sc-controls';
  controls.innerHTML = `
    <div class="sc-legend">
      <span class="sc-legend-item"><span class="sc-legend-dot" style="background:var(--tx3);opacity:.4"></span>Not visited</span>
      <span class="sc-legend-item"><span class="sc-legend-dot" style="background:color-mix(in srgb,var(--acc) 55%,var(--bg))"></span>Base done</span>
      <span class="sc-legend-item"><span class="sc-legend-dot" style="background:#8866e8"></span>Steel Path done</span>
      <span class="sc-legend-item"><span class="sc-legend-dot" style="background:#b89830"></span>◆ Junction (mastery XP)</span>
    </div>
    <div class="sc-col-ctrl">
      <span>Columns</span>
      <button class="sc-col-btn" onclick="setSCCols(${Math.max(1,cols-1)})">−</button>
      <span>${cols}</span>
      <button class="sc-col-btn" onclick="setSCCols(${Math.min(5,cols+1)})">+</button>
    </div>`;
  el.appendChild(controls);

  // Section header
  const ph=document.createElement('div');ph.className='sc-section';ph.textContent='Main Star Chart';el.appendChild(ph);

  // Build the node row function
  function buildNodeRow(n) {
    const row=document.createElement('div');
    row.className='sc-node'+(n.spDone?' sp-done':n.done?' done':'')+(n.isJunction?' junction':'');
    const lvl=n.minLevel&&n.maxLevel?`${n.minLevel}–${n.maxLevel}`:'';
    const typeStr=[n.type,n.enemy,lvl].filter(Boolean).join(' · ');
    row.innerHTML=`
      <span class="sc-node-status">${n.done?'✓':'○'}</span>
      <span class="sc-node-icon">${n.isJunction?'◆':'●'}</span>
      <span class="sc-node-name">${n.name}</span>
      <span class="sc-node-type">${typeStr}</span>
      ${n.completes>0?`<span class="sc-node-runs">${n.completes}×</span>`:''}
      ${n.masteryExp>0&&(n.isJunction?!n.done:!n.spDone)?`<span class="sc-node-mxp" title="${n.isJunction?'Junction':'SP'} completion awards ${n.masteryExp} mastery XP">+${n.masteryExp}</span>`:''}
      <a class="sc-node-wiki" href="https://wiki.warframe.com/w/${n.name.replace(/ /g,'_')}" target="_blank" onclick="event.stopPropagation()">wiki ↗</a>
      <button class="sc-node-star">★</button>
      <input class="sc-node-note" type="text" placeholder="note…">`;
    const sb=row.querySelector('.sc-node-star');
    if(isEntityStarred(n.tag))sb.classList.add('on');
    sb.addEventListener('click',e=>{e.stopPropagation();toggleEntityStar(n.tag,'node',sb);});
    const ni=row.querySelector('.sc-node-note');
    ni.value=ST.userData.entities[n.tag]?.note||'';
    ni.addEventListener('blur',()=>saveEntityNote(n.tag,'node',ni.value));
    ni.addEventListener('click',e=>e.stopPropagation());
    ni.addEventListener('keydown',e=>e.stopPropagation());
    return row;
  }

  // Sort planets: starred first, then original order
  const sortedPlanets = [...planets].sort((a,b) => {
    const aS = isEntityStarred('planet:'+a.name) ? 0 : 1;
    const bS = isEntityStarred('planet:'+b.name) ? 0 : 1;
    return aS - bS;
  });

  // Planet grid
  const grid = document.createElement('div');
  grid.className = 'sc-planet-grid';
  grid.style.setProperty('--cols', cols);

  let activePlanet = null;
  const detailPanel = document.getElementById('sc-planet-detail');

  function openPlanetDetail(p, tile) {
    if (!detailPanel) return;
    // Deselect previous
    grid.querySelectorAll('.sc-planet-tile.selected').forEach(t => t.classList.remove('selected'));
    // If clicking the same planet, close
    if (activePlanet === p.name) {
      activePlanet = null;
      detailPanel.classList.remove('open');
      detailPanel.innerHTML = '';
      return;
    }
    activePlanet = p.name;
    tile.classList.add('selected');

    // Build node list
    const nodes = p.nodes;
    const hdr = document.createElement('div'); hdr.className = 'sc-planet-detail-hdr';
    hdr.innerHTML = `<span class="sc-detail-name">${p.name}</span>
      <span style="font-family:'Share Tech Mono',monospace;font-size:.7rem;color:var(--tx3)">${nodes.filter(n=>n.done).length}/${nodes.length} base · ${nodes.filter(n=>n.spDone).length} SP</span>
      <button class="sc-detail-close" onclick="closePlanetDetail()">✕ Close</button>`;
    hdr.addEventListener('click', e => { if (!e.target.closest('button')) closePlanetDetail(); });

    const nodeList = document.createElement('div');
    nodes.forEach(n => nodeList.appendChild(buildNodeRow(n)));

    detailPanel.innerHTML = '';
    detailPanel.appendChild(hdr);
    detailPanel.appendChild(nodeList);
    detailPanel.classList.add('open');
    detailPanel.scrollIntoView({behavior:'smooth', block:'nearest'});
  }

  function closePlanetDetail() {
    activePlanet = null;
    if (detailPanel) { detailPanel.classList.remove('open'); detailPanel.innerHTML = ''; }
    grid.querySelectorAll('.sc-planet-tile.selected').forEach(t => t.classList.remove('selected'));
  }

  sortedPlanets.forEach(p => {
    const done  = p.nodes.filter(n=>n.done).length;
    const spD   = p.nodes.filter(n=>n.spDone).length;
    const total = p.nodes.length;

    const basePct = total ? Math.round(done/total*100) : 0;
    const spPct   = total ? Math.round(spD/total*100) : 0;
    const isBaseDone = basePct === 100;
    const displayPct = isBaseDone ? spPct : basePct;
    const pctClass = isBaseDone ? 'sc-tile-pct sp-focus' : 'sc-tile-pct';
    const pctLabel = isBaseDone ? `${displayPct}% SP` : `${displayPct}%`;
    const starred = isEntityStarred('planet:'+p.name);

    // Available MXP for this planet
    const availMxp = p.nodes.reduce((s,n) => {
      if (n.masteryExp > 0 && (n.isJunction ? !n.done : !n.spDone)) return s + n.masteryExp;
      return s;
    }, 0);

    const tile = document.createElement('div');
    tile.className = 'sc-planet-tile' + (isBaseDone?' complete':'') + (starred?' priority':'');

    tile.innerHTML = `
      <div class="sc-tile-hdr">
        <span class="sc-tile-name">${p.name}</span>
        <button class="sc-tile-star${starred?' on':''}">⭑</button>
        <span class="${pctClass}">${pctLabel}</span>
      </div>
      <div class="sc-dual-bar">
        <div class="sc-dual-base" style="width:${basePct}%"></div>
        <div class="sc-dual-sp" style="width:${spPct}%"></div>
      </div>
      <div class="sc-tile-stats">${done}/${total} base · <span class="sp-done">${spD}</span> SP${availMxp > 0 ? ` · <span style="color:#b89830">+${fmtM(availMxp)}</span>` : ''}</div>`;

    const starBtn = tile.querySelector('.sc-tile-star');
    starBtn.addEventListener('click', e => {
      e.stopPropagation();
      const on = toggleEntityStar('planet:'+p.name, 'planet', starBtn);
      tile.classList.toggle('priority', on);
    });

    tile.addEventListener('click', e => {
      if (e.target.closest('.sc-tile-star')) return;
      openPlanetDetail(p, tile);
    });

    grid.appendChild(tile);
  })
  el.appendChild(grid);

  // Railjack
  if (railjack.length) {
    const rh=document.createElement('div');rh.className='sc-section';rh.style.marginTop='.75rem';rh.textContent='Railjack';el.appendChild(rh);
    const rjDone=railjack.filter(n=>n.done).length;
    const rjSp=railjack.filter(n=>n.spDone).length;
    const rjPct=Math.round(rjDone/railjack.length*100);
    const rjSpPct=Math.round(rjSp/railjack.length*100);
    const rgrid=document.createElement('div');rgrid.className='sc-planet-grid';rgrid.style.setProperty('--cols',cols);
    const rtile=document.createElement('div');rtile.className='sc-planet-tile'+(rjPct===100?' complete':'');
    rtile.innerHTML=`
      <div class="sc-tile-hdr"><span class="sc-tile-name">Railjack</span><span class="sc-tile-pct">${rjPct}%</span></div>
      <div class="sc-dual-bar"><div class="sc-dual-base" style="width:${rjPct}%"></div><div class="sc-dual-sp" style="width:${rjSpPct}%"></div></div>
      <div class="sc-tile-stats">${rjDone}/${railjack.length} base · <span class="sp-done">${rjSp}</span> SP</div>
      <div class="sc-tile-body"></div>`;
    const rjPlanet = {name:'Railjack', nodes: railjack};
    rtile.addEventListener('click', e => {
      if (e.target.closest('.sc-tile-star')) return;
      openPlanetDetail(rjPlanet, rtile);
    });
    rgrid.appendChild(rtile);el.appendChild(rgrid);
  }
}

function closePlanetDetail() {
  const detailPanel = document.getElementById('sc-planet-detail');
  if (detailPanel) { detailPanel.classList.remove('open'); detailPanel.innerHTML = ''; }
  document.querySelectorAll('.sc-planet-tile.selected').forEach(t => t.classList.remove('selected'));
}

function setSCCols(n) {
  if (!ST.userData.settings) ST.userData.settings = {};
  ST.userData.settings.scCols = n;
  saveUserData();
  renderStarChart();
}

function togglePlanetStar(name, btn) {
  toggleEntityStar('planet:'+name, 'planet', btn);
}

const PLANNER_BREAKDOWN = {
  P: { name: 'Progression', desc: 'Rank and star chart access.' },
  R: { name: 'Runs', desc: 'Mission runtime to get blueprint drops.' },
  M: { name: 'Materials', desc: 'Resource gathering to craft parts.' },
  Q: { name: 'Quest', desc: 'Direct quest time requirements.' },
  S: { name: 'Soft Lock', desc: 'Wait-gated rotations, events, or spawns.' },
};
const PLANNER_STAGE_ORDER = ['Very Early Game', 'Early Game', 'Mid-Game', 'Late Game'];

function escapeHtml(v) {
  return String(v || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizePlannerName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\s+prime$/, '')
    .trim();
}

function ensurePlannerData() {
  if (ST.plannerData && ST.plannerIndex) return;
  const source = Array.isArray(window.WF_BREAKDOWN) ? window.WF_BREAKDOWN : [];
  ST.plannerData = source;
  ST.plannerIndex = {};
  source.forEach(row => {
    const key = normalizePlannerName(row.warframe);
    if (key) ST.plannerIndex[key] = row;
  });
}

function rebuildPlannerFilterOptions() {
  const sel = document.getElementById('planner-filter');
  const listSel = document.getElementById('planner-list');
  if (!sel || !listSel) return;
  const prev = sel.value || 'all';
  sel.innerHTML = `
    <option value="all">All base frames</option>
    <option value="starred">Starred only</option>
    <option value="unowned">Unowned first</option>`;

  // Populate the separate list dropdown
  listSel.innerHTML = `<option value="none">No list filter</option>`;
  ST.userData.lists.forEach(l => {
    const o = document.createElement('option');
    o.value = l.id;
    o.textContent = l.name;
    listSel.appendChild(o);
  });

  const exists = [...sel.options].some(o => o.value === prev);
  sel.value = exists ? prev : 'all';
  listSel.value = ST.activeList || 'none';
}

function comparePlannerRows(a, b) {
  const mode = document.getElementById('planner-filter')?.value || 'all';
  if (mode === 'unowned') {
    const aUnowned = a.item.isOwned ? 1 : 0;
    const bUnowned = b.item.isOwned ? 1 : 0;
    if (aUnowned !== bUnowned) return aUnowned - bUnowned;
  }
  if (ST.plannerSort === 'stars-desc') return b.planner.total_stars - a.planner.total_stars;
  if (ST.plannerSort === 'stars-asc') return a.planner.total_stars - b.planner.total_stars;
  if (ST.plannerSort === 'name-asc') return a.item.name.localeCompare(b.item.name);
  if (ST.plannerSort === 'rank-asc') return a.progressPct - b.progressPct;
  if (ST.plannerSort === 'rank-desc') return b.progressPct - a.progressPct;
  return b.planner.total_stars - a.planner.total_stars;
}

function plannerRows() {
  ensurePlannerData();
  const rows = ST.items
    .filter(it => it.cat === 'warframe' && !/\sprime$/i.test(it.name))
    .map(it => {
      const key = normalizePlannerName(it.name);
      const p = ST.plannerIndex?.[key];
      if (!p) return null;
      const e = ST.userData.entities[it.path] || {};
      return {
        item: it,
        planner: p,
        entity: e,
        progressPct: it.maxRank > 0 ? Math.round((it.rank / it.maxRank) * 100) : 0,
        starred: isEntityStarred(it.path),
        farmStatus: e.farmStatus || 'unset',
        checks: e.farmChecks || {},
        inActiveList: ST.activeList ? !!ST.userData.entities[it.path]?.lists?.includes(ST.activeList) : false,
      };
    })
    .filter(Boolean);

  const mode = document.getElementById('planner-filter')?.value || 'all';
  const listSel = document.getElementById('planner-list')?.value || 'none';
  let visible = rows;
  if (listSel !== 'none') {
    visible = rows.filter(r => ST.userData.entities[r.item.path]?.lists?.includes(listSel));
    // keep runtime activeList in sync with UI
    ST.activeList = listSel;
  } else if (mode === 'starred') visible = rows.filter(r => r.starred);
  else if (mode === 'unowned') visible = rows.slice();

  visible.sort(comparePlannerRows);

  return visible;
}

function onPlannerLayout(v) {
  ST.plannerLayout = v;
  renderPlanner();
  saveSettings();
}

function setPlannerFarmStatus(path, cat, status) {
  const e = getOrCreateEntity(path, cat);
  if (!status || status === 'unset') delete e.farmStatus;
  else e.farmStatus = status;
  pruneEntity(path);
  saveUserData();
}

function setPlannerCheck(path, cat, key, checked) {
  const e = getOrCreateEntity(path, cat);
  if (!e.farmChecks) e.farmChecks = {};
  if (checked) e.farmChecks[key] = true;
  else delete e.farmChecks[key];
  if (!Object.keys(e.farmChecks).length) delete e.farmChecks;
  pruneEntity(path);
  saveUserData();
}

function onPlannerSort(v) {
  ST.plannerSort = v;
  renderPlanner();
  saveSettings();
}

function renderPlanner() {
  const wrap = document.getElementById('planner-wrap');
  if (!wrap) return;

  const rows = plannerRows();
  ST._plannerVisibleRows = rows;
  if (!rows.length) {
    wrap.innerHTML = '<div class="planner-empty">No matching base frames for current Planner filters.</div>';
    ST._plannerSelectedPath = null;
    ST._plannerHoveredPath = null;
    return;
  }

  const farmLabels = {
    unset: 'No status',
    can_now: 'Can farm now',
    blocked: 'Blocked',
    in_progress: 'In progress',
    done: 'Done',
  };

  const makePlannerRow = (r) => {
    const details = document.createElement('details');
    details.className = 'planner-row';
    details.dataset.path = r.item.path;
    if (ST._plannerSelectedPath === r.item.path) details.classList.add('selected');
    // Reflect ownership/maxed state visually like the Items tab
    if (!r.item.isOwned) details.classList.add('unowned');
    if (r.item.maxRank > 0 && r.item.rank < r.item.maxRank) details.classList.add('unmaxxed');

    const farmLabel = farmLabels[r.farmStatus] || 'No status';
    const notePresent = !!r.entity.note;
    const ownedCls = r.item.isOwned ? 'owned' : 'unowned';
    const rankStateCls = r.item.rank <= 0 ? 'rank-zero' : (r.item.rank >= r.item.maxRank ? 'rank-max' : 'rank-mid');
    const rankStateLbl = r.item.rank <= 0 ? 'Rank 0' : (r.item.rank >= r.item.maxRank ? 'Rank Max' : 'Rank In Progress');
    const breakdownHtml = Object.entries(PLANNER_BREAKDOWN).map(([k, cfg]) => {
      const val = Number(r.planner.breakdown?.[k] || 0).toFixed(1);
      return `<div class="planner-break"><div class="planner-break-top"><span class="planner-break-name">${cfg.name}</span><span class="planner-break-val">${val}</span></div><div class="planner-break-desc">${cfg.desc}</div></div>`;
    }).join('');

    const checksHtml = Object.entries(PLANNER_BREAKDOWN).map(([k, cfg]) => {
      const checked = r.checks[k] ? 'checked' : '';
      return `<label class="planner-check"><input data-check="${k}" type="checkbox" ${checked}> ${cfg.name}</label>`;
    }).join('');

    details.innerHTML = `
      <summary>
        <div class="planner-main">
          <button type="button" class="planner-star${r.starred ? ' on' : ''}" title="Toggle favorite">★</button>
          <div class="planner-meta">
            <span class="planner-name">${escapeHtml(r.item.name)}</span>
            <span class="planner-stars">${Number(r.planner.total_stars).toFixed(1)} ★</span>
            <span class="planner-cat">${escapeHtml(r.planner.category)}</span>
            <span class="planner-chip ${ownedCls}">${r.item.isOwned ? 'Owned' : 'Unowned'}</span>
            <span class="planner-chip ${rankStateCls}">${rankStateLbl}</span>
            <span class="planner-chip farm">${escapeHtml(farmLabel)}</span>
            ${notePresent ? '<span class="planner-chip note">Note</span>' : ''}
          </div>
        </div>
        <div class="planner-right">
          <select class="planner-farmsel" title="Farm status">
            <option value="unset" ${r.farmStatus==='unset'?'selected':''}>No status</option>
            <option value="can_now" ${r.farmStatus==='can_now'?'selected':''}>Can farm now</option>
            <option value="blocked" ${r.farmStatus==='blocked'?'selected':''}>Blocked</option>
            <option value="in_progress" ${r.farmStatus==='in_progress'?'selected':''}>In progress</option>
            <option value="done" ${r.farmStatus==='done'?'selected':''}>Done</option>
          </select>
          <span class="planner-expand">▾</span>
        </div>
      </summary>
      <div class="planner-body">
        <div class="planner-section"><h3>Why This Rating</h3><div class="planner-justify">${escapeHtml(r.planner.justification || 'No notes provided.')}</div></div>
        <div class="planner-section"><h3>Difficulty Breakdown</h3><div class="planner-breakdown">${breakdownHtml}</div></div>
        <div class="planner-body-row"><div class="planner-section" style="flex:1;min-width:260px"><h3>Shared Note</h3><textarea class="planner-textarea" placeholder="Add a planning note…">${escapeHtml(r.entity.note || '')}</textarea></div></div>
        <div class="planner-section"><h3>Personal Checklist</h3><div class="planner-checks">${checksHtml}</div></div>
      </div>`;

    const starBtn = details.querySelector('.planner-star');
    starBtn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      toggleEntityStar(r.item.path, r.item.cat, starBtn);
      if ((document.getElementById('planner-filter')?.value || 'all') === 'starred') renderPlanner();
    });

    details.querySelector('summary')?.addEventListener('click', (e) => {
      // Toggle selection without forcing a full re-render to avoid
      // interrupting native details open/close behavior.
      const prev = ST._plannerSelectedPath;
      ST._plannerSelectedPath = (prev === r.item.path) ? null : r.item.path;
      // Update classes in-place
      if (prev) {
        const prevEl = document.querySelector(`.planner-row[data-path="${prev}"]`);
        if (prevEl) prevEl.classList.remove('selected');
      }
      if (ST._plannerSelectedPath) details.classList.add('selected'); else details.classList.remove('selected');
    });
    details.addEventListener('mouseenter', () => { ST._plannerHoveredPath = r.item.path; });

    const farmSel = details.querySelector('.planner-farmsel');
    farmSel.addEventListener('click', e => e.stopPropagation());
    farmSel.addEventListener('change', () => {
      setPlannerFarmStatus(r.item.path, r.item.cat, farmSel.value);
      renderPlanner();
    });

    const noteEl = details.querySelector('.planner-textarea');
    noteEl.addEventListener('blur', () => saveEntityNote(r.item.path, r.item.cat, noteEl.value));
    noteEl.addEventListener('click', e => e.stopPropagation());
    noteEl.addEventListener('keydown', e => e.stopPropagation());

    details.querySelectorAll('input[data-check]').forEach(input => {
      input.addEventListener('change', () => {
        setPlannerCheck(r.item.path, r.item.cat, input.dataset.check, input.checked);
      });
    });

    return details;
  };

  wrap.innerHTML = '';
  if (ST.plannerLayout === 'list') {
    const frag = document.createDocumentFragment();
    rows.forEach(r => frag.appendChild(makePlannerRow(r)));
    wrap.appendChild(frag);
    return;
  }

  const stageMap = {};
  PLANNER_STAGE_ORDER.forEach(s => { stageMap[s] = []; });
  rows.forEach(r => {
    const stage = PLANNER_STAGE_ORDER.includes(r.planner.category) ? r.planner.category : 'Late Game';
    stageMap[stage].push(r);
  });

  const colWrap = document.createElement('div');
  colWrap.className = 'planner-col-wrap';
  PLANNER_STAGE_ORDER.forEach(stage => {
    const colRows = stageMap[stage] || [];
    colRows.sort(comparePlannerRows);
    const col = document.createElement('div');
    col.className = 'planner-col';
    const hdr = document.createElement('div');
    hdr.className = 'planner-col-hdr';
    hdr.innerHTML = `<span class="planner-col-name">${escapeHtml(stage)}</span><span class="planner-col-count">${colRows.length}</span>`;
    col.appendChild(hdr);
    if (!colRows.length) {
      const empty = document.createElement('div');
      empty.className = 'planner-empty';
      empty.style.padding = '1.2rem .6rem';
      empty.style.fontSize = '.72rem';
      empty.textContent = 'No frames in this stage for current filters.';
      col.appendChild(empty);
    } else {
      colRows.forEach(r => col.appendChild(makePlannerRow(r)));
    }
    colWrap.appendChild(col);
  });
  wrap.appendChild(colWrap);
}


/* ── FILTERING ──────────────────────────────── */
function filteredItems() {
  const needsReview  = document.getElementById('tog-review')?.checked;
  const showFounders = document.getElementById('tog-founders')?.checked;
  const unmaxed      = document.getElementById('tog-unmaxed')?.checked;
  const onlyStar     = document.getElementById('tog-starred')?.checked;
  const unowned      = document.getElementById('tog-unowned')?.checked;
  const needsForma   = document.getElementById('tog-forma')?.checked;
  const upd          = document.getElementById('upd-sel')?.value || '';

  const primeFilter = document.getElementById('prime-sel')?.value || '';

  return ST.items.filter(it => {
    if (!showFounders && it.isFounder && !it.isOwned) return false;
    if (!unowned && !it.isOwned) return false;
    if (!ST.cats[it.cat]) return false;
    if (!ST.acqs[it.acq]) return false;
    if (upd && it.majorUpdate !== upd) return false;
    if (unmaxed && it.rank >= it.maxRank && it.maxRank > 0) return false;
    if (onlyStar && !ST.starred.has(it.path)) return false;
    if (needsForma && !(it.maxRank===40 && it.rank<40)) return false;
    // Needs review: show all items with gildable or rank-40 modifier (ownership controlled by Show Unowned)
    if (needsReview && !it.requiresGilding && it.maxRank !== 40) return false;
    if (primeFilter === 'prime' && !it.name.toLowerCase().includes(' prime')) return false;
    if (primeFilter === 'nonprime' && it.name.toLowerCase().includes(' prime')) return false;
    if (ST.activeList) {
      const entityLists = ST.userData.entities[it.path]?.lists || [];
      if (!entityLists.includes(ST.activeList)) return false;
    }
    if (ST.search && !it.name.toLowerCase().includes(ST.search.toLowerCase())) return false;
    return true;
  });
}

/* ── RENDER: CHIPS ──────────────────────────── */
function buildChips() {
  const cc = {}, ac = {};
  for (const it of ST.items) {
    cc[it.cat] = (cc[it.cat]||0) + 1;
    ac[it.acq] = (ac[it.acq]||0) + 1;
  }

  const ce = document.getElementById('cat-chips');
  if (ce) {
    ce.innerHTML = '';
    CAT_GROUPS.forEach((grp, gi) => {
      if (gi > 0) {
        const sep = document.createElement('span');
        sep.className = 'chip-sep';
        ce.appendChild(sep);
      }
      // Group label (toggles whole group)
      const lbl = document.createElement('button');
      lbl.className = 'chip-grp-lbl';
      lbl.textContent = grp.label;
      lbl.title = `Toggle all ${grp.label}`;
      lbl.onclick = () => {
        const anyOn = grp.keys.some(k => ST.cats[k]);
        grp.keys.forEach(k => { if (CAT[k]) ST.cats[k] = !anyOn; });
        buildChips(); render(); saveSettings();
      };
      ce.appendChild(lbl);

      const cg = document.createElement('div');
      cg.className = 'chip-group';
      grp.keys.forEach(k => {
        const cfg = CAT[k];
        if (!cfg) return;
        if (!(cc[k]||0)) return; // hide empty categories
        const b = document.createElement('button');
        b.className = 'chip' + (ST.cats[k] ? ' on' : '');
        b.style.setProperty('--cc', cfg.c);
        b.innerHTML = `${cfg.l} <span class="cn">${cc[k]||0}</span>`;
        b.onclick = () => { ST.cats[k] = !ST.cats[k]; b.classList.toggle('on'); render(); saveSettings(); };
        cg.appendChild(b);
      });
      ce.appendChild(cg);
    });
  }

  const ae = document.getElementById('acq-chips');
  if (ae) {
    ae.innerHTML = '';
    for (const [k, cfg] of Object.entries(ACQ)) {
      if (!ac[k]) continue;
      const b = document.createElement('button');
      b.className = 'chip' + (ST.acqs[k] ? ' on' : '');
      b.style.setProperty('--cc', cfg.c);
      b.innerHTML = `${cfg.l} <span class="cn">${ac[k]}</span>`;
      b.onclick = () => { ST.acqs[k] = !ST.acqs[k]; b.classList.toggle('on'); render(); saveSettings(); };
      ae.appendChild(b);
    }
  }
}

/* ── RENDER: UPDATE DROPDOWN ────────────────── */
function buildUpdateSel() {
  const sel = document.getElementById('upd-sel');
  if (!sel) return;
  const versions = [...new Set(ST.items.map(i => i.majorUpdate).filter(v => v && v !== '0' && v !== 'Unknown'))]
    .sort((a, b) => parseInt(b) - parseInt(a));
  sel.innerHTML = '<option value="">All updates</option>';
  versions.forEach(v => {
    const o = document.createElement('option');
    o.value = v;
    const title = ST.updateNames[v];
    o.textContent = title ? `${v} — ${title}` : `Update ${v}`;
    sel.appendChild(o);
  });
}

/* ── RENDER: MASTERY BAR ────────────────────── */
function calcStarChartMxp(missions) {
  if (!missions?.length) return 0;
  let total = 0;
  missions.forEach(m => {
    // Railjack nodes give NO mastery (confirmed wiki)
    if (m.tag.startsWith('CrewBattle')) return;
    const isJunction = m.tag.endsWith('Junction');
    // Use missionDb masteryExp; junctions fall back to 1000 if not in DB
    const mxp = m.masteryExp ?? ST.missionDb?.[m.tag]?.masteryExp ?? (isJunction ? 1000 : 0);
    if (mxp <= 0) return;
    total += mxp;                  // base completion always gives mastery
    if (m.tier >= 1) total += mxp; // SP gives same amount again (wiki confirmed)
  });
  return total;
}


function renderMbar() {
  const mbar = document.getElementById('mbar');
  if (!mbar) return;
  const wasOpen = false; // always start collapsed
  // Keep the static toggle button, just refresh the calc panel
  let calc = mbar.querySelector('.mbar-calc');
  let togBtn = mbar.querySelector('.mbar-calc-toggle');
  if (!togBtn) {
    togBtn = document.createElement('button');
    togBtn.className = 'mbar-calc-toggle';
    togBtn.onclick = () => toggleCalc(togBtn);
    mbar.appendChild(togBtn);
  }
  togBtn.innerHTML = `MR Calculator <span>${wasOpen ? '▴' : '▾'}</span>`;
  if (!calc) {
    calc = document.createElement('div');
    calc.className = 'mbar-calc' + (wasOpen ? ' open' : '');
    mbar.appendChild(calc);
  }
  const totalM = ST.items.reduce((s,i) => s+(i.mastery||0), 0);
  const scMxp  = calcStarChartMxp(ST.missions);
  renderCalcPanel(calc, calcTotalMastery());
}


function renderCalcPanel(el, currentMxp) {
  // Derive MR from actual mastery math, not profile level
  const playerMR  = rankFromMastery(currentMxp);
  const nextMR    = playerMR + 1;
  const th0       = mrThreshold(playerMR);
  const threshold = mrThreshold(nextMR);
  const progress  = currentMxp - th0;
  const range     = threshold - th0;
  const gap       = Math.max(0, threshold - currentMxp);
  const pct       = range > 0 ? Math.min(100, (progress / range) * 100) : 100;
  const wepsNeeded = gap > 0 ? Math.ceil(gap / 3000) : 0;
  const frmsNeeded = gap > 0 ? Math.ceil(gap / 6000) : 0;

  // Intrinsics & Plexus — must be declared before template literal
  const rjInt      = ST.userData.meta?.rjInt      || 0;
  const drInt      = ST.userData.meta?.drInt      || 0;
  const plexusDone = ST.userData.meta?.plexusDone || false;
  const manualMxp  = rjInt * 1500 + drInt * 1500 + (plexusDone ? 6000 : 0);

  // Potential from all unleveled items
  const potential = ST.items.reduce((s,i) =>
    s + (i.maxRank - i.rank) * masteryMult(i.cat), 0);
  const ceilMR = rankFromMastery(currentMxp + potential);

  // List projection
  let listHtml = '';
  if (ST.activeList) {
    const list = listById(ST.activeList);
    const listGain = ST.items.filter(it => ST.userData.entities[it.path]?.lists?.includes(ST.activeList))
      .reduce((s,i) => s + (i.maxRank - i.rank) * masteryMult(i.cat), 0);
    const listNewMR = rankFromMastery(currentMxp + listGain);
    const mrGain    = listNewMR - playerMR;
    listHtml = `
      <div class="calc-row" style="background:rgba(74,173,158,.06);border-radius:5px;padding:.35rem .5rem;border:1px solid rgba(74,173,158,.15)">
        <div class="calc-stat">
          <div class="calc-lbl">Max all in "${list?.name || 'list'}"</div>
          <div class="calc-val accent">+${fmtM(listGain)} → MR ${listNewMR}${mrGain > 0 ? ` <span style="color:#b89030">(+${mrGain} rank${mrGain!==1?'s':''})</span>` : ' <span style="color:var(--tx3)">(no change)</span>'}</div>
        </div>
      </div>`;
  }

  el.innerHTML = `
    <div class="calc-row">
      <div class="calc-stat"><div class="calc-lbl">Progress to MR ${nextMR}</div><div class="calc-val accent">${fmtM(currentMxp)} / ${fmtM(threshold)}</div></div>
      <div style="flex:1;display:flex;flex-direction:column;gap:2px;min-width:100px">
        <div style="display:flex;align-items:center;gap:6px">
          <div class="calc-bar-wrap" style="flex:1">
            <div class="calc-bar-fill" id="cbar-cur" style="width:${pct}%"></div>
            <div class="calc-bar-proj" id="cbar-proj" style="left:${pct}%;width:0%"></div>
          </div>
          <span class="calc-bar-rankup" id="cbar-rank-lbl">MR ${playerMR}→${nextMR}</span>
        </div>
        <div class="calc-bar-overflow" id="cbar-overflow">
          <div style="display:flex;align-items:center;gap:6px">
            <div class="calc-bar-wrap" style="flex:1">
              <div class="calc-bar-proj" id="cbar-over" style="left:0%;width:0%"></div>
            </div>
            <span class="calc-bar-rankup" id="cbar-over-lbl">MR ${nextMR}→${nextMR+1}</span>
          </div>
        </div>
      </div>
      <div class="calc-stat" style="align-items:flex-end"><div class="calc-lbl">Gap</div><div class="calc-val" id="cbar-gap">+${fmtM(gap)}</div></div>
    </div>
    ${gap > 0 ? `<div class="calc-row" style="font-size:.68rem;color:var(--tx3)">
      To reach MR ${nextMR}: <span style="color:var(--tx)">~${wepsNeeded} weapons</span> or <span style="color:var(--tx)">~${frmsNeeded} frames</span> at max rank
    </div>` : `<div style="font-size:.68rem;color:var(--acc)">Ready to rank up!</div>`}
    ${listHtml}
    <div class="calc-row">
      <div class="calc-stat"><div class="calc-lbl">Mastery ceiling</div><div class="calc-val">+${fmtM(potential)} available → MR ${ceilMR} max</div></div>
    </div>
    <div class="calc-row" style="padding-top:.5rem;border-top:1px solid var(--bd);margin-top:.3rem;flex-wrap:wrap;gap:.5rem">
      <div class="calc-stat"><div class="calc-lbl">Intrinsics &amp; Plexus</div><div class="calc-val accent" style="font-size:.7rem">+${fmtM(manualMxp)}</div></div>
      <div style="display:flex;gap:.7rem;align-items:center;flex-wrap:wrap;margin-left:auto">
        <div class="calc-input-grp"><span title="Railjack Intrinsics (max 50)">RJ Int.</span>
          <input type="number" min="0" max="50" value="${rjInt}" onchange="updateManualMxp('rjInt',this.value)" style="width:44px"></div>
        <div class="calc-input-grp"><span title="Drifter Intrinsics (max 40)">Dr Int.</span>
          <input type="number" min="0" max="40" value="${drInt}" onchange="updateManualMxp('drInt',this.value)" style="width:44px"></div>
        <label class="ctog" title="Plexus — 6,000 MXP">
          <input type="checkbox" onchange="updateManualMxp('plexusDone',this.checked)" ${plexusDone?'checked':''}> Plexus</label>
      </div>
    </div>
    <div class="calc-inputs">
      <div class="calc-input-grp">
        <input type="number" id="wi-weapons" min="0" value="0" oninput="updateWhatIf()"> weapons
      </div>
      <div class="calc-input-grp">
        <input type="number" id="wi-frames" min="0" value="0" oninput="updateWhatIf()"> frames
      </div>
      <div class="calc-result" id="wi-result">Enter items to see projection</div>
    </div>`;

  // Seed bars with list projection if a list is active
  if (ST.activeList) {
    const listGain = ST.items
      .filter(it => ST.userData.entities[it.path]?.lists?.includes(ST.activeList))
      .reduce((s,i) => {
        return s + (i.maxRank - i.rank) * masteryMult(i.cat);
      }, 0);
    // Use setTimeout to let the DOM settle first
    setTimeout(() => updateCalcBars(listGain), 0);
  }
}

function toggleCalc(btn) {
  const calc = document.querySelector('.mbar-calc');
  if (!calc) return;
  const open = calc.classList.toggle('open');
  localStorage.setItem('wft3_calc_open', open ? '1' : '0');
  if (btn) btn.textContent = open ? 'Calculator ▴' : 'Calculator ▾';
}

function updateCalcBars(projMxp) {
  const current  = calcTotalMastery();
  const playerMR = rankFromMastery(current);
  const nextMR   = playerMR + 1;
  const th0 = mrThreshold(playerMR);
  const th1 = mrThreshold(nextMR);
  // Read fill bar's actual rendered width to guarantee zero gap between fill and projection
  const currentPct = parseFloat(document.getElementById('cbar-cur')?.style.width) || 0;
  const th2 = mrThreshold(nextMR + 1);

  const remaining  = Math.max(0, th1 - Math.min(current, th1));

  // Capped projection on first bar
  const projOnBar1 = Math.min(projMxp, remaining);
  const currentRange = Math.max(1, th1 - th0);
  const projPct1   = Math.min(100, (projOnBar1 / currentRange) * 100);

  // Overflow into next rank
  const overflow    = Math.max(0, projMxp - remaining);
  const overflowPct = th2 > th1 ? Math.min(100, (overflow / (th2 - th1)) * 100) : 0;

  const barP  = document.getElementById('cbar-proj');
  const barO  = document.getElementById('cbar-over');
  const ovDiv = document.getElementById('cbar-overflow');
  const gapEl = document.getElementById('cbar-gap');
  const rankLbl = document.getElementById('cbar-rank-lbl');
  const overLbl = document.getElementById('cbar-over-lbl');

  if (barP)  { barP.style.left = currentPct + '%'; barP.style.width = projPct1 + '%'; }
  if (ovDiv) ovDiv.classList.toggle('show', overflow > 0);
  if (barO)  barO.style.width = overflowPct + '%';
  if (gapEl) {
    const remaining2 = Math.max(0, th1 - current - projMxp);
    gapEl.textContent = remaining2 > 0 ? `+${fmtM(remaining2)} left` : '✓ Rank up!';
    gapEl.style.color = remaining2 <= 0 ? 'var(--acc)' : '';
  }
  if (rankLbl) rankLbl.textContent = `MR ${playerMR}→${nextMR}`;
  if (overLbl) overLbl.textContent = `MR ${nextMR}→${nextMR+1} (+${fmtM(overflow)})`;
}

function updateWhatIf() {
  const w = parseInt(document.getElementById('wi-weapons')?.value) || 0;
  const f = parseInt(document.getElementById('wi-frames')?.value)  || 0;
  const extra = w * 3000 + f * 6000;

  // If user hasn't entered anything, show list projection on bar instead
  const listGain = (() => {
    if (!ST.activeList) return 0;
    return ST.items.filter(it => ST.userData.entities[it.path]?.lists?.includes(ST.activeList))
      .reduce((s,i) => {
        return s + (i.maxRank - i.rank) * masteryMult(i.cat);
      }, 0);
  })();

  updateCalcBars(extra > 0 ? extra : listGain);

  const res = document.getElementById('wi-result');
  if (res) {
    if (extra === 0) { res.textContent = 'Enter items to see projection'; return; }
    const newTotal = calcTotalMastery() + extra;
    const newRank  = rankFromMastery(newTotal);
    const mr = ST.userData.meta.playerLevel || 0;
    res.textContent = `+${fmtM(extra)} → MR ${newRank}${newRank > mr ? ` (+${newRank - mr} rank${newRank-mr!==1?'s':''})` : ' (no change)'}`;
  }
}

/* ── RENDER: CARD ────────────────────────────── */
const fmtXP = x => x>=1e6?(x/1e6).toFixed(2)+'M':x>=1e3?Math.round(x/1e3)+'K':''+x;
const fmtM  = x => x>=1e6?(x/1e6).toFixed(1)+'M':x>=1e3?Math.round(x/1e3)+'K':''+x;

function makeCard(it, catMax) {
  const cfg   = CAT[it.cat] || CAT.other;
  const acfg  = ACQ[it.acq] || ACQ.standard;
  const maxed = it.rank >= it.maxRank && it.maxRank > 0;
  const starred = isEntityStarred(it.path);
  const pct = it.maxRank > 0 ? Math.round((it.rank / it.maxRank) * 100) : 0;

  const rankDisplay = it.maxRank === 40
    ? `<input class="rank-input" type="number" value="${it.rank}" min="0" max="40" title="Set actual rank (XP cannot determine this for Forma'd weapons)">`
    : `<span class="rank-cur">${it.rank}</span>`;

  const d = document.createElement('div');
  d.className = 'card' + (it.isOwned ? '' : ' unowned') + (it.requiresGilding && !it.isGilded ? ' needs-gilding' : '');
  d.style.setProperty('--cc', cfg.c);

  const entity  = ST.userData.entities[it.path] || {};
  const status  = entity.status || null;

  d.innerHTML = `
    <button class="sbtn${starred?' on':''}">★</button>
    <div class="ctop">
      <span class="cbadge" style="color:${cfg.c};border-color:${cfg.c}40;background:${cfg.c}14">${cfg.l}</span>
      <span class="cname">${it.name}</span>
    </div>
    <div class="ccore">
      <span class="rank-info">${rankDisplay}<span class="rank-max">/${it.maxRank}</span></span>
      ${status === 'priority' ? '<span class="status-prio on">▲ Priority</span>' : ''}
      ${status === 'building' ? '<span class="status-build on">⚙ Building</span>' : ''}
      ${it.update && it.update !== 'Unknown' ? `<span class="utag" title="${ST.updateNames[it.majorUpdate] ? ST.updateNames[it.majorUpdate] + ' · ' + it.update : 'Update ' + it.update}">${it.update}</span>` : ''}
    </div>
    <div class="card-extra">
      <div class="cmeta">
        <span class="abadge" style="color:${acfg.c};border-color:${acfg.c}40;background:${acfg.c}10">${acfg.l}</span>
        ${it.requiresGilding ? `<label class="gild-tog" title="Must be gilded to grant mastery"><input type="checkbox" ${it.isGilded?"checked":""}> Gilded</label>` : ""}
        ${maxed && it.isGilded !== false ? `<span class="maxed-tag" style="color:#a08020;font-size:.7rem;font-family:'Rajdhani',sans-serif;font-weight:700;">MAXED</span>` : ""}
      </div>
      <div class="xbw"><div class="xbf" style="width:${pct}%;background:${cfg.c}"></div></div>
      <div class="cbot">
        ${it.mastery>0 ? `<span class="mval">+${fmtM(it.mastery)}</span>` : ''}
        <span class="xval" style="color:var(--acc)">${fmtXP(it.xp)}</span>
      </div>
      <textarea class="card-note" placeholder="Add a note…" rows="2"></textarea>
    </div>`;

  d.dataset.path = it.path;
  d.addEventListener('mouseenter', () => { ST._hoveredItem = it; });
  d.addEventListener('click', e => handleCardClick(e, it));

  // Attach listeners post-render (avoids HTML injection issues with note content)
  const starBtn = d.querySelector('.sbtn');
  starBtn.addEventListener('click', e => { e.stopPropagation(); toggleEntityStar(it.path, it.cat, starBtn); });

  const rankInput = d.querySelector('.rank-input');
  if (rankInput) {
    rankInput.addEventListener('change', () => saveOverride(it.path, rankInput.value));
    rankInput.addEventListener('click', e => e.stopPropagation());
  }

  const noteEl = d.querySelector('.card-note');
  noteEl.value = ST.userData.entities[it.path]?.note || '';
  noteEl.addEventListener('blur', () => saveEntityNote(it.path, it.cat, noteEl.value));
  noteEl.addEventListener('click', e => e.stopPropagation());
  noteEl.addEventListener('keydown', e => e.stopPropagation());

  // Gilded toggle for amps, zaws, kitguns, MOAs, predasites, vulpaphylas
  const gildEl = d.querySelector('.gild-tog input');
  if (gildEl) {
    gildEl.addEventListener('change', e => {
      e.stopPropagation();
      const e2 = getOrCreateEntity(it.path, it.cat);
      e2.gilded = gildEl.checked;
      it.isGilded = gildEl.checked;
      it.mastery  = gildEl.checked ? it.rank * masteryMult(it.cat) : 0;
      d.classList.toggle('needs-gilding', !gildEl.checked);
      saveUserData();
      render(); // refresh mastery totals
    });
    gildEl.addEventListener('click', e => e.stopPropagation());
  }

  return d;
}

/* ── RENDER: MAIN ────────────────────────────── */
function render() {
  const items = filteredItems();
  items.sort((a,b) => {
    if (ST.sort==='mastery-desc') return b.mastery-a.mastery;
    if (ST.sort==='xp-desc')     return b.xp-a.xp;
    if (ST.sort==='xp-asc')      return a.xp-b.xp;
    if (ST.sort==='name-asc')    return a.name.localeCompare(b.name);
    if (ST.sort==='rank-asc')    return a.rank-b.rank;
    if (ST.sort==='cat')         return a.cat.localeCompare(b.cat);
    return 0;
  });

  ST._visibleItems = items; // used by shift-click range and Ctrl+A

  const wrap = document.getElementById('items-wrap');
  if (!wrap) return;

  const totalMxp = ST.items.reduce((s,i)=>s+(i.mastery||0),0);
  const scMxp    = calcStarChartMxp(ST.missions);
  document.getElementById('s-mxp').textContent    = fmtM(totalMxp);
  document.getElementById('s-maxed').textContent  = ST.items.filter(i=>i.rank>=i.maxRank&&i.maxRank>0).length;
  document.getElementById('s-vis').textContent    = items.length;
  const scEl = document.getElementById('s-sc-mxp');
  if (scEl) scEl.textContent = scMxp > 0 ? fmtM(scMxp) : '—';

  // Update category tooltip in header
  const tipEl = document.getElementById('hstat-cat-tip');
  if (tipEl) {
    const bycat = {};
    for (const it of ST.items) { if (!bycat[it.cat]) bycat[it.cat]=0; bycat[it.cat]+=(it.mastery||0); }
    const rows = Object.entries(bycat).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1])
      .map(([k,v]) => `<div class="hstat-tip-row"><span class="hstat-tip-cat" style="color:${CAT[k]?.c||'var(--tx2)'}">${CAT[k]?.l||k}</span><span class="hstat-tip-val">${fmtM(v)}</span></div>`)
      .join('');
    tipEl.innerHTML = '<div class="hstat-tip-lbl">By category</div>' + rows;
  }

  const catMax = {};
  for (const it of ST.items) if (!catMax[it.cat]||it.xp>catMax[it.cat]) catMax[it.cat]=it.xp;

  const frag = document.createDocumentFragment();
  const grp  = ST.group;

  if (!grp) {
    const sec = document.createElement('div'); sec.className='isect';
    const g   = document.createElement('div'); g.className='igrid';
    if (!items.length) g.innerHTML='<div class="empty">No items match current filters</div>';
    else items.forEach(it=>g.appendChild(makeCard(it,catMax)));
    sec.appendChild(g); frag.appendChild(sec);
  } else {
    if (grp === 'cat') {
      // Horizontal kanban — one column per active category, in logical order
      const colWrap = document.createElement('div');
      colWrap.className = 'col-wrap';
      const catOrder = CAT_GROUPS.flatMap(g => g.keys);
      let colCount = 0;
      for (const catKey of catOrder) {
        const catItems = items.filter(i => i.cat === catKey);
        if (!catItems.length) continue;
        const cfg = CAT[catKey]; if (!cfg) continue;
        colCount++;
        const catMaxed = catItems.filter(i => i.rank >= i.maxRank && i.maxRank > 0).length;
        const col = document.createElement('div');
        col.className = 'cat-col'; col.style.setProperty('--cc', cfg.c);
        const tm = catItems.reduce((s,i)=>s+(i.mastery||0),0);
        const hdr = document.createElement('div'); hdr.className='cat-col-hdr';
        hdr.innerHTML=`<span class="col-cat-name">${cfg.l}</span><div class="col-cat-meta"><span class="col-cat-mxp">${fmtM(tm)}</span><span class="col-cat-cnt" title="Maxed / total items">${catMaxed}/${catItems.length}</span></div>`;
        col.appendChild(hdr);
        catItems.forEach(it=>col.appendChild(makeCard(it,catMax)));
        colWrap.appendChild(col);
      }
      if (!colCount) colWrap.innerHTML='<div style="padding:4rem 2rem;color:var(--tx3);font-size:.86rem">No items match current filters</div>';
      frag.appendChild(colWrap);
    } else {
      const map = new Map();
      for (const it of items) {
        const key = grp==='update' ? `Update ${it.majorUpdate}`
                  : grp==='acq'   ? (ACQ[it.acq]?.l||it.acq)
                  : 'All';
        if (!map.has(key)) map.set(key,[]);
        map.get(key).push(it);
      }
      let entries = [...map.entries()];
      if (grp==='update') entries.sort((a,b)=>{
        const av = parseInt(a[0].replace('Update ',''))||0;
        const bv = parseInt(b[0].replace('Update ',''))||0;
        return bv-av;
      });
      for (const [key,gitems] of entries) {
        const tm = gitems.reduce((s,i)=>s+(i.mastery||0),0);
        const h = document.createElement('div'); h.className='ghdr';
        const vNum = grp==='update' ? key.replace('Update ','') : null;
        const uTitle = vNum && ST.updateNames[vNum] ? ST.updateNames[vNum] : null;
        h.innerHTML=`<span class="gtitle">${uTitle||key}</span>${uTitle?`<span class="gdate">Update ${vNum}</span>`:''}<span class="gm">+${fmtM(tm)}</span><span class="gcnt">${gitems.length} items</span>`;
        frag.appendChild(h);
        const sec = document.createElement('div'); sec.className='isect';
        const g   = document.createElement('div'); g.className='igrid';
        gitems.forEach(it=>g.appendChild(makeCard(it,catMax)));
        sec.appendChild(g); frag.appendChild(sec);
      }
    }
  }
  wrap.innerHTML=''; wrap.appendChild(frag);

  if (ST.tab === 'planner') renderPlanner();
}

/* ── HANDLERS ───────────────────────────────── */
let _st;
function onSearch(v) { clearTimeout(_st); _st=setTimeout(()=>{ ST.search=v; document.getElementById('cx').style.display=v?'block':'none'; render(); },150); }
function clearSearch() { ST.search=''; document.getElementById('search-input').value=''; document.getElementById('cx').style.display='none'; render(); }
function onSort(v)   { ST.sort=v; render(); saveSettings(); }
function onGroup(v)  { ST.group=v; render(); saveSettings(); }
function onUpdateFilter() { render(); }
function toggleField(field, el) {
  const isOn = el.classList.toggle('off');
  document.body.classList.toggle(`hide-${field}`, isOn);
}

function toggleStar(path, btn) { toggleEntityStar(path, 'item', btn); if (ST.starred.has(path)) toast('★ Added to watchlist'); }

/* ── SELECTION ───────────────────────────────── */
function handleCardClick(e, it) {
  if (e.shiftKey) window.getSelection()?.removeAllRanges();
  if (e.target.closest('button,input,textarea,select')) return;
  const idx = ST._visibleItems.findIndex(i => i.path === it.path);
  if (e.shiftKey && ST._lastSelIdx !== null && idx !== -1) {
    const lo = Math.min(ST._lastSelIdx, idx);
    const hi = Math.max(ST._lastSelIdx, idx);
    ST._visibleItems.slice(lo, hi + 1).forEach(i => ST.selection.add(i.path));
  } else if (e.ctrlKey || e.metaKey) {
    if (ST.selection.has(it.path)) ST.selection.delete(it.path);
    else ST.selection.add(it.path);
    ST._lastSelIdx = idx;
  } else {
    ST.selection.clear();
    ST.selection.add(it.path);
    ST._lastSelIdx = idx;
  }
  updateSelectionDisplay();
}

function updateSelectionDisplay() {
  const count = ST.selection.size;
  const bar = document.getElementById('action-bar');
  if (bar) bar.classList.toggle('visible', count > 0);
  const cnt = document.getElementById('ab-count');
  if (cnt) cnt.textContent = `${count} selected`;
  document.querySelectorAll('.card[data-path]').forEach(card => {
    card.classList.toggle('selected', ST.selection.has(card.dataset.path));
  });
}

function clearSelection() {
  ST.selection.clear(); ST._lastSelIdx = null;
  updateSelectionDisplay();
}

function selectAll() {
  ST._visibleItems.forEach(it => ST.selection.add(it.path));
  updateSelectionDisplay();
}

function starSelected() {
  if (!ST.selection.size) return;
  const allStarred = [...ST.selection].every(p => isEntityStarred(p));
  ST.selection.forEach(path => {
    const item = ST.items.find(i => i.path === path);
    const type = item?.cat || 'item';
    const currently = isEntityStarred(path);
    if (allStarred && currently) toggleEntityStar(path, type, null);
    else if (!allStarred && !currently) toggleEntityStar(path, type, null);
  });
  updateSelectionDisplay();
  toast(allStarred ? `☆ Unstarred ${ST.selection.size}` : `★ Starred ${ST.selection.size}`);
}

function unstarSelected() {
  ST.selection.forEach(path => {
    const item = ST.items.find(i => i.path === path);
    if (isEntityStarred(path)) toggleEntityStar(path, item?.cat || 'item', null);
  });
  updateSelectionDisplay();
  toast(`☆ Unstarred ${ST.selection.size}`);
}

function copySelectedNames() {
  const names = [...ST.selection]
    .map(path => ST.items.find(i => i.path === path)?.name)
    .filter(Boolean);
  if (!names.length) return;
  navigator.clipboard.writeText(names.join('\n')).then(() => toast(`Copied ${names.length} names ✓`));
}

function switchTab(t) {
  clearSelection();
  ST.tab = t;
  document.getElementById('view-items').style.display = t==='items'?'block':'none';
  document.getElementById('view-sc').style.display    = t==='sc'?'block':'none';
  document.getElementById('view-planner').style.display = t==='planner'?'block':'none';
  document.getElementById('fnote').style.display      = t==='items'?'flex':'none';
  document.getElementById('tab-items').className = 'tab'+(t==='items'?' active':'');
  document.getElementById('tab-sc').className    = 'tab'+(t==='sc'?' active':'');
  document.getElementById('tab-planner').className = 'tab'+(t==='planner'?' active':'');
  if (t==='sc') {
    renderStarChart(); // show loading state immediately
    loadStarChartData().then(() => renderStarChart());
  }
  if (t==='planner') renderPlanner();
}

function toast(msg,dur=2200) {
  const el=document.getElementById('toast');
  if(!el) return;
  el.textContent=msg; el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'),dur);
}

/* ── PERSISTENCE ────────────────────────────── */
function saveSettings() {
  ST.userData.settings = { cats:ST.cats, acqs:ST.acqs, sort:ST.sort, group:ST.group, plannerSort:ST.plannerSort, plannerLayout:ST.plannerLayout, plannerActiveList: ST.plannerActiveList };
  saveUserData();
}
function loadSettings() {
  // loadUserData handles this — this is a no-op kept for call-site compatibility
}

function setStatusSelected(status) {
  if (!ST.selection.size) return;
  const allHave = [...ST.selection].every(path => ST.userData.entities[path]?.status === status);
  ST.selection.forEach(path => {
    const item = ST.items.find(i => i.path === path);
    const e = getOrCreateEntity(path, item?.cat || 'item');
    if (allHave) delete e.status; else e.status = status;
    pruneEntity(path);
  });
  saveUserData();
  render();
  toast(allHave ? `Cleared status` : `${status === 'priority' ? '▲' : '⚙'} ${status} set on ${ST.selection.size} items`);
}

function copyFilteredNames() {
  const items = filteredItems();
  if (!items.length) { toast('Nothing to copy! (Adjust filters)'); return; }
  navigator.clipboard.writeText(items.map(it=>it.name).join('\n')).then(()=>{
    toast(`Copied ${items.length} names ✓`);
  }).catch(()=>toast('Copy failed. Check browser permissions.'));
}

function exportData() {
  const out = { ...ST.userData, meta: { ...ST.userData.meta, exportedAt: new Date().toISOString() } };
  const blob = new Blob([JSON.stringify(out, null, 2)], {type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'wf-mastery-userdata.json'; a.click(); URL.revokeObjectURL(a.href);
  toast('Data exported ✓');
}

function importData(inp) {
  const f = inp.files?.[0]; if (!f) return;
  const r = new FileReader();
  r.onload = async ev => {
    try {
      const d = JSON.parse(ev.target.result);
      if (d.version === 3) {
        ST.userData = d;
        await userDbSet('userData', ST.userData);
        try { localStorage.setItem(LS_USER_KEY, JSON.stringify(ST.userData)); } catch(e) {}
        // Re-derive runtime mirrors
        ST.starred = new Set(Object.entries(ST.userData.entities).filter(([,e])=>e.starred&&e.type!=='node').map(([k])=>k));
        ST.overrides = Object.fromEntries(Object.entries(ST.userData.entities).filter(([,e])=>e.rank!==undefined).map(([k,e])=>[k,e.rank]));
        toast('Imported ✓ — reloading…');
        setTimeout(() => location.reload(), 800);
      } else {
        toast('Unrecognised file format');
      }
    } catch(e) { toast('Import failed'); }
  };
  r.readAsText(f); inp.value = '';
}

/* ── IMPORT FLOW ────────────────────────────── */
async function handleImport() {
  const text = document.getElementById('json-input').value.trim();
  const errEl = document.getElementById('import-err');
  if (errEl) errEl.style.display = 'none';
  if (!text) { showE('Paste your JSON first.'); return; }
  let profile;
  try { profile = parseProfile(text); }
  catch(e) { showE(e instanceof SyntaxError ? 'Invalid JSON — try "Load from file" instead.' : 'Parse error: ' + e.message); return; }
  if (!profile.xpData.length) { showE('No XP data found in this JSON.'); return; }
  // Extract and persist player ID from the raw JSON if present
  try {
    const raw = JSON.parse(text);
    const r = raw.Results?.[0] || raw;
    const id = r.PlayerId || r.playerId || r.AccountId || r.accountId || '';
    if (id) savePlayerId(id);
    // Also try to find ID in the URL query if injected somehow (fallback to manual input)
    const manualId = document.getElementById('player-id-input')?.value.trim();
    if (!id && manualId) savePlayerId(manualId);
  } catch(e) {}
  localStorage.setItem('wft3_profile', text);
  await loadAndShow(profile);
  function showE(m) { if (errEl) { errEl.textContent=m; errEl.className='err-box'; errEl.style.display='block'; } }
}

async function loadAndShow(profile) {
  document.getElementById('import-screen').style.display='none';
  document.getElementById('loading-screen').style.display='flex';
  ST.activeList = null;
  ST.search = '';
  setProgress(15,'Downloading item database…');
  const [itemDb, updateNames] = await Promise.all([fetchItemDb(), fetchUpdateNames()]);
  ST.updateNames = updateNames;
  setProgress(80,'Syncing your progress…');
  ST.items    = enrichAll(profile.xpData, itemDb);
  ST.missions = profile.missions;
  ST.userData.meta.playerName  = profile.playerName;
  ST.userData.meta.playerLevel = profile.playerLevel;
  ST.userData.meta.lastSynced  = Date.now();
  document.getElementById('loading-screen').style.display='none';
  document.getElementById('app').style.display='flex';
  document.getElementById('player-info').textContent=`${profile.playerName} · MR ${profile.playerLevel}`;
  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = '';
  buildChips();
  buildUpdateSel();
  buildListBar();
  renderMbar();
  render();
  void fetchMissionDb().then(() => {
    if (document.getElementById('app')?.style.display === 'flex') renderMbar();
  });
  // Show refresh button if player ID is stored
  const pid = getPlayerId();
  const rbtn = document.getElementById('hbtn-refresh');
  if (rbtn) rbtn.style.display = pid ? 'block' : 'none';
  rebuildPlannerFilterOptions();
  const plannerSortSel = document.getElementById('planner-sort');
  if (plannerSortSel) plannerSortSel.value = ST.plannerSort;
  const plannerLayoutSel = document.getElementById('planner-layout');
  if (plannerLayoutSel) plannerLayoutSel.value = ST.plannerLayout;
  const plannerListSel = document.getElementById('planner-list');
  if (plannerListSel) plannerListSel.value = ST.plannerActiveList || 'none';
  saveUserData();
  toast(`Sync complete: ${ST.items.length} items tracked.`);
}

function initImportScreen() {
  const id = getPlayerId();
  const idEntry = document.getElementById('id-entry');
  const refreshPanel = document.getElementById('refresh-panel');
  if (id) {
    // Known ID — show refresh panel
    if (idEntry) idEntry.style.display = 'none';
    if (refreshPanel) {
      refreshPanel.classList.add('visible');
      const disp = document.getElementById('rp-id-display');
      const url  = document.getElementById('rp-url-display');
      if (disp) disp.textContent = id;
      if (url)  url.textContent  = profileUrl(id);
    }
  } else {
    // No ID — show entry fields
    if (idEntry) idEntry.style.display = 'block';
    if (refreshPanel) refreshPanel.classList.remove('visible');
  }
}

function resetApp() {
  document.getElementById('app').style.display='none';
  document.getElementById('import-screen').style.display='flex';
  document.getElementById('json-input').value='';
  ST.items=[]; ST.missions=[];
  ST.activeList = null;
  ST.search = '';
  initImportScreen();
}

/* ── AUDIT ──────────────────────────────────── */
async function auditDatabase() {
  const db = await dbGet('cache','item_db');
  if (!db) return console.error('Database not found. Refresh first.');
  const currentDb = db.v || db;
  const counts = {};
  const TARGETS = {
    'Warframes':115,'Primary':192,'Secondary':146,'Melee':221,'Zaws':11,'Kitguns':6,
    'Amps':10,'MOAs':4,'Hounds':3,'Sentinels':17,'Sentinel Weapons':24,'Archwing':5,
    'Arch-Gun':20,'Arch-Melee':8,'Necramechs':2,'Kubrow':6,'Kavat':5,'Vulpaphyla':3,
    'Predasite':3,'K-Drive':5
  };
  Object.values(currentDb).forEach(item => { const cat=item.apiCat; counts[cat]=(counts[cat]||0)+1; });
  console.log('%c--- MASTERY AUDIT REPORT ---','font-weight:bold;font-size:14px;color:#4aad9e;');
  Object.entries(TARGETS).forEach(([cat,target])=>{
    const current=counts[cat]||0, diff=current-target;
    let status='%c[OK]', color='color:#4CAF50';
    if (diff>0) { status=`%c[TOO HIGH: +${diff}]`; color='color:#FF9800'; }
    else if (diff<0) { status=`%c[MISSING: ${diff}]`; color='color:#F44336'; }
    console.log(`%s | %c${cat.padEnd(18)} %c| Current: ${current} / Target: ${target}`,color,status,'color:inherit','color:#888');
    if (diff!==0) {
      const items=Object.values(currentDb).filter(i=>i.apiCat===cat).map(i=>i.name).join(', ');
      console.log(`   %cItems found: %c${items||'None'}`,'color:#aaa;font-style:italic','color:#777;font-style:italic');
    }
  });
  Object.keys(counts).forEach(cat=>{
    if (!TARGETS[cat]) console.log(`%c[UNKNOWN CATEGORY: ${cat}] | Items: ${counts[cat]}`,'color:#E91E63;font-weight:bold;');
  });
}

/* ── INIT ───────────────────────────────────── */
document.addEventListener('keydown', e => {
  if (e.target.matches('input,textarea,select')) return;
  if (document.getElementById('app')?.style.display === 'none') return;
  if (e.key === 'Escape' || e.key === 'Delete') { clearSelection(); return; }
  if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); selectAll(); return; }
  if (e.key === 's' || e.key === 'S') { if (ST.selection.size) { starSelected(); } return; }
  if (e.key === 'w' || e.key === 'W') {
    const target = ST.tab === 'planner'
      ? (ST.items.find(i => i.path === ST._plannerSelectedPath) || ST.items.find(i => i.path === ST._plannerHoveredPath) || ST._hoveredItem)
      : (ST.selection.size === 1
          ? ST.items.find(i => i.path === [...ST.selection][0])
          : ST._hoveredItem);
    if (target) openWikiPage(target.name);
    else toast('Hover or select an item to open its wiki page');
    return;
  }
  if (e.key === 'l' || e.key === 'L') {
    if (ST.userData.lists.length > 0) {
      const bar = document.getElementById('list-bar');
      if (bar) { bar.scrollIntoView({behavior:'smooth',block:'nearest'}); bar.style.outline='1px solid var(--acc)'; setTimeout(()=>bar.style.outline='',800); }
    } else { promptNewList(); }
    return;
  }
  if (e.key === 'b' || e.key === 'B') { if (ST.selection.size) setStatusSelected('building'); return; }
});

document.getElementById('file-in')?.addEventListener('change',e=>{
  const f=e.target.files?.[0]; if(!f) return;
  const r=new FileReader();
  r.onload=ev=>document.getElementById('json-input').value=ev.target.result;
  r.readAsText(f); e.target.value='';
});

window.addEventListener('load', () => {
  void (async function init() {
  await loadUserData();
  // XP Bar and Notes pills start as off — sync body classes
  // Standard tag hidden by default, Maxed shown by default
  document.body.classList.add('hide-xpbar', 'hide-notes', 'hide-source');
  initImportScreen();
  const gs = document.getElementById('grp-sel');
  if (gs) gs.value = ST.group || 'cat';
  const saved = localStorage.getItem('wft3_profile');
  if (saved) {
    try {
      const p = parseProfile(saved);
      if (p.xpData.length) { await loadAndShow(p); return; }
    } catch(e){ console.error(e); }
  }
  })();
});
