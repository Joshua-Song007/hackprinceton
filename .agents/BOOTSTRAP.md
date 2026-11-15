# Bootstrap: start the agent loop on this laptop

> Archived V1 bootstrap. For V2, follow `docs/agents/autonomy-setup.md` instead. Do not launch an orchestrator on every laptop. `start.sh` now defaults to worker mode; legacy bootstrap requires explicit `PEAR_LEGACY=1`.

For a manual Claude Code session that a human opened on one of the four laptops and told "follow `.agents/BOOTSTRAP.md`". Autonomous agents launched by `run.sh` ignore this file.

The human's prompt to follow this file is the explicit request for the git commands below (`clone`, `fetch`, `pull --ff-only`, `switch main`). Nothing else: never commit, push, stash or discard the human's own work. Run every step in order, one command per Bash call, and stop at the first failure. Report what failed and what only the human can do. Steps marked **HUMAN** cannot be automated: tell the human the exact command and wait for "done".

## 0. Before any laptop starts (Tien, once)
- The `.agents/` changes are merged to `origin/main`. `run.sh` builds every worktree from `origin/main`, so local-only changes are invisible to the loop.
- The lane table in `.agents/ORCHESTRATOR.md` is confirmed (its OS column still says "confirm").
- Start the two Macs first: a Windows laptop's PR that touches Swift paths waits for a Mac's `MAC-VERIFIED` comment.

## 1. Identify the laptop
1. `uname -s`: `Darwin` means Mac. Anything else (`MINGW…`) means Windows, which runs the non-Swift lane only.
2. Laptop name: `$PEAR_LAPTOP` if set; otherwise the GitHub handle in lowercase (`gh api user --jq .login`). It must appear in the `ORCHESTRATOR.md` table. If `gh` is not logged in yet, or the name is not in the table, ask the human.
3. The table's OS for that name must match `uname -s`. On a mismatch, stop and ask.

## 2. Get a clean clone outside synced folders
1. Run `git rev-parse --show-toplevel`. If the path contains `OneDrive`, `iCloud`, `Dropbox` or `Library/Mobile Documents`, clone fresh: `git clone "$(git remote get-url origin)" ~/hack/pear`. Do every later step in `~/hack/pear`, and tell the human the old clone is left as it is.
2. Run `git status --short`. If it lists changes, stop. Show them to the human and ask them to commit and push, or put the changes aside, themselves. Uncommitted work in their own lane gets reassigned by the loop (seen on the first Mac run with PearRuntime 1.5).
3. `git switch main`, then `git pull --ff-only`.

**Shortcut:** `.agents/scripts/start.sh <laptop>` does steps 3, 4 and 5 below in one go (setup, checks, start in tmux under `caffeinate -i` on a Mac, or in its own Git Bash window with a keep-awake helper on Windows). Add `--integrator` to start the tooling integrator loop afterwards (`INTEGRATOR.md`). The **HUMAN** items still need a person.

## 3. Install and log in
1. `.agents/scripts/setup.sh <laptop>`: installs whatever is missing (Homebrew, tmux, gh, jq, node, python, Rust on Mac; gh, jq, node, python, Rust and the MSVC C++ build tools through winget on Windows).
2. **HUMAN** items that setup reports:
   - `gh` login: in this session's prompt, type `! gh auth login -h github.com` (HTTPS, repo scope). A fine-grained token limited to this repo is safer: orchestrators push and merge with it.
   - `claude` login, if setup says it is not logged in: start `claude` once and sign in. `setup.sh` and `loop.sh` both check this with a one-cent Haiku call.
   - Mac only: Xcode 16+ from the App Store, and the `xcode-select --install` dialog.
   - Windows only: set sleep to Never while plugged in.
   - Windows only: approve the admin prompt when setup installs the MSVC C++ build tools (Rust needs them), then open a new Git Bash so `cargo` is on PATH.
   - Mac only: keep the laptop on power with the lid open. `caffeinate -i` stops idle sleep, not lid sleep.
3. Run `.agents/scripts/setup.sh <laptop> --check` again until it prints `READY`.

## 4. Verify before the first cycle
Each command must pass:
1. `gh repo view --json viewerPermission --jq .viewerPermission` prints `ADMIN`, `MAINTAIN` or `WRITE`.
2. `.agents/scripts/check-docs.sh` prints `check-docs: OK`.
3. `.agents/scripts/verify-nonswift.sh`, then `.agents/scripts/verify-backend.sh` (passes at once while the backend does not exist).
4. Mac only: `.agents/scripts/verify-swift.sh` (builds and tests every package; takes minutes).
5. `git fetch origin`, then `git show origin/main:STOP`. This must fail with "does not exist". Do the same with `STOP-<laptop>`. If either file exists, stop and report: only Tien removes it.

## 5. Start the loop so it outlives this session
The log goes to `<clone>.worktrees/logs/loop.out`, next to the clone (for `~/hack/pear` that is `~/hack/pear.worktrees/logs/loop.out`). First run `mkdir -p ../pear.worktrees/logs`, using the clone's folder name in place of `pear`.

- **Mac:** start it in a detached tmux session:
  `tmux new-session -d -s pear-loop "caffeinate -i env PEAR_LAPTOP=<laptop> .agents/scripts/loop.sh 2>&1 | tee -a ../pear.worktrees/logs/loop.out"`
  Then `tmux ls` must list `pear-loop`.
- **Windows:** this session's shell may kill background jobs when the call ends, so the loop needs its own window. If this session has a terminal-panel tool (a "run in terminal" tool), use it to open a Git Bash tab in the clone and run the command below. Otherwise give the human the command to paste into a new Git Bash window opened in the clone:
  `env PEAR_LAPTOP=<laptop> .agents/scripts/loop.sh 2>&1 | tee -a ../pear.worktrees/logs/loop.out`

`loop.sh` checks `jq`, `claude`, the gh login, write access and the settings file first. If it exits with `preflight failed: ...`, fix what it names (back to step 3) and start it again.

## 6. Confirm the first cycle, then hand back
A cycle takes several minutes. Check once after it ends; do not poll in a loop.
1. `../pear.worktrees/logs/loop.out` has no `preflight failed` and no `NOTIFY: permission denied` line.
2. `../pear.worktrees/logs/orch.log` ends with the orchestrator's report and a `-- usage:` line.
3. Report to the human: the laptop name, OS, lane, setup and verify results, where the loop runs (tmux `pear-loop` or the Git Bash window), and the controls below.

## Controls (tell the human)
- **Watch:** `tmux attach -t pear-loop` (detach with Ctrl-B, then D), or the log at `../pear.worktrees/logs/loop.out`. On GitHub: open PRs, the `Agent status` issue, and `[permission] ...` issues (a denied command; if it is legitimate, add an allow rule to `.agents/settings.orch.json`).
- **Steer:** comment `DECISION: ...` on an issue; the `human-hold` label on a PR or issue stops agents from touching it.
- **Plan ticks:** the orchestrator lists `plan.md` ticks in the `Plan sync` issue, and the human applies them (agents never edit `.claude/`).
- **Stop all laptops:** add a file named `STOP` to `main` (the web UI works from a phone). **Stop one laptop:** add `STOP-<laptop>`. The loop exits at its next cycle, and workers in flight finish first.
- **Hard stop here:** `tmux kill-session -t pear-loop` on a Mac, or close the window on Windows. This kills workers mid-task; their worktrees stay in `../pear.worktrees/`.
- **After merges:** `.agents/scripts/cleanup.sh --dry-run`, then run it without `--dry-run`.
- **Is it alive?** Mac: `tmux ls` lists `pear-loop`. Windows: only the Git Bash window and `tail -f ../pear.worktrees/logs/loop.out` tell you. No `pear-loop` session means the loop exited on its own (STOP, `STATUS: done` or a failed preflight): read the tail of `loop.out`.
- **Restart after STOP or done:** delete the `STOP` / `STOP-<laptop>` file on `main`, check that `git show origin/main:STOP` now fails, rerun step 5.
- **Update the scripts on a running laptop:** `loop.sh` and `run.sh` run from the clone's own checkout and the loop never pulls it, and pulling under a running script can corrupt it. Add `STOP-<laptop>`, wait for the loop to exit, `git pull --ff-only` in the clone, delete the STOP file, restart.
- **Folder names:** `pear.worktrees` in these docs is `<clone folder name>.worktrees`, next to the clone.
