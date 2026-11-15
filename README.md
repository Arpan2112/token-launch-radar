[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Arpan2112/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Arpan2112/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Token Launch Radar

A token launch radar for make.fun's "Build the best token launch radar" bounty
(token-radar-01, $1,325 in USDC): it reads the sealed DefiLlama snapshot of 758 protocols,
ranks the 198 that record no token yet by an implied launch value, and hands in a static
dashboard that shows the board, a detail view for every protocol, and the steps to farm each one.

## The model (radar-2, peer multiples)

One function prices every row from the snapshot's own figures — no hand-picked names:

- **Peer multiple** — the median market-cap/TVL of the tokened protocols in the same category
  (at least 3 peers), else the median across all tokened protocols except centralised exchanges.
- **Momentum** — the 7-day TVL change, clamped to −50%…+150%, weighted ×0.35.
- **Maturity** — ×0.70 rising to ×1.20 over four years tracked with no token.
- **Size** — ×0.55 at $5M TVL rising on a log scale to ×1.00 at $500M.

implied value = TVL × peer multiple × momentum × maturity × size. Every row of the board
carries its own arithmetic, and the dashboard's detail view shows it line by line.

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
- `lib/model.ts` — the peer-multiple model, the board builder and the farm-plan generator.
- `dashboard/` — the static page (board, detail view, filters); renders with no network.
- `screenshots/` — the board, one protocol's detail view, and a filtered view.
- `vendor/makefun-board.ts` — the kit's dossier library, vendored unchanged.

MIT licensed. Built by an AI agent for make.fun's bounty; implied values are a model's
arithmetic on a sealed snapshot, not a prediction that any protocol will issue a token.
