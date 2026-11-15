import asyncio
import functools
import json
import re
from pathlib import Path

import pytest
from websockets.asyncio.client import connect
from websockets.asyncio.server import serve

import instructions
import server
from scripted_model import ScriptedModel, call, say

ROOT = Path(__file__).resolve().parents[3]

GOOD = {
    "title": "Quick Draw",
    "summary": "Three duelists, one referee's cue.",
    "space": "A clear 4 m square.",
    "setup": ["Everyone stands back to back."],
    "players": {"min": 3, "max": 3},
    "gestures": ["tap"],
    "devices": {"phone": "passed"},
    "roles": [{"id": "ref", "name": "Referee", "brief": "Calls the draw.", "kind": "ref"}, {"id": "duelist", "name": "Duelist", "brief": "Tap first."}],
    "phases": [{"id": "draw", "title": "Draw", "text": "Wait for the cue.", "steps": [{"role": "duelist", "do": "Tap when the cue sounds"}, {"role": "", "do": "Stand still"}]}],
    "win": "First clean tap wins the round.",
}


def test_check_accepts_a_good_object_and_the_empty_one():
    assert instructions.check_instructions(GOOD) is None
    assert instructions.check_instructions({}) is None


@pytest.mark.parametrize("data, fragment", [
    ("text", "must be an object"),
    ({"extra": 1}, "unknown field(s): extra"),
    ({"title": 5}, "title must be text"),
    ({"summary": "x" * 2001}, "summary is 2001 characters"),
    ({"setup": ["ok", ""]}, "setup[1] must not be empty"),
    ({"players": {"min": 0, "max": 3}}, "1 <= min <= max <= 32"),
    ({"players": {"min": 4, "max": 3}}, "1 <= min <= max <= 32"),
    ({"players": [3, 3]}, "players must be {min, max}"),
    ({"gestures": ["wave"]}, "gestures[0] 'wave'"),
    ({"devices": {"tv": "free"}}, "devices.tv"),
    ({"devices": {"phone": "shared"}}, "devices.phone 'shared'"),
    ({"roles": [{"id": "a"}, {"id": "a"}]}, "used twice"),
    ({"roles": [{"id": "a", "kind": "wizard"}]}, "roles[0].kind"),
    ({"phases": [{"id": "p", "steps": [{"role": "", "do": ""}]}]}, "steps[0].do must not be empty"),
    ({"phases": [{"steps": [{"role": "ghost", "do": "x"}]}], "roles": [{"id": "a"}]}, "'ghost' is not a declared role"),
    ({"phases": [{"id": "p"}, {"id": "p"}]}, "phases[1].id 'p' is used twice"),
    ({"roles": [{"id": f"r{i}"} for i in range(13)]}, "roles has 13 entries"),
])
def test_check_rejects_each_class_of_problem(data, fragment):
    assert fragment in (instructions.check_instructions(data) or "")


def test_limits_match_the_typescript_parser():
    source = (ROOT / "Web/packages/pear-runtime/src/instructions.ts").read_text(encoding="utf-8")
    body = re.search(r"INSTRUCTION_LIMITS = \{([^}]*)\}", source).group(1)
    assert {k: int(v) for k, v in re.findall(r"(\w+):\s*(\d+)", body)} == instructions.LIMITS


def author_events(model, project, tmp_path, mode="instructions"):
    async def run():
        return [e async for e in server.run_prompt({"text": "a duel game", "mode": mode, "project": project}, tmp_path, model)]

    return asyncio.run(run())


def test_author_run_retries_a_rejected_submit_and_forwards_only_the_saved_one(tmp_path):
    bad = {**GOOD, "players": {"min": 0, "max": 3}}
    model = ScriptedModel(replies=[
        call("submit_instructions", "s1", instructions=bad),
        call("submit_instructions", "s2", instructions=GOOD),
        say("Wrote the instructions."),
    ])
    events = author_events(model, {"scene": {"name": "Quick Draw"}}, tmp_path)
    written = [e for e in events if e["type"] == "file_written"]
    assert [e["path"] for e in written] == ["instructions.json"]
    assert json.loads(written[0]["content"]) == GOOD
    assert events[-1] == {"type": "done", "summary": "Wrote the instructions."}
    assert "There are no instructions yet" in (tmp_path / "AGENTS.md").read_text(encoding="utf-8")


def test_the_instructions_agent_cannot_write_files_itself(tmp_path):
    model = ScriptedModel(replies=[call("write_file", "w1", file_path="/instructions.json", content="HACK"), say("done")])
    events = author_events(model, {"scene": {}}, tmp_path)
    assert not (tmp_path / "instructions.json").exists()
    assert [e for e in events if e["type"] == "file_written"] == []
    assert events[-1]["type"] == "done"


def test_revise_briefs_the_agent_with_the_current_instructions_and_a_stale_file_is_removed(tmp_path):
    server.prepare_project(tmp_path, {"scene": {"name": "s"}, "instructions": GOOD}, "instructions")
    brief = (tmp_path / "AGENTS.md").read_text(encoding="utf-8")
    assert "Instructions already exist" in brief and "Quick Draw" in brief
    assert json.loads((tmp_path / "instructions.json").read_text(encoding="utf-8")) == GOOD
    server.prepare_project(tmp_path, {"scene": {"name": "s"}, "instructions": None}, "instructions")
    assert not (tmp_path / "instructions.json").exists()
    assert "There are no instructions yet" in (tmp_path / "AGENTS.md").read_text(encoding="utf-8")


def test_scripts_mode_still_writes_the_scripts_brief_and_knows_the_instructions_file(tmp_path):
    server.prepare_project(tmp_path, {"scene": {"name": "s"}, "instructions": GOOD})
    assert "Pear project" in (tmp_path / "AGENTS.md").read_text(encoding="utf-8")
    assert (tmp_path / "instructions.json").is_file()


def test_unknown_mode_is_an_error(tmp_path):
    events = author_events(ScriptedModel(replies=[say("x")]), {}, tmp_path, mode="poetry")
    assert events == [{"type": "error", "message": "unknown mode 'poetry': use scripts or instructions"}]


def test_instructions_prompt_over_a_socket_ends_with_the_proposal(tmp_path, monkeypatch):
    monkeypatch.setenv("PEAR_PROJECT_DIR", str(tmp_path))
    model = ScriptedModel(replies=[call("submit_instructions", "s1", instructions=GOOD), say("ok")])
    handler = functools.partial(server.handle_socket, model=model)

    async def scenario():
        async with serve(handler, "127.0.0.1", 0, process_request=server.handle_request) as srv:
            port = srv.sockets[0].getsockname()[1]
            events = []
            async with connect(f"ws://127.0.0.1:{port}/ws") as ws:
                await ws.send(json.dumps({"type": "prompt", "id": "i1", "text": "a duel", "mode": "instructions", "project": {"scene": {}, "instructions": None}}))
                while not events or events[-1]["type"] not in ("done", "error"):
                    events.append(json.loads(await ws.recv()))
            return events

    events = asyncio.run(scenario())
    assert {e["id"] for e in events} == {"i1"}
    assert [e["path"] for e in events if e["type"] == "file_written"] == ["instructions.json"]
