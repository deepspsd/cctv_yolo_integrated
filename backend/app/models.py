import enum
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, Float, DateTime, Enum, Text, Boolean, ForeignKey, LargeBinary
from sqlalchemy.orm import relationship
from app.database import Base

class CameraStatusEnum(str, enum.Enum):
    ONLINE = "ONLINE"
    OFFLINE = "OFFLINE"
    CHECKING = "CHECKING"
    UNKNOWN = "UNKNOWN"

class Camera(Base):
    __tablename__ = "cameras"

    id = Column(String(64), primary_key=True, index=True)
    user_id = Column(String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    name = Column(String(128), nullable=False, index=True)
    code = Column(String(32), nullable=False, index=True)
    zone = Column(String(64), nullable=False, index=True)
    rtsp_url = Column(Text, nullable=False)
    username = Column(String(64), nullable=True, default="admin")
    password_encrypted = Column(Text, nullable=True)

    # Operational Status
    status = Column(Enum(CameraStatusEnum), default=CameraStatusEnum.UNKNOWN, nullable=False, index=True)
    last_checked_at = Column(DateTime, nullable=True)
    last_online_at = Column(DateTime, nullable=True)
    last_error = Column(Text, nullable=True)
    consecutive_failures = Column(Integer, default=0, nullable=False)

    # Real-time Telemetry Metadata
    resolution = Column(String(32), default="1920×1080", nullable=False)
    fps = Column(Integer, default=25, nullable=False)
    codec = Column(String(32), default="H.264", nullable=False)
    bitrate = Column(String(32), default="4.0 Mbps", nullable=False)
    ip = Column(String(64), default="192.168.1.100", nullable=False)
    model = Column(String(128), default="Enterprise CCTV", nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # Stream sessions relationship
    stream_sessions = relationship("StreamSession", back_populates="camera", cascade="all, delete-orphan")
    ai_config = relationship("AiCameraConfig", back_populates="camera", uselist=False, cascade="all, delete-orphan")
    anomalies = relationship("AnomalyEvent", back_populates="camera", cascade="all, delete-orphan")
    user = relationship("User", back_populates="cameras")


class StreamSession(Base):
    __tablename__ = "stream_sessions"

    id = Column(String(64), primary_key=True, index=True)
    camera_id = Column(String(64), ForeignKey("cameras.id", ondelete="CASCADE"), nullable=False, index=True)
    started_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    last_activity_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    ended_at = Column(DateTime, nullable=True)
    viewer_count = Column(Integer, default=0, nullable=False)

    camera = relationship("Camera", back_populates="stream_sessions")


class AiCameraConfig(Base):
    __tablename__ = "ai_camera_config"

    camera_id = Column(String(64), ForeignKey("cameras.id", ondelete="CASCADE"), primary_key=True)
    enabled = Column(Boolean, default=True, nullable=False)
    inference_fps = Column(Integer, default=5, nullable=False)
    confidence_threshold = Column(Float, default=0.45, nullable=False)
    image_size = Column(Integer, default=640, nullable=False)
    enabled_rules = Column(Text, nullable=False, default='["NO_HARDHAT", "NO_MASK", "NO_SAFETY_VEST", "PERSON_DETECTED", "PHONE_VIOLATION"]')
    confirmation_frames = Column(Integer, default=3, nullable=False)
    cooldown_seconds = Column(Integer, default=10, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    camera = relationship("Camera", back_populates="ai_config")


class AnomalyEvent(Base):
    __tablename__ = "anomaly_events"

    id = Column(String(64), primary_key=True, index=True)
    camera_id = Column(String(64), ForeignKey("cameras.id", ondelete="CASCADE"), nullable=False, index=True)
    zone = Column(String(64), nullable=False, index=True)
    event_category = Column(String(32), nullable=False)  # DETECTION, VIOLATION
    anomaly_type = Column(String(64), nullable=False, index=True)  # NO_HARDHAT, NO_MASK, NO_SAFETY_VEST, PERSON_DETECTED, PHONE_VIOLATION, MACHINERY_HAZARD
    model_class_id = Column(Integer, nullable=True)
    model_class_name = Column(String(64), nullable=True)
    confidence = Column(Float, nullable=False)
    track_id = Column(Integer, nullable=True)
    employee_id = Column(String(64), ForeignKey("employees.id", ondelete="SET NULL"), nullable=True, index=True)
    severity = Column(String(32), default="HIGH", nullable=False)
    first_seen_at = Column(DateTime, nullable=False)
    confirmed_at = Column(DateTime, nullable=False)
    ended_at = Column(DateTime, nullable=True)
    duration_seconds = Column(Float, nullable=True)
    status = Column(String(32), default="CONFIRMED", nullable=False, index=True)  # ACTIVE, CONFIRMED, ENDED
    snapshot_path = Column(Text, nullable=True)
    encrypted_image = Column(LargeBinary, nullable=True)
    user_id = Column(String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True)

    camera = relationship("Camera", back_populates="anomalies")
    employee = relationship("Employee", back_populates="anomalies")
    user = relationship("User")


class Employee(Base):
    __tablename__ = "employees"

    id = Column(String(64), primary_key=True, index=True)
    employee_code = Column(String(32), nullable=False, unique=True, index=True)
    name = Column(String(128), nullable=False, index=True)
    department = Column(String(64), nullable=False, default="Production", index=True)
    role = Column(String(64), nullable=False, default="Staff")
    active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    face_templates = relationship("FaceTemplate", back_populates="employee", cascade="all, delete-orphan")
    body_templates = relationship("BodyTemplate", back_populates="employee", cascade="all, delete-orphan")
    attendance_records = relationship("Attendance", back_populates="employee", cascade="all, delete-orphan")
    observations = relationship("AttendanceObservation", back_populates="employee", cascade="all, delete-orphan")
    anomalies = relationship("AnomalyEvent", back_populates="employee")


class FaceTemplate(Base):
    __tablename__ = "face_templates"

    id = Column(String(64), primary_key=True, index=True)
    employee_id = Column(String(64), ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True)
    embedding = Column(Text, nullable=False)  # JSON serialized vector [float]
    embedding_model = Column(String(64), default="arcface", nullable=False)
    quality_score = Column(Float, default=1.0, nullable=False)
    source = Column(String(64), default="enrollment_webcam", nullable=False)  # enrollment_webcam, cctv_verified
    camera_id = Column(String(64), nullable=True)
    pose = Column(String(32), default="frontal", nullable=False)  # frontal, left, right, profile_left, profile_right, upward, downward
    resolution = Column(String(32), nullable=True, default="112x112")
    encrypted_image = Column(LargeBinary, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    employee = relationship("Employee", back_populates="face_templates")


class BodyTemplate(Base):
    __tablename__ = "body_templates"

    id = Column(String(64), primary_key=True, index=True)
    employee_id = Column(String(64), ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True)
    embedding = Column(Text, nullable=False)  # JSON serialized vector [float]
    model_name = Column(String(64), default="fastreid", nullable=False)
    quality_score = Column(Float, default=1.0, nullable=False)
    camera_id = Column(String(64), nullable=True)
    source = Column(String(64), default="cctv_verified", nullable=False)
    encrypted_image = Column(LargeBinary, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    employee = relationship("Employee", back_populates="body_templates")


class Attendance(Base):
    __tablename__ = "attendance"

    id = Column(String(64), primary_key=True, index=True)
    employee_id = Column(String(64), ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True)
    date = Column(String(10), nullable=False, index=True)  # YYYY-MM-DD
    first_seen_at = Column(DateTime, nullable=False)
    last_seen_at = Column(DateTime, nullable=False)
    clock_in_camera_id = Column(String(64), nullable=True)
    last_seen_camera_id = Column(String(64), nullable=True)
    clock_in_confidence = Column(Float, nullable=False, default=0.0)
    status = Column(String(32), default="PRESENT", nullable=False, index=True)  # PRESENT, COMPLETED, ABSENT
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    employee = relationship("Employee", back_populates="attendance_records")


class AttendanceObservation(Base):
    __tablename__ = "attendance_observations"

    id = Column(String(64), primary_key=True, index=True)
    employee_id = Column(String(64), ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True)
    camera_id = Column(String(64), nullable=False, index=True)
    track_id = Column(Integer, nullable=True)
    timestamp = Column(DateTime, nullable=False, index=True)
    identity_confidence = Column(Float, nullable=False)
    face_confidence = Column(Float, nullable=True)
    body_reid_confidence = Column(Float, nullable=True)
    source = Column(String(32), default="CCTV", nullable=False)

    employee = relationship("Employee", back_populates="observations")


class UserRoleEnum(str, enum.Enum):
    ADMINISTRATOR = "Administrator"
    SECURITY_OFFICER = "Security Officer"
    SURVEILLANCE_OPERATOR = "Surveillance Operator"
    FACILITY_MANAGER = "Facility Manager"


class User(Base):
    __tablename__ = "users"

    id = Column(String(64), primary_key=True, index=True)
    name = Column(String(128), nullable=False)
    email = Column(String(256), nullable=False, unique=True, index=True)
    hashed_password = Column(Text, nullable=False)
    role = Column(Enum(UserRoleEnum), default=UserRoleEnum.SURVEILLANCE_OPERATOR, nullable=False)
    facility = Column(String(128), nullable=False, default="General")
    badge_id = Column(String(32), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)

    # Revoked token support (simple: store last logout time; any token issued before this is invalid)
    last_logout_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    last_login_at = Column(DateTime, nullable=True)

    cameras = relationship("Camera", back_populates="user", cascade="all, delete-orphan")
