# token-radar-01-entry

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Fslrm123/token-radar-01-entry/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Fslrm123/token-radar-01-entry/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed snapshot of every protocol DefiLlama tracks, finds the ones that record no token and are not a wrapped, staked or bridged product of one that trades, ranks them by what their launch would be worth, and hands in a web dashboard with the board, a detail view for each protocol and the steps to farm it.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=3v2j7j85&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

---

Node 22, standard library only, no network. It writes `board.json`, `data.js`,
`dashboard/`, `screenshots/` and `dossier.json` to the output directory. Two runs on the
same snapshot write the same bytes.

## The model (radar-5)

`implied = TVL x base x growth x maturity x chains`, where:

- **base** — the category's market-cap / TVL multiple, calibrated on the 128 live-token
  protocols in the snapshot: the log-median of the category's traded peers, shrunk toward
  the global log-median (0.22x) with a prior worth 3 peers, clamped to [0.05, 2.0]. The
  same peer set's p25-p75 (shrunk the same way) gives every row a value band, shown in
  the detail view. A category with no traded peers uses the global figures.
- **growth** — `1 + clamp(change_7d, -60, 40) / 100 x 0.5`. The cap is 40, not the
  starter's 120: a one-week spike past +40% is mostly noise and must not dominate a
  launch estimate.
- **maturity** — `0.6 + min(age_days, 1095) / 1095 x 0.4` (age unknown: 365 days).
- **chains** — `1 + 0.10 x ln(chain count)`: reach across chains is worth something,
  with diminishing returns.

Every row also carries its implied multiple (implied / TVL), a tier (S/A/B/C by rank
share), its three closest traded peers (same category, nearest TVL), and an eight-step
farm plan run on the protocol's cheapest chain by a stated gas table — capital scaled
to the protocol's TVL, hold length scaled to its age, every step with its cost and time.

No protocol name is special-cased: the same function scores every row.

## The board

198 rows on the 2026-11-14 snapshot: all 40 watchlist protocols plus 158 pre-token
protocols that pass the same no-token rule, down to the snapshot's $5M TVL cut. 144
protocols that record no token are set aside, not ranked: versioned releases, bridge /
liquid-staking / restaking / exchange products, wrapped or staked products, and
exchange-named products. The dashboard lists them with their reason.

## The dashboard

`dashboard/` is a static page with no network: `index.html`, `app.css` and `app.js`
read `data.js` beside it. It is a dark trading terminal: a status bar with the
snapshot's headline counts, a dense sortable board (rank, protocol, category, chains,
TVL, 7d change, age, implied value with a bar, multiple, tier), filters for search,
category, chain, implied-value band, tier and watchlist-only, keyboard navigation
(`/` search, arrows, Enter), and a detail panel per protocol with the model breakdown,
the p25-p75 band, the closest traded peers with a canvas chart, and the farm plan.
Tabs switch to the live-token peers, the per-category calibration table, and the
set-aside list. Screenshots live in `screenshots/`.

## Files

- `main.ts` — the entrypoint
- `lib/model.ts` — snapshot parsing, calibration, board build, farm plans, gate check
- `dashboard/` — the terminal page
- `vendor/makefun-board.ts` — make.fun's dossier library, copied byte for byte from the kit
- `screenshots/` — the board, a detail view, a filtered view and a farm plan
- `README.md` — this file
