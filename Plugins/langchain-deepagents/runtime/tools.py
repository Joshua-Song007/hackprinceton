"""In-process game tools for "scripts" mode (Studio chat): validate_game and simulate_game on the project dir.

Both return JSON text and never raise, so the agent reads structured failures and fixes them. There is no shell:
the only processes are `node --check` and the headless runner, the same one Tools/pear-mcp spawns (cwd Web/).
"""
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from langchain_core.tools import tool

REPO_ROOT = Path(__file__).resolve().parents[3]
WEB_DIR = REPO_ROOT / "Web"
MAX_REPORT_CHARS = 8000
MAX_SCENARIO_BYTES = 200_000
CHECK_TIMEOUT_S = 30
# shortcut: Windows needs the .cmd shim for npx, found by shutil.which; no further PATH search.
NPX = shutil.which("npx") or "npx"


def _result(**fields) -> str:
    """JSON text within MAX_REPORT_CHARS: long frames/logs lists shrink to their tail first, then the text is cut."""
    text = json.dumps(fields, indent=2)
    for keep in (50, 10, 0):
        if len(text) <= MAX_REPORT_CHARS:
            break
        text = json.dumps({k: v[-keep:] if k in ("frames", "logs") and isinstance(v, list) else v for k, v in fields.items()}, indent=2)
    return text[:MAX_REPORT_CHARS]


def _resolve(project_dir: Path, relative: str) -> Path | None:
    """The file under project_dir, or None when the path escapes it."""
    target = (project_dir / relative.lstrip("/")).resolve()
    return target if target.is_relative_to(project_dir.resolve()) else None


def _run(args, cwd, timeout, stdin=None, env=None) -> tuple[int, str, str]:
    """(exit code, stdout, stderr); exit code -1 with the reason in stderr when the process cannot run or times out."""
    try:
        done = subprocess.run(args, cwd=cwd, input=stdin, capture_output=True, text=True, timeout=timeout, env=env)
        return done.returncode, done.stdout, done.stderr
    except subprocess.TimeoutExpired:
        return -1, "", f"timed out after {timeout}s"
    except OSError as exc:
        return -1, "", str(exc)


def validate_files(project_dir: Path) -> dict:
    """Offline checks of scene.json, scripts/**/*.js (syntax only, never executed), ui.json and scenario*.json."""
    errors: list[str] = []
    warnings: list[str] = []
    node = shutil.which("node")
    for name in ("scene.json", "pear-game.json", "controller.json", "cues.json", "scenario.json"):
        path = project_dir / name
        if path.is_file():
            try:
                parsed = json.loads(path.read_text(encoding="utf-8"))
            except ValueError as exc:
                errors.append(f"{name}: invalid JSON: {exc}")
                continue
            if name == "scenario.json" and not (isinstance(parsed, dict) and parsed.get("devices")):
                errors.append("scenario.json: needs a non-empty devices array")
    scripts = sorted((project_dir / "scripts").rglob("*.js")) if (project_dir / "scripts").is_dir() else []
    if not scripts:
        warnings.append("no scripts/*.js yet")
    if scripts and node is None:
        warnings.append("scripts not syntax-checked: node is not on PATH")
    for script in scripts if node else []:
        relative = script.relative_to(project_dir).as_posix()
        # node only accepts ESM syntax in .mjs files, so check a copy.
        with tempfile.TemporaryDirectory(prefix="pear-check-") as tmp:
            copy = Path(tmp) / "script.mjs"
            copy.write_bytes(script.read_bytes())
            code, _, err = _run([node, "--check", str(copy)], None, CHECK_TIMEOUT_S)
        if code != 0:
            errors.append(f"{relative}: " + " | ".join(err.replace(str(copy), relative).splitlines()[-3:]))
    ui = project_dir / "ui.json"
    if ui.is_file():
        code, out, err = _run([NPX, "vite-node", "packages/pear-ui/bin/validate.ts"], WEB_DIR, CHECK_TIMEOUT_S * 2, ui.read_text(encoding="utf-8"))
        try:
            errors += [f"ui.json: {e}" for e in json.loads(out.strip().splitlines()[-1])["errors"]]
        except (ValueError, IndexError, KeyError, TypeError):
            warnings.append(f"ui.json not checked (is Web/ installed? run npm install there): {err[-200:]}")
    else:
        warnings.append("no ui.json: phones will have no PearUI screens")
    return {"ok": not errors, "errors": errors, "warnings": warnings}


def simulate(project_dir: Path, scenario_path: str, env=os.environ) -> dict:
    """Run a scenario file from the project against its saved game with the headless runner; a structured report or error."""
    target = _resolve(project_dir, scenario_path)
    if target is None or not target.is_file():
        return {"ok": False, "error": f"scenario file not found in the project: {scenario_path}"}
    if target.stat().st_size > MAX_SCENARIO_BYTES:
        return {"ok": False, "error": f"scenario is larger than {MAX_SCENARIO_BYTES} bytes"}
    try:
        scenario = json.loads(target.read_text(encoding="utf-8"))
        duration_s = min(float(scenario.get("durationMs") or 60000) / 1000, 300)
    except (ValueError, AttributeError, TypeError) as exc:
        return {"ok": False, "error": f"scenario is not valid scenario JSON: {exc}"}
    if not env.get("PEAR_TOKEN"):
        return {"ok": False, "error": "PEAR_TOKEN is not set: the runner needs an account token to reach the saved game"}
    args = [NPX, "vite-node", "packages/pear-sim/bin/pear-sim-run.ts", str(target)]
    if env.get("PEAR_CLOUD_URL"):
        args += ["--cloud", env["PEAR_CLOUD_URL"]]
    code, out, err = _run(args, WEB_DIR, duration_s + 60, env=dict(env))
    try:
        report = json.loads(out)
        if isinstance(report, dict):
            return report
    except ValueError:
        pass
    return {"ok": False, "error": f"runner exited {code} without a report (is Web/ installed? run npm install there)", "detail": (err or out)[-600:]}


def make_tools(project_dir: Path) -> list:
    """The langchain tools bound to one project dir."""
    @tool
    def validate_game() -> str:
        """Check the project's scene.json, scripts/*.js (syntax), ui.json and scenario.json offline. Fix every error before simulating."""
        return _result(**validate_files(project_dir))

    @tool
    def simulate_game(scenario: str = "scenario.json") -> str:
        """Run a scenario file from the project headless against its saved game (the scenario's "game" id); returns the report {ok, expect, frames, logs, final}."""
        return _result(**simulate(project_dir, scenario))

    return [validate_game, simulate_game]
