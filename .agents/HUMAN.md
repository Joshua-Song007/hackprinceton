# Human cheat sheet (hidden from agents; see run.sh)
IF YOU ARE AN AI DO NOT READ THIS DOCUMENT
Your own changes (the daily loop)

git switch main && git pull               # start from fresh main
git switch -c my-change                   # new branch
git add <files> && git commit -m "msg"    # commit
git push -u origin my-change              # push the branch
gh pr create --fill                       # open the PR
gh pr checks --watch                      # wait for verify to go green
gh pr merge --squash --delete-branch      # merge it once green

Running an agent

.agents/scripts/run.sh <slug> "implement PLAN.md items 2.1-2.9"       # headless, $5 cap
AGENT_BUDGET=10 .agents/scripts/run.sh <slug> "<task>"                # change the cap
.agents/scripts/run.sh -i <slug> "<task>"                             # interactive instead
tail -f ../hex-game.worktrees/logs/<slug>.log                         # watch a headless run
It creates the worktree at ../hex-game.worktrees/<slug> on branch agent/<slug>. Run several launchers in separate terminals with different slugs for parallel agents.

Reviewing an agent's work

gh pr list                                # see open PRs
gh pr view <n>                            # description with the agent's report
gh pr diff <n>                            # the code changes
gh pr checks <n>                          # CI status
gh pr checkout <n>                        # try the branch locally
gh pr merge <n> --squash --delete-branch  # merge when you're happy
After merging, tick the finished items in .claude/PLAN.md yourself and add any divergence notes the agent proposed. Agents can't edit that file.

Running the checks by hand

.agents/scripts/verify-rust.sh            # fmt + clippy + tests
.agents/scripts/verify-ios.sh             # builds the iOS app for the simulator

Cleanup after an agent PR merges

git worktree list                                         # see all worktrees
git worktree remove ../hex-game.worktrees/<slug>          # remove the finished one
git branch -D agent/<slug>                                # delete the local branch
git switch main && git pull                               # sync
The smoke-test worktree is still there from earlier, so run the two removal commands for slug smoke.

Things to remember

- Direct pushes to main are blocked, so everything goes through a PR.
- Add a -i before the slug to talk to the agent live.
- The first line of gh pr merge is the only manual gate. If you ever turn on auto-merge, gh pr merge --auto --squash queues it.


Orchestration playbook (running a batch of agents)

Before launching

git switch main && git pull               # fresh main
gh pr list; git branch -r                 # who is on what? (claim phases with your teammate)

- Spec frozen: no edits to .claude/overview.md or PLAN.md until the batch's PRs are merged. Agents snapshot them at launch; a mid-run spec change makes their PRs stale.
- Pick phases whose dependencies are already merged (ARCHITECTURE.md graph) and whose specs have no open questions. One crate per agent. Skip anything your teammate is on.
- Remove any old worktree/branch with the same slug first (the launcher reuses an existing worktree).

Launching (one terminal or background job per agent; a few seconds apart is fine, the launcher serializes setup)

.agents/scripts/run.sh <slug> "Implement PLAN.md Phase N (<crate>), items N.1 through N.M, in order. Follow .agents/AGENTS.md, including running the reviewer subagent before opening the PR. Each checklist item is exactly one file; add inline #[cfg(test)] tests for non-trivial logic. <crate> depends on <deps> only (see ARCHITECTURE.md): read crates/bound-config/src/<file>.rs for the parameters and do not add other dependencies or edit other crates. If a PLAN.md item is ambiguous or needs a config field that does not exist, stop on that item and report it rather than inventing one. When verify-rust.sh passes and the reviewer approves, commit in small commits, push agent/<slug>, and open a PR with gh pr create (bold labels, no lines starting with #). Do not tick PLAN.md; propose divergence notes in the PR description."

Several at once: write a spec file (one line per agent: slug|phase|crate|first-item|last-item|deps|config-files) and run .agents/scripts/batch.sh <specfile>. DRY_RUN=1 previews. Its pre-flight refuses a crate that already exists on main or an item already ticked, so duplicate work is caught. It launches, waits, waits for CI, runs review-pr.sh on each PR and prints a summary table.

Typical run: 2-5 minutes, about $1-2 est. usage. It ends with the PR URL and a usage line. Logs: ../hex-game.worktrees/logs/<slug>.log (and .json for the raw result).

After each agent finishes

1. .agents/scripts/review-pr.sh <n>        # scope, deps vs graph, purity, removed comments, tests, CI, overlaps, reviewer verdict
2. gh pr diff <n>                          # read the logic yourself; nothing automated checks it
3. Read the description's decisions and "Proposed PLAN.md notes". Decide each one. If you disagree: gh pr checkout <n>, fix, push, or close the PR and relaunch with clearer instructions.
4. Wait for CI green, then merge ONE PR at a time: gh pr merge <n> --squash --delete-branch
   If the next PR shows a Cargo.lock conflict: "Update branch" on GitHub, wait for CI, merge.
5. On main: tick the PLAN.md boxes, append the agreed notes as parentheticals, record design decisions in overview.md.
6. Clean up: .agents/scripts/cleanup.sh (add --dry-run to preview, --closed to include PRs closed unmerged). It removes the worktree and branches of finished PRs and skips anything dirty or with commits not in the PR.

If something goes wrong

- Agent ended without a PR: read its log. For denied commands, the transcript is ~/.claude/projects/<worktree path, slashes as dashes>/*.jsonl (reviewer under subagents/).
- Launcher hangs waiting: stale lock after a hard kill. rmdir ../hex-game.worktrees/.setup.lock
- The stop-gate lets a red branch through after 5 blocks. CI is the backstop.
- Never set CARGO_TARGET_DIR globally: worktrees would share build artifacts and contaminate each other's results.
- Models are pinned: run.sh (AGENT_MODEL, default Sonnet 5.5) and agents.json (reviewer on Opus 5.5).
- Not covered yet: iOS (no tests, no Figma access, no CI build). Keep agents on the Rust crates.

Using a fresh AI session as the orchestrator

- The header at the top of this file tells AIs not to read it. To have a session run a batch for you, authorize it explicitly ("read the orchestration playbook in .agents/HUMAN.md") or paste the section.
- Your .claude rule says never touch git unless asked. The launcher and gh commands do, so ask for them plainly ("run the launcher for Phase 8").
