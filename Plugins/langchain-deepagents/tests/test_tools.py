import asyncio
import json

from deepagents import create_deep_agent
from deepagents.backends import FilesystemBackend

import server
import tools
from scripted_model import ScriptedModel, call, say

BROKEN = "export default script({ ;\n"
FIXED = "export default script({});\n"


def agent_for(tmp_path, replies):
    return create_deep_agent(model=ScriptedModel(replies=replies), tools=tools.make_tools(tmp_path),
                             backend=FilesystemBackend(root_dir=tmp_path, virtual_mode=True), permissions=server.PERMISSIONS)


def run(agent):
    return asyncio.run(agent.ainvoke({"messages": [{"role": "user", "content": "go"}]}))["messages"]


def tool_texts(messages):
    return [m.content for m in messages if m.type == "tool"]


def test_validate_fix_and_rerun(tmp_path):
    (tmp_path / "scripts").mkdir()
    (tmp_path / "scripts" / "a.js").write_text(BROKEN, encoding="utf-8")
    (tmp_path / "scene.json").write_text("{}", encoding="utf-8")
    messages = run(agent_for(tmp_path, [
        call("validate_game", "v1"),
        call("edit_file", "e1", file_path="/scripts/a.js", old_string="({ ;", new_string="({});"),
        call("validate_game", "v2"),
        say("fixed"),
    ]))
    first, _, second = tool_texts(messages)
    assert json.loads(first)["ok"] is False and "scripts/a.js" in json.loads(first)["errors"][0]
    assert json.loads(second)["ok"] is True
    assert (tmp_path / "scripts" / "a.js").read_text(encoding="utf-8") == FIXED


def test_validate_reports_bad_json_and_scenario(tmp_path):
    (tmp_path / "scene.json").write_text("{nope", encoding="utf-8")
    (tmp_path / "scenario.json").write_text('{"devices": []}', encoding="utf-8")
    result = tools.validate_files(tmp_path)
    assert result["ok"] is False
    assert any(e.startswith("scene.json: invalid JSON") for e in result["errors"])
    assert "scenario.json: needs a non-empty devices array" in result["errors"]


def test_out_of_scope_write_is_denied(tmp_path):
    messages = run(agent_for(tmp_path, [call("write_file", "w1", file_path="/../escape.js", content="x"), say("done")]))
    assert tool_texts(messages)[0].startswith("Error") and not (tmp_path.parent / "escape.js").exists()


def test_simulate_returns_the_runner_report_and_structured_failures(tmp_path, monkeypatch):
    (tmp_path / "scenario.json").write_text('{"game": "g", "devices": [{}], "durationMs": 1000}', encoding="utf-8")
    seen = {}

    def fake_run(args, cwd, timeout, stdin=None, env=None):
        seen.update(args=args, cwd=cwd, timeout=timeout)
        return 0, json.dumps({"ok": True, "expect": [], "frames": list(range(500)), "logs": []}), ""

    monkeypatch.setattr(tools, "_run", fake_run)
    env = {"PEAR_TOKEN": "t", "PEAR_CLOUD_URL": "https://example.test"}
    assert tools.simulate(tmp_path, "scenario.json", {})["error"].startswith("PEAR_TOKEN")
    assert tools.simulate(tmp_path, "/../scenario.json", env)["ok"] is False
    assert tools.simulate(tmp_path, "scenario.json", env)["ok"] is True
    assert seen["cwd"] == tools.WEB_DIR and seen["timeout"] == 61 and seen["args"][-2:] == ["--cloud", "https://example.test"]
    monkeypatch.setattr(tools, "_run", lambda *a, **k: (1, "", "boom"))
    failure = tools.simulate(tmp_path, "scenario.json", env)
    assert failure["ok"] is False and failure["detail"] == "boom"


def test_report_is_bounded_and_stays_json():
    text = tools._result(ok=True, frames=[{"x": "y" * 200}] * 500, logs=[])
    assert len(text) <= tools.MAX_REPORT_CHARS and json.loads(text)["ok"] is True
