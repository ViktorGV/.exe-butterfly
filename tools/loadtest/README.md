# loadtest

Owned by #21: a headless bot swarm that plays the game over the real wire protocol, with pass/fail
thresholds. Where #21 and #48 differ, #48 wins: the headline scenarios are 1 room × 120 bots and
3 rooms × 60 bots, and 300 bots in one room is the stress case.

```bash
bun run loadtest -- --bots 120                            # starts a game server in this process
bun run loadtest -- --url ws://host:8787 --bots 180 --rooms 3 --duration 150 --out report.json
bun run --filter @wobble/loadtest loadtest:smoke          # 50 bots, 30 s: suitable for CI
```

Options: `--url` (omit to start `createGameServer` in-process), `--bots`, `--rooms`, `--duration` (hard
stop, seconds), `--ramp` (new connections per second), `--out` (writes `<out>.json` and a Markdown
summary next to it), `--thresholds` (default `thresholds.json`). The exit code is 1 when any threshold
is violated.

## What a bot does

`hello` (first bot of a room asks for a new room, the rest join its code) → `loaded` on `matchConfig`
→ at the countdown, walks the course line (spawn cell, each checkpoint centre, finish) at 80 % of run
speed with a small sideways wobble, sending `STATE` at `NET_SEND_HZ` → decodes every `SNAPSHOT`.
Each room's first bot presses `start` once everybody has joined. One process, one timer for all bots.

## Metrics and thresholds

Connect success, disconnects, join p95, download and upload KB/s per bot, snapshots per second per bot,
snapshot gap p50/p95/p99 (a fixed 1 ms histogram, so nothing is allocated per message), corrections
received by honest bots (must be 0), finished share, server errors. Limits are in `thresholds.json`.

## Measured (server and bots as separate processes, shared 4-core container)

| Scenario     | Download/bot | Snapshot gap p95 | Corrections | Finished | Bot CPU (user) |
| ------------ | -----------: | ---------------: | ----------: | -------: | -------------: |
| 1 room × 300 |    18.1 KB/s |            68 ms |           0 |     100% |   2.2 s / 42 s |
| 1 room × 120 |    11.5 KB/s |            67 ms |           0 |     100% |   0.9 s / 38 s |
| 3 rooms × 60 |     8.8 KB/s |            68 ms |           0 |     100% |   1.1 s / 37 s |

300 bots use about 5 % of one core, so the test measures the server, not the generator.

## Not done yet

Only the `race` scenario exists. `lobby-churn`, `vote-storm` (needs event mode, #54),
`reconnect-storm`, `slow-consumer` and `cheater` are not implemented, and bots do not jump, fall or
respawn. Server CPU is not read yet because there is no `/metrics` endpoint (#73).
