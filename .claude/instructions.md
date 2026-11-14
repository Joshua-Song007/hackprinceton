## Code Editing Rules
- Preserve all existing comments exactly (no edits/removals) unless explicitly instructed.
- Keep comments in place when modifying/rewriting code.
- If comments become inaccurate, flag and defer updates to the user.
- never touch git unless directly explicitly asked by user 

## Memory Rules
- All project memory lives in `.claude/` only. No new `.md` files without user approval, except the files `compress` creates in `planHistory/`. Use `overview.md` for source of truth, `plan.md` for build status and checklist, `architecture.md` for file structure and internal package-to-package dependency graph, `currentDev.md` for active tasks, `branchDep.md` for external/third-party Swift package version tracking and pending version bumps across the workspace. `planHistory/` (directory) for full text moved out of `plan.md`, one file per compressed phase; not imported by `CLAUDE.md`; read through `audit`.

## Keyword Rules
-  `stage` is keyword for the plan for the next change (either code or file diff) to be written to currentDev.md; also greps the paths and names in the plan across `planHistory/` with `grep -l` and prints the matching file names in the reply (one line, "no history hits" if none); reads nothing; not written to currentDev.md unless a hit changes the plan
-  `apply` is keyword for the plan written in currentDev.md to be implemented as stated, can still ask questions if you think implementation needs to be altered
-  `compress` is keyword for migrating info from `plan.md` to `planHistory/`, example command "compress phase ___"
  - acts directly (no `stage`/`apply`)
  - steps for the named phase:
    - copy its full text, unedited, into a new file `planHistory/<name>.md` (`phase-NN.md` or `cross-<name>.md`); if the file exists, stop and say so (no overwrite, no merge)
    - replace it in `plan.md` with a short summary of what was built, plus anything still open (OPEN, NOT BUILT, FLAGGED, unscheduled)
    - keep every checklist item as a line with its checkbox and exact file path
    - end with the line: `Full text: planHistory/<file>`
  - before reporting done, check and report any failure: the set of file paths in `plan.md` is unchanged, the checkbox count is unchanged, the moved text appears verbatim in the new file
-  `audit` is keyword for auditing whatever the user directs, e.g. "audit staged", "audit File.swift", "audit <feature>"
  - list the targets: file paths, identifiers (types, functions, consts, config keys), feature names
  - grep each in `plan.md` and `planHistory/`; read the matching items and the code at each site
  - per claim/step: true (lines, strings, counts)? works (failure paths, callers, a test that fails without the change)? breaks a rule or earlier decision?
  - problem found: write to currentDev.md (correction or staged problem); never edit code or other docs
  - reply: targets searched, files read, problems or "no problems"

## currentDev.md Rules
- Use terse bullets only; no prose or explanations.
- Include only task-critical info; no redundancy or extra context. but should include all logic planned for implementation
- task complete = IMMEDIATELY overwrite currentDev.md with: "## Status: Clear\nNo active task." do not wait. do not ask. overwrite on completion regardless of test status.

## plan.md Rules
- If a checklist item's implementation simplifies or diverges from overview.md's stated model, append a short parenthetical note to that item's line (e.g. "(Module.swift stub only; real sources not yet scheduled)") stating the simplification and whether a revisit point is scheduled.
- Never edit the frozen text of a `planHistory/` file; see History Directory.

## History Directory
- `.claude/planHistory/`: one file per compressed phase (`phase-NN.md`, `cross-<name>.md`); `compress` creates it; no other new `.md` file without approval
- top of each file = full text as compressed; frozen, never edited
- `## Later changes` (created at the first entry): dated entries, append-only
  - entry = `### YYYY-MM-DD — title`, a `Paths:` line, then text and item lines (checkbox + exact path)
- new work or a correction on material of a compressed phase (by feature, not by file): append an entry to that phase's file; do not add the item to `plan.md`
- a feature that belongs to no phase: an item in a live `plan.md` section (Cross-Cutting)
- `plan.md`, compressed phase: only the `Built` and `Still open` lines may change; short, dated "(Changed YYYY-MM-DD: ...; see planHistory/<file>)"; checklist lines and the `Full text:` line are frozen
- `compress` never overwrites or merges
