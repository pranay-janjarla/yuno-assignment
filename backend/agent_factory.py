"""
Agent Factory: Takes a user description, sends it to OpenAI with rich context
about available tools and the database schema, and gets back a complete
agent configuration JSON.
"""
import json
import os
from openai import OpenAI
from tools import TOOL_CATALOG
from tools.database_tool import DB_SCHEMA

client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

FACTORY_SYSTEM_PROMPT = """You are an expert AI agent architect. Given a user's description of what they want an agent to do, generate a complete agent configuration as JSON.

You must respond ONLY with valid JSON — no markdown fences, no explanation outside the JSON.

AVAILABLE TOOLS:
{tools_catalog}

DATABASE SCHEMA:
{db_schema}

AVAILABLE MODELS:
- gpt-5 (most capable, best for complex reasoning, multi-step tasks, analysis)
- gpt-4o (good for complex tasks)
- gpt-4o-mini (fast and cheap, good for simple lookups)

OUTPUT JSON (respond with exactly this structure):
{{
  "name": "short descriptive agent name (3-5 words)",
  "enhanced_description": "rich 2-3 sentence description of what this agent does",
  "system_prompt": "complete system prompt for the agent — be specific about its role, decision-making approach, output format, and any domain rules (100-300 words)",
  "model": "model ID from the list above",
  "tools": ["tool_id_1", "tool_id_2"],
  "reasoning": "1-2 sentences explaining why these tools and model were chosen"
}}

Rules:
- Only use tools from the AVAILABLE TOOLS list
- Choose the minimal set of tools that actually covers the use case
- If the use case involves payments, prefer yuno tools + database_query
- If the use case needs live information, include web_search
"""


def build_tools_catalog_text() -> str:
    lines = []
    for name, info in TOOL_CATALOG.items():
        params = ", ".join(info["parameters"].keys()) if info["parameters"] else "no params"
        lines.append(f"- {name}({params}): {info['description']}")
    return "\n".join(lines)


async def generate_agent_config(user_description: str) -> dict:
    system = FACTORY_SYSTEM_PROMPT.format(
        tools_catalog=build_tools_catalog_text(),
        db_schema=DB_SCHEMA,
    )

    response = client.chat.completions.create(
        model="gpt-5",
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": f"Create an agent for this use case:\n\n{user_description}"},
        ],
    )

    config = json.loads(response.choices[0].message.content)

    # Validate tools exist
    valid_tools = list(TOOL_CATALOG.keys())
    config["tools"] = [t for t in config.get("tools", []) if t in valid_tools]

    return config
