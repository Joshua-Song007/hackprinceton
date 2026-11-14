# Anthropic Agent Playbook (LLM-ingestible)

## Purpose

This file condenses 45 Anthropic sources (engineering posts, research posts, Claude Code docs, product articles; Dec 2024 to Nov 2026) into rules for building an autonomous, multi-agent coding workflow on base Claude Code. The target system is a 4-machine team. Agents keep working until a goal-level Definition of Done (DoD) passes. Caps act as circuit breakers that trigger recovery, and a human is escalated to only as a last resort.

## How to use this file (for Claude)

1. Treat every line marked with a rule ID (for example `ARCH-03`) as an instruction you can apply directly. The `[S#]` tags point to the Source Table at the end. A rule tagged `[synthesis]` is this file's inference, not a statement from a source; weigh it accordingly.
2. When changing the workflow, cite rule IDs in commit messages and PR descriptions (for example "implements LOOP-04, VER-07").
3. Prefer deterministic enforcement (hooks, permissions, tests, CI) over prompt instructions wherever a rule must never be broken (see CFG-01).
4. When two rules conflict, read the Conflicts section before choosing. Do not average them.
5. Numbers appear only where a source states them, tied to the model that source used.
6. Templates are starting points; adapt paths and commands.
7. Re-check this file against the harness every 3 to 6 months and after each major model release. Delete rules that are no longer load-bearing (ARCH-09).

---

## 1. Architecture choice

- ARCH-01: Start with the simplest thing that works: one agent, one prompt, good tools. Add workflow steps or more agents only when an eval shows the simpler version fails. [S6][S18][S12]
- ARCH-02: Use a fixed workflow (chaining, routing, parallelization, orchestrator-workers, evaluator-optimizer) when the steps are predictable. Use an agent loop when the steps cannot be known in advance. [S6]
- ARCH-03: An agent is "an LLM autonomously using tools in a loop". The core loop is gather context, act, verify, repeat. [S18][S4]
- ARCH-04: Use multi-agent systems for high-value work that parallelizes heavily, exceeds one context window, or spans many complex tools. Multi-agent research used about 15x the tokens of chat, and single agents about 4x. [S5]
- ARCH-05: Expect less parallelism in coding than in research. Multi-agent coding pays off when the work splits into many independently verifiable units: failing tests, lemmas, files, packages. [S5][S3][S1]
- ARCH-06: Add a separate planner when a short prompt must become a full spec. Without one, the generator under-scoped. [S12]
- ARCH-07: Add a separate evaluator only when the task sits beyond what the current model does reliably on its own. Inside that boundary the evaluator is overhead. [S12]
- ARCH-08: Decouple the brain (harness plus model) from the hands (sandboxes and tools) and from the session (a durable event log). Then a crashed container or harness is replaceable cattle, not a pet to nurse back. [S2][S37]
- ARCH-09: "Every component in a harness encodes an assumption about what the model can't do on its own." Remove components one at a time and measure the effect, especially after a model upgrade. [S12][S2][S25]
- ARCH-10: At scale, give each agent its own lightweight VM or container. One shared machine hit its limits at about 100 agents, and more than half of those runs had to be stopped or restarted. [S1]
- ARCH-11: Coordinate many agents through general primitives they already know (git branches plus a transactional SQL database) rather than direct messaging. [S1][S3]

## 2. Orchestrator and subagent design

- ORCH-01: Give every delegated task four things: an objective, an output format, guidance on which tools and sources to use, and clear task boundaries. Vague delegations caused duplicated work and gaps. [S5]
- ORCH-02: Encode effort scaling in the orchestrator prompt. Simple: 1 agent, 3-10 tool calls. Comparison: 2-4 subagents, 10-15 calls each. Complex: more than 10 subagents with divided responsibilities. Early systems spawned 50 subagents for simple queries. [S5]
- ORCH-03: Spawn independent subagents in parallel (3-5 at once in [S5]), and have each run tools in parallel. This cut research time by up to 90%. [S5]
- ORCH-04: Delegate when gathering context needs 10 or more files, or when there are 3 or more independent pieces of work. [S27]
- ORCH-05: Do not delegate sequential dependent work, same-file edits, small tasks, or work where agents must talk to each other. Subagents cannot talk to one another; use agent teams for that, which cost more. [S27][S23]
- ORCH-06: Delegating the same task to a subagent does not produce a better answer. Subagents buy parallelism, isolation of noisy output, fewer tools, and a reviewer who has not seen the reasoning. [S31]
- ORCH-07: Keep a handful of well-scoped custom subagents. Too many specialists make automatic delegation unreliable. [S27]
- ORCH-08: Write subagent `description` fields as trigger conditions ("Reviews code for security issues before commits"), not as capabilities ("security expert"). [S27]
- ORCH-09: Have subagents write large outputs to the filesystem and return lightweight references, to avoid a "game of telephone" through the coordinator. Returns of 1,000-2,000 tokens are typical. [S5][S18]
- ORCH-11: Split exploration from editing: a read-only subagent maps a subsystem to a file, then the main agent edits with the full picture. [S25]
- ORCH-12: Let the lead re-plan continuously. In [S1] the lead re-assigned work as results landed, told free helpers "do not wait for me", and let helpers create and claim subtasks in a shared table. [S1]
- ORCH-13: Let task trees grow on demand. A piece too large for one agent gets split into child tasks; [S1] reached 2,418 tasks up to 10 levels deep. [S1]
- ORCH-14: Without an orchestrator, use file locks. Write `current_tasks/<task>.txt` and let git conflicts force a second claimant to pick something else. [S3]
- ORCH-15: Agents misjudge difficulty and give up early. Helpers called 47 of 60 statements infeasible, yet the team proved most of them. Re-test "infeasible" verdicts before accepting them. [S1]
- ORCH-16: Small changes to a lead prompt can change subagent behavior unpredictably. Write prompts as collaboration frameworks (division of labor, approach, effort budget), not as strict scripts. [S5]
- ORCH-17: Put cheap lookups (search, logs, test output) on a small model. Keep code writing and judgment on the main model, because a misread by the small model sends the main model on a paid detour. [S23][S31]

## 3. Context engineering

- CTX-01: Treat context as a finite attention budget, because recall degrades as tokens grow ("context rot"). Find "the smallest possible set of high-signal tokens." [S18]
- CTX-02: Write system prompts at the right altitude: neither brittle hardcoded logic nor vague guidance. Start minimal on the best model, then add instructions only for observed failures. [S18]
- CTX-03: Use a few diverse, canonical examples rather than a laundry list of edge-case rules. [S18]
- CTX-04: Load just in time. Keep identifiers (paths, queries, links) and fetch content with tools. Claude Code is hybrid: `CLAUDE.md` loads up front, and grep/glob fetch the rest. [S18][S25]
- CTX-05: Keep `CLAUDE.md` under 200 lines. Include only what Claude cannot learn by reading the repo, or would otherwise rediscover every session: commands, misleading code, decisions made outside the repo, anything corrected twice. [S31][S24][S23]
- CTX-06: Put path-specific rules in `.claude/rules/` with `paths:`, procedures in skills, and subdirectory conventions in subdirectory `CLAUDE.md` files. An unscoped rule costs as much context as `CLAUDE.md` itself. [S24][S31][S25]
- CTX-07: Use `/clear` between unrelated tasks. After two failed corrections, `/clear` and write one better prompt instead of a third correction. [S31][S29]
- CTX-08: Pick the long-horizon strategy by task. Compaction suits back-and-forth work, structured notes suit milestone-driven development, and sub-agents suit parallel exploration. [S18]
- CTX-09: Tune compaction for recall first, then precision. Preserve architectural decisions, unresolved bugs and implementation details. Clearing tool results is the lightest form. [S18]
- CTX-10: Store memory only for what cannot be read off the environment: strategy, plans, tested rules. Keep the top-level index small; an incorrect note gets carried into every session. [S8][S7]
- CTX-11: Tell strong models what memory is for, not how to write it. Fixed rules such as "record only failures" hurt strong models. [S8]
- CTX-12: When context is near its limit, hand off: summarize the phase to external memory and spawn a fresh agent with a clean context. [S5][S12]
- CTX-13: Keep noisy output out of context. Print a few lines and log the rest to a file, put `ERROR` and the reason on one line so grep finds it, and precompute summaries. [S3]
- CTX-14: Agents are time-blind. Provide a fast sampled test mode (for example 1% or 10% of the suite, sampled deterministically per agent) so they do not burn hours on full runs. [S3]

## 4. Tool design

- TOOL-01: Design tools for agents, not as thin wrappers over APIs. Prefer a few consolidated, workflow-shaped tools (`search_logs`, not `read_logs`; `get_customer_context`, not three getters). [S19]
- TOOL-02: Give each tool a distinct purpose. "If a human engineer can't definitively say which tool should be used ... an AI agent can't be expected to do better." [S18][S19]
- TOOL-03: Namespace tools by service and resource. Choose prefix or suffix naming based on your own evals. [S19]
- TOOL-04: Return high-signal, natural-language fields instead of UUIDs and MIME types. Offer a `response_format` of concise or detailed. [S19]
- TOOL-05: Paginate, filter or truncate large outputs with sensible defaults. Claude Code caps tool responses at 25,000 tokens by default. [S19]
- TOOL-06: Make error messages specific and actionable, not opaque codes or tracebacks. [S19]
- TOOL-07: Write tool descriptions the way you would explain the tool to a new hire, with unambiguous parameter names (`user_id`, not `user`). [S19][S45]
- TOOL-08: Error-proof tools (poka-yoke): require absolute paths, and make `str_replace` refuse unless there is exactly one match. [S45][S6]
- TOOL-09: Evaluate tools with realistic multi-call tasks. Paste the transcripts into Claude Code to refactor the tools, and keep held-out tasks. A tool-testing agent that rewrote descriptions cut task time by 40%. [S19][S5]
- TOOL-10: Once tool definitions grow large (10+ tools or more than 10K tokens), defer loading via tool search and keep the 3-5 most used tools loaded. [S15]
- TOOL-11: For chains of 3 or more dependent calls or large data, have the model call tools from code so that only the final result enters context. [S15][S16]
- TOOL-12: Prefer a CLI with `--help` when one exists. Disable unused MCP servers, because they add tool names and instructions to context. [S31][S23]
- TOOL-13: Give typed-language repos an LSP or code-intelligence plugin so navigation is by symbol rather than by string. [S25][S31]

## 5. Long-running harness and state

- HAR-01: Run an initializer session first. It writes `init.sh`, a progress log, a comprehensive feature list with every item marked failing, and an initial commit. [S13]
- HAR-02: Keep the feature list in JSON, not Markdown, because the model is less likely to overwrite JSON inappropriately. Agents may change only the `passes` field. [S13]
- HAR-03: Work on one feature per session or sprint. Agents that try to one-shot the whole app run out of context mid-feature. [S13][S12]
- HAR-04: End every session in a clean, mergeable state: no major bugs, orderly code, a descriptive commit, and an updated progress file. [S13]
- HAR-05: Start every session with the same routine: `pwd`, read the git log and progress file, pick the highest-priority failing feature, run `init.sh` and a basic end-to-end test, and fix anything broken before starting new work. [S13]
- HAR-06: Keep a running document of failed approaches so later sessions do not repeat them. [S3]
- HAR-07: Make the session log durable and outside the context window. A crashed harness should resume from the last event, not restart. [S2][S5]
- HAR-08: Combine model adaptability with deterministic safeguards: retry logic, regular checkpoints, and telling the agent when a tool is failing. [S5]
- HAR-10: For event-driven or scheduled agents, use a durable inbox deduplicated by source ID, one active worker per inbox, and per-source bookmarks rather than fixed time windows. [S7][S9]
- HAR-11: Make side effects idempotent. Check whether the output already exists, record "posted" only on confirmation, and update bookmarks last. [S9]
- HAR-12: When a source fails, report what could not be read. Never turn a failure into a quiet "nothing happened". [S9]
- HAR-13: Use worktrees (`claude -w`) or separate cloud VMs per parallel task, and list needed gitignored files in `.worktreeinclude`. Commit often; idle cloud VMs are reclaimed. [S31][S10]
- HAR-14: Context resets were essential for Sonnet 4.5 ("context anxiety") but dead weight on Opus 4.5, which ran one continuous session with compaction. Test which your model needs. [S12][S2]

## 6. Goal, Definition of Done and stop conditions

- DOD-01: Before an unattended run, answer five questions. Does it know what done looks like? Can it check its own work? What may it touch? What stops it? Where does the result go, and who signs off? [S31]
- DOD-02: Express "done" as something runnable that returns pass or fail: tests, a build exit code, a linter, a fixture diff, a screenshot compared with a mockup. [S31][S4]
- DOD-03: Expand short goals into a full spec and a list of testable features. Premature "done" happens when later agents see progress and declare victory. [S13][S12]
- DOD-04: Before coding each chunk, negotiate a contract between generator and evaluator: what will be built and how success will be verified. [S12]
- DOD-05: Write tickets as three parts: what is wrong, what done looks like, and how to prove it (for example "run the suite 30 times"). [S10]
- DOD-06: Use `/goal <condition>` for long background runs. A separate model checks the condition after every turn and sends Claude back if items are still open. [S31]
- DOD-07: Enforce done in the harness with a `Stop` hook. Exit 2 (stderr is fed back to Claude) or return `{"decision":"block","reason":...}`. [S31][S27]
- DOD-08: After 8 consecutive Stop-hook blocks with no tool call in between, Claude Code overrides the block and ends the turn. Raise the cap with `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`. [S31]
- DOD-09: Cap spend with `--max-turns` or `--max-budget-usd` (both print mode, `-p`) or a spend limit. A run that hits the turn limit exits with an error. [S31]
- DOD-10: Set a budget cap for scheduled runs at 3-5x normal run cost, then tighten. A cap set too low looks like a quiet day. [S9]
- DOD-11: Do not prompt "keep going, don't be lazy". Current models carry on without it, and the phrasing invites over-work. Give a check, `/goal`, or a Stop hook instead. [S31]
- DOD-12: Escalate stalls on a ladder: raise effort, add a check, switch to a bigger model, and switch back once solved. If xhigh hits the same problem twice, switch models. [S23]
- DOD-13: Have the lead re-test "too hard" verdicts before abandoning work. Automatic time-remaining reminders kept the [S1] lead going (19 sent). [S1]

## 7. Verification and evals

- VER-01: Giving Claude a way to verify its work is the highest-leverage habit. Boris Cherny estimates it makes results 2-3x better. [S32][S31]
- VER-02: Always demand evidence: the command, its output, the screenshot. "All tests pass" alone tells you very little. [S31][S32][S10]
- VER-03: Make the verifier nearly perfect. Otherwise the agent solves the wrong problem, and "easy to see tests pass and assume the job is done, when this is rarely the case." [S3]
- VER-04: Test end to end the way a user would (browser automation such as Puppeteer or Playwright). Unit tests and `curl` missed broken features. [S13][S12]
- VER-05: Separate the worker from the judge. Agents "confidently [praise] the work" they produced, and tuning a standalone skeptical evaluator is far more tractable. [S12]
- VER-06: Expect to tune any QA agent. "Out of the box, Claude is a poor QA agent": it talked itself out of real issues and tested superficially. Tune it by reading its logs and fixing divergences. [S12]
- VER-07: Give evaluator criteria hard thresholds. Fail the sprint and return detailed feedback when any criterion falls below its threshold. [S12]
- VER-08: Grade outcomes, not paths. Step-sequence checks are brittle because agents find valid paths nobody anticipated. [S44][S5]
- VER-09: Choose graders in this order: deterministic where possible, LLM where necessary, humans for calibration. Give the LLM judge a rubric of atomic yes/no claims, an "Unknown" way out, and a different model from the one being tested. [S44][S42][S41]
- VER-10: Start evals with 20-50 tasks drawn from real failures. Early changes have large effects, so small sets are enough. [S44][S5]
- VER-11: A 0% pass rate over many trials usually means a broken task or grader. Write a reference solution that passes every grader. [S44][S42]
- VER-12: Isolate trials in clean environments. Claude used git history from previous trials to gain an unfair advantage. [S44][S38]
- VER-13: Use pass@k when one success is enough, and pass^k when every run must succeed (0.75^3 is about 42%). [S44][S20]
- VER-14: Hillclimb on a train/test split, one change per round. Never paste failures into the prompt. Revert when train rises but test stays flat. [S42]
- VER-15: Read transcripts. Do not take scores at face value. [S44][S19]
- VER-16: Treat infrastructure as an experimental variable. Resource settings moved Terminal-Bench 2.0 scores by 6 points; treat gaps under 3 points with skepticism. [S43]
- VER-17: Turn every incident and revert into an eval case, and re-score the reviewer whenever its prompt, tools or model change. [S32][S26]
- VER-18: Even layered checks miss regressions. A bug in [S26] passed "multiple human and automated code reviews, unit tests, e2e tests, automated verification, dogfooding." Use soak periods and gradual rollout for agent-config changes. [S26]

## 8. Code review pipeline

- REV-01: Review continuously, "like spellcheck", before a PR exists: a runnable check, then a fresh-context subagent review of the diff. [S32][S31]
- REV-02: Run focused pre-PR skills (bug hunt, diff simplifier, end-to-end behavior check) plus `/code-review` and `/security-review`. [S32][S36]
- REV-03: Review against the spec and say "skip style". "A reviewer that's asked to find problems will always find something", and fixing every finding adds needless abstraction. [S31]
- REV-04: Run several finder agents in parallel, verify their findings (by voting or a separate verifier), and drop style, diagnostics and cleanup findings. [S32][S35][S34]
- REV-05: Tag findings Important, Nit or Pre-existing so authors are not blamed for old bugs. [S32]
- REV-06: Every finding must be answered, either by a fix or by a reason. Open bug or security findings block merge. [S32]
- REV-07: Write `REVIEW.md` per code owner. Say what failure looks like in that area, cap nits, list paths to skip, require file-and-line evidence, and start the summary with a count. [S32][S35]
- REV-08: Converge. Cap review rounds at 3, then ask the author to reconsider the approach. Re-review only the new diff, flag whole bug classes, and never repeat findings. In one case, a PR went through more than 50 rounds overnight, and about 59% of the findings flagged code that had been present since the first pass. [S32]
- REV-09: Remember that noise costs more with agent authors: an agent fixes every nit, which means another commit and another round. Measure noise by how authors respond to comments, and by running the reviewer on PRs known to be clean. [S32]
- REV-10: Set risk tiers from the change, not the author. Low risk (docs, flagged additive changes) needs 0 humans once automated checks are green. Medium needs 1, high needs 2. CI workflow files and sensitive paths always need a person. [S32]
- REV-11: An agent approval never fills a human slot. The person who prompted the agent counts as a reviewer. An approval covers one commit, so re-approve after an agent push. [S32]
- REV-12: Watch for myopic adversarial review that drives over-engineering for hypothetical threats. Human review should check intent, not every line. [S21][S31]
- REV-13: Fix recurring reviewer findings at the source: `CLAUDE.md`, a lint rule, or a skill. [S32]
- REV-14: Run review agents nightly over existing code to catch old bugs. [S32]
- REV-15: Give the reviewer full-repo context. In back-testing, Opus 4.7 caught a bug with full repo context that Opus 4.6 missed. [S26]
- REV-16: A review with no findings does not mean the code is correct or secure. [S35]

## 9. Security, sandboxing and permissions

- SEC-01: Contain first, then steer. "The deterministic boundary is what gets hit when everything probabilistic misses." [S38]
- SEC-02: Run unattended agents in a sandbox or VM that isolates both the filesystem and the network. Sandboxing cut permission prompts by 84%. [S40][S38]
- SEC-03: Keep credentials out of the sandbox entirely. Use a proxy or vault that injects them, and a git token wired in at init. A successful prompt injection then has nothing to steal. [S2][S37][S10][S9]
- SEC-04: Per-action approval does not scale: users approved about 93% of prompts. Use auto mode or containment instead of approval prompts. [S39][S38][S28]
- SEC-05: Put "never" rules in `deny` permissions, `PreToolUse` hooks or managed settings, not in prompts. Deny rules hold in every mode, including `bypassPermissions`. [S31][S24]
- SEC-06: Use `bypassPermissions` / `--dangerously-skip-permissions` only in a disposable container. [S31]
- SEC-07: Know the edges of permission rules. A `Read` deny catches `cat .env` but not a script that opens the file. A `WebFetch` deny does not stop `curl` unless the sandbox is on. [S31]
- SEC-08: An egress allowlist is a capability grant. Every function reachable on an allowed domain is attack surface; data was exfiltrated through api.anthropic.com using an attacker's key. [S38]
- SEC-09: Treat tool output as untrusted even from trusted tools (a poisoned README, for example). Inspect returns with a small classifier. [S38][S39]
- SEC-10: Do not treat subagent output as more trusted than raw tool results. [S38]
- SEC-11: Treat persistent state (`CLAUDE.md`, memory, the state directories of scheduled agents) as a memory-poisoning target. [S38]
- SEC-12: A user-delivered malicious prompt beat model-layer defenses: credential exfiltration succeeded 24 of 25 times. Only egress control and filesystem boundaries stopped it. [S38]
- SEC-13: Prefer battle-tested primitives (hypervisors, seccomp, gVisor). Anthropic's custom proxy was the component that failed. [S38]
- SEC-14: For many-agent runs, layer defenses: DB and git as the only channels, own-branch pushes, unprivileged DB roles with time limits, gateway-tagged identity, plus real-time and offline action monitors. [S1]
- SEC-15: Protect `main` with branch rules that unattended tasks cannot bypass, and watch the first few runs. [S31][S11]
- SEC-16: In headless auto mode a classifier block denies that one action and Claude carries on. In interactive mode, 3 consecutive or 20 total blocks pause the session. [S31][S39]
- SEC-17: Audit third-party skills, MCP servers and plugins before installing. Remote tools can change after you approve them. [S17][S38]

## 10. Cost and efficiency

- COST-01: Every turn resends the conversation, so "the cheapest turn is the one you don't need". Checks and batched tool calls cut turns. [S23]
- COST-02: Keep the prompt cache warm. At 90% cache hits the [S23] example cost $1.62 instead of $11.20. Switching models, toggling MCP servers, long pauses and compaction all break the cache. [S23]
- COST-03: Output, including thinking, costs 100x a cache read on Opus 5.5. Effort changes thinking, so it moves the bill. [S23]
- COST-04: Default to medium effort. Use high when medium stalls or the work is edge-case heavy, low for mechanical edits, and xhigh or max only where you have measured a gain. [S23][S22][S31]
- COST-05: Effort reduces failures from missed edge cases but does not fix a wrong approach. [S22]
- COST-06: Before raising effort, add a check. A test costs one turn; more effort adds thinking to every turn. [S23]
- COST-07: Agent teams use about 7x the tokens of a standard session (in plan mode). Keep teams small and shut teammates down when they finish. [S23]
- COST-08: Run `/claude-api prompt-audit` or `/doctor prompt-audit` to remove ritual instructions written for older models. One benchmark saw a further 9% cost cut. [S23][S31]
- COST-09: Measure with `/usage`: cache share, output versus input, total input versus conversation size. As a baseline, the average is about $13 per developer per active day. [S23]
- COST-10: A harness can cost more than 20x a solo run and still win; the solo run's core feature was broken. [S12]

## 11. Claude Code features and configuration

- CFG-01: Use the deterministic form for anything that must always or never happen: hooks, deny rules, managed settings, tests, CI, a Stop hook, branch protection. Use the non-deterministic form (prompt, `CLAUDE.md`, skills, `/goal`) for judgment. [S31][S24]
- CFG-02: If you keep adding emphasis to a `CLAUDE.md` line and it is still missed, move it to a hook. If a hook only encodes a preference, delete it. Keep the enforced set small. [S31]
- CFG-03: Only `command`, `http` and `mcp_tool` hooks are deterministic; `prompt` and `agent` hooks use model judgment. Add `onFailure: "block"` when a crashed hook must still stop the action. [S31][S24]
- CFG-04: Use a `PostToolUse` hook on `Edit|Write` for formatters, and `PreToolUse` with exit 2 to block protected paths. [S31]
- CFG-05: A Stop hook can also reflect on the session and propose `CLAUDE.md` updates. A SessionStart hook can load module-specific context or install dependencies in cloud sessions. [S25][S10]
- CFG-06: Skills hold procedures. Only the name and description load until a skill is invoked. Set `disable-model-invocation: true` for side-effecting skills such as releases. [S31][S17][S24]
- CFG-07: Output styles replace the default coding instructions, including verification habits, unless you set `keep-coding-instructions: true`. [S24]
- CFG-08: For headless workers: `claude -p` with `--allowedTools`, `--permission-mode dontAsk`, `--max-turns`, and `--output-format json`. `--bare` skips hooks and `CLAUDE.md`, so do not use it on runs that need hooks. [S31]
- CFG-09: Use `--permission-mode auto` with `-p` for classifier-gated autonomy. Keep `"$defaults"` in `autoMode` lists, and put `autoMode` in `~/.claude/settings.json`; project settings ignore it. [S31]
- CFG-10: For off-laptop work, use routines (schedule, API or GitHub-event triggers; daily caps of 5 on Pro, 15 on Max, 25 on Team/Enterprise) or `claude --cloud`. Cloud VMs push only to their own branch. [S11][S10]
- CFG-11: `/autofix-pr` pushes fixes for failing checks and review comments, but it does not see merge conflicts. [S10]
- CFG-13: Subagent definitions live in `.claude/agents/`. Restrict tools (for example `tools: Read, Grep, Glob`) to get a reviewer the harness prevents from editing. Set `model:` per subagent or `CLAUDE_CODE_SUBAGENT_MODEL` globally. [S31][S23]
- CFG-14: Subagents can nest up to five levels deep. Dynamic workflows keep orchestration state in script variables rather than in the context window. [S24]
- CFG-15: Checkpoints (`/rewind`) do not cover Bash-made changes. Use them alongside git, not instead of it. [S14][S31]
- CFG-16: Never put secrets in `CLAUDE.md`; treat it as publicly shareable. [S29]

---

## Anti-patterns

| Anti-pattern | Why it fails | Do instead |
|---|---|---|
| One agent one-shots a whole app | Runs out of context mid-feature and leaves undocumented half-work [S13] | Feature list plus one feature per session (HAR-01..03) |
| A later agent declares victory after seeing progress | No external definition of done [S13] | JSON feature list, DoD checks, Stop hook |
| Self-grading | Agents praise mediocre work [S12] | Separate, tuned, skeptical evaluator |
| A reviewer told to "find problems" with no scope | Always finds something, which leads to over-engineering [S31][S21] | Review against the spec, skip style, verify findings |
| Unlimited agent-to-agent review rounds | More than 50 rounds; mostly old code re-flagged [S32] | Round cap of 3, diff-only re-review |
| "Never do X" written in `CLAUDE.md` | Prompts are followed "almost" always; injection and long sessions break them [S24] | Deny rule, PreToolUse hook, managed setting |
| "Keep going / don't be lazy" | Causes over-work [S31] | A runnable check, `/goal`, a Stop hook |
| Architecture tours in `CLAUDE.md` | Claude reads the repo; the lines cost every turn [S31] | Pointers and gotchas only |
| Vague delegation ("research X") | Duplicated work and gaps [S5] | Objective, format, tools, boundaries |
| 50 subagents for a simple query | Wasted tokens [S5] | Effort-scaling rules |
| Full test suite after every small change | Timeouts and context pollution [S25][S3] | Scoped commands, sampled fast mode |
| Shared mutable table edited by parallel agents | Overwrites; facts dropped to 72% [S8] | One owner per artifact, append-only logs |
| Credentials inside the sandbox | Exfiltration via injection [S38][S2] | Proxy or vault outside |
| Approve-every-action oversight | 93% rubber-stamped [S39] | Containment plus auto mode plus intervention points |
| Trusting a green dashboard | Tests can pass while the job is undone [S3][S26] | Evidence, end-to-end checks, soak periods |
| Keeping harness parts after a model upgrade | Dead weight and cost [S2][S12] | Ablate one component at a time |

## Decision tables

### Structure

| Situation | Choose | Source |
|---|---|---|
| Well-scoped task, a few files, steps clear | Single session; add a check | [S6][S31] |
| Wide read (10+ files) before editing | Read-only Explore/mapping subagent, then edit in main | [S27][S25] |
| 3+ independent pieces, no shared files | Parallel subagents or worktree sessions | [S27][S31] |
| Pieces must talk to each other mid-task | Agent teams (about 7x tokens) or a shared DB/git coordination | [S27][S23][S1] |
| Many independently verifiable units (tests, lemmas) | Many sandboxed agents, a task table, git merge job, objective grader | [S3][S1] |
| Short prompt must become a big product | Planner, then generator, then evaluator, with a contract per chunk | [S12] |
| Mechanical change across many files | `/batch`, or a `claude -p` loop at low effort | [S31][S23] |
| Recurring or event-driven work | Routines, or a cloud session with inbox, bookmarks and idempotent output | [S11][S7][S9] |

### Where an instruction goes

| Instruction type | Location | Source |
|---|---|---|
| Must always or never happen | Hook, deny rule, managed setting | [S31][S24] |
| Facts needed every session (commands, gotchas) | Root `CLAUDE.md` (under 200 lines) | [S31][S24] |
| Applies to some paths | `.claude/rules/*.md` with `paths:` | [S24] |
| Multi-step procedure | Skill (`disable-model-invocation` if it has side effects) | [S24][S31] |
| Noisy side task, summary only | Subagent | [S24][S27] |
| Per-run tone or format | `--append-system-prompt` | [S24] |
| Personal preference | `CLAUDE.local.md`, user-level files | [S31][S24] |
| Review priorities per area | `REVIEW.md` | [S32][S35] |

### Effort and model

| Work | Effort / model | Source |
|---|---|---|
| Brainstorm, sketch, rename | low | [S22][S23] |
| Routine feature work | medium (default on Opus 5.5) | [S23][S22] |
| Brownfield bug, edge cases, verification pass | high or xhigh | [S22][S31] |
| Hard unattended work (end-to-end build, security hunt) | max, or a bigger model (Fable 5.1) | [S22][S23] |
| Lookups, logs, search subagents | Haiku or Sonnet | [S23][S31] |
| Same failure twice at xhigh | Switch to a bigger model, then switch back | [S23] |

---

## Templates

### T1. CLAUDE.md snippet (derived from [S31][S29][S32][S25])

```markdown
# Commands
- Install: <cmd>
- Run one test file: <cmd> path/to/test
- Fast sampled suite (agents): <cmd> --fast   # deterministic 10% sample
- Full suite / typecheck / lint: <cmd> / <cmd> / <cmd>
# Done means
- Feature status lives in feature_list.json; change only "passes".
- Show the command and its output as evidence before claiming done.
# Conventions not visible in code
- <decision made outside the repo, e.g. "use src/lib/errors.ts helpers">
- src/legacy/ is live; do not copy its patterns.
# Gotchas
- Integration tests need DATABASE_URL (see .env.example).
# Delegation policy
- Code review always goes to the read-only `reviewer` subagent against SPEC.md.
- Broad searches go to Explore; return summaries under 2,000 tokens.
```

### T2. Reviewer subagent `.claude/agents/reviewer.md` (derived from [S31][S32][S12])

```markdown
---
name: reviewer
description: Reviews a diff against the spec it was built from. Use after implementing a feature and before opening or merging a PR.
tools: Read, Grep, Glob, Bash(git diff *), Bash(<test cmd> *)
model: <main model>
---
You are reviewing code you did not write and have not seen being written.
Inputs: SPEC.md (or the sprint contract), the diff, REVIEW.md.
1. For every requirement and listed edge case, state implemented / missing / untested,
   citing file:line as evidence. Do not infer from names.
2. Report only gaps that affect correctness, security, or the contract. Skip style.
3. Tag each finding Important | Nit | Pre-existing. Report each bug class once, not each instance.
4. Do not repeat findings from earlier rounds. After round 3, recommend
   reconsidering the approach instead of listing more findings.
5. Be skeptical: if you find an issue, do not talk yourself out of it. If unsure, say "Unknown".
6. Start the summary with the count of Important findings; say plainly when there is nothing to fix.
```

### T3. Definition-of-Done checklist (derived from [S31][S13][S12][S10][S32])

```markdown
## DoD: <goal id>
- [ ] Spec exists (SPEC.md) and was expanded into feature_list.json; all items "passes": true
- [ ] Each chunk had a contract (what is built, how verified) agreed before coding
- [ ] Deterministic checks green: build, typecheck, lint, full test suite (not the sampled one)
- [ ] End-to-end check run as a user would (browser/CLI), evidence attached
- [ ] Fresh-context review: 0 open Important findings; security review: 0 open findings
- [ ] Every finding resolved with a fix or a reason
- [ ] Repo clean: committed, mergeable, progress file updated, no stubs or display-only features
- [ ] PR body: Testing, Risk tier, How to revert
- [ ] Risk-tier approvals satisfied (agent approval never fills a human slot)
```

### T4. Progress-state schema (derived from [S13][S3][S9][S1])

```text
feature_list.json      [{ "id": "F-012", "priority": 1, "description": "...",
                          "verify": "<command or e2e steps>", "passes": false }]
claude-progress.md     append-only: timestamp, session id, feature, what changed,
                          commands run + result, next step, blockers
failed-approaches.md   append-only: approach, why it failed, evidence
current_tasks/<id>.txt lock file: owner, started_at (git conflict = taken)
runs/<date>-<id>.md    run record: status (running|posted|maybe-posted|failed),
                          budget used, sources unreadable
```

[synthesis] For more than a few agents, move `current_tasks/` and the notes into a transactional DB table (announce, assign, notes, subtasks, landed), as in [S1].

### T5. Stop hook logic (derived from [S31][S27]; persistence policy is [synthesis])

`.claude/settings.json`:

```json
{ "hooks": { "Stop": [ { "hooks": [ { "type": "command",
  "command": ".claude/hooks/dod-gate.sh" } ] } ] } }
```

`.claude/hooks/dod-gate.sh`:

```bash
#!/usr/bin/env bash
# Reads hook JSON on stdin. Blocks stop until DoD checks pass.
input=$(cat)
active=$(echo "$input" | jq -r '.stop_hook_active // false')
state=.claude/state/stop-blocks; mkdir -p .claude/state
n=$(cat "$state" 2>/dev/null || echo 0)
fail=""
<typecheck cmd> >/tmp/tc 2>&1 || fail+="typecheck failed:\n$(tail -20 /tmp/tc)\n"
<test cmd>      >/tmp/t  2>&1 || fail+="tests failed:\n$(tail -30 /tmp/t)\n"
jq -e 'all(.[]; .passes)' feature_list.json >/dev/null || \
  fail+="features still failing: $(jq -r '[.[]|select(.passes|not).id]|join(",")' feature_list.json)\n"
if [ -z "$fail" ]; then echo 0 > "$state"; exit 0; fi
echo $((n+1)) > "$state"
if [ "$n" -ge 5 ]; then   # circuit breaker [synthesis]
  echo "Stop blocked $n times. Write a blocker report to claude-progress.md, then stop." >&2
  echo 0 > "$state"; exit 0
fi
printf "Not done. Fix these, show evidence, then stop again:\n%b" "$fail" >&2
exit 2
```

Notes: exit 2 plus stderr feeds the reason back to Claude [S31]. The JSON form `{"decision":"block","reason":"..."}` is equivalent [S27]. [S27] recommends exiting when `stop_hook_active` is true to prevent infinite loops. This template uses a counter instead, so that continuation persists until its own breaker or the built-in 8-block cap fires [S31] (see Conflict C5).

### T6. Delegation brief (derived from [S5][S27])

```text
Objective: <one outcome>. Not in scope: <boundaries>.
Inputs: <paths/refs>. Tools/sources to prefer: <list>. Effort budget: <N tool calls>.
Output: write full results to <path>; return <=<N> words: findings, evidence paths, open questions.
Done when: <check>. Run in parallel with: <sibling tasks>; do not touch <files>.
```

### T7. Headless worker invocation (derived from [S31])

```bash
claude -p "$(cat brief.md)" --permission-mode dontAsk \
  --allowedTools "Read,Edit,Bash(git add *),Bash(git commit *),Bash(<test cmd> *)" \
  --max-turns 40 --max-budget-usd 5 --output-format json -w "task-$ID"
```

Try it on three tasks first, fix the prompt, then scale [S31].

---

## Conflicts and tensions between sources

- C1. Architecture map in `CLAUDE.md`. [S29] recommends a directory tree and an architecture summary. [S31] lists "describe your architecture and file layout" as advice to stop following. [S25] adds a map only "when the directory structure doesn't do the work." [synthesis] Default to no map; add a one-line-per-folder map only for unconventional layouts.
- C2. Context resets versus compaction. [S13] and the early [S12] harness relied on resets because of Sonnet 4.5's "context anxiety". Later work on Opus 4.5 dropped them, and [S2] calls them "dead weight". Decide by testing your model.
- C3. Multi-agent for coding. [S5] says coding has fewer truly parallelizable tasks and agents coordinate poorly in real time. [S3] (16 agents) and [S1] (1,000 agents) succeeded where work split into independent, objectively graded units. Parallelize only along verifiable seams.
- C4. Telling agents to keep going. [S31] says "keep going / don't be lazy" causes over-work. [S3]'s loop prompt asked agents to keep going until perfect, and [S1] sent 19 encouraging time reminders and notes that human encouragement prevents early stopping. [synthesis] Do not nag about effort; push back on premature "infeasible" verdicts with evidence and time budgets.
- C5. Stop-hook persistence. [S27]'s guard exits when `stop_hook_active` is set, which allows one continuation. [S31] relies on the harness cap of 8 consecutive blocks. An always-continue goal needs a counter and a recovery path, not an unbounded loop.
- C6. LLM judges. [S4] calls an LLM judge "generally not a very robust method". [S5] found one judge call with a single prompt the most consistent. [S44] recommends an isolated judge per dimension. [S42] and [S41] want atomic claims and a judge model different from the tested model. Use programmatic graders first, and validate any judge against human labels.
- C7. Iteration count. [S12]'s design evaluator ran 5-15 iterations to good effect, and the best result sometimes came from a middle iteration. [S32] caps review at 3 rounds because rounds stopped finding new bugs. Iterate on subjective quality; converge on correctness review.
- C8. Small models for subagents. [S31] suggests Haiku for simple subagents. [S23] limits small models to lookups, never code, and notes that the `opusplan` alias does the opposite; measure before choosing.
- C9. Merge gating at scale. [S32] uses a merge queue that re-runs checks against main. [S21] found that a global-lock merge queue does not work at agent scale (30,000+ merges a day) and moved to post-merge and pre-deploy testing. Scale decides.
- C10. Human sign-off versus full autonomy. [S28] warns against mandating per-action approval, and [S32] lets low-risk changes merge with zero humans. Yet [S31], [S32], [S34] and [S35] keep a person accountable for merges of risky changes, and [S32] notes there are no automatic circuit breakers yet that tighten approval when revert rates rise. A fully autonomous loop should end at a PR plus evidence for medium and high risk changes.
- C11. Effort at max. [S22] recommends max for fully autonomous hard problems. [S31] says max overthinks ordinary tasks, and [S23] says use xhigh or max only where a gain has been measured.
- C12. Rules for strong models. [S8] found that fixed memory rules hurt strong models, and [S23] removed "ritual instructions". [S13] used strongly worded rules ("It is unacceptable to remove or edit tests"), and JSON as a structural guard, to protect the feature list. Prefer structural enforcement (file format, hooks) over emphatic wording.
- C13. Evaluator everywhere versus only at the edge. [S32] reviews every PR. [S12] found the evaluator is overhead for tasks within the model's solo ability. Match review depth to risk tier (REV-10) and task difficulty.

---

## Integration notes for the 4-machine workflow [synthesis]

- M1 (orchestrator): owns SPEC.md, feature_list.json, the task table and risk tiers; re-plans after each landed result (ORCH-12); writes T6 briefs.
- M2/M3 (workers): headless `claude -p` per task in its own worktree or container (T7), sandboxed with credentials outside (SEC-02/03); the T5 Stop hook enforces task-level DoD; push to own branches only.
- M4 (verifier/polisher): fresh-context review (T2), end-to-end and security checks, round cap (REV-08), goal-level DoD (T3); findings return to M1 as tasks.
- Circuit breakers: turn and budget caps per run (DOD-09), the Stop-hook counter (T5), a review-round cap (REV-08) and the auto-mode denial thresholds (SEC-16). Each trips to the recovery ladder: re-plan, raise effort, add a check, switch model, split the task, and finally escalate a blocker report to the human.
- Measure human time per merged change and keep revert/incident rate as the guardrail [S32].

---

## Source table

Fully read = prose read end to end this turn from the saved copy in `sources/`. "yes*" = prose complete, but code blocks, figures or tables on that page were not captured by the extractor, so code samples were not read.

| ID | Title | URL | Date | Takeaway | Fully read |
|---|---|---|---|---|---|
| S1 | Safely scaling multi-agent teams with Claude Fable 5.2 | https://claude.dev/blog/safely-scaling-multi-agent-teams-with-fable-5-2/ | 2026-11-09 | 1,000 sandboxed agents coordinate via git plus SQL under layered monitors | yes |
| S2 | Scaling Managed Agents with stable interfaces | https://www.anthropic.com/research/managed-agents | 2026-04-08 | Decouple brain, hands and session; harness parts go stale | yes |
| S3 | Building a C compiler with parallel Claudes | https://www.anthropic.com/research/building-c-compiler | 2026-02-05 | Parallel agents need near-perfect verifiers and context-light test output | yes |
| S4 | Building agents with the Claude Agent SDK | https://claude.com/resources/articles/building-agents-with-the-claude-agent-sdk | 2025-09-29 | Loop: gather context, act, verify; rules-based feedback is best | yes* |
| S5 | How we built our multi-agent research system | https://www.anthropic.com/research/multi-agent-research-system | 2025-06-13 | Orchestrator-worker; delegation briefs; tokens explain most variance | yes |
| S6 | Building effective AI agents | https://www.anthropic.com/research/building-effective-agents | 2024-12-19 | Simplest solution first; five workflow patterns | yes |
| S7 | Building always-on agents | https://claude.com/resources/articles/building-always-on-agents | 2026-11-13 | Inbox, timers, memory, permissions, outbox | yes |
| S8 | The components of agent memory | https://www.anthropic.com/research/components-of-agent-memory | 2026-11-06 | Store only what the environment cannot tell you; dreaming fixes notes | yes |
| S9 | Building effective agent automations | https://claude.dev/blog/building-effective-agent-automations/ | 2026-10-08 | Idempotent output, bookmarks, budget caps, loud failures | yes |
| S10 | Claude Code in the cloud | https://claude.dev/blog/claude-code-in-the-cloud/ | 2026-10-06 | Fresh VM per task, token outside VM, ticket = done plus proof | yes |
| S11 | Introducing routines in Claude Code | https://claude.com/resources/articles/introducing-routines-in-claude-code | 2026-04-14 | Scheduled, API and GitHub-triggered unattended runs | yes |
| S12 | Harness design for long-running apps | https://www.anthropic.com/research/harness-design-long-running-apps | 2026-03-24 | Planner, generator, skeptical evaluator with contracts | yes* |
| S13 | Effective harnesses for long-running agents | https://www.anthropic.com/research/effective-harnesses-for-long-running-agents | 2025-11-26 | Initializer, JSON feature list, progress file, one feature per session | yes* |
| S14 | Enabling Claude Code to work more autonomously | https://www.anthropic.com/news/enabling-claude-code-to-work-more-autonomously | 2025-09-29 | Checkpoints, subagents, hooks, background tasks | yes |
| S15 | Introducing advanced tool use | https://www.anthropic.com/research/advanced-tool-use | 2025-11-24 | Tool search, programmatic calling, tool examples | yes* |
| S16 | Code execution with MCP | https://www.anthropic.com/research/code-execution-with-mcp | 2025-11-04 | Tools as code APIs cut context by 98.7% in the example | yes* |
| S17 | Equipping agents with Agent Skills | https://www.anthropic.com/research/equipping-agents-for-the-real-world-with-agent-skills | 2025-10-16 | Progressive disclosure; audit skills | yes |
| S18 | Effective context engineering for AI agents | https://www.anthropic.com/research/effective-context-engineering-for-ai-agents | 2025-09-29 | Smallest high-signal context; compaction, notes, subagents | yes |
| S19 | Writing effective tools for AI agents | https://www.anthropic.com/research/writing-tools-for-agents | 2025-09-11 | Workflow-shaped tools, evaluated and refined by agents | yes* |
| S20 | The "think" tool | https://www.anthropic.com/research/claude-think-tool | 2025-03-20 | Scratchpad for policy-heavy sequential tool use; prefer extended thinking now | yes* |
| S21 | Redesigning source control at Anthropic | https://www.anthropic.com/research/redesigning-source-control | 2026-10-13 | Agent-scale merges; humans say "no" and review intent | yes |
| S22 | Using Claude Code: Spending your effort | https://claude.dev/blog/spending-your-effort/ | 2026-09-25 | Effort buys edge-case testing, not a better approach | yes |
| S23 | What a task costs on Opus 5.5 | https://claude.dev/blog/what-a-task-costs-on-opus-5-5/ | 2026-09-25 | Turns and cache dominate cost; effort and model ladder | yes* |
| S24 | Steering Claude Code | https://claude.com/resources/articles/steering-claude-code-skills-hooks-rules-subagents-and-more | 2026-06-18 | Which instruction mechanism, by load time, compaction and authority | yes |
| S25 | How Claude Code works in large codebases | https://claude.com/resources/articles/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start | 2026-05-14 | Harness order; layered CLAUDE.md; LSP; review config every 3-6 months | yes |
| S26 | An update on Claude Code quality reports | https://www.anthropic.com/research/april-23-postmortem | 2026-04-23 | Regressions passed every check; per-model evals and soak periods | yes |
| S27 | How and when to use subagents | https://claude.com/resources/articles/subagents-in-claude-code | 2026-04-07 | Delegation signals; Stop-hook guard; when not to delegate | yes* |
| S28 | Measuring AI agent autonomy in practice | https://www.anthropic.com/research/measuring-agent-autonomy | 2026-02-18 | Oversight means being able to intervene, not approving everything | yes* |
| S29 | Using CLAUDE.md files | https://claude.com/resources/articles/using-claude-md-files | 2025-11-25 | Start simple; workflows; no secrets | yes |
| S30 | How Anthropic teams use Claude Code | https://claude.com/resources/articles/how-anthropic-teams-use-claude-code | 2025-07-24 | Autonomous test-and-iterate loops; PR automation | yes |
| S31 | Best practices for Claude Code (docs) | https://code.claude.com/docs/en/best-practices | undated | Deterministic vs prompt rules; checks; unattended five questions | yes |
| S32 | How the Claude Code team does code review | https://claude.dev/blog/solving-code-review-at-anthropic/ | 2026-10-15 | Continuous review, verified findings, risk tiers, round caps | yes |
| S33 | Code Review is now generally available | https://claude.com/resources/articles/code-review-is-now-generally-available | 2026-10-15 | Faster reviews; Quick/Standard/Deep | yes |
| S34 | Code Review for Claude Code | https://claude.com/resources/articles/code-review | 2026-03-09 | Agent team per PR; 16% to 54% substantive comments | yes |
| S35 | Code Review (docs) | https://code.claude.com/docs/en/code-review | undated | Find, verify, rank, post; never approves | yes |
| S36 | Automate security reviews with Claude Code | https://claude.com/resources/articles/automate-security-reviews-with-claude-code | 2025-08-06 | `/security-review` plus a PR Action | yes |
| S37 | Operate Claude Managed Agents inside your perimeter | https://claude.com/resources/articles/self-hosted-claude-managed-agents | 2026-11-12 | Self-hosted; credentials out, allowlist, full OTel record | yes |
| S38 | How we contain Claude across products | https://www.anthropic.com/research/how-we-contain-claude | 2026-05-25 | Environment containment first; egress is the real boundary | yes |
| S39 | How we built Claude Code auto mode | https://www.anthropic.com/research/claude-code-auto-mode | 2026-03-25 | Classifier replaces approvals; deny-and-continue | yes* |
| S40 | Making Claude Code safer with sandboxing | https://www.anthropic.com/research/claude-code-sandboxing | 2025-10-20 | Filesystem plus network isolation; 84% fewer prompts | yes |
| S41 | Building strong safety evaluations | https://www.anthropic.com/research/building-strong-safety-evaluations | 2026-11-13 | Grader validity, uncertainty reporting, sample floors | yes |
| S42 | Automating eval design and hillclimbing | https://claude.dev/blog/automating-eval-design-and-hillclimbing/ | 2026-09-28 | Train/test hillclimb, one change per round | yes |
| S43 | Infrastructure noise in agentic coding evals | https://www.anthropic.com/research/infrastructure-noise | 2026-02-05 | Resources shift scores by up to 6 points | yes |
| S44 | Demystifying evals for AI agents | https://www.anthropic.com/research/demystifying-evals-for-ai-agents | 2026-01-09 | Outcome grading, 20-50 real tasks, read transcripts | yes* |
| S45 | Claude SWE-bench performance | https://www.anthropic.com/research/swe-bench-sonnet | 2025-01-06 | Minimal scaffold; error-proof tool specs | yes* |
