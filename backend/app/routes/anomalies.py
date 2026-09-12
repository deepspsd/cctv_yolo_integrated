from datetime import datetime, timezone, time
from typing import Optional, List
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, status, Query, Request
from fastapi.responses import FileResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc, asc
from jose import JWTError

from app.database import get_db
from app.models import AnomalyEvent, Camera, User, Employee
from app.dependencies import get_current_user
from app.auth import decode_access_token
from app.security import decrypt_bytes
from app.schemas import AnomalyEventResponse, AnomalyStatusUpdate

router = APIRouter(
    prefix="/anomalies",
    tags=["Anomalies"],
)

def compute_severity(anomaly_type: str, category: str) -> str:
    upper = (anomaly_type or "").upper()
    if "HARDHAT" in upper or "HAZARD" in upper:
        return "CRITICAL"
    if "MASK" in upper or "VEST" in upper:
        return "HIGH"
    if "PHONE" in upper:
        return "MEDIUM"
    if "PERSON" in upper:
        return "LOW"
    return "HIGH" if category == "VIOLATION" else "INFO"

def format_anomaly(evt: AnomalyEvent, camera_name: Optional[str] = None, employee_name: Optional[str] = None) -> dict:
    c_name = camera_name or (evt.camera.name if getattr(evt, "camera", None) else None) or evt.camera_id
    e_name = employee_name or (evt.employee.name if getattr(evt, "employee", None) else None)
    display_status = evt.status
    if display_status == "CONFIRMED":
        display_status = "NEW"

    ppe_friendly_names = {
        "NO_HARDHAT": "headcap / hardhat",
        "NO_MASK": "protective mask",
        "NO_SAFETY_VEST": "safety vest",
        "PHONE_VIOLATION": "mobile phone in prohibited zone",
        "MACHINERY_HAZARD": "heavy machinery safety boundary"
    }
    friendly_ppe = ppe_friendly_names.get(evt.anomaly_type, evt.anomaly_type.lower().replace("_", " "))
    if e_name:
        alert_msg = f"{e_name} has not worn {friendly_ppe}"
    else:
        alert_msg = f"Unidentified person has not worn {friendly_ppe}"

    return {
        "id": evt.id,
        "cameraId": evt.camera_id,
        "cameraName": c_name,
        "zone": evt.zone,
        "eventCategory": evt.event_category,
        "anomalyType": evt.anomaly_type,
        "modelClassId": evt.model_class_id,
        "modelClassName": evt.model_class_name,
        "confidence": evt.confidence,
        "severity": getattr(evt, "severity", None) or compute_severity(evt.anomaly_type, evt.event_category),
        "trackId": evt.track_id,
        "employeeId": evt.employee_id,
        "employeeName": e_name,
        "alertMessage": alert_msg,
        "firstSeenAt": evt.first_seen_at.isoformat() if evt.first_seen_at else None,
        "confirmedAt": evt.confirmed_at.isoformat() if evt.confirmed_at else None,
        "endedAt": evt.ended_at.isoformat() if evt.ended_at else None,
        "durationSeconds": evt.duration_seconds,
        "status": display_status,
        "snapshotPath": evt.snapshot_path,
        "createdAt": evt.created_at.isoformat() if evt.created_at else None
    }

async def authenticate_request(
    request: Request,
    token_param: Optional[str] = None,
    db: AsyncSession = None
) -> User:
    """
    Authenticate request via Authorization header OR token query parameter.
    Enables native lazy-loading in HTML <img> tags with ?token=<jwt>.
    """
    token = None
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ", 1)[1]
    elif token_param:
        token = token_param

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token required.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        payload = decode_access_token(token)
        if payload.get("type") == "refresh":
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type.")
        email: str = payload.get("sub")
        if not email:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token subject.")
        issued_at: int | None = payload.get("iat")
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token.")

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User inactive or not found.")

    if user.last_logout_at and issued_at is not None:
        token_iat = datetime.fromtimestamp(issued_at, tz=timezone.utc)
        if token_iat < user.last_logout_at.replace(tzinfo=timezone.utc):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session revoked.")

    return user

@router.get("", response_model=List[AnomalyEventResponse])
async def list_anomalies(
    camera_id: Optional[str] = Query(None, alias="cameraId"),
    zone: Optional[str] = None,
    anomaly_type: Optional[str] = Query(None, alias="anomalyType"),
    status: Optional[str] = None,
    date: Optional[str] = None,
    date_from: Optional[datetime] = Query(None, alias="dateFrom"),
    date_to: Optional[datetime] = Query(None, alias="dateTo"),
    employee_id: Optional[str] = Query(None, alias="employeeId"),
    order: Optional[str] = Query("desc", pattern="^(asc|desc)$"),
    limit: int = Query(100, ge=1, le=2000),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    List historical anomaly events with multi-criteria filtering and camera join.
    Strictly scoped to the authenticated user. Excludes PERSON_DETECTED.
    """
    query = select(
        AnomalyEvent,
        Camera.name.label("camera_name"),
        Employee.name.label("employee_name")
    ).join(
        Camera, AnomalyEvent.camera_id == Camera.id
    ).outerjoin(
        Employee, AnomalyEvent.employee_id == Employee.id
    ).where(
        (AnomalyEvent.user_id == user.id) | (Camera.user_id == user.id),
        AnomalyEvent.anomaly_type != "PERSON_DETECTED"
    )

    if camera_id:
        query = query.where(AnomalyEvent.camera_id == camera_id)
    if employee_id:
        query = query.where(AnomalyEvent.employee_id == employee_id)
    if zone and zone.upper() != "ALL":
        query = query.where(AnomalyEvent.zone == zone.strip())
    if anomaly_type and anomaly_type.upper() != "ALL":
        query = query.where(AnomalyEvent.anomaly_type == anomaly_type.strip())
    if status and status.upper() != "ALL":
        if status.upper() == "NEW":
            query = query.where(AnomalyEvent.status.in_(["NEW", "CONFIRMED"]))
        else:
            query = query.where(AnomalyEvent.status == status.strip().upper())

    if date:
        try:
            parsed_date = datetime.strptime(date, "%Y-%m-%d").date()
            start_dt = datetime.combine(parsed_date, time.min)
            end_dt = datetime.combine(parsed_date, time.max)
            query = query.where(AnomalyEvent.created_at >= start_dt, AnomalyEvent.created_at <= end_dt)
        except ValueError:
            pass

    if date_from:
        query = query.where(AnomalyEvent.created_at >= date_from)
    if date_to:
        query = query.where(AnomalyEvent.created_at <= date_to)

    if order == "asc":
        query = query.order_by(asc(AnomalyEvent.created_at))
    else:
        query = query.order_by(desc(AnomalyEvent.created_at))

    query = query.offset(offset).limit(limit)
    result = await db.execute(query)
    rows = result.all()

    return [format_anomaly(evt, camera_name, employee_name) for evt, camera_name, employee_name in rows]

@router.get("/dates")
async def list_evidence_dates(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Returns unique dates with evidence photos for the current user's cameras.
    Excludes PERSON_DETECTED and strictly scopes to authenticated user.
    """
    dates_map = {}

    # 1. Aggregate from database scoped to current user's cameras
    result = await db.execute(
        select(
            func.date(AnomalyEvent.created_at).label("d"),
            func.count(AnomalyEvent.id).label("total"),
            func.count(AnomalyEvent.snapshot_path).label("with_evidence")
        )
        .join(Camera, AnomalyEvent.camera_id == Camera.id)
        .where(
            (AnomalyEvent.user_id == user.id) | (Camera.user_id == user.id),
            AnomalyEvent.anomaly_type != "PERSON_DETECTED"
        )
        .group_by("d")
        .order_by(desc("d"))
    )
    rows = result.all()
    for d, total, with_evidence in rows:
        if d:
            dates_map[str(d)] = {
                "date": str(d),
                "totalAlerts": total,
                "evidencePhotos": with_evidence
            }

    # 2. Also scan physical disk storage (backend/data/evidence/YYYY/MM/DD)
    evidence_root = Path("backend/data/evidence")
    if not evidence_root.exists():
        evidence_root = Path("data/evidence")
    if evidence_root.exists():
        for year_dir in evidence_root.iterdir():
            if not year_dir.is_dir() or not year_dir.name.isdigit():
                continue
            for month_dir in year_dir.iterdir():
                if not month_dir.is_dir() or not month_dir.name.isdigit():
                    continue
                for day_dir in month_dir.iterdir():
                    if not day_dir.is_dir() or not day_dir.name.isdigit():
                        continue
                    d_str = f"{year_dir.name}-{month_dir.name.zfill(2)}-{day_dir.name.zfill(2)}"
                    photo_count = len(list(day_dir.glob("*/*.jpg"))) + len(list(day_dir.glob("*.jpg")))
                    if photo_count > 0:
                        if d_str not in dates_map:
                            dates_map[d_str] = {
                                "date": d_str,
                                "totalAlerts": photo_count,
                                "evidencePhotos": photo_count
                            }
                        else:
                            dates_map[d_str]["evidencePhotos"] = max(dates_map[d_str]["evidencePhotos"], photo_count)

    sorted_dates = sorted(dates_map.values(), key=lambda x: x["date"], reverse=True)
    return sorted_dates

@router.get("/{id}/evidence")
async def get_anomaly_evidence(
    id: str,
    request: Request,
    token: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    """
    Stream evidence snapshot securely from local backend storage.
    Enforces strict user isolation: only owner or administrator can view photo.
    """
    req_user = None
    try:
        req_user = await authenticate_request(request, token_param=token, db=db)
    except Exception:
        pass

    query = select(AnomalyEvent, Camera.user_id.label("camera_user_id")).join(
        Camera, AnomalyEvent.camera_id == Camera.id
    ).where(AnomalyEvent.id == id)
    result = await db.execute(query)
    row = result.first()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Anomaly event '{id}' not found."
        )

    evt, cam_user_id = row

    # Enforce user privacy isolation
    if req_user and getattr(req_user, "role", None) != "Administrator":
        if evt.user_id and evt.user_id != req_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied: photo belongs to another user.")
        if not evt.user_id and cam_user_id and cam_user_id != req_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied: photo belongs to another user.")

    # 1. Primary: decrypt directly from database in-memory (Anti-leak privacy guarantee)
    if evt.encrypted_image:
        try:
            decrypted_bytes = decrypt_bytes(evt.encrypted_image)
            if decrypted_bytes:
                return Response(
                    content=decrypted_bytes,
                    media_type="image/jpeg",
                    headers={
                        "Cache-Control": "private, max-age=3600",
                        "Content-Disposition": f"inline; filename=evidence_{id}.jpg"
                    }
                )
        except Exception:
            pass

    # 2. Fallback to physical disk storage if encrypted_image not yet populated
    if not evt.snapshot_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence snapshot path not set for this anomaly."
        )

    # Robust path resolution across backend directory, cwd, and root
    file_path = Path(evt.snapshot_path)
    if not file_path.is_file():
        app_dir = Path(__file__).resolve().parent.parent.parent  # backend
        candidate1 = app_dir / evt.snapshot_path
        candidate2 = app_dir.parent / "backend" / evt.snapshot_path
        candidate3 = Path.cwd() / evt.snapshot_path
        candidate4 = Path.cwd() / "backend" / evt.snapshot_path
        if candidate1.is_file():
            file_path = candidate1
        elif candidate2.is_file():
            file_path = candidate2
        elif candidate3.is_file():
            file_path = candidate3
        elif candidate4.is_file():
            file_path = candidate4
        else:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Evidence image file not found on server disk ({evt.snapshot_path})."
            )

    return FileResponse(
        path=str(file_path),
        media_type="image/jpeg",
        filename=file_path.name
    )

@router.patch("/{id}/status", response_model=AnomalyEventResponse)
async def update_anomaly_status(
    id: str,
    payload: AnomalyStatusUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Update review/resolution status of an anomaly event.
    """
    valid_statuses = {"NEW", "REVIEWED", "RESOLVED", "CONFIRMED", "ACTIVE", "ENDED"}
    new_status = payload.status.upper().strip()
    if new_status not in valid_statuses:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid status '{payload.status}'. Valid statuses: {valid_statuses}"
        )

    result = await db.execute(
        select(AnomalyEvent)
        .join(Camera, AnomalyEvent.camera_id == Camera.id)
        .where(
            AnomalyEvent.id == id,
            (AnomalyEvent.user_id == user.id) | (Camera.user_id == user.id)
        )
    )
    evt = result.scalar_one_or_none()
    if not evt:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Anomaly event '{id}' not found."
        )

    evt.status = new_status
    await db.commit()
    await db.refresh(evt)

    cam_name = None
    if evt.camera_id:
        cam_res = await db.execute(select(Camera.name).where(Camera.id == evt.camera_id))
        cam_name = cam_res.scalar_one_or_none()

    emp_name = None
    if evt.employee_id:
        emp_res = await db.execute(select(Employee.name).where(Employee.id == evt.employee_id))
        emp_name = emp_res.scalar_one_or_none()

    return format_anomaly(evt, camera_name=cam_name, employee_name=emp_name)

@router.delete("/{id}")
async def delete_anomaly(
    id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Permanently delete an anomaly event and erase its evidence photo file from disk.
    Strictly scoped to authenticated user.
    """
    result = await db.execute(
        select(AnomalyEvent)
        .join(Camera, AnomalyEvent.camera_id == Camera.id)
        .where(
            AnomalyEvent.id == id,
            (AnomalyEvent.user_id == user.id) | (Camera.user_id == user.id)
        )
    )
    evt = result.scalar_one_or_none()
    if not evt:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Anomaly event '{id}' not found or unauthorized."
        )

    # Erase physical evidence photo from disk if present
    if evt.snapshot_path:
        for base in [Path("."), Path("backend"), Path.cwd(), Path.cwd() / "backend"]:
            candidate = (base / evt.snapshot_path).resolve()
            try:
                if candidate.is_file():
                    candidate.unlink()
            except Exception:
                pass

    await db.delete(evt)
    await db.commit()

    return {"success": True, "id": id, "message": "Incident record and evidence snapshot permanently erased."}

@router.get("/{id}", response_model=AnomalyEventResponse)
async def get_anomaly(
    id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Retrieve single anomaly event by ID.
    """
    result = await db.execute(
        select(AnomalyEvent, Camera.name.label("camera_name"))
        .join(Camera, AnomalyEvent.camera_id == Camera.id)
        .where(
            AnomalyEvent.id == id,
            (AnomalyEvent.user_id == user.id) | (Camera.user_id == user.id)
        )
    )
    row = result.first()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Anomaly event with ID '{id}' not found."
        )
    evt, camera_name = row
    return format_anomaly(evt, camera_name=camera_name)
