// The token radar's model (radar-3): one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every protocol that meets the house's own no-token rule (the watchlist is the
// floor, never the ceiling): it records no token, and it is not a versioned, wrapped, staked or
// bridged product of one that trades. Protocols that record no token but fail that rule are set
// aside with their reason, never ranked as launches.
//
// Implied value is calibrated, not flat: each category's multiple is the log-median market-cap / TVL
// of the live-token protocols in that category, shrunk toward the global log-median with a prior
// worth three peers, so one traded peer moves the multiple a quarter of the way from the global
// median and fifteen peers move it almost all the way. A category with no traded peers uses the
// global median. Growth, maturity and chain breadth follow the shared arithmetic in
// dashboard/model.js, so the page recomputes exactly what board.json carries.

import { impliedOf, MODEL_DEFAULTS } from '../dashboard/model.js';
import { farmStepsFor } from '../dashboard/farm.js';

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapProtocol {
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
  protocols: SnapProtocol[];
  watchlist: string[];
}

/** One category's calibration: how many traded peers it has, their log-median multiple, and the one used. */
export interface CalibrationEntry {
  category: string;
  peers: number;
  median: number | null;
  used: number;
  source: 'shrunk' | 'global';
}

/** The calibration of every category, plus the global fallback. */
export interface Calibration {
  global: number;
  globalPeers: number;
  byCategory: Record<string, CalibrationEntry>;
  table: CalibrationEntry[];
}

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
  age_days: number | null;
  multiple: number;
  multiple_source: 'shrunk' | 'global';
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  multiple: number;
  multiple_source: 'shrunk' | 'global';
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
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
}

/** A pre-token protocol the board sets aside, and why. */
export interface SetAsideRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  reason: string;
}

/** Everything the dashboard needs: the board, the live set, the calibration and the set-aside list. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: typeof MODEL_DEFAULTS;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  set_aside_size: number;
  total_implied_usd: number;
  global_multiple: number;
  rows: RadarRow[];
  live: LiveRow[];
  calibration: CalibrationEntry[];
  set_aside: SetAsideRow[];
}

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

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

/** The log-median of a non-empty list of positive numbers: the geometric median. Ratios are log-normal, so the median is taken in log space, not on the raw ratios. */
function logMedian(values: number[]): number {
  const logs = values.map((v) => Math.log(v)).sort((a, b) => a - b);
  const mid = Math.floor(logs.length / 2);
  const m = logs.length % 2 === 1 ? logs[mid]! : (logs[mid - 1]! + logs[mid]!) / 2;
  return Math.exp(m);
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * The calibration: for every category, the log-median market-cap / TVL of its live-token protocols
 * (ratios outside (0.001, 50) are discarded as bad records), shrunk toward the global log-median
 * with a prior worth `shrinkage_peers` peers: used = exp((n·ln(category) + k·ln(global)) / (n + k)).
 * One traded peer moves the multiple a quarter of the way from the global median; fifteen peers
 * move it almost all the way. A category with no traded peers is absent here and uses the global
 * median. Every multiple is clamped to [0.05, 2.0].
 */
export function calibrate(protocols: SnapProtocol[]): Calibration {
  const byCat = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of protocols) {
    if (isPreToken(p) || !p.mcap_usd || !p.tvl_usd || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!(ratio > 0.001 && ratio < 50)) continue;
    const key = p.category ?? 'Other';
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key)!.push(ratio);
    all.push(ratio);
  }
  const clamp = (x: number): number => Math.min(MODEL_DEFAULTS.multiple_cap, Math.max(MODEL_DEFAULTS.multiple_floor, x));
  const global = clamp(logMedian(all));
  const k = MODEL_DEFAULTS.shrinkage_peers;
  const byCategory: Record<string, CalibrationEntry> = {};
  const table: CalibrationEntry[] = [];
  for (const [category, ratios] of [...byCat.entries()].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))) {
    const catMedian = logMedian(ratios);
    const used = clamp(Math.exp((ratios.length * Math.log(catMedian) + k * Math.log(global)) / (ratios.length + k)));
    const entry: CalibrationEntry = { category, peers: ratios.length, median: Math.round(catMedian * 1000) / 1000, used, source: 'shrunk' };
    byCategory[category] = entry;
    table.push(entry);
  }
  return { global, globalPeers: all.length, byCategory, table };
}

/** The multiple one protocol is scored with, from its category's calibration. */
export function multipleFor(p: SnapProtocol, cal: Calibration): { multiple: number; source: 'shrunk' | 'global' } {
  const entry = cal.byCategory[p.category ?? 'Other'];
  if (entry !== undefined) return { multiple: entry.used, source: entry.source };
  return { multiple: cal.global, source: 'global' };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a product of another protocol's token, not a launch of their own. */
const DERIVATIVE_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchange names: a protocol beginning with one is the exchange's own product. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Why a pre-token protocol is set aside instead of ranked, or null when it may be ranked. */
export function exclusionReason(p: SnapProtocol): string | null {
  if (VERSIONED.test(p.name)) return 'versioned release of another protocol';
  if (p.category !== null && DERIVATIVE_CATEGORIES.has(p.category)) return `${p.category.toLowerCase()} product of a token that trades`;
  const words = p.name.toLowerCase().match(/[a-z]+/g) ?? [];
  if (words.includes('wrapped')) return 'wrapped product of a token that trades';
  if (words.includes('staked') || words.includes('staking')) return 'staked product of a token that trades';
  if (EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e))) return 'exchange product';
  return null;
}

/** Whether a protocol is one the board may rank: pre-token and not a derivative product. */
export function isRankable(p: SnapProtocol): boolean {
  return isPreToken(p) && exclusionReason(p) === null;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapProtocol[]): Map<string, SnapProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, cal: Calibration): BoardRow[] {
  const chosen = snapshot.protocols.filter(isRankable);
  const scored = chosen.map((p) => {
    const { multiple, source } = multipleFor(p, cal);
    const age = ageDays(snapshot.as_of, p.listed_at);
    const row = {
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      age_days: age,
      multiple,
      multiple_source: source,
      implied_value_usd: 0,
      growth_multiplier: 0,
      maturity_multiplier: 0,
      chain_multiplier: 0,
    };
    const implied = impliedOf(row, MODEL_DEFAULTS, null);
    const growthPct = Math.min(MODEL_DEFAULTS.growth_cap, Math.max(MODEL_DEFAULTS.growth_floor, finite(p.change_7d, 0)));
    const ageForModel = age ?? MODEL_DEFAULTS.unknown_age_days;
    const maturity = MODEL_DEFAULTS.maturity_floor + (Math.min(Math.max(ageForModel, 0), MODEL_DEFAULTS.maturity_days) / MODEL_DEFAULTS.maturity_days) * MODEL_DEFAULTS.maturity_range;
    const chainMult = 1 + MODEL_DEFAULTS.chain_step * Math.min(Math.max(p.chains.length - 1, 0), MODEL_DEFAULTS.chain_max);
    return { p, row, implied, growthPct, maturity, chainMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
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
    token_status: 'pre-token',
    age_days: s.age,
    multiple: s.row.multiple,
    multiple_source: s.row.multiple_source,
    implied_value_usd: s.implied,
    model: {
      base_multiple: s.row.multiple,
      growth_pct: Math.round(s.growthPct * 10000) / 10000,
      growth_multiplier: Math.round((1 + (s.growthPct / 100) * MODEL_DEFAULTS.growth_weight) * 10000) / 10000,
      maturity_multiplier: Math.round(s.maturity * 10000) / 10000,
      chain_multiplier: Math.round(s.chainMult * 10000) / 10000,
      age_days: s.age,
    },
    farm_steps: farmStepsFor({ name: s.p.name, category: s.p.category, chains: s.p.chains, tvl_usd: s.p.tvl_usd, age_days: s.age }),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
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

/** The pre-token protocols the board sets aside, with the reason each one is not a launch. */
export function setAsideRows(snapshot: Snapshot): SetAsideRow[] {
  return snapshot.protocols
    .filter((p) => isPreToken(p) && !isRankable(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      reason: exclusionReason(p) ?? 'not rankable',
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
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    multiple: row.multiple,
    multiple_source: row.multiple_source,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const cal = calibrate(snapshot.protocols);
  const board = buildBoard(snapshot, cal);
  const live = liveRows(snapshot);
  const setAside = setAsideRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: MODEL_DEFAULTS,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    set_aside_size: setAside.length,
    total_implied_usd: board.reduce((n, r) => n + r.implied_value_usd, 0),
    global_multiple: cal.global,
    rows: board.map(radarRow),
    live,
    calibration: cal.table,
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
