import asyncio
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .core.demo import seed_demo
from .db import SessionLocal, init_db
from .jobs import poller
from .routers import router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")

app = FastAPI(title="testset-generator API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # single-tenant MVP; tighten via CORS_ORIGINS later
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)


@app.on_event("startup")
async def startup() -> None:
    init_db()
    db = SessionLocal()
    try:
        seed_demo(db)
    finally:
        db.close()
    asyncio.create_task(poller())


@app.get("/health")
def health():
    return {"ok": True}
