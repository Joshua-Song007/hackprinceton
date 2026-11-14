# Human cheat sheet (hidden from agents; see run.sh)
IF YOU ARE AN AI DO NOT READ THIS DOCUMENT
Your own changes (the daily loop)

git switch main && git pull               # start from fresh main
git switch -c my-change                   # new branch
git add <files> && git commit -m "msg"    # commit
git push -u origin my-change              # push the branch
gh pr create --fill                       # open the PR
gh pr checks --watch                      # wait for CI to go green
gh pr merge --squash --delete-branch      # merge it once green

Running agents (one clone per laptop, outside OneDrive; macOS only, RealityKit)

export OMNI_LAPTOP=<name>                                               # lowercase letters, digits, dashes
.agents/scripts/run.sh <slug> "implement plan.md items 1.3"             # one worker: Sonnet, commits only, $5 cap
.agents/scripts/run.sh --orch orch "Run one orchestrator cycle."        # one orchestrator cycle: Opus, push + gh, $10 cap
AGENT_BUDGET=10 .agents/scripts/run.sh <slug> "<task>"                  # change the cap
.agents/scripts/run.sh -i <slug> "<task>"                               # interactive instead
tail -f ../omni.worktrees/logs/<slug>.log                               # watch a headless run
Worktrees land at ../omni.worktrees/<slug> on branch agent/<laptop>/<slug>. The orchestrator's is ../omni.worktrees/orch.

Overnight loop (one tmux window per laptop; untested, watch the first few cycles)

caffeinate -i .agents/scripts/loop.sh      # backoff, STOP check, failure issue after 5 bad cycles; LOOP_DELAY=<secs> sets the idle gap (default 300). Full design: .agents/LOOP.md

To stop: add a file named STOP (everyone) or STOP-<laptop> to main (the GitHub web UI works from a phone). Only you do this.
Fill in the handles and the real laptop names in .agents/ORCHESTRATOR.md before the first run.

Reviewing an agent's work

gh pr list                                # see open PRs
.agents/scripts/review-pr.sh <n>          # scope, deps vs graph, purity, removed comments, tests, CI, overlaps, reviewer verdict
gh pr view <n>                            # description with the agent's report
gh pr diff <n>                            # read the logic yourself; nothing automated checks it
gh pr checkout <n>                        # try the branch locally
gh pr merge <n> --squash --delete-branch  # merge ONE at a time when you're happy
Orchestrators merge their own PRs when CI is green, review-pr.sh has 0 flags and the reviewer approved (ORCHESTRATOR.md step 2). To stop that, move "Bash(gh pr merge*)" from allow to deny in .agents/settings.orch.json, or label the PR human-hold.
The orchestrator ticks plan.md boxes and appends divergence notes through a plan-sync PR after your merge. Design decisions go in overview.md, by you only.

Running the checks by hand

.agents/scripts/verify-swift.sh [Package ...]    # swift build + swift test per package; no args = all

Cleanup after agent PRs merge

.agents/scripts/cleanup.sh [--dry-run] [--closed]    # removes worktrees and branches of finished PRs; skips dirty or unmerged work

Things to remember

- Direct pushes to main are for you only; agents go through PRs.
- Spec frozen: edits to overview.md or plan.md while a batch is in flight make agent PRs stale.
- If a worker ended without a PR: read its log. For denied commands, the transcript is ~/.claude/projects/<worktree path, slashes as dashes>/*.jsonl (reviewer under subagents/).
- Launcher hangs waiting: stale lock after a hard kill. rmdir ../omni.worktrees/.setup.lock
- The stop-gate lets a red branch through after 5 blocks. CI is the backstop.
- Models are pinned in run.sh (orchestrator Opus 5.5, workers Sonnet 5.5) and agents.json (reviewer and swift-package-worker Sonnet 5.5).
- Your .claude rule says never touch git unless asked; the Autonomous Mode section in instructions.md covers the agents only.
