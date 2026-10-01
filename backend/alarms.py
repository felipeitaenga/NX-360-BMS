"""Alarm engine: evaluate fancoil state and generate/clear alarms."""
import asyncio
import logging
import time
from datetime import datetime, timezone
from db import db
from ws_manager import manager

logger = logging.getLogger("alarms")

ALARM_TYPES = {
    "OFFLINE": {"priority": "alta", "label": "Fancoil offline"},
    "SENSOR_FAIL": {"priority": "alta", "label": "Falha no sensor de temperatura"},
    "START_FAIL": {"priority": "alta", "label": "Falha de partida"},
    "STOP_FAIL": {"priority": "alta", "label": "Falha de parada"},
    "TEMP_OUT_OF_RANGE": {"priority": "media", "label": "Temperatura fora da faixa"},
    "FORCED_TOO_LONG": {"priority": "baixa", "label": "Em modo forçado por tempo prolongado"},
    "BROKER_DOWN": {"priority": "alta", "label": "Backend sem conexão com broker MQTT"},
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _get_settings():
    s = await db.settings.find_one({"_id": "global"}) or {}
    return {
        "offline_timeout_seconds": s.get("offline_timeout_seconds", 300),
        "command_timeout_seconds": s.get("command_timeout_seconds", 60),
        "temp_out_of_range_minutes": s.get("temp_out_of_range_minutes", 10),
        "forced_mode_alarm_hours": s.get("forced_mode_alarm_hours", 0),
    }


async def raise_alarm(device_id: str, atype: str, extra: dict = None):
    exists = await db.alarms.find_one({"device_id": device_id, "type": atype, "active": True})
    if exists:
        return
    doc = {
        "device_id": device_id,
        "type": atype,
        "priority": ALARM_TYPES[atype]["priority"],
        "label": ALARM_TYPES[atype]["label"],
        "started_at": now_iso(),
        "cleared_at": None,
        "active": True,
        "acknowledged": False,
        "acknowledged_by": None,
        "acknowledged_at": None,
        "extra": extra or {},
    }
    res = await db.alarms.insert_one(doc)
    doc["id"] = str(res.inserted_id)
    doc.pop("_id", None)
    await manager.broadcast("alarm_new", doc)
    logger.info(f"ALARME {atype} em {device_id}")


async def clear_alarm(device_id: str, atype: str):
    r = await db.alarms.find_one_and_update(
        {"device_id": device_id, "type": atype, "active": True},
        {"$set": {"active": False, "cleared_at": now_iso()}},
    )
    if r:
        await manager.broadcast(
            "alarm_cleared", {"device_id": device_id, "type": atype, "id": str(r["_id"])}
        )


# Track temporal conditions per device
_state_tracker: dict[str, dict] = {}


def _track(device_id: str) -> dict:
    t = _state_tracker.setdefault(device_id, {})
    return t


async def run_alarm_engine(svc):
    """Called by MQTTService; polls states every 5s."""
    while True:
        try:
            await asyncio.sleep(5)
            settings = await _get_settings()
            now = time.time()
            # Broker
            if not svc.connected:
                await raise_alarm("__system__", "BROKER_DOWN")
            else:
                await clear_alarm("__system__", "BROKER_DOWN")

            fancoils = await db.fancoils.find({"active": True}).to_list(1000)
            for fc in fancoils:
                did = fc["device_id"]
                st = svc.get_state(did)
                tr = _track(did)
                # Offline
                last_update_ts = tr.get("last_update_ts")
                if st.last_update:
                    try:
                        last_update_ts = datetime.fromisoformat(st.last_update).timestamp()
                        tr["last_update_ts"] = last_update_ts
                    except Exception:
                        pass
                offline_by_timeout = (
                    last_update_ts is None
                    or (now - last_update_ts) > settings["offline_timeout_seconds"]
                )
                if (st.online is False) or offline_by_timeout:
                    await raise_alarm(did, "OFFLINE")
                    continue
                else:
                    await clear_alarm(did, "OFFLINE")
                # Sensor fail
                if st.temp_error:
                    await raise_alarm(did, "SENSOR_FAIL")
                else:
                    await clear_alarm(did, "SENSOR_FAIL")
                # Start/Stop fail
                if st.cmd is True and st.status is False:
                    if "start_fail_since" not in tr:
                        tr["start_fail_since"] = now
                    elif now - tr["start_fail_since"] > settings["command_timeout_seconds"]:
                        await raise_alarm(did, "START_FAIL")
                else:
                    tr.pop("start_fail_since", None)
                    await clear_alarm(did, "START_FAIL")
                if st.cmd is False and st.status is True:
                    if "stop_fail_since" not in tr:
                        tr["stop_fail_since"] = now
                    elif now - tr["stop_fail_since"] > settings["command_timeout_seconds"]:
                        await raise_alarm(did, "STOP_FAIL")
                else:
                    tr.pop("stop_fail_since", None)
                    await clear_alarm(did, "STOP_FAIL")
                # Temp out of range
                if st.temperature is not None and st.status:
                    if (
                        st.temperature < fc.get("temp_alarm_min", 15)
                        or st.temperature > fc.get("temp_alarm_max", 30)
                    ):
                        if "temp_out_since" not in tr:
                            tr["temp_out_since"] = now
                        elif now - tr["temp_out_since"] > settings["temp_out_of_range_minutes"] * 60:
                            await raise_alarm(
                                did,
                                "TEMP_OUT_OF_RANGE",
                                {"temperature": st.temperature},
                            )
                    else:
                        tr.pop("temp_out_since", None)
                        await clear_alarm(did, "TEMP_OUT_OF_RANGE")
                # Forced too long
                hours_cfg = settings["forced_mode_alarm_hours"]
                if hours_cfg > 0 and st.estado is False:
                    if "forced_since" not in tr:
                        tr["forced_since"] = now
                    elif now - tr["forced_since"] > hours_cfg * 3600:
                        await raise_alarm(did, "FORCED_TOO_LONG")
                else:
                    tr.pop("forced_since", None)
                    await clear_alarm(did, "FORCED_TOO_LONG")
        except Exception:
            logger.exception("Erro no alarm engine")
