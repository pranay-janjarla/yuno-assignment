from sqlalchemy import create_engine, Column, String, Text, Boolean, DateTime, Integer
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.dialects.sqlite import JSON
from datetime import datetime
import uuid

DATABASE_URL = "sqlite:///./agents.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class AgentModel(Base):
    __tablename__ = "agents"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False, unique=True)
    description = Column(Text, nullable=False)
    system_prompt = Column(Text, nullable=False)
    model = Column(String, nullable=False, default="gpt-4o-mini")
    tools = Column(JSON, nullable=False, default=list)
    reasoning = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class WorkflowModel(Base):
    __tablename__ = "workflows"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False, default="Untitled Workflow")
    nodes = Column(JSON, nullable=False, default=list)
    edges = Column(JSON, nullable=False, default=list)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class UserCredentialModel(Base):
    """User-defined credentials stored in DB, injected into os.environ at startup."""
    __tablename__ = "user_credentials"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    key = Column(String, nullable=False, unique=True)   # env var name, e.g. MY_API_KEY
    label = Column(String, nullable=False)              # display name
    group = Column(String, nullable=False, default="Custom")
    secret = Column(Boolean, nullable=False, default=True)
    value = Column(Text, nullable=False, default="")
    created_at = Column(DateTime, default=datetime.utcnow)


class WorkflowRunModel(Base):
    __tablename__ = "workflow_runs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    workflow_id = Column(String, nullable=True)
    workflow_name = Column(String, default="")
    status = Column(String, default="running")  # running | completed | failed
    task = Column(Text, default="")
    pipeline = Column(JSON, nullable=False, default=list)  # [{id, type, label}]
    trigger_source = Column(String, default="app")  # app | telegram | webhook
    created_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)


class RunEventModel(Base):
    __tablename__ = "run_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    run_id = Column(String, nullable=False)
    type = Column(String, nullable=False)
    node_id = Column(String, nullable=True)
    agent_name = Column(String, nullable=True)
    message = Column(Text, default="")
    extra = Column(JSON, nullable=False, default=dict)  # tool name, inputs, etc.
    ts = Column(DateTime, default=datetime.utcnow)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    Base.metadata.create_all(bind=engine)
    _migrate_schema()
    _seed_payments_data()


def _migrate_schema():
    """Add columns introduced after initial schema creation (SQLite ALTER TABLE)."""
    import sqlite3 as _sqlite3
    conn = _sqlite3.connect("agents.db")
    c = conn.cursor()
    c.execute("PRAGMA table_info(workflow_runs)")
    existing_cols = {row[1] for row in c.fetchall()}
    if "trigger_source" not in existing_cols:
        c.execute("ALTER TABLE workflow_runs ADD COLUMN trigger_source TEXT DEFAULT 'app'")
    conn.commit()
    conn.close()


def _seed_payments_data():
    """Create a sample payments SQLite DB for the database_query tool."""
    import sqlite3, os
    if os.path.exists("payments_data.db"):
        return
    conn = sqlite3.connect("payments_data.db")
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS transactions (
            id TEXT PRIMARY KEY,
            connector_id TEXT,
            amount REAL,
            currency TEXT,
            status TEXT,
            psp_response_code TEXT,
            created_at TEXT
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS chargebacks (
            id TEXT PRIMARY KEY,
            transaction_id TEXT,
            amount REAL,
            reason TEXT,
            status TEXT,
            created_at TEXT
        )
    """)
    sample_txns = [
        ("txn_001", "stripe_us", 149.99, "USD", "approved", "00", "2026-05-27 10:00:00"),
        ("txn_002", "stripe_us", 89.00, "USD", "declined", "51", "2026-05-27 10:05:00"),
        ("txn_003", "adyen_eu", 230.50, "EUR", "approved", "00", "2026-05-27 10:10:00"),
        ("txn_004", "adyen_eu", 55.00, "EUR", "declined", "05", "2026-05-27 10:15:00"),
        ("txn_005", "paypal_global", 399.99, "USD", "approved", "00", "2026-05-27 10:20:00"),
        ("txn_006", "stripe_us", 120.00, "USD", "approved", "00", "2026-05-27 11:00:00"),
        ("txn_007", "adyen_eu", 75.00, "EUR", "approved", "00", "2026-05-27 11:30:00"),
        ("txn_008", "paypal_global", 200.00, "USD", "declined", "14", "2026-05-27 12:00:00"),
    ]
    c.executemany("INSERT OR IGNORE INTO transactions VALUES (?,?,?,?,?,?,?)", sample_txns)
    sample_cbs = [
        ("cb_001", "txn_001", 149.99, "Item not received", "open", "2026-05-26 09:00:00"),
        ("cb_002", "txn_005", 399.99, "Unauthorized transaction", "open", "2026-05-25 14:00:00"),
        ("cb_003", "txn_006", 120.00, "Item not as described", "resolved", "2026-05-20 11:00:00"),
    ]
    c.executemany("INSERT OR IGNORE INTO chargebacks VALUES (?,?,?,?,?,?)", sample_cbs)
    conn.commit()
    conn.close()
