"""Game instructions for the Deep Agents runtime: the check behind the authoring agent's tool, the AGENTS.md that briefs it,
and the agent itself. The field names and LIMITS mirror Web/packages/pear-runtime/src/instructions.ts (INSTRUCTION_LIMITS);
tests/test_instructions.py compares the numbers so the two cannot drift apart."""
import json
from pathlib import Path
from string import Template

from deepagents import FilesystemPermission, create_deep_agent
from deepagents.backends import FilesystemBackend
from langchain.agents.middleware import TodoListMiddleware
from langchain_core.tools import StructuredTool

LIMITS = {"short": 300, "long": 2000, "id": 40, "setup": 20, "roles": 12, "phases": 20, "steps": 30}
FIELDS = {"title", "summary", "space", "setup", "players", "gestures", "devices", "roles", "phases", "win", "lose"}
GESTURES = ["tap", "doubleTap", "flick", "squeeze", "pinch"]
DEVICE_KINDS = ["phone", "watch", "airpods"]
DEVICE_MODES = ["player", "free", "passed"]
ROLE_KINDS = ["player", "ref"]
MAX_PROBLEMS = 8


def _is_int(x) -> bool:
    return isinstance(x, int) and not isinstance(x, bool)


def check_instructions(data) -> str | None:
    """None when `data` is a well-formed instructions object, else the problems as one sentence for the model to fix."""
    if not isinstance(data, dict):
        return "instructions must be an object"
    problems: list[str] = []

    def bad(message: str) -> None:
        problems.append(message)

    def text(value, path: str, limit: int, required: bool = False) -> None:
        if not isinstance(value, str):
            bad(f"{path} must be text")
        elif len(value) > limit:
            bad(f"{path} is {len(value)} characters, the limit is {limit}")
        elif required and not value.strip():
            bad(f"{path} must not be empty")

    def items(value, path: str, limit: int) -> list:
        if not isinstance(value, list):
            bad(f"{path} must be a list")
            return []
        if len(value) > limit:
            bad(f"{path} has {len(value)} entries, the limit is {limit}")
        return value[:limit]

    extra = sorted(set(data) - FIELDS)
    if extra:
        bad(f"unknown field(s): {', '.join(extra)}")
    for key, limit in (("title", LIMITS["short"]), ("summary", LIMITS["long"]), ("space", LIMITS["long"]), ("win", LIMITS["long"]), ("lose", LIMITS["long"])):
        if key in data:
            text(data[key], key, limit)
    for i, line in enumerate(items(data["setup"], "setup", LIMITS["setup"]) if "setup" in data else []):
        text(line, f"setup[{i}]", LIMITS["short"], required=True)
    if "players" in data:
        p = data["players"]
        if not isinstance(p, dict) or not (_is_int(p.get("min")) and _is_int(p.get("max"))):
            bad("players must be {min, max} whole numbers")
        elif not (1 <= p["min"] <= p["max"] <= 32):
            bad("players must satisfy 1 <= min <= max <= 32")
    for i, g in enumerate(items(data["gestures"], "gestures", len(GESTURES)) if "gestures" in data else []):
        if g not in GESTURES:
            bad(f"gestures[{i}] '{g}' is not one of {', '.join(GESTURES)}")
    if "devices" in data:
        d = data["devices"]
        if not isinstance(d, dict):
            bad("devices must be an object")
        else:
            for kind, mode in d.items():
                if kind not in DEVICE_KINDS:
                    bad(f"devices.{kind}: the kinds are {', '.join(DEVICE_KINDS)}")
                elif mode not in DEVICE_MODES:
                    bad(f"devices.{kind} '{mode}' is not one of {', '.join(DEVICE_MODES)}")
    role_ids: set[str] = set()
    for i, r in enumerate(items(data["roles"], "roles", LIMITS["roles"]) if "roles" in data else []):
        if not isinstance(r, dict):
            bad(f"roles[{i}] must be an object")
            continue
        text(r.get("id"), f"roles[{i}].id", LIMITS["id"], required=True)
        if isinstance(r.get("id"), str):
            if r["id"] in role_ids:
                bad(f"roles[{i}].id '{r['id']}' is used twice")
            role_ids.add(r["id"])
        for key, limit in (("name", LIMITS["short"]), ("brief", LIMITS["long"])):
            if key in r:
                text(r[key], f"roles[{i}].{key}", limit)
        if "kind" in r and r["kind"] not in ROLE_KINDS:
            bad(f"roles[{i}].kind must be one of {', '.join(ROLE_KINDS)}")
    phase_ids: set[str] = set()
    for i, ph in enumerate(items(data["phases"], "phases", LIMITS["phases"]) if "phases" in data else []):
        if not isinstance(ph, dict):
            bad(f"phases[{i}] must be an object")
            continue
        if "id" in ph:
            text(ph["id"], f"phases[{i}].id", LIMITS["id"], required=True)
            if isinstance(ph["id"], str):
                if ph["id"] in phase_ids:
                    bad(f"phases[{i}].id '{ph['id']}' is used twice")
                phase_ids.add(ph["id"])
        for key, limit in (("title", LIMITS["short"]), ("text", LIMITS["long"])):
            if key in ph:
                text(ph[key], f"phases[{i}].{key}", limit)
        for j, step in enumerate(items(ph["steps"], f"phases[{i}].steps", LIMITS["steps"]) if "steps" in ph else []):
            if not isinstance(step, dict):
                bad(f"phases[{i}].steps[{j}] must be an object")
                continue
            text(step.get("role"), f"phases[{i}].steps[{j}].role", LIMITS["id"])
            text(step.get("do"), f"phases[{i}].steps[{j}].do", LIMITS["short"], required=True)
            role = step.get("role")
            if isinstance(role, str) and role and role_ids and role not in role_ids:
                bad(f"phases[{i}].steps[{j}].role '{role}' is not a declared role")
    if not problems:
        return None
    return "; ".join(problems[:MAX_PROBLEMS]) + ("; ..." if len(problems) > MAX_PROBLEMS else "")


TOOL_DESCRIPTION = (
    "Save the game's instructions. Pass the WHOLE instructions object every time. It is checked first: an answer starting "
    "with 'Error' lists what to fix, then call it again. 'Saved' means done."
)


def make_tool(project_dir: Path) -> StructuredTool:
    """The only way this agent changes anything: validate, then write /instructions.json in the project."""

    def submit_instructions(instructions: dict) -> str:
        problem = check_instructions(instructions)
        if problem:
            return f"Error: {problem}. Fix these and call submit_instructions again."
        (project_dir / "instructions.json").write_text(json.dumps(instructions, indent=2) + "\n", encoding="utf-8")
        return "Saved"

    return StructuredTool.from_function(submit_instructions, name="submit_instructions", description=TOOL_DESCRIPTION)


AGENTS_TEMPLATE = Template("""# Pear game instructions

You write the instructions for a Pear game: what the people playing it read and do in the real world, not code. Players stand in a room
with their own phone, watch or AirPods and the game reacts to what they do. Write for a stranger who has never seen the game.

Plan with `write_todos`. Read `/scene.json` and `/instructions.json` when you need detail. You cannot write files: save your result by
calling the `submit_instructions` tool with the whole instructions object; it checks the fields and tells you what to fix. Finish with one
sentence saying what you wrote or changed.

$task

## Fields
- `title`, `summary`: the game's name and what it is, in a few sentences.
- `space`: the room or area the game needs. `setup`: short lines for what to do before the first round.
- `players`: {min, max}. `gestures`: the ones the game uses, from tap, doubleTap, flick, squeeze, pinch.
- `devices`: only for a device that is not each player's own: `phone`, `watch` or `airpods` set to `free` (one device in the room) or
  `passed` (one device that changes hands). Leave it out when every player has their own.
- `roles`: [{id, name, brief, kind}] with kind `player` or `ref` (a referee). `brief` says what that role does and knows.
- `phases`: [{id, title, text, steps: [{role, do}]}]. A step's `role` is a role id, or empty for every player; `do` is one short action.
- `win`: how the game is won or ends. `lose`: how a player or the team loses. Every game needs both, even a simple one.
Limits: $limits. Keep the player count, gestures and device holders in line with the scene below.

## Scene (summary; the full file is /scene.json)
$scene

## Current instructions (also /instructions.json)
$current
""")

AUTHOR_TASK = "There are no instructions yet. Turn the user's description into a complete set, asking for nothing: choose sensible details and say which you chose."
REVISE_TASK = "Instructions already exist (below). Apply only what the user asks, keep everything else as it is, and submit the whole object again."


def agents_md(snapshot: dict) -> str:
    """The AGENTS.md for an instructions run: the task (author or revise), the fields, the scene summary and the current instructions."""
    scene = snapshot.get("scene") or {}
    summary = {key: scene.get(key) for key in ("name", "inputs", "ownership", "peripherals", "runMode") if scene.get(key) is not None}
    current = snapshot.get("instructions")
    return AGENTS_TEMPLATE.safe_substitute(
        task=REVISE_TASK if current else AUTHOR_TASK,
        limits=", ".join(f"{k} {v}" for k, v in LIMITS.items()),
        scene=json.dumps(summary, indent=2),
        current=json.dumps(current, indent=2) if current else "none yet",
    )


def build_agent(project_dir: Path, model):
    """The instructions agent: reads the project, cannot write files, saves only through `submit_instructions`."""
    return create_deep_agent(
        model=model,
        tools=[make_tool(project_dir)],
        memory=["/AGENTS.md"],
        middleware=[TodoListMiddleware()],
        backend=FilesystemBackend(root_dir=project_dir, virtual_mode=True),
        permissions=[FilesystemPermission(operations=["write"], paths=["/**"], mode="deny")],
    )
