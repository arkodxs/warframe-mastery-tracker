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
  search:'', sort:'mastery-desc', group:'cat', update:'', primeFilter:'',
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

function extractPlayerIdFromRawProfile(raw) {
  const root = raw?.Results?.[0] || raw || {};

  function normalizeIdValue(v) {
    if (typeof v === 'string' || typeof v === 'number') {
      const s = String(v).trim();
      return s || '';
    }
    if (v && typeof v === 'object') {
      const oid = v.$oid || v.oid || v.id || v.Id || v.value;
      if (typeof oid === 'string' || typeof oid === 'number') {
        const s = String(oid).trim();
        if (s) return s;
      }
    }
    return '';
  }

  const direct = [
    root.PlayerId, root.playerId, root.PlayerID, root.playerID,
    root.AccountId, root.accountId, root.AccountID, root.accountID,
  ].map(normalizeIdValue).find(Boolean);
  if (direct) return direct;

  // Fallback: shallow recursive scan for common id-like keys.
  const seen = new Set();
  function scan(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 3 || seen.has(obj)) return '';
    seen.add(obj);
    for (const [k, v] of Object.entries(obj)) {
      const key = String(k || '').toLowerCase();
      if (key.includes('playerid') || key.includes('accountid')) {
        const norm = normalizeIdValue(v);
        if (norm) return norm;
      }
    }
    for (const v of Object.values(obj)) {
      const found = scan(v, depth + 1);
      if (found) return found;
    }
    return '';
  }
  return scan(root, 0);
}

function persistPlayerIdFromProfileText(text) {
  try {
    const raw = JSON.parse(text);
    const id = extractPlayerIdFromRawProfile(raw);
    if (id) savePlayerId(id);
    return id || '';
  } catch (_) {
    return '';
  }
}

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
// Open profile URL in a new tab and focus the paste box when the user returns
function openProfileUrlAndFocus() {
  const id = getPlayerId() || document.getElementById('player-id-input')?.value.trim();
  if (!id) { toast('Enter your player ID first'); return; }
  const url = profileUrl(id);
  if (!canOpenProfile()) return;
  recordProfileOpenAttempt();
  // Try opening a small popup window (user gesture allows this in most browsers)
  try {
    const features = 'width=900,height=700,menubar=no,toolbar=no,location=no,status=no';
    const popup = window.open(url, '_blank', features);
    if (popup) {
      window.__profilePopup = popup;
      try { popup.focus(); } catch(e){}
    } else {
      // fallback to regular tab
      window.open(url, '_blank');
    }
  } catch (e) { window.open(url, '_blank'); }
  // When window regains focus, focus the json input and show a hint
  function onFocus() {
    const ta = document.getElementById('json-input');
    if (ta) {
      ta.focus();
      try { ta.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch(e){}
    }
    toast('Paste the profile JSON into the import box');
    window.removeEventListener('focus', onFocus);
  }
  window.addEventListener('focus', onFocus);
}

// --- Profile open rate-limiting helpers ---
const PROFILE_RATE_LIMIT_MAX = 5; // attempts
const PROFILE_RATE_LIMIT_WINDOW = 10 * 60 * 1000; // 10 minutes
const PROFILE_RATE_LIMIT_COOLDOWN = 15 * 60 * 1000; // 15 minutes

function recordProfileOpenAttempt() {
  const now = Date.now();
  window.__profileOpenHistory = window.__profileOpenHistory || [];
  window.__profileOpenHistory.push(now);
  // prune
  window.__profileOpenHistory = window.__profileOpenHistory.filter(t => t > now - PROFILE_RATE_LIMIT_WINDOW);
  if (window.__profileOpenHistory.length > PROFILE_RATE_LIMIT_MAX) {
    window.__profileBlockedUntil = now + PROFILE_RATE_LIMIT_COOLDOWN;
  }
  updateProfileOpenButtonState();
}

function canOpenProfile() {
  const now = Date.now();
  if (window.__profileBlockedUntil && window.__profileBlockedUntil > now) {
    const rem = Math.ceil((window.__profileBlockedUntil - now) / 60000);
    showRefreshError(`Rate limit hit — try again in ${rem} min`);
    updateProfileOpenButtonState();
    return false;
  }
  return true;
}

function updateProfileOpenButtonState() {
  const blocked = window.__profileBlockedUntil && window.__profileBlockedUntil > Date.now();
  const modalBtn = document.getElementById('rm-open-btn');
  if (modalBtn) modalBtn.disabled = !!blocked;
  const headerBtn = document.getElementById('hbtn-refresh');
  if (headerBtn) headerBtn.disabled = !!blocked;
}

function showRefreshError(msg) {
  const el = document.getElementById('rm-err');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
  else toast(msg);
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
  // Open lightweight refresh modal instead of full import screen
  openRefreshModal();
}

function openRefreshModal() {
  const modal = document.getElementById('refresh-modal');
  if (!modal) return;
  const id = getPlayerId() || '';
  const disp = document.getElementById('rm-rp-id');
  if (disp) disp.textContent = id || '—';
  modal.style.display = 'flex';
  // Setup paste-detect for modal textarea
  const ta = document.getElementById('refresh-json-input');
  const detectBtn = document.getElementById('rm-detect-btn');
  const errEl = document.getElementById('rm-err'); if (errEl) errEl.style.display = 'none';
  if (ta) {
    ta.value = '';
    if (detectBtn) detectBtn.style.display = 'none';
    const onPaste = (e) => {
      try {
        const text = (e.clipboardData || window.clipboardData).getData('text');
        if (!text || text.trim().length === 0) return;
        let profile;
        try { profile = parseProfile(text); } catch(_) { profile = null; }
        if (profile && profile.xpData && profile.xpData.length) {
          ta.value = text;
          if (detectBtn) detectBtn.style.display = 'inline-block';
          if (errEl) { errEl.style.display='none'; }
          toast('Profile JSON detected — click Import to continue');
        }
      } catch (err) { }
    };
    ta.removeEventListener('paste', ta._onPaste || (()=>{}));
    ta._onPaste = onPaste;
    ta.addEventListener('paste', onPaste);
  }
  // focus textarea for convenience
  setTimeout(()=>{ try{ (document.getElementById('refresh-json-input')||{}).focus(); }catch(e){} },100);
  // Update open button state based on rate limits
  updateProfileOpenButtonState();
}

function closeRefreshModal() {
  const modal = document.getElementById('refresh-modal'); if (!modal) return; modal.style.display = 'none';
}

function openProfileFromModal() {
  const id = getPlayerId() || document.getElementById('player-id-input')?.value.trim();
  if (!id) { toast('Enter your player ID first'); return; }
  if (!canOpenProfile()) return;
  recordProfileOpenAttempt();
  const url = profileUrl(id);
  try {
    const features = 'width=900,height=700,menubar=no,toolbar=no,location=no,status=no';
    const popup = window.open(url, '_blank', features);
    if (popup) { window.__profilePopup = popup; try { popup.focus(); } catch(e) {} }
    else window.open(url, '_blank');
  } catch(e) { window.open(url, '_blank'); }
}

async function confirmRefreshImport(fromPasted=false) {
  const ta = document.getElementById('refresh-json-input');
  const errEl = document.getElementById('rm-err'); if (errEl) { errEl.style.display='none'; }
  const text = (ta?.value || '').trim();
  if (!text) { if (errEl) { errEl.textContent='Paste profile JSON first'; errEl.style.display='block'; } return; }
  const existingId = getPlayerId() || document.getElementById('player-id-input')?.value.trim() || '';
  if (existingId) savePlayerId(existingId);
  let profile;
  try { profile = parseProfile(text); } catch(e) { if (errEl) { errEl.textContent='Invalid profile JSON'; errEl.style.display='block'; } return; }
  if (!profile || !profile.xpData || profile.xpData.length===0) { if (errEl) { errEl.textContent='No XP data found in this JSON'; errEl.style.display='block'; } return; }
  // Persist player ID if present in profile payload (supports multiple key shapes)
  persistPlayerIdFromProfileText(text);
  try { localStorage.setItem('wft3_profile', text); } catch(e){}
  // Close popup if open
  try { if (window.__profilePopup && !window.__profilePopup.closed) window.__profilePopup.close(); } catch(e){}
  closeRefreshModal();
  await loadAndShow(profile);
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

async function dbDelete(store, key) {
  try {
    const db = await openCacheDB();
    return new Promise((ok, err) => {
      const tx = db.transaction('cache', 'readwrite');
      tx.objectStore('cache').delete(key);
      tx.oncomplete = ok;
      tx.onerror = () => err(tx.error);
    });
  } catch(e) {}
}

async function dbClearCache() {
  try {
    const db = await openCacheDB();
    return new Promise((ok, err) => {
      const tx = db.transaction('cache', 'readwrite');
      tx.objectStore('cache').clear();
      tx.oncomplete = ok;
      tx.onerror = () => err(tx.error);
    });
  } catch(e) {}
}

// Expose cache helpers for console use
window.dbGet = dbGet;
window.dbSet = dbSet;
window.dbDelete = dbDelete;
window.dbClearCache = dbClearCache;

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
  if (typeof s.search === 'string') ST.search = s.search;
  if (s.sort)  ST.sort  = s.sort;
  if (s.group) ST.group = s.group;
  if (typeof s.update === 'string') ST.update = s.update;
  if (typeof s.primeFilter === 'string') ST.primeFilter = s.primeFilter;
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

/* ── ITEM CLASSIFICATION (delegates to data layer) ─────────────────────── */
function classifyItem(item) {
  if (window.__wfData?.classifyItem) return window.__wfData.classifyItem(item);
  // Fallback only before data layer initializes
  return { isJunk:true };
}

/* ── API FETCH ──────────────────────────────── */
async function fetchItemDb() {
  if (window.__wfData?.fetchItemDb) return window.__wfData.fetchItemDb();
  return {};
}

/* ── UPDATE NAMES ───────────────────────────── */
async function fetchUpdateNames() {
  if (window.__wfData?.fetchUpdateNames) return window.__wfData.fetchUpdateNames();
  return {};
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
  const playerId = extractPlayerIdFromRawProfile(data);
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
    playerId,
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
  if (window.__wfStarChart?.renderStarChart && window.__wfStarChart.renderStarChart !== renderStarChart) {
    return window.__wfStarChart.renderStarChart();
  }
  console.warn('Star chart module not loaded; renderStarChart is unavailable.');
}

function closePlanetDetail() {
  if (window.__wfStarChart?.closePlanetDetail && window.__wfStarChart.closePlanetDetail !== closePlanetDetail) {
    return window.__wfStarChart.closePlanetDetail();
  }
  const detailPanel = document.getElementById('sc-planet-detail');
  if (detailPanel) { detailPanel.classList.remove('open'); detailPanel.innerHTML = ''; }
  document.querySelectorAll('.sc-planet-tile.selected').forEach(t => t.classList.remove('selected'));
}

function setSCCols(n) {
  if (window.__wfStarChart?.setSCCols && window.__wfStarChart.setSCCols !== setSCCols) {
    return window.__wfStarChart.setSCCols(n);
  }
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
  if (window.__wfPlanner?.plannerRows && window.__wfPlanner.plannerRows !== plannerRows) {
    return window.__wfPlanner.plannerRows();
  }
  console.warn('Planner module not loaded; plannerRows is unavailable.');
  return [];
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
  if (window.__wfPlanner?.renderPlanner && window.__wfPlanner.renderPlanner !== renderPlanner) {
    return window.__wfPlanner.renderPlanner();
  }
  const wrap = document.getElementById('planner-wrap');
  if (wrap) {
    wrap.innerHTML = '<div class="planner-empty">Planner module not loaded.</div>';
  }
  console.warn('Planner module not loaded; renderPlanner is unavailable.');
}


/* ── FILTERING ──────────────────────────────── */
function filteredItems() {
  const needsReview  = document.getElementById('tog-review')?.checked;
  const showFounders = document.getElementById('tog-founders')?.checked;
  const unmaxed      = document.getElementById('tog-unmaxed')?.checked;
  const onlyStar     = document.getElementById('tog-starred')?.checked;
  const unowned      = document.getElementById('tog-unowned')?.checked;
  const needsForma   = document.getElementById('tog-forma')?.checked;
  const upd          = ST.update || '';
  const primeFilter  = ST.primeFilter || '';

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
  sel.value = ST.update || '';
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
            <div class="calc-val accent">+${fmtM(listGain)} → ${formatRankLabel(listNewMR)}${mrGain > 0 ? ` <span style="color:#b89030">(+${mrGain} rank${mrGain!==1?'s':''})</span>` : ' <span style="color:var(--tx3)">(no change)</span>'}</div>
        </div>
      </div>`;
  }

  el.innerHTML = `
    <div class="calc-row">
        <div class="calc-stat"><div class="calc-lbl">Progress to ${formatRankLabel(nextMR)}</div><div class="calc-val accent">${fmtM(currentMxp)} / ${fmtM(threshold)}</div></div>
      <div style="flex:1;display:flex;flex-direction:column;gap:2px;min-width:100px">
        <div style="display:flex;align-items:center;gap:6px">
          <div class="calc-bar-wrap" style="flex:1">
            <div class="calc-bar-fill" id="cbar-cur" style="width:${pct}%"></div>
            <div class="calc-bar-proj" id="cbar-proj" style="left:${pct}%;width:0%"></div>
          </div>
            <span class="calc-bar-rankup" id="cbar-rank-lbl">${formatRankLabel(playerMR)}→${formatRankLabel(nextMR)}</span>
        </div>
        <div class="calc-bar-overflow" id="cbar-overflow">
          <div style="display:flex;align-items:center;gap:6px">
            <div class="calc-bar-wrap" style="flex:1">
              <div class="calc-bar-proj" id="cbar-over" style="left:0%;width:0%"></div>
            </div>
              <span class="calc-bar-rankup" id="cbar-over-lbl">${formatRankLabel(nextMR)}→${formatRankLabel(nextMR+1)}</span>
          </div>
        </div>
      </div>
      <div class="calc-stat calc-gap-stat" style="align-items:flex-end"><div class="calc-lbl" id="cbar-gap-lbl">Gap</div><div class="calc-val" id="cbar-gap">+${fmtM(gap)}</div></div>
    </div>
    ${gap > 0 ? `<div class="calc-row" style="font-size:.68rem;color:var(--tx3)">
        To reach ${formatRankLabel(nextMR)}: <span style="color:var(--tx)">~${wepsNeeded} weapons</span> or <span style="color:var(--tx)">~${frmsNeeded} frames</span> at max rank
    </div>` : `<div style="font-size:.68rem;color:var(--acc)">Ready to rank up!</div>`}
    ${listHtml}
    <div class="calc-row">
        <div class="calc-stat"><div class="calc-lbl">Mastery ceiling</div><div class="calc-val">+${fmtM(potential)} available → ${formatRankLabel(ceilMR)} max</div></div>
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
    gapEl.textContent = remaining2 > 0 ? `+${fmtM(remaining2)} left` : 'Rank up!';
    gapEl.style.color = remaining2 <= 0 ? 'var(--acc)' : '';
  }
  const gapLbl = document.getElementById('cbar-gap-lbl');
  if (gapLbl) gapLbl.textContent = overflow > 0 ? 'Rank up' : 'Gap';
  if (rankLbl) rankLbl.textContent = `${formatRankLabel(playerMR)}→${formatRankLabel(nextMR)}`;
  if (overLbl) overLbl.textContent = `${formatRankLabel(nextMR)}→${formatRankLabel(nextMR+1)} (+${fmtM(overflow)} left)`;
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
    res.textContent = `+${fmtM(extra)} → ${formatRankLabel(newRank)}${newRank > mr ? ` (+${newRank - mr} rank${newRank-mr!==1?'s':''})` : ' (no change)'}`;
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
function onSearch(v) {
  clearTimeout(_st);
  _st = setTimeout(() => {
    const next = String(v || '');
    const changed = next !== ST.search;
    if (changed && ST.selection.size) {
      clearSelection();
      toast('Selection cleared after search change');
    }
    ST.search = next;
    document.getElementById('cx').style.display = next ? 'block' : 'none';
    render();
    saveSettings();
  }, 150);
}
function clearSearch() {
  const hadSearch = !!ST.search;
  ST.search='';
  document.getElementById('search-input').value='';
  document.getElementById('cx').style.display='none';
  if (hadSearch && ST.selection.size) {
    clearSelection();
    toast('Selection cleared after search reset');
  }
  render();
  saveSettings();
}
function onSort(v)   { ST.sort=v; render(); saveSettings(); }
function onGroup(v)  { ST.group=v; render(); saveSettings(); }
function onUpdateFilter(v) { ST.update = v || ''; render(); saveSettings(); }
function onPrimeFilter(v) { ST.primeFilter = v || ''; render(); saveSettings(); }
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

function syncStarButtonVisuals(paths) {
  const targets = paths ? [...paths] : [...ST.selection];
  targets.forEach(path => {
    const btn = document.querySelector(`.card[data-path="${CSS.escape(path)}"] .sbtn`);
    if (btn) btn.classList.toggle('on', isEntityStarred(path));
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
  if (ST.selection.size > 1) {
    const action = allStarred ? 'unstar' : 'star';
    if (!window.confirm(`${action === 'star' ? 'Star' : 'Unstar'} ${ST.selection.size} selected items?`)) return;
  }
  ST.selection.forEach(path => {
    const item = ST.items.find(i => i.path === path);
    const type = item?.cat || 'item';
    const currently = isEntityStarred(path);
    if (allStarred && currently) toggleEntityStar(path, type, null);
    else if (!allStarred && !currently) toggleEntityStar(path, type, null);
  });
  syncStarButtonVisuals(ST.selection);
  updateSelectionDisplay();
  toast(allStarred ? `☆ Unstarred ${ST.selection.size}` : `★ Starred ${ST.selection.size}`);
}

function unstarSelected() {
  if (!ST.selection.size) return;
  if (ST.selection.size > 1) {
    if (!window.confirm(`Unstar ${ST.selection.size} selected items?`)) return;
  }
  ST.selection.forEach(path => {
    const item = ST.items.find(i => i.path === path);
    if (isEntityStarred(path)) toggleEntityStar(path, item?.cat || 'item', null);
  });
  syncStarButtonVisuals(ST.selection);
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
  updateEasterEgg();
  document.getElementById('tab-items').className = 'tab'+(t==='items'?' active':'');
  document.getElementById('tab-sc').className    = 'tab'+(t==='sc'?' active':'');
  document.getElementById('tab-planner').className = 'tab'+(t==='planner'?' active':'');
  if (t==='sc') {
    renderStarChart(); // show loading state immediately
    loadStarChartData().then(() => renderStarChart());
  }
  if (t==='planner') renderPlanner();
}

function updateEasterEgg() {
  const egg = document.getElementById('mr-easter-egg');
  if (!egg) return;
  const mr = ST.userData.meta?.playerLevel || 0;
  egg.style.display = ST.tab === 'items' && mr >= 30 ? 'block' : 'none';
}

function toast(msg,dur=2200) {
  const el=document.getElementById('toast');
  if(!el) return;
  el.textContent=msg; el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'),dur);
}

/* ── PERSISTENCE ────────────────────────────── */
function saveSettings() {
  ST.userData.settings = {
    cats: ST.cats,
    acqs: ST.acqs,
    search: ST.search,
    sort: ST.sort,
    group: ST.group,
    update: ST.update,
    primeFilter: ST.primeFilter,
    plannerSort: ST.plannerSort,
    plannerLayout: ST.plannerLayout,
    plannerActiveList: ST.plannerActiveList,
    plannerPills: ST.userData.settings?.plannerPills || { owned: true, rankmax: true, status: true }
  };
  saveUserData();
}
function loadSettings() {
  // loadUserData handles this — this is a no-op kept for call-site compatibility
}

function getPlannerPillPrefs() {
  const p = ST.userData.settings?.plannerPills || {};
  return {
    owned: p.owned !== false,
    rankmax: p.rankmax !== false,
    status: p.status !== false,
  };
}

function syncPlannerPillToggles() {
  const prefs = getPlannerPillPrefs();
  const owned = document.getElementById('planner-pill-owned');
  const rankmax = document.getElementById('planner-pill-rankmax');
  const status = document.getElementById('planner-pill-status');
  if (owned) owned.checked = prefs.owned;
  if (rankmax) rankmax.checked = prefs.rankmax;
  if (status) status.checked = prefs.status;
}

function onPlannerPillToggle(key, checked) {
  if (!ST.userData.settings) ST.userData.settings = {};
  const current = ST.userData.settings.plannerPills || { owned: true, rankmax: true, status: true };
  ST.userData.settings.plannerPills = { ...current, [key]: checked };
  saveUserData();
  renderPlanner();
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
  // Persist player ID from payload; fallback to manual input if payload lacks it.
  const parsedId = persistPlayerIdFromProfileText(text);
  const manualId = document.getElementById('player-id-input')?.value.trim();
  if (!parsedId && manualId) savePlayerId(manualId);
  localStorage.setItem('wft3_profile', text);
  await loadAndShow(profile);
  function showE(m) { if (errEl) { errEl.textContent=m; errEl.className='err-box'; errEl.style.display='block'; } }
}

async function loadAndShow(profile) {
  document.getElementById('import-screen').style.display='none';
  document.getElementById('loading-screen').style.display='flex';
  ST.activeList = null;
  if (profile?.playerId) {
    savePlayerId(profile.playerId);
    ST.userData.meta.playerId = profile.playerId;
  }
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
  document.getElementById('player-info').textContent=`${profile.playerName} · ${formatRankLabel(profile.playerLevel)}`;
  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = ST.search || '';
  const cx = document.getElementById('cx');
  if (cx) cx.style.display = ST.search ? 'block' : 'none';
  updateEasterEgg();
  buildChips();
  buildUpdateSel();
  const sortSel = document.getElementById('sort-sel');
  if (sortSel) sortSel.value = ST.sort;
  const grpSel = document.getElementById('grp-sel');
  if (grpSel) grpSel.value = ST.group;
  const primeSel = document.getElementById('prime-sel');
  if (primeSel) primeSel.value = ST.primeFilter || '';
  const updSel = document.getElementById('upd-sel');
  if (updSel) updSel.value = ST.update || '';
  buildListBar();
  renderMbar();
  render();
  void fetchMissionDb().then(() => {
    if (document.getElementById('app')?.style.display === 'flex') renderMbar();
  });
  // Ensure refresh button is visible (it will show saved ID inside modal if none saved yet)
  const rbtn = document.getElementById('hbtn-refresh');
  if (rbtn) rbtn.style.display = 'inline-block';
  rebuildPlannerFilterOptions();
  const plannerSortSel = document.getElementById('planner-sort');
  if (plannerSortSel) plannerSortSel.value = ST.plannerSort;
  const plannerLayoutSel = document.getElementById('planner-layout');
  if (plannerLayoutSel) plannerLayoutSel.value = ST.plannerLayout;
  const plannerListSel = document.getElementById('planner-list');
  if (plannerListSel) plannerListSel.value = ST.plannerActiveList || 'none';
  syncPlannerPillToggles();
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
  // Setup paste auto-detect on json input
  const ta = document.getElementById('json-input');
  const detectBtn = document.getElementById('import-detect-btn');
  if (ta) {
    // hide any leftover detect UI
    if (detectBtn) detectBtn.style.display = 'none';
    const onPaste = (e) => {
      try {
        const text = (e.clipboardData || window.clipboardData).getData('text');
        if (!text || text.trim().length === 0) return;
        let profile;
        try { profile = parseProfile(text); } catch(_) { profile = null; }
        if (profile && profile.xpData && profile.xpData.length) {
          // Auto-fill textarea and show confirm button
          ta.value = text;
          if (detectBtn) {
            detectBtn.style.display = 'inline-block';
            detectBtn.focus();
          }
          toast('Profile JSON detected — click Import to continue');
        }
      } catch (err) { /* ignore */ }
    };
    ta.removeEventListener('paste', ta._onPaste || (()=>{}));
    ta._onPaste = onPaste;
    ta.addEventListener('paste', onPaste);
  }
}

function confirmDetectedImport() {
  const btn = document.getElementById('import-detect-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Importing…'; }
  // Close popup if opened
  try { if (window.__profilePopup && !window.__profilePopup.closed) window.__profilePopup.close(); } catch(e){}
  // Trigger the regular import flow
  void handleImport();
}

function resetApp() {
  document.getElementById('app').style.display='none';
  document.getElementById('import-screen').style.display='flex';
  document.getElementById('json-input').value='';
  ST.items=[]; ST.missions=[];
  ST.activeList = null;
  ST.search = '';
  initImportScreen();
  updateProfileOpenButtonState();
}

/* ── VALIDATION ────────────────────────────── */
function validateItemCounts(db) {
  if (window.__wfData?.validateItemCounts) return window.__wfData.validateItemCounts(db);
  console.warn('Data validator not ready yet. Reload once data.js is loaded.');
  return null;
}

function explainCategoryMismatch(category, db) {
  if (window.__wfData?.explainCategoryMismatch) return window.__wfData.explainCategoryMismatch(category, db);
  console.warn('Mismatch helper not ready yet. Reload once data.js is loaded.');
  return null;
}

// Smoke test helper: render planner and star chart (module-backed)
window.runSmokeTests = async function() {
  try {
    // ensure DB loaded
    if (window.__wfData?.fetchItemDb) await window.__wfData.fetchItemDb();
    if (window.__wfPlanner?.renderPlanner) window.__wfPlanner.renderPlanner();
    else if (typeof renderPlanner === 'function') renderPlanner();
    if (window.__wfStarChart?.renderStarChart) window.__wfStarChart.renderStarChart();
    else if (typeof renderStarChart === 'function') renderStarChart();
    console.log('Smoke tests executed');
    return true;
  } catch (e) {
    console.error('Smoke test failed', e);
    return false;
  }
};

/* ── AUDIT ──────────────────────────────────── */
async function auditDatabase() {
  const db = await dbGet('cache','item_db');
  if (!db) return console.error('Database not found. Refresh first.');
  const currentDb = db.v || db;
  console.log('%c--- MASTERY AUDIT REPORT ---','font-weight:bold;font-size:14px;color:#4aad9e;');
  console.log('Running item count validation...');
  validateItemCounts(currentDb);
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
  // Backfill saved player ID from last cached profile payload after reloads.
  if (!getPlayerId()) {
    const cachedProfile = localStorage.getItem('wft3_profile') || '';
    const recoveredId = cachedProfile ? persistPlayerIdFromProfileText(cachedProfile) : '';
    if (!recoveredId && ST.userData.meta?.playerId) savePlayerId(ST.userData.meta.playerId);
  }
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
