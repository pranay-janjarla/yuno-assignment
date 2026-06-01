"""
Agent Runner: Takes a stored agent config and runs it on a user task.
Uses OpenAI tool_use agentic loop, returns only the final answer via SSE.
"""
import json
import os
from typing import AsyncGenerator
from openai import OpenAI
from tools import execute_tool, get_tools_for_agent

client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

DEFAULT_MODEL = "gpt-4o-mini"
MAX_ITERATIONS = 10


def _openai_tools(tool_ids: list[str]) -> list[dict]:
    """Convert our tool catalog format to OpenAI function format."""
    raw = get_tools_for_agent(tool_ids)
    result = []
    for t in raw:
        result.append({
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t["description"],
                "parameters": t["input_schema"],
            },
        })
    return result


async def run_agent_task(
    system_prompt: str,
    model: str,
    tool_ids: list[str],
    task: str,
) -> AsyncGenerator[str, None]:
    def sse(event_type: str, data: dict) -> str:
        return f"data: {json.dumps({'type': event_type, **data})}\n\n"

    resolved_model = model or DEFAULT_MODEL
    oai_tools = _openai_tools(tool_ids)

    tools_preamble = (
        f"You have access to these tools: {', '.join(tool_ids)}. "
        "Always use them when they would help answer the user's request.\n\n"
    ) if tool_ids else ""

    messages = [
        {"role": "system", "content": tools_preamble + system_prompt},
        {"role": "user", "content": task},
    ]

    for _ in range(MAX_ITERATIONS):
        kwargs: dict = {"model": resolved_model, "messages": messages}
        if oai_tools:
            kwargs["tools"] = oai_tools
            kwargs["tool_choice"] = "auto"

        response = client.chat.completions.create(**kwargs)
        msg = response.choices[0].message
        finish_reason = response.choices[0].finish_reason

        # Final answer — no more tool calls
        if finish_reason == "stop" or not msg.tool_calls:
            final_text = msg.content or "Done."
            yield sse("text", {"message": final_text})
            yield sse("done", {"message": "Task complete."})
            return

        # Tool call round — emit tool events, then continue
        messages.append(msg)
        for tc in msg.tool_calls:
            inputs = json.loads(tc.function.arguments)
            yield sse("tool_call", {"tool": tc.function.name, "inputs": inputs})
            result = execute_tool(tc.function.name, inputs)
            yield sse("tool_result", {"tool": tc.function.name, "result": result[:1000]})
            messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": result,
            })

    yield sse("text", {"message": "I was unable to complete this task within the allowed steps."})
    yield sse("done", {"message": "Reached maximum iterations."})


def run_conversation_turn(
    system_prompt: str,
    model: str,
    tool_ids: list[str],
    history: list[dict],
    user_message: str,
) -> tuple[str, list[dict]]:
    """
    Run one conversational turn (synchronous, for Telegram bot).
    history: list of {"role": "user"|"assistant", "content": str} from prior turns.
    Returns (response_text, updated_history).
    """
    resolved_model = model or DEFAULT_MODEL
    oai_tools = _openai_tools(tool_ids)

    tools_preamble = (
        f"You have access to these tools: {', '.join(tool_ids)}. "
        "Always use them when they would help answer the user's request.\n\n"
    ) if tool_ids else ""

    messages: list = [{"role": "system", "content": tools_preamble + system_prompt}]
    messages.extend(history)
    messages.append({"role": "user", "content": user_message})

    for _ in range(MAX_ITERATIONS):
        kwargs: dict = {"model": resolved_model, "messages": messages}
        if oai_tools:
            kwargs["tools"] = oai_tools
            kwargs["tool_choice"] = "auto"

        response = client.chat.completions.create(**kwargs)
        msg = response.choices[0].message
        finish_reason = response.choices[0].finish_reason

        if finish_reason == "stop" or not msg.tool_calls:
            final_text = msg.content or "Done."
            updated = history + [
                {"role": "user", "content": user_message},
                {"role": "assistant", "content": final_text},
            ]
            return final_text, updated

        messages.append(msg)
        for tc in msg.tool_calls:
            inputs = json.loads(tc.function.arguments)
            result = execute_tool(tc.function.name, inputs)
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})

    final_text = "I was unable to complete this within the allowed steps."
    updated = history + [
        {"role": "user", "content": user_message},
        {"role": "assistant", "content": final_text},
    ]
    return final_text, updated
