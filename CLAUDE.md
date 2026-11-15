# Project Overview
- **Source of truth (read only when needed, grep sections; not auto-loaded):** .claude/overview.md
- **File breakdown / dep graph:** .claude/architecture.md
- **Build plan (open phases only):** .claude/plan.md
- **Past plan history:** .claude/planHistory/ (one file per compressed phase; grep or `audit`)

# Development Status
- **Current Task:** @.claude/currentDev.md
- **Autonomous Agents:** .agents/AGENTS.md (autonomous runs only; manual sessions skip it)

# Guidelines
- Follow all rules in @.claude/instructions.md
- .claude/overview.md is source of truth and only updated on user request; keep the rest of `.claude/` aligned with it.
