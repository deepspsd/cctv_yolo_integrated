import logging
from typing import Dict, List, Optional, Tuple, Any
from enum import Enum
from collections import deque, Counter
from datetime import datetime, timezone

from app.config import settings
from app.face_pipeline import FaceQualityCategory

logger = logging.getLogger("identity_fusion")

class IdentityState(str, Enum):
    UNKNOWN = "UNKNOWN"
    CANDIDATE = "CANDIDATE"
    CONFIRMED = "CONFIRMED"


class TrackIdentitySession:
    """
    Maintains temporal identity evidence and state for a single track:
    (camera_id, track_id)
    """
    def __init__(self, camera_id: str, track_id: int):
        self.camera_id = camera_id
        self.track_id = track_id
        self.state = IdentityState.UNKNOWN
        self.confirmed_employee_id: Optional[str] = None
        self.confirmed_employee_name: Optional[str] = None
        self.confidence: float = 0.0
        self.first_seen_at = datetime.now(timezone.utc)
        self.last_seen_at = datetime.now(timezone.utc)

        # Multi-frame observation history (up to last 15 frames)
        self.observations: deque = deque(maxlen=15)
        self.candidate_hits = 0
        self.current_candidate_id: Optional[str] = None

    def add_observation(
        self,
        candidate_emp_id: Optional[str],
        candidate_name: Optional[str],
        fused_score: float,
        face_quality: FaceQualityCategory,
        face_score: float,
        reid_score: float
    ):
        self.last_seen_at = datetime.now(timezone.utc)
        self.observations.append({
            "emp_id": candidate_emp_id,
            "name": candidate_name,
            "score": fused_score,
            "face_quality": face_quality,
            "face_score": face_score,
            "reid_score": reid_score,
            "timestamp": self.last_seen_at
        })

        if candidate_emp_id is None or fused_score < settings.IDENTITY_MATCH_THRESHOLD:
            # Uncertain / Unknown frame
            self.candidate_hits = max(0, self.candidate_hits - 1)
            if self.state == IdentityState.CANDIDATE and self.candidate_hits == 0:
                self.state = IdentityState.UNKNOWN
                self.current_candidate_id = None
            return

        # Candidate match detected
        if self.current_candidate_id == candidate_emp_id:
            self.candidate_hits += 1
        else:
            self.current_candidate_id = candidate_emp_id
            self.candidate_hits = 1
            if self.state != IdentityState.CONFIRMED:
                self.state = IdentityState.CANDIDATE

        # Temporal confirmation gate (e.g. 3 consecutive / majority hits)
        if self.candidate_hits >= settings.IDENTITY_CONFIRMATION_FRAMES:
            self.state = IdentityState.CONFIRMED
            self.confirmed_employee_id = candidate_emp_id
            self.confirmed_employee_name = candidate_name
            self.confidence = round(fused_score, 3)


class IdentityFusionEngine:
    """
    Identity Fusion Layer.
    Fuses Face evidence + Body Re-ID evidence + Temporal Track Smoothing.
    Prevents false identity assignments by defaulting to UNKNOWN when uncertain.
    """
    def __init__(self):
        # Key: (camera_id, track_id)
        self._sessions: Dict[Tuple[str, int], TrackIdentitySession] = {}
        # In-memory template cache for fast inference
        self.employee_face_templates: Dict[str, List[Dict[str, Any]]] = {}
        self.employee_body_templates: Dict[str, List[Dict[str, Any]]] = {}
        self.employee_metadata: Dict[str, Dict[str, Any]] = {}

    def set_employee_templates(
        self,
        face_templates: Dict[str, List[Dict[str, Any]]],
        body_templates: Dict[str, List[Dict[str, Any]]],
        employees: Dict[str, Dict[str, Any]]
    ):
        self.employee_face_templates = face_templates
        self.employee_body_templates = body_templates
        self.employee_metadata = employees

    def get_or_create_session(self, camera_id: str, track_id: int) -> TrackIdentitySession:
        key = (camera_id, track_id)
        if key not in self._sessions:
            self._sessions[key] = TrackIdentitySession(camera_id, track_id)
        return self._sessions[key]

    def remove_stale_sessions(self, active_track_ids_by_camera: Dict[str, List[int]]):
        for key in list(self._sessions.keys()):
            cam_id, trk_id = key
            active_ids = active_track_ids_by_camera.get(cam_id, [])
            if trk_id not in active_ids:
                del self._sessions[key]

    def fuse_and_identify(
        self,
        camera_id: str,
        track_id: int,
        face_match_id: Optional[str],
        face_sim: float,
        face_quality: FaceQualityCategory,
        face_quality_score: float,
        reid_match_id: Optional[str],
        reid_sim: float
    ) -> Tuple[IdentityState, Optional[str], Optional[str], float]:
        """
        Calculates multi-modal similarity, updates track session, and returns:
            (identity_state, employee_id, employee_name, confidence)
        """
        session = self.get_or_create_session(camera_id, track_id)

        # 1. Compute dynamic weights based on face quality
        if face_quality == FaceQualityCategory.HIGH:
            face_weight = 0.75
            reid_weight = 0.25
        elif face_quality == FaceQualityCategory.MEDIUM:
            face_weight = 0.60
            reid_weight = 0.40
        elif face_quality == FaceQualityCategory.LOW:
            face_weight = 0.35
            reid_weight = 0.65
        else:  # REJECTED or face absent
            face_weight = 0.0
            reid_weight = 1.0

        # Validate inputs independently
        valid_face = (
            face_match_id is not None
            and face_sim >= settings.IDENTITY_MATCH_THRESHOLD
            and face_quality in (FaceQualityCategory.HIGH, FaceQualityCategory.MEDIUM, FaceQualityCategory.LOW)
        )
        valid_reid = (
            reid_match_id is not None
            and reid_sim >= settings.IDENTITY_REID_THRESHOLD
        )

        # 2. Multi-modal candidate consensus
        fused_emp_id = None
        fused_score = 0.0

        if valid_face and valid_reid and face_match_id == reid_match_id:
            # Both signals independently confident on same employee -> synergy
            fused_emp_id = face_match_id
            fused_score = (face_sim * face_weight) + (reid_sim * reid_weight)
            fused_score = min(1.0, fused_score * 1.05)
        elif valid_face and face_quality in (FaceQualityCategory.HIGH, FaceQualityCategory.MEDIUM):
            # Primary face signal is high quality and confident
            fused_emp_id = face_match_id
            fused_score = face_sim * (0.85 + 0.15 * face_quality_score)
        elif valid_reid and reid_sim >= 0.82 and face_weight <= 0.4:
            # Secondary Re-ID signal strictly confident (overhead / low-face camera)
            fused_emp_id = reid_match_id
            fused_score = reid_sim * 0.90
        else:
            # Conflict or insufficient confidence -> strictly UNKNOWN
            fused_emp_id = None
            fused_score = 0.0

        emp_name = None
        if fused_emp_id and fused_emp_id in self.employee_metadata:
            emp_name = self.employee_metadata[fused_emp_id].get("name")

        # 3. Update temporal track session
        session.add_observation(
            candidate_emp_id=fused_emp_id,
            candidate_name=emp_name,
            fused_score=fused_score,
            face_quality=face_quality,
            face_score=face_sim,
            reid_score=reid_sim
        )

        # 4. Return confirmed or unknown identity
        if session.state == IdentityState.CONFIRMED:
            return (
                IdentityState.CONFIRMED,
                session.confirmed_employee_id,
                session.confirmed_employee_name,
                session.confidence
            )
        elif session.state == IdentityState.CANDIDATE:
            return (
                IdentityState.CANDIDATE,
                session.current_candidate_id,
                emp_name,
                round(fused_score, 3)
            )
        else:
            return (
                IdentityState.UNKNOWN,
                None,
                "Unidentified person",
                round(fused_score, 3)
            )

identity_fusion = IdentityFusionEngine()
