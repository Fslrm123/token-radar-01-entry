# Token Radar

A token launch radar: it reads a sealed snapshot of every protocol DefiLlama tracks, finds
the ones that record no token and are not a wrapped, staked or bridged product of one that
trades, ranks them by what their launch would be worth, and hands in a web dashboard with the
board, a detail view for each protocol and the steps to farm it.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

Node 22, standard library only, no network. It writes `board.json`, `data.js`,
`dashboard/`, `screenshots/` and `dossier.json` to the output directory. Two runs on the
same snapshot write the same bytes.

## The model (radar-3)

`implied = TVL x multiple x growth x maturity x chains`, where:

- **multiple** — the category's shrunk multiple: the log-median market-cap / TVL of the
  live-token protocols in that category, pulled toward the global log-median with a prior
  worth 3 peers — `exp((n·ln(category) + 3·ln(global)) / (n + 3))`. One traded peer moves
  the multiple a quarter of the way from the global median; fifteen peers move it almost
  all the way. A category with no traded peers uses the global median. Clamped to
  [0.05, 2.0]. This replaced radar-2's hard rule (fewer than three peers fell back to the
  global median outright), which left 102 of 198 rows — including the board's top row —
  priced on a flat fallback.
- **growth** — `1 + clamp(change_7d, -60, 120) / 100 x 0.5`.
- **maturity** — `0.6 + min(age_days, 1095) / 1095 x 0.4` (age unknown: 365 days).
- **chains** — `1 + 0.02 x min(chains - 1, 5)`.

No protocol name is special-cased: the same function scores every row. The value
arithmetic lives in `dashboard/model.js` and the farm-plan derivation in
`dashboard/farm.js`; `main.ts` scores `board.json` with those same files, so the page, the
board and the code agree by construction.

## The board

198 rows on the 2026-11-14 snapshot: all 40 watchlist protocols plus 158 pre-token
protocols below the $50M floor that meet the same no-token rule. 144 protocols that record
no token are set aside, not ranked: versioned releases, bridge / liquid-staking /
restaking / exchange products, wrapped or staked products, and exchange-named products.
The dashboard lists them with their reason.

## The dashboard

`dashboard/` is a static page with no network: `index.html`, `app.css`, `app.js`,
`model.js` and `farm.js` read `data.js` beside it. It has a sortable, filterable board
(search, category, chain), a live-token tab, a detail view per protocol (model breakdown
with the traded-peer basis of its multiple, farm plan), a model sandbox that re-ranks the
board live, a category breakdown, and the full methodology: the calibration table, the
set-aside list and the caveats. Each farm plan has nine steps — the main position, a
category-specific weekly action, the hold, the second chain, the eligibility rules, the
risk, the claim and the log — every step with its cost and time. Screenshots live in
`screenshots/`.

## Files

- `main.ts` — the entrypoint
- `lib/model.ts` — snapshot parsing, calibration, board build, gate check
- `dashboard/` — the page (`model.js` and `farm.js` are shared with `main.ts`)
- `vendor/makefun-board.ts` — make.fun's dossier library, copied byte for byte from the kit
- `screenshots/` — the board, a detail view and a filtered view
- `README.md` — this file
