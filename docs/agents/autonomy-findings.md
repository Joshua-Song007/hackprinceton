# Autonomous run investigation and proposal

## Evidence and limits

Read-only GitHub queries used `gh issue list --state all --limit 200`, `gh pr list --state all --limit 100`, and the paginated REST issue-comments endpoint. All returned activity was dated November 14, 2026; comments span 04:53:11–20:31:48 UTC. This is an observed activity window, not a verified definition of “last night.” PR-review submissions and inline review threads are not included in the REST issue-comment count. There were no committed logs/*.json; the available sibling worktree logs directory was empty. No actual token billing, per-role turn counts, historical idle durations or complete session count can be recovered.

| Observation | Count |
|---|---:|
| PRs opened / merged / closed unmerged | 77 / 75 / 2 |
| Issues returned / permission-related issues | 86 / 28 |
| Issue/PR conversation comments | 366 |
| Characters in those comment bodies | 478,608 (~119,652 tokens at chars/4) |
| Comments on Agent status #11 / Plan sync #24 | 55 / 35 |
| Comments mentioning attempt / VERIFIED / VERDICT | 76 / 125 / 30 |
| Comments mentioning handoff / blocked / takeover | 7 / 17 / 6 |
| Comment authors | Mungbeanbeanie 142; jacob-e-lee 87; tienvu-lol 72; Joshua-Song007 65 |

Keyword counts overlap; verification comments are not all waste. Chatter-to-merge ratio is 4.88 comments per merged PR. Actual implementation commit count and time lost to duplicate work were not established. Seventy-five merges contradict an interpretation of “almost no output”; merge count alone does not measure useful shipped behavior.

## Context measurements

Character estimates, not tokenizer measurements; taken before changes:

| File | Characters | Estimated tokens |
|---|---:|---:|
| CLAUDE.md | 630 | 157 |
| .claude/instructions.md | 6,934 | 1,733 |
| .claude/overview.md | 27,945 | 6,986 |
| .claude/architecture.md | 27,367 | 6,841 |
| .claude/plan.md | 80,765 | 20,191 |
| .agents/AGENTS.md | 15,853 | 3,963 |
| .agents/ORCHESTRATOR.md | 27,515 | 6,878 |
| .agents/LOOP.md | 21,399 | 5,349 |
| .agents/agent-playbook.md | 51,885 | 12,971 |

Root imports total roughly 35.8k tokens. AGENTS “Read first” explicitly demands overview, plan and architecture (~34k) in addition to its ~4k rules. Reviewer/worker agent definitions also request broad reads. The current run.sh already sparsely excludes CLAUDE.md, so automatic import of all those files cannot be asserted for this launcher. Reading every legacy document would explain a 50–60k context, but there is no surviving trace proving each historical session did that. Cache-read tokens are not equivalent in price to fresh input tokens; actual savings must be measured with the new telemetry.

## Credible mechanisms

1. Each loop cycle invokes run.sh --orch, starting a new Opus session (60-turn cap). Four planners can launch four workers each, plus integrator/reviewer sessions. No recoverable logs prove the actual session count.
2. Full-document rereading is mandated for workers and reviewers despite sparse checkout hiding root imports.
3. Protocol demands repeated status, launch, diagnosis, CI, review, merge and plan-sync reporting. Four planners plus takeover multiply coordination responsibility.
4. Twenty-eight permission issues are direct evidence of execution friction; exact idle minutes cannot be reconstructed.
5. Results are overwritten at `<slug>.json`, losing nightly role/session history. Quiet-cycle skipping, quota backoff and takeover already exist, so they are preserved as mechanisms, not invented benefits.
6. Existing checks can pass empty source/test sets; Stop hook eventually allows exit after repeated failures. Neither is a sufficient merge gate.

## Proposal, impact order

1. One Opus planner, deterministic worker polling/claiming/publication; one Sonnet issue/session, 35-turn cap.
2. Validated self-contained briefs and stable generated context prefix; no worker/reviewer full-plan reading. Retain the human plan intact to avoid losing specifications.
3. Git lease/CAS ownership with label/assignee mirrors; GitHub label edits alone are not atomic. Include exact-file conflict exclusion, fencing and stale recovery.
4. Actual build/test/lint evidence with nonzero test counts; one independent SHA-bound reviewer, three-round ceiling; merge only with nonempty passing CI and pinned head.
5. Durable per-session usage, shared heartbeats, conservative quota cooldown, bounded retry/handoff/blocking and global STOP.
6. Preserve maintain.sh, takeover-era scripts and Tools/jev-hooks. Exclude V2 PRs from legacy maintenance merging.
7. Required operational additions: stop old loops before deployment; server-side main protection and distinct GitHub identities; isolated automation clones without production credentials; offline regression CI.

## Implementation boundaries

The V2 runtime is an opt-in deployment after merging both stacked PRs, not a live migration of claims. Legacy rules/scripts remain explicitly archived. No GitHub branch protection or machine credentials were changed. No live Claude sessions were spent to validate the runtime. Provider-wide subscription remaining quota/reset is not available from CLI JSON: shared usage is locally observed session totals, reset ETA is labeled estimated, and LIMIT_WINDOW/WORKER_TOKEN_LIMIT require calibration. Runtime sessions retain detailed per-model usage, but subagent turn totals are not separately exposed by the CLI result.
