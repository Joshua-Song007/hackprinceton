import asyncio
import json

from langchain_core.tools import tool

import safety
import server
from deepagents import create_deep_agent
from scripted_model import ScriptedModel, call, say


def run(project, replies, **kwargs):
    agent = create_deep_agent(model=ScriptedModel(replies=replies), backend=safety.RevisionBackend(root_dir=project, virtual_mode=True),
                              permissions=server.PERMISSIONS, **kwargs)
    asyncio.run(agent.ainvoke({"messages": [{"role": "user", "content": "go"}]}))


def test_scopes_come_from_the_manifest():
    rules = safety.scoped_permissions(["filesystem:project_scene", "editor:open_panel"])
    assert [r.mode for r in rules] == ["allow", "allow", "deny"]
    assert rules[1].paths == ["/scene.json"]
    assert [r.mode for r in safety.scoped_permissions([])] == ["allow", "deny"]


def test_undeclared_paths_are_denied_and_declared_ones_written(tmp_path):
    run(tmp_path, [call("write_file", "1", file_path="/scene.json", content="{}"),
                   call("write_file", "2", file_path="/ui.json", content="{}"),
                   call("write_file", "3", file_path="/scripts/a.js", content="x"), say("end")])
    assert (tmp_path / "scene.json").exists() and (tmp_path / "scripts" / "a.js").exists()
    assert not (tmp_path / "ui.json").exists()


def test_stale_edit_is_rejected_and_fresh_edit_accepted(tmp_path):
    (tmp_path / "scene.json").write_text("one two", encoding="utf-8")
    backend = safety.RevisionBackend(root_dir=tmp_path, virtual_mode=True)
    backend.read("/scene.json")
    (tmp_path / "scene.json").write_text("one TWO", encoding="utf-8")  # a parallel writer
    stale = backend.edit("/scene.json", "one", "1")
    assert "stale write rejected" in stale.error and (tmp_path / "scene.json").read_text() == "one TWO"
    backend.read("/scene.json")
    assert backend.edit("/scene.json", "one", "1").error is None
    assert (tmp_path / "scene.json").read_text() == "1 TWO"
    assert backend.edit("/scene.json", "TWO", "2").error is None  # own write refreshes the revision


def test_blind_edit_of_an_unread_file_is_rejected(tmp_path):
    (tmp_path / "scene.json").write_text("a", encoding="utf-8")
    backend = safety.RevisionBackend(root_dir=tmp_path, virtual_mode=True)
    assert "never read" in backend.edit("/scene.json", "a", "b").error


def make_publish(calls):
    @tool
    def publish(id: str, version: int) -> str:
        """Publish a version."""
        calls.append((id, version))
        return "live"
    return publish


def test_publish_needs_matching_approval_and_returns_a_receipt():
    calls = []
    denied = safety.guard_publish([make_publish(calls)], None)[0]
    assert json.loads(asyncio.run(denied.ainvoke({"id": "g", "version": 1})))["published"] is False
    wrong = safety.guard_publish([make_publish(calls)], {"id": "g", "version": 2})[0]
    assert json.loads(asyncio.run(wrong.ainvoke({"id": "g", "version": 1})))["published"] is False
    assert calls == []
    ok = safety.guard_publish([make_publish(calls)], {"id": "g", "version": 1})[0]
    out = json.loads(asyncio.run(ok.ainvoke({"id": "g", "version": 1})))
    assert out["published"] is True and out["receipt"]["version"] == 1 and out["result"] == "live" and calls == [("g", 1)]
