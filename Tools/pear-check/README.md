# pear-check

Offline "is this game fit to publish" command (plan.md 13.2). No backend, no network.

```
node Tools/pear-check/check.mjs Games/QuickDraw [--full]   # exit 0 = all checks passed; JSON report on stdout
node Tools/pear-check/test.mjs                            # tests (needs `npm install` in Web/ and Tools/pear-mcp/)
```

Steps: (1) schema via `validateGame` in `Tools/pear-mcp/src/devtools.js`; (2) fake-ctx self-check: a generic pass (junk and unknown events, leave, timers) plus the folder's own script named by `selfcheck` in `check.json`; (3) the `scenarios` in `check.json`, run by `sim.ts` on the in-page `LocalServer` with a virtual clock (seeded `Math.random`, instant, deterministic).
Report: `ok`, `tested`, `untested` (events no scenario sends, no ui.json, items declared in `untested`), `errors` (each starts with the file or scenario), per-scenario expectations. Also the MCP tool `check_game`.

`check.json`: `{"version":1,"selfcheck":"selfcheck.mjs"?,"scenarios":[...],"untested":["..."]}`. A scenario is the headless C2 scenario (`devices` with `role`, `rules`, `script`; `expect` of `{by, device, expr}`; `durationMs` is virtual) minus `game`, plus `name` and these extras: device `count: N` (clones `Name1..NameN`), device `joinAt`, script step `{at, leave: true}` (ghost player), script step `{at, every, until, send}` (repeat).
The hosted runner (`Web/packages/pear-sim`) ignores the extras.
Live counterpart: `node Deploy/smoke-game.mjs <gameId> --spec Games/X/check.json [--cloud URL]` replays the same scenarios over real sockets against a local or hosted backend (read-only, own lobby per scenario).
