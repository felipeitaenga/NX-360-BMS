"""Seeding: default admin + example fancoils (CJ011..CJ172 without floor 13)."""
import os
from datetime import datetime, timezone
from db import db
from auth import hash_password

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def seed_admin():
    email = os.environ["ADMIN_EMAIL"].lower()
    password = os.environ["ADMIN_PASSWORD"]
    existing = await db.users.find_one({"email": email})
    if not existing:
        await db.users.insert_one({
            "name": "Administrador",
            "email": email,
            "password_hash": hash_password(password),
            "role": "admin",
            "active": True,
            "must_change_password": True,
            "created_at": now_iso(),
            "last_login": None,
        })
        print(f"[seed] Admin criado: {email}")
    else:
        # ensure admin remains admin
        await db.users.update_one(
            {"email": email},
            {"$set": {"role": "admin", "active": True}},
        )


async def seed_fancoils():
    # Skip if any fancoils already exist
    count = await db.fancoils.count_documents({})
    if count > 0:
        return
    floors = [f for f in range(1, 18) if f != 13]
    for f in floors:
        for side in (1, 2):
            name = f"CJ{f:02d}{side}"
            device_id = f"SIM{f:02d}0{side}"
            await db.fancoils.insert_one({
                "name": name,
                "device_id": device_id,
                "floor": f,
                "side": side,
                "description": f"Conjunto {name} — {f}º andar lado {side}",
                "setpoint_min": 18.0,
                "setpoint_max": 26.0,
                "temp_alarm_min": 15.0,
                "temp_alarm_max": 30.0,
                "active": True,
                "created_at": now_iso(),
            })
    print(f"[seed] {len(floors) * 2} fancoils de simulação criados")


async def seed_settings():
    s = await db.settings.find_one({"_id": "global"})
    if s:
        return
    await db.settings.insert_one({
        "_id": "global",
        "simulation_enabled": True,
        "broker": {
            "host": "", "port": 1883, "username": "", "password": "",
            "tls": False, "client_id": "pilares-backend", "topic_prefix": "TJS",
        },
        "offline_timeout_seconds": 300,
        "command_timeout_seconds": 60,
        "temp_out_of_range_minutes": 10,
        "forced_mode_alarm_hours": 0,
        "history_retention_months": 12,
        "hide_unauthorized_fancoils": False,
        "building_image_url": "https://images.unsplash.com/photo-1528810289438-283f885c31ef?crop=entropy&cs=srgb&fm=jpg&q=85&w=1200",
        "logo_url": "",
    })
    print("[seed] Settings globais criadas")


async def run_all_seeds():
    await seed_settings()
    await seed_admin()
    await seed_fancoils()
