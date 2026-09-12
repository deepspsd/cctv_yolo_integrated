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
    user_id: str | None = Field(default=None, alias="userId")
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


class AiCameraConfigResponse(BaseModel):
    camera_id: str = Field(..., alias="cameraId")
    enabled: bool
    inference_fps: int = Field(..., alias="inferenceFps")
    confidence_threshold: float = Field(..., alias="confidenceThreshold")
    image_size: int = Field(..., alias="imageSize")
    enabled_rules: list[str] = Field(..., alias="enabledRules")
    confirmation_frames: int = Field(..., alias="confirmationFrames")
    cooldown_seconds: int = Field(..., alias="cooldownSeconds")
    updated_at: str | None = Field(default=None, alias="updatedAt")
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)


class AiCameraConfigUpdate(BaseModel):
    enabled: bool | None = None
    inference_fps: int | None = Field(default=None, ge=1, le=30, alias="inferenceFps")
    confidence_threshold: float | None = Field(default=None, ge=0.1, le=1.0, alias="confidenceThreshold")
    image_size: int | None = Field(default=None, alias="imageSize")
    enabled_rules: list[str] | None = Field(default=None, alias="enabledRules")
    confirmation_frames: int | None = Field(default=None, ge=1, le=10, alias="confirmationFrames")
    cooldown_seconds: int | None = Field(default=None, ge=1, le=120, alias="cooldownSeconds")
    model_config = ConfigDict(populate_by_name=True)


class AnomalyEventResponse(BaseModel):
    id: str
    camera_id: str = Field(..., alias="cameraId")
    zone: str
    event_category: str = Field(..., alias="eventCategory")
    anomaly_type: str = Field(..., alias="anomalyType")
    model_class_id: int | None = Field(default=None, alias="modelClassId")
    model_class_name: str | None = Field(default=None, alias="modelClassName")
    confidence: float
    track_id: int | None = Field(default=None, alias="trackId")
    employee_id: str | None = Field(default=None, alias="employeeId")
    employee_name: str | None = Field(default=None, alias="employeeName")
    alert_message: str | None = Field(default=None, alias="alertMessage")
    first_seen_at: str = Field(..., alias="firstSeenAt")
    confirmed_at: str = Field(..., alias="confirmedAt")
    ended_at: str | None = Field(default=None, alias="endedAt")
    duration_seconds: float | None = Field(default=None, alias="durationSeconds")
    camera_name: str | None = Field(default=None, alias="cameraName")
    severity: str = Field(default="HIGH", alias="severity")
    status: str
    snapshot_path: str | None = Field(default=None, alias="snapshotPath")
    created_at: str = Field(..., alias="createdAt")
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)


class AnomalyStatusUpdate(BaseModel):
    status: str = Field(..., description="NEW, REVIEWED, or RESOLVED")


# ─── Employee Schemas ──────────────────────────────────────────────
class EmployeeBase(BaseModel):
    employee_code: str = Field(..., min_length=2, max_length=32, alias="employeeCode")
    name: str = Field(..., min_length=2, max_length=128)
    department: str = Field(default="Production", max_length=64)
    role: str = Field(default="Staff", max_length=64)
    active: bool = True
    model_config = ConfigDict(populate_by_name=True)


class EmployeeCreate(EmployeeBase):
    pass


class EmployeeUpdate(BaseModel):
    name: str | None = None
    department: str | None = None
    role: str | None = None
    active: bool | None = None
    model_config = ConfigDict(populate_by_name=True)


class EmployeeResponse(EmployeeBase):
    id: str
    created_at: str = Field(..., alias="createdAt")
    updated_at: str = Field(..., alias="updatedAt")
    template_count: int = Field(default=0, alias="templateCount")
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)


class FaceEnrollmentRequest(BaseModel):
    image_base64: str = Field(..., alias="imageBase64", description="Base64 encoded face photo")
    pose: str = Field(default="frontal", description="frontal, left, right, profile_left, profile_right, upward, downward")
    source: str = Field(default="enrollment_webcam", description="enrollment_webcam or cctv_verified")
    camera_id: str | None = Field(default=None, alias="cameraId")
    model_config = ConfigDict(populate_by_name=True)


class BodyEnrollmentRequest(BaseModel):
    image_base64: str = Field(..., alias="imageBase64", description="Base64 encoded full-body photo")
    source: str = Field(default="cctv_verified")
    camera_id: str | None = Field(default=None, alias="cameraId")
    model_config = ConfigDict(populate_by_name=True)


class TemplateMetadataResponse(BaseModel):
    id: str
    employee_id: str = Field(..., alias="employeeId")
    type: str  # face or body
    pose: str | None = None
    quality_score: float = Field(..., alias="qualityScore")
    source: str
    camera_id: str | None = Field(default=None, alias="cameraId")
    created_at: str = Field(..., alias="createdAt")
    model_config = ConfigDict(populate_by_name=True)


# ─── Attendance Schemas ───────────────────────────────────────────
class AttendanceResponse(BaseModel):
    id: str
    employee_id: str = Field(..., alias="employeeId")
    employee_code: str = Field(..., alias="employeeCode")
    employee_name: str = Field(..., alias="employeeName")
    department: str
    date: str
    first_seen_at: str = Field(..., alias="firstSeenAt")
    last_seen_at: str = Field(..., alias="lastSeenAt")
    clock_in_camera_id: str | None = Field(default=None, alias="clockInCameraId")
    last_seen_camera_id: str | None = Field(default=None, alias="lastSeenCameraId")
    clock_in_camera_name: str | None = Field(default=None, alias="clockInCameraName")
    last_seen_camera_name: str | None = Field(default=None, alias="lastSeenCameraName")
    clock_in_confidence: float = Field(..., alias="clockInConfidence")
    status: str
    duration_hours: str = Field(default="0.0", alias="durationHours")
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)


class AttendanceSummaryResponse(BaseModel):
    date: str
    total_employees: int = Field(..., alias="totalEmployees")
    clocked_in_today: int = Field(..., alias="clockedInToday")
    active_on_site: int = Field(..., alias="activeOnSite")
    completed_shifts: int = Field(..., alias="completedShifts")
    attendance_rate: float = Field(..., alias="attendanceRate")
    model_config = ConfigDict(populate_by_name=True)

