import enum
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, DateTime, Enum, Text, Boolean, ForeignKey
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
    name = Column(String(128), nullable=False, unique=True, index=True)
    code = Column(String(32), nullable=False, unique=True)
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


class StreamSession(Base):
    __tablename__ = "stream_sessions"

    id = Column(String(64), primary_key=True, index=True)
    camera_id = Column(String(64), ForeignKey("cameras.id", ondelete="CASCADE"), nullable=False, index=True)
    started_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    last_activity_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    ended_at = Column(DateTime, nullable=True)
    viewer_count = Column(Integer, default=0, nullable=False)

    camera = relationship("Camera", back_populates="stream_sessions")


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
