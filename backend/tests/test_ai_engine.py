import pytest
import numpy as np
from app.ai_engine import ai_engine
from app.ai_scheduler import scheduler

def test_ai_engine_model_loading_and_classes():
    """Verify shared PPE model loads with expected classes."""
    success = scheduler.load_model()
    assert success is True, "Scheduler must successfully load model"
    assert scheduler.model is not None, "PPE model must be loaded"

    # Check PPE model has expected classes
    ppe_classes = list(scheduler.model.names.values())
    assert "NO-Hardhat" in ppe_classes
    assert "NO-Safety Vest" in ppe_classes
    assert "NO-Mask" in ppe_classes
    assert "Hardhat" in ppe_classes
    assert "Person" in ppe_classes

def test_ai_engine_frame_inference():
    """Verify inference pass on sample image via ai_engine."""
    test_frame = np.zeros((360, 640, 3), dtype=np.uint8)
    cam_id = "test-cam-ai-001"
    cam_code = "CAM-TEST"

    # Register slot in scheduler
    scheduler.register_camera(cam_id, cam_code, "Zone Test", "rtsp://localhost:8554/test", target_fps=5)
    slot = scheduler.slots[cam_id]

    results = scheduler.model(test_frame, verbose=False, device=scheduler.device, half=scheduler.use_fp16)
    scheduler._process_single_camera_result(slot, test_frame, results[0])

    state = ai_engine.get_camera_ai_state(cam_id)
    assert state["cameraId"] == cam_id
    assert "peopleCount" in state
    assert "complianceScore" in state
    assert "anomalies" in state
    assert isinstance(state["anomalies"], list)

def test_ai_engine_metrics():
    """Verify aggregated metrics reporting."""
    metrics = scheduler.get_aggregate_metrics()
    assert "model" in metrics
    assert "cameras" in metrics
    assert "performance" in metrics
    assert "cpu_utilization_percent" in metrics["performance"]
    assert "ram_usage_mb" in metrics["performance"]
