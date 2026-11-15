# .agents

## Current: one planner, deterministic workers

- Setup and security gates: `docs/agents/autonomy-setup.md`.
- Investigation and ranked proposal: `docs/agents/autonomy-findings.md`.
- `scripts/start.sh <laptop> --worker` (default) or `--orch [--local-workers N]` dispatches to `scripts/start-autonomy.sh`; add `--dry-run` for a no-network preview.
- `scripts/loop.sh` is the plain worker/orchestrator launcher. `scripts/autonomy.py` owns atomic claims, worktrees, bounded sessions, checks, fresh review, merge, shared capacity and summaries.
- `scripts/dry-run.sh` runs `scripts/test_autonomy.py`: real local Git and mocked model/GitHub delivery, zero model spend.
- `settings.worker.json` is the slim V2 worker permission set without the legacy Stop hook.
- `scripts/ci-dod.py` runs independent brief build/tests/lint on the hosted `agent-dod` CI job, never on the merge-credential machine.
- `scripts/ci-scope.py` selects only relevant manual-PR component checks; managed PRs use independent DoD instead of duplicate product builds.
- `scripts/legacy-loop.sh` preserves the prior loop, accessible only through explicit `PEAR_LEGACY=1`; never run both architectures concurrently.
- The generated context pack and small role prompts are under `docs/agents/`. V2 does not read the full-doc rules below.

## Legacy reference (not the current launch instructions)

Instructions and tooling for autonomous agents. `.claude/` is human-only: agents read it and never write to it.

- `AGENTS.md` — rules every autonomous agent follows (rules in `.claude/instructions.md` under `## Autonomous Mode`).
- `agent-playbook.md` — the condensed Anthropic playbook (rule IDs like `DOD-08` cited from `LOOP.md`). Reference only; do not edit.
- `LOOP.md` — the whole unattended loop, bottom to top: layers, escalation table, adopted/rejected playbook rules, how to prompt it, limits.
- `ORCHESTRATOR.md` — the per-laptop orchestrator cycle: pick work, launch workers, open PRs, review and merge, Mac verification, permissions, escalation.
- `settings.json` — worker permissions + stop-hook (commit, push own `agent/*` branch only, no `gh`).
- `settings.worker.json` — slim V2 worker permissions, without the legacy Stop hook; runtime stays inactive until the dependent launch/setup PR.
- `settings.orch.json` — orchestrator permissions + stop-hook (full `gh`, `git push` of any branch except `main`, force-push of own branches, `cargo`; still no `.claude/` edits, no `gh repo delete` / `secret` / key commands; `gh auth` and `git clean` are allowed).
- `INTEGRATOR.md` — the integrator role: builds the PR, worktree and CI tooling while the orchestrators work (Opus, big budget), then maintains it from their signals (Sonnet, small budget).
- `settings.integrator.json` — integrator permissions + stop-hook: edits only `.agents/scripts/**`, `.agents/README.md`, `.github/workflows/**`, `docs/agents/`; pushes only `agent/*` branches; full `gh` except destructive account commands.
- `agents.json` — subagents: `reviewer` and `swift-package-worker`.
- `BOOTSTRAP.md` — runbook for a manual Claude session on any of the four laptops: identify the laptop, clean clone, setup, verify, start `loop.sh` detached, confirm the first cycle. Prompt: "follow .agents/BOOTSTRAP.md".
- `HUMAN.md` — human cheat sheet, hidden from agents (never materialized in an agent worktree).
- `scripts/run.sh` — launcher: new worktree + `agent/<laptop>/<slug>` branch, then `claude -p`. Worker = Sonnet 5.5; `--orch` = Opus 5.5; `--detach` starts it in the background and writes `logs/<slug>.state`.
- `scripts/start.sh <laptop> [--integrator] [--dry-run]` — one command per laptop: setup, verify, then start the loop (Mac: detached tmux under `caffeinate -i`; Windows: its own Git Bash window plus a keep-awake helper).
- `scripts/loop.sh` — per-laptop overnight loop (`PEAR_ROLE=orch|integrator`): agent cycle, backoff, STOP check, build-to-maintain phase switch for the integrator, credit-exhaustion detection (OUT / BACK on the `Loop capacity` issue; OUT and a `handoff:` comment on every claimed issue at the first limit hit, a CLI limit warning, an agent's `OFFLINE:` line ; on a usage limit it sleeps until the reset + 60 s and resumes with BACK; `NIGHT_BUDGET_USD` 90 % spent stops it), failure issue + local notification.
- `scripts/setup.sh <laptop> [--check]` — installs and checks the tools the loop needs (Homebrew on macOS, winget on Windows); lists what only a human can do.
- `scripts/verify-nonswift.sh` — JSON / JSONL validity and JS syntax; runs on macOS and Windows (the Windows lanes' check, also run in CI).
- `scripts/selftest.sh [--keep]` — self-test of the agent tooling: `bash -n` on every script, `shellcheck -S error` when installed, `--help` of each tooling script, smoke runs of `prs.sh` / `worktrees.sh` / `health.sh` in a throwaway git repo with a stub `gh`, then `check-docs.sh`. Touches nothing outside a temp directory.
- `scripts/verify-backend.sh` — Rust backend (`Backend/`): `cargo build` + `cargo test`; any OS; passes while `Backend/Cargo.toml` does not exist. Database tests skip without `DATABASE_URL`.
- `scripts/verify-swift.sh` — the checks (`swift build` + `swift test` per package). Same script runs in CI, the stop-hook, and by hand.
- `scripts/stop-gate.sh` — stop-hook: agent can't finish while checks fail for the packages it changed and their dependents.
- `scripts/health.sh [--only main|prs|claims|issues|mission|labels] [--hours N]` — repo health from GitHub alone: CI on `main`, open agent PRs per laptop, dead `claimed:*` issues (no open PR names them, idle N h, default 3), `needs-tien` / `needs-human` / `URGENT-HUMAN` counts, the `Mission` issue, missing labels. Read-only; exits 1 when something needs attention.
- `scripts/verify-pr.sh <n>` — verifies a PR's exact head commit in a throwaway worktree (Mac: Swift + non-Swift checks; Windows: non-Swift only); last line `MAC-VERIFIED <sha>`, `VERIFIED <sha>` or `VERIFY-FAILED <sha>`.
- `scripts/worktrees.sh [--apply] [--lock-min N] [--verify-min N] [--idle-min N] [--days N]` — reports and prunes leftovers in `<clone>.worktrees/`: a stale `.setup.lock`, idle `verify-<n>` worktrees, provably idle worktrees whose branch is merged (or has nothing beyond `main`), and old finished `logs/*.state` + prompt files. Removes worktrees only, never branches; skips dirty ones, unpushed commits, running or recently active agents, the `orch` / `integrator` worktrees, and every worktree while a fresh `.setup.lock` exists. Dry run unless `--apply`.
- `scripts/review-pr.sh <n>` — mechanical first-pass review of an agent PR (scope, deps vs graph, purity, hardware-blind rule, comments, tests, CI). Read-only.
- `scripts/maintain.sh [--apply] [--idle-min N]` — deterministic GitHub hygiene, run by the lead orchestrator every cycle (ORCHESTRATOR.md step 2f): squash-merges agent PRs that pass every mechanical gate, closes superseded PRs, done and duplicate issues, deletes merged `agent/*` branches, creates missing labels. Dry run by default.
- `scripts/snapshot.sh [--out FILE]` — one compact read-only picture for the orchestrator (main head, STOP files, Mission + `DECISION:` comments, latest `Loop capacity` lines, open PRs and issues, this laptop's worker states). `loop.sh` writes it to `<logs>/snapshot.md` every tick and skips the model call when it is unchanged since the last cycle (`FORCE_CYCLE`, default 3600 s, forces one anyway). Exits 1 when a `gh` read fails.
- `scripts/cleanup.sh [--dry-run] [--closed]` — remove worktrees and branches of merged agent PRs (skips dirty or unmerged work).
- `scripts/prs.sh [list|update|close-stale] [--apply] [--days N]` — open agent PRs with CI, review, mergeable and behind-main state; `update` runs `gh pr update-branch` on behind PRs (not conflicting, not `human-hold`); `close-stale` closes PRs idle for N days (default 3). Dry run unless `--apply`.
- `scripts/check-docs.sh` — last step before a push: fails when `.agents/*.md` or `docs/agents/` notes point at missing files, a script is not listed here, or retired wording is still there.
- `scripts/hygiene.sh [--base REF] [--branch NAME] [--body-file FILE] [--strict]` — PR hygiene: `agent/<laptop>/<slug>` branch name, a `Refs #<n>` line in an agent PR body, no `.build/`, `Backend/target/` or secret-looking file or token added, tracked JSON / YAML parse, `bash -n` + `shellcheck -S error` on `scripts/*.sh`, `check-docs.sh`. Read-only; run by `hygiene.yml` and by hand.
- `../.github/workflows/verify.yml` — on macOS for every PR and push to `main`: `verify-swift.sh`, `verify-nonswift.sh`, `check-docs.sh`; on Linux: `verify-backend.sh`.
- `../.github/workflows/hygiene.yml` — on every PR (also when its body is edited), Linux: `hygiene.sh --strict` against the PR's base.
- `../.github/workflows/repo-health.yml` — every 2 h and on demand: prints `health.sh`, and opens one `[ci] main is red` issue labeled `ci` while `main` is red.

Roles and models (same for everyone): orchestrator `claude-opus-5-5`; workers and every subagent `claude-sonnet-5-5`.

Run: `PEAR_LAPTOP=<name> .agents/scripts/run.sh <slug> "implement plan.md items 1.3"`, or let the orchestrator do it (see `HUMAN.md`).

Known limits: no MCP in agent runs. Protected paths are blocked for the edit tools and for shell writes (Bash is allow-listed), but `swift build` and `swift test` can run arbitrary code (package plugins, tests), so the PR diff and branch protection remain the real backstop.
