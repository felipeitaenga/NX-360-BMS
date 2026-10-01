"""Pilares HVAC — FastAPI entrypoint."""
from dotenv import load_dotenv
from pathlib import Path

ROOT = Path(__file__).parent
load_dotenv(ROOT / ".env")

import os
import logging
from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware

from db import ensure_indexes
from seed import run_all_seeds
from mqtt_service import svc
from routes import router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger("app")

app = FastAPI(title="Pilares HVAC Supervisório", version="1.0.0")

cors_origins = os.environ.get("CORS_ORIGINS", "*")
origins = [o.strip() for o in cors_origins.split(",") if o.strip()]
if not origins:
    origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.on_event("startup")
async def _startup():
    await ensure_indexes()
    await run_all_seeds()
    await svc.start()
    logger.info("Pilares HVAC backend online")


@app.on_event("shutdown")
async def _shutdown():
    await svc.stop()
