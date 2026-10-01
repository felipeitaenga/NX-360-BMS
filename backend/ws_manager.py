"""WebSocket connection manager for real-time telemetry push."""
import asyncio
import json
import logging
from typing import Set
from fastapi import WebSocket

logger = logging.getLogger("ws")


class ConnectionManager:
    def __init__(self):
        self.active: Set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        async with self._lock:
            self.active.add(ws)

    async def disconnect(self, ws: WebSocket):
        async with self._lock:
            self.active.discard(ws)

    async def broadcast(self, event: str, payload: dict):
        msg = json.dumps({"event": event, "data": payload}, default=str)
        dead = []
        for ws in list(self.active):
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append(ws)
        for d in dead:
            await self.disconnect(d)


manager = ConnectionManager()
