import random
from .registry import register_tool

_CONNECTORS = [
    {"id": "stripe_us", "name": "Stripe US", "region": "US", "status": "active"},
    {"id": "adyen_eu", "name": "Adyen EU", "region": "EU", "status": "active"},
    {"id": "paypal_global", "name": "PayPal Global", "region": "GLOBAL", "status": "active"},
    {"id": "braintree_us", "name": "Braintree US", "region": "US", "status": "degraded"},
]


@register_tool(
    "yuno_list_connectors",
    "List all active PSP (Payment Service Provider) connectors with their status and region.",
    {},
)
def yuno_list_connectors() -> list[dict]:
    return _CONNECTORS


@register_tool(
    "yuno_get_approval_rate",
    "Get the payment approval rate for a specific PSP connector over a time window.",
    {
        "connector_id": {
            "type": "string",
            "description": "The PSP connector ID (e.g. stripe_us, adyen_eu)",
            "required": True,
        },
        "time_window_hours": {
            "type": "integer",
            "description": "How many hours back to check (default 24)",
        },
    },
)
def yuno_get_approval_rate(connector_id: str, time_window_hours: int = 24) -> dict:
    rates = {
        "stripe_us": 91.5,
        "adyen_eu": 88.2,
        "paypal_global": 94.1,
        "braintree_us": 72.3,  # degraded
    }
    rate = rates.get(connector_id, round(random.uniform(70, 95), 1))
    return {
        "connector_id": connector_id,
        "approval_rate_pct": rate,
        "time_window_hours": time_window_hours,
        "total_transactions": random.randint(100, 5000),
        "approved": int(rate),
        "declined": int(100 - rate),
        "alert": rate < 85,
    }


@register_tool(
    "yuno_list_chargebacks",
    "List chargeback cases filtered by status (open, resolved, all).",
    {
        "status": {
            "type": "string",
            "description": "Filter by status: open, resolved, or all",
        }
    },
)
def yuno_list_chargebacks(status: str = "open") -> list[dict]:
    chargebacks = [
        {
            "id": "cb_001",
            "transaction_id": "txn_001",
            "amount_usd": 149.99,
            "reason": "Item not received",
            "status": "open",
            "connector": "stripe_us",
            "created_at": "2026-05-26",
        },
        {
            "id": "cb_002",
            "transaction_id": "txn_005",
            "amount_usd": 399.99,
            "reason": "Unauthorized transaction",
            "status": "open",
            "connector": "paypal_global",
            "created_at": "2026-05-25",
        },
        {
            "id": "cb_003",
            "transaction_id": "txn_006",
            "amount_usd": 120.00,
            "reason": "Item not as described",
            "status": "resolved",
            "connector": "stripe_us",
            "created_at": "2026-05-20",
        },
    ]
    if status == "all":
        return chargebacks
    return [c for c in chargebacks if c["status"] == status]


@register_tool(
    "yuno_get_transaction_detail",
    "Get full details of a specific transaction by ID.",
    {
        "transaction_id": {
            "type": "string",
            "description": "The transaction ID to look up",
            "required": True,
        }
    },
)
def yuno_get_transaction_detail(transaction_id: str) -> dict:
    transactions = {
        "txn_001": {
            "id": "txn_001", "connector": "stripe_us", "amount": 149.99, "currency": "USD",
            "status": "approved", "psp_response_code": "00", "customer_email": "user@example.com",
            "created_at": "2026-05-27 10:00:00",
        },
        "txn_005": {
            "id": "txn_005", "connector": "paypal_global", "amount": 399.99, "currency": "USD",
            "status": "approved", "psp_response_code": "00", "customer_email": "buyer@shop.com",
            "created_at": "2026-05-27 10:20:00",
        },
    }
    return transactions.get(transaction_id, {"error": f"Transaction {transaction_id} not found"})
