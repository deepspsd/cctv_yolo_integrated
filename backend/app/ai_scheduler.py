import os
import time
import math
import logging
import threading
import asyncio
import subprocess
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
from collections import deque
from datetime import datetime, timezone

import cv2
import numpy as np
import psutil
from ultralytics import YOLO

from app.config import settings
from app.ai_rules import rule_registry
from app.ai_tracker import multi_camera_tracker
from app.ai_state_machine import state_machine
from app.ai_stream_reader import CameraStreamReader
from app.websocket_manager import ws_manager
from app.face_pipeline import face_pipeline, FaceQualityCategory
from app.reid_pipeline import reid_pipeline
from app.identity_fusion import identity_fusion, IdentityState
from app.attendance_service import attendance_service

logger = logging.getLogger("ai_scheduler")

class CameraAiSlot:
    def __init__(self, camera_id: str, camera_name: str, zone: str, target_fps: int = 5,
                 confidence_threshold: float | None = None, image_size: int | None = None,
                 enabled_rules: list[str] | None = None, confirmation_frames: int | None = None,
                 cooldown_seconds: int | None = None):
        self.camera_id = camera_id
        self.camera_name = camera_name
        self.zone = zone
        self.target_fps = max(1, min(30, target_fps))
        self.enabled = True
        self.status = "INITIALIZING"
        self.confidence_threshold = confidence_threshold if confidence_threshold is not None else settings.AI_DEFAULT_CONFIDENCE
        self.image_size = image_size or settings.AI_IMAGE_SIZE
        self.enabled_rules = set(enabled_rules or ["NO_HARDHAT", "NO_MASK", "NO_SAFETY_VEST", "PERSON_DETECTED", "PHONE_VIOLATION"])
        self.confirmation_frames = confirmation_frames or settings.AI_CONFIRMATION_FRAMES
        self.cooldown_seconds = cooldown_seconds or settings.AI_COOLDOWN_SECONDS

        # Frame reader instance
        self.reader: Optional[CameraStreamReader] = None

        # Timing & FPS metrics
        self.last_inference_time = 0.0
        self.actual_fps = 0.0
        self.frames_received = 0
        self.frames_inferred = 0
        self.frames_dropped = 0
        self.inference_latency_ms = 0.0
        self.queue_depth = 0
        self.last_error: Optional[str] = None

        # Rolling inference timestamps for accurate rolling FPS calculation
        self._inference_timestamps: deque = deque(maxlen=20)
        self._latency_history: deque = deque(maxlen=50)

        # Latest AI state cache for frontend queries
        self.latest_state: Dict[str, Any] = {
            "cameraId": camera_id,
            "cameraCode": camera_name,
            "peopleCount": 0,
            "phoneViolations": 0,
            "ppeViolations": 0,
            "complianceScore": 100,
            "detections": [],
            "anomalies": [],
            "lastAnalyzed": None
        }

    def record_inference(self, latency_ms: float):
        now = time.monotonic()
        self.last_inference_time = now
        self.frames_inferred += 1
        self.inference_latency_ms = round(latency_ms, 2)
        self._inference_timestamps.append(now)
        self._latency_history.append(latency_ms)

        # Compute rolling actual FPS over last 20 frames
        if len(self._inference_timestamps) >= 2:
            time_span = self._inference_timestamps[-1] - self._inference_timestamps[0]
            if time_span > 0:
                self.actual_fps = round((len(self._inference_timestamps) - 1) / time_span, 1)

    def get_overdue_seconds(self, now: float) -> float:
        if not self.enabled or self.status != "ONLINE":
            return -999.0
        target_interval = 1.0 / max(1.0, float(self.target_fps))
        time_since_last = now - self.last_inference_time
        return time_since_last - target_interval

    def get_metrics(self) -> Dict[str, Any]:
        reader_metrics = self.reader.get_metrics() if self.reader else {}
        return {
            "camera_id": self.camera_id,
            "camera_name": self.camera_name,
            "zone": self.zone,
            "enabled": self.enabled,
            "status": self.status,
            "target_fps": self.target_fps,
            "actual_fps": self.actual_fps,
            "frames_received": reader_metrics.get("frames_received", self.frames_received),
            "frames_inferred": self.frames_inferred,
            "frames_dropped": reader_metrics.get("frames_dropped", self.frames_dropped),
            "inference_latency_ms": self.inference_latency_ms,
            "queue_depth": reader_metrics.get("queue_depth", 0),
            "last_error": reader_metrics.get("last_error", self.last_error)
        }


class FairMultiCameraScheduler:
    """
    Fair multi-camera batch inference scheduler.
    Supports up to 20+ cameras continuously & simultaneously.
    Selects overdue cameras, batches frames, executes single model pass,
    distributes results to per-camera tracking & state machine.
    """
    def __init__(self):
        self._running = False
        self._scheduler_thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()

        # Registered camera slots
        self.slots: Dict[str, CameraAiSlot] = {}
        self.main_loop: Optional[asyncio.AbstractEventLoop] = None

        # Shared YOLO model instance
        self.model: Optional[YOLO] = None
        self.device: str = "cpu"
        self.use_fp16: bool = False
        self.model_loaded: bool = False
        self.model_load_error: Optional[str] = None

        # System telemetry metrics
        self.global_target_fps: float = 0.0
        self.global_actual_fps: float = 0.0
        self.global_latency_history: deque = deque(maxlen=100)
        self.global_total_inferred: int = 0
        self.global_total_dropped: int = 0

    def resolve_model_path(self, model_rel_path: str = "models/ppe.pt") -> Path:
        backend_dir = Path(__file__).resolve().parent.parent
        root_dir = backend_dir.parent
        candidates = [
            root_dir / model_rel_path,
            backend_dir / model_rel_path,
            Path(model_rel_path)
        ]
        for c in candidates:
            if c.exists():
                return c.resolve()
        return (root_dir / model_rel_path).resolve()

    def load_model(self) -> bool:
        """
        Load YOLO model once with device auto-detection and FP16 support.
        """
        if self.model_loaded and self.model is not None:
            return True

        model_path = self.resolve_model_path(settings.AI_MODEL_PATH)
        logger.info(f"Loading shared YOLO model from: {model_path}")

        try:
            import torch
            has_cuda = torch.cuda.is_available()
        except Exception:
            has_cuda = False

        cfg_device = settings.AI_DEVICE.lower()
        if cfg_device == "cuda" or (cfg_device == "auto" and has_cuda):
            self.device = "cuda"
            self.use_fp16 = settings.AI_USE_FP16
        else:
            self.device = "cpu"
            self.use_fp16 = False

        logger.info(f"AI Inference Device selected: {self.device} (FP16: {self.use_fp16})")

        try:
            if not model_path.exists():
                logger.warning(f"Model path {model_path} not found. Attempting ppe.pt fallback.")
                self.model = YOLO("ppe.pt")
            else:
                self.model = YOLO(str(model_path))

            # Warmup pass
            dummy = np.zeros((360, 640, 3), dtype=np.uint8)
            self.model(dummy, verbose=False, device=self.device, half=self.use_fp16)

            # Discover dynamic class mappings
            rule_registry.discover_classes(self.model)

            self.model_loaded = True
            self.model_load_error = None
            logger.info("Shared YOLO model loaded and validated successfully.")
            return True
        except Exception as e:
            self.model_loaded = False
            self.model_load_error = str(e)
            logger.error(f"Failed to load shared YOLO model: {e}", exc_info=True)
            return False

    def start(self, loop: Optional[asyncio.AbstractEventLoop] = None):
        if not self._running:
            self._running = True
            if loop is not None:
                self.main_loop = loop
                state_machine.main_loop = loop
            self.load_model()
            self._scheduler_thread = threading.Thread(
                target=self._scheduler_worker,
                name="ai_scheduler_worker",
                daemon=True
            )
            self._scheduler_thread.start()
            logger.info("FairMultiCameraScheduler started.")

    def stop(self):
        self._running = False
        with self._lock:
            for slot in self.slots.values():
                if slot.reader:
                    slot.reader.stop()
        if self._scheduler_thread and self._scheduler_thread.is_alive():
            self._scheduler_thread.join(timeout=3.0)
        logger.info("FairMultiCameraScheduler stopped.")

    def register_camera(
        self,
        camera_id: str,
        camera_name: str,
        zone: str,
        direct_rtsp_url: str,
        target_fps: int = 5,
        enabled: bool = True,
        confidence_threshold: float | None = None,
        image_size: int | None = None,
        enabled_rules: list[str] | None = None,
        confirmation_frames: int | None = None,
        cooldown_seconds: int | None = None,
        is_online: bool = True
    ):
        """
        Registers a camera. Only starts background RTSP reader if camera is enabled AND ONLINE.
        If camera is OFFLINE, AI reader and inference remain completely inactive.
        """
        with self._lock:
            if camera_id in self.slots:
                slot = self.slots[camera_id]
                slot.camera_name = camera_name
                slot.zone = zone
                slot.target_fps = target_fps
                slot.enabled = enabled
                if not enabled:
                    slot.status = "DISABLED"
                else:
                    slot.status = "ONLINE" if is_online else "OFFLINE"

                if slot.reader:
                    slot.reader.direct_rtsp_url = direct_rtsp_url
                if confidence_threshold is not None: slot.confidence_threshold = confidence_threshold
                if image_size is not None: slot.image_size = image_size
                if enabled_rules is not None: slot.enabled_rules = set(enabled_rules)
                if confirmation_frames is not None: slot.confirmation_frames = confirmation_frames
                if cooldown_seconds is not None: slot.cooldown_seconds = cooldown_seconds

                if not slot.reader:
                    slot.reader = CameraStreamReader(camera_id, camera_name, direct_rtsp_url)

                if enabled and is_online and not slot.reader._running:
                    slot.reader.start()
                elif (not is_online or not enabled) and slot.reader._running:
                    slot.reader.stop()
                return

            slot = CameraAiSlot(camera_id, camera_name, zone, target_fps, confidence_threshold,
                                image_size, enabled_rules, confirmation_frames, cooldown_seconds)
            slot.enabled = enabled
            if not enabled:
                slot.status = "DISABLED"
            else:
                slot.status = "ONLINE" if is_online else "OFFLINE"

            slot.reader = CameraStreamReader(camera_id, camera_name, direct_rtsp_url)
            if enabled and is_online:
                slot.reader.start()
                logger.info(f"Registered camera {camera_id} ({camera_name}) with AI scheduler at {target_fps} FPS [ONLINE]")
            else:
                logger.info(f"Registered camera {camera_id} ({camera_name}) with AI scheduler as [{slot.status}] - AI reader inactive")

            self.slots[camera_id] = slot

    def unregister_camera(self, camera_id: str):
        with self._lock:
            if camera_id in self.slots:
                slot = self.slots.pop(camera_id)
                if slot.reader:
                    slot.reader.stop()
                multi_camera_tracker.remove_camera(camera_id)
                logger.info(f"Unregistered camera {camera_id} from AI scheduler")

    def set_camera_status(self, camera_id: str, is_online: bool):
        """
        Updates camera connectivity status in AI scheduler.
        If camera goes OFFLINE: Immediately stops RTSP reader, clears queue, and skips AI inference.
        If camera comes ONLINE: Resumes RTSP reader if enabled.
        """
        with self._lock:
            if camera_id in self.slots:
                slot = self.slots[camera_id]
                if not slot.enabled:
                    slot.status = "DISABLED"
                    if slot.reader and slot.reader._running:
                        slot.reader.stop()
                    return

                new_status = "ONLINE" if is_online else "OFFLINE"
                if slot.status != new_status:
                    logger.info(f"AI scheduler: Camera {camera_id} ({slot.camera_name}) status: {slot.status} -> {new_status}")
                slot.status = new_status

                if not is_online:
                    # Camera is OFFLINE: Stop reader, clear queue, zero active AI state
                    if slot.reader and slot.reader._running:
                        slot.reader.stop()
                    if slot.reader:
                        slot.reader._clear_queue()
                else:
                    # Camera is ONLINE: Resume RTSP reader
                    if slot.reader and not slot.reader._running:
                        slot.reader.start()

    def update_camera_config(self, camera_id: str, enabled: bool, target_fps: int,
                             confidence_threshold: float | None = None, image_size: int | None = None,
                             enabled_rules: list[str] | None = None, confirmation_frames: int | None = None,
                             cooldown_seconds: int | None = None):
        with self._lock:
            if camera_id in self.slots:
                slot = self.slots[camera_id]
                slot.enabled = enabled
                slot.target_fps = max(1, min(30, target_fps))
                if confidence_threshold is not None: slot.confidence_threshold = confidence_threshold
                if image_size is not None: slot.image_size = image_size
                if enabled_rules is not None: slot.enabled_rules = set(enabled_rules)
                if confirmation_frames is not None: slot.confirmation_frames = confirmation_frames
                if cooldown_seconds is not None: slot.cooldown_seconds = cooldown_seconds
                if not enabled and slot.reader:
                    slot.reader.stop()
                    slot.status = "DISABLED"
                elif enabled and slot.reader and not slot.reader._running:
                    slot.reader.start()
                    slot.status = "ONLINE"

    def _scheduler_worker(self):
        """
        Continuous round-robin & overdue priority scheduling loop.
        Never starves any camera. Batches up to AI_BATCH_SIZE frames.
        """
        while self._running:
            if not self.model_loaded:
                self.load_model()
                if not self.model_loaded:
                    time.sleep(2.0)
                    continue

            now = time.monotonic()
            batch_slots: List[CameraAiSlot] = []
            batch_frames: List[np.ndarray] = []

            # 1. Evaluate camera overdue priorities
            with self._lock:
                active_slots = [
                    s for s in self.slots.values()
                    if s.enabled and s.status == "ONLINE" and s.reader and s.reader.is_connected
                ]

            if not active_slots:
                time.sleep(0.05)
                continue

            # Sort by most overdue first
            active_slots.sort(key=lambda s: s.get_overdue_seconds(now), reverse=True)

            # Select up to AI_BATCH_SIZE overdue cameras with fresh frames ready
            max_batch = max(1, settings.AI_BATCH_SIZE)
            for slot in active_slots:
                if len(batch_slots) >= max_batch:
                    break
                # Only take if overdue (or slightly approaching interval)
                if slot.get_overdue_seconds(now) > -0.05:
                    frame = slot.reader.get_latest_frame() if slot.reader else None
                    if frame is not None:
                        batch_slots.append(slot)
                        batch_frames.append(frame)

            if not batch_frames:
                time.sleep(0.01)
                continue

            # 2. Execute Batched Inference
            t_start = time.perf_counter()
            try:
                # Run YOLO on batch of frames simultaneously
                results = self.model(
                    batch_frames,
                    verbose=False,
                    conf=min(s.confidence_threshold for s in batch_slots),
                    imgsz=max(s.image_size for s in batch_slots),
                    device=self.device,
                    half=self.use_fp16
                )
                t_end = time.perf_counter()
                total_latency_ms = (t_end - t_start) * 1000.0
                per_camera_latency = total_latency_ms / max(1, len(batch_frames))

                # Update global latency tracking
                self.global_latency_history.append(per_camera_latency)
                self.global_total_inferred += len(batch_frames)

                # 3. Distribute results per camera
                for idx, slot in enumerate(batch_slots):
                    slot.record_inference(per_camera_latency)
                    frame = batch_frames[idx]
                    res = results[idx]
                    self._process_single_camera_result(slot, frame, res)

            except Exception as e:
                logger.error(f"Error during batched AI inference: {e}", exc_info=True)
                # Drop failed batch frames. Never retry stale frames indefinitely.
                for slot in batch_slots:
                    slot.last_error = str(e)
                time.sleep(0.05)

    def _process_single_camera_result(self, slot: CameraAiSlot, frame: np.ndarray, yolo_result):
        """
        Process detections, execute scoped tracking, associate PPE, and run state machine.
        """
        h, w = frame.shape[:2]
        person_detections = []
        ppe_items = []
        machinery_items = []
        all_detections_display = []

        people_count = 0
        phone_violations = 0
        ppe_violations = 0
        compliant_items = 0

        # Parse YOLO bounding boxes
        for box in yolo_result.boxes:
            cls_id = int(box.cls[0])
            conf = float(box.conf[0])
            cls_name = self.model.names.get(cls_id, "") if self.model else str(cls_id)
            xyxy = box.xyxy[0].cpu().numpy().tolist()

            norm_bbox = [
                round(xyxy[0] / w, 4),
                round(xyxy[1] / h, 4),
                round(xyxy[2] / w, 4),
                round(xyxy[3] / h, 4),
            ]

            # Categorize detected classes
            if cls_name.lower() == "person":
                people_count += 1
                person_detections.append({
                    "box": norm_bbox,
                    "confidence": conf
                })
                all_detections_display.append({
                    "type": "person",
                    "label": f"Person #{people_count}",
                    "confidence": round(conf, 2),
                    "bbox": norm_bbox,
                    "category": "OBJECT",
                    "severity": "NORMAL"
                })
            elif rule_registry.get_rule_for_class_name(cls_name) and rule_registry.get_rule_for_class_name(cls_name).get("category") == "VIOLATION":
                ppe_violations += 1
                rule_match = rule_registry.get_rule_for_class_name(cls_name)
                anom_type = rule_match["rule_id"] if rule_match else cls_name.upper().replace("-", "_")
                if anom_type == "PHONE_VIOLATION":
                    phone_violations += 1
                if anom_type not in slot.enabled_rules:
                    continue
                ppe_items.append({
                    "type": anom_type,
                    "class_id": cls_id,
                    "class_name": cls_name,
                    "box": norm_bbox,
                    "confidence": conf
                })
                all_detections_display.append({
                    "type": anom_type.lower(),
                    "label": cls_name,
                    "confidence": round(conf, 2),
                    "bbox": norm_bbox,
                    "category": "VIOLATION",
                    "severity": "HIGH"
                })
            elif cls_name in ["Hardhat", "Mask", "Safety Vest"]:
                compliant_items += 1
                all_detections_display.append({
                    "type": "compliant_ppe",
                    "label": cls_name,
                    "confidence": round(conf, 2),
                    "bbox": norm_bbox,
                    "category": "COMPLIANT",
                    "severity": "NORMAL"
                })
            elif cls_name.lower() in ["machinery", "vehicle"]:
                machinery_items.append({
                    "type": "MACHINERY_HAZARD",
                    "class_id": cls_id,
                    "class_name": cls_name,
                    "box": norm_bbox,
                    "confidence": conf
                })
                all_detections_display.append({
                    "type": cls_name.lower(),
                    "label": cls_name,
                    "confidence": round(conf, 2),
                    "bbox": norm_bbox,
                    "category": "OBJECT",
                    "severity": "NORMAL"
                })
            elif rule_registry.get_rule_for_class_name(cls_name) and rule_registry.get_rule_for_class_name(cls_name).get("rule_id") == "PHONE_VIOLATION":
                phone_violations += 1
                rule_match = rule_registry.get_rule_for_class_name(cls_name)
                ppe_items.append({"type": "PHONE_VIOLATION", "class_id": cls_id, "class_name": cls_name,
                                  "box": norm_bbox, "confidence": conf})
                if "PHONE_VIOLATION" not in slot.enabled_rules:
                    continue
                all_detections_display.append({
                    "type": "phone_violation",
                    "label": "Phone Violation",
                    "confidence": round(conf, 2),
                    "bbox": norm_bbox,
                    "category": "VIOLATION",
                    "severity": "HIGH"
                })

        # 1. Update Per-Camera Scoped Tracker
        tracker = multi_camera_tracker.get_tracker(slot.camera_id)
        active_tracks = tracker.update(person_detections)

        # 1b. Surveillance Identity Pipeline (Face Quality + ArcFace + Re-ID + Fusion)
        for trk in active_tracks:
            body_crop = reid_pipeline.extract_body_crop(frame, trk.box)
            face_crop = face_pipeline.extract_face_region(body_crop) if body_crop is not None else None

            face_match_id = None
            face_sim = 0.0
            face_quality = FaceQualityCategory.REJECTED
            face_q_score = 0.0

            if face_crop is not None:
                face_quality, face_q_score, face_emb, _ = face_pipeline.process_face(face_crop)
                if face_emb is not None:
                    face_match_id, face_sim, _ = face_pipeline.match_against_templates(
                        face_emb, identity_fusion.employee_face_templates
                    )

            reid_match_id = None
            reid_sim = 0.0
            if body_crop is not None:
                body_emb = reid_pipeline.compute_embedding(body_crop)
                reid_match_id, reid_sim, _ = reid_pipeline.match_against_templates(
                    body_emb, identity_fusion.employee_body_templates
                )

            # Fuse multi-modal signals
            id_state, emp_id, emp_name, id_conf = identity_fusion.fuse_and_identify(
                camera_id=slot.camera_id,
                track_id=trk.track_id,
                face_match_id=face_match_id,
                face_sim=face_sim,
                face_quality=face_quality,
                face_quality_score=face_q_score,
                reid_match_id=reid_match_id,
                reid_sim=reid_sim
            )

            trk.identity_state = id_state.value
            trk.employee_id = emp_id
            trk.employee_name = emp_name
            trk.identity_confidence = id_conf

            # If CONFIRMED employee observation, trigger attendance
            if id_state == IdentityState.CONFIRMED and emp_id:
                self._dispatch_attendance_observation(
                    employee_id=emp_id,
                    camera_id=slot.camera_id,
                    track_id=trk.track_id,
                    identity_confidence=id_conf,
                    face_confidence=face_sim if face_match_id else None,
                    body_reid_confidence=reid_sim if reid_match_id else None
                )

        # 2. PPE Spatial Association
        observations = multi_camera_tracker.associate_ppe_to_persons(
            camera_id=slot.camera_id,
            active_tracks=active_tracks,
            ppe_items=ppe_items,
            machinery_items=machinery_items
        )

        # Add person detection observations if required
        person_rule = rule_registry.rule_mappings.get("PERSON_DETECTED", {})
        for trk in active_tracks:
            if "PERSON_DETECTED" not in slot.enabled_rules or not person_rule.get("available"):
                continue
            observations.append({
                "track_id": trk.track_id,
                "camera_id": slot.camera_id,
                "anomaly_type": "PERSON_DETECTED",
                "model_class_id": person_rule.get("model_class_id"),
                "model_class_name": person_rule.get("model_class_name", "Person"),
                "confidence": trk.confidence,
                "ppe_box": trk.box,
                "person_box": trk.box
            })

        # 3. Update Anomaly State Machine with Temporal Confirmation
        confirmed_events = state_machine.update_observations(
            camera_id=slot.camera_id,
            camera_name=slot.camera_name,
            zone=slot.zone,
            observations=observations,
            current_frame=frame,
            confirmation_frames=slot.confirmation_frames,
            cooldown_seconds=slot.cooldown_seconds
        )

        # 4. Asynchronously persist confirmed events to SQLite and broadcast WebSockets
        if confirmed_events:
            for evt in confirmed_events:
                self._dispatch_confirmed_event(evt)

        # Compute Compliance Score
        total_eval = ppe_violations + compliant_items
        if total_eval == 0:
            compliance_score = 100 if ppe_violations == 0 else 0
        else:
            compliance_score = max(0, int((compliant_items / total_eval) * 100))

        # Update Slot Cache
        slot.latest_state = {
            "cameraId": slot.camera_id,
            "cameraCode": slot.camera_name,
            "peopleCount": len(active_tracks),
            "phoneViolations": phone_violations,
            "ppeViolations": ppe_violations,
            "complianceScore": compliance_score,
            "detections": all_detections_display,
            "anomalies": confirmed_events if confirmed_events else slot.latest_state.get("anomalies", []),
            "lastAnalyzed": datetime.now(timezone.utc).isoformat()
        }

        # Broadcast real-time AI bounding box updates to live view listeners
        self._dispatch_ai_update(slot.latest_state)

    def _dispatch_ai_update(self, ai_state: Dict[str, Any]):
        """
        Broadcasts real-time AI bounding boxes and state to WebSocket clients.
        """
        try:
            loop = self.main_loop
            if not loop or not loop.is_running():
                try:
                    loop = asyncio.get_event_loop()
                except Exception:
                    loop = None
            if loop and loop.is_running():
                asyncio.run_coroutine_threadsafe(
                    ws_manager.broadcast("CAMERA_AI_UPDATE", ai_state), loop
                )
        except Exception as e:
            logger.debug(f"AI update dispatch notice: {e}")

    def _dispatch_confirmed_event(self, event_data: Dict[str, Any]):
        """
        Schedules SQLite persistence and WebSocket broadcasting on async loop.
        """
        try:
            loop = self.main_loop
            if not loop or not loop.is_running():
                try:
                    loop = asyncio.get_event_loop()
                except Exception:
                    loop = None
            if loop and loop.is_running():
                asyncio.run_coroutine_threadsafe(
                    state_machine.persist_confirmed_event(event_data), loop
                )
                asyncio.run_coroutine_threadsafe(
                    ws_manager.broadcast("CAMERA_ANOMALY_ALERT", event_data), loop
                )
        except Exception as e:
            logger.debug(f"Event dispatch thread notice: {e}")

    def _dispatch_attendance_observation(
        self,
        employee_id: str,
        camera_id: str,
        track_id: Optional[int],
        identity_confidence: float,
        face_confidence: Optional[float] = None,
        body_reid_confidence: Optional[float] = None
    ):
        """
        Dispatches confirmed employee observation to attendance service asynchronously.
        """
        try:
            loop = self.main_loop
            if not loop or not loop.is_running():
                try:
                    loop = asyncio.get_event_loop()
                except Exception:
                    loop = None
            if loop and loop.is_running():
                asyncio.run_coroutine_threadsafe(
                    attendance_service.record_confirmed_observation(
                        employee_id=employee_id,
                        camera_id=camera_id,
                        track_id=track_id,
                        identity_confidence=identity_confidence,
                        face_confidence=face_confidence,
                        body_reid_confidence=body_reid_confidence
                    ),
                    loop
                )
        except Exception as e:
            logger.debug(f"Attendance dispatch notice: {e}")

    def get_aggregate_metrics(self) -> Dict[str, Any]:
        """
        Exposes full system performance statistics including CPU, RAM, GPU, and FPS.
        """
        total_requested_fps = sum(s.target_fps for s in self.slots.values() if s.enabled and s.status == "ONLINE")
        total_actual_fps = round(sum(s.actual_fps for s in self.slots.values() if s.enabled and s.status == "ONLINE"), 1)

        # Latency statistics
        latencies = list(self.global_latency_history)
        avg_lat = round(sum(latencies) / max(1, len(latencies)), 1) if latencies else 0.0
        p50_lat = round(np.percentile(latencies, 50), 1) if latencies else 0.0
        p95_lat = round(np.percentile(latencies, 95), 1) if latencies else 0.0

        # System resource usage
        cpu_usage = psutil.cpu_percent()
        ram = psutil.virtual_memory()
        ram_used_mb = round(ram.used / (1024 * 1024), 1)
        ram_total_mb = round(ram.total / (1024 * 1024), 1)

        # GPU metrics if CUDA available
        gpu_util = None
        gpu_mem_used_mb = 0.0
        gpu_mem_total_mb = 0.0
        try:
            import torch
            if torch.cuda.is_available():
                gpu_mem_used_mb = round(torch.cuda.memory_allocated() / (1024 * 1024), 1)
                gpu_mem_total_mb = round(torch.cuda.get_device_properties(0).total_memory / (1024 * 1024), 1)
                # PyTorch exposes memory, not utilization. Query local NVIDIA driver.
                raw = subprocess.check_output(
                    ["nvidia-smi", "--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"],
                    text=True, timeout=1.0
                ).strip().splitlines()
                if raw:
                    gpu_util = float(raw[0].strip())
        except Exception:
            pass

        return {
            "model": {
                "name": Path(settings.AI_MODEL_PATH).name,
                "loaded": self.model_loaded,
                "device": self.device,
                "fp16": self.use_fp16,
                "error": self.model_load_error
            },
            "cameras": {
                "configured": len(self.slots),
                "online": sum(1 for s in self.slots.values() if s.status == "ONLINE"),
                "ai_enabled": sum(1 for s in self.slots.values() if s.enabled),
                "ai_running": sum(1 for s in self.slots.values() if s.enabled and s.status == "ONLINE")
            },
            "performance": {
                "target_total_fps": total_requested_fps,
                "actual_total_fps": total_actual_fps,
                "average_latency_ms": avg_lat,
                "p50_latency_ms": p50_lat,
                "p95_latency_ms": p95_lat,
                "total_frames_inferred": self.global_total_inferred,
                "dropped_frames": sum(s.reader.frames_dropped if s.reader else 0 for s in self.slots.values()),
                "cpu_utilization_percent": cpu_usage,
                "ram_usage_mb": ram_used_mb,
                "ram_total_mb": ram_total_mb,
                "ram_utilization_percent": ram.percent,
                "gpu_utilization_percent": gpu_util,
                "gpu_memory_used_mb": gpu_mem_used_mb,
                "gpu_memory_total_mb": gpu_mem_total_mb
            },
            "per_camera": {
                s.camera_id: s.get_metrics() for s in self.slots.values()
            }
        }

scheduler = FairMultiCameraScheduler()
