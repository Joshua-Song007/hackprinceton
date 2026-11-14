# Autonomous Agent Rules

Applies to agents launched via `.agents/scripts/run.sh` (the laptop orchestrator and its workers) and their subagents. Where these rules conflict with `.claude/instructions.md`, these win (see its `## Autonomous Mode`). Manual sessions never read this file.

## Roles and models
- Orchestrator (`run.sh --orch`): `claude-opus-5-5`. Follows `.agents/ORCHESTRATOR.md` on top of this file. The only role that pushes and uses `gh`.
- Worker (`run.sh`) and every subagent (`reviewer`, `swift-package-worker`): `claude-sonnet-5-5`. Workers commit locally and never push.
- Same for every teammate. Models are pinned in `run.sh` and `agents.json`, never taken from personal settings.

## Read first (read-only unless stated)
- `.claude/overview.md` — design source of truth. No agent edits it.
- `.claude/plan.md` — the spec for your task. One checklist item = one file. Only the orchestrator edits it (through a PR).
- `.claude/architecture.md` — layering rules and forbidden dependency edges. Only the orchestrator edits it (through a PR).

## Scope
- Do only the task in your prompt (usually specific `plan.md` items). No drive-by refactors, no unrelated files. Other agents are working in parallel worktrees.
- Never build Phase 7 or anything the plan does not list.
- Workers never write to `.claude/`, `.agents/`, `.github/` or `CLAUDE.md`. Do not tick `plan.md` boxes or touch `currentDev.md`; the orchestrator ticks boxes after merge.
- New `.md` files are allowed anywhere except the repo root, for notes other agents will read (put them in `docs/agents/`). Never create or edit `overview.md`, `CLAUDE.md` or `.agents/HUMAN.md`.
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
- You work in your own worktree on branch `agent/<laptop>/<slug>`. Commit there freely, in small commits.
- Workers: never push, never use `gh`. Finish with your work committed in the worktree; the orchestrator pushes. If the branch is behind, `git fetch` then `git merge origin/main`.
- Orchestrator: push only `agent/<laptop>/*` branches and open PRs with `gh pr create`. Never push to `main`. No force-push, rebase, reset, or checkout of other branches. Do not merge PRs (provisional; a human merges).
- PR body: never put a line starting with `#` inside the `gh pr create --body "..."` command. The permission check denies it. Use bold labels (`**Completed**`) instead of Markdown headings. The body can still be multi-line.

## Tools and denied commands
- Read, search and list files with the Read, Grep and Glob tools, not shell text tools (`cat`, `wc`, `head`, `find`). The shell allow-list is narrow on purpose.
- A denied command is not a broken shell. Other allowed commands (`.agents/scripts/*`, `swift`, `git`) still work. Try another tool. If the task truly can't proceed, report the exact denied command in your final message and continue with whatever you can still do.
- Run scripts by relative path from the repo root, exactly `.agents/scripts/verify-swift.sh`. The allow-list matches the relative form only: an absolute path or `cd ... && ...` is denied. Also denied: heredocs that write files (use Write/Edit), brace expansion. When you brief a subagent, tell it to use the relative form too.
- Before assuming work is already done, check the checklist item's file contents against `plan.md` and run the verify script. Do not stop on the assumption.

## Subagents
- `reviewer` (read-only): before you finish, run it on your branch. Fix every BLOCKING finding, run it again, and paste its final verdict line in your report. If you disagree with a finding, say why in the report instead of ignoring it.
- `swift-package-worker`: delegate to it only for large multi-item tasks inside one package. For a single checklist item, do the work yourself. (The orchestrator delegates by launching workers with `run.sh`.)

## Done means verified
- Run `.agents/scripts/verify-swift.sh` and see it pass. Do not claim success without running it. A stop-hook enforces this for the packages you changed and everything that depends on them.
- If a check fails and you cannot fix it, say so with the failing output. Never report success on a red check.
- Same failure three times: stop retrying, write what you tried in your report, and move to the next item (the orchestrator labels the issue `needs-human`).

## Report (final message; the orchestrator pastes it into the PR)
- `plan.md` items completed.
- Items not completed, and why.
- Any simplification or divergence from `overview.md` — write the parenthetical note a human should append to that `plan.md` line.
- Provisional defaults you took, each marked `[provisional: needs-tien-review]`.
- Verification commands run and their result, and the reviewer's final verdict line.
