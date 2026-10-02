"""Pydantic models for Pilares HVAC."""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Optional, List, Literal
from pydantic import BaseModel, EmailStr, Field


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# -------- Users --------
Role = Literal["admin", "operator", "viewer"]


class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: Role = "viewer"
    active: bool = True


class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[Role] = None
    active: Optional[bool] = None


class UserOut(BaseModel):
    id: str
    name: str
    email: EmailStr
    role: Role
    active: bool
    must_change_password: bool = False
    last_login: Optional[str] = None
    created_at: Optional[str] = None


class LoginReq(BaseModel):
    email: EmailStr
    password: str


class ChangePasswordReq(BaseModel):
    current_password: str
    new_password: str


class ResetPasswordAdminReq(BaseModel):
    user_id: str
    new_password: str


# -------- Fancoils --------
class FancoilCreate(BaseModel):
    name: str
    device_id: str
    floor: int
    side: Literal[1, 2]
    description: Optional[str] = ""
    setpoint_min: float = 18.0
    setpoint_max: float = 26.0
    temp_alarm_min: float = 15.0
    temp_alarm_max: float = 30.0
    active: bool = True


class FancoilUpdate(BaseModel):
    name: Optional[str] = None
    device_id: Optional[str] = None
    floor: Optional[int] = None
    side: Optional[Literal[1, 2]] = None
    description: Optional[str] = None
    setpoint_min: Optional[float] = None
    setpoint_max: Optional[float] = None
    temp_alarm_min: Optional[float] = None
    temp_alarm_max: Optional[float] = None
    active: Optional[bool] = None


class FancoilOut(BaseModel):
    id: str
    name: str
    device_id: str
    floor: int
    side: int
    description: str = ""
    setpoint_min: float
    setpoint_max: float
    temp_alarm_min: float
    temp_alarm_max: float
    active: bool
    # Telemetry
    online: bool = False
    status: Optional[bool] = None  # STATUS true=on
    modo: Optional[bool] = None  # MODO true=AUTO (quadro)
    estado: Optional[bool] = None  # ESTADO/SET true=AUTOMÁTICO
    cmd: Optional[bool] = None  # CMD/SET true=LIGAR
    temperature: Optional[float] = None
    temp_error: bool = False
    setpoint: Optional[float] = None
    vag: Optional[float] = None
    last_update: Optional[str] = None


# -------- Permissions --------
class PermissionsUpdate(BaseModel):
    user_id: str
    modules: List[str] = Field(default_factory=list)
    fancoil_ids: List[str] = Field(default_factory=list)


# -------- Commands --------
class CommandReq(BaseModel):
    kind: Literal["ESTADO", "CMD", "SETPOINT", "PRESSAO"]
    value: str  # "true"/"false" or numeric string


class BulkCommandReq(BaseModel):
    action: Literal["force_all", "unforce_all", "turn_on_all", "turn_off_all"]
    fancoil_ids: List[str] = Field(default_factory=list)  # empty = todos autorizados


# -------- Alarms --------
class AlarmAck(BaseModel):
    alarm_id: str


# -------- Settings --------
class BrokerConfig(BaseModel):
    host: str = ""
    port: int = 1883
    username: str = ""
    password: str = ""
    tls: bool = False
    client_id: str = "pilares-backend"
    topic_prefix: str = "TJS"


class SettingsUpdate(BaseModel):
    broker: Optional[BrokerConfig] = None
    simulation_enabled: Optional[bool] = None
    offline_timeout_seconds: Optional[int] = None
    command_timeout_seconds: Optional[int] = None
    temp_out_of_range_minutes: Optional[int] = None
    forced_mode_alarm_hours: Optional[int] = None
    history_retention_months: Optional[int] = None
    hide_unauthorized_fancoils: Optional[bool] = None
    building_image_url: Optional[str] = None
    logo_url: Optional[str] = None


# -------- Schedules --------
class ScheduleCreate(BaseModel):
    fancoil_id: str
    days: List[int] = Field(default_factory=list)  # 0=Sun..6=Sat; empty=all
    hour: int
    minute: int
    action: Literal["estado", "cmd", "setpoint"]
    value: str
    enabled: bool = True


class ScheduleUpdate(BaseModel):
    days: Optional[List[int]] = None
    hour: Optional[int] = None
    minute: Optional[int] = None
    action: Optional[Literal["estado", "cmd", "setpoint"]] = None
    value: Optional[str] = None
    enabled: Optional[bool] = None
