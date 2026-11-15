from langchain_core.messages import AIMessage, ToolMessage

import translate as translate_module
from translate import new_state, translate


def ai(*calls):
    return AIMessage(content="", tool_calls=[{"name": n, "args": a, "id": i} for n, a, i in calls])


def updates(namespace, message):
    return (namespace, "updates", {"model": {"messages": [message]}})


def test_recorded_chunks_become_events(tmp_path):
    (tmp_path / "scripts").mkdir()
    (tmp_path / "scripts" / "a.client.js").write_text("export default script({})", encoding="utf-8")
    todos = [{"content": "do it", "status": "in_progress"}]
    chunks = [
        updates((), ai(("write_todos", {"todos": todos}, "c1"))),
        updates((), ai(("task", {"subagent_type": "client-js", "description": "go"}, "c2"))),
        updates(("tools:abc",), ai(("write_file", {"file_path": "/scripts/a.client.js", "content": "x"}, "c3"))),
        updates(("tools:abc",), ToolMessage(content="Updated file", tool_call_id="c3", name="write_file")),
        updates((), ToolMessage(content="all done", tool_call_id="c2", name="task")),
        updates((), AIMessage(content="finished")),
        ((), "messages", ("ignored", {})),
    ]
    state, events = new_state(), []
    for chunk in chunks:
        events += translate(chunk, tmp_path, state)
    assert events == [
        {"type": "todos", "items": todos},
        {"type": "subagent_status", "name": "client-js", "state": "started", "detail": "go"},
        {"type": "subagent_status", "name": "client-js", "state": "running", "detail": ""},
        {"type": "file_written", "path": "scripts/a.client.js", "content": "export default script({})"},
        {"type": "subagent_status", "name": "client-js", "state": "done", "detail": "all done"},
    ]
    assert state["summary"] == "finished"


def test_failed_write_and_non_script_write_emit_nothing(tmp_path):
    (tmp_path / "scripts").mkdir()
    (tmp_path / "scripts" / "a.client.js").write_text("old", encoding="utf-8")
    state = new_state()
    events = translate(updates((), ai(("write_file", {"file_path": "/scripts/a.client.js"}, "w1"))), tmp_path, state)
    events += translate(updates((), ToolMessage(content="Error: permission denied", tool_call_id="w1", name="write_file")), tmp_path, state)
    events += translate(updates((), ai(("write_file", {"file_path": "/AGENTS.md"}, "w2"))), tmp_path, state)
    events += translate(updates((), ToolMessage(content="ok", tool_call_id="w2", name="write_file")), tmp_path, state)
    assert events == []


def test_scripts_path_traversal_is_not_a_script_write(tmp_path):
    (tmp_path / "x.js").write_text("x")
    assert not translate_module._in_scripts(tmp_path, "/scripts/../x.js")
    assert translate_module._in_scripts(tmp_path, "/scripts/a.js")


def test_openai_and_gemini_stream_shapes(tmp_path):
    # OpenAI: tool calls plus a text-block reply; Gemini: plain-string content parts and a thinking block.
    todos = [{"content": "do it", "status": "pending"}]
    state, events = new_state(), []
    events += translate(updates((), ai(("write_todos", {"todos": todos}, "call_abc"))), tmp_path, state)
    events += translate(updates((), ai(("task", {"subagent_type": "server-js", "description": "go"}, "call_def"))), tmp_path, state)
    events += translate(updates((), AIMessage(content=["Wrote ", {"type": "thinking", "thinking": "hm"}, "it."])), tmp_path, state)
    assert events == [{"type": "todos", "items": todos},
                      {"type": "subagent_status", "name": "server-js", "state": "started", "detail": "go"}]
    assert state["summary"] == "Wrote it."
    translate(updates((), AIMessage(content=[{"type": "text", "text": "ok"}])), tmp_path, state)
    assert state["summary"] == "ok"


def test_scene_json_edit_becomes_file_written(tmp_path):
    (tmp_path / "scene.json").write_text('{"entities": []}', encoding="utf-8")
    state = new_state()
    events = translate(updates((), ai(("edit_file", {"file_path": "/scene.json"}, "e1"))), tmp_path, state)
    events += translate(updates((), ToolMessage(content="ok", tool_call_id="e1", name="edit_file")), tmp_path, state)
    assert events == [{"type": "file_written", "path": "scene.json", "content": '{"entities": []}'}]
    assert not translate_module._in_scripts(tmp_path, "/scene.json.bak")
    assert not translate_module._in_scripts(tmp_path, "/scripts/../scene.json/../AGENTS.md")


def test_instructions_json_write_and_a_successful_submit_become_file_written(tmp_path):
    (tmp_path / "instructions.json").write_text('{"title": "T"}', encoding="utf-8")
    state = new_state()
    events = translate(updates((), ai(("write_file", {"file_path": "/instructions.json"}, "w1"))), tmp_path, state)
    events += translate(updates((), ToolMessage(content="ok", tool_call_id="w1", name="write_file")), tmp_path, state)
    events += translate(updates((), ai(("submit_instructions", {"instructions": {}}, "s1"))), tmp_path, state)
    events += translate(updates((), ToolMessage(content="Saved", tool_call_id="s1", name="submit_instructions")), tmp_path, state)
    assert events == [{"type": "file_written", "path": "instructions.json", "content": '{"title": "T"}'}] * 2


def test_a_rejected_submit_and_lookalike_instruction_paths_emit_nothing(tmp_path):
    (tmp_path / "instructions.json").write_text('{"title": "old"}', encoding="utf-8")
    state = new_state()
    events = translate(updates((), ai(("submit_instructions", {"instructions": {}}, "s1"))), tmp_path, state)
    events += translate(updates((), ToolMessage(content="Error: players must be {min, max}", tool_call_id="s1", name="submit_instructions")), tmp_path, state)
    assert events == []
    assert not translate_module._in_scripts(tmp_path, "/instructions.json.bak")
    assert not translate_module._in_scripts(tmp_path, "/scripts/../instructions.json/x")
    assert translate_module._in_scripts(tmp_path, "/instructions.json")
