// The radar's value arithmetic, shared by main.ts and the page.
//
// One function scores every row, so the number the board shows, the number the page recomputes
// in the detail view and the number board.json carries are the same by construction. The model
// (radar-4) is: implied = TVL x multiple x growth x maturity x chains, where
//   multiple  = the category's shrunk multiple: the log-median market-cap / TVL of the live-token
//                protocols in that category, pulled toward the global log-median with a prior
//                worth shrinkage_peers peers — exp((n·ln(category) + k·ln(global)) / (n + k)) —
//                clamped to [0.05, 2.0]; a category with no traded peers uses the global median
//   growth    = 1 + clamp(change_7d, -60, 40) / 100 x growth_weight. A single week's print is
//                noise: the credit for one hot week is capped at +40%, so a +4000% week cannot
//                more than double a protocol's value, and a -60% week is the worst it can do.
//   maturity  = 0.6 + min(age_days, 1095) / 1095 x 0.4 (age unknown: 365 days)
//   chains    = 1 + 0.05 x ln(chains), capped at 1.25. Breadth is logarithmic: each extra chain
//                reaches fewer new users than the last, so a protocol on 85 chains is worth more
//                than one on 6, but not fourteen times more.
// No protocol name is ever special-cased: the same function scores every row.

/** The model's constants, as the dashboard states them and the sandbox may scale them. */
export const MODEL_DEFAULTS = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 40,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  multiple_floor: 0.05,
  multiple_cap: 2.0,
  shrinkage_peers: 3,
  chain_log_step: 0.05,
  chain_cap: 1.25,
};

/** A growth figure clamped to the model's band; null or non-finite growth counts as zero. */
export function clampGrowth(pct, model) {
  const raw = pct === null || pct === undefined || !Number.isFinite(pct) ? 0 : pct;
  return Math.min(model.growth_cap, Math.max(model.growth_floor, raw));
}

/** A protocol's age in days, or the model's unknown-age fallback. */
export function ageFor(row, model) {
  return row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
}

/** The chain-breadth multiplier: 1.00 on one chain, 1.09 on six, 1.12 on eleven, 1.22 on eighty-five. */
export function chainMultiplier(row, model) {
  const n = Array.isArray(row.chains) ? row.chains.length : 0;
  if (n <= 1) return 1;
  return Math.min(model.chain_cap, 1 + model.chain_log_step * Math.log(n));
}

/** The implied value of one row. `sandbox` may scale the multiple and override the growth weight. */
export function impliedOf(row, model, sandbox) {
  const multiple = row.multiple * (sandbox && sandbox.baseScale ? sandbox.baseScale : 1);
  const weight = sandbox && typeof sandbox.growthWeight === 'number' ? sandbox.growthWeight : model.growth_weight;
  const growthMult = 1 + (clampGrowth(row.change_7d, model) / 100) * weight;
  const age = ageFor(row, model);
  const maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const value = row.tvl_usd * multiple * growthMult * maturity * chainMultiplier(row, model);
  return Math.max(1, Math.round(value));
}

/** Every factor behind one row's implied value, for the detail view. */
export function factorsOf(row, model, sandbox) {
  const multiple = row.multiple * (sandbox && sandbox.baseScale ? sandbox.baseScale : 1);
  const weight = sandbox && typeof sandbox.growthWeight === 'number' ? sandbox.growthWeight : model.growth_weight;
  const growth = clampGrowth(row.change_7d, model);
  const growthMult = 1 + (growth / 100) * weight;
  const age = ageFor(row, model);
  const maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainMult = chainMultiplier(row, model);
  return {
    multiple,
    multipleSource: row.multiple_source || 'global',
    growthPct: growth,
    growthRaw: row.change_7d === null || row.change_7d === undefined ? null : row.change_7d,
    growthMultiplier: growthMult,
    ageDays: age,
    ageKnown: row.age_days !== null && row.age_days !== undefined,
    maturityMultiplier: maturity,
    chainMultiplier: chainMult,
    chainCount: Array.isArray(row.chains) ? row.chains.length : 0,
    implied: impliedOf(row, model, sandbox),
  };
}
