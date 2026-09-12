import os
import uuid
import time
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Tuple, Optional, Any, List

import cv2
import numpy as np
from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal
from app.models import AnomalyEvent, Camera

logger = logging.getLogger("ai_state_machine")

class AnomalyTrackState:
    NOT_PRESENT = "NOT_PRESENT"
    CANDIDATE = "CANDIDATE"
    CONFIRMED = "CONFIRMED"
    COOLDOWN = "COOLDOWN"
    ENDED = "ENDED"

class TrackAnomalyRecord:
    def __init__(self, camera_id: str, track_id: int, anomaly_type: str):
        self.camera_id = camera_id
        self.track_id = track_id
        self.anomaly_type = anomaly_type
        self.employee_id: Optional[str] = None
        self.employee_name: Optional[str] = None
        self.state = AnomalyTrackState.NOT_PRESENT
        self.consecutive_hits = 0
        self.consecutive_misses = 0
        self.first_seen_at = datetime.now(timezone.utc)
        self.confirmed_at: Optional[datetime] = None
        self.last_seen_at = datetime.now(timezone.utc)
        self.last_event_time = 0.0
        self.current_event_id: Optional[str] = None
        self.highest_conf = 0.0
        self.last_box: Optional[List[float]] = None
        self.person_box: Optional[List[float]] = None

class AnomalyStateMachine:
    """
    Temporal confirmation and deduplication state machine.
    Manages (camera_id, track_id, anomaly_type) lifecycle.
    Persists confirmed events to SQLite and captures evidence snapshots.
    """
    def __init__(self):
        # Key: (camera_id, track_id, anomaly_type)
        self._states: Dict[Tuple[str, int, str], TrackAnomalyRecord] = {}
        self.main_loop = None

    def update_observations(
        self,
        camera_id: str,
        camera_name: str,
        zone: str,
        observations: List[Dict[str, Any]],
        current_frame: Optional[np.ndarray],
        confirmation_frames: int = 3,
        cooldown_seconds: int = 10
    ) -> List[Dict[str, Any]]:
        """
        observations: list of dicts with:
          track_id, anomaly_type, model_class_id, model_class_name, confidence, ppe_box, person_box
        Returns list of newly CONFIRMED anomaly event dicts.
        """
        now_dt = datetime.now(timezone.utc)
        now_mono = time.monotonic()
        newly_confirmed_events = []

        # Group observations by (track_id, anomaly_type)
        seen_keys = set()
        for obs in observations:
            t_id = obs["track_id"]
            a_type = obs["anomaly_type"]

            # Person detection is for count tracking/bounding box, NEVER stored as anomaly event
            if a_type == "PERSON_DETECTED":
                continue

            key = (camera_id, t_id, a_type)
            seen_keys.add(key)

            if key not in self._states:
                rec = TrackAnomalyRecord(camera_id, t_id, a_type)
                rec.first_seen_at = now_dt
                self._states[key] = rec
            else:
                rec = self._states[key]

            rec.last_seen_at = now_dt
            rec.consecutive_hits += 1
            rec.consecutive_misses = 0
            rec.highest_conf = max(rec.highest_conf, obs.get("confidence", 0.0))
            rec.last_box = obs.get("ppe_box")
            rec.person_box = obs.get("person_box")
            if obs.get("employee_id"):
                rec.employee_id = obs["employee_id"]
            if obs.get("employee_name"):
                rec.employee_name = obs["employee_name"]

            # State transitions
            if rec.state == AnomalyTrackState.NOT_PRESENT:
                rec.state = AnomalyTrackState.CANDIDATE

            if rec.state == AnomalyTrackState.CANDIDATE:
                if rec.consecutive_hits >= confirmation_frames:
                    # Confirmed!
                    rec.state = AnomalyTrackState.CONFIRMED
                    rec.confirmed_at = now_dt
                    rec.last_event_time = now_mono
                    event_id = f"evt_{uuid.uuid4().hex[:12]}"
                    rec.current_event_id = event_id

                    # Derive named alert message
                    ppe_friendly_names = {
                        "NO_HARDHAT": "headcap / hardhat",
                        "NO_MASK": "protective mask",
                        "NO_SAFETY_VEST": "safety vest",
                        "PHONE_VIOLATION": "mobile phone in prohibited zone",
                        "MACHINERY_HAZARD": "heavy machinery safety boundary"
                    }
                    friendly_ppe = ppe_friendly_names.get(a_type, a_type.lower().replace("_", " "))
                    if rec.employee_name and rec.employee_name != "Unidentified person":
                        alert_message = f"{rec.employee_name} has not worn {friendly_ppe}"
                    else:
                        alert_message = f"Unidentified person has not worn {friendly_ppe}"

                    # Calculate severity
                    severity = "CRITICAL" if ("HARDHAT" in a_type or "HAZARD" in a_type) else ("HIGH" if ("MASK" in a_type or "VEST" in a_type) else "MEDIUM")

                    # Save evidence snapshot (Only for violations: NO_HARDHAT, NO_MASK, PHONE_VIOLATION, etc. Skip PERSON_DETECTED)
                    snapshot_path = None
                    encrypted_bytes = None
                    if current_frame is not None and a_type != "PERSON_DETECTED":
                        snapshot_path, encrypted_bytes = self._save_evidence_snapshot(
                            frame=current_frame,
                            camera_id=camera_id,
                            camera_name=camera_name,
                            zone=zone,
                            anomaly_type=a_type,
                            confidence=rec.highest_conf,
                            track_id=t_id,
                            event_id=event_id,
                            bbox=rec.last_box or rec.person_box,
                            employee_name=rec.employee_name
                        )

                    event_category = "DETECTION" if a_type == "PERSON_DETECTED" else "VIOLATION"

                    event_data = {
                        "id": event_id,
                        "camera_id": camera_id,
                        "cameraId": camera_id,
                        "camera_name": camera_name,
                        "cameraName": camera_name,
                        "zone": zone,
                        "event_category": event_category,
                        "eventCategory": event_category,
                        "anomaly_type": a_type,
                        "anomalyType": a_type,
                        "model_class_id": obs.get("model_class_id"),
                        "modelClassId": obs.get("model_class_id"),
                        "model_class_name": obs.get("model_class_name") or a_type,
                        "modelClassName": obs.get("model_class_name") or a_type,
                        "confidence": round(rec.highest_conf, 2),
                        "track_id": t_id,
                        "trackId": t_id,
                        "employee_id": rec.employee_id,
                        "employeeId": rec.employee_id,
                        "employee_name": rec.employee_name,
                        "employeeName": rec.employee_name,
                        "alert_message": alert_message,
                        "alertMessage": alert_message,
                        "severity": severity,
                        "first_seen_at": rec.first_seen_at.isoformat(),
                        "firstSeenAt": rec.first_seen_at.isoformat(),
                        "confirmed_at": rec.confirmed_at.isoformat(),
                        "confirmedAt": rec.confirmed_at.isoformat(),
                        "created_at": rec.confirmed_at.isoformat(),
                        "createdAt": rec.confirmed_at.isoformat(),
                        "status": "CONFIRMED",
                        "snapshot_path": snapshot_path,
                        "snapshotPath": snapshot_path,
                        "encrypted_image": encrypted_bytes,
                        "timestamp": rec.confirmed_at.isoformat()
                    }

                    newly_confirmed_events.append(event_data)
                    rec.state = AnomalyTrackState.COOLDOWN

            elif rec.state == AnomalyTrackState.COOLDOWN:
                # Still active, check if cooldown elapsed to allow renewal if needed
                if now_mono - rec.last_event_time > cooldown_seconds:
                    rec.state = AnomalyTrackState.CONFIRMED

        # Handle misses / ended anomalies for this camera
        for key, rec in list(self._states.items()):
            if key[0] != camera_id:
                continue
            if key not in seen_keys:
                rec.consecutive_misses += 1
                rec.consecutive_hits = 0

                # If missing for confirmation_frames, close the anomaly
                if rec.consecutive_misses >= confirmation_frames:
                    if rec.state in (AnomalyTrackState.CONFIRMED, AnomalyTrackState.COOLDOWN) and rec.current_event_id:
                        duration = (now_dt - rec.first_seen_at).total_seconds()
                        rec.state = AnomalyTrackState.ENDED
                        # Async update ended_at in DB
                        self._schedule_close_event(rec.current_event_id, now_dt, duration)
                    del self._states[key]

        return newly_confirmed_events

    def _save_evidence_snapshot(
        self,
        frame: np.ndarray,
        camera_id: str,
        camera_name: str,
        zone: str,
        anomaly_type: str,
        confidence: float,
        track_id: int,
        event_id: str,
        bbox: Optional[List[float]],
        employee_name: Optional[str] = None
    ) -> Tuple[str, Optional[bytes]]:
        """
        Save evidence frame to data/evidence/YYYY/MM/DD/<camera_id>/
        with bounding box and telemetry overlay, and encrypt JPEG bytes in memory.
        Returns: (snapshot_path, encrypted_image_bytes)
        """
        try:
            now = datetime.now()
            date_dir = Path(settings.AI_EVIDENCE_DIR) / now.strftime("%Y") / now.strftime("%m") / now.strftime("%d") / camera_id
            date_dir.mkdir(parents=True, exist_ok=True)

            filename = f"{now.strftime('%H-%M-%S')}_{anomaly_type}_{event_id}.jpg"
            full_path = date_dir / filename

            # Render overlay on copy
            annotated = frame.copy()
            h, w = annotated.shape[:2]

            # Bounding box
            if bbox and len(bbox) == 4:
                if max(bbox) <= 1.5:
                    x1 = int(bbox[0] * w)
                    y1 = int(bbox[1] * h)
                    x2 = int(bbox[2] * w) if bbox[2] > bbox[0] else int((bbox[0] + bbox[2]) * w)
                    y2 = int(bbox[3] * h) if bbox[3] > bbox[1] else int((bbox[1] + bbox[3]) * h)
                else:
                    x1, y1, x2, y2 = map(int, bbox)

                color = (0, 0, 255) if "NO_" in anomaly_type or "HAZARD" in anomaly_type else (0, 255, 0)
                cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
                
                person_label = employee_name if (employee_name and employee_name != "Unidentified person") else f"Track #{track_id}"
                tag = f"{anomaly_type} | {person_label} ({int(confidence*100)}%)"
                cv2.rectangle(annotated, (x1, max(0, y1 - 22)), (x1 + len(tag) * 9, y1), color, -1)
                cv2.putText(annotated, tag, (x1 + 2, max(15, y1 - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)

            # Telemetry banner
            person_text = f" | {employee_name}" if (employee_name and employee_name != "Unidentified person") else " | Unidentified"
            banner_text = f"CCTV PRIYA | {camera_name} ({zone}) | {anomaly_type}{person_text} | {now.strftime('%Y-%m-%d %H:%M:%S')}"
            cv2.rectangle(annotated, (0, 0), (w, 26), (0, 0, 0), -1)
            cv2.putText(annotated, banner_text, (8, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1)

            # Encode in-memory and encrypt with AES-256-GCM
            encrypted_bytes = None
            success, enc_buf = cv2.imencode('.jpg', annotated, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
            if success:
                try:
                    from app.security import encrypt_bytes
                    encrypted_bytes = encrypt_bytes(enc_buf.tobytes())
                except Exception as enc_err:
                    logger.error(f"Error encrypting evidence snapshot bytes: {enc_err}")

            cv2.imwrite(str(full_path), annotated, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
            return str(full_path).replace("\\", "/"), encrypted_bytes
        except Exception as e:
            logger.error(f"Error saving evidence snapshot: {e}")
            return "", None

    def _schedule_close_event(self, event_id: str, ended_at: datetime, duration: float):
        import asyncio
        try:
            loop = self.main_loop or asyncio.get_running_loop()
            loop.create_task(self._close_event_in_db(event_id, ended_at, duration))
        except Exception:
            pass

    async def _close_event_in_db(self, event_id: str, ended_at: datetime, duration: float):
        try:
            async with AsyncSessionLocal() as db:
                res = await db.execute(select(AnomalyEvent).where(AnomalyEvent.id == event_id))
                evt = res.scalar_one_or_none()
                if evt:
                    evt.ended_at = ended_at
                    evt.duration_seconds = round(duration, 2)
                    evt.status = "ENDED"
                    await db.commit()
        except Exception as e:
            logger.error(f"Error closing anomaly event in db: {e}")

    async def persist_confirmed_event(self, event_data: Dict[str, Any]):
        """
        Store confirmed anomaly event into SQLite database with user_id scoping and encrypted image.
        """
        if event_data.get("anomaly_type") == "PERSON_DETECTED":
            return

        try:
            async with AsyncSessionLocal() as db:
                cam_res = await db.execute(select(Camera.user_id).where(Camera.id == event_data["camera_id"]))
                cam_user_id = cam_res.scalar_one_or_none()

                evt = AnomalyEvent(
                    id=event_data["id"],
                    camera_id=event_data["camera_id"],
                    user_id=cam_user_id,
                    zone=event_data.get("zone", "General"),
                    event_category=event_data.get("event_category", "VIOLATION"),
                    anomaly_type=event_data["anomaly_type"],
                    model_class_id=event_data.get("model_class_id"),
                    model_class_name=event_data.get("model_class_name"),
                    confidence=event_data.get("confidence", 0.0),
                    track_id=event_data.get("track_id"),
                    employee_id=event_data.get("employee_id"),
                    severity=event_data.get("severity", "HIGH"),
                    first_seen_at=datetime.fromisoformat(event_data["first_seen_at"]),
                    confirmed_at=datetime.fromisoformat(event_data["confirmed_at"]),
                    status="CONFIRMED",
                    snapshot_path=event_data.get("snapshot_path"),
                    encrypted_image=event_data.get("encrypted_image"),
                    created_at=datetime.now(timezone.utc)
                )
                db.add(evt)
                await db.commit()
                logger.info(f"Persisted anomaly event {evt.id} ({evt.anomaly_type}) with encrypted image for user {cam_user_id} camera {evt.camera_id}")
        except Exception as e:
            logger.error(f"Error persisting anomaly event: {e}", exc_info=True)

state_machine = AnomalyStateMachine()
