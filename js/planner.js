'use strict';

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

  listSel.innerHTML = `<option value="none">No list filter</option>`;
  ST.userData.lists.forEach(l => {
    const o = document.createElement('option');
    o.value = l.id;
    o.textContent = l.name;
    listSel.appendChild(o);
  });

  const exists = [...sel.options].some(o => o.value === prev);
  sel.value = exists ? prev : 'all';
  listSel.value = ST.plannerActiveList || 'none';
}

function onPlannerList(v) {
  ST.plannerActiveList = v === 'none' ? null : v;
  renderPlanner();
  saveSettings();
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
        inActiveList: ST.plannerActiveList ? !!ST.userData.entities[it.path]?.lists?.includes(ST.plannerActiveList) : false,
      };
    })
    .filter(Boolean);

  const mode = document.getElementById('planner-filter')?.value || 'all';
  const listSel = document.getElementById('planner-list')?.value || 'none';
  let visible = rows;
  if (listSel !== 'none') {
    visible = rows.filter(r => ST.userData.entities[r.item.path]?.lists?.includes(listSel));
    ST.plannerActiveList = listSel;
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
  syncPlannerPillToggles();

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
  const pillPrefs = getPlannerPillPrefs();

  const makePlannerRow = (r) => {
    const details = document.createElement('details');
    details.className = 'planner-row';
    details.dataset.path = r.item.path;
    if (ST._plannerSelectedPath === r.item.path) details.classList.add('selected');
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
          <div class="planner-content">
            <div class="planner-line1">
            <span class="planner-name">${escapeHtml(r.item.name)}</span>
            <span class="planner-stars">${Number(r.planner.total_stars).toFixed(1)} ★</span>
            <span class="planner-cat">${escapeHtml(r.planner.category)}</span>
            </div>
            <div class="planner-badges">
            ${pillPrefs.owned ? `<span class="planner-chip ${ownedCls}">${r.item.isOwned ? 'Owned' : 'Unowned'}</span>` : ''}
            ${pillPrefs.rankmax ? `<span class="planner-chip ${rankStateCls}">${rankStateLbl}</span>` : ''}
            ${pillPrefs.status ? `<span class="planner-chip farm">${escapeHtml(farmLabel)}</span>` : ''}
            ${notePresent ? '<span class="planner-chip note">Note</span>' : ''}
            </div>
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

    details.querySelector('summary')?.addEventListener('click', () => {
      const prev = ST._plannerSelectedPath;
      ST._plannerSelectedPath = (prev === r.item.path) ? null : r.item.path;
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
