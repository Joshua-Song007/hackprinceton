"""Test double for the LLM boundary only: a chat model that replays scripted replies. Everything else in the tests is real."""
import time

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult


def call(name: str, call_id: str, **args) -> AIMessage:
    return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": call_id}])


def say(text: str) -> AIMessage:
    return AIMessage(content=text)


# "<name>:start" / "<name>:end" around each reply, across all models (pydantic would copy a list field).
LOG: list[str] = []


class ScriptedModel(BaseChatModel):
    replies: list[AIMessage]
    next_index: int = 0
    delay: float = 0
    name: str = ""

    @property
    def _llm_type(self) -> str:
        return "scripted"

    def bind_tools(self, tools, **kwargs):
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        LOG.append(f"{self.name}:start")
        time.sleep(self.delay)
        reply = self.replies[self.next_index]
        self.next_index += 1
        LOG.append(f"{self.name}:end")
        return ChatResult(generations=[ChatGeneration(message=reply)])
