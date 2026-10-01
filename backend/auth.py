"""JWT auth helpers."""
import os
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from bson import ObjectId
from fastapi import HTTPException, Request, Depends
from db import db

JWT_ALGORITHM = "HS256"
ACCESS_MINUTES = 60 * 8


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except Exception:
        return False


def _secret() -> str:
    return os.environ["JWT_SECRET"]


def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_MINUTES),
        "type": "access",
    }
    return jwt.encode(payload, _secret(), algorithm=JWT_ALGORITHM)


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Não autenticado")
    try:
        payload = jwt.decode(token, _secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Token inválido")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user or not user.get("active", True):
            raise HTTPException(status_code=401, detail="Usuário inativo ou inexistente")
        user["id"] = str(user["_id"])
        user.pop("_id", None)
        user.pop("password_hash", None)
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Sessão expirada")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")


def require_role(*roles: str):
    async def dep(user: dict = Depends(get_current_user)):
        if user["role"] not in roles:
            raise HTTPException(status_code=403, detail="Permissão insuficiente")
        return user

    return dep


require_admin = require_role("admin")
require_operator = require_role("admin", "operator")


async def get_user_permissions(user_id: str) -> dict:
    perm = await db.permissions.find_one({"user_id": user_id})
    if not perm:
        return {"modules": [], "fancoil_ids": []}
    return {
        "modules": perm.get("modules", []),
        "fancoil_ids": perm.get("fancoil_ids", []),
    }


async def can_access_fancoil(user: dict, fancoil_id: str) -> bool:
    if user["role"] == "admin":
        return True
    perms = await get_user_permissions(user["id"])
    return fancoil_id in perms["fancoil_ids"]


async def allowed_fancoil_ids(user: dict) -> list[str] | None:
    """Return None for admin (all), or list of allowed ids."""
    if user["role"] == "admin":
        return None
    perms = await get_user_permissions(user["id"])
    return perms["fancoil_ids"]
