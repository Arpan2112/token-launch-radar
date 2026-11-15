// Token Launch Radar — the page. Renders window.RADAR (written by main.ts beside this folder as
// data.js). The model below is the model: fitValueModel, leaveOneOutErrors and farmVerdict run
// on this page, on the comp set data.js ships, and the numbers in the methodology panel and the
// detail views are their outputs — the same functions, with the same arithmetic, that priced
// board.json. No network, no framework: the two views are swapped by the location hash
// (#p=<slug> opens a protocol, #f=cat:..;vd:FARM opens a filtered board).
'use strict';

const R = window.RADAR;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function money(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(n);
}
function pct(n) {
  if (n === null || n === undefined) return '<span class="cat">n/a</span>';
  const cls = n > 0 ? 'up' : n < 0 ? 'down' : '';
  return `<span class="${cls}">${n > 0 ? '+' : ''}${n.toFixed(1)}%</span>`;
}
function ageText(days) {
  if (days === null || days === undefined) return 'unknown';
  if (days < 365) return days + 'd';
  return (days / 365).toFixed(1) + 'y';
}
function chainsText(chains) {
  if (!chains || chains.length === 0) return '—';
  const shown = chains.slice(0, 2).join(', ');
  return esc(chains.length > 2 ? `${shown} +${chains.length - 2}` : shown);
}

/* ================= the model (the same arithmetic as lib/model.ts) ================= */

function featuresOf(tvl, change7d, ageDays) {
  const g = Math.min(300, Math.max(-90, typeof change7d === 'number' && Number.isFinite(change7d) ? change7d : 0));
  const age = ageDays === null || ageDays === undefined ? 365 : ageDays;
  return [Math.log10(Math.max(tvl, 1)), Math.asinh(g / 50), Math.log10(1 + Math.max(0, age))];
}
function solveLinear(a, b) {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    const swap = m[col]; m[col] = m[pivot]; m[pivot] = swap;
    const diag = m[col][col];
    if (Math.abs(diag) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col] / diag;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[n] / row[i]));
}
function ols(xs, ys) {
  const xtx = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  const xty = [0, 0, 0, 0];
  for (let i = 0; i < xs.length; i++) {
    const v = [1, xs[i][0], xs[i][1], xs[i][2]];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) xtx[r][c] += v[r] * v[c];
      xty[r] += v[r] * ys[i];
    }
  }
  return solveLinear(xtx, xty);
}
function fitValueModel(comps) {
  const xs = comps.map((c) => featuresOf(c.tvl_usd, c.change_7d, c.age_days));
  const ys = comps.map((c) => Math.log10(c.mcap_usd));
  const b = ols(xs, ys);
  return { intercept: b[0], on_log_tvl: b[1], on_growth: b[2], on_log_age: b[3], comps: comps.length };
}
function predictLogValue(fit, tvl, change7d, ageDays) {
  const [x1, x2, x3] = featuresOf(tvl, change7d, ageDays);
  return {
    logValue: fit.intercept + fit.on_log_tvl * x1 + fit.on_growth * x2 + fit.on_log_age * x3,
    curveMultiple: Math.pow(10, fit.intercept + fit.on_log_tvl * x1 - x1),
    growthFactor: Math.pow(10, fit.on_growth * x2),
    ageFactor: Math.pow(10, fit.on_log_age * x3),
  };
}
const sortedNums = (xs) => xs.slice().sort((a, b) => a - b);
function median(sorted) {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
}
function leaveOneOutErrors(comps) {
  return comps.map((held, i) => {
    const fit = fitValueModel(comps.filter((_, j) => j !== i));
    return predictLogValue(fit, held.tvl_usd, held.change_7d, held.age_days).logValue - Math.log10(held.mcap_usd);
  });
}
function leaveOneCategoryOutErrors(comps) {
  const errors = [];
  for (const cat of [...new Set(comps.map((c) => c.category ?? ''))]) {
    const members = comps.filter((c) => (c.category ?? '') === cat);
    if (members.length < 3) continue;
    const fit = fitValueModel(comps.filter((c) => (c.category ?? '') !== cat));
    for (const held of members) errors.push(predictLogValue(fit, held.tvl_usd, held.change_7d, held.age_days).logValue - Math.log10(held.mcap_usd));
  }
  return errors;
}
function spearman(a, b) {
  const ranks = (xs) => {
    const order = xs.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const out = new Array(xs.length);
    let i = 0;
    while (i < order.length) {
      let j = i;
      while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) out[order[k][1]] = avg;
      i = j + 1;
    }
    return out;
  };
  const ra = ranks(a), rb = ranks(b), n = a.length;
  const ma = ra.reduce((s, v) => s + v, 0) / n, mb = rb.reduce((s, v) => s + v, 0) / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) { cov += (ra[i] - ma) * (rb[i] - mb); va += (ra[i] - ma) ** 2; vb += (rb[i] - mb) ** 2; }
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0;
}
function familyOf(category) {
  const c = (category ?? '').toLowerCase();
  if (/bridge|staking|staked/.test(c)) return 'Bridges & Staking';
  if (/lend|cdp|collateral/.test(c)) return 'Lending & CDP';
  if (/dex|swap|derivat|perpetual|option/.test(c)) return 'Trading & Derivatives';
  if (/yield|basis|curator|index|farm|vault|allocator/.test(c)) return 'Yield & Vaults';
  if (/rwa|real world/.test(c)) return 'RWA';
  return 'Other';
}
function shrunkEffects(keys, residuals) {
  const byKey = new Map();
  keys.forEach((k, i) => { if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(residuals[i]); });
  const medians = new Map([...byKey].map(([k, rs]) => [k, median(sortedNums(rs))]));
  let ssWithin = 0, dfWithin = 0;
  for (const [k, rs] of byKey) { const med = medians.get(k); for (const r of rs) ssWithin += (r - med) ** 2; dfWithin += rs.length - 1; }
  const sigma2 = dfWithin > 0 ? ssWithin / dfWithin : 0;
  const total = keys.length;
  let grand = 0;
  for (const [k, rs] of byKey) grand += medians.get(k) * rs.length;
  grand = total > 0 ? grand / total : 0;
  let ssBetween = 0, sumN2 = 0;
  for (const [k, rs] of byKey) { ssBetween += rs.length * (medians.get(k) - grand) ** 2; sumN2 += rs.length ** 2; }
  const denom = total - sumN2 / Math.max(1, total);
  const tau2 = byKey.size > 1 && denom > 0 ? Math.max(0, (ssBetween - (byKey.size - 1) * sigma2) / denom) : 0;
  const effects = {};
  for (const [k, rs] of byKey) {
    const w = tau2 + sigma2 / rs.length > 0 ? tau2 / (tau2 + sigma2 / rs.length) : 0;
    const e = w * medians.get(k);
    if (e !== 0) effects[k] = e;
  }
  return effects;
}
function nearestTwins(comps, tvl, change7d, ageDays, category) {
  const cols = [0, 1, 2].map((k) => sortedNums(comps.map((c) => featuresOf(c.tvl_usd, c.change_7d, c.age_days)[k])));
  const iqr = cols.map((c) => Math.max(1e-9, quantile(c, 0.75) - quantile(c, 0.25)));
  const x = featuresOf(tvl, change7d, ageDays);
  const ranked = comps.map((c) => {
    const cx = featuresOf(c.tvl_usd, c.change_7d, c.age_days);
    let d = 0;
    for (let k = 0; k < 3; k++) { const z = (x[k] - cx[k]) / iqr[k]; d += z * z; }
    d = Math.sqrt(d);
    return { c, d: category !== null && c.category === category ? d * 0.7 : d };
  }).sort((a, b) => a.d - b.d || (a.c.slug < b.c.slug ? -1 : 1));
  const twins = ranked.slice(0, 5).map((r) => r.c);
  const twinImplied = tvl * median(sortedNums(twins.map((t) => t.mcap_usd / t.tvl_usd)));
  return { twins, twinImplied, nearestDistance: ranked.length ? ranked[0].d : Infinity };
}

/* ---------- the farm verdict (the same arithmetic as farmEconomics in lib/model.ts) ---------- */
function capitalFor(tvl) {
  if (tvl >= 5e9) return 250;
  if (tvl >= 1e9) return 150;
  if (tvl >= 2.5e8) return 100;
  if (tvl >= 5e7) return 75;
  return 50;
}
function holdDaysFor(age) {
  if (age === null || age === undefined) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}
function cheapestGas(chains) {
  let best = Infinity;
  for (const c of chains) best = Math.min(best, R.gas_usd[c] ?? R.gas_default_usd);
  return best === Infinity ? R.gas_default_usd : best;
}
function farmVerdict(r) {
  const F = R.farm;
  const capital = capitalFor(r.tvl_usd);
  const hold = holdDaysFor(r.age_days);
  const weeks = Math.ceil(hold / 7);
  const txCount = Math.min(16, 4 + weeks);
  const gasTotal = txCount * cheapestGas(r.chains);
  const opportunity = capital * F.opportunity_rate * (F.horizon_months / 12);
  const timeCost = (0.9 + weeks / 6) * F.time_usd_per_hour;
  const costTotal = gasTotal + opportunity + timeCost;
  const usersNow = Math.min(F.max_users, Math.max(F.min_users, Math.round(r.tvl_usd / F.avg_position_usd)));
  const users = usersNow * F.dilution;
  const share = Math.min(F.activity_weight / users, F.share_cap);
  const evBase = r.p_launch * r.implied_value_usd * F.alloc_base * share * F.realised_factor;
  const evLow = r.p_launch * r.band_low_usd * F.alloc_base * share * F.realised_factor;
  const denom = r.p_launch * F.alloc_base * share * F.realised_factor;
  const breakEven = denom > 0 ? Math.min(costTotal / denom, 1e15) : 1e15;
  const verdict = evLow >= costTotal || evBase >= F.farm_multiple * costTotal ? 'FARM' : evBase > costTotal ? 'THIN' : 'SKIP';
  return { capital, hold, gasTotal, opportunity, timeCost, costTotal, users, share, evBase, evLow, breakEven, verdict };
}

/* ---------- run the model on this page ---------- */
const COMPS = R.comps.filter((c) => c.fit_eligible);
const FIT = fitValueModel(COMPS);
const LOO = leaveOneOutErrors(COMPS);
const LOO_ABS = sortedNums(LOO.map(Math.abs));
const MDALE = median(LOO_ABS);
const HALF = quantile(LOO_ABS, 0.8);
const COVERAGE = LOO.filter((e) => Math.abs(e) <= HALF).length / LOO.length;
const LOCO = leaveOneCategoryOutErrors(COMPS);
const LOCO_MDALE = median(sortedNums(LOCO.map(Math.abs)));
const SPEAR = spearman(COMPS.map((c, i) => Math.log10(c.mcap_usd) + LOO[i]), COMPS.map((c) => Math.log10(c.mcap_usd)));
const MED_MULT_MDALE = (() => {
  const ratios = COMPS.map((c) => c.mcap_usd / c.tvl_usd);
  const errs = COMPS.map((c, i) => Math.log10(median(sortedNums(ratios.filter((_, j) => j !== i))) * c.tvl_usd) - Math.log10(c.mcap_usd));
  return median(sortedNums(errs.map(Math.abs)));
})();
const SIZE_ONLY_MDALE = (() => {
  const errs = COMPS.map((held, i) => {
    const rest = COMPS.filter((_, j) => j !== i);
    const xs = rest.map((c) => Math.log10(c.tvl_usd)), ys = rest.map((c) => Math.log10(c.mcap_usd));
    const mx = xs.reduce((s, v) => s + v, 0) / xs.length, my = ys.reduce((s, v) => s + v, 0) / ys.length;
    let sxy = 0, sxx = 0;
    for (let k = 0; k < xs.length; k++) { sxy += (xs[k] - mx) * (ys[k] - my); sxx += (xs[k] - mx) ** 2; }
    const slope = sxx > 0 ? sxy / sxx : 0;
    return my - slope * mx + slope * Math.log10(held.tvl_usd) - Math.log10(held.mcap_usd);
  });
  return median(sortedNums(errs.map(Math.abs)));
})();
const DRIFT = (() => {
  const ages = sortedNums(COMPS.map((c) => c.age_days ?? 365));
  const medAge = median(ages);
  const older = COMPS.filter((c) => (c.age_days ?? 365) >= medAge);
  const younger = COMPS.filter((c) => (c.age_days ?? 365) < medAge);
  if (older.length < 10 || younger.length < 5) return 0;
  const fitOld = fitValueModel(older);
  return median(sortedNums(younger.map((c) => predictLogValue(fitOld, c.tvl_usd, c.change_7d, c.age_days).logValue - Math.log10(c.mcap_usd))));
})();
const FAM_MAX = (() => {
  const residuals = COMPS.map((c) => Math.log10(c.mcap_usd) - predictLogValue(FIT, c.tvl_usd, c.change_7d, c.age_days).logValue);
  const eff = shrunkEffects(COMPS.map((c) => familyOf(c.category)), residuals);
  return Math.max(0, ...Object.values(eff).map(Math.abs));
})();
const VERDICTS = new Map(R.rows.map((r) => [r.slug, farmVerdict(r)]));

/* ================= rendering ================= */
$('m-asof').textContent = R.as_of;
$('m-model').textContent = R.model_version + ' · fitted, backtested';
$('foot-source').textContent = `Data: ${R.source}. Board generated from that sealed snapshot alone; ages are counted to ${R.as_of}.`;
const farmCount = R.rows.filter((r) => VERDICTS.get(r.slug).verdict === 'FARM').length;
$('stats').innerHTML = [
  [R.protocols_size, 'protocols scanned'],
  [R.watchlist_size, 'watchlist covered'],
  [R.board_size, 'pre-token rows ranked'],
  [COMPS.length, 'comps the fit learned from'],
  ['×' + Math.pow(10, MDALE).toFixed(1), 'typical backtest miss'],
  [farmCount, 'rows verdict FARM'],
].map(([n, l]) => `<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`).join('');
$('fx-test').textContent = '×' + Math.pow(10, FAM_MAX).toFixed(2);
$('drift').textContent = '×' + Math.pow(10, -DRIFT).toFixed(1);
$('backtest').innerHTML = `
  <table class="math">
    <tr><td>Fitted line: log<sub>10</sub> cap = ${FIT.intercept.toFixed(3)} + ${FIT.on_log_tvl.toFixed(3)}·log<sub>10</sub> TVL
      ${FIT.on_growth >= 0 ? '+' : '−'} ${Math.abs(FIT.on_growth).toFixed(3)}·growth ${FIT.on_log_age >= 0 ? '+' : '−'} ${Math.abs(FIT.on_log_age).toFixed(3)}·log<sub>10</sub> age</td>
      <td class="num">${FIT.comps} comps</td></tr>
    <tr><td>Leave-one-out median error — fitted model (recomputed on this page)</td><td class="num">×${Math.pow(10, MDALE).toFixed(2)}</td></tr>
    <tr><td>Leave-one-out median error — size-only line</td><td class="num">×${Math.pow(10, SIZE_ONLY_MDALE).toFixed(2)}</td></tr>
    <tr><td>Leave-one-out median error — flat median multiple</td><td class="num">×${Math.pow(10, MED_MULT_MDALE).toFixed(2)}</td></tr>
    <tr><td>Leave-one-category-out median error (the blind test)</td><td class="num">×${Math.pow(10, LOCO_MDALE).toFixed(2)}</td></tr>
    <tr><td>Rank correlation of the out-of-sample predictions (Spearman)</td><td class="num">${SPEAR.toFixed(2)}</td></tr>
    <tr><td>Band half-width from the backtest; measured coverage on the comps</td><td class="num">×${Math.pow(10, HALF).toFixed(1)} · ${(COVERAGE * 100).toFixed(0)}%</td></tr>
    <tr><td>Launch base rates in the snapshot (tokened share by age)</td><td class="num">${R.base_rates.map((b) => `${b.label} ${(b.p_launch * 100).toFixed(0)}%`).join(' · ')}</td></tr>
  </table>`;

const state = { q: '', cat: '', chain: '', wl: false, vd: '', sort: 'rank' };
const bySlug = new Map(R.rows.map((r) => [r.slug, r]));
const cats = [...new Set(R.rows.map((r) => r.category).filter(Boolean))].sort();
$('f-cat').innerHTML = '<option value="">All categories</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join('');
const chainList = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
$('f-chain').innerHTML = '<option value="">All chains</option>' + chainList.map((c) => `<option>${esc(c)}</option>`).join('');

function filtered() {
  let rows = R.rows.filter((r) =>
    (state.cat === '' || r.category === state.cat) &&
    (state.chain === '' || r.chains.includes(state.chain)) &&
    (state.vd === '' || VERDICTS.get(r.slug).verdict === state.vd) &&
    (!state.wl || r.watchlist) &&
    (state.q === '' || r.name.toLowerCase().includes(state.q) || r.slug.includes(state.q)));
  const key = {
    rank: (r) => -r.implied_value_usd,
    ev: (r) => -VERDICTS.get(r.slug).evBase,
    tvl: (r) => -r.tvl_usd,
    change: (r) => -(r.change_7d ?? -Infinity),
    age: (r) => -(r.age_days ?? -1),
    multiple: (r) => -(r.implied_value_usd / r.tvl_usd),
  }[state.sort];
  return rows.slice().sort((a, b) => key(a) - key(b) || a.rank - b.rank);
}

function renderBoard() {
  const rows = filtered();
  $('count').textContent = `${rows.length} of ${R.board_size} protocols`;
  $('rows').innerHTML = rows.map((r) => {
    const v = VERDICTS.get(r.slug);
    return `
    <tr data-slug="${esc(r.slug)}">
      <td class="num">${r.rank}</td>
      <td><span class="pname">${esc(r.name)}</span>${r.watchlist ? ' <span class="star" title="On the snapshot watchlist">★</span>' : ''}</td>
      <td class="cat">${esc(r.category ?? '—')}</td>
      <td class="num">${money(r.tvl_usd)}</td>
      <td class="num">${pct(r.change_7d)}</td>
      <td class="num">${ageText(r.age_days)}</td>
      <td class="num">${money(r.implied_value_usd)}</td>
      <td class="num band">${money(r.band_low_usd)} – ${money(r.band_high_usd)}</td>
      <td><span class="chip ${v.verdict.toLowerCase()}">${v.verdict}</span></td>
    </tr>`;
  }).join('');
  for (const tr of $('rows').querySelectorAll('tr')) {
    tr.addEventListener('click', () => { location.hash = 'p=' + tr.dataset.slug; });
  }
}

function renderLive() {
  $('live-rows').innerHTML = R.live.map((p) => `
    <tr>
      <td><span class="pname">${esc(p.name)}</span></td>
      <td class="cat">${esc(p.category ?? '—')}</td>
      <td class="num">${money(p.tvl_usd)}</td>
      <td class="num">${money(p.mcap_usd)}</td>
      <td class="num">${p.mcap_usd && p.tvl_usd ? (p.mcap_usd / p.tvl_usd).toFixed(2) + '×' : '—'}</td>
    </tr>`).join('');
}

function renderDetail(r) {
  const v = VERDICTS.get(r.slug);
  const pred = predictLogValue(FIT, r.tvl_usd, r.change_7d, r.age_days);
  const { twins, twinImplied } = nearestTwins(COMPS, r.tvl_usd, r.change_7d, r.age_days, r.category);
  const disagreement = Math.max(r.implied_value_usd / Math.max(1, twinImplied), twinImplied / Math.max(1, r.implied_value_usd));
  const peers = (r.category && R.peers[r.category]) || R.global_peers;
  const youngNote = (r.age_days ?? 365) < median(sortedNums(COMPS.map((c) => c.age_days ?? 365)))
    ? `<p class="note">Youth caveat: this protocol is younger than the median comp. In the age-split backtest a fit trained on
       older protocols underpriced younger ones by a median ×${Math.pow(10, -DRIFT).toFixed(1)} — young launches priced hot —
       so this value is, if anything, conservative.</p>` : '';
  const flagNote = r.extrapolated
    ? `<p class="note">Extrapolation flag: this row sits outside the comp set's support (size, age or twin distance),
       so its band is widened ×1.5. Treat the centre as a sketch, not a measurement.</p>` : '';
  $('detail-view').innerHTML = `
    <a class="back" href="#">← back to the board</a>
    <div class="d-head">
      <h2>${esc(r.name)} ${r.watchlist ? '<span class="badge">watchlist ★</span>' : '<span class="badge">early radar</span>'}</h2>
      <span class="d-rank">rank #${r.rank} of ${R.board_size} · bootstrap median #${r.rank_median} (80% interval #${r.rank_p10}–#${r.rank_p90})</span>
    </div>
    <p class="hint">${esc(r.category ?? 'Uncategorised')} · ${esc(r.chains.join(', ') || 'chain not recorded')} ·
    tracked by DefiLlama since ${esc(r.listed_at ?? 'an unrecorded date')} · records no token in the snapshot of ${R.as_of}.</p>
    <div class="d-grid">
      <div class="d-stat"><div class="n">${money(r.implied_value_usd)}</div><div class="l">Implied launch market cap</div></div>
      <div class="d-stat"><div class="n">${money(r.band_low_usd)} – ${money(r.band_high_usd)}</div><div class="l">80% band (backtest-set)</div></div>
      <div class="d-stat"><div class="n">${money(r.tvl_usd)}</div><div class="l">TVL</div></div>
      <div class="d-stat"><div class="n">${(r.p_top20 * 100).toFixed(0)}%</div><div class="l">Chance of a top-20 rank (bootstrap)</div></div>
      <div class="d-stat"><div class="n"><span class="chip ${v.verdict.toLowerCase()}">${v.verdict}</span></div><div class="l">Farm verdict</div></div>
    </div>
    <section class="panel">
      <h2>How this value is built</h2>
      <table class="math">
        <tr><td>Size curve at this TVL (the fitted line, before growth and age)</td><td class="num">× ${pred.curveMultiple.toFixed(4)}</td></tr>
        <tr><td>× growth (7-day TVL change ${r.change_7d === null ? 'not recorded' : r.change_7d.toFixed(1) + '%'}, winsorised)</td><td class="num">× ${pred.growthFactor.toFixed(4)}</td></tr>
        <tr><td>× age (${ageText(r.age_days)} with no token)</td><td class="num">× ${pred.ageFactor.toFixed(4)}</td></tr>
        <tr class="total"><td>Implied launch market cap = TVL × the three lines above</td><td class="num">${money(r.implied_value_usd)}</td></tr>
      </table>
      <p>The same fitted line prices every row; only the protocol's own figures change. Category effects were
      tested by shrinkage and rejected — no category term is hiding in this number.</p>
      ${youngNote}${flagNote}
    </section>
    <section class="panel">
      <h2>The five nearest trading twins</h2>
      <p>Tokened protocols closest to this one in size, growth and age, found by nearestTwins on this page.
      Their own median Mcap × TVL prices this TVL at ${money(Math.round(twinImplied))} — the fit and the twins
      ${disagreement > 2 ? `<b>disagree by ×${disagreement.toFixed(1)}</b>, so this row's band is widened` : `agree within ×${disagreement.toFixed(1)}`}.</p>
      <table class="board live">
        <thead><tr><th>Protocol</th><th>Symbol</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Mcap × TVL</th></tr></thead>
        <tbody>${twins.map((p) => `
          <tr><td><span class="pname">${esc(p.name)}</span></td><td class="cat">${esc(p.symbol ?? '')}</td>
          <td class="num">${money(p.tvl_usd)}</td><td class="num">${money(p.mcap_usd)}</td><td class="num">${(p.mcap_usd / p.tvl_usd).toFixed(2)}×</td></tr>`).join('')}
        </tbody>
      </table>
      <p class="hint">Its category's largest trading peers, for the wider picture:</p>
      <table class="board live">
        <thead><tr><th>Protocol</th><th>Symbol</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Mcap × TVL</th></tr></thead>
        <tbody>${peers.map((p) => `
          <tr><td><span class="pname">${esc(p.name)}</span></td><td class="cat">${esc(p.symbol ?? '')}</td>
          <td class="num">${money(p.tvl_usd)}</td><td class="num">${money(p.mcap_usd)}</td><td class="num">${p.multiple.toFixed(2)}×</td></tr>`).join('')}
        </tbody>
      </table>
    </section>
    <section class="panel">
      <h2>Farm plan — verdict ${v.verdict}</h2>
      <table class="math">
        <tr><td>Launch chance (snapshot base rate for its age, category-tilted)</td><td class="num">${(r.p_launch * 100).toFixed(0)}%</td></tr>
        <tr><td>Farmer's share of the drop (≈${v.users.toLocaleString('en-US')} qualifying wallets after dilution, weekly farmer at 2×)</td><td class="num">${(v.share * 100).toFixed(3)}%</td></tr>
        <tr><td>Expected value at the base case (10% allocation, realised factor 0.5)</td><td class="num">${money(Math.round(v.evBase))}</td></tr>
        <tr><td>Expected value at the band's low end</td><td class="num">${money(Math.round(v.evLow))}</td></tr>
        <tr><td>Plan cost (gas ${money(v.gasTotal)} + opportunity ${money(v.opportunity)} + time ${money(v.timeCost)})</td><td class="num">${money(v.costTotal)}</td></tr>
        <tr class="total"><td>Break-even launch value</td><td class="num">${money(Math.round(v.breakEven))}</td></tr>
      </table>
      <ol class="farm">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      <p>One wallet per protocol, a steady weekly rhythm, and never pay to claim: a launch, if it comes,
      rewards the wallets that were actually there.</p>
    </section>`;
}

function applyHash() {
  const h = location.hash.replace(/^#/, '');
  if (h.startsWith('p=')) {
    const r = bySlug.get(decodeURIComponent(h.slice(2)));
    if (r) {
      renderDetail(r);
      $('board-view').hidden = true;
      $('detail-view').hidden = false;
      window.scrollTo(0, 0);
      return;
    }
  }
  if (h.startsWith('f=')) {
    for (const part of h.slice(2).split(';')) {
      const [k, val] = part.split(':');
      if (k === 'cat') state.cat = decodeURIComponent(val || '');
      if (k === 'chain') state.chain = decodeURIComponent(val || '');
      if (k === 'wl') state.wl = val === '1';
      if (k === 'vd') state.vd = val || '';
      if (k === 'q') state.q = decodeURIComponent(val || '').toLowerCase();
      if (k === 'sort') state.sort = val || 'rank';
    }
    $('f-cat').value = state.cat; $('f-chain').value = state.chain;
    $('f-wl').checked = state.wl; $('q').value = state.q; $('f-sort').value = state.sort; $('f-verdict').value = state.vd;
  }
  $('detail-view').hidden = true;
  $('board-view').hidden = false;
  renderBoard();
}

$('q').addEventListener('input', (e) => { state.q = e.target.value.trim().toLowerCase(); renderBoard(); });
$('f-cat').addEventListener('change', (e) => { state.cat = e.target.value; renderBoard(); });
$('f-chain').addEventListener('change', (e) => { state.chain = e.target.value; renderBoard(); });
$('f-wl').addEventListener('change', (e) => { state.wl = e.target.checked; renderBoard(); });
$('f-verdict').addEventListener('change', (e) => { state.vd = e.target.value; renderBoard(); });
$('f-sort').addEventListener('change', (e) => { state.sort = e.target.value; renderBoard(); });
window.addEventListener('hashchange', applyHash);

renderLive();
applyHash();
