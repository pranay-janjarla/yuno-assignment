import sqlite3
from .registry import register_tool

DB_PATH = "payments_data.db"

DB_SCHEMA = """
Tables in payments_data.db:

transactions (id, connector_id, amount, currency, status, psp_response_code, created_at)
  - status: 'approved' or 'declined'
  - psp_response_code: '00'=success, '51'=insufficient funds, '05'=do not honor, '14'=invalid card

chargebacks (id, transaction_id, amount, reason, status, created_at)
  - status: 'open' or 'resolved'
"""


@register_tool(
    "database_query",
    f"Query the payments database using SQL. {DB_SCHEMA}",
    {
        "sql": {
            "type": "string",
            "description": "A SELECT SQL query to run against the payments database",
            "required": True,
        }
    },
)
def database_query(sql: str) -> list[dict]:
    sql_lower = sql.strip().lower()
    if not sql_lower.startswith("select"):
        return [{"error": "Only SELECT queries are allowed"}]
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        c.execute(sql)
        rows = [dict(row) for row in c.fetchall()]
        conn.close()
        return rows if rows else [{"result": "No rows found"}]
    except Exception as e:
        return [{"error": str(e)}]
