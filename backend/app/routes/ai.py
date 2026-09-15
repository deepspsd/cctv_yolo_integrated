import json
import logging
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models import Camera, AiCameraConfig, User
from app.dependencies import get_current_user, require_admin
from app.config import settings
from app.ai_rules import rule_registry
from app.ai_scheduler import scheduler
from app.schemas import AiCameraConfigResponse, AiCameraConfigUpdate

logger = logging.getLogger("routes.ai")

router = APIRouter(
    prefix="/ai",
    tags=["AI"],
    dependencies=[Depends(get_current_user)],
)

@router.get("/status")
async def get_ai_status():
    """
    Expose aggregate and per-camera AI inference status,
    throughput, latency, and hardware telemetry.
    """
    return scheduler.get_aggregate_metrics()

@router.get("/classes")
async def get_ai_classes():
    """
    Expose dynamic model classes, semantic anomaly mappings,
    and explicit availability flags (e.g. PHONE_VIOLATION unavailable).
    """
    if not scheduler.model_loaded:
        scheduler.load_model()
    return rule_registry.get_registry_summary()

@router.get("/config/{camera_id}", response_model=AiCameraConfigResponse)
async def get_camera_ai_config(camera_id: str, db: AsyncSession = Depends(get_db)):
    """
    Get AI inference configuration for a specific camera.
    """
    # Verify camera exists
    cam_res = await db.execute(select(Camera).where(Camera.id == camera_id))
    cam = cam_res.scalar_one_or_none()
    if not cam:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Camera with ID '{camera_id}' not found."
        )

    res = await db.execute(select(AiCameraConfig).where(AiCameraConfig.camera_id == camera_id))
    cfg = res.scalar_one_or_none()

    if not cfg:
        # Create default config record
        default_rules = ["NO_HARDHAT", "NO_MASK", "NO_SAFETY_VEST", "PERSON_DETECTED", "MACHINERY_HAZARD"]
        cfg = AiCameraConfig(
            camera_id=camera_id,
            enabled=True,
            inference_fps=settings.AI_DEFAULT_FPS,
            confidence_threshold=settings.AI_DEFAULT_CONFIDENCE,
            image_size=settings.AI_IMAGE_SIZE,
            enabled_rules=json.dumps(default_rules),
            confirmation_frames=settings.AI_CONFIRMATION_FRAMES,
            cooldown_seconds=settings.AI_COOLDOWN_SECONDS,
            created_at=datetime.now(timezone.utc)
        )
        db.add(cfg)
        await db.commit()
        await db.refresh(cfg)

    rules_list = json.loads(cfg.enabled_rules) if isinstance(cfg.enabled_rules, str) else cfg.enabled_rules
    return {
        "cameraId": cfg.camera_id,
        "enabled": cfg.enabled,
        "inferenceFps": cfg.inference_fps,
        "confidenceThreshold": cfg.confidence_threshold,
        "imageSize": cfg.image_size,
        "enabledRules": rules_list,
        "confirmationFrames": cfg.confirmation_frames,
        "cooldownSeconds": cfg.cooldown_seconds,
        "updatedAt": cfg.updated_at.isoformat() if cfg.updated_at else cfg.created_at.isoformat()
    }

@router.put("/config/{camera_id}", response_model=AiCameraConfigResponse)
async def update_camera_ai_config(
    camera_id: str,
    payload: AiCameraConfigUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """
    Update AI inference configuration for a camera.
    Immediately updates scheduler without requiring app restart.
    """
    cam_res = await db.execute(select(Camera).where(Camera.id == camera_id))
    cam = cam_res.scalar_one_or_none()
    if not cam:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Camera with ID '{camera_id}' not found."
        )

    res = await db.execute(select(AiCameraConfig).where(AiCameraConfig.camera_id == camera_id))
    cfg = res.scalar_one_or_none()
    if not cfg:
        cfg = AiCameraConfig(
            camera_id=camera_id,
            enabled=True,
            inference_fps=settings.AI_DEFAULT_FPS,
            confidence_threshold=settings.AI_DEFAULT_CONFIDENCE,
            image_size=settings.AI_IMAGE_SIZE,
            enabled_rules=json.dumps(["NO_HARDHAT", "NO_MASK", "NO_SAFETY_VEST", "PERSON_DETECTED", "MACHINERY_HAZARD"]),
            confirmation_frames=settings.AI_CONFIRMATION_FRAMES,
            cooldown_seconds=settings.AI_COOLDOWN_SECONDS,
            created_at=datetime.now(timezone.utc)
        )
        db.add(cfg)

    if payload.enabled is not None:
        cfg.enabled = payload.enabled
    if payload.inference_fps is not None:
        cfg.inference_fps = payload.inference_fps
    if payload.confidence_threshold is not None:
        cfg.confidence_threshold = payload.confidence_threshold
    if payload.image_size is not None:
        cfg.image_size = payload.image_size
    if payload.enabled_rules is not None:
        cfg.enabled_rules = json.dumps(payload.enabled_rules)
    if payload.confirmation_frames is not None:
        cfg.confirmation_frames = payload.confirmation_frames
    if payload.cooldown_seconds is not None:
        cfg.cooldown_seconds = payload.cooldown_seconds

    cfg.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(cfg)

    # Apply directly to scheduler slot
    scheduler.update_camera_config(
        camera_id, enabled=cfg.enabled, target_fps=cfg.inference_fps,
        confidence_threshold=cfg.confidence_threshold, image_size=cfg.image_size,
        enabled_rules=json.loads(cfg.enabled_rules), confirmation_frames=cfg.confirmation_frames,
        cooldown_seconds=cfg.cooldown_seconds,
    )

    rules_list = json.loads(cfg.enabled_rules) if isinstance(cfg.enabled_rules, str) else cfg.enabled_rules
    return {
        "cameraId": cfg.camera_id,
        "enabled": cfg.enabled,
        "inferenceFps": cfg.inference_fps,
        "confidenceThreshold": cfg.confidence_threshold,
        "imageSize": cfg.image_size,
        "enabledRules": rules_list,
        "confirmationFrames": cfg.confirmation_frames,
        "cooldownSeconds": cfg.cooldown_seconds,
        "updatedAt": cfg.updated_at.isoformat()
    }

@router.post("/test-model")
async def test_ai_model():
    """
    Runs test inference on synthetic frame and returns execution metrics.
    """
    if not scheduler.model_loaded:
        scheduler.load_model()

    if not scheduler.model:
        return {
            "success": False,
            "error": scheduler.model_load_error or "Model not loaded",
            "model_path": settings.AI_MODEL_PATH
        }

    import numpy as np
    import time
    test_frame = np.zeros((360, 640, 3), dtype=np.uint8)
    t0 = time.perf_counter()
    results = scheduler.model(
        test_frame,
        verbose=False,
        conf=0.3,
        device=scheduler.device
    )
    t1 = time.perf_counter()
    latency_ms = round((t1 - t0) * 1000.0, 2)

    return {
        "success": True,
        "device": scheduler.device,
        "fp16": scheduler.use_fp16,
        "latency_ms": latency_ms,
        "classes_count": len(scheduler.model.names),
        "available_rules": [k for k, v in rule_registry.rule_mappings.items() if v.get("available")]
    }

@router.get("/cameras/{camera_id}/metrics")
async def get_camera_ai_metrics(camera_id: str):
    """
    Get real-time AI scheduler metrics for a specific camera.
    """
    with scheduler._lock:
        slot = scheduler.slots.get(camera_id)
        if not slot:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Camera slot '{camera_id}' not found in AI scheduler."
            )
        return slot.get_metrics()
