"""Password reset via Emergent email proxy."""
import os
import logging
import hashlib
import secrets
from datetime import datetime, timezone, timedelta
from html import escape
from urllib.parse import urlparse
import httpx
from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, EmailStr
from db import db
from auth import hash_password

logger = logging.getLogger("password_reset")

EMAIL_BASE_URL = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip().rstrip("/") or "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY", "")
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME") or "NX-360 BMS"


class ForgotReq(BaseModel):
    email: EmailStr


class ResetReq(BaseModel):
    token: str
    new_password: str


async def send_password_reset_email(to_email: str, token: str) -> bool:
    base = os.environ.get("FRONTEND_URL", "").rstrip("/")
    link = f"{base}/redefinir-senha?token={token}"
    if not EMAIL_KEY or EMAIL_KEY.startswith("{") or not base.startswith("https://"):
        if urlparse(base).hostname in ("localhost", "127.0.0.1", "::1"):
            logger.warning("Email não configurado; link de reset: %s", link)
        else:
            logger.error("Password reset email not configured")
        return False
    brand = escape(EMAIL_FROM_NAME)
    html = (
        f'<table role="presentation" width="100%"><tr><td style="padding:24px;font-family:Arial,sans-serif">'
        f'<p>Olá,</p>'
        f'<p>Recebemos uma solicitação para redefinir a sua senha no <b>{brand}</b>.</p>'
        f'<p><a href="{escape(link)}" style="background:#0284c7;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">Redefinir senha</a></p>'
        f'<p>Este link expira em 1 hora e só pode ser usado uma vez. Se você não solicitou, ignore este e-mail.</p>'
        f'<p style="font-size:12px;color:#888">{brand} — supervisório predial. Nunca pedimos sua senha por e-mail.</p>'
        f'</td></tr></table>'
    )
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{EMAIL_BASE_URL}/api/v1/email/send",
                headers={"X-Email-Key": EMAIL_KEY},
                json={"to": [to_email], "subject": f"Redefinir senha — {EMAIL_FROM_NAME}",
                      "html": html, "from_name": EMAIL_FROM_NAME},
            )
        resp.raise_for_status()
        return True
    except Exception as e:
        logger.error(f"Password reset email failed: {e}")
        return False


router = APIRouter(prefix="/api/auth")


GENERIC_RESP = {"message": "Se o e-mail estiver cadastrado, enviaremos um link de redefinição."}


@router.post("/forgot-password")
async def forgot_password(req: ForgotReq, bg: BackgroundTasks):
    email = req.email.lower().strip()
    now = datetime.now(timezone.utc)
    # record attempt BEFORE lookup
    await db.password_reset_requests.insert_one({"email": email, "created_at": now.isoformat()})
    # rate limit: 5 per 15min
    window = (now - timedelta(minutes=15)).isoformat()
    recent = await db.password_reset_requests.count_documents({"email": email, "created_at": {"$gte": window}})
    if recent > 5:
        return GENERIC_RESP
    user = await db.users.find_one({"email": email})
    if not user:
        return GENERIC_RESP
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    await db.password_reset_tokens.insert_one({
        "token_hash": token_hash,
        "user_id": str(user["_id"]),
        "email": email,
        "expires_at": now + timedelta(hours=1),
        "used": False,
    })
    bg.add_task(send_password_reset_email, user["email"], token)
    return GENERIC_RESP


@router.post("/reset-password")
async def reset_password(req: ResetReq):
    if len(req.new_password) < 6:
        raise HTTPException(status_code=400, detail="A senha deve ter ao menos 6 caracteres")
    h = hashlib.sha256(req.token.encode()).hexdigest()
    now = datetime.now(timezone.utc)
    tok = await db.password_reset_tokens.find_one_and_update(
        {"token_hash": h, "used": False, "expires_at": {"$gt": now}},
        {"$set": {"used": True}},
    )
    if not tok:
        raise HTTPException(status_code=400, detail="Link inválido ou expirado")
    from bson import ObjectId
    user_id = tok["user_id"]
    await db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"password_hash": hash_password(req.new_password), "must_change_password": False}},
    )
    await db.password_reset_tokens.delete_many({"user_id": user_id, "used": False})
    return {"ok": True}
