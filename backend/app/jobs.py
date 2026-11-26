"""Job runner: a `jobs` table polled by a background asyncio task in-process.
No Celery/Redis. Job types: anonymize | analyze | generate."""
import asyncio
import logging
import random
import traceback

from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import Job, LexiconTerm, Project, RegisterProfile, SessionLocal, TestCase, IntentCluster, SeedRecord, id as new_id
from .core import analyze, anonymize, generate, transforms

log = logging.getLogger("jobs")


def run_job(db: Session, job: Job) -> None:
    job.status = "running"
    db.commit()
    pid = job.project_id
    cfg = job.config or {}
    seed_val = job.seed or 42
    rng = random.Random(seed_val)

    if job.type == "anonymize":
        seeds = db.scalars(select(SeedRecord).where(SeedRecord.project_id == pid)).all()
        job.progress_total = len(seeds)
        surrogates = anonymize._Surrogates()
        for s in seeds:
            text, spans = anonymize.detect_and_anonymize(s.text, surrogates)
            s.anon_text = text
            s.pii_spans = spans
            job.progress_done += 1
        db.commit()
        # persist surrogate mapping (thin slice: JSON row per job)
        from .db import SurrogateMap
        db.add(SurrogateMap(id=new_id("sur"), project_id=pid, mapping=surrogates.mapping))

    elif job.type == "analyze":
        seeds = db.scalars(select(SeedRecord).where(SeedRecord.project_id == pid)).all()
        texts = [s.anon_text or s.text for s in seeds]
        job.progress_total = 3
        for t in db.scalars(select(LexiconTerm).where(LexiconTerm.project_id == pid)).all():
            db.delete(t)
        for lt in analyze.extract_lexicon(texts):
            db.add(LexiconTerm(id=new_id("lex"), project_id=pid, **lt))
        job.progress_done = 1
        db.commit()
        profile = analyze.register_profile(texts)
        rp = db.get(RegisterProfile, pid) or RegisterProfile(project_id=pid)
        rp.stats = profile
        db.merge(rp)
        job.progress_done = 2
        db.commit()
        for c in db.scalars(select(IntentCluster).where(IntentCluster.project_id == pid)).all():
            db.delete(c)
        for c in analyze.cluster_intents(texts, [s.id for s in seeds]):
            db.add(IntentCluster(id=new_id("int"), project_id=pid, **c))
        job.progress_done = 3

    elif job.type == "generate":
        from .core.spec_compiler import compile_anchors
        from .db import ResponseSpec

        spec = db.scalar(select(ResponseSpec).where(ResponseSpec.project_id == pid).order_by(ResponseSpec.version.desc()))  # type: ignore
        if spec is None:
            raise RuntimeError("no response spec for project")
        seeds = db.scalars(select(SeedRecord).where(SeedRecord.project_id == pid)).all()
        lex = db.scalars(select(LexiconTerm).where(LexiconTerm.project_id == pid)).all()
        intents = db.scalars(select(IntentCluster).where(IntentCluster.project_id == pid)).all()
        if not intents:
            raise RuntimeError("run analyze job first (no intent clusters)")
        profile = (db.get(RegisterProfile, pid).stats if db.get(RegisterProfile, pid) else {})
        ctx = {
            "lexicon_terms": [{"term": t.term, "typo_forms": t.typo_forms} for t in lex],
            "register_profile": profile,
            "personas": generate.PERSONAS,
            "seeds": [s.anon_text or s.text for s in seeds],
        }
        count = int(cfg.get("count", 5))
        cmd = cfg.get("cmd")
        per_cluster = max(1, count // max(1, len(intents)))
        cases = []
        for intent in intents:
            intent_d = {"id": intent.id, "label": intent.label, "top_terms": intent.top_terms, "exemplar_ids": intent.exemplar_ids}
            if cfg.get("intent_ids") and intent.id not in cfg["intent_ids"]:
                continue
            for c in generate.generate_single_turn(ctx, spec.doc, intent_d, per_cluster, seed_val + len(cases), cmd=cmd, register=cfg.get("register")):
                noisy, trace = transforms.apply_chain(
                    c["turns"][0]["text"],
                    {"preset": cfg.get("messiness", "moderate"), "cmd": c["cmd"],
                     "register": c["register"], "use_llm": cfg.get("use_llm", True)},
                    chain_seed=c["seed"] ^ 0xBEEF,
                    lexicon_terms=ctx["lexicon_terms"],
                )
                c["turns"][0] = {"role": "user", "text": noisy, "clean": c["turns"][0]["text"]}
                c["transform_trace"] = trace
                c["provenance"] = {"seed_ids": c["seed_ids"], "job_id": job.id, "spec_version": spec.version,
                                   "chain_seed": c["seed"] ^ 0xBEEF, "anchors_used": len(compile_anchors(spec.doc))}
                db.add(TestCase(id=new_id("tc"), project_id=pid, job_id=job.id, **{
                    k: c[k] for k in ("kind", "intent_cluster_id", "persona", "cmd", "turns", "expected", "transform_trace", "provenance")
                }))
                cases.append(c)
                job.progress_total = count
                job.progress_done = len(cases)
                db.commit()
                if len(cases) >= count:
                    break
            if len(cases) >= count:
                break
        job.progress_total = count
        job.progress_done = len(cases)
    else:
        raise ValueError(f"unknown job type: {job.type}")


def execute_job(job_id: str) -> None:
    db = SessionLocal()
    try:
        job = db.get(Job, job_id)
        if not job or job.status != "queued":
            return
        try:
            run_job(db, job)
            job.status = "succeeded"
        except Exception as e:  # noqa: BLE001
            job.status = "failed"
            job.error = f"{e}\n{traceback.format_exc(limit=4)}"
            log.error("job %s failed: %s", job_id, e)
        db.commit()
    finally:
        db.close()


async def poller(poll_interval: float = 1.0) -> None:
    """Background asyncio task polling the jobs table."""
    while True:
        try:
            db = SessionLocal()
            try:
                job = db.scalar(select(Job).where(Job.status == "queued").order_by(Job.created_at).limit(1))
                if job:
                    job_id = job.id
                else:
                    job_id = None
            finally:
                db.close()
            if job_id:
                await asyncio.to_thread(execute_job, job_id)
            else:
                await asyncio.sleep(poll_interval)
        except Exception:  # noqa: BLE001
            log.exception("poller error")
            await asyncio.sleep(2)
