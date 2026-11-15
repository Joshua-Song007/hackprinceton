import asyncio
import functools
import json

import pytest
from websockets.asyncio.client import connect
from websockets.asyncio.server import serve

import players
import server
from scripted_model import LOG, ScriptedModel, call, say

INSTRUCTIONS = {"title": "Quick Draw", "summary": "A duel.", "roles": [{"id": "duelist", "name": "Duelist"}],
                "phases": [{"id": "draw", "title": "Draw", "text": "Wait for the cue.", "steps": [{"role": "duelist", "do": "Tap on the cue"}]}]}
ROLE = {"id": "duelist", "name": "Duelist", "brief": "Draw fast.", "kind": "player"}


def request(**over):
    return {"type": "decide", "id": "d1", "run": "r1", "player": "p1", "persona": "follows", "role": ROLE,
            "instructions": INSTRUCTIONS, "observation": {"heard": ["beep"]}, "game_time": 1.5, **over}


def plan(actions=(), unsure=()):
    return say(json.dumps({"actions": list(actions), "unsure": list(unsure)}))


def pool_for(model, **kw):
    return players.PlayerPool(lambda: model, **kw)


def test_decide_returns_the_valid_actions_and_notes():
    model = ScriptedModel(replies=[plan([{"type": "walk_to", "x": 1, "z": 2}, {"type": "gesture", "gesture": "tap"}],
                                        [{"phase": "draw", "line": "Wait for the cue.", "why": "Which cue?"}])])
    result = asyncio.run(pool_for(model).decide(request()))
    assert result == {"actions": [{"type": "walk_to", "x": 1, "z": 2}, {"type": "gesture", "gesture": "tap"}],
                      "unsure": [{"phase": "draw", "line": "Wait for the cue.", "why": "Which cue?"}]}


def test_invalid_actions_are_dropped_and_at_most_five_are_kept():
    wild = [{"type": "teleport"}, {"type": "walk_to", "x": 1}, {"type": "gesture", "gesture": "wave"}, "x",
            {"type": "say", "text": "hi " * 100}, {"type": "wait", "seconds": 99}, {"type": "wait", "seconds": 0.1},
            {"type": "look_at", "player": "p2"}, {"type": "look_at", "x": 1, "z": 2}, {"type": "give_device", "device": "phone", "to": "p2"},
            {"type": "give_device", "device": "tv", "to": "p2"}, {"type": "wait", "seconds": 1}]
    result = asyncio.run(pool_for(ScriptedModel(replies=[plan(wild)])).decide(request()))
    assert [a["type"] for a in result["actions"]] == ["say", "wait", "wait", "look_at", "look_at"]
    assert len(result["actions"][0]["text"]) == 200
    assert [a.get("seconds") for a in result["actions"][1:3]] == [10, 0.5]


def test_a_reply_that_is_not_json_becomes_a_wait_and_a_note():
    result = asyncio.run(pool_for(ScriptedModel(replies=[say("I walk over to the cube.")])).decide(request()))
    assert result["actions"] == [{"type": "wait", "seconds": 2}]
    assert "not valid JSON" in result["unsure"][0]["why"]


def test_json_inside_prose_or_a_fence_is_found():
    reply = 'Sure!\n```json\n{"actions": [{"type": "wait", "seconds": 1}]}\n```'
    result = asyncio.run(pool_for(ScriptedModel(replies=[say(reply)])).decide(request()))
    assert result == {"actions": [{"type": "wait", "seconds": 1}], "unsure": []}


def test_each_player_keeps_its_own_thread():
    pool = pool_for(ScriptedModel(replies=[plan(), plan(), plan()]))

    async def run():
        await pool.decide(request(player="p1"))
        await pool.decide(request(player="p1", observation={"t": 2}))
        await pool.decide(request(player="p2"))

    asyncio.run(run())
    assert [pool.message_count("r1", p) for p in ("p1", "p2", "nobody")] == [4, 2, 0]


def test_the_persona_and_role_shape_the_system_prompt():
    skims = players.system_prompt(ROLE, "skims", INSTRUCTIONS)
    assert "skimmed" in skims and "Draw fast." in skims and "Tap on the cue" in skims and "Reply with ONE JSON object" in skims
    assert players.system_prompt(ROLE, "cheats", INSTRUCTIONS) != skims


@pytest.mark.parametrize("over, fragment", [
    ({"run": ""}, "run and player"),
    ({"player": "x" * 65}, "run and player"),
    ({"persona": "angry"}, "persona must be one of"),
    ({"role": None}, "needs its role"),
    ({"instructions": "text"}, "needs its role"),
    ({"observation": None}, "needs an observation"),
])
def test_bad_requests_are_refused_with_a_sentence(over, fragment):
    with pytest.raises(players.PlayerError, match=fragment):
        asyncio.run(pool_for(ScriptedModel(replies=[plan()])).decide(request(**over)))


def test_the_first_decide_needs_the_brief_but_later_ones_do_not():
    pool = pool_for(ScriptedModel(replies=[plan(), plan()]))

    async def run():
        await pool.decide(request())
        return await pool.decide({"run": "r1", "player": "p1", "observation": {"t": 2}})

    assert asyncio.run(run())["actions"] == []


def test_the_call_cap_and_the_agent_cap_stop_a_runaway():
    pool = pool_for(ScriptedModel(replies=[plan()] * 3), cap=2)

    async def three():
        for _ in range(3):
            await pool.decide(request())

    with pytest.raises(players.PlayerError, match=r"call limit reached \(2\)"):
        asyncio.run(three())
    full = pool_for(ScriptedModel(replies=[plan()] * 3), max_agents=2)

    async def four():
        for n in range(3):
            await full.decide(request(player=f"p{n}"))

    with pytest.raises(players.PlayerError, match="too many agent players"):
        asyncio.run(four())


def test_turns_of_one_player_run_one_after_the_other():
    LOG.clear()
    pool = pool_for(ScriptedModel(replies=[plan(), plan()], delay=0.1, name="a"))

    async def run():
        await asyncio.gather(pool.decide(request()), pool.decide(request(observation={"t": 2})))

    asyncio.run(run())
    assert LOG == ["a:start", "a:end", "a:start", "a:end"]


def test_an_agent_player_cannot_write_to_disk(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    model = ScriptedModel(replies=[call("write_file", "w1", file_path="/note.txt", content="x"), plan([{"type": "wait", "seconds": 1}])])
    result = asyncio.run(pool_for(model).decide(request()))
    assert result["actions"] == [{"type": "wait", "seconds": 1}]
    assert list(tmp_path.iterdir()) == []


def test_report_returns_the_players_own_notes_and_drops_the_agent():
    summary = json.dumps({"unsure": [{"phase": "draw", "line": "the cue", "why": "Never said what the cue is."}], "summary": "Went fine."})
    pool = pool_for(ScriptedModel(replies=[plan(), say(summary)]))

    async def run():
        await pool.decide(request())
        first = await pool.report({"run": "r1", "player": "p1"})
        again = await pool.report({"run": "r1", "player": "p1"})
        return first, again

    first, again = asyncio.run(run())
    assert first == {"unsure": [{"phase": "draw", "line": "the cue", "why": "Never said what the cue is."}], "summary": "Went fine."}
    assert again == {"unsure": [], "summary": ""}
    assert pool.message_count("r1", "p1") == 0


def test_two_players_decide_at_once_over_a_socket_and_each_answer_carries_its_id(monkeypatch):
    model = ScriptedModel(replies=[plan([{"type": "wait", "seconds": 1}]), plan([{"type": "wait", "seconds": 2}])], delay=0.05)
    handler = functools.partial(server.handle_socket, model=model)

    async def scenario():
        async with serve(handler, "127.0.0.1", 0, process_request=server.handle_request) as srv:
            port = srv.sockets[0].getsockname()[1]
            async with connect(f"ws://127.0.0.1:{port}/ws") as ws:
                await ws.send(json.dumps(request(id="a", player="p1")))
                await ws.send(json.dumps(request(id="b", player="p2")))
                await ws.send(json.dumps(request(id="c", player="p3", persona="angry")))
                return [json.loads(await ws.recv()) for _ in range(3)]

    replies = {r["id"]: r for r in asyncio.run(scenario())}
    assert replies["a"]["type"] == replies["b"]["type"] == "plan"
    assert replies["c"] == {"type": "error", "message": "persona must be one of follows, skims, cheats, confused", "id": "c"}
