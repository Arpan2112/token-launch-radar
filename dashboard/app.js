// Token Launch Radar — the page. Renders window.RADAR (written by main.ts beside this folder as
// data.js): a sortable, filterable board, a detail view per protocol with the arithmetic behind
// its implied value and its farm plan, and the live set the model priced from. No network, no
// framework: the two views are swapped by the location hash (#p=<slug> opens a protocol,
// #f=cat:..;wl:1 opens a filtered board), so every view has an address a reader can share.
'use strict';

const R = window.RADAR;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function money(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n;
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

/* ---------- header ---------- */
$('m-asof').textContent = R.as_of;
$('m-model').textContent = R.model_version + ' · peer-multiple';
$('foot-source').textContent = `Data: ${R.source}. Board generated from that sealed snapshot alone; ages are counted to ${R.as_of}.`;
$('stats').innerHTML = [
  [R.protocols_size, 'protocols scanned'],
  [R.watchlist_size, 'watchlist covered'],
  [R.board_size, 'pre-token rows ranked'],
  [R.early_size, 'early rows below the floor'],
  [R.live_size, 'live peers shown'],
].map(([n, l]) => `<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`).join('');

/* ---------- board ---------- */
const state = { q: '', cat: '', chain: '', wl: false, sort: 'rank' };
const bySlug = new Map(R.rows.map((r) => [r.slug, r]));

const cats = [...new Set(R.rows.map((r) => r.category).filter(Boolean))].sort();
$('f-cat').innerHTML = '<option value="">All categories</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join('');
const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
$('f-chain').innerHTML = '<option value="">All chains</option>' + chains.map((c) => `<option>${esc(c)}</option>`).join('');

function filtered() {
  let rows = R.rows.filter((r) =>
    (state.cat === '' || r.category === state.cat) &&
    (state.chain === '' || r.chains.includes(state.chain)) &&
    (!state.wl || r.watchlist) &&
    (state.q === '' || r.name.toLowerCase().includes(state.q) || r.slug.includes(state.q)));
  const key = {
    rank: (r) => -r.implied_value_usd,
    tvl: (r) => -r.tvl_usd,
    change: (r) => -(r.change_7d ?? -Infinity),
    age: (r) => -(r.age_days ?? -1),
    multiple: (r) => -(r.implied_value_usd / r.tvl_usd),
  }[state.sort];
  rows = rows.slice().sort((a, b) => key(a) - key(b) || a.rank - b.rank);
  return rows;
}

function renderBoard() {
  const rows = filtered();
  $('count').textContent = `${rows.length} of ${R.board_size} protocols`;
  $('rows').innerHTML = rows.map((r) => `
    <tr data-slug="${esc(r.slug)}">
      <td class="num">${r.rank}</td>
      <td><span class="pname">${esc(r.name)}</span>${r.watchlist ? ' <span class="star" title="On the snapshot watchlist">★</span>' : ''}</td>
      <td class="cat">${esc(r.category ?? '—')}</td>
      <td class="chains">${chainsText(r.chains)}</td>
      <td class="num">${money(r.tvl_usd)}</td>
      <td class="num">${pct(r.change_7d)}</td>
      <td class="num">${ageText(r.age_days)}</td>
      <td class="num">${money(r.implied_value_usd)}</td>
      <td class="num">${(r.implied_value_usd / r.tvl_usd).toFixed(2)}×</td>
    </tr>`).join('');
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

/* ---------- detail ---------- */
function renderDetail(r) {
  const peers = (r.category && R.peers[r.category]) || R.global_peers;
  const peerNote = r.peer_source === 'category'
    ? `median of ${r.peer_count} tokened ${esc(r.category)} protocols`
    : `global median of ${r.peer_count} tokened protocols (too few ${esc(r.category ?? 'peers')} peers to price from)`;
  const product = r.tvl_usd * r.peer_multiple * r.momentum_multiplier * r.maturity_multiplier * r.size_multiplier;
  $('detail-view').innerHTML = `
    <a class="back" href="#">← back to the board</a>
    <div class="d-head">
      <h2>${esc(r.name)} ${r.watchlist ? '<span class="badge">watchlist ★</span>' : '<span class="badge">early radar</span>'}</h2>
      <span class="d-rank">rank #${r.rank} of ${R.board_size}</span>
    </div>
    <p class="hint">${esc(r.category ?? 'Uncategorised')} · ${esc(r.chains.join(', ') || 'chain not recorded')} ·
    tracked by DefiLlama since ${esc(r.listed_at ?? 'an unrecorded date')} · records no token in the snapshot of ${R.as_of}.</p>
    <div class="d-grid">
      <div class="d-stat"><div class="n">${money(r.implied_value_usd)}</div><div class="l">Implied launch value</div></div>
      <div class="d-stat"><div class="n">${money(r.tvl_usd)}</div><div class="l">TVL</div></div>
      <div class="d-stat"><div class="n">${r.change_7d === null ? 'n/a' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%'}</div><div class="l">TVL change, 7 days</div></div>
      <div class="d-stat"><div class="n">${ageText(r.age_days)}</div><div class="l">Age with no token</div></div>
      <div class="d-stat"><div class="n">${r.peer_multiple.toFixed(3)}×</div><div class="l">Peer Mcap × TVL</div></div>
    </div>
    <section class="panel">
      <h2>How this value is built</h2>
      <table class="math">
        <tr><td>TVL in the snapshot</td><td class="num">${money(r.tvl_usd)}</td></tr>
        <tr><td>× peer multiple (${peerNote})</td><td class="num">× ${r.peer_multiple.toFixed(4)}</td></tr>
        <tr><td>× momentum (7-day TVL change, clamped)</td><td class="num">× ${r.momentum_multiplier.toFixed(4)}</td></tr>
        <tr><td>× maturity (age with no token)</td><td class="num">× ${r.maturity_multiplier.toFixed(4)}</td></tr>
        <tr><td>× size (log step from $5M to $500M TVL)</td><td class="num">× ${r.size_multiplier.toFixed(4)}</td></tr>
        <tr class="total"><td>Implied launch value (product ${money(Math.round(product))}, rounded)</td><td class="num">${money(r.implied_value_usd)}</td></tr>
      </table>
      <p>The same four lines price every row on the board; only the protocol's own figures change.</p>
    </section>
    <section class="panel">
      <h2>The peers it was priced against</h2>
      <p>Tokened protocols in the same group, by market cap. Their median Mcap × TVL is the multiple above —
      the market's own answer to what a dollar of TVL in this category is worth once a token trades.</p>
      <table class="board live">
        <thead><tr><th>Protocol</th><th>Symbol</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Mcap × TVL</th></tr></thead>
        <tbody>${peers.map((p) => `
          <tr><td><span class="pname">${esc(p.name)}</span></td><td class="cat">${esc(p.symbol ?? '')}</td>
          <td class="num">${money(p.tvl_usd)}</td><td class="num">${money(p.mcap_usd)}</td><td class="num">${p.multiple.toFixed(2)}×</td></tr>`).join('')}
        </tbody>
      </table>
    </section>
    <section class="panel">
      <h2>Farm plan</h2>
      <ol class="farm">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      <p>One wallet per protocol, a steady weekly rhythm, and never pay to claim: a launch, if it comes,
      rewards the wallets that were actually there.</p>
    </section>`;
}

/* ---------- routing & controls ---------- */
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
      const [k, v] = part.split(':');
      if (k === 'cat') state.cat = decodeURIComponent(v || '');
      if (k === 'chain') state.chain = decodeURIComponent(v || '');
      if (k === 'wl') state.wl = v === '1';
      if (k === 'q') state.q = decodeURIComponent(v || '').toLowerCase();
      if (k === 'sort') state.sort = v || 'rank';
    }
    $('f-cat').value = state.cat; $('f-chain').value = state.chain;
    $('f-wl').checked = state.wl; $('q').value = state.q; $('f-sort').value = state.sort;
  }
  $('detail-view').hidden = true;
  $('board-view').hidden = false;
  renderBoard();
}

$('q').addEventListener('input', (e) => { state.q = e.target.value.trim().toLowerCase(); renderBoard(); });
$('f-cat').addEventListener('change', (e) => { state.cat = e.target.value; renderBoard(); });
$('f-chain').addEventListener('change', (e) => { state.chain = e.target.value; renderBoard(); });
$('f-wl').addEventListener('change', (e) => { state.wl = e.target.checked; renderBoard(); });
$('f-sort').addEventListener('change', (e) => { state.sort = e.target.value; renderBoard(); });
window.addEventListener('hashchange', applyHash);

renderLive();
applyHash();
