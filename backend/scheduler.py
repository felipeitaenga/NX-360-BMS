"""Setpoint/CMD/ESTADO scheduler.

A schedule executes an action on a fancoil at specific times.
Fields:
  fancoil_id: str
  days: list[int]  # 0=Sun..6=Sat; empty list = all days
  hour: int (0-23)
  minute: int (0-59)
  action: 'estado' | 'cmd' | 'setpoint'
  value: str  # 'true'/'false' or numeric
  enabled: bool
  last_run: str (ISO)
"""
from __future__ import annotations
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from bson import ObjectId
from db import db

logger = logging.getLogger("scheduler")


def _now_brt() -> datetime:
    # Brasília UTC-3
    return datetime.now(timezone.utc) - timedelta(hours=3)


async def run_scheduler(svc):
    while True:
        try:
            await asyncio.sleep(30)
            now = _now_brt()
            weekday = (now.weekday() + 1) % 7  # Monday=0 → Sunday=0 convention: Py Mon=0..Sun=6; we want Sun=0..Sat=6
            # Window: within last 60s
            cursor = db.schedules.find({"enabled": True})
            async for s in cursor:
                days = s.get("days") or []
                if days and weekday not in days:
                    continue
                sched_h = int(s["hour"])
                sched_m = int(s["minute"])
                if sched_h != now.hour or sched_m != now.minute:
                    continue
                # Avoid double-run within same minute
                last_run = s.get("last_run")
                if last_run:
                    try:
                        last_dt = datetime.fromisoformat(last_run.replace("Z", "+00:00"))
                        if (datetime.now(timezone.utc) - last_dt).total_seconds() < 55:
                            continue
                    except Exception:
                        pass
                fc = await db.fancoils.find_one({"_id": ObjectId(s["fancoil_id"])})
                if not fc:
                    continue
                try:
                    kind_map = {"estado": "ESTADO/SET", "cmd": "CMD/SET", "setpoint": "SETPOINT/SET"}
                    var = kind_map.get(s["action"])
                    if not var:
                        continue
                    await svc.publish_command(fc["device_id"], var, str(s["value"]), user_id="scheduler")
                    await db.schedules.update_one(
                        {"_id": s["_id"]},
                        {"$set": {"last_run": datetime.now(timezone.utc).isoformat()}},
                    )
                    logger.info(f"[scheduler] executed {s['action']}={s['value']} on {fc['name']}")
                except Exception as e:
                    logger.error(f"[scheduler] erro: {e}")
        except Exception:
            logger.exception("scheduler loop erro")
