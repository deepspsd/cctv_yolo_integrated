import base64
import json
import uuid
import logging
from typing import List, Optional
from datetime import datetime, timezone

import cv2
import numpy as np
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, desc

from app.database import get_db
from app.models import Employee, FaceTemplate, BodyTemplate, User
from app.dependencies import get_current_user, require_admin
from app.schemas import (
    EmployeeCreate, EmployeeUpdate, EmployeeResponse,
    FaceEnrollmentRequest, BodyEnrollmentRequest, TemplateMetadataResponse
)
from app.face_pipeline import face_pipeline, FaceQualityCategory
from app.reid_pipeline import reid_pipeline
from app.attendance_service import attendance_service

logger = logging.getLogger("routes.employees")

router = APIRouter(
    prefix="/employees",
    tags=["Employees & Biometrics"],
    dependencies=[Depends(get_current_user)],
)

def decode_b64_image(b64_str: str) -> Optional[np.ndarray]:
    try:
        if "," in b64_str:
            b64_str = b64_str.split(",", 1)[1]
        raw = base64.b64decode(b64_str)
        nparr = np.frombuffer(raw, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        return img
    except Exception as e:
        logger.error(f"Error decoding base64 image: {e}")
        return None

@router.get("", response_model=List[EmployeeResponse])
async def list_employees(
    search: Optional[str] = None,
    department: Optional[str] = None,
    active_only: bool = Query(True, alias="activeOnly"),
    db: AsyncSession = Depends(get_db)
):
    query = select(Employee)
    if active_only:
        query = query.where(Employee.active == True)
    if department and department.upper() != "ALL":
        query = query.where(Employee.department == department)
    if search and search.strip():
        term = f"%{search.strip()}%"
        query = query.where(
            or_(
                Employee.name.ilike(term),
                Employee.employee_code.ilike(term),
                Employee.department.ilike(term)
            )
        )

    query = query.order_by(Employee.name)
    res = await db.execute(query)
    employees = res.scalars().all()

    # Aggregate template counts
    out = []
    for emp in employees:
        count_res = await db.execute(
            select(func.count(FaceTemplate.id)).where(FaceTemplate.employee_id == emp.id)
        )
        t_count = count_res.scalar() or 0

        out.append({
            "id": emp.id,
            "employeeCode": emp.employee_code,
            "name": emp.name,
            "department": emp.department,
            "role": emp.role,
            "active": emp.active,
            "createdAt": emp.created_at.isoformat(),
            "updatedAt": emp.updated_at.isoformat(),
            "templateCount": t_count
        })
    return out

@router.post("", response_model=EmployeeResponse, status_code=status.HTTP_201_CREATED)
async def create_employee(
    payload: EmployeeCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin)
):
    # Verify uniqueness of employee_code
    existing = await db.execute(select(Employee).where(Employee.employee_code == payload.employee_code.strip()))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Employee with code '{payload.employee_code}' already exists."
        )

    emp_id = f"emp_{uuid.uuid4().hex[:10]}"
    now = datetime.now(timezone.utc)
    emp = Employee(
        id=emp_id,
        employee_code=payload.employee_code.strip().upper(),
        name=payload.name.strip(),
        department=payload.department.strip(),
        role=payload.role.strip(),
        active=payload.active,
        created_at=now,
        updated_at=now
    )
    db.add(emp)
    await db.commit()
    await db.refresh(emp)

    # Refresh in-memory templates cache
    await attendance_service.reload_templates_cache()

    return {
        "id": emp.id,
        "employeeCode": emp.employee_code,
        "name": emp.name,
        "department": emp.department,
        "role": emp.role,
        "active": emp.active,
        "createdAt": emp.created_at.isoformat(),
        "updatedAt": emp.updated_at.isoformat(),
        "templateCount": 0
    }

@router.get("/{id}", response_model=EmployeeResponse)
async def get_employee(
    id: str,
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(Employee).where(Employee.id == id))
    emp = res.scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")

    count_res = await db.execute(
        select(func.count(FaceTemplate.id)).where(FaceTemplate.employee_id == emp.id)
    )
    t_count = count_res.scalar() or 0

    return {
        "id": emp.id,
        "employeeCode": emp.employee_code,
        "name": emp.name,
        "department": emp.department,
        "role": emp.role,
        "active": emp.active,
        "createdAt": emp.created_at.isoformat(),
        "updatedAt": emp.updated_at.isoformat(),
        "templateCount": t_count
    }

@router.put("/{id}", response_model=EmployeeResponse)
async def update_employee(
    id: str,
    payload: EmployeeUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin)
):
    res = await db.execute(select(Employee).where(Employee.id == id))
    emp = res.scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")

    if payload.name is not None: emp.name = payload.name.strip()
    if payload.department is not None: emp.department = payload.department.strip()
    if payload.role is not None: emp.role = payload.role.strip()
    if payload.active is not None: emp.active = payload.active

    emp.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(emp)

    await attendance_service.reload_templates_cache()

    count_res = await db.execute(
        select(func.count(FaceTemplate.id)).where(FaceTemplate.employee_id == emp.id)
    )
    t_count = count_res.scalar() or 0

    return {
        "id": emp.id,
        "employeeCode": emp.employee_code,
        "name": emp.name,
        "department": emp.department,
        "role": emp.role,
        "active": emp.active,
        "createdAt": emp.created_at.isoformat(),
        "updatedAt": emp.updated_at.isoformat(),
        "templateCount": t_count
    }

@router.delete("/{id}")
async def delete_employee(
    id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin)
):
    res = await db.execute(select(Employee).where(Employee.id == id))
    emp = res.scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")

    await db.delete(emp)
    await db.commit()
    await attendance_service.reload_templates_cache()
    return {"success": True, "message": f"Employee {emp.name} ({emp.employee_code}) deleted."}

@router.post("/{id}/face-enrollment")
async def enroll_employee_face(
    id: str,
    payload: FaceEnrollmentRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin)
):
    """
    Enrolls a multi-angle or CCTV-verified face template for an employee.
    Enforces quality filtering (rejects blurry/low-res inputs).
    """
    res = await db.execute(select(Employee).where(Employee.id == id))
    emp = res.scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")

    img = decode_b64_image(payload.image_base64)
    if img is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid image encoding.")

    # Check if face or full-body provided
    h, w = img.shape[:2]
    face_crop = img
    if h > 200 and w > 100:
        extracted = face_pipeline.extract_face_region(img)
        if extracted is not None and extracted.size > 0:
            face_crop = extracted

    # Quality filter evaluation
    category, q_score, embedding, details = face_pipeline.process_face(face_crop)
    if category == FaceQualityCategory.REJECTED:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Face template rejected due to poor quality. Reason: {details.get('reason', 'Blurry or small image')}. Details: {details}"
        )

    # Save template
    t_id = f"face_{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc)
    emb_json = json.dumps(embedding.tolist())
    fh, fw = face_crop.shape[:2]

    template = FaceTemplate(
        id=t_id,
        employee_id=emp.id,
        embedding=emb_json,
        embedding_model="arcface",
        quality_score=q_score,
        source=payload.source,
        camera_id=payload.camera_id,
        pose=payload.pose,
        resolution=f"{fw}x{fh}",
        created_at=now
    )
    db.add(template)
    await db.commit()

    # Reload fusion cache
    await attendance_service.reload_templates_cache()

    logger.info(f"Enrolled {payload.pose} face template for {emp.name} ({category.value}, score: {q_score})")
    return {
        "success": True,
        "templateId": t_id,
        "employeeId": emp.id,
        "pose": payload.pose,
        "qualityCategory": category.value,
        "qualityScore": q_score,
        "resolution": f"{fw}x{fh}",
        "details": details
    }

@router.post("/{id}/body-enrollment")
async def enroll_employee_body(
    id: str,
    payload: BodyEnrollmentRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin)
):
    """
    Enrolls a full-body person Re-ID template for an employee.
    """
    res = await db.execute(select(Employee).where(Employee.id == id))
    emp = res.scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")

    img = decode_b64_image(payload.image_base64)
    if img is None or img.shape[0] < 40 or img.shape[1] < 20:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid body image (too small or corrupt).")

    embedding = reid_pipeline.compute_embedding(img)
    t_id = f"body_{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc)

    template = BodyTemplate(
        id=t_id,
        employee_id=emp.id,
        embedding=json.dumps(embedding.tolist()),
        model_name="fastreid",
        quality_score=1.0,
        camera_id=payload.camera_id,
        source=payload.source,
        created_at=now
    )
    db.add(template)
    await db.commit()

    await attendance_service.reload_templates_cache()

    return {
        "success": True,
        "templateId": t_id,
        "employeeId": emp.id,
        "source": payload.source
    }

@router.get("/{id}/templates", response_model=List[TemplateMetadataResponse])
async def list_employee_templates(
    id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Returns registered template metadata (angles, quality, source).
    Never exposes raw biometric vector data.
    """
    f_res = await db.execute(select(FaceTemplate).where(FaceTemplate.employee_id == id).order_by(desc(FaceTemplate.created_at)))
    faces = f_res.scalars().all()

    b_res = await db.execute(select(BodyTemplate).where(BodyTemplate.employee_id == id).order_by(desc(BodyTemplate.created_at)))
    bodies = b_res.scalars().all()

    out = []
    for f in faces:
        out.append({
            "id": f.id,
            "employeeId": f.employee_id,
            "type": "face",
            "pose": f.pose,
            "qualityScore": f.quality_score,
            "source": f.source,
            "cameraId": f.camera_id,
            "createdAt": f.created_at.isoformat()
        })
    for b in bodies:
        out.append({
            "id": b.id,
            "employeeId": b.employee_id,
            "type": "body",
            "pose": "body_reid",
            "qualityScore": b.quality_score,
            "source": b.source,
            "cameraId": b.camera_id,
            "createdAt": b.created_at.isoformat()
        })
    return out
