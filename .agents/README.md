# .agents

Instructions and tooling for autonomous agents. `.claude/` is the manual workflow and is never touched from here.

- `AGENTS.md` — rules agents follow (read via the pointer in the root `CLAUDE.md`).
- `settings.json` — permissions + stop-hook, loaded only by `run.sh`.
- `scripts/run.sh` — launcher: new worktree + `agent/<slug>` branch, then `claude -p`.
- `scripts/verify-*.sh` — the checks. Same scripts run in CI, the stop-hook, and by hand.
- `scripts/review-pr.sh <n>` — human-run mechanical first-pass review of an agent PR (scope, deps vs graph, purity, tests, CI). Read-only.
- `scripts/batch.sh <specfile>` — launch several agents in parallel, wait, then review each PR and print a summary. `DRY_RUN=1` previews and runs the pre-flight.
- `scripts/cleanup.sh [--dry-run] [--closed]` — remove worktrees and branches of merged agent PRs (skips dirty or unmerged work).
- `.github/workflows/agent-pr-review.yml` — posts `review-pr.sh` output as a comment on `agent/*` PRs.
- `scripts/stop-gate.sh` — stop-hook: agent can't finish while checks fail.

AI QA (local simulators + dev backend). Prereqs: Docker Desktop, Java 17, Maestro CLI (`curl -Ls https://get.maestro.mobile.dev | bash`), jq.
- Runs are driven by the QA dashboard in the separate `ai-qa-test-dash` repo (`python3 qadash.py ../hex-game`), configured by `.qa/config.json`: setup, build, smoke test and saved regression flows (`ios/maestro/regressions/`), one simulator + agent per tester, triage, Jira. The old `qa-run.sh`, `qa-sims.sh` and `qa-jira.sh` batch scripts were removed in its favour.
- `scripts/sim-run.sh <udid> [Run|Bike|Car]` — record one whole activity with simulated movement in a single Maestro flow (`qa/flows/run.yaml`). Agents use this: every maestro command stops the simulator's location playback, so a walk started separately records nothing.
- `scripts/sim-walk.sh <sim> <route> [m/s]` — play a route through the sim's GPS (default 3 m/s; above ~4 m/s runs fail the cadence gate). The next maestro command stops it; used by `sim-run.sh` and the smoke test's delayed walk.
- `qa/prompt.txt` (QA agent instructions, `{{PERSONA}}` slot), `qa/routes/*.txt` (`lat,lng` per line, Back Bay Boston), `qa/settings.json` (QA-only permissions: maestro hierarchy/test, simctl screenshot/launch/terminate/location, `qa-dev.sh`, sim-walk, sim-run; no curl or wget; credential and secret paths are read-denied; writes only under `ios/.qa-reports`).
- Dev launch flags (Debug builds only): `-apiBase http://localhost:8080/v1`, `-devLogin <name>`, `-fakeSteps 1`, `-skipPermissions 1`.
- Dev routes (only with `BOUND_DEV_MODE=1`): `POST /v1/dev/login {name}`, `/v1/dev/clock/advance {secs}` (`/dev/grant` and `/dev/reset` not built yet; `docker compose down -v` resets the world). `POST /v1/dev/grant {name, impulse}` credits whole Impulse to `dev:<name>`. `POST /v1/dev/claim {name, count}` claims up to 20 neutral hexes nearest the Capital (normal claim bonus). QA agents reach them only through `scripts/qa-dev.sh login <player>` / `advance <secs>` / `grant <player> <impulse>` / `claim <player> <count>` (validated input, localhost:8080 only).

Run: `.agents/scripts/run.sh <slug> "implement PLAN.md items 2.1-2.9"` then review the PR.
Known limits: no MCP in agent runs (iOS agents can't pull Figma yet). Protected paths are blocked for the edit tools and for shell writes (Bash is allow-listed), but cargo and xcodebuild can run arbitrary code (build scripts, tests), so the PR diff and branch protection remain the real backstop.
