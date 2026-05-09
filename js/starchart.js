'use strict';

function renderStarChart() {
  const el = document.getElementById('scgrid');
  if (!el) return;
  el.innerHTML = '';

  if (!ST.nodeDb || !Object.keys(ST.nodeDb).length) {
    el.innerHTML = '<div style="color:var(--tx3);font-size:.88rem;padding:2rem 0">Loading star chart data…</div>';
    return;
  }

  const { planets, railjack } = processStarChart(ST.missions, ST.nodeDb, ST.missionDb);

  let totalNodes = 0, doneNodes = 0, spTotal = 0, spDoneCount = 0, junctionTotal = 0, junctionDone = 0, mxpAvailable = 0;
  planets.forEach(p => p.nodes.forEach(n => {
    totalNodes++; if (n.done) doneNodes++;
    if (n.isJunction) { junctionTotal++; if (n.done) junctionDone++; }
    if (n.done) { spTotal++; if (n.spDone) spDoneCount++; }
    if (n.masteryExp > 0 && (n.isJunction ? !n.done : !n.spDone)) mxpAvailable += n.masteryExp;
  }));
  const overallPct = totalNodes ? Math.round(doneNodes / totalNodes * 100) : 0;
  const spOverallPct = spTotal ? Math.round(spDoneCount / spTotal * 100) : 0;
  const isOverallBaseDone = overallPct === 100;
  const displayOverallPct = isOverallBaseDone ? spOverallPct : overallPct;
  const overallLabel = isOverallBaseDone ? `${displayOverallPct}% SP` : `${displayOverallPct}%`;
  const overallBarColor = isOverallBaseDone ? '#8866e8' : 'var(--acc)';

  const summary = document.createElement('div'); summary.className = 'sc-summary';
  summary.innerHTML = `
    <div class="sc-sum-stat"><div class="sc-sum-num">${doneNodes}/${totalNodes}</div><div class="sc-sum-lbl">Base nodes</div></div>
    <div style="width:1px;height:28px;background:var(--bd2);flex-shrink:0"></div>
    <div class="sc-sum-stat"><div class="sc-sum-num">${spDoneCount}/${spTotal}</div><div class="sc-sum-lbl">Steel Path</div></div>
    <div style="width:1px;height:28px;background:var(--bd2);flex-shrink:0"></div>
    <div class="sc-sum-stat"><div class="sc-sum-num">${junctionDone}/${junctionTotal}</div><div class="sc-sum-lbl">Junctions</div></div>
    ${mxpAvailable > 0 ? `<div style="width:1px;height:28px;background:var(--bd2);flex-shrink:0"></div><div class="sc-sum-stat"><div class="sc-sum-num sc-mxp-available">+${fmtM(mxpAvailable)}</div><div class="sc-sum-lbl">MXP available</div></div>` : ''}
    <div class="scbw" style="flex:1;height:6px"><div class="scb" style="width:${displayOverallPct}%;background:${overallBarColor}"></div></div>
    <div class="sc-sum-stat" style="align-items:flex-end"><div class="sc-sum-num" style="color:${overallBarColor}">${overallLabel}</div><div class="sc-sum-lbl">Overall</div></div>`;
  el.appendChild(summary);

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
      <button class="sc-col-btn" onclick="setSCCols(${Math.max(1, cols - 1)})">−</button>
      <span>${cols}</span>
      <button class="sc-col-btn" onclick="setSCCols(${Math.min(5, cols + 1)})">+</button>
    </div>`;
  el.appendChild(controls);

  const ph = document.createElement('div'); ph.className = 'sc-section'; ph.textContent = 'Star Chart'; el.appendChild(ph);

  function buildNodeRow(n) {
    const row = document.createElement('div');
    row.className = 'sc-node' + (n.spDone ? ' sp-done' : n.done ? ' done' : '') + (n.isJunction ? ' junction' : '');
    const lvl = n.minLevel && n.maxLevel ? `${n.minLevel}–${n.maxLevel}` : '';
    const typeStr = [n.type, n.enemy, lvl].filter(Boolean).join(' · ');
    row.innerHTML = `
      <span class="sc-node-status">${n.done ? '✓' : '○'}</span>
      <span class="sc-node-icon">${n.isJunction ? '◆' : '●'}</span>
      <span class="sc-node-name">${n.name}</span>
      <span class="sc-node-type">${typeStr}</span>
      ${n.completes > 0 ? `<span class="sc-node-runs">${n.completes}×</span>` : ''}
      ${n.masteryExp > 0 && (n.isJunction ? !n.done : !n.spDone) ? `<span class="sc-node-mxp" title="${n.isJunction ? 'Junction' : 'SP'} completion awards ${n.masteryExp} mastery XP">+${n.masteryExp}</span>` : ''}
      <a class="sc-node-wiki" href="https://wiki.warframe.com/w/${n.name.replace(/ /g,'_')}" target="_blank" onclick="event.stopPropagation()">wiki ↗</a>
      <button class="sc-node-star">★</button>
      <input class="sc-node-note" type="text" placeholder="note…">`;
    const sb = row.querySelector('.sc-node-star');
    if (isEntityStarred(n.tag)) sb.classList.add('on');
    sb.addEventListener('click', e => { e.stopPropagation(); toggleEntityStar(n.tag, 'node', sb); });
    const ni = row.querySelector('.sc-node-note');
    ni.value = ST.userData.entities[n.tag]?.note || '';
    ni.addEventListener('blur', () => saveEntityNote(n.tag, 'node', ni.value));
    ni.addEventListener('click', e => e.stopPropagation());
    ni.addEventListener('keydown', e => e.stopPropagation());
    return row;
  }

  const sortedPlanets = [...planets].sort((a, b) => {
    const aS = isEntityStarred('planet:' + a.name) ? 0 : 1;
    const bS = isEntityStarred('planet:' + b.name) ? 0 : 1;
    return aS - bS;
  });

  const grid = document.createElement('div');
  grid.className = 'sc-planet-grid';
  grid.style.setProperty('--cols', cols);

  let activePlanet = null;
  const detailPanel = document.getElementById('sc-planet-detail');

  function renderEmptyDetail() {
    if (!detailPanel) return;
    detailPanel.classList.add('open');
    detailPanel.innerHTML = `
      <div class="sc-planet-detail-hdr" style="cursor:default">
        <span class="sc-detail-name">Select a planet</span>
        <button class="sc-detail-close" onclick="closePlanetDetail()">✕ Close</button>
      </div>
      <div class="sc-detail-empty">Pick a tile on the left to view the node breakdown, junctions, and Steel Path status here.</div>`;
  }

  function openPlanetDetail(p, tile) {
    if (!detailPanel) return;
    grid.querySelectorAll('.sc-planet-tile.selected').forEach(t => t.classList.remove('selected'));
    if (activePlanet === p.name) {
      activePlanet = null;
      renderEmptyDetail();
      return;
    }
    activePlanet = p.name;
    tile.classList.add('selected');

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
  }

  function closePlanetDetail() {
    activePlanet = null;
    renderEmptyDetail();
    grid.querySelectorAll('.sc-planet-tile.selected').forEach(t => t.classList.remove('selected'));
  }

  const chartEntries = [
    ...sortedPlanets.map(p => ({ type: 'planet', name: p.name, data: p })),
    { type: 'railjack', name: 'Railjack', data: { name: 'Railjack', nodes: railjack } },
  ];

  const railjackEntryIndex = chartEntries.findIndex(entry => entry.type === 'railjack');
  if (railjackEntryIndex !== -1) {
    const [railjackEntry] = chartEntries.splice(railjackEntryIndex, 1);
    chartEntries.sort((a, b) => a.name.localeCompare(b.name));
    chartEntries.push(railjackEntry);
  } else {
    chartEntries.sort((a, b) => a.name.localeCompare(b.name));
  }

  chartEntries.forEach(entry => {
    const p = entry.data;
    const done = p.nodes.filter(n => n.done).length;
    const spD = p.nodes.filter(n => n.spDone).length;
    const total = p.nodes.length;

    const basePct = total ? Math.round(done / total * 100) : 0;
    const spPct = total ? Math.round(spD / total * 100) : 0;
    const isBaseDone = basePct === 100;
    const displayPct = isBaseDone ? spPct : basePct;
    const pctClass = isBaseDone ? 'sc-tile-pct sp-focus' : 'sc-tile-pct';
    const pctLabel = isBaseDone ? `${displayPct}% SP` : `${displayPct}%`;
    const starred = isEntityStarred('planet:' + p.name);

    const availMxp = p.nodes.reduce((s, n) => {
      if (n.masteryExp > 0 && (n.isJunction ? !n.done : !n.spDone)) return s + n.masteryExp;
      return s;
    }, 0);

    const tile = document.createElement('div');
    tile.className = 'sc-planet-tile' + (entry.type === 'railjack' ? ' railjack' : '') + (isBaseDone ? ' complete' : '') + (starred ? ' priority' : '');
    if (entry.type === 'railjack') tile.style.gridColumn = '1 / -1';

    tile.innerHTML = `
      <div class="sc-tile-hdr">
        <span class="sc-tile-name">${p.name}</span>
        <button class="sc-tile-star${starred ? ' on' : ''}">⭑</button>
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
      const on = toggleEntityStar('planet:' + p.name, 'planet', starBtn);
      tile.classList.toggle('priority', on);
    });

    tile.addEventListener('click', e => {
      if (e.target.closest('.sc-tile-star')) return;
      openPlanetDetail(p, tile);
    });

    grid.appendChild(tile);
  });
  el.appendChild(grid);

  if (!detailPanel?.innerHTML) renderEmptyDetail();
}

function closePlanetDetail() {
  const detailPanel = document.getElementById('sc-planet-detail');
  if (detailPanel) {
    detailPanel.classList.add('open');
    detailPanel.innerHTML = `
      <div class="sc-planet-detail-hdr" style="cursor:default">
        <span class="sc-detail-name">Select a planet</span>
        <button class="sc-detail-close" onclick="closePlanetDetail()">✕ Close</button>
      </div>
      <div class="sc-detail-empty">Pick a tile on the left to view the node breakdown, junctions, and Steel Path status here.</div>`;
  }
  document.querySelectorAll('.sc-planet-tile.selected').forEach(t => t.classList.remove('selected'));
}

function setSCCols(n) {
  if (!ST.userData.settings) ST.userData.settings = {};
  ST.userData.settings.scCols = n;
  saveUserData();
  renderStarChart();
}
