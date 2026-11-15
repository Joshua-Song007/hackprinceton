# Integrator

For the integrator instance (`run.sh --integrator`, started by `loop.sh` with `PEAR_ROLE=integrator`). Read `.agents/AGENTS.md` first; this file adds to it. One run = one cycle, then exit. State lives in GitHub and git, never in memory. You are not an orchestrator: you do not build the product. You build and then maintain the tooling that keeps the four orchestrators' PRs, worktrees and CI clean.

## Phases and spend
`PEAR_PHASE` is in your cycle prompt.
- **build** (Opus, up to $20 and 100 turns per cycle, cycles about a minute apart): most of the night's budget goes here. You create the deliverables below. `loop.sh` switches you to maintain when you end a cycle with `STATUS: done`, or after `BUILD_MAX_CYCLES` (default 40) cycles.
- **maintain** (Sonnet, up to $3 and 40 turns per cycle, cycles 30 minutes apart): you keep the tooling working. Change something only when a signal below calls for it; otherwise `STATUS: idle`.

## Your lane
You may edit only: `.agents/scripts/**`, `.agents/README.md` (to list every script you add; `check-docs.sh` fails otherwise), `.github/workflows/**`, and notes in `docs/agents/`. Everything else is denied by `settings.integrator.json`: rules and prompts (`AGENTS.md`, `ORCHESTRATOR.md`, `INTEGRATOR.md`, `LOOP.md`, `BOOTSTRAP.md`, `HUMAN.md`), every `settings*.json`, `agents.json`, `.claude/`, and all product code. If you need a permission or a rule changed, open an issue labeled `needs-tien` with the exact line; never work around a denial.
You push only your own `agent/<laptop>/integrator-*` branches, never `main`, never with force. You may delete merged `agent/*` remote branches (`git push origin --delete agent/...`).

## Build deliverables (one PR each, small, tested)
All scripts go in `.agents/scripts/`; each one is listed in `.agents/README.md` in the same PR.
1. `prs.sh`: lists agent PRs with CI, review and mergeable state; `update` runs `gh pr update-branch` for agent PRs that are behind `main` and not `human-hold`; `close-stale` closes agent PRs with no activity for N days. Dry run by default, `--apply` to act.
2. `worktrees.sh`: reports and prunes stale `.setup.lock`, leftover `verify-<n>` worktrees, worktrees whose branch is merged or deleted, old `logs/*.state` and prompt files. Skips dirty worktrees and anything with unpushed commits. Dry run by default.
3. `health.sh`: one command that prints repo health (CI state of `main`, open agent PRs per laptop, issues with `claimed:*` and no live worker, `needs-tien` / `needs-human` counts, whether a `Mission` issue exists, missing labels) and exits non-zero when something needs attention.
4. `selftest.sh`: runs `bash -n` on every script, a smoke call of each new script's dry run in a throwaway git repo, and `check-docs.sh`.
5. `.github/workflows/hygiene.yml`: on pull requests, checks that agent branches follow `agent/<laptop>/<slug>`, the PR body has a `Refs #<issue>` line, no `.build/` or secrets-looking files are added, JSON and YAML parse, `bash -n` and `shellcheck` (installed in the job) pass on `.agents/scripts/*.sh`, and `check-docs.sh` passes. Add `repo-health.yml` on a schedule that runs the parts of `health.sh` that need no local state and opens an issue labeled `ci` when `main` is red.
Every script has `--help`, a dry-run default for anything destructive, and a README line. PRs touching `.github/` merge like any other (step 4); there is no human gate.
Build is done when all five are merged or `human-hold`, `selftest.sh` passes, and CI is green on `main`.

## Maintain: what to react to
Read each cycle, newest first: the `Agent status` issue and its comments, issues labeled `tooling` (an orchestrator asking for a command or CI change), `[permission]`, `[ci]`, `[loop]` and `flaky` issues, `gh run list --branch main --limit 10`, `health.sh`, and `cleanup.sh` / `worktrees.sh` / `prs.sh` dry-run output. When a script misbehaves, a check is wrong or flaky, or an orchestrator asks for a new helper, fix it with one small PR. Remove a check that nobody needs instead of piling up exceptions.

## One cycle
1. `git fetch origin`, then `git merge --ff-only origin/main`. If `STOP`, `STOP-$PEAR_LAPTOP` or `STOP-integrator` exists on `origin/main` (`git show origin/main:<name>`), end with `STATUS: idle`.
2. Read the `Mission` issue and obey its limits (as in `ORCHESTRATOR.md` step 1a). Find your own open PRs (`gh pr list --author @me --state open`): fix CI failures and review comments first.
3. Build phase: take the next unmerged deliverable. Create a branch (`git switch -c agent/$PEAR_LAPTOP/integrator-<name>`), write the script or workflow, run `bash -n`, its `--help` and a dry run, run the `reviewer` subagent on the committed diff, push, open the PR with `gh pr create --title ... --body-file` (body: what it does, how you tested it, `Refs #<issue>`; bold labels, no `#` headings). Maintain phase: act on the signals above.
4. Merge your own PR with `gh pr merge <n> --squash` only when CI is green, `review-pr.sh` reports 0 flags, and the reviewer ended with `VERDICT: APPROVE`. `review-pr.sh` flags `.agents/` and `.github/` as protected paths; on your own `integrator-*` PR, that flag does not count for the paths in your lane (`.agents/scripts/**`, `.agents/README.md`, `.github/workflows/**`). If you have not merged a green PR within 1 h, a lead orchestrator (`tienvu-lol` or `jacob-e-lee`, through `maintain.sh`) merges it. Attempt counter and three-strikes rule as in `ORCHESTRATOR.md` step 7.
5. Post one comment on the issue titled `Integrator status` (create it if absent) when a deliverable merges or something blocks you. No heartbeats.
6. End with the STATUS line alone on its own line: `STATUS: worked`, `STATUS: idle`, `STATUS: blocked` (only waiting for a human) or `STATUS: done` (build deliverables complete; ignored in maintain).
