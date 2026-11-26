"""API smoke tests: demo project seeds on startup, upload seeds, run jobs,
review, testset export."""
import io
import time

from fastapi.testclient import TestClient


def client():
    import os, tempfile
    os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.mkdtemp()}/t.db"
    # db module reads env at import; reload pattern: import fresh each test session
    from app.main import app
    return TestClient(app).__enter__()  # enter ctx so startup (init_db, demo seed) runs


def wait_job(client, job_id, timeout=30):
    for _ in range(timeout * 10):
        r = client.get(f"/v1/jobs/{job_id}").json()
        if r["status"] in ("succeeded", "failed"):
            return r
        time.sleep(0.1)
    raise AssertionError("job timeout")


def test_full_flow():
    c = client()
    r = c.get("/health")
    assert r.status_code == 200

    # demo project exists
    projects = c.get("/v1/projects").json()
    demo = next(p for p in projects if "Demo" in p["name"])
    pid = demo["id"]

    # upload more seeds
    r = c.post(f"/v1/projects/{pid}/seeds", files={"file": ("extra.txt", io.BytesIO(b"my parcel is lost since 20 days\norder 777 not delivered kya karu")), })
    assert r.json()["ingested"] == 2

    # anonymize job
    job = c.post(f"/v1/projects/{pid}/seeds/anonymize").json()
    r = wait_job(c, job["id"])
    assert r["status"] == "succeeded", r
    seeds = c.get(f"/v1/projects/{pid}/seeds").json()
    assert all(s["anon_text"] for s in seeds)

    # analyze job
    job = c.post(f"/v1/projects/{pid}/lexicon").json()
    r = wait_job(c, job["id"])
    assert r["status"] == "succeeded", r
    lex = c.get(f"/v1/projects/{pid}/lexicon").json()
    assert lex
    intents = c.get(f"/v1/projects/{pid}/intents").json()
    assert intents
    reg = c.get(f"/v1/projects/{pid}/register").json()
    assert "cmi_index" in reg

    # generation job (mock provider, no API keys)
    job = c.post(f"/v1/projects/{pid}/generation-jobs",
                 json={"count": 6, "messiness": "moderate", "seed": 42}).json()
    r = wait_job(c, job["id"])
    assert r["status"] == "succeeded", r
    cases = c.get(f"/v1/projects/{pid}/test-cases").json()
    assert len(cases) >= 4
    case = cases[0]
    assert case["expected"]["assertions"]
    assert case["turns"][0]["text"]

    # review
    r = c.post(f"/v1/projects/{pid}/test-cases/{case['id']}/review",
               json={"decision": "approve", "reason": "looks good"})
    assert r.json()["review_state"] == "approved"

    # testset + export
    ts = c.post(f"/v1/projects/{pid}/testsets",
                json={"name": "batch-1", "case_ids": [cs["id"] for cs in cases[:3]]}).json()
    exp = c.post(f"/v1/projects/{pid}/testsets/{ts['id']}/exports", params={"format": "csv"}).json()
    assert exp["content"].startswith("id,user_text")
    exp = c.post(f"/v1/projects/{pid}/testsets/{ts['id']}/exports", params={"format": "jsonl"}).json()
    assert '"id"' in exp["content"]


def test_spec_validation_blocks_bad_spec():
    c = client()
    pid = next(p["id"] for p in c.get("/v1/projects").json())
    r = c.post(f"/v1/projects/{pid}/response-specs",
               json={"name": "bad", "doc": {"must_include": [""], "must_not_include": []}})
    assert r.status_code == 422
