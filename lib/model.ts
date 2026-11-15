// Token Launch Radar — model v2 ("peer-multiple radar").
//
// One sealed DefiLlama snapshot in, one ranked board out. The board covers every slug on the
// snapshot's watchlist (the floor, never the ceiling) and adds every other protocol that records
// no token and is not a wrapped, staked, bridged or versioned product of one that trades: the
// early rows a radar exists to find. Protocols whose token already trades are never ranked; they
// are the peer set the model prices from, and the dashboard shows them apart as the live set.
//
// The implied launch value of a pre-token protocol is built only from the snapshot's own figures:
//
//   peers      = the tokened protocols in the same category (market cap / TVL each)
//   multiple   = median of the peers' Mcap/TVL ratios (at least 3 peers), else the median over
//                every tokened protocol except centralised exchanges
//   momentum   = 1 + clamp(change_7d, -50, +150) / 100 x 0.35
//   maturity   = 0.70 + 0.50 x min(age_days, 1460) / 1460   (age unknown: 365 days)
//   size       = 0.55 + 0.45 x log-step of TVL from $5M (0.55) to $500M (1.00)
//   implied    = round(TVL x multiple x momentum x maturity x size), at least $1
//
// No protocol name is ever special-cased: one function scores every row, and every row carries
// its own arithmetic so a reader can check it. Age is counted to the snapshot's own as_of date,
// never to the day the program runs, so two runs write the same bytes.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated in the dashboard so a reader can recompute any row. */
export interface ModelConstants {
  momentum_weight: number;
  momentum_floor_pct: number;
  momentum_cap_pct: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  size_min: number;
  size_floor_tvl: number;
  size_full_tvl: number;
  min_category_peers: number;
}

export const MODEL: ModelConstants = {
  momentum_weight: 0.35,
  momentum_floor_pct: -50,
  momentum_cap_pct: 150,
  maturity_floor: 0.7,
  maturity_range: 0.5,
  maturity_days: 1460,
  unknown_age_days: 365,
  size_min: 0.55,
  size_floor_tvl: 5_000_000,
  size_full_tvl: 500_000_000,
  min_category_peers: 3,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the dashboard's live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of board.json: the ranked board's row, with the arithmetic that priced it. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    peer_count: number;
    peer_source: 'category' | 'global';
    momentum_pct: number;
    momentum_multiplier: number;
    maturity_multiplier: number;
    size_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one board row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  peer_multiple: number;
  peer_count: number;
  peer_source: 'category' | 'global';
  momentum_multiplier: number;
  maturity_multiplier: number;
  size_multiplier: number;
  farm_steps: string[];
}

/** A tokened peer the model priced from: the market's own value, not a model's. */
export interface PeerRow {
  slug: string;
  name: string;
  symbol: string | null;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
}

/** A live-token protocol for the dashboard's live view. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the peers, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  protocols_size: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  peers: Record<string, PeerRow[]>;
  global_peers: PeerRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when a date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a list of numbers already sorted ascending. */
function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whether a protocol records no token at all in the snapshot. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whole words that mark a wrapped or staked product of a token that already trades. */
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;

/** Categories that are products of another protocol, or an exchange's own venue. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Names that begin with an exchange's name are that exchange's product, not a launch of their own. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * Whether the board may rank a protocol: it records no token, and it is not a wrapped, staked,
 * bridged or versioned product of one that trades. The same rule the house's watchlist states,
 * without its TVL floor, so the early rows are held to the watchlist's own standard.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (PRODUCT_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x))) return false;
  return true;
}

/** The tokened peers a filter keeps, strongest market cap first, and their median Mcap/TVL. */
interface PeerSet {
  multiple: number;
  rows: PeerRow[];
}

function peerSet(protocols: SnapshotProtocol[], keep: (p: SnapshotProtocol) => boolean): PeerSet {
  const rows: PeerRow[] = [];
  for (const p of protocols) {
    if (!keep(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    rows.push({ slug: p.slug, name: p.name, symbol: p.symbol, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, multiple: round4(p.mcap_usd / p.tvl_usd) });
  }
  rows.sort((a, b) => b.mcap_usd - a.mcap_usd || (a.slug < b.slug ? -1 : 1));
  const ratios = rows.map((r) => r.mcap_usd / r.tvl_usd).sort((a, b) => a - b);
  return { multiple: ratios.length > 0 ? median(ratios) : 0, rows };
}

/** The peer multiple one protocol is priced with, and where it came from. */
interface Priced {
  multiple: number;
  peerCount: number;
  source: 'category' | 'global';
}

/** The adjustment multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  priced: Priced,
): { implied: number; momentumPct: number; momentumMult: number; maturityMult: number; sizeMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const momentumPct = Math.min(model.momentum_cap_pct, Math.max(model.momentum_floor_pct, rawGrowth));
  const momentumMult = 1 + (momentumPct / 100) * model.momentum_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const logSpan = Math.log10(model.size_full_tvl) - Math.log10(model.size_floor_tvl);
  const logAt = Math.log10(Math.max(protocol.tvl_usd, model.size_floor_tvl)) - Math.log10(model.size_floor_tvl);
  const sizeMult = model.size_min + (1 - model.size_min) * Math.min(1, Math.max(0, logAt / logSpan));
  const implied = Math.max(1, Math.round(protocol.tvl_usd * priced.multiple * momentumMult * maturityMult * sizeMult));
  return { implied, momentumPct, momentumMult, maturityMult, sizeMult, age };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n, plus the peer sets used. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; peers: Record<string, PeerRow[]>; globalPeers: PeerRow[] } {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it is ranked, whatever the rule below would say.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol in the snapshot, at any TVL.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  // Peer sets: one per category the board uses, plus the global fallback (exchanges left out:
  // an exchange token is not priced on protocol TVL the way a launch would be).
  const global = peerSet(snapshot.protocols, (p) => !isPreToken(p) && p.category !== 'CEX');
  const watch = new Set(snapshot.watchlist);
  const peers: Record<string, PeerRow[]> = {};
  const pricedByCategory = new Map<string, Priced>();
  const priceFor = (p: SnapshotProtocol): Priced => {
    const key = p.category ?? '';
    const cached = pricedByCategory.get(key);
    if (cached !== undefined) return cached;
    let priced: Priced;
    if (p.category !== null) {
      const set = peerSet(snapshot.protocols, (q) => !isPreToken(q) && q.category === p.category);
      if (set.rows.length >= model.min_category_peers && set.multiple > 0) {
        priced = { multiple: set.multiple, peerCount: set.rows.length, source: 'category' };
        peers[p.category] = set.rows.slice(0, 8);
      } else {
        priced = { multiple: global.multiple, peerCount: global.rows.length, source: 'global' };
      }
    } else {
      priced = { multiple: global.multiple, peerCount: global.rows.length, source: 'global' };
    }
    pricedByCategory.set(key, priced);
    return priced;
  };

  const scored = [...chosen.values()].map((p) => {
    const priced = priceFor(p);
    const v = impliedValue(p, snapshot.as_of, model, priced);
    return { p, priced, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  const board = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    watchlist: watch.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      peer_multiple: round4(s.priced.multiple),
      peer_count: s.priced.peerCount,
      peer_source: s.priced.source,
      momentum_pct: s.momentumPct,
      momentum_multiplier: round4(s.momentumMult),
      maturity_multiplier: round4(s.maturityMult),
      size_multiplier: round4(s.sizeMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
  return { board, peers, globalPeers: global.rows.slice(0, 8) };
}

/** A small stable hash of a slug, so phrasing variants are chosen the same way on every run. */
function slugHash(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Typical gas for one contract call on a chain, in words a farmer can budget with. */
function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c.includes('ethereum')) return '$5 to $20 of ETH gas on Ethereum mainnet';
  if (c.includes('solana')) return 'under $0.10 of SOL in fees';
  if (c.includes('bsc') || c.includes('bnb')) return '$0.10 to $0.40 of BNB in gas';
  if (c.includes('polygon') || c.includes('matic')) return 'under $0.05 of POL in gas';
  if (c.includes('avalanche')) return '$0.20 to $0.80 of AVAX in gas';
  if (c.includes('bitcoin')) return '$1 to $3 of BTC in fees';
  return '$0.10 to $1 of gas on ' + chain;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 250_000_000) return 100;
  if (p.tvl_usd >= 50_000_000) return 75;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core farming action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend')) return `Supply $${capital} of USDC as collateral in ${name} on ${chain}, then borrow about half of it back and re-supply it once, so both sides of the market see your wallet.`;
  if (c.includes('cdp') || c.includes('collateral')) return `Deposit $${capital} of collateral into a ${name} vault on ${chain} and mint a modest amount of its stablecoin against it, keeping the health factor comfortably high.`;
  if (c.includes('dex') || c.includes('swap')) return `Provide $${capital} split between the two sides of ${name}'s busiest pool on ${chain}, and make two or three small swaps through the same wallet each week.`;
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} and hold one small hedged position (a long and an offsetting short of similar size) so the account stays active without directional risk.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('index')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares in the same wallet for the whole holding window.`;
  if (c.includes('yield') || c.includes('farm')) return `Deposit $${capital} into ${name}'s main vault on ${chain} and leave the position untouched apart from one small top-up each month.`;
  if (c.includes('basis')) return `Open the $${capital} basis position ${name} offers on ${chain} (a spot leg and its offsetting hedge) and keep both legs open together.`;
  if (c.includes('rwa') || c.includes('real world')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} through its own app and hold the asset in the minting wallet.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it rather than swapping out.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for the full term.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and take one position in an active market, then let it settle rather than trading out early.`;
  if (c.includes('privacy')) return `Deposit $${capital} through ${name}'s own interface on ${chain} and make one shielded transfer to your second wallet.`;
  if (c.includes('chain')) return `Bridge $${capital} to ${name} and use two or three native apps there (a swap and a lending deposit), so the wallet has real activity on the chain.`;
  if (c.includes('staking')) return `Stake $${capital} of the network asset through ${name} on ${chain} and keep the staking receipt in the same wallet.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} through its own app and keep the position open for the holding window.`;
}

/**
 * A protocol's farm plan: six steps, each an action with what it costs and how long it takes.
 * The plan is derived from the protocol's own record (category, chains, TVL, age) and two
 * phrasings are picked by a hash of its slug, so no two plans read exactly alike and no plan
 * is a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const pick = slugHash(p.slug) % 2;
  const setup =
    pick === 0
      ? `Fund one dedicated wallet with the capital and a little ${chain} gas money, and use that wallet for ${p.name} only. Cost: ${gas} to fund and set up. Time: 10 minutes.`
      : `Use a fresh wallet that holds only what you plan to farm with, and keep its seed phrase offline. Cost: ${gas} for the first funding transaction. Time: 5 minutes.`;
  const weekly =
    pick === 0
      ? `Repeat one qualifying action every week (a deposit, a borrow, a swap or a claim, whichever ${p.name} counts) so the wallet shows a rhythm, not a single burst. Cost: about ${gas} a week. Time: 10 minutes a week.`
      : `Come back once a week and make one small qualifying transaction on ${p.name}; steady weeks count for more than one large day. Cost: about ${gas} a week. Time: 10 minutes a week.`;
  return [
    setup,
    `${actionFor(p, capital, chain)} Cost: $${capital} of capital plus ${gas}. Time: 15 minutes to set up.`,
    weekly,
    `Hold the position for at least ${hold} days without withdrawing, so the activity appears in more than one weekly snapshot of the protocol. Cost: the $${capital} stays locked in the position. Time: ${hold} days.`,
    `Check ${p.name}'s own points or rewards page from inside its app, and claim only through a link the protocol itself publishes; a claim that asks for a payment first is a scam. Cost: nothing to check, and never pay to claim. Time: 10 minutes.`,
    `Keep a farm log with the wallet address, the dates and the transaction hashes, so the position can be repeated, proven or unwound later. Cost: nothing but the log. Time: 5 minutes.`,
  ];
}

/** The live-token protocols, by market cap, for the dashboard's live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    watchlist: row.watchlist,
    implied_value_usd: row.implied_value_usd,
    peer_multiple: row.model.peer_multiple,
    peer_count: row.model.peer_count,
    peer_source: row.model.peer_source,
    momentum_multiplier: row.model.momentum_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    size_multiplier: row.model.size_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, peers, globalPeers } = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    protocols_size: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    peers,
    global_peers: globalPeers,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, farm steps, values. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows: the gate wants at least 100`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
