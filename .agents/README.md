# .agents

Instructions and tooling for autonomous agents. `.claude/` is the manual workflow; agents only read it (the orchestrator edits `plan.md` and `architecture.md` through PRs, never `overview.md`).

- `AGENTS.md` — rules every autonomous agent follows (rules in `.claude/instructions.md` under `## Autonomous Mode`).
- `ORCHESTRATOR.md` — the per-laptop orchestrator cycle: pick work, launch workers, push, open PRs, escalate.
- `settings.json` — worker permissions + stop-hook (commit only, no push, no `gh`).
- `settings.orch.json` — orchestrator permissions + stop-hook (push `agent/*`, `gh issue/pr`; no merge, no `main`).
- `agents.json` — subagents: `reviewer` and `swift-package-worker`.
- `HUMAN.md` — human cheat sheet, hidden from agents (never materialized in an agent worktree).
- `scripts/run.sh` — launcher: new worktree + `agent/<laptop>/<slug>` branch, then `claude -p`. Worker = Sonnet 5.5; `--orch` = Opus 5.5.
- `scripts/verify-swift.sh` — the checks (`swift build` + `swift test` per package). Same script runs in CI, the stop-hook, and by hand.
- `scripts/stop-gate.sh` — stop-hook: agent can't finish while checks fail for the packages it changed and their dependents.
- `scripts/review-pr.sh <n>` — mechanical first-pass review of an agent PR (scope, deps vs graph, purity, hardware-blind rule, comments, tests, CI). Read-only.
- `scripts/cleanup.sh [--dry-run] [--closed]` — remove worktrees and branches of merged agent PRs (skips dirty or unmerged work).
- `../.github/workflows/verify.yml` — runs `verify-swift.sh` on macOS for every PR.

Roles and models (same for everyone): orchestrator `claude-opus-5-5`; workers and every subagent `claude-sonnet-5-5`.

Run: `OMNI_LAPTOP=<name> .agents/scripts/run.sh <slug> "implement plan.md items 1.3"`, or let the orchestrator do it (see `HUMAN.md`).

Known limits: no MCP in agent runs. Protected paths are blocked for the edit tools and for shell writes (Bash is allow-listed), but `swift build` and `swift test` can run arbitrary code (package plugins, tests), so the PR diff and branch protection remain the real backstop.
