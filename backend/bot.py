"""
Yuno Agent Platform — Telegram Bot

/start  → pick Agents or Workflows → pick item → session starts
/stop   → ends the active session
/help   → command reference
"""

import os
import httpx
from dotenv import load_dotenv
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    CallbackQueryHandler,
    filters,
    ContextTypes,
)

load_dotenv()

API_BASE = os.environ.get("API_BASE_URL", "http://localhost:8000").rstrip("/")
BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")

# { chat_id: { "type": "agent"|"workflow", "id": str, "name": str, "history": list } }
sessions: dict[int, dict] = {}


# ─── /start — step 1: choose category ────────────────────────────────────────

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = update.effective_chat.id
    sessions.pop(chat_id, None)

    keyboard = [
        [InlineKeyboardButton("🤖  Agents", callback_data="cat:agents")],
        [InlineKeyboardButton("⚡  Workflows", callback_data="cat:workflows")],
    ]
    await update.message.reply_text(
        "👋 *Welcome to Yuno Agent Platform*\n\nWhat would you like to run?",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


# ─── Inline keyboard callback ─────────────────────────────────────────────────

async def handle_selection(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()

    data = query.data
    chat_id = query.message.chat_id

    # Step 2: user chose a category — fetch and list items
    if data.startswith("cat:"):
        category = data[4:]  # "agents" or "workflows"
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{API_BASE}/api/{category}")
        items = r.json() if r.status_code == 200 else []

        if not items:
            await query.edit_message_text(
                f"No {category} found.\nCreate some at http://localhost:3000 first."
            )
            return

        prefix = "a" if category == "agents" else "w"
        icon   = "🤖" if category == "agents" else "⚡"
        label  = "Agents" if category == "agents" else "Workflows"

        keyboard = [
            [InlineKeyboardButton(f"{icon} {item['name']}", callback_data=f"{prefix}:{item['id']}")]
            for item in items
        ]
        keyboard.append([InlineKeyboardButton("« Back", callback_data="back:start")])

        await query.edit_message_text(
            f"*{label}* — choose one to connect:",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )
        return

    # Back button — re-show the category picker
    if data == "back:start":
        keyboard = [
            [InlineKeyboardButton("🤖  Agents", callback_data="cat:agents")],
            [InlineKeyboardButton("⚡  Workflows", callback_data="cat:workflows")],
        ]
        await query.edit_message_text(
            "👋 *Welcome to Yuno Agent Platform*\n\nWhat would you like to run?",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )
        return

    # Step 3: user chose a specific agent or workflow
    if ":" not in data:
        return
    kind, item_id = data.split(":", 1)

    async with httpx.AsyncClient(timeout=10) as client:
        if kind == "a":
            r = await client.get(f"{API_BASE}/api/agents/{item_id}")
            if r.status_code != 200:
                await query.edit_message_text("Agent not found.")
                return
            item = r.json()
            sessions[chat_id] = {"type": "agent", "id": item_id, "name": item["name"], "history": []}
            await query.edit_message_text(
                f"✅ Connected to *{item['name']}*\n\n"
                f"_{item.get('description', '')}_\n\n"
                "Send me your question. Type /stop to end the session.",
                parse_mode="Markdown",
            )

        elif kind == "w":
            r = await client.get(f"{API_BASE}/api/workflows/{item_id}")
            if r.status_code != 200:
                await query.edit_message_text("Workflow not found.")
                return
            item = r.json()
            sessions[chat_id] = {"type": "workflow", "id": item_id, "name": item["name"], "history": []}
            await query.edit_message_text(
                f"✅ Running workflow *{item['name']}*\n\n"
                f"_{item.get('description', item.get('name', ''))}_\n\n"
                "Send me a task and I'll run the full pipeline. Type /stop to end.",
                parse_mode="Markdown",
            )


# ─── Reply delivery ───────────────────────────────────────────────────────────

# Telegram rejects any single message longer than 4096 chars; chunk below that.
TELEGRAM_MAX_CHARS = 4000


def _chunk(text: str, size: int = TELEGRAM_MAX_CHARS) -> list[str]:
    text = (text or "").strip() or "Workflow completed."
    return [text[i:i + size] for i in range(0, len(text), size)]


async def deliver(thinking_msg, text: str) -> None:
    """Replace the 'Thinking…' message with the reply, splitting long output.

    Telegram caps messages at 4096 chars, so a long answer would make a single
    edit_text raise and leave the user stuck on 'Thinking…'. Chunk and fall back
    to fresh messages so the reply always lands.
    """
    chunks = _chunk(text)
    try:
        await thinking_msg.edit_text(chunks[0])
    except Exception:
        await thinking_msg.reply_text(chunks[0])
    for chunk in chunks[1:]:
        await thinking_msg.reply_text(chunk)


# ─── Message handler ──────────────────────────────────────────────────────────

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = update.effective_chat.id
    user_text = update.message.text.strip()

    if chat_id not in sessions:
        await update.message.reply_text(
            "Use /start to choose an agent or workflow first."
        )
        return

    session = sessions[chat_id]
    thinking_msg = await update.message.reply_text("⏳ Thinking…")

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            if session["type"] == "agent":
                r = await client.post(
                    f"{API_BASE}/api/agents/{session['id']}/chat",
                    json={"message": user_text, "history": session["history"]},
                )
                if r.status_code == 200:
                    data = r.json()
                    response_text = data["response"]
                    session["history"] = data["history"]
                else:
                    response_text = "Something went wrong. Please try again."

            else:  # workflow
                r = await client.post(
                    f"{API_BASE}/api/workflows/{session['id']}/chat",
                    json={"message": user_text},
                )
                if r.status_code == 200:
                    response_text = r.json().get("response", "Workflow completed.")
                else:
                    response_text = "Workflow failed. Please try again."

    except Exception as e:
        response_text = f"Error: {e}"

    await deliver(thinking_msg, response_text)


# ─── /stop ────────────────────────────────────────────────────────────────────

async def cmd_stop(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = update.effective_chat.id
    session = sessions.pop(chat_id, None)
    if session:
        await update.message.reply_text(
            f"Session with *{session['name']}* ended.\nUse /start to begin a new one.",
            parse_mode="Markdown",
        )
    else:
        await update.message.reply_text("No active session. Use /start to begin.")


# ─── /help ───────────────────────────────────────────────────────────────────

async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text(
        "*Yuno Agent Platform*\n\n"
        "/start — choose an agent or workflow to run\n"
        "/stop  — end the current session\n"
        "/help  — show this message",
        parse_mode="Markdown",
    )


# ─── Entry point ─────────────────────────────────────────────────────────────

def main() -> None:
    if not BOT_TOKEN:
        raise ValueError("TELEGRAM_BOT_TOKEN not set in environment")

    app = Application.builder().token(BOT_TOKEN).build()

    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("stop", cmd_stop))
    app.add_handler(CommandHandler("help", cmd_help))
    app.add_handler(CallbackQueryHandler(handle_selection))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    username = os.environ.get("TELEGRAM_BOT_USERNAME", "yuno3_bot")
    print(f"@{username} is running — polling for updates…")
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
