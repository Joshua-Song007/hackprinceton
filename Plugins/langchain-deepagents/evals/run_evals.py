"""Opt-in agent evals: prompt -> game (live model) -> scored by Tools/pear-check. Not part of the default tests.

Usage (from Plugins/langchain-deepagents, model key in the env, see runtime/server.py):
    uv run python evals/run_evals.py [case-id ...]        # all cases when none are named
Each case runs the "scripts" mode agent in a scratch project dir; the score is `score_project` below. Exit 0 when all pass.
"""
import asyncio
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "runtime"))
CHECK = HERE.parents[2] / "Tools" / "pear-check" / "check.mjs"
CHECK_TIMEOUT_S = 180


def load_cases() -> list[dict]:
    return json.loads((HERE / "cases.json").read_text(encoding="utf-8"))["cases"]


def _json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def score_project(project_dir: Path, case: dict) -> dict:
    """{ok, failures, check}: pear-check passes, the case's player range overlaps scene.inputs.players, outdoor games read the
    player's location (scene permissions.location or a location sensor in ui.json), `ui` cases ship a ui.json."""
    failures: list[str] = []
    scene = _json(project_dir / "scene.json")
    if not isinstance(scene, dict):
        return {"ok": False, "failures": ["scene.json missing or not a JSON object"], "check": None}
    node = shutil.which("node")
    if not node:
        return {"ok": False, "failures": ["node not found"], "check": None}
    run = subprocess.run([node, str(CHECK), str(project_dir)], capture_output=True, text=True, timeout=CHECK_TIMEOUT_S)
    try:
        check = json.loads(run.stdout)
    except ValueError:
        check = None
        failures.append(f"pear-check produced no report: {(run.stderr or run.stdout)[-300:]}")
    if check is not None and not check.get("ok"):
        failures.extend(f"pear-check: {e}" for e in check.get("errors", [])[:10] or ["not ok"])
    lo, hi = case["players"]
    players = (scene.get("inputs") or {}).get("players")
    if not (isinstance(players, list) and len(players) == 2 and players[0] <= hi and players[1] >= lo):
        failures.append(f"scene.inputs.players {players} must overlap {lo}..{hi}")
    ui_text = (project_dir / "ui.json").read_text(encoding="utf-8") if (project_dir / "ui.json").is_file() else ""
    if case.get("ui") and not ui_text:
        failures.append("ui.json missing")
    if case.get("outdoor") and not ((scene.get("permissions") or {}).get("location") is True or '"location"' in ui_text):
        failures.append("outdoor game never reads the player's location (scene permissions.location or a location sensor)")
    return {"ok": not failures, "failures": failures, "check": check and {k: check.get(k) for k in ("ok", "tested", "untested")}}


async def run_case(case: dict) -> dict:
    import server  # noqa: E402  (needs the plugin's venv)

    project_dir = Path(tempfile.mkdtemp(prefix=f"pear-eval-{case['id']}-"))
    server.prepare_project(project_dir, {}, "scripts")
    agent = server.build_agent(project_dir, None, "scripts")
    await agent.ainvoke({"messages": [{"role": "user", "content": case["prompt"]}]}, {"recursion_limit": 200})
    return {"id": case["id"], "dir": str(project_dir), **score_project(project_dir, case)}


async def main(ids: list[str]) -> int:
    import server  # noqa: E402

    if server.choose_model(__import__("os").environ) is None:
        print(server.NO_KEY_MESSAGE)
        return 2
    cases = [c for c in load_cases() if not ids or c["id"] in ids]
    results = [await run_case(c) for c in cases]
    print(json.dumps(results, indent=2))
    print(f"{sum(r['ok'] for r in results)}/{len(results)} passed", file=sys.stderr)
    return 0 if all(r["ok"] for r in results) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1:])))
