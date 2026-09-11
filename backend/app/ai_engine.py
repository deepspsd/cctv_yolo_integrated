import os
import json
import time
import uuid
import asyncio
import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any
from collections import deque

import cv2
import numpy as np
from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal
from app.models import Camera, CameraStatusEnum, AnomalyEvent, AiCameraConfig
from app.security import decrypt_credential, build_authenticated_rtsp_url
from app.websocket_manager import ws_manager
from app.ai_scheduler import scheduler, CameraAiSlot
from app.ai_rules import rule_registry
from app.ai_tracker import multi_camera_tracker
from app.ai_state_machine import state_machine
from app.mediamtx import mediamtx_manager

logger = logging.getLogger("ai_engine")

class AiInferenceEngine:
    """
    High-level orchestrator connecting fair batch scheduler,
    camera sync loop, database persistence, and WebSocket broadcasting.
    Fully backwards-compatible with existing frontend endpoints.
    """
    def __init__(self):
        self._running = False
        self._sync_task: Optional[asyncio.Task] = None
        self.scheduler = scheduler

    def start(self):
        if not self._running:
            self._running = True
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = None
            self.scheduler.start(loop=loop)
            self._sync_task = asyncio.create_task(self._camera_sync_loop())
            logger.info("AiInferenceEngine high-throughput service started.")

    async def stop(self):
        self._running = False
        if self._sync_task:
            self._sync_task.cancel()
            try:
                await self._sync_task
            except asyncio.CancelledError:
                pass
        self.scheduler.stop()
        logger.info("AiInferenceEngine service stopped.")

    async def _camera_sync_loop(self):
        """
        Periodically syncs database cameras into AI scheduler slots.
        Handles dynamic additions, deletions, and online/offline status changes.
        """
        await asyncio.sleep(2.0)  # Bootstrap delay
        while self._running:
            try:
                await self.sync_all_cameras()
            except Exception as e:
                logger.error(f"Error in camera AI sync cycle: {e}", exc_info=True)
            await asyncio.sleep(10.0)

    async def sync_all_cameras(self):
        """
        Synchronize registered scheduler camera slots with SQLite database state.
        """
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Camera))
            cameras = result.scalars().all()
            configs = await db.execute(select(AiCameraConfig))
            config_by_camera = {c.camera_id: c for c in configs.scalars().all()}

        current_cam_ids = {c.id for c in cameras}

        # Remove cameras no longer in DB
        with self.scheduler._lock:
            scheduled_ids = list(self.scheduler.slots.keys())
        for cid in scheduled_ids:
            if cid not in current_cam_ids:
                self.scheduler.unregister_camera(cid)

        # Register or update cameras
        for cam in cameras:
            auth_url = build_authenticated_rtsp_url(
                cam.rtsp_url,
                username=cam.username,
                password=decrypt_credential(cam.password_encrypted) if cam.password_encrypted else None
            )
            is_online = (cam.status == CameraStatusEnum.ONLINE)
            cfg = config_by_camera.get(cam.id)
            if cfg is None:
                cfg = AiCameraConfig(camera_id=cam.id, enabled=True,
                    inference_fps=settings.AI_DEFAULT_FPS,
                    confidence_threshold=settings.AI_DEFAULT_CONFIDENCE,
                    image_size=settings.AI_IMAGE_SIZE,
                    enabled_rules=json.dumps(["NO_HARDHAT", "NO_MASK", "NO_SAFETY_VEST", "PERSON_DETECTED", "PHONE_VIOLATION"]),
                    confirmation_frames=settings.AI_CONFIRMATION_FRAMES,
                    cooldown_seconds=settings.AI_COOLDOWN_SECONDS)
                async with AsyncSessionLocal() as write_db:
                    write_db.add(cfg)
                    await write_db.commit()
            rules = json.loads(cfg.enabled_rules) if isinstance(cfg.enabled_rules, str) else (cfg.enabled_rules or [])

            # Ensure AI reader and browser both consume same MediaMTX path.
            await mediamtx_manager.register_camera_path(cam.id, cam.rtsp_url, cam.username,
                decrypt_credential(cam.password_encrypted) if cam.password_encrypted else None)
            
            if cam.id not in self.scheduler.slots:
                self.scheduler.register_camera(
                    camera_id=cam.id,
                    camera_name=cam.name,
                    zone=cam.zone,
                    direct_rtsp_url=auth_url,
                    target_fps=cfg.inference_fps,
                    enabled=cfg.enabled,
                    confidence_threshold=cfg.confidence_threshold,
                    image_size=cfg.image_size,
                    enabled_rules=rules,
                    confirmation_frames=cfg.confirmation_frames,
                    cooldown_seconds=cfg.cooldown_seconds,
                    is_online=is_online
                )
            else:
                self.scheduler.register_camera(
                    camera_id=cam.id,
                    camera_name=cam.name,
                    zone=cam.zone,
                    direct_rtsp_url=auth_url,
                    target_fps=cfg.inference_fps,
                    enabled=cfg.enabled,
                    confidence_threshold=cfg.confidence_threshold,
                    image_size=cfg.image_size,
                    enabled_rules=rules,
                    confirmation_frames=cfg.confirmation_frames,
                    cooldown_seconds=cfg.cooldown_seconds,
                    is_online=is_online
                )

    def set_priority_camera(self, camera_id: str, duration_seconds: int = 30):
        # Dynamically elevate target FPS for actively viewed camera
        with self.scheduler._lock:
            if camera_id in self.scheduler.slots:
                self.scheduler.slots[camera_id].target_fps = 10

    def get_camera_ai_state(self, camera_id: str) -> dict:
        """
        Retrieve latest AI detections, counts, compliance %, and anomalies for a camera.
        """
        with self.scheduler._lock:
            slot = self.scheduler.slots.get(camera_id)
            if slot and slot.latest_state:
                return slot.latest_state

        return {
            "cameraId": camera_id,
            "peopleCount": 0,
            "phoneViolations": 0,
            "ppeViolations": 0,
            "complianceScore": 100,
            "detections": [],
            "anomalies": [],
            "lastAnalyzed": None
        }

    def get_all_recent_anomalies(self, limit: int = 20) -> List[dict]:
        """
        Retrieve recent anomalies across all cameras from memory cache.
        """
        all_anoms = []
        with self.scheduler._lock:
            for slot in self.scheduler.slots.values():
                anoms = slot.latest_state.get("anomalies", [])
                all_anoms.extend(anoms)
        all_anoms.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
        return all_anoms[:limit]

    def process_b64_frame(self, camera_id: str, camera_code: str, b64_string: str) -> dict:
        """
        Processes single base64 frame from client browser WebRTC canvas.
        Executes model and updates camera slot state.
        """
        import base64
        try:
            if "," in b64_string:
                b64_string = b64_string.split(",", 1)[1]
            raw = base64.b64decode(b64_string)
            nparr = np.frombuffer(raw, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if frame is None:
                return self.get_camera_ai_state(camera_id)

            with self.scheduler._lock:
                slot = self.scheduler.slots.get(camera_id)
            if slot and (not slot.enabled or slot.status == "OFFLINE"):
                logger.debug(f"Skipping b64 AI frame for {camera_id}: camera is {slot.status}.")
                return self.get_camera_ai_state(camera_id)

            if not self.scheduler.model_loaded:
                self.scheduler.load_model()

            if self.scheduler.model:
                results = self.scheduler.model(
                    frame,
                    verbose=False,
                    conf=settings.AI_DEFAULT_CONFIDENCE,
                    imgsz=settings.AI_IMAGE_SIZE,
                    device=self.scheduler.device,
                    half=self.scheduler.use_fp16
                )
                if not slot:
                    slot = CameraAiSlot(camera_id, camera_code, "Live", settings.AI_DEFAULT_FPS)
                
                self.scheduler._process_single_camera_result(slot, frame, results[0])
                return slot.latest_state

        except Exception as e:
            logger.error(f"Error processing b64 frame: {e}")

        return self.get_camera_ai_state(camera_id)

    async def analyze_camera_now(self, camera_id: str) -> dict:
        """
        On-demand instant AI analysis for a specific camera.
        Skipped if camera is OFFLINE or disabled.
        """
        with self.scheduler._lock:
            slot = self.scheduler.slots.get(camera_id)

        if slot and (not slot.enabled or slot.status == "OFFLINE"):
            logger.info(f"Skipping on-demand AI analysis for {camera_id}: camera is {slot.status}.")
            return self.get_camera_ai_state(camera_id)
        
        frame = None
        if slot and slot.reader:
            frame = slot.reader.get_latest_frame()

        if frame is None:
            # If no frame available from reader, do not run artificial inference
            logger.debug(f"No fresh frame available for on-demand analysis on {camera_id}.")
            return self.get_camera_ai_state(camera_id)

        if not self.scheduler.model_loaded:
            self.scheduler.load_model()

        if self.scheduler.model:
            results = self.scheduler.model(
                frame,
                verbose=False,
                conf=settings.AI_DEFAULT_CONFIDENCE,
                imgsz=settings.AI_IMAGE_SIZE,
                device=self.scheduler.device,
                half=self.scheduler.use_fp16
            )
            if not slot:
                slot = CameraAiSlot(camera_id, camera_id, "Zone", settings.AI_DEFAULT_FPS)
            self.scheduler._process_single_camera_result(slot, frame, results[0])
            await ws_manager.broadcast("CAMERA_AI_UPDATE", slot.latest_state)
            return slot.latest_state

        return self.get_camera_ai_state(camera_id)

ai_engine = AiInferenceEngine()
