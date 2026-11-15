"""Default tests for the opt-in evals: the cases are well formed and the scorer separates a real game from an empty one (no model)."""
import importlib.util
import json
import shutil
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
GAMES = ROOT.parents[1] / "Games"
spec = importlib.util.spec_from_file_location("run_evals", ROOT / "evals" / "run_evals.py")
run_evals = importlib.util.module_from_spec(spec)
spec.loader.exec_module(run_evals)

needs_node = pytest.mark.skipif(shutil.which("node") is None or not (ROOT.parents[1] / "Tools" / "pear-mcp" / "node_modules").is_dir(),
                                reason="node or Tools/pear-mcp deps missing")


def test_cases_are_well_formed():
    cases = run_evals.load_cases()
    assert len(cases) == 5 and len({c["id"] for c in cases}) == 5
    assert sum(c["outdoor"] for c in cases) >= 3
    for c in cases:
        assert len(c["prompt"]) > 40 and c["players"][0] <= c["players"][1]


@needs_node
def test_scorer_passes_manhunt_and_fails_empty(tmp_path):
    case = {"id": "m", "outdoor": True, "players": [3, 12], "ui": True}
    shutil.copytree(GAMES / "Manhunt", tmp_path / "ok")
    assert run_evals.score_project(tmp_path / "ok", case)["ok"], run_evals.score_project(tmp_path / "ok", case)
    (tmp_path / "bad").mkdir()
    (tmp_path / "bad" / "scene.json").write_text(json.dumps({"name": "x", "inputs": {"players": [2, 2]}}), encoding="utf-8")
    bad = run_evals.score_project(tmp_path / "bad", case)
    assert not bad["ok"] and any("players" in f for f in bad["failures"]) and any("ui.json" in f for f in bad["failures"])
