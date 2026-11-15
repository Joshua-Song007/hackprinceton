"""Pure translation of Deep Agents stream chunks into Pear panel events (without the prompt id)."""
from pathlib import Path

SCRIPT_TOOLS = {"write_file", "edit_file"}
# The instructions agent's own tool: it validates, writes /instructions.json itself and answers "Saved" or "Error: ...".
INSTRUCTIONS_TOOL = "submit_instructions"
GAME_FILES = ("scene.json", "ui.json", "controller.json", "cues.json", "instructions.json")


def new_state() -> dict:
    """Per-prompt bookkeeping: task/write calls awaiting their ToolMessage, and the last reply text."""
    return {"tasks": {}, "writes": {}, "running": {}, "summary": ""}


def _text(content) -> str:
    if isinstance(content, str):
        return content
    # Gemini returns plain-string parts, Anthropic/OpenAI dict blocks (thinking blocks have no "text").
    return "".join(b if isinstance(b, str) else b.get("text", "") for b in content if isinstance(b, (str, dict)))


def translate(chunk, project_dir, state: dict) -> list[dict]:
    """chunk is one `(namespace, mode, data)` item from astream(stream_mode=[...], subgraphs=True)."""
    namespace, mode, data = chunk
    if mode != "updates":
        return []
    events: list[dict] = []
    # A subagent's graph namespace is "tools:<uuid>" (not the task call id): bind each new one to the oldest task not yet running.
    if namespace and namespace[0] not in state["running"]:
        waiting = [call_id for call_id in state["tasks"] if call_id not in state["running"].values()]
        state["running"][namespace[0]] = waiting[0] if waiting else None
        if waiting:
            events.append(_status(state["tasks"][waiting[0]], "running", ""))
    for node_update in data.values():
        if not isinstance(node_update, dict):
            continue
        messages = node_update.get("messages")
        if not isinstance(messages, list):
            continue
        for message in messages:
            events += _message_events(namespace, message, Path(project_dir), state)
    return events


def _status(name: str, status: str, detail: str) -> dict:
    return {"type": "subagent_status", "name": name, "state": status, "detail": detail}


def _in_scripts(project_dir: Path, file_path) -> bool:
    """True for files the panel applies: anything under /scripts/ or /assets/, /scene.json, /ui.json, /controller.json, /cues.json, and /instructions.json (a proposal)."""
    if not isinstance(file_path, str) or not file_path.startswith("/"):
        return False
    target = (project_dir / file_path.lstrip("/")).resolve()
    return (target in [(project_dir / name).resolve() for name in GAME_FILES]
            or any(target.is_relative_to((project_dir / folder).resolve()) for folder in ("scripts", "assets")))


def _message_events(namespace, message, project_dir: Path, state: dict) -> list[dict]:
    events: list[dict] = []
    kind = getattr(message, "type", None)
    if kind == "ai":
        for call in message.tool_calls or []:
            args = call.get("args") or {}
            if call["name"] == "write_todos":
                events.append({"type": "todos", "items": [
                    {"content": t["content"], "status": t["status"]} for t in args.get("todos", [])]})
            elif call["name"] == "task":
                name = args.get("subagent_type", "")
                state["tasks"][call["id"]] = name
                events.append(_status(name, "started", args.get("description", "")))
            elif call["name"] in SCRIPT_TOOLS and _in_scripts(project_dir, args.get("file_path")):
                state["writes"][call["id"]] = args["file_path"].lstrip("/")
            elif call["name"] == INSTRUCTIONS_TOOL:
                state["writes"][call["id"]] = "instructions.json"
        if not message.tool_calls and not namespace:
            state["summary"] = _text(message.content)
    elif kind == "tool":
        failed = getattr(message, "status", None) == "error" or _text(message.content).startswith("Error")
        task_name = state["tasks"].get(message.tool_call_id)
        if task_name is not None:
            events.append(_status(task_name, "error" if failed else "done", _text(message.content)[:200]))
        relative = state["writes"].pop(message.tool_call_id, None)
        target = project_dir / relative if relative else None
        if target and not failed and target.is_file():
            events.append({"type": "file_written", "path": relative, "content": target.read_text(encoding="utf-8")})
    return events
