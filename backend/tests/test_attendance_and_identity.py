import pytest
import numpy as np
import cv2
from app.face_pipeline import face_pipeline, FaceQualityCategory, FaceQualityAssessor, SurveillanceArcFaceModel
from app.reid_pipeline import reid_pipeline, PersonReIdModel
from app.identity_fusion import identity_fusion, IdentityState
from app.attendance_service import attendance_service
from app.database import AsyncSessionLocal
from app.models import Employee, Attendance

def create_synthetic_face_image():
    # 120x120 synthetic clear face frame
    img = np.zeros((120, 120, 3), dtype=np.uint8)
    cv2.circle(img, (60, 60), 45, (200, 180, 160), -1)
    cv2.circle(img, (45, 50), 6, (40, 40, 40), -1)
    cv2.circle(img, (75, 50), 6, (40, 40, 40), -1)
    cv2.ellipse(img, (60, 80), (18, 8), 0, 0, 180, (50, 50, 180), 3)
    return img

def create_synthetic_body_image():
    # 240x120 synthetic full body frame
    img = np.zeros((240, 120, 3), dtype=np.uint8)
    cv2.circle(img, (60, 30), 20, (200, 180, 160), -1)
    cv2.rectangle(img, (35, 55), (85, 140), (220, 100, 50), -1)
    cv2.rectangle(img, (40, 140), (80, 230), (50, 50, 50), -1)
    return img

def test_face_pipeline_quality_filter():
    # Blurry/flat image check
    flat_img = np.ones((100, 100, 3), dtype=np.uint8) * 128
    cat, score, _ = FaceQualityAssessor.evaluate_face(flat_img)
    assert cat == FaceQualityCategory.REJECTED

    # Valid clear image check
    face_img = create_synthetic_face_image()
    valid_cat, valid_score, _ = FaceQualityAssessor.evaluate_face(face_img)
    assert valid_score >= 0.35
    assert valid_cat in (FaceQualityCategory.HIGH, FaceQualityCategory.MEDIUM, FaceQualityCategory.LOW)

def test_face_embedding_and_matching():
    face1 = create_synthetic_face_image()
    face2 = face1.copy()
    model = SurveillanceArcFaceModel(128)
    emb1 = model.compute_embedding(face1)
    emb2 = model.compute_embedding(face2)

    assert emb1 is not None and emb2 is not None
    assert len(emb1) == 128
    sim = model.compute_similarity(emb1, emb2)
    assert sim > 0.99

def test_reid_descriptor_and_matching():
    body1 = create_synthetic_body_image()
    body2 = body1.copy()
    model = PersonReIdModel(128)
    desc1 = model.compute_embedding(body1)
    desc2 = model.compute_embedding(body2)

    assert desc1 is not None and desc2 is not None
    assert len(desc1) == 128
    sim = model.compute_similarity(desc1, desc2)
    assert sim > 0.99

def test_identity_fusion_state_progression():
    identity_fusion.set_employee_templates(
        face_templates={},
        body_templates={},
        employees={"emp_001": {"name": "Worker John", "department": "Spinning"}}
    )

    # 1. Unknown state default
    state, emp_id, name, conf = identity_fusion.fuse_and_identify(
        camera_id="cam_001",
        track_id=101,
        face_match_id=None,
        face_sim=0.0,
        face_quality=FaceQualityCategory.REJECTED,
        face_quality_score=0.0,
        reid_match_id=None,
        reid_sim=0.0
    )
    assert state == IdentityState.UNKNOWN
    assert emp_id is None

    # 2. Sequential frame confirmations -> CANDIDATE -> CONFIRMED
    for _ in range(4):
        state, emp_id, name, conf = identity_fusion.fuse_and_identify(
            camera_id="cam_001",
            track_id=101,
            face_match_id="emp_001",
            face_sim=0.88,
            face_quality=FaceQualityCategory.HIGH,
            face_quality_score=0.90,
            reid_match_id="emp_001",
            reid_sim=0.80
        )
    assert state == IdentityState.CONFIRMED
    assert emp_id == "emp_001"
    assert name == "Worker John"

@pytest.mark.asyncio
async def test_attendance_service_record_and_export():
    from app.database import engine, Base
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    import uuid
    emp_suffix = uuid.uuid4().hex[:6]
    test_emp_id = f"test_emp_{emp_suffix}"
    test_emp_code = f"TST-{emp_suffix}"

    async with AsyncSessionLocal() as db:
        # Create test employee
        emp = Employee(
            id=test_emp_id,
            employee_code=test_emp_code,
            name=f"Attendance Test {emp_suffix}",
            department="Spinning",
            role="Technician",
            active=True
        )
        db.add(emp)
        await db.commit()

        # Export CSV
        csv_str = await attendance_service.export_attendance_csv()
        assert "Employee Code" in csv_str

        # Export XLSX
        xlsx_bytes = await attendance_service.export_attendance_xlsx()
        assert len(xlsx_bytes) > 1000

        # Clean up
        await db.delete(emp)
        await db.commit()
