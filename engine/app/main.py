import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from clipforge.engine.app.config import CORS_ORIGINS
from clipforge.engine.app.routers import render
from clipforge.engine.app.routers import clips, jobs, metadata, presets

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)

app = FastAPI(title="ClipForge engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(jobs.router)
app.include_router(clips.router)
app.include_router(render.router)
app.include_router(presets.router)
app.include_router(metadata.router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
