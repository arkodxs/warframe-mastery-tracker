'use strict';

function renderCalcPanel(el, currentMxp) {
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

  const rjInt      = ST.userData.meta?.rjInt      || 0;
  const drInt      = ST.userData.meta?.drInt      || 0;
  const plexusDone = ST.userData.meta?.plexusDone || false;
  const manualMxp  = rjInt * 1500 + drInt * 1500 + (plexusDone ? 6000 : 0);

  const potential = ST.items.reduce((s, i) =>
    s + (i.maxRank - i.rank) * masteryMult(i.cat), 0);
  const ceilMR = rankFromMastery(currentMxp + potential);

  let listHtml = '';
  if (ST.plannerActiveList) {
    const list = listById(ST.plannerActiveList);
    const listGain = ST.items.filter(it => ST.userData.entities[it.path]?.lists?.includes(ST.plannerActiveList))
      .reduce((s, i) => s + (i.maxRank - i.rank) * masteryMult(i.cat), 0);
    const listNewMR = rankFromMastery(currentMxp + listGain);
    const mrGain = listNewMR - playerMR;
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

  if (ST.plannerActiveList) {
    const listGain = ST.items
      .filter(it => ST.userData.entities[it.path]?.lists?.includes(ST.plannerActiveList))
      .reduce((s, i) => s + (i.maxRank - i.rank) * masteryMult(i.cat), 0);
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
  const currentPct = parseFloat(document.getElementById('cbar-cur')?.style.width) || 0;
  const th2 = mrThreshold(nextMR + 1);

  const remaining  = Math.max(0, th1 - Math.min(current, th1));
  const projOnBar1 = Math.min(projMxp, remaining);
  const currentRange = Math.max(1, th1 - th0);
  const projPct1   = Math.min(100, (projOnBar1 / currentRange) * 100);

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

  const listGain = (() => {
    if (!ST.plannerActiveList) return 0;
    return ST.items.filter(it => ST.userData.entities[it.path]?.lists?.includes(ST.plannerActiveList))
      .reduce((s, i) => s + (i.maxRank - i.rank) * masteryMult(i.cat), 0);
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
