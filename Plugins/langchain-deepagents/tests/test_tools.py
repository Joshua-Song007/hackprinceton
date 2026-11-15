import asyncio
import json

import server
import tools
from scripted_model import ScriptedModel, call, say

SCENE = {"runMode": "device", "serverScripts": ["main"], "clientScripts": []}


def project(tmp_path, source):
    (tmp_path / "scene.json").write_text(json.dumps(SCENE))
    (tmp_path / "scripts" / "server").mkdir(parents=True)
    (tmp_path / "scripts" / "server" / "main.js").write_text(source)


def test_validate_reports_missing_script_and_syntax_error(tmp_path):
    (tmp_path / "scene.json").write_text(json.dumps(SCENE))
    assert any("main.js is missing" in e for e in tools.validate_project(tmp_path)["errors"])
    project(tmp_path, "serverScript({")
    result = tools.validate_project(tmp_path)
    assert not result["ok"] and any(e.startswith("scripts/server/main.js") for e in result["errors"])
    assert "ui.json (missing)" in result["untested"]


def test_validate_bad_json_and_scenario_shape(tmp_path):
    project(tmp_path, "serverScript({})")
    (tmp_path / "ui.json").write_text("{")
    (tmp_path / "scenario.json").write_text('{"devices": []}')
    errors = tools.validate_project(tmp_path)["errors"]
    assert any(e.startswith("ui.json") for e in errors) and any("devices" in e for e in errors)


def test_simulate_rejects_paths_outside_the_project(tmp_path):
    (tmp_path.parent / "outside.json").write_text("{}")
    assert not tools.simulate_project(tmp_path, "../outside.json")["ok"]
    assert "not found" in tools.simulate_project(tmp_path, "scenario.json")["error"]


def test_simulate_reports_runner_output_and_timeouts(tmp_path, monkeypatch):
    (tmp_path / "scenario.json").write_text("{}")
    monkeypatch.setattr(tools.shutil, "which", lambda name: "npx")

    class Run:
        returncode, stderr = 0, ""
        stdout = json.dumps({"ok": True, "frames": list(range(50))})

    monkeypatch.setattr(tools.subprocess, "run", lambda *a, **k: Run)
    result = tools.simulate_project(tmp_path, "scenario.json")
    assert result["ok"] and result["tested"] and len(result["report"]["frames"]) == 20

    def timeout(*a, **k):
        raise tools.subprocess.TimeoutExpired("npx", 1)

    monkeypatch.setattr(tools.subprocess, "run", timeout)
    assert "timed out" in tools.simulate_project(tmp_path, "scenario.json")["error"]


def test_agent_validates_fixes_and_reruns(tmp_path):
    project(tmp_path, "serverScript({")
    model = ScriptedModel(replies=[
        call("validate_game", "1"),
        call("write_file", "2", file_path="/scripts/server/main.js", content="serverScript({})"),
        call("validate_game", "3"),
        say("fixed"),
    ])
    agent = server.build_agent(tmp_path, model)
    result = asyncio.run(agent.ainvoke({"messages": [{"role": "user", "content": "check it"}]}))
    results = [json.loads(m.content) for m in result["messages"] if m.type == "tool" and m.name == "validate_game"]
    assert [r["ok"] for r in results] == [False, True]
