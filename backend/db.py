"""Database connection and helpers."""
import os
from motor.motor_asyncio import AsyncIOMotorClient

_client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = _client[os.environ["DB_NAME"]]


async def ensure_indexes():
    await db.users.create_index("email", unique=True)
    await db.fancoils.create_index("device_id", unique=True)
    await db.fancoils.create_index("name", unique=True)
    await db.devices.create_index("device_id", unique=True)
    await db.alarms.create_index([("active", 1), ("started_at", -1)])
    await db.alarms.create_index("device_id")
    await db.command_log.create_index([("timestamp", -1)])
    await db.history.create_index([("device_id", 1), ("timestamp", -1)])
    await db.access_log.create_index([("timestamp", -1)])
    await db.permissions.create_index("user_id", unique=True)
    await db.password_reset_tokens.create_index("expires_at", expireAfterSeconds=0)
    await db.password_reset_tokens.create_index("token_hash", unique=True)
    await db.password_reset_requests.create_index("email")
    await db.password_reset_requests.create_index("created_at", expireAfterSeconds=900)
    await db.schedules.create_index("fancoil_id")
    await db.device_states.create_index("device_id", unique=True)
    # Lighting module
    await db.pavimentos.create_index("nome", unique=True)
    await db.pavimentos.create_index("ordem")
    await db.lighting_controllers.create_index("mqtt_id", unique=True)
    await db.lighting_points.create_index("pavimento_id")
    await db.lighting_points.create_index("controladora_id")
    await db.lighting_states.create_index("mqtt_id", unique=True)
    await db.lighting_events.create_index([("timestamp", -1)])
    await db.lighting_events.create_index([("mqtt_id", 1), ("timestamp", -1)])
    # TTL 90 days = 7776000s
    try:
        await db.lighting_events.create_index("timestamp", expireAfterSeconds=7776000)
    except Exception:
        pass
