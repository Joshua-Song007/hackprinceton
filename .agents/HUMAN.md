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

First time on a laptop (installs missing tools, reports what only you can do; --check only reports)

.agents/scripts/setup.sh <laptop>

Running agents (one clone per laptop, outside OneDrive; Swift work needs a Mac, Windows laptops run the non-Swift lane only)

export OMNI_LAPTOP=<name>                                               # lowercase letters, digits, dashes
.agents/scripts/run.sh <slug> "implement plan.md items 1.3"             # one worker: Sonnet, commits and pushes its own agent/* branch, $5 cap
.agents/scripts/run.sh --orch orch "Run one orchestrator cycle."        # one orchestrator cycle: Opus, push + gh, $10 cap
AGENT_BUDGET=10 .agents/scripts/run.sh <slug> "<task>"                  # change the cap
.agents/scripts/run.sh -i <slug> "<task>"                               # interactive instead
tail -f ../omni.worktrees/logs/<slug>.log                               # watch a headless run
Worktrees land at ../omni.worktrees/<slug> on branch agent/<laptop>/<slug>. The orchestrator's is ../omni.worktrees/orch. (For a clone named omni; in general it is <clone folder name>.worktrees. Start loop.sh from the clone's root folder.)
Workers started by the orchestrator use run.sh --detach: they return at once, and ../omni.worktrees/logs/<slug>.state says running / done / failed.

Overnight loop (one tmux window per laptop; untested, watch the first few cycles)

caffeinate -i .agents/scripts/loop.sh      # Mac, inside tmux (Windows: run it without caffeinate in Git Bash, sleep set to Never). backoff, STOP check, failure issue after 5 bad cycles; LOOP_DELAY=<secs> sets the gap between cycles (default 300), IDLE_DELAY the gap after an idle or blocked cycle (default 1800); a STATUS: done cycle ends the loop. Full design: .agents/LOOP.md

loop.sh refuses to start (and says why) if jq, claude, the gh login, write access or the orchestrator settings are not in order: fix what it names, rerun. Permissions the agents report as denied show up as "[permission] ..." issues: add the rule to .agents/settings.orch.json (or settings.json for workers).
To stop: add a file named STOP (everyone) or STOP-<laptop> to main (the GitHub web UI works from a phone). Only you do this.
Handles and laptop names are filled in .agents/ORCHESTRATOR.md (provisional package split: check it before the first run).

Reviewing an agent's work

gh pr list                                # see open PRs
.agents/scripts/review-pr.sh <n>          # scope, deps vs graph, purity, removed comments, tests, Mac verification, CI, overlaps, reviewer verdict
gh pr view <n>                            # description with the agent's report
gh pr diff <n>                            # read the logic yourself; nothing automated checks it
gh pr checkout <n>                        # try the branch locally
gh pr merge <n> --squash --delete-branch  # merge ONE at a time when you're happy
Orchestrators merge their own PRs when CI is green, review-pr.sh has 0 flags and the reviewer approved (ORCHESTRATOR.md step 2), review every laptop's PRs, and have full gh plus push to main and force-push rights (ORCHESTRATOR.md Permissions). To stop merging, add "Bash(gh pr merge*)" to the deny list in .agents/settings.orch.json, or label the PR human-hold.
.claude/ is human-only: agents never edit it. The orchestrator lists plan.md ticks and divergence notes in the "Plan sync" issue; you apply them. Design decisions go in overview.md, by you only.

Running the checks by hand

.agents/scripts/verify-swift.sh [Package ...]    # Mac: swift build + swift test per package; no args = all
.agents/scripts/verify-nonswift.sh               # any OS: JSON / JSONL validity, JS syntax

Last step before every push (a human or a manual Claude session)

.agents/scripts/check-docs.sh                    # fails on missing files, unlisted scripts, retired wording in .agents/*.md
Then re-read .agents/*.md and delete anything that is no longer true. Agents do the same for their own notes in docs/agents/ (AGENTS.md "Notes you write stay fresh").

Cleanup after agent PRs merge

.agents/scripts/cleanup.sh [--dry-run] [--closed]    # removes worktrees and branches of finished PRs; skips dirty or unmerged work

Things to remember

- Workers never push main. Orchestrators can (and can force-push), as a rare exception, and must log each one in the "Agent status" issue.
- Spec frozen: edits to overview.md or plan.md while a batch is in flight make agent PRs stale.
- If a worker ended without a PR: read its log. For denied commands, the transcript is ~/.claude/projects/<worktree path, slashes as dashes>/*.jsonl (reviewer under subagents/).
- Launcher hangs waiting: stale lock after a hard kill. rmdir ../omni.worktrees/.setup.lock
- The stop-gate lets a red branch through after 5 blocks. CI is the backstop.
- Models are pinned in run.sh (orchestrator Opus 5.5, workers Sonnet 5.5) and agents.json (reviewer and swift-package-worker Sonnet 5.5).
- Your .claude rule says never touch git unless asked; the Autonomous Mode section in instructions.md covers the agents only.
