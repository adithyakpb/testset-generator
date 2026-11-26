"""Database setup: SQLAlchemy engine/session + models. SQLite by default,
DATABASE_URL env swaps to Postgres later (pgvector skipped; embeddings as JSON)."""
import os

from sqlalchemy import JSON, Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text, create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy import event

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./data/testset.db")
os.makedirs("data", exist_ok=True)

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)

if DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def id(prefix: str) -> str:
    import uuid
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


class Project(Base):
    __tablename__ = "projects"
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    settings = Column(JSON, default=dict)
    created_at = Column(DateTime, server_default=text("CURRENT_TIMESTAMP"))


class SeedRecord(Base):
    __tablename__ = "seed_records"
    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    text = Column(Text, nullable=False)          # raw on ingest; overwritten by anonymized view
    anon_text = Column(Text, nullable=True)      # anonymized view
    pii_spans = Column(JSON, default=list)
    role = Column(String, nullable=True)
    turn_index = Column(Integer, nullable=True)
    session_id = Column(String, nullable=True)
    meta = Column(JSON, default=dict)
    content_hash = Column(String, index=True)


class SurrogateMap(Base):
    __tablename__ = "surrogate_maps"
    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    mapping = Column(JSON, default=dict)   # real entity -> surrogate


class LexiconTerm(Base):
    __tablename__ = "lexicon_terms"
    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    term = Column(String, nullable=False)
    freq = Column(Integer, default=0)
    variants = Column(JSON, default=list)
    typo_forms = Column(JSON, default=list)


class IntentCluster(Base):
    __tablename__ = "intent_clusters"
    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    label = Column(String, nullable=False)
    size = Column(Integer, default=0)
    top_terms = Column(JSON, default=list)
    exemplar_ids = Column(JSON, default=list)


class RegisterProfile(Base):
    __tablename__ = "register_profile"
    project_id = Column(String, ForeignKey("projects.id"), primary_key=True)
    stats = Column(JSON, default=dict)  # {language_pairs, cmi_index, default_cmd}


class ResponseSpec(Base):
    __tablename__ = "response_specs"
    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    name = Column(String, nullable=False)
    version = Column(Integer, default=1)
    doc = Column(JSON, default=dict)
    is_active = Column(Boolean, default=True)


class Job(Base):
    __tablename__ = "jobs"
    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    type = Column(String, nullable=False)     # anonymize | analyze | generate
    config = Column(JSON, default=dict)
    seed = Column(Integer, nullable=True)
    status = Column(String, default="queued")  # queued|running|succeeded|failed|partial
    progress_done = Column(Integer, default=0)
    progress_total = Column(Integer, default=0)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=text("CURRENT_TIMESTAMP"))


class TestCase(Base):
    __tablename__ = "test_cases"
    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    job_id = Column(String, ForeignKey("jobs.id"), nullable=True)
    kind = Column(String, default="single_turn")
    intent_cluster_id = Column(String, nullable=True)
    persona = Column(JSON, default=dict)
    cmd = Column(Float, default=0.0)
    turns = Column(JSON, default=list)            # [{role, text}]
    expected = Column(JSON, default=dict)         # {response, assertions, spec_version}
    transform_trace = Column(JSON, default=list)
    review_state = Column(String, default="draft")  # draft|approved|rejected|human_revised
    provenance = Column(JSON, default=dict)


class Testset(Base):
    __tablename__ = "testsets"
    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text, default="")
    case_ids = Column(JSON, default=list)   # thin slice: list of case ids instead of versions/join table


def init_db() -> None:
    Base.metadata.create_all(engine)


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
