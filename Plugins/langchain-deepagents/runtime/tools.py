"""In-process tools for the "scripts" mode agent: validate_game and simulate_game. Bounded, no shell, failures returned as data."""
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from langchain_core.tools import tool

REPO_ROOT = Path(__file__).resolve().parents[3]
WEB_DIR = REPO_ROOT / "Web"
SIM_RUNNER = "packages/pear-sim/bin/pear-sim-run.ts"
SIM_TIMEOUT_S = 120
CHECK_TIMEOUT_S = 15
MAX_OUTPUT = 8000
MAX_FILES = 200


def _tail(text: str) -> str:
    return text if len(text) <= MAX_OUTPUT else "...[cut]" + text[-MAX_OUTPUT:]


def validate_project(project_dir: Path) -> dict:
    """Offline checks of scene.json, scripts/**/*.js (node --check, never executed), ui.json and scenario*.json.
    `untested` lists what was not checked (ui.json is only parsed: PearUI rules need `validate_game` in the MCP)."""
    errors: list[str] = []
    tested: list[str] = []
    untested: list[str] = []

    def load(name: str):
        try:
            return json.loads((project_dir / name).read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            errors.append(f"{name}: {exc}")

    scene = load("scene.json")
    tested.append("scene.json")
    if isinstance(scene, dict):
        for kind, key in (("server", "serverScripts"), ("client", "clientScripts")):
            for name in scene.get(key) or []:
                if not (project_dir / "scripts" / kind / f"{name}.js").is_file():
                    errors.append(f'scene.json {key} lists "{name}" but scripts/{kind}/{name}.js is missing')
    node = shutil.which("node")
    scripts = sorted((project_dir / "scripts").rglob("*.js"))[:MAX_FILES]
    if scripts and not node:
        untested.append("scripts (node not found)")
    elif scripts:
        tested.append("script syntax")
        with tempfile.TemporaryDirectory() as tmp:
            for script in scripts:
                relative = script.relative_to(project_dir).as_posix()
                copy = Path(tmp) / (relative.replace("/", "_") + ".mjs")
                copy.write_bytes(script.read_bytes())
                try:
                    run = subprocess.run([node, "--check", str(copy)], capture_output=True, text=True, timeout=CHECK_TIMEOUT_S)
                except subprocess.TimeoutExpired:
                    errors.append(f"{relative}: syntax check timed out")
                    continue
                if run.returncode:
                    lines = [line for line in run.stderr.splitlines() if line][-3:]
                    errors.append(f"{relative}: " + " | ".join(lines).replace(str(copy), relative))
    if (project_dir / "ui.json").is_file():
        load("ui.json")
        tested.append("ui.json JSON")
        untested.append("ui.json against PearUI v1")
    else:
        untested.append("ui.json (missing)")
    for scenario in sorted(project_dir.glob("scenario*.json"))[:MAX_FILES]:
        data = load(scenario.name)
        tested.append(scenario.name)
        if isinstance(data, dict) and not (isinstance(data.get("devices"), list) and data["devices"]):
            errors.append(f"{scenario.name}: needs a non-empty devices array")
    return {"ok": not errors, "errors": errors[:50], "tested": tested, "untested": untested}


def simulate_project(project_dir: Path, scenario: str) -> dict:
    """Run a scenario through the headless runner (`npx vite-node` from Web/); a structured result on every failure."""
    target = (project_dir / scenario.lstrip("/")).resolve()
    if not target.is_relative_to(project_dir.resolve()) or not target.is_file():
        return {"ok": False, "error": f"scenario not found in the project: {scenario}"}
    npx = shutil.which("npx")
    if not npx or not WEB_DIR.is_dir():
        return {"ok": False, "error": "headless runner unavailable (needs npx and the repo's Web/ directory)", "tested": False}
    try:
        run = subprocess.run([npx, "vite-node", SIM_RUNNER, str(target)], cwd=WEB_DIR, capture_output=True,
                             text=True, timeout=SIM_TIMEOUT_S)
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": f"simulation timed out after {SIM_TIMEOUT_S} s", "tested": False}
    try:
        report = json.loads(run.stdout)
    except ValueError:
        return {"ok": False, "error": _tail(run.stderr or run.stdout or "no output"), "tested": False}
    report["frames"] = (report.get("frames") or [])[-20:]
    text = json.dumps(report)
    return {"ok": run.returncode == 0 and bool(report.get("ok")), "tested": True,
            "report": report if len(text) <= MAX_OUTPUT else {"cut": _tail(text)}}


def make_tools(project_dir: Path) -> list:
    project_dir = Path(project_dir)

    @tool
    def validate_game() -> str:
        """Offline check of the project's scene.json, scripts, ui.json and scenario*.json. Fix every error, then run it again."""
        return json.dumps(validate_project(project_dir))

    @tool
    def simulate_game(scenario: str = "scenario.json") -> str:
        """Run a scenario file (path inside the project) headless and return the report: ok, expectations, last frames."""
        return json.dumps(simulate_project(project_dir, scenario))

    return [validate_game, simulate_game]
