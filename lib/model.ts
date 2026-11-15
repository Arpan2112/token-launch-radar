// Token Launch Radar — model v4 ("decision-grade radar"; the fit is radar-3's, kept whole).
//
// What v4 adds, none of it a new pricing rule: a jackknife+ band beside the LOO band (two
// resampling procedures, shown together so a reader can see whether the interval depends on
// the procedure — neither resolves the shift between tokened comps and pre-token targets);
// a young-cohort fit published as a labelled sensitivity beside the full fit's primary value
// (the age-split drift below measures why: a fit trained on older comps prices younger ones
// low, and the board is mostly young protocols — the sensitivity illustrates that pull without
// moving the ranking); a stress test of every farm verdict at a 3% community allocation, with
// the count of FARM verdicts that survive it printed on the board; and honest names — the
// launch figure is a propensity (the historical tokened share of a protocol's age cohort,
// tilted by category), not a forecast probability.
//
// One sealed DefiLlama snapshot in, one ranked board out. The board covers every slug on the
// snapshot's watchlist (the floor, never the ceiling) and adds every other protocol that records
// no token and is not a wrapped, staked, bridged or versioned product of one that trades: the
// early rows a radar exists to find. Protocols whose token already trades are never ranked; they
// are the comparable set ("comps") the model is fitted on, and the dashboard shows them apart.
//
// Where the earlier radar priced a row from a median multiple and hand-set adjustments, this one
// FITS its pricing rule to the comps and then grades that fit in the open:
//
//   features   x1 = log10(TVL);  x2 = asinh(clamp(change_7d, -90, +300) / 50)   (7-day growth);
//              x3 = log10(1 + age in days with no token, unknown age counts 365)
//   fit        ordinary least squares of log10(market cap) on [1, x1, x2, x3] over the comps
//              whose tokens are priced on TVL at all (a cap under 0.002x or over 20x TVL is a
//              token priced on something else; 5 of 119 sit out the fit). Category effects are
//              tested, not assumed: an empirical-Bayes shrinkage estimate of the per-family
//              residual medians puts their weight at zero on this snapshot, so no category or
//              family term enters the price — the backtest prints the test beside the fit.
//   backtest   leave-one-out over every comp (the whole fit redone without it), leave-one-category
//              -out as the blind test, and an old-fit/young-test split that measures how a model
//              trained on long-tracked protocols prices younger ones. The headline error is the
//              median absolute log error: the typical factor the model misses by.
//   band       each row's value carries an 80% band whose half-width is the 80th percentile of the
//              leave-one-out absolute log errors, widened x1.5 where the row sits outside the
//              comps' support or its five nearest trading twins disagree with the fit by > 2x.
//   stability  a seeded bootstrap (mulberry32, 200 resamples of the comps, the fit redone each
//              time) gives every row a median rank, an 80% rank interval and P(top 20), so a rank
//              is a measurement with an error bar, not a decree.
//   farm EV    verdict per row: P(launch) from the snapshot's own tokened share by age bucket,
//              times the implied market cap (a market cap, not an FDV: the snapshot records no
//              supply), times a community-allocation scenario (bear 4% / base 10% / bull 17%, the
//              realised first-drop range), times the farmer's share of the drop (qualifying
//              wallets estimated from TVL at a $50,000 average position, bounded 500 to 100,000;
//              a weekly farmer earns twice one qualifying wallet), times a 0.5 realised
//              factor (most launches trade far below their opening print), minus the plan's own
//              costs: gas on the protocol's cheapest chain, a 5% a year opportunity cost on the
//              plan's capital over a 6-month horizon, and time at $10 an hour. The break-even
//              launch value (the cap at which the plan's EV equals its cost) is printed per row,
//              and the verdict is FARM when the expected value clears the cost even at the band's
//              low end or by 3x at the centre, THIN when it clears only at the centre, and SKIP
//              when it does not clear at all.
//
// No protocol name is ever special-cased: one function scores every row, and every row carries
// its own arithmetic so a reader can check it. Age is counted to the snapshot's own as_of date,
// never to the day the program runs, and every sort has a total tie-break, so two runs of this
// program write identical bytes.

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

/** The fitted model's shape: four regression coefficients, nothing else. */
export interface FittedModel {
  intercept: number;
  on_log_tvl: number;
  on_growth: number;
  on_log_age: number;
  comps: number;
}

/** The backtest's published measurements, all computed by leaving data out and refitting. */
export interface BacktestStats {
  comps: number;
  loo_median_abs_log_error: number;
  loo_typical_factor: number;
  loo_spearman: number;
  band_half_width_log: number;
  band_coverage: number;
  loco_median_abs_log_error: number;
  loco_rows: number;
  median_multiple_median_abs_log_error: number;
  size_only_median_abs_log_error: number;
  age_split_drift_log: number;
  /** The largest family effect the shrinkage estimator would allow, in log10: ~0 = none survives. */
  family_effect_max_log: number;
  /** Jackknife+ on the comps: empirical coverage of the jackknife+ 80% interval, on the comps. */
  jk_coverage: number;
  /** Jackknife+ median half-width in log10, beside the LOO band's half-width. */
  jk_median_half_width_log: number;
  /** The young half of the comps (below the median comp age) and its own leave-one-out error. */
  young_comps: number;
  young_loo_median_abs_log_error: number;
  /** True when the young-cohort fit's own error is over 1.5x the full fit's: label it unstable. */
  young_unstable: boolean;
}

/** A trading comparable, in the raw figures the fit consumes. */
export interface CompRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  age_days: number | null;
  /**
   * Whether the fit may learn from this comp: a market cap under 0.002x or over 20x its TVL is a
   * token priced on something other than protocol TVL, so the fit leaves it out (it is still
   * shown as a peer). Stated in the dashboard; on this snapshot it sets 5 of 119 comps aside.
   */
  fit_eligible: boolean;
}

/** The farm economics constants, stated in the dashboard so a reader can recompute any verdict. */
export interface FarmConstants {
  alloc_bear: number;
  alloc_base: number;
  alloc_bull: number;
  /** The stress allocation every verdict is re-graded at: 3% of the launch to the community. */
  alloc_stress: number;
  realised_factor: number;
  opportunity_rate: number;
  horizon_months: number;
  time_usd_per_hour: number;
  activity_weight: number;
  share_cap: number;
  farm_multiple: number;
  avg_position_usd: number;
  min_users: number;
  max_users: number;
  dilution: number;
}

export const FARM: FarmConstants = {
  alloc_bear: 0.04,
  alloc_base: 0.1,
  alloc_bull: 0.17,
  alloc_stress: 0.03,
  realised_factor: 0.5,
  opportunity_rate: 0.05,
  horizon_months: 6,
  time_usd_per_hour: 10,
  activity_weight: 2,
  share_cap: 0.005,
  farm_multiple: 3,
  avg_position_usd: 50_000,
  min_users: 500,
  max_users: 100_000,
  dilution: 3,
};

/** Gas in dollars for one contract call, by chain: the plan is costed on the cheapest chain named. */
export const GAS_USD: Record<string, number> = {
  Ethereum: 8,
  Solana: 0.01,
  BSC: 0.25,
  'BNB Chain': 0.25,
  Arbitrum: 0.05,
  Base: 0.05,
  Optimism: 0.05,
  Polygon: 0.02,
  'Polygon zkEVM': 0.05,
  Avalanche: 0.5,
  Bitcoin: 2,
};
export const GAS_DEFAULT_USD = 0.5;

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-4';

/** How many live-token protocols the dashboard's live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of board.json: the ranked board's row, with the arithmetic that priced and judged it. */
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
    fitted_multiple: number;
    curve_multiple: number;
    growth_factor: number;
    age_factor: number;
    band_low_usd: number;
    band_high_usd: number;
    jk_low_usd: number;
    jk_high_usd: number;
    young_implied_usd: number;
    twin_implied_usd: number;
    twin_disagreement: number;
    extrapolated: boolean;
    rank_median: number;
    rank_p10: number;
    rank_p90: number;
    p_top20: number;
    p_launch: number;
    ev_base_usd: number;
    ev_low_usd: number;
    cost_total_usd: number;
    break_even_usd: number;
    verdict: 'FARM' | 'THIN' | 'SKIP';
    ev_stress_usd: number;
    verdict_stress: 'FARM' | 'THIN' | 'SKIP';
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
  fitted_multiple: number;
  curve_multiple: number;
  growth_factor: number;
  age_factor: number;
  band_low_usd: number;
  band_high_usd: number;
  jk_low_usd: number;
  jk_high_usd: number;
  young_implied_usd: number;
  twin_implied_usd: number;
  twin_disagreement: number;
  extrapolated: boolean;
  rank_median: number;
  rank_p10: number;
  rank_p90: number;
  p_top20: number;
  p_launch: number;
  ev_base_usd: number;
  ev_low_usd: number;
  cost_total_usd: number;
  break_even_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  ev_stress_usd: number;
  verdict_stress: 'FARM' | 'THIN' | 'SKIP';
  farm_steps: string[];
}

/** A tokened peer the dashboard's live view and detail pages draw on. */
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

/** The launch base rates the snapshot itself shows: tokened share per age bucket. */
export interface BaseRateBucket {
  label: string;
  protocols: number;
  tokened: number;
  p_launch: number;
}

/** Everything the dashboard needs: the board, the comps, the fit, its grades, and the live set. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  fit: FittedModel;
  backtest: BacktestStats;
  farm: FarmConstants;
  gas_usd: Record<string, number>;
  gas_default_usd: number;
  base_rates: BaseRateBucket[];
  /** The board-wide stress test: how many FARM verdicts survive a 3% community allocation. */
  stress: { alloc: number; farm_at_base: number; farm_at_stress: number };
  protocols_size: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  comps: CompRow[];
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
const round2 = (n: number): number => Math.round(n * 100) / 100;

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

/** The q-quantile of a sorted list, nearest-rank. */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const at = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[at]!;
}

const sortedNums = (xs: number[]): number[] => xs.slice().sort((a, b) => a - b);

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

/** The feature vector the fit prices from: size, winsorised growth, and age with no token. */
export function featuresOf(tvl: number, change7d: number | null, age: number | null): [number, number, number] {
  const growth = Math.min(300, Math.max(-90, finite(change7d, 0)));
  const ageForModel = age ?? 365;
  return [Math.log10(Math.max(tvl, 1)), Math.asinh(growth / 50), Math.log10(1 + Math.max(0, ageForModel))];
}

/** Solve a small dense linear system by Gaussian elimination with partial pivoting. */
function solveLinear(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    const swap = m[col]!;
    m[col] = m[pivot]!;
    m[pivot] = swap;
    const diag = m[col]![col]!;
    if (Math.abs(diag) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r]![col]! / diag;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) m[r]![c] = m[r]![c]! - f * m[col]![c]!;
    }
  }
  return m.map((row, i) => (Math.abs(row[i]!) < 1e-12 ? 0 : row[n]! / row[i]!));
}

/** Least squares of y on [1, x1, x2, x3]: the normal equations, solved directly. */
function ols(xs: [number, number, number][], ys: number[]): [number, number, number, number] {
  const xtx: number[][] = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  const xty: number[] = [0, 0, 0, 0];
  for (let i = 0; i < xs.length; i++) {
    const v = [1, xs[i]![0], xs[i]![1], xs[i]![2]];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) xtx[r]![c] = xtx[r]![c]! + v[r]! * v[c]!;
      xty[r] = xty[r]! + v[r]! * ys[i]!;
    }
  }
  const s = solveLinear(xtx, xty);
  return [s[0]!, s[1]!, s[2]!, s[3]!];
}

/** Per-category residual medians, shrunk toward zero by empirical-Bayes weights. */
function shrunkEffects(cats: (string | null)[], residuals: number[]): Record<string, number> {
  const byCat = new Map<string, number[]>();
  for (let i = 0; i < cats.length; i++) {
    const key = cats[i] ?? '';
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key)!.push(residuals[i]!);
  }
  const medians = new Map<string, number>();
  for (const [key, rs] of byCat) medians.set(key, median(sortedNums(rs)));
  // Within-category spread (sigma^2) and between-category spread (tau^2), method of moments.
  let ssWithin = 0;
  let dfWithin = 0;
  for (const [key, rs] of byCat) {
    const med = medians.get(key)!;
    for (const r of rs) ssWithin += (r - med) * (r - med);
    dfWithin += rs.length - 1;
  }
  const sigma2 = dfWithin > 0 ? ssWithin / dfWithin : 0;
  const keys = [...byCat.keys()];
  const total = cats.length;
  let grand = 0;
  for (const [key, rs] of byCat) grand += medians.get(key)! * rs.length;
  grand = total > 0 ? grand / total : 0;
  let ssBetween = 0;
  let sumN2 = 0;
  for (const [key, rs] of byCat) {
    ssBetween += rs.length * (medians.get(key)! - grand) * (medians.get(key)! - grand);
    sumN2 += rs.length * rs.length;
  }
  const denom = total - sumN2 / Math.max(1, total);
  const tau2 = keys.length > 1 && denom > 0 ? Math.max(0, (ssBetween - (keys.length - 1) * sigma2) / denom) : 0;
  const effects: Record<string, number> = {};
  for (const [key, rs] of byCat) {
    const w = tau2 + sigma2 / rs.length > 0 ? tau2 / (tau2 + sigma2 / rs.length) : 0;
    const e = w * medians.get(key)!;
    if (e !== 0) effects[key] = e;
  }
  return effects;
}

/**
 * The family a category belongs to for pricing. Single categories hold as few as one comp, and
 * on this snapshot their residual medians are indistinguishable from noise (the shrinkage weight
 * estimates to zero), so effects are estimated per family, where each group holds enough comps
 * for its median to mean something. The mapping is by the category's own words, stated here.
 */
export function familyOf(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  if (/bridge|staking|staked/.test(c)) return 'Bridges & Staking';
  if (/lend|cdp|collateral/.test(c)) return 'Lending & CDP';
  if (/dex|swap|derivat|perpetual|option/.test(c)) return 'Trading & Derivatives';
  if (/yield|basis|curator|index|farm|vault|allocator/.test(c)) return 'Yield & Vaults';
  if (/rwa|real world/.test(c)) return 'RWA';
  return 'Other';
}

/**
 * Fit the pricing rule to a set of comps: one least-squares line through (size, growth, age).
 * Category and family effects are NOT fitted: the backtest's shrinkage test estimates their
 * weight at zero on this snapshot (see backtestStats), so the model prices every protocol from
 * its own figures alone, whatever its category.
 */
export function fitValueModel(comps: CompRow[]): FittedModel {
  const xs = comps.map((c) => featuresOf(c.tvl_usd, c.change_7d, c.age_days));
  const ys = comps.map((c) => Math.log10(c.mcap_usd));
  const beta = ols(xs, ys);
  return {
    intercept: beta[0],
    on_log_tvl: beta[1],
    on_growth: beta[2],
    on_log_age: beta[3],
    comps: comps.length,
  };
}

/** The model's log10 implied market cap for one protocol's figures, and its parts. */
export function predictLogValue(
  fit: FittedModel,
  tvl: number,
  change7d: number | null,
  age: number | null,
  category: string | null,
): { logValue: number; curveMultiple: number; growthFactor: number; ageFactor: number } {
  const [x1, x2, x3] = featuresOf(tvl, change7d, age);
  void category;
  const logValue = fit.intercept + fit.on_log_tvl * x1 + fit.on_growth * x2 + fit.on_log_age * x3;
  return {
    logValue,
    curveMultiple: Math.pow(10, fit.intercept + fit.on_log_tvl * x1 - x1),
    growthFactor: Math.pow(10, fit.on_growth * x2),
    ageFactor: Math.pow(10, fit.on_log_age * x3),
  };
}

/** Spearman's rank correlation between two equal-length series (average ranks for ties). */
function spearman(a: number[], b: number[]): number {
  const ranks = (xs: number[]): number[] => {
    const order = xs.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const out = new Array<number>(xs.length);
    let i = 0;
    while (i < order.length) {
      let j = i;
      while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) out[order[k]![1]] = avg;
      i = j + 1;
    }
    return out;
  };
  const ra = ranks(a);
  const rb = ranks(b);
  const n = a.length;
  const ma = ra.reduce((s, v) => s + v, 0) / n;
  const mb = rb.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    cov += (ra[i]! - ma) * (rb[i]! - mb);
    va += (ra[i]! - ma) * (ra[i]! - ma);
    vb += (rb[i]! - mb) * (rb[i]! - mb);
  }
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0;
}

/** The comps a snapshot offers: tokened, positively priced, exchanges set aside. */
export function compRows(snapshot: Snapshot): CompRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX')
    .map((p) => {
      const multiple = p.mcap_usd! / p.tvl_usd;
      return {
        slug: p.slug,
        name: p.name,
        symbol: p.symbol,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd!,
        change_7d: p.change_7d,
        age_days: ageDays(snapshot.as_of, p.listed_at),
        fit_eligible: multiple >= 0.002 && multiple <= 20,
      };
    })
    .sort((a, b) => (a.slug < b.slug ? -1 : 1));
}

/**
 * The leave-one-out fits themselves: for each comp, the fit redone without it, and that fit's
 * absolute residual on the held-out comp. One computation feeds the LOO errors, the jackknife+
 * band and the band's coverage, so all three always describe the same fits.
 */
export function leaveOneOutFits(comps: CompRow[]): { fits: FittedModel[]; absResiduals: number[] } {
  const fits: FittedModel[] = [];
  const absResiduals: number[] = [];
  comps.forEach((held, i) => {
    const fit = fitValueModel(comps.filter((_, j) => j !== i));
    fits.push(fit);
    const pred = predictLogValue(fit, held.tvl_usd, held.change_7d, held.age_days, held.category).logValue;
    absResiduals.push(Math.abs(pred - Math.log10(held.mcap_usd)));
  });
  return { fits, absResiduals };
}

/**
 * Leave-one-out over the comps: for each comp, the whole fit redone without it and the held-out
 * protocol priced. Returns the signed log errors, in comp order.
 */
export function leaveOneOutErrors(comps: CompRow[]): number[] {
  return comps.map((held, i) => {
    const rest = comps.filter((_, j) => j !== i);
    const fit = fitValueModel(rest);
    const pred = predictLogValue(fit, held.tvl_usd, held.change_7d, held.age_days, held.category).logValue;
    return pred - Math.log10(held.mcap_usd);
  });
}

/**
 * The jackknife+ interval for one protocol's figures, in log10: the 10th percentile of the
 * leave-one-out predictions shifted down by their own residuals, and the 90th percentile of
 * the same predictions shifted up. A second resampling procedure beside the LOO band: if the
 * two intervals nearly coincide, the band does not hinge on the procedure chosen. Neither
 * interval says anything about the shift between tokened comps and pre-token targets.
 */
export function jackknifeBandLog(
  loo: { fits: FittedModel[]; absResiduals: number[] },
  tvl: number,
  change7d: number | null,
  age: number | null,
  category: string | null,
): { low: number; high: number } {
  const minus: number[] = [];
  const plus: number[] = [];
  loo.fits.forEach((fit, i) => {
    const pred = predictLogValue(fit, tvl, change7d, age, category).logValue;
    minus.push(pred - loo.absResiduals[i]!);
    plus.push(pred + loo.absResiduals[i]!);
  });
  return { low: quantile(sortedNums(minus), 0.1), high: quantile(sortedNums(plus), 0.9) };
}

/** The comps split at their median age: the older half and the younger half (unknown age = 365). */
export function ageSplit(comps: CompRow[]): { older: CompRow[]; younger: CompRow[]; medianAge: number } {
  const ages = sortedNums(comps.map((c) => c.age_days ?? 365));
  const medianAge = median(ages);
  return {
    older: comps.filter((c) => (c.age_days ?? 365) >= medianAge),
    younger: comps.filter((c) => (c.age_days ?? 365) < medianAge),
    medianAge,
  };
}

/** Leave-one-category-out: refit without a whole category and price its members blind. */
export function leaveOneCategoryOutErrors(comps: CompRow[]): number[] {
  const errors: number[] = [];
  const cats = [...new Set(comps.map((c) => c.category ?? ''))];
  for (const cat of cats) {
    const members = comps.filter((c) => (c.category ?? '') === cat);
    if (members.length < 3) continue;
    const fit = fitValueModel(comps.filter((c) => (c.category ?? '') !== cat));
    for (const held of members) {
      const pred = predictLogValue(fit, held.tvl_usd, held.change_7d, held.age_days, held.category).logValue;
      errors.push(pred - Math.log10(held.mcap_usd));
    }
  }
  return errors;
}

/** A deterministic PRNG (mulberry32): the bootstrap's resamples are the same on every run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The robust (median/IQR) standardisation the twin search measures distance with. */
function twinScales(comps: CompRow[]): { mid: [number, number, number]; iqr: [number, number, number] } {
  const cols = [0, 1, 2].map((k) => sortedNums(comps.map((c) => featuresOf(c.tvl_usd, c.change_7d, c.age_days)[k]!)));
  const mid = cols.map((c) => median(c)) as [number, number, number];
  const iqr = cols.map((c) => Math.max(1e-9, quantile(c, 0.75) - quantile(c, 0.25))) as [number, number, number];
  return { mid, iqr };
}

/**
 * The five nearest trading twins of one protocol: nearest in standardised (size, growth, age)
 * space, with a distance discount for sharing its category. Returns the twins and the value
 * their own median Mcap/TVL implies for this TVL.
 */
export function nearestTwins(
  comps: CompRow[],
  tvl: number,
  change7d: number | null,
  age: number | null,
  category: string | null,
  scales?: { mid: [number, number, number]; iqr: [number, number, number] },
): { twins: CompRow[]; twinImplied: number; nearestDistance: number } {
  const s = scales ?? twinScales(comps);
  const x = featuresOf(tvl, change7d, age);
  const dist = (c: CompRow): number => {
    const cx = featuresOf(c.tvl_usd, c.change_7d, c.age_days);
    let d = 0;
    for (let k = 0; k < 3; k++) {
      const z = (x[k]! - cx[k]!) / s.iqr[k];
      d += z * z;
    }
    d = Math.sqrt(d);
    return category !== null && c.category === category ? d * 0.7 : d;
  };
  const ranked = comps
    .map((c) => ({ c, d: dist(c) }))
    .sort((a, b) => a.d - b.d || (a.c.slug < b.c.slug ? -1 : 1));
  const twins = ranked.slice(0, 5).map((r) => r.c);
  const multiples = sortedNums(twins.map((t) => t.mcap_usd / t.tvl_usd));
  return { twins, twinImplied: tvl * median(multiples), nearestDistance: ranked.length > 0 ? ranked[0]!.d : Infinity };
}

/** The whole backtest: LOO, LOCO, the two simpler rivals graded the same way, and the age split. */
export function backtestStats(comps: CompRow[]): BacktestStats {
  const loo = leaveOneOutErrors(comps);
  const looAbs = sortedNums(loo.map(Math.abs));
  const looPreds = comps.map((c, i) => Math.log10(c.mcap_usd) + loo[i]!);
  const loco = leaveOneCategoryOutErrors(comps);
  // Rival 1: the plain median multiple, graded leave-one-out like everything else.
  const ratios = comps.map((c) => c.mcap_usd / c.tvl_usd);
  const medianErrors = comps.map((c, i) => {
    const rest = sortedNums(ratios.filter((_, j) => j !== i));
    return Math.log10(median(rest) * c.tvl_usd) - Math.log10(c.mcap_usd);
  });
  // Rival 2: a size-only line (log cap on log TVL alone), graded the same way.
  const sizeOnlyErrors = comps.map((held, i) => {
    const rest = comps.filter((_, j) => j !== i);
    const xs = rest.map((c) => Math.log10(c.tvl_usd));
    const ys = rest.map((c) => Math.log10(c.mcap_usd));
    const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
    const my = ys.reduce((s, v) => s + v, 0) / ys.length;
    let sxy = 0;
    let sxx = 0;
    for (let k = 0; k < xs.length; k++) {
      sxy += (xs[k]! - mx) * (ys[k]! - my);
      sxx += (xs[k]! - mx) * (xs[k]! - mx);
    }
    const slope = sxx > 0 ? sxy / sxx : 0;
    return my - slope * mx + slope * Math.log10(held.tvl_usd) - Math.log10(held.mcap_usd);
  });
  // The category-effect test: shrink the full fit's residuals per family and see what survives.
  const fullFit = fitValueModel(comps);
  const fullResiduals = comps.map((c) => Math.log10(c.mcap_usd) - predictLogValue(fullFit, c.tvl_usd, c.change_7d, c.age_days, c.category).logValue);
  const famEffects = shrunkEffects(comps.map((c) => familyOf(c.category)), fullResiduals);
  const famMax = Math.max(0, ...Object.values(famEffects).map(Math.abs));
  // Age split: fit on the older half of the comps, measure the signed drift on the younger half.
  const { older, younger } = ageSplit(comps);
  let drift = 0;
  if (older.length >= 10 && younger.length >= 5) {
    const fitOld = fitValueModel(older);
    const errs = younger.map((c) => predictLogValue(fitOld, c.tvl_usd, c.change_7d, c.age_days, c.category).logValue - Math.log10(c.mcap_usd));
    drift = median(sortedNums(errs));
  }
  // The young-cohort fit graded on its own cohort, so its sensitivity values carry their grade.
  const youngLooAbs = younger.length >= 10 ? sortedNums(leaveOneOutErrors(younger).map(Math.abs)) : [];
  const youngMdale = youngLooAbs.length > 0 ? median(youngLooAbs) : 0;
  // Jackknife+ on the comps themselves: each comp's interval from the leave-one-out fits, and
  // how often the interval holds the comp's actual cap.
  const looFits = leaveOneOutFits(comps);
  let jkCovered = 0;
  const jkHalfWidths: number[] = [];
  for (const c of comps) {
    const band = jackknifeBandLog(looFits, c.tvl_usd, c.change_7d, c.age_days, c.category);
    jkHalfWidths.push((band.high - band.low) / 2);
    if (Math.log10(c.mcap_usd) >= band.low && Math.log10(c.mcap_usd) <= band.high) jkCovered++;
  }
  const halfWidth = quantile(looAbs, 0.8);
  const looMdale = median(looAbs);
  return {
    comps: comps.length,
    loo_median_abs_log_error: round4(looMdale),
    loo_typical_factor: round2(Math.pow(10, looMdale)),
    loo_spearman: round4(spearman(looPreds, comps.map((c) => Math.log10(c.mcap_usd)))),
    band_half_width_log: round4(halfWidth),
    band_coverage: round4(loo.filter((e) => Math.abs(e) <= halfWidth).length / Math.max(1, loo.length)),
    loco_median_abs_log_error: round4(loco.length > 0 ? median(sortedNums(loco.map(Math.abs))) : 0),
    loco_rows: loco.length,
    median_multiple_median_abs_log_error: round4(median(sortedNums(medianErrors.map(Math.abs)))),
    size_only_median_abs_log_error: round4(median(sortedNums(sizeOnlyErrors.map(Math.abs)))),
    age_split_drift_log: round4(drift),
    family_effect_max_log: round4(famMax),
    jk_coverage: round4(jkCovered / Math.max(1, comps.length)),
    jk_median_half_width_log: round4(median(sortedNums(jkHalfWidths))),
    young_comps: younger.length,
    young_loo_median_abs_log_error: round4(youngMdale),
    young_unstable: youngMdale > 1.5 * looMdale,
  };
}

/** The snapshot's own launch base rates: the tokened share of all protocols, by age bucket. */
export function baseRates(snapshot: Snapshot): BaseRateBucket[] {
  const bounds: [string, number, number][] = [
    ['under 6 months', 0, 180],
    ['6 to 18 months', 180, 540],
    ['18 to 36 months', 540, 1080],
    ['over 36 months', 1080, Infinity],
  ];
  return bounds.map(([label, lo, hi]) => {
    let n = 0;
    let tok = 0;
    for (const p of snapshot.protocols) {
      const age = ageDays(snapshot.as_of, p.listed_at);
      if (age === null || age < lo || age >= hi) continue;
      n++;
      if (!isPreToken(p)) tok++;
    }
    return { label, protocols: n, tokened: tok, p_launch: round4((tok + 1) / (n + 2)) };
  });
}

/** P(a protocol like this one launches), from the snapshot's base rates with a category tilt. */
export function launchProbability(snapshot: Snapshot, buckets: BaseRateBucket[], p: SnapshotProtocol, age: number | null): number {
  const all = snapshot.protocols;
  const overall = (all.filter((q) => !isPreToken(q)).length + 1) / (all.length + 2);
  let base = overall;
  if (age !== null) {
    const idx = age < 180 ? 0 : age < 540 ? 1 : age < 1080 ? 2 : 3;
    if (buckets[idx] !== undefined && buckets[idx]!.protocols > 0) base = buckets[idx]!.p_launch;
  }
  let tilt = 1;
  if (p.category !== null) {
    const inCat = all.filter((q) => q.category === p.category);
    if (inCat.length >= 5) {
      const catRate = (inCat.filter((q) => !isPreToken(q)).length + 1) / (inCat.length + 2);
      tilt = Math.min(2, Math.max(0.5, catRate / overall));
    }
  }
  return round4(Math.min(0.92, Math.max(0.03, base * tilt)));
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

/** The cheapest gas the protocol's own chains offer, in dollars per contract call. */
function cheapestGas(chains: string[]): number {
  let best = Infinity;
  for (const c of chains) best = Math.min(best, GAS_USD[c] ?? GAS_DEFAULT_USD);
  return best === Infinity ? GAS_DEFAULT_USD : best;
}

/** Whole dollars with thousands separators, locale-free so every run writes the same text. */
function usd(n: number): string {
  const v = Math.round(n);
  return '$' + String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export interface FarmEconomics {
  capital: number;
  hold_days: number;
  gas_total: number;
  opportunity_cost: number;
  time_cost: number;
  cost_total: number;
  share: number;
  ev_base: number;
  ev_low: number;
  break_even: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  /** The same economics re-graded at the stress allocation (3%): EV and verdict under stress. */
  ev_base_stress: number;
  verdict_stress: 'FARM' | 'THIN' | 'SKIP';
}

/** One row's farm economics: expected value against the plan's own costs, and the verdict. */
export function farmEconomics(p: SnapshotProtocol, age: number | null, implied: number, bandLow: number, pLaunch: number): FarmEconomics {
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeks = Math.ceil(hold / 7);
  const txCount = Math.min(16, 4 + weeks);
  const gasTotal = txCount * cheapestGas(p.chains);
  const opportunity = capital * FARM.opportunity_rate * (FARM.horizon_months / 12);
  const hours = 0.9 + weeks / 6;
  const timeCost = hours * FARM.time_usd_per_hour;
  const costTotal = gasTotal + opportunity + timeCost;
  // The farmer's share of the drop: qualifying wallets are estimated from TVL at an average
  // qualifying position of $50,000 (bounded 500 to 100,000 wallets), then tripled for the crowd
  // that arrives once a launch is anticipated (the dilution every large drop on record shows);
  // a farmer who shows up every week for the whole window earns the activity weight (2x) of one
  // qualifying wallet.
  const usersNow = Math.min(FARM.max_users, Math.max(FARM.min_users, Math.round(p.tvl_usd / FARM.avg_position_usd)));
  const users = usersNow * FARM.dilution;
  const share = Math.min(FARM.activity_weight / users, FARM.share_cap);
  const evBase = pLaunch * implied * FARM.alloc_base * share * FARM.realised_factor;
  const evLow = pLaunch * bandLow * FARM.alloc_base * share * FARM.realised_factor;
  const denom = pLaunch * FARM.alloc_base * share * FARM.realised_factor;
  const breakEven = denom > 0 ? costTotal / denom : Infinity;
  const grade = (evB: number, evL: number): FarmEconomics['verdict'] =>
    evL >= costTotal || evB >= FARM.farm_multiple * costTotal ? 'FARM' : evB > costTotal ? 'THIN' : 'SKIP';
  const verdict = grade(evBase, evLow);
  // The stress grade: the same plan at a 3% community allocation instead of the 10% base.
  const evBaseStress = pLaunch * implied * FARM.alloc_stress * share * FARM.realised_factor;
  const evLowStress = pLaunch * bandLow * FARM.alloc_stress * share * FARM.realised_factor;
  const verdictStress = grade(evBaseStress, evLowStress);
  return {
    capital,
    hold_days: hold,
    gas_total: round2(gasTotal),
    opportunity_cost: round2(opportunity),
    time_cost: round2(timeCost),
    cost_total: round2(costTotal),
    share,
    ev_base: Math.round(evBase),
    ev_low: Math.round(evLow),
    break_even: Math.round(Math.min(breakEven, 1e15)),
    verdict,
    ev_base_stress: Math.round(evBaseStress),
    verdict_stress: verdictStress,
  };
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
 * A protocol's farm plan: the six working steps of the earlier radar, each an action with what
 * it costs and how long it takes, plus a seventh that carries the model's verdict — the plan's
 * expected value against its own costs, and the launch value at which it breaks even. Plans are
 * derived from the protocol's own record, and two phrasings are picked by a hash of its slug.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, econ: FarmEconomics, pLaunch: number): string[] {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = econ.capital;
  const hold = econ.hold_days;
  const pick = slugHash(p.slug) % 2;
  const setup =
    pick === 0
      ? `Fund one dedicated wallet with the capital and a little ${chain} gas money, and use that wallet for ${p.name} only. Cost: ${gas} to fund and set up. Time: 10 minutes.`
      : `Use a fresh wallet that holds only what you plan to farm with, and keep its seed phrase offline. Cost: ${gas} for the first funding transaction. Time: 5 minutes.`;
  const weekly =
    pick === 0
      ? `Repeat one qualifying action every week (a deposit, a borrow, a swap or a claim, whichever ${p.name} counts) so the wallet shows a rhythm, not a single burst. Cost: about ${gas} a week. Time: 10 minutes a week.`
      : `Come back once a week and make one small qualifying transaction on ${p.name}; steady weeks count for more than one large day. Cost: about ${gas} a week. Time: 10 minutes a week.`;
  const verdictLine =
    econ.verdict === 'FARM'
      ? `Verdict: FARM. At a ${(pLaunch * 100).toFixed(0)}% launch propensity the plan's expected value is ${usd(econ.ev_base)} against ${usd(econ.cost_total)} of cost, and it breaks even if the launch values at ${usd(econ.break_even)} or more. Cost: nothing further. Time: 2 minutes to read.`
      : econ.verdict === 'THIN'
        ? `Verdict: THIN. The plan's expected value is ${usd(econ.ev_base)} against ${usd(econ.cost_total)} of cost at the centre of the band only; it breaks even if the launch values at ${usd(econ.break_even)} or more. Farm it only with capital that earns yield while it waits. Cost: nothing further. Time: 2 minutes to read.`
        : `Verdict: SKIP. The plan's expected value is ${usd(econ.ev_base)} against ${usd(econ.cost_total)} of cost; it would need a launch value of ${usd(econ.break_even)} or more to break even. Keep it on the watchlist and spend the capital where the verdict is FARM. Cost: nothing. Time: 2 minutes to read.`;
  return [
    setup,
    `${actionFor(p, capital, chain)} Cost: $${capital} of capital plus ${gas}. Time: 15 minutes to set up.`,
    weekly,
    `Hold the position for at least ${hold} days without withdrawing, so the activity appears in more than one weekly snapshot of the protocol. Cost: the $${capital} stays locked in the position. Time: ${hold} days.`,
    `Check ${p.name}'s own points or rewards page from inside its app, and claim only through a link the protocol itself publishes; a claim that asks for a payment first is a scam. Cost: nothing to check, and never pay to claim. Time: 10 minutes.`,
    `Keep a farm log with the wallet address, the dates and the transaction hashes, so the position can be repeated, proven or unwound later. Cost: nothing but the log. Time: 5 minutes.`,
    verdictLine,
  ];
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n, plus everything behind them. */
export function buildBoard(snapshot: Snapshot): {
  board: BoardRow[];
  peers: Record<string, PeerRow[]>;
  globalPeers: PeerRow[];
  comps: CompRow[];
  fit: FittedModel;
  backtest: BacktestStats;
  buckets: BaseRateBucket[];
} {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const rows = [...chosen.values()];

  const comps = compRows(snapshot);
  const fitSet = comps.filter((c) => c.fit_eligible);
  const fit = fitValueModel(fitSet);
  const backtest = backtestStats(fitSet);
  const looFits = leaveOneOutFits(fitSet);
  const { younger } = ageSplit(fitSet);
  const youngFit = younger.length >= 10 ? fitValueModel(younger) : null;
  const buckets = baseRates(snapshot);
  const scales = twinScales(fitSet);
  const compLogTvls = sortedNums(fitSet.map((c) => Math.log10(c.tvl_usd)));
  const compAges = fitSet.map((c) => c.age_days ?? 365);
  const support = {
    minLogTvl: compLogTvls[0]!,
    maxLogTvl: compLogTvls[compLogTvls.length - 1]!,
    maxAge: Math.max(...compAges),
  };

  interface Scored {
    p: SnapshotProtocol;
    age: number | null;
    pred: ReturnType<typeof predictLogValue>;
    implied: number;
    bandLow: number;
    bandHigh: number;
    jkLow: number;
    jkHigh: number;
    youngImplied: number;
    twinImplied: number;
    disagreement: number;
    extrapolated: boolean;
    pLaunch: number;
    econ: FarmEconomics;
  }
  const scoreOne = (p: SnapshotProtocol): Scored => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const pred = predictLogValue(fit, p.tvl_usd, p.change_7d, age, p.category);
    const implied = Math.max(1, Math.round(Math.pow(10, pred.logValue)));
    const { twinImplied, nearestDistance } = nearestTwins(fitSet, p.tvl_usd, p.change_7d, age, p.category, scales);
    const disagreement = Math.max(implied / Math.max(1, twinImplied), twinImplied / Math.max(1, implied));
    const logTvl = Math.log10(Math.max(1, p.tvl_usd));
    const extrapolated = logTvl < support.minLogTvl || logTvl > support.maxLogTvl || (age ?? 365) > support.maxAge || nearestDistance > 2.5;
    const widen = extrapolated || disagreement > 2 ? 1.5 : 1;
    const half = backtest.band_half_width_log * widen;
    const bandLow = Math.max(1, Math.round(Math.pow(10, pred.logValue - half)));
    const bandHigh = Math.round(Math.pow(10, pred.logValue + half));
    const jk = jackknifeBandLog(looFits, p.tvl_usd, p.change_7d, age, p.category);
    const jkLow = Math.max(1, Math.round(Math.pow(10, jk.low)));
    const jkHigh = Math.round(Math.pow(10, jk.high));
    const youngImplied =
      youngFit !== null
        ? Math.max(1, Math.round(Math.pow(10, predictLogValue(youngFit, p.tvl_usd, p.change_7d, age, p.category).logValue)))
        : implied;
    const pLaunch = launchProbability(snapshot, buckets, p, age);
    const econ = farmEconomics(p, age, implied, bandLow, pLaunch);
    return { p, age, pred, implied, bandLow, bandHigh, jkLow, jkHigh, youngImplied, twinImplied: Math.round(twinImplied), disagreement, extrapolated, pLaunch, econ };
  };
  const scored = rows.map(scoreOne);

  // Seeded bootstrap: resample the comps, refit, re-rank; a rank is a distribution, not a decree.
  const REPS = 200;
  const rng = mulberry32(20261114);
  const rankSamples = new Map<string, number[]>(rows.map((p) => [p.slug, []]));
  for (let rep = 0; rep < REPS; rep++) {
    const sample: CompRow[] = [];
    for (let i = 0; i < fitSet.length; i++) sample.push(fitSet[Math.floor(rng() * fitSet.length)]!);
    const repFit = fitValueModel(sample);
    const values = rows.map((p) => ({
      slug: p.slug,
      v: predictLogValue(repFit, p.tvl_usd, p.change_7d, ageDays(snapshot.as_of, p.listed_at), p.category).logValue,
      tvl: p.tvl_usd,
    }));
    values.sort((a, b) => b.v - a.v || b.tvl - a.tvl || (a.slug < b.slug ? -1 : 1));
    values.forEach((r, i) => rankSamples.get(r.slug)!.push(i + 1));
  }

  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  const watch = new Set(snapshot.watchlist);
  const board: BoardRow[] = scored.map((s, i) => {
    const samples = sortedNums(rankSamples.get(s.p.slug)!);
    return {
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
        fitted_multiple: round4(s.implied / s.p.tvl_usd),
        curve_multiple: round4(s.pred.curveMultiple),
        growth_factor: round4(s.pred.growthFactor),
        age_factor: round4(s.pred.ageFactor),
        band_low_usd: s.bandLow,
        band_high_usd: s.bandHigh,
        jk_low_usd: s.jkLow,
        jk_high_usd: s.jkHigh,
        young_implied_usd: s.youngImplied,
        twin_implied_usd: s.twinImplied,
        twin_disagreement: round2(s.disagreement),
        extrapolated: s.extrapolated,
        rank_median: median(samples),
        rank_p10: quantile(samples, 0.1),
        rank_p90: quantile(samples, 0.9),
        p_top20: round4(samples.filter((r) => r <= 20).length / samples.length),
        p_launch: s.pLaunch,
        ev_base_usd: s.econ.ev_base,
        ev_low_usd: s.econ.ev_low,
        cost_total_usd: s.econ.cost_total,
        break_even_usd: s.econ.break_even,
        verdict: s.econ.verdict,
        ev_stress_usd: s.econ.ev_base_stress,
        verdict_stress: s.econ.verdict_stress,
      },
      farm_steps: farmSteps(s.p, s.age, s.econ, s.pLaunch),
    };
  });

  // The dashboard's peer tables: the top trading names of each category the board prices from.
  const peerRow = (c: CompRow): PeerRow => ({ slug: c.slug, name: c.name, symbol: c.symbol, tvl_usd: c.tvl_usd, mcap_usd: c.mcap_usd, multiple: round4(c.mcap_usd / c.tvl_usd) });
  const byMcap = comps.slice().sort((a, b) => b.mcap_usd - a.mcap_usd || (a.slug < b.slug ? -1 : 1));
  const peers: Record<string, PeerRow[]> = {};
  for (const c of byMcap) {
    if (c.category === null) continue;
    if (peers[c.category] === undefined) peers[c.category] = [];
    if (peers[c.category]!.length < 8) peers[c.category]!.push(peerRow(c));
  }
  return { board, peers, globalPeers: byMcap.slice(0, 8).map(peerRow), comps, fit, backtest, buckets };
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
    fitted_multiple: row.model.fitted_multiple,
    curve_multiple: row.model.curve_multiple,
    growth_factor: row.model.growth_factor,
    age_factor: row.model.age_factor,
    band_low_usd: row.model.band_low_usd,
    band_high_usd: row.model.band_high_usd,
    jk_low_usd: row.model.jk_low_usd,
    jk_high_usd: row.model.jk_high_usd,
    young_implied_usd: row.model.young_implied_usd,
    twin_implied_usd: row.model.twin_implied_usd,
    twin_disagreement: row.model.twin_disagreement,
    extrapolated: row.model.extrapolated,
    rank_median: row.model.rank_median,
    rank_p10: row.model.rank_p10,
    rank_p90: row.model.rank_p90,
    p_top20: row.model.p_top20,
    p_launch: row.model.p_launch,
    ev_base_usd: row.model.ev_base_usd,
    ev_low_usd: row.model.ev_low_usd,
    cost_total_usd: row.model.cost_total_usd,
    break_even_usd: row.model.break_even_usd,
    verdict: row.model.verdict,
    ev_stress_usd: row.model.ev_stress_usd,
    verdict_stress: row.model.verdict_stress,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { board, peers, globalPeers, comps, fit, backtest, buckets } = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    fit,
    backtest,
    farm: FARM,
    gas_usd: GAS_USD,
    gas_default_usd: GAS_DEFAULT_USD,
    base_rates: buckets,
    stress: {
      alloc: FARM.alloc_stress,
      farm_at_base: board.filter((r) => r.model.verdict === 'FARM').length,
      farm_at_stress: board.filter((r) => r.model.verdict === 'FARM' && r.model.verdict_stress === 'FARM').length,
    },
    protocols_size: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    comps,
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
