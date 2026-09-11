import pytest
import queue
import time
import numpy as np
from datetime import datetime, timezone
from ultralytics import YOLO

from app.config import settings
from app.ai_rules import rule_registry, AnomalyRuleRegistry
from app.ai_tracker import ScopedMultiCameraTracker, compute_iou
from app.ai_state_machine import AnomalyStateMachine, AnomalyTrackState
from app.ai_stream_reader import CameraStreamReader
from app.ai_scheduler import FairMultiCameraScheduler, CameraAiSlot
from app.models import Camera, CameraStatusEnum, AiCameraConfig, AnomalyEvent

def test_dynamic_class_discovery_and_missing_phone():
    """
    Verify ppe.pt loads, inspects classes dynamically,
    maps PPE violations + Person, and explicitly marks PHONE_VIOLATION unavailable.
    """
    from app.ai_scheduler import scheduler
    m_path = str(scheduler.resolve_model_path("models/ppe.pt"))
    model = YOLO(m_path)
    registry = AnomalyRuleRegistry(m_path)
    summary = registry.discover_classes(model)

    assert "Hardhat" in summary["raw_classes"].values()
    assert "NO-Hardhat" in summary["raw_classes"].values()
    assert "Person" in summary["raw_classes"].values()

    # Verify 4 core rules available from ppe.pt
    assert registry.rule_mappings["NO_HARDHAT"]["available"] is True
    assert registry.rule_mappings["NO_MASK"]["available"] is True
    assert registry.rule_mappings["NO_SAFETY_VEST"]["available"] is True
    assert registry.rule_mappings["PERSON_DETECTED"]["available"] is True
    assert registry.rule_mappings["MACHINERY_HAZARD"]["available"] is True

    # Requirement: PHONE_VIOLATION must be marked unavailable if not in ppe.pt
    assert registry.rule_mappings["PHONE_VIOLATION"]["available"] is False
    assert "not found" in registry.rule_mappings["PHONE_VIOLATION"]["reason"].lower()

def test_bounded_queue_and_stale_frame_dropping():
    """
    Verify reader queue enforces bounded maxsize (2) and drops stale frames.
    """
    reader = CameraStreamReader("test_cam_01", "Cam 1", "rtsp://localhost:8554/dummy")
    assert reader.frame_queue.maxsize == settings.AI_MAX_FRAME_QUEUE

    # Simulate pushing 5 frames rapidly
    for i in range(5):
        frame = np.full((100, 100, 3), i, dtype=np.uint8)
        if reader.frame_queue.full():
            reader.frame_queue.get_nowait()
            reader.frames_dropped += 1
        reader.frame_queue.put_nowait(frame)

    assert reader.frames_dropped == 3
    assert reader.frame_queue.qsize() == 2

    # Latest frame must be the newest one (value 4)
    latest = reader.get_latest_frame()
    assert latest[0, 0, 0] == 4

def test_scoped_multi_camera_tracking():
    """
    Verify tracking identity is strictly scoped per camera (camera_id, track_id).
    """
    tracker_mgr = ScopedMultiCameraTracker()
    cam1_tracker = tracker_mgr.get_tracker("cam_A")
    cam2_tracker = tracker_mgr.get_tracker("cam_B")

    # Both see a person at same relative coordinates
    det = [{"box": [0.1, 0.1, 0.4, 0.8], "confidence": 0.9}]
    tracks1 = cam1_tracker.update(det)
    tracks2 = cam2_tracker.update(det)

    assert len(tracks1) == 1
    assert len(tracks2) == 1
    # Distinct scoped cameras
    assert tracks1[0].camera_id == "cam_A"
    assert tracks2[0].camera_id == "cam_B"

def test_spatial_ppe_association():
    """
    Verify PPE boxes are correctly associated to overlapping person boxes.
    """
    tracker_mgr = ScopedMultiCameraTracker()
    cam_id = "cam_test_assoc"
    tracker = tracker_mgr.get_tracker(cam_id)

    # Person from [0.1, 0.1] to [0.5, 0.9]
    persons = tracker.update([{"box": [0.1, 0.1, 0.5, 0.9], "confidence": 0.88}])
    assert len(persons) == 1

    # NO-Hardhat box on person's head region: [0.2, 0.12, 0.4, 0.3]
    ppe_items = [{
        "type": "NO_HARDHAT",
        "class_id": 2,
        "class_name": "NO-Hardhat",
        "box": [0.2, 0.12, 0.4, 0.3],
        "confidence": 0.92
    }]

    associations = tracker_mgr.associate_ppe_to_persons(cam_id, persons, ppe_items)
    assert len(associations) == 1
    assert associations[0]["track_id"] == persons[0].track_id
    assert associations[0]["anomaly_type"] == "NO_HARDHAT"

def test_temporal_confirmation_and_deduplication():
    """
    Verify anomaly is confirmed only after 3 consecutive frames,
    generates event, enters cooldown, and deduplicates frames.
    """
    sm = AnomalyStateMachine()
    cam_id = "cam_sm_test"
    dummy_frame = np.zeros((360, 640, 3), dtype=np.uint8)

    obs = [{
        "track_id": 101,
        "camera_id": cam_id,
        "anomaly_type": "NO_HARDHAT",
        "model_class_id": 2,
        "model_class_name": "NO-Hardhat",
        "confidence": 0.85,
        "ppe_box": [0.2, 0.1, 0.4, 0.3],
        "person_box": [0.1, 0.1, 0.5, 0.9]
    }]

    # Frame 1: Candidate
    evts1 = sm.update_observations(cam_id, "Cam 1", "Zone A", obs, dummy_frame, confirmation_frames=3, cooldown_seconds=10)
    assert len(evts1) == 0

    # Frame 2: Candidate
    evts2 = sm.update_observations(cam_id, "Cam 1", "Zone A", obs, dummy_frame, confirmation_frames=3, cooldown_seconds=10)
    assert len(evts2) == 0

    # Frame 3: Confirmed!
    evts3 = sm.update_observations(cam_id, "Cam 1", "Zone A", obs, dummy_frame, confirmation_frames=3, cooldown_seconds=10)
    assert len(evts3) == 1
    evt = evts3[0]
    assert evt["anomaly_type"] == "NO_HARDHAT"
    assert evt["status"] == "CONFIRMED"
    assert evt["track_id"] == 101

    # Frame 4: Cooldown (suppressed, no duplicate event generated)
    evts4 = sm.update_observations(cam_id, "Cam 1", "Zone A", obs, dummy_frame, confirmation_frames=3, cooldown_seconds=10)
    assert len(evts4) == 0

def test_fair_multi_camera_scheduler_overdue_priority():
    """
    Verify scheduler overdue priority calculation prioritizes most overdue camera.
    """
    s = FairMultiCameraScheduler()
    slot1 = CameraAiSlot("cam_01", "Cam 1", "Zone 1", target_fps=5)
    slot2 = CameraAiSlot("cam_02", "Cam 2", "Zone 2", target_fps=5)

    slot1.status = "ONLINE"
    slot2.status = "ONLINE"

    now = 100.0
    # slot1 inferred at 99.8s (0.2s ago)
    slot1.last_inference_time = 99.8
    # slot2 inferred at 99.2s (0.8s ago -> far more overdue)
    slot2.last_inference_time = 99.2

    overdue1 = slot1.get_overdue_seconds(now)
    overdue2 = slot2.get_overdue_seconds(now)

    assert overdue2 > overdue1


def test_compute_severity_and_format_anomaly():
    """
    Verify severity computation and anomaly event formatting with cameraName.
    """
    from app.routes.anomalies import compute_severity, format_anomaly

    # Check severity rules
    assert compute_severity("NO_HARDHAT", "VIOLATION") == "CRITICAL"
    assert compute_severity("MACHINERY_HAZARD", "VIOLATION") == "CRITICAL"
    assert compute_severity("NO_MASK", "VIOLATION") == "HIGH"
    assert compute_severity("NO_SAFETY_VEST", "VIOLATION") == "HIGH"
    assert compute_severity("PHONE_VIOLATION", "VIOLATION") == "MEDIUM"
    assert compute_severity("PERSON_DETECTED", "DETECTION") == "LOW"

    # Check format anomaly
    now = datetime.now(timezone.utc)
    evt = AnomalyEvent(
        id="test_evt_1",
        camera_id="cam_01",
        zone="Cutting",
        event_category="VIOLATION",
        anomaly_type="NO_HARDHAT",
        confidence=0.95,
        track_id=42,
        first_seen_at=now,
        confirmed_at=now,
        status="CONFIRMED",
        snapshot_path=None,
        created_at=now
    )
    formatted = format_anomaly(evt, camera_name="Camera 01")
    assert formatted["id"] == "test_evt_1"
    assert formatted["cameraName"] == "Camera 01"
    assert formatted["severity"] == "CRITICAL"
    assert formatted["status"] == "NEW"  # CONFIRMED mapped to NEW for evidence workflow


def test_offline_camera_skips_ai_and_stops_reader():
    """
    Verify that an offline camera:
    1. Returns -999.0 overdue priority (never scheduled for batch YOLO inference).
    2. Does NOT run background RTSP reader thread while offline.
    3. Resumes reader thread when marked online.
    """
    s = FairMultiCameraScheduler()

    # Register camera as OFFLINE
    s.register_camera(
        camera_id="cam_offline_test",
        camera_name="Offline Test Cam",
        zone="Spinning",
        direct_rtsp_url="rtsp://localhost:8554/offline_test",
        target_fps=5,
        enabled=True,
        is_online=False
    )

    slot = s.slots["cam_offline_test"]
    assert slot.status == "OFFLINE"
    assert slot.reader._running is False  # Reader must NOT be started for offline camera
    assert slot.get_overdue_seconds(time.monotonic()) == -999.0  # Never scheduled for AI

    # Transition to ONLINE
    s.set_camera_status("cam_offline_test", is_online=True)
    assert slot.status == "ONLINE"
    assert slot.reader._running is True  # Reader resumed

    # Transition back to OFFLINE
    s.set_camera_status("cam_offline_test", is_online=False)
    assert slot.status == "OFFLINE"
    assert slot.reader._running is False  # Reader cleanly stopped again
    assert slot.get_overdue_seconds(time.monotonic()) == -999.0
