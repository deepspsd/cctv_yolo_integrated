from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from app.models import CameraStatusEnum

class CameraBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=128, description="Unique camera name")
    zone: str = Field(..., min_length=1, max_length=64, description="Factory/warehouse zone")
    rtsp_url: str = Field(..., description="RTSP or RTSPS stream URL", alias="rtspUrl")
    username: str | None = Field(default="admin", max_length=64)

class CameraCreate(CameraBase):
    password: str | None = Field(default=None, description="Camera password (stored encrypted, never exposed)")
    model_config = ConfigDict(populate_by_name=True)

class CameraUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    zone: str | None = Field(default=None, min_length=1, max_length=64)
    rtsp_url: str | None = Field(default=None, alias="rtspUrl")
    username: str | None = None
    password: str | None = None
    # User verification required before camera update is committed
    user_login: str | None = Field(default=None, alias="userLogin")
    user_password: str | None = Field(default=None, alias="userPassword")
    model_config = ConfigDict(populate_by_name=True)

class CameraResponse(BaseModel):
    id: str
    name: str
    code: str
    zone: str
    rtsp_url: str = Field(..., alias="rtspUrl")
    rtsp_url_display: str | None = Field(default=None, alias="rtspUrlDisplay")
    username: str | None = None
    status: CameraStatusEnum
    last_checked: str = Field(..., alias="lastChecked")
    last_online: str = Field(..., alias="lastOnline")
    last_error: str | None = Field(default=None, alias="lastError")
    resolution: str
    fps: int
    codec: str
    bitrate: str
    ip: str
    model: str | None = None
    consecutive_failures: int = Field(default=0, alias="consecutiveFailures")

    model_config = ConfigDict(
        from_attributes=True,
        populate_by_name=True
    )

class CameraSummaryResponse(BaseModel):
    total: int
    online: int
    offline: int
    checking: int
    unknown: int
    active_viewers: int = Field(default=0, alias="activeViewers")
    model_config = ConfigDict(populate_by_name=True)

class CameraStatusUpdateMessage(BaseModel):
    id: str
    status: CameraStatusEnum
    lastChecked: str
    lastOnline: str
    lastError: str | None = None
    consecutiveFailures: int = 0
    resolution: str | None = None
    fps: int | None = None
    codec: str | None = None
    bitrate: str | None = None

class CameraTestRequest(BaseModel):
    rtsp_url: str = Field(..., alias="rtspUrl")
    username: str | None = None
    password: str | None = None
    model_config = ConfigDict(populate_by_name=True)

class CameraTestExistingRequest(BaseModel):
    rtsp_url: str | None = Field(default=None, alias="rtspUrl")
    username: str | None = None
    password: str | None = None
    model_config = ConfigDict(populate_by_name=True)

class CameraTestResponse(BaseModel):
    success: bool
    latency_ms: int = Field(..., alias="latencyMs")
    details: str
    reachable: bool
    stream_available: bool = Field(..., alias="streamAvailable")
    codec: str | None = None
    resolution: str | None = None
    fps: int | None = None
    width: int | None = None
    height: int | None = None
    error: str | None = None
    model_config = ConfigDict(populate_by_name=True)

class StreamStartResponse(BaseModel):
    camera_id: str = Field(..., alias="cameraId")
    protocol: str = "webrtc"
    stream_path: str = Field(..., alias="streamPath")
    stream_url: str = Field(..., alias="streamUrl")
    whep_url: str = Field(..., alias="whepUrl")
    session_id: str = Field(..., alias="sessionId")
    expires_at: str = Field(..., alias="expiresAt")
    type: str = "webrtc"
    resolution: str
    fps: int
    codec: str
    bitrate: str
    status: CameraStatusEnum
    started_at: str = Field(..., alias="startedAt")
    model_config = ConfigDict(populate_by_name=True)

class StreamStopRequest(BaseModel):
    session_id: str | None = Field(default=None, alias="sessionId")
    model_config = ConfigDict(populate_by_name=True)

