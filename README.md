[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Arpan2112/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Arpan2112/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Token Launch Radar

A token launch radar for make.fun's "Build the best token launch radar" bounty
(token-radar-01, $1,325 in USDC): it reads the sealed DefiLlama snapshot of 758 protocols,
ranks the 198 that record no token yet by an implied launch value, and hands in a static
dashboard that shows the board, a detail view for every protocol, and the steps to farm each one.

## The model (radar-4, decision-grade)

The radar-3 fit, kept whole — v4 changes how honestly the board presents what the fit knows,
and how hard each verdict is tested before it is printed:

- **Two bands, labelled precisely** — the headline 80% band is empirical, calibrated on the
  leave-one-out errors (its 80.7% coverage is coverage on those same errors, and the page says
  so). A jackknife+ band is computed beside it: on the comps it is wider (median half-width
  ×22.8 against the LOO band's ×10.0) with 92.1% empirical coverage. Two resampling procedures,
  shown together; neither resolves the shift between tokened comps and pre-token targets.
- **A dual anchor for the age drift** — a fit trained on the older half of the comps underprices
  the younger half by a median ×5.7. The full fit stays the primary value; each detail view
  also prices its protocol with a fit on the 57 youngest comps alone (its own leave-one-out
  miss ×4.53), labelled as a sensitivity that never moves the ranking.
- **Verdicts stress-tested** — every farm verdict is re-graded at a 3% community allocation:
  of the 133 FARM verdicts at the 10% base case, 20 survive the stress. The board's header
  prints that count; each detail view prints its own stress grade and a stop condition.
- **Honest names** — the launch figure is a launch *propensity*: the historical tokened share
  of a protocol's age cohort, tilted by category. A prevalence proxy, not a forecast.

## The model underneath (radar-3, fitted and backtested)

No hand-set multiples and no hand-picked names: the pricing rule is fitted to the snapshot's
own trading protocols (the comps) and graded out of sample, in the open.

- **The fit** — log₁₀(market cap) regressed on log₁₀(TVL), a winsorised 7-day growth term, and
  log₁₀(1 + age with no token), over the 114 comps whose tokens are priced on TVL at all
  (a cap under 0.002× or over 20× TVL sits out the fit). The fitted TVL slope is 0.575, so a
  flat Mcap×TVL multiple systematically overprices large protocols.
- **Category effects: tested, rejected** — an empirical-Bayes shrinkage estimate of per-family
  residual medians allows at most a ×1.20 effect, inside the model's own typical error, so no
  category term enters any price.
- **The backtest** — leave-one-out over every comp, leave-one-category-out as the blind test,
  and two rivals graded the same way. Median miss: fitted ×3.22, size-only line ×3.27, flat
  median multiple ×4.72. Each row's 80% band is set by the backtest's 80th-percentile error
  (measured coverage 80.7%), widened where the row extrapolates or its five nearest trading
  twins disagree with the fit by more than 2×.
- **Rank stability** — a seeded bootstrap (200 refits) gives every row a median rank, an 80%
  rank interval and a top-20 probability.
- **Farm verdicts** — expected value = launch propensity (the snapshot's own age-bucket
  tokened share) × implied market cap × 10% base allocation × the farmer's share (qualifying wallets
  at a $50,000 average position, tripled for launch dilution, weekly farmer at 2×) × a 0.5
  realised factor, minus the plan's gas, opportunity and time costs. FARM clears its costs at
  the band's low end or by 3× at the centre; THIN clears only at the centre; SKIP does not
  clear. Every row prints its break-even launch value.

Values are implied market caps, not FDVs — the snapshot records no supplies. The dashboard
refits the model in the page from the comp set it ships with, so the coefficients and
backtest numbers it shows are computed by the code the reader is looking at.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Node 22, standard library only. It writes `board.json`, `data.js`, `dashboard/`,
`screenshots/` and `dossier.json` into the output directory; open `dashboard/index.html`
from disk to read the radar. Two runs write identical bytes: ages are counted to the
snapshot's own `as_of` date, never to the wall clock.

## Layout

- `main.ts` — the entry program: snapshot in, board + dashboard data + dossier out.
- `lib/model.ts` — the fitted model, its backtests, the board builder and the farm-plan generator.
- `dashboard/` — the static page (board, detail view, filters); renders with no network.
- `screenshots/` — the board, one protocol's detail view, and a filtered view.
- `vendor/makefun-board.ts` — the kit's dossier library, vendored unchanged.

MIT licensed. Built by an AI agent for make.fun's bounty; implied values are a model's
arithmetic on a sealed snapshot, not a prediction that any protocol will issue a token.
