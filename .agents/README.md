# .agents

Instructions and tooling for autonomous agents. `.claude/` is human-only: agents read it and never write to it.

- `AGENTS.md` — rules every autonomous agent follows (rules in `.claude/instructions.md` under `## Autonomous Mode`).
- `agent-playbook.md` — the condensed Anthropic playbook (rule IDs like `DOD-08` cited from `LOOP.md`). Reference only; do not edit.
- `LOOP.md` — the whole unattended loop, bottom to top: layers, escalation table, adopted/rejected playbook rules, how to prompt it, limits.
- `ORCHESTRATOR.md` — the per-laptop orchestrator cycle: pick work, launch workers, open PRs, review and merge, Mac verification, permissions, escalation.
- `settings.json` — worker permissions + stop-hook (commit, push own `agent/*` branch only, no `gh`).
- `settings.orch.json` — orchestrator permissions + stop-hook (full `gh`, any `git push` including `main` and force; still no `.claude/` edits, no `gh repo delete` / `secret` / key commands; `gh auth` and `git clean` are allowed).
- `INTEGRATOR.md` — the integrator role: builds the PR, worktree and CI tooling while the orchestrators work (Opus, big budget), then maintains it from their signals (Sonnet, small budget).
- `settings.integrator.json` — integrator permissions + stop-hook: edits only `.agents/scripts/**`, `.agents/README.md`, `.github/workflows/**`, `docs/agents/`; pushes only `agent/*` branches; full `gh` except destructive account commands.
- `agents.json` — subagents: `reviewer` and `swift-package-worker`.
- `BOOTSTRAP.md` — runbook for a manual Claude session on any of the four laptops: identify the laptop, clean clone, setup, verify, start `loop.sh` detached, confirm the first cycle. Prompt: "follow .agents/BOOTSTRAP.md".
- `HUMAN.md` — human cheat sheet, hidden from agents (never materialized in an agent worktree).
- `scripts/run.sh` — launcher: new worktree + `agent/<laptop>/<slug>` branch, then `claude -p`. Worker = Sonnet 5.5; `--orch` = Opus 5.5; `--detach` starts it in the background and writes `logs/<slug>.state`.
- `scripts/start.sh <laptop> [--integrator] [--dry-run]` — one command per laptop: setup, verify, then start the loop (Mac: detached tmux under `caffeinate -i`; Windows: its own Git Bash window plus a keep-awake helper).
- `scripts/loop.sh` — per-laptop overnight loop (`OMNI_ROLE=orch|integrator`): agent cycle, backoff, STOP check, build-to-maintain phase switch for the integrator, credit-exhaustion detection (OUT / BACK on the `Loop capacity` issue), failure issue + local notification.
- `scripts/setup.sh <laptop> [--check]` — installs and checks the tools the loop needs (Homebrew on macOS, winget on Windows); lists what only a human can do.
- `scripts/verify-nonswift.sh` — JSON / JSONL validity and JS syntax; runs on macOS and Windows (the Windows lanes' check, also run in CI).
- `scripts/verify-backend.sh` — Rust backend (`Backend/`): `cargo build` + `cargo test`; any OS; passes while `Backend/Cargo.toml` does not exist. Database tests skip without `DATABASE_URL`.
- `scripts/verify-swift.sh` — the checks (`swift build` + `swift test` per package). Same script runs in CI, the stop-hook, and by hand.
- `scripts/stop-gate.sh` — stop-hook: agent can't finish while checks fail for the packages it changed and their dependents.
- `scripts/health.sh [--only main|prs|claims|issues|mission|labels] [--hours N]` — repo health from GitHub alone: CI on `main`, open agent PRs per laptop, dead `claimed:*` issues (no open PR names them, idle N h, default 3), `needs-tien` / `needs-human` / `URGENT-HUMAN` counts, the `Mission` issue, missing labels. Read-only; exits 1 when something needs attention.
- `scripts/verify-pr.sh <n>` — verifies a PR's exact head commit in a throwaway worktree (Mac: Swift + non-Swift checks; Windows: non-Swift only); last line `MAC-VERIFIED <sha>`, `VERIFIED <sha>` or `VERIFY-FAILED <sha>`.
- `scripts/review-pr.sh <n>` — mechanical first-pass review of an agent PR (scope, deps vs graph, purity, hardware-blind rule, comments, tests, CI). Read-only.
- `scripts/cleanup.sh [--dry-run] [--closed]` — remove worktrees and branches of merged agent PRs (skips dirty or unmerged work).
- `scripts/check-docs.sh` — last step before a push: fails when `.agents/*.md` or `docs/agents/` notes point at missing files, a script is not listed here, or retired wording is still there.
- `../.github/workflows/verify.yml` — on macOS for every PR and push to `main`: `verify-swift.sh`, `verify-nonswift.sh`, `check-docs.sh`; on Linux: `verify-backend.sh`.

Roles and models (same for everyone): orchestrator `claude-opus-5-5`; workers and every subagent `claude-sonnet-5-5`.

Run: `OMNI_LAPTOP=<name> .agents/scripts/run.sh <slug> "implement plan.md items 1.3"`, or let the orchestrator do it (see `HUMAN.md`).

Known limits: no MCP in agent runs. Protected paths are blocked for the edit tools and for shell writes (Bash is allow-listed), but `swift build` and `swift test` can run arbitrary code (package plugins, tests), so the PR diff and branch protection remain the real backstop.
