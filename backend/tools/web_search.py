import os
from .registry import register_tool


@register_tool(
    "web_search",
    "Search the web for current information on any topic.",
    {
        "query": {
            "type": "string",
            "description": "The search query",
            "required": True,
        },
        "max_results": {
            "type": "integer",
            "description": "Number of results to return (default 5)",
        },
    },
)
def web_search(query: str, max_results: int = 5) -> list[dict]:
    api_key = os.getenv("TAVILY_API_KEY")
    if not api_key:
        return [{"error": "TAVILY_API_KEY not set", "query": query}]

    try:
        from tavily import TavilyClient
        client = TavilyClient(api_key=api_key)
        response = client.search(query=query, max_results=max_results)
        results = response.get("results", [])
        return [
            {
                "title": r.get("title", ""),
                "snippet": r.get("content", ""),
                "url": r.get("url", ""),
            }
            for r in results
        ]
    except Exception as e:
        return [{"error": f"Tavily search failed: {str(e)}", "query": query}]
