from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Depends, HTTPException, Request, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import APIKeyHeader
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, Any, Dict, List
from collections import deque, defaultdict
from asyncio import Queue
from datetime import datetime
from urllib.parse import urlparse
import ipaddress
import asyncio
import secrets
import uuid
import json
import os
import httpx

from database import init_db, get_db, SessionLocal, AgentModel, WorkflowModel, WorkflowRunModel, RunEventModel, UserCredentialModel
from agent_factory import generate_agent_config
from agent_runner import run_agent_task, run_conversation_turn
import auth
from auth import require_session, require_session_or_service

# ─── In-memory run event bus ─────────────────────────────────────────────────
# Holds events for in-flight runs; flushed to DB on completion.
_run_events_cache: Dict[str, List[dict]] = defaultdict(list)
_run_subscribers: Dict[str, List[Queue]] = defaultdict(list)


def _publish_run_event(run_id: str, event: dict) -> None:
    ts_event = {**event, "ts": datetime.utcnow().isoformat()}
    _run_events_cache[run_id].append(ts_event)
    for q in list(_run_subscribers.get(run_id, [])):
        q.put_nowait(ts_event)


def _subscribe_run(run_id: str) -> Queue:
    q: Queue = Queue()
    _run_subscribers[run_id].append(q)
    return q


def _unsubscribe_run(run_id: str, q: Queue) -> None:
    subs = _run_subscribers.get(run_id, [])
    if q in subs:
        subs.remove(q)

app = FastAPI(title="Agent Platform")

# ─── CORS — read from env so Netlify/Vercel origins work ─────────────────────
# ALLOWED_ORIGINS: comma-separated exact origins.
# ALLOWED_ORIGIN_REGEX: optional regex matching whole origins (covers all Vercel/
#   Netlify deploys incl. previews without listing each one). Defaults to allowing
#   any *.vercel.app and *.netlify.app subdomain plus localhost.
_origins_raw = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000")
_allowed_origins = [o.strip() for o in _origins_raw.split(",") if o.strip()]
_origin_regex = os.environ.get(
    "ALLOWED_ORIGIN_REGEX",
    r"https://([a-z0-9-]+\.)*(vercel|netlify)\.app|http://localhost:3000",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_origin_regex=_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*", "X-API-Key"],
)

# ─── API key auth — protects credential and webhook endpoints ─────────────────
_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def require_api_key(key: str = Security(_api_key_header)):
    """Require X-API-Key header on sensitive endpoints.
    If API_SECRET_KEY env var is not set, auth is skipped (local dev)."""
    secret = os.environ.get("API_SECRET_KEY", "")
    if secret and not secrets.compare_digest(key or "", secret):
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


# ─── SSRF guard — validates user-supplied callback URLs ──────────────────────
def _is_safe_url(url: str) -> bool:
    """Return True only for https:// URLs pointing at public hosts."""
    try:
        p = urlparse(url)
        if p.scheme != "https":
            return False
        host = p.hostname or ""
        try:
            addr = ipaddress.ip_address(host)
            if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved:
                return False
        except ValueError:
            pass  # hostname, not a bare IP — allow
        blocked_hosts = ("localhost", "metadata.google.internal", "169.254.169.254")
        if any(b in host for b in blocked_hosts):
            return False
        return bool(host)
    except Exception:
        return False


@app.on_event("startup")
def startup():
    init_db()
    # Inject user-defined credentials from DB into os.environ
    db = SessionLocal()
    try:
        for cred in db.query(UserCredentialModel).all():
            if cred.value:
                os.environ[cred.key] = cred.value
    finally:
        db.close()


@app.get("/")
def root():
    """Health/landing route so the base URL returns a clear status instead of 404."""
    return {"status": "ok", "service": "Agent Platform API", "docs": "/docs"}


# ─── Auth (passwordless: biometric passkey + authenticator TOTP) ──────────────

class TotpCodeRequest(BaseModel):
    code: str


class PasskeyCompleteRequest(BaseModel):
    state: str
    credential: dict
    nickname: Optional[str] = None


def _guard_setup(db: Session):
    """Setup routes are usable only until the app is configured (bootstrap once)."""
    if auth.is_configured(db):
        raise HTTPException(403, "Already configured. Use the login endpoints.")


@app.get("/auth/status")
def auth_status(db: Session = Depends(get_db)):
    return auth.auth_status(db)


@app.get("/auth/me")
def auth_me(_: bool = Depends(require_session)):
    return {"ok": True}


@app.post("/auth/logout")
def auth_logout(request: Request, db: Session = Depends(get_db), _: bool = Depends(require_session)):
    header = request.headers.get("Authorization", "")
    token = header[7:] if header.lower().startswith("bearer ") else ""
    auth.delete_session(db, token)
    return {"ok": True}


# Setup (bootstrap) — disabled once configured
@app.post("/auth/setup/totp/begin")
def setup_totp_begin(db: Session = Depends(get_db)):
    _guard_setup(db)
    return auth.begin_totp_setup(db)


@app.post("/auth/setup/totp/verify")
def setup_totp_verify(body: TotpCodeRequest, db: Session = Depends(get_db)):
    _guard_setup(db)
    return {"token": auth.verify_totp_setup(db, body.code)}


@app.post("/auth/setup/passkey/begin")
def setup_passkey_begin(request: Request, db: Session = Depends(get_db)):
    _guard_setup(db)
    return auth.begin_passkey_registration(db, request)


@app.post("/auth/setup/passkey/complete")
def setup_passkey_complete(body: PasskeyCompleteRequest, db: Session = Depends(get_db)):
    _guard_setup(db)
    return {"token": auth.complete_passkey_registration(db, body.state, body.credential, body.nickname or "Passkey")}


# Login — only once configured
@app.post("/auth/login/passkey/begin")
def login_passkey_begin(request: Request, db: Session = Depends(get_db)):
    return auth.begin_passkey_login(db, request)


@app.post("/auth/login/passkey/complete")
def login_passkey_complete(body: PasskeyCompleteRequest, db: Session = Depends(get_db)):
    return {"token": auth.complete_passkey_login(db, body.state, body.credential)}


@app.post("/auth/login/totp")
def login_totp(body: TotpCodeRequest, db: Session = Depends(get_db)):
    return {"token": auth.login_totp(db, body.code)}


# Manage additional passkeys (logged-in)
@app.get("/auth/passkeys")
def list_passkeys(db: Session = Depends(get_db), _: bool = Depends(require_session)):
    return auth.list_passkeys(db)


@app.post("/auth/passkey/begin")
def add_passkey_begin(request: Request, db: Session = Depends(get_db), _: bool = Depends(require_session)):
    return auth.begin_passkey_registration(db, request)


@app.post("/auth/passkey/complete")
def add_passkey_complete(body: PasskeyCompleteRequest, db: Session = Depends(get_db), _: bool = Depends(require_session)):
    auth.complete_passkey_registration(db, body.state, body.credential, body.nickname or "Passkey")
    return {"ok": True}


@app.delete("/auth/passkeys/{passkey_id}")
def remove_passkey(passkey_id: str, db: Session = Depends(get_db), _: bool = Depends(require_session)):
    auth.delete_passkey(db, passkey_id)
    return {"ok": True}


# ─── Schemas ─────────────────────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    description: str


class CreateAgentRequest(BaseModel):
    name: str
    description: str
    system_prompt: str
    model: str
    tools: list[str]
    reasoning: Optional[str] = None


class PatchAgentRequest(BaseModel):
    tools: Optional[list[str]] = None
    system_prompt: Optional[str] = None
    model: Optional[str] = None


class RunTaskRequest(BaseModel):
    task: str


class WorkflowCreateRequest(BaseModel):
    name: str = "Untitled Workflow"
    nodes: list[Any] = []
    edges: list[Any] = []


class WorkflowPatchRequest(BaseModel):
    name: Optional[str] = None
    nodes: Optional[list[Any]] = None
    edges: Optional[list[Any]] = None


class AgentChatRequest(BaseModel):
    message: str
    history: list[dict] = []


class WorkflowChatRequest(BaseModel):
    message: str
    chat_id: Optional[str] = None


# ─── Routes ──────────────────────────────────────────────────────────────────

@app.post("/api/agents/generate", dependencies=[Depends(require_session)])
async def generate_config(body: GenerateRequest):
    """
    Step 1: User provides a description → Claude returns a rich agent config JSON.
    The config is NOT saved yet — frontend shows it for review first.
    """
    if not body.description.strip():
        raise HTTPException(400, "Description cannot be empty")
    try:
        config = await generate_agent_config(body.description)
    except RuntimeError as e:
        # OPENAI_API_KEY missing — the server isn't configured to talk to OpenAI.
        raise HTTPException(503, f"{e}. Set OPENAI_API_KEY in the server environment.")
    except Exception as e:
        # OpenAI API errors (invalid key, model access, rate limit) — surface a readable message.
        raise HTTPException(502, f"Agent generation failed: {e}")
    return config


@app.post("/api/agents", status_code=201, dependencies=[Depends(require_session)])
def create_agent(body: CreateAgentRequest, db: Session = Depends(get_db)):
    """Step 2: User confirms the config → agent is saved to DB."""
    existing = db.query(AgentModel).filter(AgentModel.name == body.name).first()
    if existing:
        raise HTTPException(409, f"Agent named '{body.name}' already exists")

    agent = AgentModel(
        id=str(uuid.uuid4()),
        name=body.name,
        description=body.description,
        system_prompt=body.system_prompt,
        model=body.model,
        tools=body.tools,
        reasoning=body.reasoning,
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)
    return _agent_to_dict(agent)


@app.get("/api/agents", dependencies=[Depends(require_session_or_service)])
def list_agents(db: Session = Depends(get_db)):
    agents = db.query(AgentModel).order_by(AgentModel.created_at.desc()).all()
    return [_agent_to_dict(a) for a in agents]


@app.get("/api/agents/{agent_id}", dependencies=[Depends(require_session_or_service)])
def get_agent(agent_id: str, db: Session = Depends(get_db)):
    agent = _get_or_404(db, agent_id)
    return _agent_to_dict(agent)


@app.patch("/api/agents/{agent_id}", dependencies=[Depends(require_session)])
def patch_agent(agent_id: str, body: PatchAgentRequest, db: Session = Depends(get_db)):
    agent = _get_or_404(db, agent_id)
    if body.tools is not None:
        agent.tools = body.tools
    if body.system_prompt is not None:
        agent.system_prompt = body.system_prompt
    if body.model is not None:
        agent.model = body.model
    db.commit()
    db.refresh(agent)
    return _agent_to_dict(agent)


@app.delete("/api/agents/{agent_id}", dependencies=[Depends(require_session)])
def delete_agent(agent_id: str, db: Session = Depends(get_db)):
    agent = _get_or_404(db, agent_id)
    db.delete(agent)
    db.commit()
    return {"deleted": agent_id}


@app.post("/api/agents/{agent_id}/run", dependencies=[Depends(require_session)])
async def run_agent(agent_id: str, body: RunTaskRequest, db: Session = Depends(get_db)):
    """
    Step 3: User gives the agent a task → streams back execution events via SSE.
    """
    agent = _get_or_404(db, agent_id)

    return StreamingResponse(
        run_agent_task(
            system_prompt=agent.system_prompt,
            model=agent.model,
            tool_ids=agent.tools,
            task=body.task,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/agents/{agent_id}/chat", dependencies=[Depends(require_session_or_service)])
def chat_agent(agent_id: str, body: AgentChatRequest, db: Session = Depends(get_db)):
    """Conversational turn for Telegram bot — maintains history across calls."""
    agent = _get_or_404(db, agent_id)
    response, updated_history = run_conversation_turn(
        system_prompt=agent.system_prompt,
        model=agent.model,
        tool_ids=agent.tools or [],
        history=body.history,
        user_message=body.message,
    )
    return {"response": response, "history": updated_history}


@app.post("/api/workflows/{wf_id}/chat", dependencies=[Depends(require_session_or_service)])
async def chat_workflow(wf_id: str, body: WorkflowChatRequest, db: Session = Depends(get_db)):
    """Single-turn workflow execution for Telegram bot — creates a tracked run and returns final answer."""
    wf = _get_wf_or_404(db, wf_id)
    agents = {a.id: a for a in db.query(AgentModel).all()}
    run_id = str(uuid.uuid4())

    final_answer = ""
    delivered = False
    async for raw in _run_workflow_with_tracking(
        wf.nodes, wf.edges, body.message, agents,
        run_id=run_id, workflow_id=wf_id, workflow_name=wf.name,
        trigger_source="telegram", from_bot=True, bot_chat_id=body.chat_id,
    ):
        if not raw.startswith("data: "):
            continue
        try:
            evt = json.loads(raw[6:].strip())
        except json.JSONDecodeError:
            continue
        if evt.get("type") == "text":
            final_answer = evt.get("message", final_answer)
        if evt.get("delivered"):
            delivered = True
        if evt.get("type") == "done":
            if not final_answer:
                final_answer = evt.get("message", "")
            break

    # `delivered` is True when a Send-to-Telegram node already pushed the reply
    # to the chat; the bot then skips its own re-delivery to avoid double messages.
    return {"response": final_answer or "Workflow completed.", "run_id": run_id, "delivered": delivered}


@app.get("/api/tools", dependencies=[Depends(require_session)])
def list_tools():
    """Return all available tools the AI can assign to agents."""
    from tools import TOOL_CATALOG
    return list(TOOL_CATALOG.values())


# ─── Credentials endpoints ────────────────────────────────────────────────────

ENV_PATH = os.path.join(os.path.dirname(__file__), ".env")

CREDENTIAL_DEFS = [
    {"key": "OPENAI_API_KEY",               "label": "OpenAI API Key",          "group": "AI Models",  "secret": True,  "required": True},
    {"key": "TELEGRAM_BOT_TOKEN",           "label": "Telegram Bot Token",      "group": "Telegram",   "secret": True,  "required": True},
    {"key": "TELEGRAM_BOT_USERNAME",        "label": "Bot Username",            "group": "Telegram",   "secret": False, "required": False},
    {"key": "TELEGRAM_APPROVAL_CHAT_ID",    "label": "Approval Chat ID",        "group": "Telegram",   "secret": False, "required": False},
    {"key": "YUNO_API_KEY",                 "label": "Yuno API Key",            "group": "Yuno API",   "secret": True,  "required": False},
    {"key": "YUNO_API_BASE_URL",            "label": "Yuno API Base URL",       "group": "Yuno API",   "secret": False, "required": False},
    {"key": "API_BASE_URL",                 "label": "Backend URL",             "group": "App",        "secret": False, "required": False},
]


def _read_env_file() -> dict[str, str]:
    """Parse .env file into a key→value dict."""
    result: dict[str, str] = {}
    if not os.path.exists(ENV_PATH):
        return result
    with open(ENV_PATH) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            result[k.strip()] = v.strip()
    return result


def _write_env_file(values: dict[str, str]) -> None:
    """Rewrite .env file preserving order; add missing keys at end."""
    lines: list[str] = []
    written: set[str] = set()

    if os.path.exists(ENV_PATH):
        with open(ENV_PATH) as f:
            for line in f:
                stripped = line.strip()
                if stripped and not stripped.startswith("#") and "=" in stripped:
                    k = stripped.split("=", 1)[0].strip()
                    if k in values:
                        lines.append(f"{k}={values[k]}\n")
                        written.add(k)
                        continue
                lines.append(line if line.endswith("\n") else line + "\n")

    for k, v in values.items():
        if k not in written:
            lines.append(f"{k}={v}\n")

    with open(ENV_PATH, "w") as f:
        f.writelines(lines)


def _mask(value: str) -> str:
    if len(value) <= 8:
        return "••••••••"
    return value[:4] + "••••" + value[-4:]


@app.get("/api/credentials", dependencies=[Depends(require_session)])
def get_credentials(db: Session = Depends(get_db)):
    env = _read_env_file()
    result = []
    # System credentials
    for d in CREDENTIAL_DEFS:
        # Prefer the live process env (Railway dashboard vars / loaded .env) over the
        # .env file, so platform credentials are recognized whether they're set in the
        # host environment or a file. This is what the OpenAI client actually reads.
        raw = os.environ.get(d["key"]) or env.get(d["key"], "")
        result.append({
            **d,
            "is_set": bool(raw),
            "masked_value": _mask(raw) if raw and d["secret"] else raw,
            "user_defined": False,
        })
    # User-defined credentials
    for uc in db.query(UserCredentialModel).order_by(UserCredentialModel.created_at).all():
        raw = uc.value or ""
        result.append({
            "key": uc.key,
            "label": uc.label,
            "group": uc.group,
            "secret": uc.secret,
            "required": False,
            "is_set": bool(raw),
            "masked_value": _mask(raw) if raw and uc.secret else raw,
            "user_defined": True,
        })
    return result


class CredentialUpdate(BaseModel):
    key: str
    value: str


@app.patch("/api/credentials", dependencies=[Depends(require_session)])
def update_credentials(updates: list[CredentialUpdate], db: Session = Depends(get_db)):
    system_keys = {d["key"] for d in CREDENTIAL_DEFS}
    user_keys = {uc.key for uc in db.query(UserCredentialModel).all()}
    allowed = system_keys | user_keys
    env = _read_env_file()
    updated = []
    for u in updates:
        if u.key in system_keys:
            env[u.key] = u.value
            os.environ[u.key] = u.value
            updated.append(u.key)
        elif u.key in user_keys:
            uc = db.query(UserCredentialModel).filter(UserCredentialModel.key == u.key).first()
            if uc:
                uc.value = u.value
                os.environ[u.key] = u.value
                updated.append(u.key)
    db.commit()
    _write_env_file(env)
    return {"updated": updated}


class CreateCustomCredentialRequest(BaseModel):
    label: str
    key: Optional[str] = None     # auto-generated from label if omitted
    value: str
    group: str = "Custom"
    secret: bool = True


@app.post("/api/credentials/custom", status_code=201, dependencies=[Depends(require_session)])
def create_custom_credential(body: CreateCustomCredentialRequest, db: Session = Depends(get_db)):
    key = body.key or body.label.upper().replace(" ", "_").replace("-", "_")
    # Ensure key doesn't clash with system credentials
    if any(d["key"] == key for d in CREDENTIAL_DEFS):
        raise HTTPException(409, f"Key '{key}' is a reserved system credential. Choose a different name.")
    existing = db.query(UserCredentialModel).filter(UserCredentialModel.key == key).first()
    if existing:
        raise HTTPException(409, f"Credential key '{key}' already exists.")
    uc = UserCredentialModel(
        key=key, label=body.label, group=body.group, secret=body.secret, value=body.value,
    )
    db.add(uc)
    db.commit()
    os.environ[key] = body.value  # hot-inject
    return {"key": key, "label": body.label, "group": body.group, "secret": body.secret, "is_set": True}


@app.delete("/api/credentials/custom/{key}", dependencies=[Depends(require_session)])
def delete_custom_credential(key: str, db: Session = Depends(get_db)):
    uc = db.query(UserCredentialModel).filter(UserCredentialModel.key == key).first()
    if not uc:
        raise HTTPException(404, "Custom credential not found.")
    db.delete(uc)
    db.commit()
    os.environ.pop(key, None)
    return {"deleted": key}


# ─── Workflow routes ──────────────────────────────────────────────────────────

@app.post("/api/workflows", status_code=201, dependencies=[Depends(require_session)])
def create_workflow(body: WorkflowCreateRequest, db: Session = Depends(get_db)):
    wf = WorkflowModel(
        id=str(uuid.uuid4()),
        name=body.name,
        nodes=body.nodes,
        edges=body.edges,
    )
    db.add(wf)
    db.commit()
    db.refresh(wf)
    return _wf_to_dict(wf)


@app.get("/api/workflows", dependencies=[Depends(require_session_or_service)])
def list_workflows(db: Session = Depends(get_db)):
    wfs = db.query(WorkflowModel).order_by(WorkflowModel.created_at.desc()).all()
    return [_wf_to_dict(w) for w in wfs]


@app.get("/api/workflows/{wf_id}", dependencies=[Depends(require_session_or_service)])
def get_workflow(wf_id: str, db: Session = Depends(get_db)):
    return _wf_to_dict(_get_wf_or_404(db, wf_id))


@app.patch("/api/workflows/{wf_id}", dependencies=[Depends(require_session)])
def patch_workflow(wf_id: str, body: WorkflowPatchRequest, db: Session = Depends(get_db)):
    wf = _get_wf_or_404(db, wf_id)
    if body.name is not None:
        wf.name = body.name
    if body.nodes is not None:
        wf.nodes = body.nodes
    if body.edges is not None:
        wf.edges = body.edges
    db.commit()
    db.refresh(wf)
    return _wf_to_dict(wf)


@app.delete("/api/workflows/{wf_id}", dependencies=[Depends(require_session)])
def delete_workflow(wf_id: str, db: Session = Depends(get_db)):
    wf = _get_wf_or_404(db, wf_id)
    db.delete(wf)
    db.commit()
    return {"deleted": wf_id}


@app.post("/api/workflows/{wf_id}/run", dependencies=[Depends(require_session)])
async def run_workflow(wf_id: str, body: RunTaskRequest, db: Session = Depends(get_db)):
    wf = _get_wf_or_404(db, wf_id)
    agents = {a.id: a for a in db.query(AgentModel).all()}
    run_id = str(uuid.uuid4())
    return StreamingResponse(
        _run_workflow_with_tracking(
            wf.nodes, wf.edges, body.task, agents,
            run_id=run_id, workflow_id=wf_id, workflow_name=wf.name,
            trigger_source="app",
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "X-Run-Id": run_id},
    )


# ─── Webhook trigger endpoint ────────────────────────────────────────────────

@app.post("/api/webhooks/{wf_id}", dependencies=[Depends(require_api_key)])
async def webhook_trigger(wf_id: str, request: Request, db: Session = Depends(get_db)):
    """
    Inbound webhook: POST any JSON here to run the workflow.
    Expects { "task": "...", "callback_url": "..." } — both optional.
    If no "task" key, the entire body is stringified as the task.
    Returns { "result": "...", "workflow_id": "...", "status": "completed" }.
    Also POSTs the result to callback_url if supplied in the body.
    """
    try:
        body = await request.json()
    except Exception:
        body = {}

    task = body.get("task") or json.dumps(body) if body else "Run workflow"
    body_callback_url = str(body.get("callback_url", "")).strip()

    wf = _get_wf_or_404(db, wf_id)
    agents = {a.id: a for a in db.query(AgentModel).all()}

    final_result: dict = {"result": "", "workflow_id": wf_id, "status": "completed"}
    async for raw in _run_workflow_stream(wf.nodes, wf.edges, str(task), agents):
        if raw.startswith("data: "):
            try:
                evt = json.loads(raw[6:].strip())
                if evt.get("type") == "done":
                    final_result["result"] = evt.get("message", "")
            except json.JSONDecodeError:
                pass

    # POST to callback_url from request body (if separate from webhookResponseNode)
    if body_callback_url and _is_safe_url(body_callback_url):
        async with httpx.AsyncClient(timeout=10) as client:
            try:
                await client.post(body_callback_url, json=final_result)
            except Exception:
                pass

    return final_result


# ─── Run monitoring endpoints ─────────────────────────────────────────────────

@app.get("/api/runs", dependencies=[Depends(require_session)])
def list_runs(db: Session = Depends(get_db)):
    runs = db.query(WorkflowRunModel).order_by(WorkflowRunModel.created_at.desc()).limit(100).all()
    return [_run_to_dict(r) for r in runs]


@app.get("/api/runs/{run_id}", dependencies=[Depends(require_session)])
def get_run(run_id: str, db: Session = Depends(get_db)):
    run = db.query(WorkflowRunModel).filter(WorkflowRunModel.id == run_id).first()
    if not run:
        raise HTTPException(404, "Run not found")
    if run.status == "running" and run_id in _run_events_cache:
        events = [
            {
                "type": e.get("type"), "node_id": e.get("node_id"),
                "agent_name": e.get("agent_name"), "message": e.get("message", ""),
                "ts": e.get("ts"), "extra": {k: v for k, v in e.items()
                    if k not in ("type", "node_id", "agent_name", "message", "ts")},
            }
            for e in _run_events_cache[run_id] if e.get("type") not in ("__end__",)
        ]
    else:
        db_events = db.query(RunEventModel).filter(RunEventModel.run_id == run_id).order_by(RunEventModel.id).all()
        events = [_event_to_dict(e) for e in db_events]
    return {**_run_to_dict(run), "events": events}


@app.get("/api/runs/{run_id}/stream")
async def stream_run_events(run_id: str, token: str = "", db: Session = Depends(get_db)):
    """SSE stream for a run. Replays history then sends live events.
    Auth via ?token= query param because EventSource can't set headers."""
    if not auth.validate_token(db, token):
        raise HTTPException(401, "Authentication required.")
    run = db.query(WorkflowRunModel).filter(WorkflowRunModel.id == run_id).first()
    if not run:
        raise HTTPException(404, "Run not found")
    run_status = run.status

    async def generate():
        if run_status != "running":
            db2 = SessionLocal()
            try:
                evts = db2.query(RunEventModel).filter(RunEventModel.run_id == run_id).order_by(RunEventModel.id).all()
                for e in evts:
                    yield f"data: {json.dumps(_event_to_dict(e))}\n\n"
            finally:
                db2.close()
            yield f"data: {json.dumps({'type': 'done', 'status': run_status})}\n\n"
            return

        # Replay cached events from in-flight run
        for evt in list(_run_events_cache.get(run_id, [])):
            if evt.get("type") == "__end__":
                yield f"data: {json.dumps({'type': 'done'})}\n\n"
                return
            yield f"data: {json.dumps(evt)}\n\n"

        # Subscribe to future events
        q = _subscribe_run(run_id)
        try:
            while True:
                try:
                    evt = await asyncio.wait_for(q.get(), timeout=120)
                except asyncio.TimeoutError:
                    yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"
                    continue
                if evt.get("type") == "__end__":
                    yield f"data: {json.dumps({'type': 'done'})}\n\n"
                    break
                yield f"data: {json.dumps(evt)}\n\n"
        finally:
            _unsubscribe_run(run_id, q)

    return StreamingResponse(generate(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _run_to_dict(run: WorkflowRunModel) -> dict:
    return {
        "id": run.id,
        "workflow_id": run.workflow_id,
        "workflow_name": run.workflow_name,
        "status": run.status,
        "task": run.task,
        "pipeline": run.pipeline or [],
        "trigger_source": getattr(run, "trigger_source", "app") or "app",
        "created_at": run.created_at.isoformat() if run.created_at else None,
        "completed_at": run.completed_at.isoformat() if run.completed_at else None,
    }


def _event_to_dict(e: RunEventModel) -> dict:
    return {
        "type": e.type,
        "node_id": e.node_id,
        "agent_name": e.agent_name,
        "message": e.message,
        "ts": e.ts.isoformat() if e.ts else None,
        "extra": e.extra or {},
    }


def _get_or_404(db: Session, agent_id: str) -> AgentModel:
    agent = db.query(AgentModel).filter(AgentModel.id == agent_id).first()
    if not agent:
        raise HTTPException(404, "Agent not found")
    return agent


def _agent_to_dict(agent: AgentModel) -> dict:
    return {
        "id": agent.id,
        "name": agent.name,
        "description": agent.description,
        "system_prompt": agent.system_prompt,
        "model": agent.model,
        "tools": agent.tools,
        "reasoning": agent.reasoning,
        "created_at": agent.created_at.isoformat() if agent.created_at else None,
    }


def _get_wf_or_404(db: Session, wf_id: str) -> WorkflowModel:
    wf = db.query(WorkflowModel).filter(WorkflowModel.id == wf_id).first()
    if not wf:
        raise HTTPException(404, "Workflow not found")
    return wf


def _wf_to_dict(wf: WorkflowModel) -> dict:
    return {
        "id": wf.id,
        "name": wf.name,
        "nodes": wf.nodes,
        "edges": wf.edges,
        "created_at": wf.created_at.isoformat() if wf.created_at else None,
        "updated_at": wf.updated_at.isoformat() if wf.updated_at else None,
    }


def _topo_sort(nodes: list, edges: list) -> list[str]:
    in_degree = {n["id"]: 0 for n in nodes}
    children: dict[str, list[str]] = {n["id"]: [] for n in nodes}
    for edge in edges:
        src, tgt = edge.get("source"), edge.get("target")
        if src in in_degree and tgt in in_degree:
            in_degree[tgt] += 1
            children[src].append(tgt)
    queue = deque(nid for nid, deg in in_degree.items() if deg == 0)
    order: list[str] = []
    while queue:
        nid = queue.popleft()
        order.append(nid)
        for child in children[nid]:
            in_degree[child] -= 1
            if in_degree[child] == 0:
                queue.append(child)
    return order


async def _run_workflow_with_tracking(
    nodes: list, edges: list, task: str, agents: dict,
    run_id: str, workflow_id: str, workflow_name: str,
    trigger_source: str = "app", from_bot: bool = False,
    bot_chat_id: Optional[str] = None,
):
    """Wraps _run_workflow_stream: creates a DB run record and saves events on completion."""
    node_map = {n["id"]: n for n in nodes}
    order = _topo_sort(nodes, edges)
    pipeline = []
    for nid in order:
        node = node_map.get(nid)
        if not node:
            continue
        ntype = node.get("type", "")
        if ntype in ("triggerNode", "telegramTriggerNode", "webhookTriggerNode"):
            continue
        label = node.get("data", {}).get("label", ntype)
        agent_id = node.get("data", {}).get("agentId")
        if agent_id and agent_id in agents:
            label = agents[agent_id].name
        pipeline.append({"id": nid, "type": ntype, "label": label})

    db = SessionLocal()
    try:
        run = WorkflowRunModel(
            id=run_id,
            workflow_id=workflow_id,
            workflow_name=workflow_name,
            task=task[:500],
            status="running",
            pipeline=pipeline,
            trigger_source=trigger_source,
        )
        db.add(run)
        db.commit()
    except Exception:
        pass
    finally:
        db.close()

    status = "completed"
    try:
        async for chunk in _run_workflow_stream(nodes, edges, task, agents, run_id=run_id, from_bot=from_bot, bot_chat_id=bot_chat_id):
            yield chunk
    except Exception as exc:
        status = "failed"
        _publish_run_event(run_id, {"type": "error", "message": str(exc)})
        raise
    finally:
        _publish_run_event(run_id, {"type": "__end__"})
        db = SessionLocal()
        try:
            run = db.query(WorkflowRunModel).filter(WorkflowRunModel.id == run_id).first()
            if run:
                run.status = status
                run.completed_at = datetime.utcnow()
                for evt in _run_events_cache.get(run_id, []):
                    if evt.get("type") in ("__end__",):
                        continue
                    db.add(RunEventModel(
                        run_id=run_id,
                        type=evt.get("type", ""),
                        node_id=evt.get("node_id"),
                        agent_name=evt.get("agent_name"),
                        message=str(evt.get("message", ""))[:5000],
                        extra={k: v for k, v in evt.items()
                               if k not in ("type", "node_id", "agent_name", "message", "ts")},
                    ))
                db.commit()
        except Exception:
            pass
        finally:
            db.close()


# Telegram rejects any single message longer than 4096 chars.
_TELEGRAM_MAX_CHARS = 4000


async def _send_telegram(chat_id: str, text: str) -> bool:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    if not token or not chat_id:
        return False
    text = (text or "").strip()
    if not text:
        return False
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    # Split long agent output into chunks under Telegram's 4096-char limit.
    chunks = [text[i:i + _TELEGRAM_MAX_CHARS] for i in range(0, len(text), _TELEGRAM_MAX_CHARS)]
    async with httpx.AsyncClient(timeout=10) as client:
        for chunk in chunks:
            try:
                # Try Markdown first, but agent output often contains unbalanced
                # markup that Telegram's strict parser rejects (HTTP 400). Fall
                # back to plain text so delivery still succeeds.
                r = await client.post(url, json={"chat_id": chat_id, "text": chunk, "parse_mode": "Markdown"})
                if r.status_code != 200:
                    r = await client.post(url, json={"chat_id": chat_id, "text": chunk})
                if r.status_code != 200:
                    return False
            except Exception:
                return False
    return True


async def _run_workflow_stream(nodes: list, edges: list, task: str, agents: dict, run_id: Optional[str] = None, from_bot: bool = False, bot_chat_id: Optional[str] = None):
    def sse(type_: str, **kwargs) -> str:
        event = {"type": type_, **kwargs}
        if run_id:
            _publish_run_event(run_id, event)
        return f"data: {json.dumps(event)}\n\n"

    node_map = {n["id"]: n for n in nodes}
    order = _topo_sort(nodes, edges)

    yield sse("status", message="Workflow starting...")

    context = task
    last_output = task

    for node_id in order:
        node = node_map.get(node_id)
        if not node:
            continue

        node_type = node.get("type", "")

        # Skip trigger nodes silently
        if node_type in ("triggerNode", "telegramTriggerNode", "webhookTriggerNode"):
            continue

        # Webhook response node — POST result to callback URL
        if node_type == "webhookResponseNode":
            callback_url = str(node.get("data", {}).get("callbackUrl", "")).strip()
            cb_cred_key = str(node.get("data", {}).get("callbackUrlCredential", "")).strip()
            if cb_cred_key:
                callback_url = os.environ.get(cb_cred_key, callback_url)
            yield sse("node_start", node_id=node_id, message="Sending webhook response…")
            if callback_url and _is_safe_url(callback_url):
                payload = {"result": last_output, "workflow_id": "unknown", "status": "completed"}
                async with httpx.AsyncClient(timeout=10) as client:
                    try:
                        r = await client.post(callback_url, json=payload)
                        if r.status_code < 300:
                            yield sse("node_done", node_id=node_id, message=f"Response sent to {callback_url}")
                        else:
                            yield sse("error", node_id=node_id, message=f"Callback failed: HTTP {r.status_code}")
                    except Exception as ex:
                        yield sse("error", node_id=node_id, message=f"Callback error: {str(ex)}")
            elif callback_url:
                yield sse("error", node_id=node_id, message="Callback URL blocked: must be a public https:// URL")
            else:
                yield sse("node_done", node_id=node_id, message="No callback URL configured")
            continue

        # Send-to-Telegram action node
        if node_type == "sendTelegramNode":
            template = str(node.get("data", {}).get("messageTemplate", "")).strip()
            message = template if template else last_output
            last_output = message
            # Emit the message as a `text` event so callers that read the stream
            # (e.g. the bot's /chat endpoint) capture it as the final answer,
            # honoring any configured messageTemplate.
            yield sse("text", node_id=node_id, message=message)

            # Resolve the destination chat. When the bot triggered this run we
            # reply to the originating chat; otherwise use the node's config.
            chat_id = str(node.get("data", {}).get("chatId", "")).strip()
            cred_key = str(node.get("data", {}).get("chatIdCredential", "")).strip()
            if cred_key:
                chat_id = os.environ.get(cred_key, chat_id)
            if from_bot and bot_chat_id:
                chat_id = str(bot_chat_id)

            yield sse("node_start", node_id=node_id, message="Sending to Telegram...")
            ok = await _send_telegram(chat_id, message)
            if ok:
                # `delivered` tells the bot the reply already reached the chat,
                # so it won't re-deliver the same text and double-message the user.
                yield sse("node_done", node_id=node_id, message="Sent to Telegram", delivered=True)
            else:
                yield sse("error", node_id=node_id, message="Failed to send Telegram message (check chat ID and bot token)")
            continue

        if node_type != "agentNode":
            continue

        agent_id = node.get("data", {}).get("agentId")
        agent = agents.get(agent_id)
        if not agent:
            yield sse("error", node_id=node_id, message=f"Agent not found (id={agent_id})")
            continue

        yield sse("node_start", node_id=node_id, agent_name=agent.name,
                  message=f"Running {agent.name}…")

        final_text = ""

        async for raw in run_agent_task(
            system_prompt=agent.system_prompt,
            model=agent.model,
            tool_ids=agent.tools or [],
            task=context,
        ):
            if not raw.startswith("data: "):
                continue
            try:
                evt = json.loads(raw[6:].strip())
            except json.JSONDecodeError:
                continue
            evt_type = evt.get("type")
            if evt_type == "text":
                final_text = evt.get("message", "")
            # Forward tool events to monitoring bus only (not main SSE stream)
            if run_id and evt_type in ("tool_call", "tool_result"):
                _publish_run_event(run_id, {**evt, "node_id": node_id, "agent_name": agent.name})

        if final_text:
            last_output = final_text
            context = (
                f"Task: {task}\n\n"
                f"Previous agent ({agent.name}) output:\n{final_text}\n\n"
                f"Continue based on the above."
            )
            yield sse("text", node_id=node_id, agent_name=agent.name, message=final_text)

        yield sse("node_done", node_id=node_id, agent_name=agent.name,
                  message=f"{agent.name} completed")

    yield sse("done", message=last_output)
