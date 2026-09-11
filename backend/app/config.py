import os
from typing import Union
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    PROJECT_NAME: str = "CCTV Priya Textiles - Camera Management"
    API_V1_STR: str = "/api"
    PORT: int = int(os.getenv("PORT", "5000"))

    # Database Configuration
    CAMERA_DB_PATH: str = os.getenv("CAMERA_DB_PATH", "./data/cameras.db")
    DATABASE_URL: str = os.getenv("DATABASE_URL", f"sqlite+aiosqlite:///{os.getenv('CAMERA_DB_PATH', './data/cameras.db')}")

    # Secret Key for AES-GCM credential encryption (32 bytes)
    CAMERA_SECRET_KEY: str = os.getenv(
        "CAMERA_SECRET_KEY",
        os.getenv("CREDENTIAL_ENCRYPTION_KEY", "cctv_priya_textiles_secret_key_32b!")
    )
    CREDENTIAL_ENCRYPTION_KEY: str = os.getenv(
        "CAMERA_SECRET_KEY",
        os.getenv("CREDENTIAL_ENCRYPTION_KEY", "cctv_priya_textiles_secret_key_32b!")
    )

    # JWT Authentication
    JWT_SECRET_KEY: str = os.getenv("JWT_SECRET_KEY", "CHANGE_ME_TO_A_LONG_RANDOM_SECRET")
    JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "15"))
    REFRESH_TOKEN_EXPIRE_DAYS: int = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "30"))

    # MediaMTX Configuration
    MEDIAMTX_HOST: str = os.getenv("MEDIAMTX_HOST", "127.0.0.1")
    MEDIAMTX_API_PORT: int = int(os.getenv("MEDIAMTX_API_PORT", "9997"))
    MEDIAMTX_WEBRTC_PORT: int = int(os.getenv("MEDIAMTX_WEBRTC_PORT", "8889"))
    MEDIAMTX_API_URL: str = os.getenv("MEDIAMTX_API_URL", f"http://{os.getenv('MEDIAMTX_HOST', '127.0.0.1')}:{os.getenv('MEDIAMTX_API_PORT', '9997')}")
    MEDIAMTX_WHEP_URL: str = os.getenv("MEDIAMTX_WHEP_URL", f"http://{os.getenv('MEDIAMTX_HOST', '127.0.0.1')}:{os.getenv('MEDIAMTX_WEBRTC_PORT', '8889')}")
    MEDIAMTX_RTSP_PORT: int = int(os.getenv("MEDIAMTX_RTSP_PORT", "8554"))

    # Health Check parameters (spec compliant - 60s / 1 minute periodic check)
    HEALTH_CHECK_INTERVAL_SECONDS: int = int(os.getenv("CAMERA_HEALTH_INTERVAL", os.getenv("HEALTH_CHECK_INTERVAL_SECONDS", "60")))
    HEALTH_CHECK_TIMEOUT_SECONDS: float = float(os.getenv("CAMERA_RTSP_TIMEOUT", os.getenv("HEALTH_CHECK_TIMEOUT_SECONDS", "3.0")))
    HEALTH_CHECK_CONCURRENCY: int = int(os.getenv("CAMERA_HEALTH_CONCURRENCY", os.getenv("HEALTH_CHECK_CONCURRENCY", "4")))
    CONSECUTIVE_FAILURES_THRESHOLD: int = int(os.getenv("CAMERA_FAILURE_THRESHOLD", os.getenv("CONSECUTIVE_FAILURES_THRESHOLD", "2")))

    # Stream session parameters
    STREAM_IDLE_TIMEOUT: int = int(os.getenv("STREAM_IDLE_TIMEOUT", "15"))
    STREAM_SESSION_TIMEOUT: int = int(os.getenv("STREAM_SESSION_TIMEOUT", "60"))

    # AI Inference Configuration
    AI_MODEL_PATH: str = os.getenv("AI_MODEL_PATH", "./models/ppe.pt")
    AI_DEFAULT_FPS: int = int(os.getenv("AI_DEFAULT_FPS", "5"))
    AI_DEFAULT_CONFIDENCE: float = float(os.getenv("AI_DEFAULT_CONFIDENCE", "0.45"))
    AI_IMAGE_SIZE: int = int(os.getenv("AI_IMAGE_SIZE", "640"))
    AI_DEVICE: str = os.getenv("AI_DEVICE", "auto")
    AI_USE_FP16: bool = os.getenv("AI_USE_FP16", "true").lower() in ("true", "1", "yes")
    AI_BATCH_SIZE: int = int(os.getenv("AI_BATCH_SIZE", "4"))
    AI_MAX_FRAME_QUEUE: int = int(os.getenv("AI_MAX_FRAME_QUEUE", "2"))
    AI_CONFIRMATION_FRAMES: int = int(os.getenv("AI_CONFIRMATION_FRAMES", "3"))
    AI_COOLDOWN_SECONDS: int = int(os.getenv("AI_COOLDOWN_SECONDS", "10"))
    AI_MAX_CAMERAS: int = int(os.getenv("AI_MAX_CAMERAS", "64"))
    AI_EVIDENCE_DIR: str = os.getenv("AI_EVIDENCE_DIR", "./data/evidence")
    AI_MOCK_MODE: bool = os.getenv("AI_MOCK_MODE", "false").lower() in ("true", "1", "yes")

    # Development Mock Mode
    CAMERA_MOCK_MODE: bool = os.getenv("CAMERA_MOCK_MODE", "false").lower() in ("true", "1", "yes")

    # CORS
    CORS_ORIGINS: Union[list[str], str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "http://localhost:5000",
        "http://127.0.0.1:5000",
    ]

    @field_validator("CORS_ORIGINS", mode="after")
    @classmethod
    def parse_cors(cls, v: Union[list[str], str]) -> list[str]:
        if isinstance(v, str):
            v_str = v.strip()
            if v_str.startswith("[") and v_str.endswith("]"):
                import json
                try:
                    return json.loads(v_str)
                except Exception:
                    pass
            return [x.strip() for x in v_str.split(",") if x.strip()]
        return v

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

# Auto-create directory for SQLite database if needed
db_path = os.getenv("CAMERA_DB_PATH", "./data/cameras.db")
if not db_path.startswith("sqlite") and not db_path.startswith(":memory:"):
    db_dir = os.path.dirname(os.path.abspath(db_path))
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)

settings = Settings()
