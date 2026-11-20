// radar-5: the token launch radar's model. One sealed snapshot in, one ranked board out.
//
// The board ranks every protocol that records no token and is not a wrapped, staked, bridged or
// versioned product of one that trades: the snapshot's 40-protocol watchlist (the floor) plus every
// other pre-token protocol that passes the same no-token rule, down to the snapshot's $5M TVL cut.
// Protocols that record a token are never ranked; they calibrate the model and sit in their own
// live view. Pre-token protocols the rule sets aside are listed with their reason, never dropped
// silently.
//
// Implied value is derived only from the snapshot's own figures:
//
//   implied = TVL x base x growth x maturity x chains
//
//   base      the category's market-cap / TVL multiple, calibrated on the live-token protocols in
//             that category (log-median, shrunk toward the global log-median with a prior worth
//             3 peers), clamped to [0.05, 2.0]. A category with no traded peers uses the global
//             median. The p25-p75 band of the same peer set gives each row's value band.
//   growth    1 + clamp(change_7d, -60, 40) / 100 x 0.5. The cap is 40, not the starter's 120: a
//             one-week spike past +40% is mostly noise and must not dominate a launch estimate.
//   maturity  0.6 + min(age_days, 1095) / 1095 x 0.4 (age unknown: 365 days). A protocol that has
//             run three years with no token is a likelier launch than one listed last month.
//   chains    1 + 0.10 x ln(chain count). Reach across chains is worth something, with diminishing
//             returns: the second chain matters more than the eleventh.
//
// No protocol name is ever special-cased: the same function scores every row.

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

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_weight: number;
  prior_peers: number;
  multiple_min: number;
  multiple_max: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 40,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_weight: 0.1,
  prior_peers: 3,
  multiple_min: 0.05,
  multiple_max: 2.0,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-5';

/** How many live-token protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 30;

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol records a token with a market cap: a calibration peer. */
export function isLivePeer(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && (p.gecko_id !== null || p.symbol !== null);
}

// ---------------------------------------------------------------- calibration

/** One category's traded-peer multiples: count, log-median and the p25-p75 band. */
export interface CategoryCalibration {
  category: string;
  peers: number;
  median: number;
  p25: number;
  p75: number;
  base: number;
}

/** The whole calibration: the global peer multiples and one row per category that has peers. */
export interface Calibration {
  global_peers: number;
  global_median: number;
  global_p25: number;
  global_p75: number;
  by_category: Map<string, CategoryCalibration>;
}

/** A quantile of a sorted array, nearest-rank. */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const at = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[at]!;
}

/** The median of log values, back in linear space. */
function logMedian(values: number[]): number {
  const logs = values.map((v) => Math.log(v)).sort((a, b) => a - b);
  return Math.exp(quantile(logs, 0.5));
}

/**
 * Calibrate market-cap / TVL multiples on the snapshot's live-token protocols. Each category's
 * base multiple is its log-median shrunk toward the global log-median with a prior worth
 * `prior_peers` peers, so one traded peer moves the multiple a quarter of the way and fifteen
 * peers move it almost all the way. Clamped to [multiple_min, multiple_max].
 */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): Calibration {
  const peers = snapshot.protocols.filter(isLivePeer);
  const all = peers.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  const globalMedian = all.length > 0 ? logMedian(all) : 0.25;
  const globalP25 = all.length > 0 ? quantile(all, 0.25) : globalMedian;
  const globalP75 = all.length > 0 ? quantile(all, 0.75) : globalMedian;
  const byCategory = new Map<string, CategoryCalibration>();
  const grouped = new Map<string, number[]>();
  for (const p of peers) {
    const key = p.category ?? 'Uncategorised';
    const list = grouped.get(key) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    grouped.set(key, list);
  }
  for (const [category, values] of grouped) {
    const sorted = [...values].sort((a, b) => a - b);
    const median = logMedian(sorted);
    const n = sorted.length;
    const shrink = (v: number, global: number): number => Math.exp((n * Math.log(v) + model.prior_peers * Math.log(global)) / (n + model.prior_peers));
    byCategory.set(category, {
      category,
      peers: n,
      median,
      // The band's quartiles shrink the same way as the median: with one peer, a raw p25-p75 is a
      // single point and the band would be a lie; shrunk, it widens toward the global spread.
      p25: shrink(quantile(sorted, 0.25), globalP25),
      p75: shrink(quantile(sorted, 0.75), globalP75),
      base: Math.min(model.multiple_max, Math.max(model.multiple_min, shrink(median, globalMedian))),
    });
  }
  return { global_peers: peers.length, global_median: globalMedian, global_p25: globalP25, global_p75: globalP75, by_category: byCategory };
}

/** The base multiple and band for one category: its own calibration, else the global figures. */
export function categoryBase(calib: Calibration, category: string | null, model: ModelConstants = MODEL): { base: number; p25: number; p75: number; peers: number } {
  const row = calib.by_category.get(category ?? 'Uncategorised');
  if (row !== undefined) return { base: row.base, p25: row.p25, p75: row.p75, peers: row.peers };
  return {
    base: Math.min(model.multiple_max, Math.max(model.multiple_min, calib.global_median)),
    p25: calib.global_p25,
    p75: calib.global_p75,
    peers: 0,
  };
}

// ---------------------------------------------------------------- implied value

/** One protocol's model output: the implied value, its band, and every multiplier behind it. */
export interface Scored {
  implied: number;
  band_lo: number;
  band_hi: number;
  multiple: number;
  base_multiple: number;
  growth_pct: number;
  growth_mult: number;
  maturity_mult: number;
  chain_mult: number;
  age: number | null;
  peers: number;
}

/** Score one protocol under the model: TVL x base x growth x maturity x chains, with a p25-p75 band. */
export function impliedValue(p: SnapshotProtocol, asOf: string, calib: Calibration, model: ModelConstants = MODEL): Scored {
  const age = ageDays(asOf, p.listed_at);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(p.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainMult = 1 + model.chain_weight * Math.log(Math.max(1, p.chains.length));
  const { base, p25, p75, peers } = categoryBase(calib, p.category, model);
  const rest = growthMult * maturityMult * chainMult;
  const implied = Math.max(1, Math.round(p.tvl_usd * base * rest));
  const bandLo = Math.max(1, Math.round(p.tvl_usd * Math.min(p25, base) * rest));
  const bandHi = Math.max(implied, Math.round(p.tvl_usd * Math.max(p75, base) * rest));
  return {
    implied,
    band_lo: bandLo,
    band_hi: bandHi,
    multiple: p.tvl_usd > 0 ? implied / p.tvl_usd : 0,
    base_multiple: base,
    growth_pct: growthPct,
    growth_mult: growthMult,
    maturity_mult: maturityMult,
    chain_mult: chainMult,
    age,
    peers,
  };
}

// ---------------------------------------------------------------- board membership

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A name that begins with an exchange's name is that exchange's product, not a launch candidate. */
const EXCHANGE_NAMED = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
/** A wrapped or staked product of a token that trades is not a token that does not exist yet. */
const WRAPPED_OR_STAKED = /\b(wrapped|staked|staking)\b/i;
/** Categories that are products of other tokens or of an exchange, per the watchlist's own rule. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Why a pre-token protocol is set aside rather than ranked, or null when it is rankable. */
export function setAsideReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return `${p.category} product`;
  if (VERSIONED.test(p.name)) return 'versioned release of another protocol';
  if (EXCHANGE_NAMED.test(p.name)) return 'exchange-named product';
  if (WRAPPED_OR_STAKED.test(p.name)) return 'wrapped or staked product';
  return null;
}

/** A pre-token protocol the radar sets aside, with the reason. */
export interface SetAsideRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  reason: string;
}

/** A traded peer shown beside a ranked protocol: same category, nearest TVL. */
export interface PeerRow {
  slug: string;
  name: string;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
}

/** The three live-token protocols in the same category with the nearest TVL, by log distance. */
export function closestPeers(p: SnapshotProtocol, snapshot: Snapshot): PeerRow[] {
  const mine = Math.log(Math.max(1, p.tvl_usd));
  return snapshot.protocols
    .filter((q) => isLivePeer(q) && (q.category ?? 'Uncategorised') === (p.category ?? 'Uncategorised'))
    .sort((a, b) => Math.abs(Math.log(Math.max(1, a.tvl_usd)) - mine) - Math.abs(Math.log(Math.max(1, b.tvl_usd)) - mine) || (a.slug < b.slug ? -1 : 1))
    .slice(0, 3)
    .map((q) => ({ slug: q.slug, name: q.name, tvl_usd: q.tvl_usd, mcap_usd: q.mcap_usd!, multiple: q.mcap_usd! / q.tvl_usd }));
}

// ---------------------------------------------------------------- farm plans

/** Rough per-transaction gas in US dollars, by chain, as the dashboard states them. Estimates, not quotes. */
export const CHAIN_GAS_USD: Record<string, number> = {
  Solana: 0.01,
  Base: 0.05,
  Polygon: 0.05,
  Fantom: 0.05,
  'Hyperliquid L1': 0.05,
  Monad: 0.05,
  Arbitrum: 0.1,
  Optimism: 0.1,
  Binance: 0.1,
  'BNB Smart Chain': 0.1,
  Avalanche: 0.2,
  Tron: 0.3,
  Bitcoin: 1.5,
  Ethereum: 3.0,
};

/** The gas estimate for a chain the table does not name. */
export const DEFAULT_GAS_USD = 0.5;

/** The cheapest chain a protocol runs on, by the gas table, and that estimate. */
export function cheapestChain(p: SnapshotProtocol): { chain: string; gas_usd: number } {
  let best = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  let bestGas = CHAIN_GAS_USD[best] ?? DEFAULT_GAS_USD;
  for (const c of p.chains) {
    const g = CHAIN_GAS_USD[c] ?? DEFAULT_GAS_USD;
    if (g < bestGas) {
      best = c;
      bestGas = g;
    }
  }
  return { chain: best, gas_usd: bestGas };
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 100;
  if (p.tvl_usd >= 10_000_000) return 50;
  return 25;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main position, in the words a farmer can follow. */
function mainAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow a small amount against it and repay it the same week.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('aggregator')) return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and stake the LP position if the app offers it.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC through ${name} to ${chain}, then use the bridged funds in one of its connected apps.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the liquid receipt in the same wallet.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis')) return `Deposit $${capital} of USDC as margin on ${name}, open one small delta-neutral hedge, and close it after a week.`;
  if (c.includes('prediction')) return `Fund the wallet with $${capital} and take one small position in ${name}'s most active market.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares in the same wallet.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the wallet.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield asset on ${chain} and hold it in the wallet.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('nft')) return `Buy one floor item from ${name} on ${chain} for up to $${capital} and list it back near the floor.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's weekly qualifying action. */
function weeklyAction(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp')) return 'a small supply, borrow or repay';
  if (c.includes('dex') || c.includes('yield')) return 'a swap through the pool or a small liquidity top-up';
  if (c.includes('bridge')) return 'a small bridge transfer in either direction';
  if (c.includes('staking') || c.includes('restak')) return 'a small additional stake or a claim of accrued rewards';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis')) return 'one small trade opened and closed';
  if (c.includes('curator') || c.includes('allocator')) return 'a small vault deposit or withdrawal';
  return 'a deposit, a swap or a vote, whichever the app counts';
}

/** The category's main risk, stated plainly. */
function riskNote(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp')) return 'a borrowed position can be liquidated if the collateral falls; keep the borrow small against the supply.';
  if (c.includes('dex') || c.includes('yield')) return 'liquidity can lose value to impermanent loss if the pair drifts apart; a stable pair limits it.';
  if (c.includes('bridge')) return 'bridged funds carry bridge risk while they are in transit; move only the farming amount.';
  if (c.includes('staking') || c.includes('restak')) return 'a staked position can be slashed and the receipt can trade below the underlying; size it as risk capital.';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis')) return 'margin positions can be liquidated; keep leverage at 1x and the hedge small.';
  if (c.includes('stable')) return 'a minted stable asset can depeg; watch its price before adding more.';
  return 'any position can lose value to a contract bug or a market fall; farm only what you can leave untouched.';
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL, age) and run on its cheapest chain. Never a
 * hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): { steps: FarmStep[]; chain: string; gas_usd: number; capital: number; hold_days: number } {
  const { chain, gas_usd } = cheapestChain(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gas_usd < 0.1 ? 'under $0.10' : `about $${gas_usd.toFixed(2)}`;
  const steps: FarmStep[] = [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm with, and keep its seed phrase offline. Fund it on ${chain}, ${p.name}'s cheapest chain by gas.`,
      cost: `${gas} of gas for the first transaction`,
      time: '5 minutes',
    },
    {
      text: mainAction(p, capital, chain),
      cost: `$${capital} of capital and ${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Once a week, make one qualifying action on ${p.name}: ${weeklyAction(p)}. Spread the actions across different days, not in one burst.`,
      cost: `${gas} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: p.chains.length > 1
        ? `Repeat a smaller version of the position on a second chain ${p.name} runs on, so the activity is not tied to one chain's snapshot.`
        : `Keep the whole position on ${chain}; ${p.name} records no second chain, so depth beats spread here.`,
      cost: p.chains.length > 1 ? `about $${Math.round(capital / 2)} more capital` : 'no extra capital',
      time: p.chains.length > 1 ? '15 minutes' : 'nothing',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot, and do not withdraw and redeposit in the same week.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Keep one wallet per person and do not split the position across wallets to multiply it: most eligibility rules count that as one farmer or exclude it.`,
      cost: 'nothing',
      time: 'a minute of care',
    },
    {
      text: `Know the risk before you add more: ${riskNote(p)}`,
      cost: 'nothing to read',
      time: '5 minutes',
    },
    {
      text: `When ${p.name} publishes a points, rewards or claim page, reach it only from the link on the protocol's own site, never from a search ad or a message. Write the wallet, the dates and every transaction in a farm log.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
  ];
  return { steps, chain, gas_usd, capital, hold_days: hold };
}

// ---------------------------------------------------------------- the board

/** One row of board.json: the ranked board's row. */
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
  band_lo_usd: number;
  band_hi_usd: number;
  multiple: number;
  tier: string;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    peer_count: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one row: the board row plus its peers and structured farm plan. */
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
  band_lo_usd: number;
  band_hi_usd: number;
  multiple: number;
  tier: string;
  base_multiple: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  peer_count: number;
  peers: PeerRow[];
  farm: { chain: string; gas_usd: number; capital: number; hold_days: number; steps: FarmStep[] };
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  protocol_count: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  set_aside_size: number;
  live_size: number;
  calibration: { global_peers: number; global_median: number; global_p25: number; global_p75: number; categories: CategoryCalibration[] };
  rows: RadarRow[];
  live: LiveRow[];
  set_aside: SetAsideRow[];
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The tier of a rank in a board of `total`: S the top 5%, A to 20%, B to 50%, C the rest. */
export function tierOf(rank: number, total: number): string {
  const share = rank / Math.max(1, total);
  if (share <= 0.05) return 'S';
  if (share <= 0.2) return 'A';
  if (share <= 0.5) return 'B';
  return 'C';
}

/** The protocols the board ranks, strongest first, with ranks 1..n, plus the set-aside list. */
export function buildBoard(snapshot: Snapshot, calib: Calibration, model: ModelConstants = MODEL): { board: BoardRow[]; setAside: SetAsideRow[] } {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watchlist = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other pre-token protocol that passes the no-token rule, down to the
  // snapshot's $5M TVL cut. The rest are set aside with their reason.
  const setAside: SetAsideRow[] = [];
  for (const p of snapshot.protocols) {
    if (chosen.has(p.slug) || !isPreToken(p)) continue;
    const reason = setAsideReason(p);
    if (reason === null) chosen.set(p.slug, p);
    else setAside.push({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, reason });
  }
  setAside.sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));

  const scored = [...chosen.values()].map((p) => ({ p, s: impliedValue(p, snapshot.as_of, calib, model) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board = scored.map(({ p, s }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token' as const,
    watchlist: watchlist.has(p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    band_lo_usd: s.band_lo,
    band_hi_usd: s.band_hi,
    multiple: round4(s.multiple),
    tier: tierOf(i + 1, scored.length),
    model: {
      base_multiple: round4(s.base_multiple),
      growth_pct: s.growth_pct,
      growth_multiplier: round4(s.growth_mult),
      maturity_multiplier: round4(s.maturity_mult),
      chain_multiplier: round4(s.chain_mult),
      peer_count: s.peers,
      age_days: s.age,
    },
    farm_steps: farmSteps(p, s.age).steps.map(stepText),
  }));
  return { board, setAside };
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
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
      multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const calib = calibrate(snapshot, model);
  const { board, setAside } = buildBoard(snapshot, calib, model);
  const live = liveRows(snapshot);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const rows: RadarRow[] = board.map((row) => {
    const p = index.get(row.slug)!;
    const farm = farmSteps(p, row.age_days);
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
      band_lo_usd: row.band_lo_usd,
      band_hi_usd: row.band_hi_usd,
      multiple: row.multiple,
      tier: row.tier,
      base_multiple: row.model.base_multiple,
      growth_pct: row.model.growth_pct,
      growth_multiplier: row.model.growth_multiplier,
      maturity_multiplier: row.model.maturity_multiplier,
      chain_multiplier: row.model.chain_multiplier,
      peer_count: row.model.peer_count,
      peers: closestPeers(p, snapshot),
      farm: { chain: farm.chain, gas_usd: farm.gas_usd, capital: farm.capital, hold_days: farm.hold_days, steps: farm.steps },
    };
  });
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    protocol_count: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.watchlist).length,
    set_aside_size: setAside.length,
    live_size: live.length,
    calibration: {
      global_peers: calib.global_peers,
      global_median: round4(calib.global_median),
      global_p25: round4(calib.global_p25),
      global_p75: round4(calib.global_p75),
      categories: [...calib.by_category.values()]
        .sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1))
        .map((c) => ({ category: c.category, peers: c.peers, median: round4(c.median), p25: round4(c.p25), p75: round4(c.p75), base: round4(c.base) })),
    },
    rows,
    live,
    set_aside: setAside,
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

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
