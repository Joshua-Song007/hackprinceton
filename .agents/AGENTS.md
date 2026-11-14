# Autonomous Agent Rules

Applies to agents launched via `.agents/scripts/run.sh` (the laptop orchestrator and its workers) and their subagents. Where these rules conflict with `.claude/instructions.md`, these win (see its `## Autonomous Mode`). Manual sessions never read this file.

## Roles and models
- Orchestrator (`run.sh --orch`): `claude-opus-5-5`. Follows `.agents/ORCHESTRATOR.md` on top of this file. The only role that uses `gh`, with full GitHub access (PRs, reviews, comments, issues, merges), and it may push any branch including `main` and force-push, locally from its own laptop (Tien's decision, see `ORCHESTRATOR.md` Permissions).
- Integrator (`run.sh --integrator`): `claude-opus-5-5` with a big budget while building tooling, `claude-sonnet-5-5` with a small one while maintaining it. Follows `.agents/INTEGRATOR.md`. Edits only `.agents/scripts/**`, `.agents/README.md`, `.github/workflows/**` and `docs/agents/`; pushes only its own `agent/*` branches.
- Worker (`run.sh`) and every subagent (`reviewer`, `swift-package-worker`): `claude-sonnet-5-5`. Workers commit and push their own `agent/<laptop>/<slug>` branch and nothing else; no `gh`.
- Same for every teammate. Models are pinned in `run.sh` and `agents.json`, never taken from personal settings.

## Work like a software engineer, in the open on GitHub
GitHub is the shared workspace: the issue is the unit of work, the PR is the delivery, comments are the conversation. Every agent follows these standards.
- **Issue** (written by the orchestrator, body via the Write tool): `**Goal**` (the problem or capability), `**Acceptance criteria**` (checkable statements), `**How to verify**` (exact commands), `**Files**` (the plan.md paths), `**Depends on**` (issues or items).
- **Commit:** `type(scope): imperative summary` with type `feat`, `fix`, `test`, `docs`, `refactor`, `chore` or `ci`; a body that says why, and `Refs #<issue>`. Small commits.
- **PR body:** `**Summary**` (what and why), `**Changes**` (file by file), `**Verification**` (the commands you ran with the real tail of their output), `**Risks and provisional defaults**`, `**Out of scope**` (follow-ups), a `Refs #<issue>` line, and the reviewer's `VERDICT:` line. No `#` headings (the permission check denies them).
- **Evidence:** a claim that something works, passes or is fixed carries the command and its output. No evidence means not done.
- **Scope:** do what the issue says. Something else you notice becomes a new issue (label `follow-up`) with a clear title, never a bigger PR.
- **Talk on GitHub** (orchestrators; workers report in their final message because they have no `gh`): comment on the issue when work is claimed, when a PR opens, when CI goes red or green (with the diagnosis), when review finishes, and when it merges (what changed and the evidence).
- **Diagnose before acting:** read the log, find the root cause, write it down (symptom, cause, fix plan) in a comment, then act on that plan.

## Permissions
- Every orchestrator, on all four laptops, has the same rights from `.agents/settings.orch.json`: full `gh` (PRs, reviews, comments, issues, labels, API), any `git push` including `main` and force-push, merging, reviewing every laptop's PRs. They run locally on their own laptop. Rules for using them are in `.agents/ORCHESTRATOR.md` Permissions.
- Workers get the narrower `.agents/settings.json`: own `agent/*` branch only, no `gh`.
- The human starting an autonomous loop fixes permissions first: `gh auth login` (repo scope, write access to the repo), `.agents/scripts/setup.sh <laptop>` until READY, and any rule an agent reports as denied. `loop.sh` checks this at startup and refuses to loop until it passes.
- A denied command is a permission gap for the human to fix, never something to work around. Open a `[permission] <command>` issue (the orchestrator) or report the exact command (a worker), then move on.

## Read first (read-only)
- `.claude/` is human-only. Every agent, orchestrator included, may read it and none may create, edit, rename or delete anything in it (`overview.md`, `plan.md`, `architecture.md`, `instructions.md`, `planHistory/`, all of it). To propose a change, put it in your report or open a `needs-tien` issue.
- `.claude/overview.md` — design source of truth.
- `.claude/plan.md` — the spec for your task. One checklist item = one file.
- `.claude/architecture.md` — layering rules and forbidden dependency edges.
- `.agents/LOOP.md` cites rule IDs (for example `DOD-08`); their full text is in `.agents/agent-playbook.md`. Read it only when you need the reason behind a rule, and never edit it.

## Scope
- Do only the task in your prompt (usually specific `plan.md` items). No drive-by refactors, no unrelated files. Other agents are working in parallel worktrees.
- Never build Phase 7 or anything the plan does not list.
- No agent, orchestrator included, writes to `.claude/`, `.agents/`, `.github/` or `CLAUDE.md`. Do not tick `plan.md` boxes or touch `currentDev.md`; a human ticks boxes after merge.
- Items under `Apps/**` (OmniStudio, OmniCompanion) and any `.xcodeproj` have no automated build check yet: workers do not take them. If your task names one, stop and say so in your report.
- New `.md` files are allowed anywhere except the repo root and the protected places above, for notes other agents will read (put them in `docs/agents/`). Never create or edit `overview.md`, `CLAUDE.md` or `.agents/HUMAN.md`.
- No new third-party dependencies. If a task needs one, take no action on it and put the need in your report.
- If the plan contradicts `overview.md` or `architecture.md`, stop that item and report it. Do not guess.
- If a requirement is merely ambiguous, take the smallest reversible default, keep going, and list it in your report as `[provisional: needs-tien-review]`.

## Code
- Preserve all existing comments exactly. Keep comments in place when rewriting code.
- OmniCore is pure: Foundation only, no I/O, sockets or device APIs. Time and randomness enter as arguments.
- Hardware-blind: OmniRuntime, OmniScript and Games never depend on OmniSim or OmniBridge. Respect the dependency graph and forbidden edges in `architecture.md`; they are enforced in each `Package.swift`.
- Swift 6 strict concurrency: UI types and view models are `@MainActor`; anything crossing actors is `Sendable`. No `@unchecked Sendable` or `nonisolated(unsafe)` without a comment saying why.
- No force unwraps (`!`), `try!` or `as!`. Use `guard`, `if let` or a typed default.
- Tests live in `Packages/<Pkg>/Tests/<Pkg>Tests/` as named in `plan.md`; match the framework that package's existing tests use. Non-trivial logic ships with tests. Add the `testTarget` to the package's `Package.swift` if it has none; make no other manifest change.

## Git
- You work in your own worktree on branch `agent/<laptop>/<slug>`; the name is in your system prompt (or `git branch --show-current`). Commit there freely, in small commits.
- Commit all your work (`git add -A`, then `git commit`) before running the reviewer or the verify scripts: the reviewer diffs against `origin/main` and sees only committed files. Use plain `git commit -m "short message"`, one `-m` per paragraph; no `$(...)`, heredoc or `-F`.
- Push after the first green verify and again after the review, so a turn or budget cap cannot lose finished work. On a merge conflict, fix the files with Edit, `git add`, `git commit`; if stuck, `git merge --abort` and report it, naming the conflicting files and what each side is doing: the orchestrator turns that report into a `conflict` issue for the other owner.
- Workers: when `verify-swift.sh` (or `verify-nonswift.sh`) is green and the reviewer has approved, push your own branch yourself: `git push -u origin agent/<laptop>/<slug>`. Push again after every fix round. Never push any other branch, never push `main`, never force-push or delete remote branches, never use `gh` (the orchestrator opens and merges PRs from your pushed branch). If the branch is behind, `git fetch` then `git merge origin/main`.
- Orchestrator: the normal flow is PRs from `agent/<laptop>/*` branches. Pushing to `main` and force-pushing are permitted but exceptional; the rules for them are in `.agents/ORCHESTRATOR.md` Permissions. Merge only your own PRs, under the conditions in step 2 there.
- PR body: never put a line starting with `#` inside the `gh pr create --body "..."` command. The permission check denies it. Use bold labels (`**Completed**`) instead of Markdown headings. The body can still be multi-line.

## Platform: macOS vs Windows
- `uname -s` prints `Darwin` on a Mac. Anything else (Git Bash on Windows prints `MINGW…`) is a no-Mac laptop. Two laptops are Macs and two are Windows.
- A no-Mac laptop never creates, edits or deletes Swift: `*.swift`, `Package.swift`, anything under `Packages/` or `Apps/`, `*.xcodeproj`, `*.xcworkspace`, or `Schema/usis.schema.json` (`run.sh` denies the Edit tools on these). It cannot build or test Swift either, so do not install or fake a toolchain. Its work is the non-Swift lane (see `ORCHESTRATOR.md`), checked by `.agents/scripts/verify-nonswift.sh`.
- If Swift or the schema ends up changed from a no-Mac laptop anyway (a Bash write, an unavoidable one-line fix), the PR gets the label `needs-mac-verify` and is never merged until an agent running on a Mac has run `.agents/scripts/verify-swift.sh` on that exact head commit and posted a PR comment `MAC-VERIFIED <full head sha>` with the output. Any new push needs a new verification. The macOS CI job is an extra check, not a replacement.
- A Mac agent posts `MAC-VERIFIED` only after running `verify-swift.sh` itself on that commit, never from CI output or from another agent's claim.

## Tools and denied commands
- Read, search and list files with the Read, Grep and Glob tools, not shell text tools (`cat`, `wc`, `head`, `find`). The shell allow-list is narrow on purpose.
- One command per Bash call: no `&&`, `||`, `;` or `|`, because every part is checked on its own and one unlisted part denies the whole call. Write files with the Write tool, never `echo >` or `mkdir && ...`. A denied call does not mean all of Bash is denied: split it and retry the allowed parts.
- A denied command is not a broken shell. Other allowed commands (`.agents/scripts/*`, `swift`, `git`) still work. Try another tool. If the task truly can't proceed, report the exact denied command in your final message and continue with whatever you can still do.
- Run scripts by relative path from the repo root, exactly `.agents/scripts/verify-swift.sh`. The allow-list matches the relative form only: an absolute path is denied, and `cd ... && ...` breaks the one-command-per-call rule. Also denied: heredocs that write files (use Write/Edit), brace expansion. When you brief a subagent, tell it to use the relative form too.
- Before assuming work is already done, check the checklist item's file contents against `plan.md` and run the verify script. Do not stop on the assumption.

## Subagents
- Self-review on request: when the orchestrator's prompt asks for a review (or another round), run the `reviewer` on your branch again, fix every BLOCKING finding, push, and report the new verdict line. You may also run it on your own whenever you doubt your work.
- `reviewer` (read-only): before you finish, run it on your branch. Fix every BLOCKING finding, run it again, and paste its final verdict line in your report. If you disagree with a finding, say why in the report instead of ignoring it.
- `swift-package-worker`: delegate to it only for large multi-item tasks inside one package. For a single checklist item, do the work yourself. (The orchestrator delegates by launching workers with `run.sh`.)

## Done means verified
- On a Mac run `.agents/scripts/verify-swift.sh`; on any laptop run `.agents/scripts/verify-nonswift.sh` for non-Swift work; see it pass. Do not claim success without running it. On a Mac a stop-hook enforces this for the packages you changed and everything that depends on them; on Windows it checks only JSON and JS. After 5 blocks the hook lets you stop, so your report must state the real result.
- `verify-swift.sh` can take several minutes in a cold worktree. Call it with the Bash tool's `timeout` set to 600000 (the 120000 default kills it midway, as happened on the first Mac run). If it still does not finish, say so in your report: never describe a push as verified without a green run.
- If a check fails and you cannot fix it, say so with the failing output. Never report success on a red check.
- Same failure three times: stop retrying, write what you tried in your report, and move to the next item (the orchestrator labels the issue `needs-human`).

## Notes you write stay fresh
Last step before every push: re-read each `.md` you created or edited (your notes in `docs/agents/`), correct anything that is no longer true, delete stale or duplicated lines, and put the date on the note. A note that no longer matches the code is worse than no note. The reviewer checks this, and `.agents/scripts/check-docs.sh` runs in CI.

## Report (final message; the orchestrator pastes it into the PR)
- `plan.md` items completed.
- Items not completed, and why.
- Any simplification or divergence from `overview.md` — write the parenthetical note a human should append to that `plan.md` line.
- Provisional defaults you took, each marked `[provisional: needs-tien-review]`.
- Verification commands run and their result, and the reviewer's final line copied verbatim (`VERDICT: APPROVE` or `VERDICT: CHANGES NEEDED`).
