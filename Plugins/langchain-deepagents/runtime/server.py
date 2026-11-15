"""Pear Deep Agents runtime: /health over HTTP and /ws for panel prompts (websockets only).

Live model: PEAR_AGENT_MODEL ("provider:model") or the first key set of ANTHROPIC_API_KEY, OPENAI_API_KEY,
GOOGLE_API_KEY/GEMINI_API_KEY. Extra panel origins: PEAR_ALLOWED_ORIGINS (comma-separated).

Hosted mode (PEAR_RUNTIME_SECRET set, run beside the Pear backend): /ws needs
`Authorization: Bearer $PEAR_RUNTIME_SECRET` (the backend's /agent/ws proxy sends it), the project dir
is PEAR_PROJECTS_ROOT/<X-Pear-Account>/<X-Pear-Project>, and the model key comes only from the
X-Pear-Model-Provider / X-Pear-Model-Key headers (that account's key): env keys are never used.
Bind address: PEAR_RUNTIME_HOST (default 127.0.0.1).

Messages: `prompt` (with `mode` "scripts", "instructions" or "game" (Pear MCP self-iterating loop); the instructions agent answers with one `file_written` for
instructions.json), and the agent players' `decide` -> `plan` and `report` -> `report_result`, which run beside a prompt and never
touch the project (see players.py). Agent players use PEAR_PLAYER_MODEL (not in hosted mode) and PEAR_PLAYER_CALL_CAP.
"""
import asyncio
import hmac
import json
import os
import re
import shutil
from http import HTTPStatus
from importlib.metadata import version
from pathlib import Path
from string import Template

from deepagents import FilesystemPermission, create_deep_agent
from deepagents.backends import FilesystemBackend
from langchain.agents.middleware import TodoListMiddleware
from langchain.chat_models import init_chat_model
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

import instructions as game_instructions
import pear_tools
import players
from translate import new_state, translate

PLUGIN_DIR = Path(__file__).resolve().parent.parent
NO_KEY_MESSAGE = "No model API key: set ANTHROPIC_API_KEY, OPENAI_API_KEY or GOOGLE_API_KEY."
PLAYER_TIMEOUT_S = 60


# Default "provider:model" per key provider (the backend's provider names).
DEFAULT_MODELS = {
    "anthropic": "anthropic:claude-sonnet-5-5",
    "openai": "openai:gpt-5.5",
    # shortcut: unverified model id, override with PEAR_AGENT_MODEL
    "google": "google_genai:gemini-2.5-pro",
}


def choose_model(env) -> str | None:
    """The "provider:model" to use, or None when no key is set. PEAR_AGENT_MODEL wins."""
    if env.get("PEAR_AGENT_MODEL"):
        return env["PEAR_AGENT_MODEL"]
    if env.get("ANTHROPIC_API_KEY"):
        return DEFAULT_MODELS["anthropic"]
    if env.get("OPENAI_API_KEY"):
        return DEFAULT_MODELS["openai"]
    if env.get("GOOGLE_API_KEY") or env.get("GEMINI_API_KEY"):
        return DEFAULT_MODELS["google"]
    return None


# Key-shaped tokens a provider error may echo back (Anthropic, OpenAI, Google), plus the exact keys in use.
KEY_PATTERN = re.compile(r"(sk-[A-Za-z0-9_\-]{8,}|AIza[0-9A-Za-z_\-]{20,})")


def sanitize(message: str, secrets=()) -> str:
    """Error text safe to send to the panel: known keys and key-shaped tokens replaced."""
    for secret in secrets:
        if secret:
            message = message.replace(secret, "[redacted]")
    return KEY_PATTERN.sub("[redacted]", message)


def env_secrets(env) -> list[str]:
    return [env[k] for k in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY") if env.get(k)]

# Full vibecoding access: the agent reads and writes anything in the project dir. The project dir is the
# FilesystemBackend root (virtual_mode), so paths cannot escape it.
PERMISSIONS = [
    FilesystemPermission(operations=["read", "write"], paths=["/**"]),
]

SUBAGENTS = [
    {
        "name": "client-js",
        "description": "Writes Pear client scripts (scripts/<name>.client.js) that react to input and fire RemoteEvents.",
        "system_prompt": "You write Pear client scripts using script({...}). Follow the pear-scripting skill. "
        "Write only scripts/<name>.client.js files.",
    },
    {
        "name": "server-js",
        "description": "Writes Pear server scripts (scripts/<name>.server.js) that handle RemoteEvents and keep room state.",
        "system_prompt": "You write Pear server scripts using serverScript({...}). Follow the pear-scripting skill. "
        "Write only scripts/<name>.server.js files.",
    },
]


def resolve_model(model=None):
    """`model` when given (a chat model instance from tests or the hosted key), else the env's "provider:model" choice."""
    if model is None:
        model = choose_model(os.environ)
        if model.startswith("google_genai:") and not os.environ.get("GOOGLE_API_KEY") and os.environ.get("GEMINI_API_KEY"):
            model = init_chat_model(model, api_key=os.environ["GEMINI_API_KEY"])
    return model


def player_model(model=None):
    """The model for agent players: PEAR_PLAYER_MODEL outside hosted mode (hosted never uses env keys), else the authoring agent's."""
    if model is None and not hosted() and os.environ.get("PEAR_PLAYER_MODEL"):
        return os.environ["PEAR_PLAYER_MODEL"]
    return resolve_model(model)


MODES = ("scripts", "instructions", "game")

GAME_PROMPT = """You build a complete Pear game through the Pear MCP tools and iterate until it passes.
Loop:
1. Call kit_reference first (PearUI ui.json, script API, scenario format). Never guess the formats.
2. create_game (or get_game to load the one asked for).
3. Write the files: scene.json, scripts/game.js, scripts/player.js, ui.json (PearUI) and scenario.json (devices, scripted inputs, expect list).
4. save_version {id, files} with all of them, then run_scenario with the scenario.
5. If report.ok is false, read the failing expects and the report logs (read_logs if needed), fix the files, save_version and run again.
Stop when report.ok is true or after 6 iterations. Never call publish unless the user asked for it.
Finish with a short summary of which expects pass, which still fail, and the saved version number."""


def build_agent(project_dir: Path, model=None, mode: str = "scripts", tools=None):
    """The deep agent for one project. `model` (a chat model instance) is injected by tests; otherwise the env picks it."""
    model = resolve_model(model)
    if mode == "instructions":
        return game_instructions.build_agent(project_dir, model)
    extra = {"tools": tools or [], "system_prompt": GAME_PROMPT} if mode == "game" else {}
    # The subagents specs carry no model, so they inherit this one.
    return create_deep_agent(
        **extra,
        model=model,
        skills=["/.pear/skills/"],
        memory=["/AGENTS.md"],
        middleware=[TodoListMiddleware()],
        subagents=SUBAGENTS,
        backend=FilesystemBackend(root_dir=project_dir, virtual_mode=True),
        permissions=PERMISSIONS,
    )


def prepare_project(project_dir: Path, snapshot: dict, mode: str = "scripts") -> None:
    """Copy the skills into the project, write scene.json and instructions.json (or remove a stale one) and render AGENTS.md from the prompt's project snapshot."""
    shutil.copytree(PLUGIN_DIR / "skills", project_dir / ".pear" / "skills", dirs_exist_ok=True)
    (project_dir / "scene.json").write_text(json.dumps(snapshot.get("scene") or {}, indent=2), encoding="utf-8")
    current = snapshot.get("instructions")
    if current:
        (project_dir / "instructions.json").write_text(json.dumps(current, indent=2) + "\n", encoding="utf-8")
    else:
        (project_dir / "instructions.json").unlink(missing_ok=True)
    if mode == "instructions":
        text = game_instructions.agents_md(snapshot)
    else:
        dump = lambda key: json.dumps(snapshot.get(key), indent=2)  # noqa: E731
        template = Template((PLUGIN_DIR / "AGENTS.md.tmpl").read_text(encoding="utf-8"))
        text = template.safe_substitute(scene=dump("scene"), scripts=dump("scripts"), peripherals=dump("peripherals"))
    (project_dir / "AGENTS.md").write_text(text, encoding="utf-8")


PROJECT_LOCKS: dict[Path, asyncio.Lock] = {}


async def run_prompt(message: dict, project_dir: Path, model=None, env_model=True, secrets=()):
    """Yield the panel events (without ids) for one prompt, ending with done or error.

    Prompts for the same project dir run one at a time: a second prompt waits for the first to finish.
    The agent runs in its own task and queues its events, so the project lock is released when the
    agent finishes even if the socket reading the events is slow. `env_model=False` (hosted mode)
    never falls back to env keys; `secrets` are redacted from error text.
    """
    mode = message.get("mode") or "scripts"
    if mode not in MODES:
        yield {"type": "error", "message": f"unknown mode '{mode}': use {', '.join(MODES[:-1])} or {MODES[-1]}"}
        return
    if model is None and (not env_model or choose_model(os.environ) is None):
        yield {"type": "error", "message": NO_KEY_MESSAGE}
        return
    secrets = [*secrets, *env_secrets(os.environ)]
    queue: asyncio.Queue = asyncio.Queue()

    async def produce():
        try:
            async with PROJECT_LOCKS.setdefault(project_dir, asyncio.Lock()):
                prepare_project(project_dir, message.get("project") or {}, mode)
                tools = await pear_tools.load_tools() if mode == "game" else None
                agent = build_agent(project_dir, model, mode, tools)
                state = new_state()
                async for chunk in agent.astream(
                    {"messages": [{"role": "user", "content": message["text"]}]},
                    stream_mode=["updates", "messages"],
                    subgraphs=True,
                ):
                    for event in translate(chunk, project_dir, state):
                        queue.put_nowait(event)
            queue.put_nowait({"type": "done", "summary": state["summary"]})
        except Exception as exc:  # noqa: BLE001 - any agent failure must reach the panel
            queue.put_nowait({"type": "error", "message": sanitize(f"{type(exc).__name__}: {exc}", secrets)})
        finally:
            queue.put_nowait(None)

    task = asyncio.create_task(produce())
    try:
        while (event := await queue.get()) is not None:
            yield event
    finally:
        if not task.done():
            task.cancel()  # the reader went away: stop the agent and free the lock


ALLOWED_ORIGINS = {"http://localhost:5173", "http://127.0.0.1:5173", "tauri://localhost",
                   "http://tauri.localhost", "https://tauri.localhost"}


def hosted() -> bool:
    return bool(os.environ.get("PEAR_RUNTIME_SECRET"))


SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def hosted_project_dir(headers) -> Path:
    """PEAR_PROJECTS_ROOT/<account>/<project>; ValueError for ids that are not plain slugs."""
    account, project = headers.get("X-Pear-Account", ""), headers.get("X-Pear-Project", "")
    if not SAFE_ID.match(account) or not SAFE_ID.match(project):
        raise ValueError("bad account or project id")
    root = Path(os.environ.get("PEAR_PROJECTS_ROOT", "projects")).resolve()
    path = root / account / project
    path.mkdir(parents=True, exist_ok=True)
    return path


def hosted_model(headers):
    """(chat model, key) from the account's key headers, or (None, None) when it sent none."""
    provider, key = headers.get("X-Pear-Model-Provider"), headers.get("X-Pear-Model-Key")
    if not key or provider not in DEFAULT_MODELS:
        return None, None
    return init_chat_model(DEFAULT_MODELS[provider], api_key=key), key


def handle_request(connection, request):
    if request.path == "/health":
        model = "per-account" if hosted() else choose_model(os.environ)
        response = connection.respond(HTTPStatus.OK, json.dumps({"status": "ok", "deepagents": version("deepagents"), "model": model}))
        response.headers["Content-Type"] = "application/json"
        response.headers["Access-Control-Allow-Origin"] = "*"
        return response
    if request.path != "/ws":
        return connection.respond(HTTPStatus.NOT_FOUND, "not found\n")
    if hosted():
        given = request.headers.get("Authorization", "")
        if not hmac.compare_digest(given.encode(), f"Bearer {os.environ['PEAR_RUNTIME_SECRET']}".encode()):
            return connection.respond(HTTPStatus.UNAUTHORIZED, "unauthorized\n")
    origin = request.headers.get("Origin")
    extra = {o.strip() for o in os.environ.get("PEAR_ALLOWED_ORIGINS", "").split(",") if o.strip()}
    if origin is not None and origin not in ALLOWED_ORIGINS | extra:
        return connection.respond(HTTPStatus.FORBIDDEN, "origin not allowed\n")
    return None


async def handle_socket(websocket, model=None):
    secrets, env_model = (), True
    if hosted():
        env_model = False
        try:
            hosted_dir = hosted_project_dir(websocket.request.headers)
            if model is None:
                model, key = hosted_model(websocket.request.headers)
                secrets = (key,) if key else ()
        except Exception as exc:  # noqa: BLE001 - bad ids or an unusable key: tell the panel, then close
            await websocket.send(json.dumps({"type": "error", "id": None, "message": sanitize(str(exc), secrets)}))
            return
    pool = players.PlayerPool(lambda: player_model(model))
    send_lock = asyncio.Lock()
    tasks: set[asyncio.Task] = set()

    async def send(payload: dict) -> None:
        async with send_lock:
            await websocket.send(json.dumps(payload))

    async def answer_player(message: dict) -> None:
        """One `decide` or `report`: runs beside prompts, answers with the request's id, never raises."""
        try:
            if model is None and choose_model(os.environ) is None and not os.environ.get("PEAR_PLAYER_MODEL"):
                raise players.PlayerError(NO_KEY_MESSAGE)
            async with asyncio.timeout(PLAYER_TIMEOUT_S):
                if message["type"] == "decide":
                    reply = {"type": "plan", **await pool.decide(message)}
                else:
                    reply = {"type": "report_result", **await pool.report(message)}
        except players.PlayerError as exc:
            reply = {"type": "error", "message": str(exc)}
        except TimeoutError:
            reply = {"type": "error", "message": f"The agent player did not answer within {PLAYER_TIMEOUT_S} s."}
        except Exception as exc:  # noqa: BLE001 - any agent failure must reach the caller as one error
            reply = {"type": "error", "message": sanitize(f"{type(exc).__name__}: {exc}", [*secrets, *env_secrets(os.environ)])}
        try:
            await send({**reply, "id": message.get("id")})
        except ConnectionClosed:
            pass

    try:
        async for raw in websocket:
            try:
                message = json.loads(raw)
                prompt_id, kind = message.get("id"), message.get("type")
            except (ValueError, AttributeError):
                message, prompt_id, kind = {}, None, None
            if kind in ("decide", "report"):
                task = asyncio.create_task(answer_player(message))
                tasks.add(task)
                task.add_done_callback(tasks.discard)
                continue
            if kind != "prompt" or not isinstance(message.get("text"), str):
                await send({"type": "error", "id": prompt_id, "message": "expected a prompt message"})
                continue
            project_dir = hosted_dir if hosted() else Path(os.environ.get("PEAR_PROJECT_DIR", ".")).resolve()
            async for event in run_prompt(message, project_dir, model, env_model, secrets):
                await send({**event, "id": prompt_id})
    except ConnectionClosed:
        pass
    finally:
        for task in tasks:
            task.cancel()
        pool.close()


async def main() -> None:
    port = int(os.environ.get("PEAR_PLUGIN_PORT", "9410"))
    host = os.environ.get("PEAR_RUNTIME_HOST", "127.0.0.1")
    async with serve(handle_socket, host, port, process_request=handle_request, max_size=2**22):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
