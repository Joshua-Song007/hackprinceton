#!/usr/bin/env bash
# Pre-spawn hook: run before launching a subagent. $1 = file holding the task prompt.
# Blocks (exit != 0) a task that is unscoped, lets the worker touch git or .claude/, or has no done condition.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
crit='This subagent task prompt names one plan.md Phase 8 subsection or one bounded set of files, restricts writes to one directory, forbids git commands and edits to .claude/, and states a concrete done condition (tests or build that must pass).'
"$here/gate.sh" "$crit" 0.75 < "$1"
