# Omni marketplace run
PHASE: 3 (integration PR open, waiting on human)            SURFACE: web (Web Studio + Tauri shell)      BUDGET: cap $40 / 6 h, started 2026-11-14
Orchestrator: claude-opus-5-5. Workers and reviewers: claude-sonnet-5-5. Integration branch: agent/tienvu-lol/omni-marketplace.

## Status
| WS | Branch | State | Attempts | Last check |
|----|--------|-------|----------|------------|
| 1 registry | agent/tienvu-lol/omni-ws1-registry | merged (c2d4594) | 1 | gate ok, review APPROVE, Jev 0.94 |
| 2 harness | agent/tienvu-lol/omni-ws2-harness | merged (cff6cda) | 2 | gate ok 7 passed, round-2 fixes verified, Jev 0.93 |
| 3 installer | agent/tienvu-lol/omni-ws3-installer | merged (b733421, P3 e0e1825) | 2 | gate ok (web+tauri, 4 rust tests), review APPROVE, Jev 0.86 |
| 4 panel | agent/tienvu-lol/omni-ws4-panel | merged (d1717ee, P3 b71e5df, demo test 8e4e923) | 3 | gate ok 72 passed, review APPROVE (3 non-blocking), Jev 0.81 |

## Interface notes (orchestrator-owned; workers read, never write)
Registry (Rust, Backend/):
- GET /api/plugins -> [{id,name,version,author,category,description,installs}]
- GET /api/plugins/{id} -> manifest (the omni-plugin.json object)
- GET /api/plugins/{id}/bundle -> {"manifest":{...},"files":{"relpath":"utf8 content"}}
- POST /api/plugins/{id}/installs -> {"installs":n}
- Unknown id -> 404 {"error":"..."}
- Seed: OMNI_PLUGIN_SEED_DIR, each subdir with omni-plugin.json = one row. Bundle skips any path segment starting with "." or equal to "__pycache__", "node_modules", and any non-UTF-8 or >256 KiB file (uv creates .venv inside the plugin dir).
- Studio fetches cross-origin (Vite :5173, Tauri webview), so these routes need the same CORS the existing API has.

Runtime (Python, Plugins/langchain-deepagents/):
- Env: OMNI_PLUGIN_PORT (default 9410), OMNI_PROJECT_DIR (project root; scripts land in <dir>/scripts/), OMNI_AGENT_MODEL, OMNI_AGENT_FAKE=1.
- GET /health -> 200 {"status":"ok","deepagents":"0.7.38"} with Access-Control-Allow-Origin: *.
- WS /ws. Panel -> runtime: {"type":"prompt","id","text","project":{"scene","scripts","peripherals"}}.
- Runtime -> panel, every message carries "id" of the prompt:
  todos{items:[{content,status:"pending|in_progress|completed"}]} | subagent_status{name,state:"started|running|done|error",detail} | file_written{path,content} | done{summary} | error{message}
- file_written.path is POSIX, relative to the project dir, e.g. "scripts/cube.client.js", "scripts/tags.server.js". Naming rule: scripts/<name>.client.js -> client script <name>; scripts/<name>.server.js -> server script <name>.
- Fake mode writes scripts/cube.client.js and scripts/tags.server.js (real, working Omni scripts: pulse cube on look-at, send a tagged remote event; server counts tags per player).

Studio (Web/studio/):
- Marketplace is a tileable dockview panel, id panel.marketplace, title "Marketplace", opened from a toolbar button (not a modal).
- langchain-deepagents is auto-installed: on Studio start, if this project has never had it installed (and the user did not uninstall it), run the install flow automatically. Per-plugin buttons: Install / Uninstall / Reinstall. State persists per project in localStorage.
- Install flow: GET bundle -> installer.install(projectId, files) -> POST installs -> installer.start(projectId, manifest) -> poll runtime /health (60 s timeout; first uv sync is slow) -> layout.register(deepAgentPanel(...)) + open to the right of the viewport. Progress states: downloaded -> unpacked -> runtime starting -> healthy.
- Uninstall: stop runtime, delete plugin dir, close + unregister the panel, mark uninstalled. Reinstall = uninstall + install.
- Tauri commands: install_plugin(projectId, files), uninstall_plugin(projectId, id), start_runtime(projectId, manifest), stop_runtime(projectId). Plugin dir <app data>/omni/projects/<projectId>/plugins/<id>/; OMNI_PROJECT_DIR=<app data>/omni/projects/<projectId>.
- Browser mode: no spawn and no disk. Install records state, then attaches to a runtime already on :9410 and shows the start command.
- WS4 exports deepAgentPanel({ url, project, openScript }): PanelSpec with id panel.deepagents. openScript(ref: ScriptRef) opens an editor tab (EditorBus.open). WS4 never edits main.ts/layout.ts.

## WISHLIST (cloud integrations still needed; goes into .claude/plan.md after the PR merges)
- Hosted registry on Vultr: deploy the plugins routes with Postgres (0002_plugins.sql) and a seed/publish job instead of OMNI_PLUGIN_SEED_DIR on the dev box.
- Bundle storage: object storage (Vultr Object Storage) with tarballs, content hashes and signatures instead of JSON file maps in a JSONB column.
- Publish API: authenticated upload, author accounts, review/moderation, versioning and updates.
- Install telemetry: uninstall decrement and per-account install records (today the count only goes up, and installed state lives in localStorage per project).
- Installed-plugin sync across devices through the account (cloud projects), instead of per-browser state.
- Hosted agent runtime option (server-side Deep Agents) so browser mode works without a local uv process.
- Model API key management: per-account secret storage instead of a local env var.

## Decisions
- 2026-11-14 SURFACE: web + Tauri (user). Marketplace is a tileable panel, the Deep Agents plugin auto-installs, with uninstall/reinstall (user).
- Pi does not run Claude Code hooks for subagents. The run's gates run by hand: .omni-run/omni-marketplace/gate.sh <lane> <worktree> (checks, new test, owned paths, protected paths, clean tree) after every worker, then a fresh Sonnet reviewer, then gate.sh (Jev) on the diff. Efficiency rules (ponytail, logs to files, 25-line report) go in each brief.
- Worktrees share the main checkout's Web/node_modules by junction and use CARGO_TARGET_DIR on the main checkout's targets, to skip reinstalls and full rebuilds.
- Laptop name: tienvu-lol.

## Blockers
- DEMO-TIMED needs a human run (see Demo script notes).
- Live AI path untested: no model API key in this environment.

## Debt (ponytail-debt)
- Backend/src/api/marketplace.rs:89 blocking std::fs in async seed (startup only).
- Backend/src/memstore.rs:5 linear scans (dev store).
- Web/studio/src-tauri/src/plugins.rs:148 non-Windows kills only the direct child (uv may orphan python).
- Audit non-blocking: one runtime per project; reinstall leaves stale files (uninstall runs first); seed does not apply the [a-z0-9-] id rule; no lock across two sockets; installs counter counts reinstalls.
- Bundle skips uv.lock (407 KB > 256 KiB rule) and dotfiles (.python-version): installed runtime resolves deps fresh on first start.
- ponytail-gain: shows only the published benchmark, no run-specific numbers to record.

## Dead ends

DEMO-TIMED: pending - human step. No browser automation on this machine and no model key; the orchestrator cannot run or time the UI demo. Script for the human below.

## Demo script notes (judge demo as built)
- Start: OMNI_PLUGIN_SEED_DIR=$PWD/Plugins bash Deploy/dev.sh (backend :8080 in-memory + Studio :5173). Desktop: the Tauri app spawns the runtime itself; browser: run `cd Plugins/langchain-deepagents && OMNI_AGENT_FAKE=1 uv run python runtime/server.py` (drop OMNI_AGENT_FAKE and set ANTHROPIC_API_KEY for live AI).
- langchain-deepagents auto-installs on first start, so 0:20 'Install' becomes: open Marketplace, show Installed with Uninstall / Reinstall, press Reinstall to show the progress line (downloaded -> unpacked -> runtime starting -> healthy).
- 1:35 look-at is driven by the simulated head (AirPods) orientation, not the iPhone (the phone sends gestures). Pulse shows as the cube scale pulse plus a haptic tick; the tag goes to the server as remote event 'tag'.
- Fake mode (OMNI_AGENT_FAKE=1) is a rehearsal replay; do not present it as live AI.

## Log
- 2026-11-14 Phase 0 done: integration branch and 4 worktrees from origin/main 376f44f, run scaffolding installed, Jev reachable.
- 2026-11-14 Jev prespawn.sh requires briefs that forbid git (Phase 8 protocol). Workers run no git; the orchestrator commits each worker's tree on its branch after gate.sh passes. Overrides brief section 5 'commit on your branch'.
- 2026-11-14 prespawn WS1 pass 0.92 route high. WS2 prespawn 0.68 (<0.75) on the combined Phase-8-worded criterion; each sub-criterion passes alone (files 0.79, one dir 0.79, no git/.claude 0.88, done condition 0.97). Override: launch. route high.
- 2026-11-14 WS3/WS4 briefs: prespawn pass (0.90/0.84). route.sh split WS3 (pSplit 0.78) into WS3 web (src/marketplace, layout, main, tests) and WS3t Tauri (src-tauri), run one after the other in the ws3 worktree.
- 2026-11-14 WS1 gate ok (10 test-result lines ok), WS2 gate ok (4 passed). Committed 85e2dc9-equivalent / ws2 plugin. User asked to update from main: origin/main 122eeae (OmniCloud, Deploy, .claude/plan.md, no lane overlap); integration branch fast-forwarded, all 4 local WS branches rebased (none pushed yet, so no force-push).
- 2026-11-14 WS1 review APPROVE (4 non-blocking), Jev pre-merge 0.94, merged --no-ff c2d4594. WS2 review CHANGES NEEDED: 1 blocking (server script must start with export default), plus Origin check and scripts path resolve; fix round 1 launched. WS3 web launched (Sonnet high).
- 2026-11-14 WS2 fix round 1: 7 passed; orchestrator verified each finding in code (server.py:45,63 export default first; :186 origin 403; translate path resolve), no second reviewer run. Jev 0.93, merged cff6cda. WS4 launched (Sonnet high).
- 2026-11-14 WS4 review APPROVE, Jev 0.81, merged d1717ee. WS3 web gate ok, committed 3774378 (permissions/autogenerated/open_panel_window.toml left out: line-ending-only churn from the Tauri build). WS3t (Tauri commands) launched.
- 2026-11-14 User: drive the rest through subagent workflows, not one-by-one orchestrator checks. Added workflows/review-loop.js: reviewer -> worker fix with host gate (gate.sh via Git Bash) -> re-review, max 3 rounds. The orchestrator keeps only git (commit, Jev pre-merge gate, merge), which the workflow sandbox cannot run.
- 2026-11-14 WS3t touched src-tauri/build.rs (needed for Tauri command permissions); added to OWN_ws3. WS3 review-loop workflow: APPROVE round 1. Jev 0.86, merged b733421. Non-blocking finding promoted to Phase 3: start_runtime runs a webview-supplied command (allow-list uv, read manifest from disk) and health port hard-coded.
- 2026-11-14 Phase 3 launched as workflows/lanes-loop.js: lane A ws3 (real panel import, security fix, Marketplace polish; prespawn 0.73 override: writes span src/ and src-tauri/), lane B ws4 (review fixes, Deep Agent polish; prespawn 0.78).
- 2026-11-14 Phase 3 lanes-loop: ws3 APPROVE (round 1), ws4 APPROVE (round 2; round 1 reviewer wrote "OK with notes" without the verdict line, fix-1 made no changes). Both "work" gates failed only on an orchestrator gate.sh bug (ownership compared against origin/main after the rebase); fixed to compare against the integration branch, both gates re-run green. ws4 P3 merged b71e5df (Jev 0.81).
- 2026-11-14 demo-path.sh green: seeded registry list -> bundle (8 files) -> runtime from the unpacked bundle healthy (deepagents 0.7.38) -> fake prompt over /ws: todos, subagent_status, file_written scripts/tags.server.js on disk, done. Two fixes were in my own scripts (jq on Windows writes CRLF; unpack now via node).
- 2026-11-14 ws3 panel.ts:22 had raw 0xB7 bytes (invalid UTF-8, renders as U+FFFD): fix worker + ponytail-audit of the new dirs launched as one workflow.
- 2026-11-14 ws3 UTF-8 fix (panel.ts escapes + test) and P3 work: gate ok, committed 23095ff, merged e0e1825. Process slip: the first Jev pre-merge run returned 0.63 because the evidence cut the review before its verdict, and the merge command was chained with ';' so it ran anyway. Re-ran with full evidence: pass 0.89, merge kept. Merges are now chained with '&&' on the gate.
- 2026-11-14 ponytail-audit (ran on the integration checkout before the ws3 P3 merge): BLOCKING 1 (stub import) and 2 (webview-supplied command) were already fixed in ws3 P3. NON-BLOCKING accepted as debt: one runtime per project (single plugin today), stale files on reinstall (reinstall uninstalls first), seed-time id rule, one asyncio lock across sockets, install counter counts reinstalls (WISHLIST telemetry). boot() is not awaited (main.ts:269), so audit #5 does not block startup.
- 2026-11-14 P3-demo (headless Run-local check of the fake scripts) launched via lanes-loop on ws4; prespawn 0.68 override (brief names other files only as read inputs), route medium.
- 2026-11-14 P3-demo test: Run local with the real sandbox pulses the Blank Cube and sends remote 'tag' {entity:'Cube',tag:'looked'}; review APPROVE, Jev 0.94, merged 8e4e923.
- 2026-11-14 dod.sh on e0e1825: ok backend, web, typecheck, tauri, plugin, health, demo-path, tests; FAIL demo-timed only (human step).
- 2026-11-14 Merged origin/main c44e6ce (Swift only, no overlap) -> 6ba3063. hygiene.sh OK. Issue #160, integration PR #161 -> main opened for human review. Teardown deferred: dod.sh stays red on DEMO-TIMED until the human demo; after merge a worker adds the WISHLIST to .claude/plan.md (user-authorized, in that order).

## Phase 10 (2026-11-14, manual session on main)
- 10.1-10.7 and 10.9 built; see .claude/plan.md Phase 10 status lines. Local check: Postgres 17 + SeaweedFS (S3, SigV4 checked: wrong secret rejected) + runtime container in hosted mode.
- 10.8 live models: BLOCKED for all three providers, no API key in this environment (Anthropic, OpenAI, Google untested; OpenAI key reported earlier as out of credits). Google default `google_genai:gemini-2.5-pro` unverified. The hosted path reached Anthropic and got 401 for a fake key, so routing works; one real prompt per provider is still owed.
- Fake mode (OMNI_AGENT_FAKE) is gone; demo rehearsal needs a real key.
