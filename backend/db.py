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
