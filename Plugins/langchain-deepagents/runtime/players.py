"""Agent players: one deep agent per (run, player) that plays a Pear game as a person would, from the instructions and what it
perceives, and answers each turn with a JSON plan. Studio sends `decide` and `report`; nothing here touches the project or disk.

Reply shape: {"actions": [...], "unsure": [...]}. Actions (Studio's parseActions must agree):
  {type: walk_to, x, z}  {type: look_at, player} or {type: look_at, x, z}  {type: gesture, gesture}
  {type: give_device, device, to}  {type: say, text}  {type: wait, seconds}
"""
import asyncio
import json
import math
import os
from dataclasses import dataclass

from deepagents import create_deep_agent
from langgraph.checkpoint.memory import InMemorySaver

from translate import _text

DEFAULT_CALL_CAP = 120
MAX_AGENTS = 32
MAX_ACTIONS = 5
MAX_UNSURE = 5
RECURSION_LIMIT = 10
MAX_NAME = 64
GESTURES = ["tap", "doubleTap", "flick", "squeeze", "pinch"]
DEVICES = ["phone", "watch", "airpods"]

PERSONAS = {
    "follows": "You read the instructions carefully and do what your role's steps say, when they say it.",
    "skims": "You only skimmed the instructions: you remember the summary and your role's brief, not the step details. "
    "When unsure, do what feels natural and note what you had to guess.",
    "cheats": "You look for ways to win by bending any rule the instructions leave open. Stay inside what a person could "
    "physically do in the room.",
    "confused": "You are new to games like this and unsure what the instructions mean. When a step is vague, take a reasonable "
    "reading, hesitate (wait) and say out loud what you are unsure about.",
}

REPLY_RULES = """Each turn you receive an Observation. Reply with ONE JSON object and nothing else:
{"actions": [...], "unsure": [...]}
Actions, at most 5, done in order:
- {"type": "walk_to", "x": number, "z": number}: walk to a spot in the room (meters).
- {"type": "look_at", "player": "<player id>"} or {"type": "look_at", "x": number, "z": number}: turn your head toward them.
- {"type": "gesture", "gesture": "tap" | "doubleTap" | "flick" | "squeeze" | "pinch"}: a gesture with your device.
- {"type": "give_device", "device": "phone" | "watch" | "airpods", "to": "<player id>"}: hand a device you hold to someone.
- {"type": "say", "text": "..."}: say something out loud (short).
- {"type": "wait", "seconds": number}: do nothing for 0.5 to 10 seconds.
"unsure": when an instruction was unclear, missing, or contradicted by what you saw, add
{"phase": "<phase id or empty>", "line": "<the instruction text, copied>", "why": "<what confused you>"}. Otherwise leave it empty.
Do not use tools or write files. Answer with the JSON directly."""

REPORT_QUESTION = (
    "The game is over. Reply with ONE JSON object: {\"unsure\": [{\"phase\": \"\", \"line\": \"\", \"why\": \"\"}], \"summary\": \"...\"}. "
    "List every place the instructions were unclear, missing or wrong for you, and sum up in a few sentences how it went."
)


class PlayerError(Exception):
    """A problem with one player request, worded for the panel."""


def system_prompt(role: dict, persona: str, instructions: dict) -> str:
    """The standing brief for one player: who they are, how they behave, the instructions every player was given, how to answer."""
    name = role.get("name") or role.get("id") or "Player"
    shared = {k: instructions.get(k) for k in ("title", "summary", "space", "setup", "players", "roles", "phases", "win") if instructions.get(k)}
    return (
        "You are a play-tester standing in a real room playing a Pear game with other people. You are not the game: you only know "
        "what a person would perceive (the Observation you get each turn) and you act only by replying with JSON.\n\n"
        f"{PERSONAS[persona]}\n\n"
        f"Your role: {name} (id {role.get('id', '')}, kind {role.get('kind', 'player')}). {role.get('brief', '')}\n\n"
        f"The instructions every player was given:\n{json.dumps(shared, indent=1)}\n\n{REPLY_RULES}"
    )


def extract_json(text: str):
    """The first JSON object in `text` (a reply may wrap it in prose or a code fence), or None."""
    decoder = json.JSONDecoder()
    i = text.find("{")
    while i != -1:
        try:
            value, _ = decoder.raw_decode(text[i:])
            if isinstance(value, dict):
                return value
        except ValueError:
            pass
        i = text.find("{", i + 1)
    return None


def _number(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def _name(x) -> bool:
    return isinstance(x, str) and 0 < len(x) <= MAX_NAME


def clean_actions(raw) -> list[dict]:
    """The valid actions of a reply, in order, at most MAX_ACTIONS; anything else is dropped."""
    out: list[dict] = []
    for a in raw if isinstance(raw, list) else []:
        if not isinstance(a, dict):
            continue
        kind = a.get("type")
        if kind == "walk_to" and _number(a.get("x")) and _number(a.get("z")):
            out.append({"type": kind, "x": a["x"], "z": a["z"]})
        elif kind == "look_at" and _name(a.get("player")):
            out.append({"type": kind, "player": a["player"]})
        elif kind == "look_at" and _number(a.get("x")) and _number(a.get("z")):
            out.append({"type": kind, "x": a["x"], "z": a["z"]})
        elif kind == "gesture" and a.get("gesture") in GESTURES:
            out.append({"type": kind, "gesture": a["gesture"]})
        elif kind == "give_device" and a.get("device") in DEVICES and _name(a.get("to")):
            out.append({"type": kind, "device": a["device"], "to": a["to"]})
        elif kind == "say" and isinstance(a.get("text"), str) and a["text"].strip():
            out.append({"type": kind, "text": a["text"].strip()[:200]})
        elif kind == "wait" and _number(a.get("seconds")):
            out.append({"type": kind, "seconds": min(10, max(0.5, a["seconds"]))})
        if len(out) == MAX_ACTIONS:
            break
    return out


def clean_unsure(raw) -> list[dict]:
    """The usable notes of a reply: `why` is required, strings are cut, at most MAX_UNSURE."""
    out: list[dict] = []
    for n in raw if isinstance(raw, list) else []:
        if not isinstance(n, dict) or not isinstance(n.get("why"), str) or not n["why"].strip():
            continue
        out.append({"phase": str(n.get("phase") or "")[:40].strip(), "line": str(n.get("line") or "")[:300].strip(), "why": n["why"].strip()[:300]})
        if len(out) == MAX_UNSURE:
            break
    return out


def parse_plan(reply: str) -> dict:
    """{actions, unsure} from a model reply. A reply with no JSON becomes a short wait and a note, so the run goes on."""
    data = extract_json(reply)
    if data is None:
        return {"actions": [{"type": "wait", "seconds": 2}], "unsure": [{"phase": "", "line": "", "why": "The agent's reply was not valid JSON."}]}
    return {"actions": clean_actions(data.get("actions")), "unsure": clean_unsure(data.get("unsure"))}


def _last_text(result: dict) -> str:
    for message in reversed(result.get("messages", [])):
        if getattr(message, "type", None) == "ai":
            text = _text(message.content)
            if text.strip():
                return text
    return ""


@dataclass
class _Player:
    agent: object
    config: dict
    lock: asyncio.Lock
    calls: int = 0


class PlayerPool:
    """The player agents of one connection. `model_factory` returns the chat model (called once, when the first agent is made)."""

    def __init__(self, model_factory, cap: int | None = None, max_agents: int = MAX_AGENTS):
        self._factory = model_factory
        self._model = None
        self.cap = cap if cap is not None else int(os.environ.get("PEAR_PLAYER_CALL_CAP", DEFAULT_CALL_CAP))
        self.max_agents = max_agents
        self._players: dict[tuple[str, str], _Player] = {}

    @staticmethod
    def _key(request: dict) -> tuple[str, str]:
        run, player = request.get("run"), request.get("player")
        if not _name(run) or not _name(player):
            raise PlayerError(f"run and player must be text of 1 to {MAX_NAME} characters")
        return run, player

    def _new_player(self, key: tuple[str, str], request: dict) -> _Player:
        persona, role, instructions = request.get("persona"), request.get("role"), request.get("instructions")
        if persona not in PERSONAS:
            raise PlayerError(f"persona must be one of {', '.join(PERSONAS)}")
        if not isinstance(role, dict) or not isinstance(instructions, dict):
            raise PlayerError("the first decide for a player needs its role and the instructions")
        if len(self._players) >= self.max_agents:
            raise PlayerError(f"too many agent players on this connection ({self.max_agents})")
        if self._model is None:
            self._model = self._factory()
        agent = create_deep_agent(model=self._model, system_prompt=system_prompt(role, persona, instructions), checkpointer=InMemorySaver())
        config = {"configurable": {"thread_id": f"{key[0]}:{key[1]}"}, "recursion_limit": RECURSION_LIMIT}
        player = self._players[key] = _Player(agent, config, asyncio.Lock())
        return player

    async def _ask(self, player: _Player, text: str) -> str:
        if player.calls >= self.cap:
            raise PlayerError(f"agent player call limit reached ({self.cap})")
        player.calls += 1
        result = await player.agent.ainvoke({"messages": [{"role": "user", "content": text}]}, player.config)
        return _last_text(result)

    async def decide(self, request: dict) -> dict:
        """{actions, unsure} for one turn. Turns of the same player run one after the other."""
        key = self._key(request)
        if request.get("observation") is None:
            raise PlayerError("decide needs an observation")
        player = self._players.get(key) or self._new_player(key, request)
        observation = json.dumps(request["observation"])[:20000]
        async with player.lock:
            reply = await self._ask(player, f"Observation (game time {request.get('game_time', '?')} s):\n{observation}")
        return parse_plan(reply)

    async def report(self, request: dict) -> dict:
        """{unsure, summary} from the player's own look back; the player is dropped afterwards. Unknown players give an empty report."""
        key = self._key(request)
        player = self._players.get(key)
        if player is None:
            return {"unsure": [], "summary": ""}
        try:
            async with player.lock:
                reply = await self._ask(player, REPORT_QUESTION)
        finally:
            self._players.pop(key, None)
        data = extract_json(reply)
        if data is None:
            return {"unsure": [], "summary": reply.strip()[:600]}
        return {"unsure": clean_unsure(data.get("unsure")), "summary": str(data.get("summary") or "")[:600]}

    def message_count(self, run: str, player: str) -> int:
        """How many messages the player's thread holds (zero for an unknown player)."""
        entry = self._players.get((run, player))
        return len(entry.agent.get_state(entry.config).values.get("messages", [])) if entry else 0

    def close(self) -> None:
        self._players.clear()
