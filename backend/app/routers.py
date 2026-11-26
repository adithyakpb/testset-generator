"""API surface per design/04 (subset): projects, seeds, anonymize, lexicon,
intents, response-specs, generation-jobs, test-cases (+review), testsets,
exports (jsonl/csv), jobs/{id}."""
import csv
import io
import json

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .core.ingest import parse_upload
from .core.spec_compiler import validate_spec
from .db import (IntentCluster, Job, LexiconTerm, Project, RegisterProfile, ResponseSpec,
                 SeedRecord, TestCase, Testset, get_db, id as new_id)

router = APIRouter(prefix="/v1")


def _job(db: Session, jtype: str, pid: str, config: dict, seed: int | None) -> Job:
    job = Job(id=new_id("job"), project_id=pid, type=jtype, config=config, seed=seed, status="queued")
    db.add(job)
    db.commit()
    return job


# ---- projects ----
class ProjectIn(BaseModel):
    name: str
    settings: dict = {}


@router.get("/projects")
def list_projects(db: Session = Depends(get_db)):
    return [{"id": p.id, "name": p.name, "settings": p.settings} for p in db.scalars(select(Project))]


@router.post("/projects", status_code=201)
def create_project(body: ProjectIn, db: Session = Depends(get_db)):
    p = Project(id=new_id("proj"), name=body.name, settings=body.settings)
    db.add(p)
    db.commit()
    return {"id": p.id, "name": p.name}


@router.get("/projects/{pid}")
def get_project(pid: str, db: Session = Depends(get_db)):
    p = db.get(Project, pid)
    if not p:
        raise HTTPException(404)
    return {"id": p.id, "name": p.name, "settings": p.settings}


# ---- seeds ----
@router.get("/projects/{pid}/seeds")
def list_seeds(pid: str, db: Session = Depends(get_db)):
    rows = db.scalars(select(SeedRecord).where(SeedRecord.project_id == pid)).all()
    return [{"id": s.id, "text": s.text, "anon_text": s.anon_text, "pii_spans": s.pii_spans} for s in rows]


@router.post("/projects/{pid}/seeds", status_code=201)
async def upload_seeds(pid: str, file: UploadFile, db: Session = Depends(get_db)):
    if not db.get(Project, pid):
        raise HTTPException(404, "project not found")
    data = await file.read()
    records, rejects = parse_upload(file.filename or "upload.txt", data)
    out = []
    for r in records:
        s = SeedRecord(id=new_id("seed"), project_id=pid, **r)
        db.add(s)
        out.append(s.id)
    db.commit()
    return {"ingested": len(out), "rejected": len(rejects), "seed_ids": out, "rejects": rejects}


@router.post("/projects/{pid}/seeds/anonymize")
def anonymize_seeds(pid: str, db: Session = Depends(get_db)):
    job = _job(db, "anonymize", pid, {}, None)
    return {"id": job.id, "status": job.status}


# ---- lexicon / register / intents ----
@router.get("/projects/{pid}/lexicon")
def get_lexicon(pid: str, db: Session = Depends(get_db)):
    return [{"id": t.id, "term": t.term, "freq": t.freq, "variants": t.variants, "typo_forms": t.typo_forms}
            for t in db.scalars(select(LexiconTerm).where(LexiconTerm.project_id == pid))]


@router.post("/projects/{pid}/lexicon")
def extract_lexicon(pid: str, db: Session = Depends(get_db)):
    job = _job(db, "analyze", pid, {}, None)
    return {"id": job.id, "status": job.status}


@router.get("/projects/{pid}/intents")
def get_intents(pid: str, db: Session = Depends(get_db)):
    return [{"id": c.id, "label": c.label, "size": c.size, "top_terms": c.top_terms, "exemplar_ids": c.exemplar_ids}
            for c in db.scalars(select(IntentCluster).where(IntentCluster.project_id == pid))]


@router.get("/projects/{pid}/register")
def get_register(pid: str, db: Session = Depends(get_db)):
    rp = db.get(RegisterProfile, pid)
    return rp.stats if rp else {}


# ---- response specs ----
class SpecIn(BaseModel):
    name: str = "default"
    doc: dict


@router.get("/projects/{pid}/response-specs")
def list_specs(pid: str, db: Session = Depends(get_db)):
    return [{"id": s.id, "name": s.name, "version": s.version, "is_active": s.is_active, "doc": s.doc}
            for s in db.scalars(select(ResponseSpec).where(ResponseSpec.project_id == pid))]


@router.post("/projects/{pid}/response-specs", status_code=201)
def create_spec(pid: str, body: SpecIn, db: Session = Depends(get_db)):
    errors, warnings = validate_spec(body.doc)
    if errors:
        raise HTTPException(422, detail={"errors": errors, "warnings": warnings})
    last = db.scalar(select(ResponseSpec).where(ResponseSpec.project_id == pid).order_by(ResponseSpec.version.desc()))  # type: ignore
    if last:  # versions on save: deactivate old
        last.is_active = False
    s = ResponseSpec(id=new_id("spec"), project_id=pid, name=body.name,
                     version=(last.version + 1 if last else 1), doc=body.doc, is_active=True)
    db.add(s)
    db.commit()
    return {"id": s.id, "version": s.version, "warnings": warnings}


# ---- generation jobs ----
class GenJobIn(BaseModel):
    mode: str = "single_turn"
    count: int = 5
    messiness: str = "moderate"
    cmd: float | None = None
    register_name: str | None = Field(default=None, alias="register")
    intent_ids: list[str] | None = None
    use_llm: bool = True
    seed: int = 42


@router.post("/projects/{pid}/generation-jobs", status_code=202)
def create_generation_job(pid: str, body: GenJobIn, db: Session = Depends(get_db)):
    cfg = {"mode": body.mode, "count": body.count, "messiness": body.messiness, "cmd": body.cmd,
           "register": body.register_name, "intent_ids": body.intent_ids, "use_llm": body.use_llm}
    job = _job(db, "generate", pid, cfg, body.seed)
    return {"id": job.id, "status": job.status}


@router.get("/jobs/{job_id}")
def job_status(job_id: str, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404)
    return {"id": job.id, "type": job.type, "status": job.status,
            "progress": {"done": job.progress_done, "total": job.progress_total}, "error": job.error}


# ---- test cases ----
@router.get("/projects/{pid}/test-cases")
def list_cases(pid: str, review_state: str | None = None, db: Session = Depends(get_db)):
    q = select(TestCase).where(TestCase.project_id == pid)
    if review_state:
        q = q.where(TestCase.review_state == review_state)
    labels = {c.id: c.label for c in db.scalars(select(IntentCluster).where(IntentCluster.project_id == pid))}
    return [_case_out(c, labels.get(c.intent_cluster_id)) for c in db.scalars(q)]


def _case_out(c: TestCase, intent_label: str | None = None) -> dict:
    return {"id": c.id, "kind": c.kind, "intent_cluster_id": c.intent_cluster_id, "intent": intent_label,
            "persona": c.persona, "cmd": c.cmd, "turns": c.turns, "expected": c.expected,
            "transform_trace": c.transform_trace, "review_state": c.review_state, "provenance": c.provenance}


@router.get("/projects/{pid}/test-cases/{cid}")
def get_case(pid: str, cid: str, db: Session = Depends(get_db)):
    c = db.get(TestCase, cid)
    if not c or c.project_id != pid:
        raise HTTPException(404)
    label = None
    if c.intent_cluster_id:
        cluster = db.get(IntentCluster, c.intent_cluster_id)
        label = cluster.label if cluster else None
    return _case_out(c, label)


class ReviewIn(BaseModel):
    decision: str  # approve | reject | edit
    edits: dict | None = None
    reason: str | None = None


@router.post("/projects/{pid}/test-cases/{cid}/review")
def review_case(pid: str, cid: str, body: ReviewIn, db: Session = Depends(get_db)):
    c = db.get(TestCase, cid)
    if not c or c.project_id != pid:
        raise HTTPException(404)
    if body.decision == "approve":
        c.review_state = "approved"
    elif body.decision == "reject":
        c.review_state = "rejected"
    elif body.decision == "edit":
        c.review_state = "human_revised"
        if body.edits:
            if "expected_response" in body.edits:
                c.expected = {**c.expected, "response": body.edits["expected_response"]}
            if "user_turns" in body.edits:
                for u in body.edits["user_turns"]:
                    if 0 <= int(u.get("turn", 1)) - 1 < len(c.turns):
                        c.turns[int(u["turn"]) - 1]["text"] = u["text"]
    else:
        raise HTTPException(422, "decision must be approve|reject|edit")
    c.provenance = {**c.provenance, "review_reason": body.reason}
    db.commit()
    return _case_out(c)


# ---- testsets + exports ----
class TestsetIn(BaseModel):
    name: str
    description: str = ""
    case_ids: list[str] = []


@router.post("/projects/{pid}/testsets", status_code=201)
def create_testset(pid: str, body: TestsetIn, db: Session = Depends(get_db)):
    t = Testset(id=new_id("ts"), project_id=pid, name=body.name, description=body.description, case_ids=body.case_ids)
    db.add(t)
    db.commit()
    return {"id": t.id, "name": t.name, "case_count": len(t.case_ids)}


@router.get("/projects/{pid}/testsets")
def list_testsets(pid: str, db: Session = Depends(get_db)):
    return [{"id": t.id, "name": t.name, "description": t.description, "case_ids": t.case_ids}
            for t in db.scalars(select(Testset).where(Testset.project_id == pid))]


@router.post("/projects/{pid}/testsets/{tid}/exports")
def export_testset(pid: str, tid: str, format: str = "jsonl", db: Session = Depends(get_db)):
    t = db.get(Testset, tid)
    if not t or t.project_id != pid:
        raise HTTPException(404)
    cases = [db.get(TestCase, cid) for cid in t.case_ids]
    cases = [c for c in cases if c]
    if format == "jsonl":
        lines = [json.dumps({**_case_out(c), "project_id": c.project_id}, default=str) for c in cases]
        return {"filename": f"{t.name}.jsonl", "content": "\n".join(lines), "media_type": "application/jsonl"}
    elif format == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["id", "user_text", "expected_response", "review_state", "cmd", "intent"])
        for c in cases:
            w.writerow([c.id, c.turns[0]["text"] if c.turns else "", c.expected.get("response", ""),
                        c.review_state, c.cmd, c.intent_cluster_id])
        return {"filename": f"{t.name}.csv", "content": buf.getvalue(), "media_type": "text/csv"}
    raise HTTPException(422, "format must be jsonl|csv")
