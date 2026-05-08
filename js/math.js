'use strict';

function xpToRank(xp, multiplier, maxRank) {
  if (!xp || xp <= 0) return 0;
  const constant = multiplier * 5;
  return Math.min(Math.floor(Math.sqrt(xp / constant)), maxRank);
}

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
  let lo = 0, hi = 40;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (mrThreshold(mid) <= xp) lo = mid; else hi = mid - 1;
  }
  return lo;
}

function calcTotalMastery() {
  const itemMxp   = ST.items.reduce((s,i) => s + (i.mastery || 0), 0);
  const scMxp     = calcStarChartMxp(ST.missions);
  const rjMxp     = (ST.userData.meta?.rjInt || 0) * 1500;
  const drMxp     = (ST.userData.meta?.drInt || 0) * 1500;
  const plexusMxp = ST.userData.meta?.plexusDone ? 6000 : 0;
  return itemMxp + scMxp + rjMxp + drMxp + plexusMxp;
}
