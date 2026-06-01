from typing import Callable

TOOL_REGISTRY: dict[str, Callable] = {}

TOOL_CATALOG = {}  # name -> {description, parameters}


def register_tool(name: str, description: str, parameters: dict):
    def decorator(fn: Callable):
        TOOL_REGISTRY[name] = fn
        TOOL_CATALOG[name] = {
            "name": name,
            "description": description,
            "parameters": parameters,
        }
        return fn
    return decorator


def get_tool_definitions_for_claude() -> list[dict]:
    """Return tool definitions with a valid JSON Schema (required as top-level array)."""
    tools = []
    for name, info in TOOL_CATALOG.items():
        properties = {}
        required = []
        for param_name, param_def in info["parameters"].items():
            # Strip internal 'required' flag — it belongs at the object level
            properties[param_name] = {k: v for k, v in param_def.items() if k != "required"}
            if param_def.get("required", False):
                required.append(param_name)

        schema: dict = {"type": "object", "properties": properties}
        if required:
            schema["required"] = required

        tools.append({
            "name": name,
            "description": info["description"],
            "input_schema": schema,
        })
    return tools


def get_tools_for_agent(tool_ids: list[str]) -> list[dict]:
    """Return Claude tool definitions for a specific set of tool IDs."""
    return [t for t in get_tool_definitions_for_claude() if t["name"] in tool_ids]


def execute_tool(name: str, inputs: dict) -> str:
    if name not in TOOL_REGISTRY:
        return f"Error: tool '{name}' not found"
    try:
        result = TOOL_REGISTRY[name](**inputs)
        import json
        return json.dumps(result, indent=2) if not isinstance(result, str) else result
    except Exception as e:
        return f"Error executing {name}: {str(e)}"
