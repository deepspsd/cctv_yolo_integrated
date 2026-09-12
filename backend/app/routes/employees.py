import base64
import json
import uuid
import logging
from typing import List, Optional
from datetime import datetime, timezone

import cv2
import numpy as np
from fastapi import APIRouter, Depends, HTTPException, status, Query, Response, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, desc

from app.database import get_db
from app.models import Employee, FaceTemplate, BodyTemplate, User
from app.dependencies import get_current_user, require_admin, authenticate_request
from app.security import encrypt_bytes, decrypt_bytes
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

async def get_employee_response_dict(emp: Employee, db: AsyncSession) -> dict:
    faces_res = await db.execute(
        select(FaceTemplate).where(FaceTemplate.employee_id == emp.id)
    )
    faces = faces_res.scalars().all()

    bodies_res = await db.execute(
        select(BodyTemplate).where(BodyTemplate.employee_id == emp.id)
    )
    bodies = bodies_res.scalars().all()

    t_count = len(faces)
    b_count = len(bodies)

    has_photo = any(f.encrypted_image is not None for f in faces) or any(b.encrypted_image is not None for b in bodies) or (t_count > 0)
    avatar_url = f"/api/employees/{emp.id}/photo?pose=FRONTAL" if has_photo else None

    enrolled_angles = []
    face_poses = set((f.pose or "").strip().upper() for f in faces)
    if "FRONTAL" in face_poses:
        enrolled_angles.append("FRONTAL")
    if "LEFT_PROFILE" in face_poses or "LEFT" in face_poses:
        enrolled_angles.append("LEFT_PROFILE")
    if "RIGHT_PROFILE" in face_poses or "RIGHT" in face_poses:
        enrolled_angles.append("RIGHT_PROFILE")
    if b_count > 0:
        enrolled_angles.append("BODY")

    completeness_score = len(enrolled_angles)
    is_complete = (completeness_score == 4)

    return {
        "id": emp.id,
        "employeeCode": emp.employee_code,
        "name": emp.name,
        "department": emp.department,
        "role": emp.role,
        "active": emp.active,
        "createdAt": emp.created_at.isoformat(),
        "updatedAt": emp.updated_at.isoformat(),
        "templateCount": t_count,
        "bodyTemplatesCount": b_count,
        "hasPhoto": has_photo,
        "avatarUrl": avatar_url,
        "enrolledAngles": enrolled_angles,
        "completenessScore": completeness_score,
        "isComplete": is_complete
    }

@router.get("", response_model=List[EmployeeResponse])
async def list_employees(
    search: Optional[str] = None,
    department: Optional[str] = None,
    active_only: bool = Query(True, alias="activeOnly"),
    user: User = Depends(get_current_user),
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

    out = []
    for emp in employees:
        emp_dict = await get_employee_response_dict(emp, db)
        out.append(emp_dict)
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

    return await get_employee_response_dict(emp, db)

@router.get("/{id}", response_model=EmployeeResponse)
async def get_employee(
    id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(Employee).where(Employee.id == id))
    emp = res.scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")

    return await get_employee_response_dict(emp, db)

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

    return await get_employee_response_dict(emp, db)

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
    Enforces quality filtering and encrypts image into DB with AES-256-GCM.
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

    # Encode face_crop to JPEG and encrypt via AES-256-GCM
    ret, enc_buf = cv2.imencode(".jpg", face_crop, [int(cv2.IMWRITE_JPEG_QUALITY), 95])
    encrypted_bytes = None
    if ret:
        encrypted_bytes = encrypt_bytes(enc_buf.tobytes())

    # Save template
    t_id = f"face_{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc)
    emb_json = json.dumps(embedding.tolist())
    fh, fw = face_crop.shape[:2]
    pose_name = (payload.pose_angle or payload.pose or "FRONTAL").strip().upper()

    template = FaceTemplate(
        id=t_id,
        employee_id=emp.id,
        embedding=emb_json,
        embedding_model="arcface",
        quality_score=q_score,
        source=payload.source,
        camera_id=payload.camera_id,
        pose=pose_name,
        resolution=f"{fw}x{fh}",
        encrypted_image=encrypted_bytes,
        created_at=now
    )
    db.add(template)
    await db.commit()

    # Reload fusion cache
    await attendance_service.reload_templates_cache()

    logger.info(f"Enrolled & encrypted {pose_name} face template for {emp.name} ({category.value}, score: {q_score})")
    return {
        "success": True,
        "templateId": t_id,
        "employeeId": emp.id,
        "pose": pose_name,
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
    Enrolls a full-body person Re-ID template for an employee and encrypts into DB.
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

    # Encode body to JPEG and encrypt
    ret, enc_buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
    encrypted_bytes = None
    if ret:
        encrypted_bytes = encrypt_bytes(enc_buf.tobytes())

    template = BodyTemplate(
        id=t_id,
        employee_id=emp.id,
        embedding=json.dumps(embedding.tolist()),
        model_name="fastreid",
        quality_score=1.0,
        camera_id=payload.camera_id,
        source=payload.source,
        encrypted_image=encrypted_bytes,
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
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Returns registered template metadata (angles, quality, source).
    Never exposes raw biometric vector data or encrypted image blobs.
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

@router.get("/{id}/photo")
@router.get("/{id}/face-image")
async def get_employee_face_photo(
    id: str,
    request: Request,
    pose: Optional[str] = Query("FRONTAL"),
    token: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    """
    Stream decrypted face photo (defaults to FRONTAL view) for an employee directly from DB.
    Encrypted with AES-256-GCM to prevent data leaks.
    """
    req_user = None
    try:
        req_user = await authenticate_request(request, token_param=token, db=db)
    except Exception:
        pass

    emp_res = await db.execute(select(Employee).where(Employee.id == id))
    emp = emp_res.scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")

    pose_req = (pose or "FRONTAL").strip().upper()
    template = None

    if pose_req in ["BODY", "REID", "BODY_REID"]:
        q_body = (
            select(BodyTemplate)
            .where(
                BodyTemplate.employee_id == id,
                BodyTemplate.encrypted_image != None
            )
            .order_by(desc(BodyTemplate.created_at))
        )
        res_body = await db.execute(q_body)
        template = res_body.scalars().first()
    else:
        q_pose = (
            select(FaceTemplate)
            .where(
                FaceTemplate.employee_id == id,
                FaceTemplate.encrypted_image != None,
                FaceTemplate.pose.ilike(pose_req)
            )
            .order_by(FaceTemplate.quality_score.desc(), desc(FaceTemplate.created_at))
        )
        res = await db.execute(q_pose)
        template = res.scalars().first()

    if not template and pose_req not in ["BODY", "REID", "BODY_REID"]:
        q_any = (
            select(FaceTemplate)
            .where(
                FaceTemplate.employee_id == id,
                FaceTemplate.encrypted_image != None
            )
            .order_by(FaceTemplate.quality_score.desc(), desc(FaceTemplate.created_at))
        )
        res_any = await db.execute(q_any)
        template = res_any.scalars().first()

    if not template:
        q_body = (
            select(BodyTemplate)
            .where(
                BodyTemplate.employee_id == id,
                BodyTemplate.encrypted_image != None
            )
            .order_by(desc(BodyTemplate.created_at))
        )
        res_body = await db.execute(q_body)
        template = res_body.scalars().first()

    if not template or not template.encrypted_image:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No photo available for employee {emp.name}"
        )

    try:
        decrypted = decrypt_bytes(template.encrypted_image)
        if not decrypted:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Decryption failed")
        return Response(
            content=decrypted,
            media_type="image/jpeg",
            headers={
                "Cache-Control": "private, max-age=3600",
                "Content-Disposition": f"inline; filename=emp_{id}_{getattr(template, 'pose', 'photo')}.jpg"
            }
        )
    except Exception as e:
        logger.error(f"Failed to decrypt employee photo: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to decrypt image")
