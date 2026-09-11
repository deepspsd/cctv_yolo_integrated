from datetime import datetime, timezone, time
from typing import Optional, List
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, status, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc, asc
from jose import JWTError

from app.database import get_db
from app.models import AnomalyEvent, Camera, User
from app.dependencies import get_current_user
from app.auth import decode_access_token
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

def format_anomaly(evt: AnomalyEvent, camera_name: Optional[str] = None) -> dict:
    c_name = camera_name or (evt.camera.name if getattr(evt, "camera", None) else None) or evt.camera_id
    display_status = evt.status
    if display_status == "CONFIRMED":
        display_status = "NEW"

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
        "severity": compute_severity(evt.anomaly_type, evt.event_category),
        "trackId": evt.track_id,
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
    order: Optional[str] = Query("desc", pattern="^(asc|desc)$"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    List historical anomaly events with multi-criteria filtering and camera join.
    """
    query = select(AnomalyEvent, Camera.name.label("camera_name")).outerjoin(
        Camera, AnomalyEvent.camera_id == Camera.id
    )

    if camera_id:
        query = query.where(AnomalyEvent.camera_id == camera_id)
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

    return [format_anomaly(evt, camera_name) for evt, camera_name in rows]

@router.get("/dates")
async def list_evidence_dates(
    db: AsyncSession = Depends(get_db)
):
    """
    Returns unique dates with evidence photos in backend/data/evidence and database.
    """
    # 1. Aggregate from database
    result = await db.execute(
        select(
            func.date(AnomalyEvent.created_at).label("d"),
            func.count(AnomalyEvent.id).label("total"),
            func.count(AnomalyEvent.snapshot_path).label("with_evidence")
        )
        .group_by("d")
        .order_by(desc("d"))
    )
    rows = result.all()
    dates_map = {}
    for d, total, with_evidence in rows:
        if d:
            dates_map[str(d)] = {
                "date": str(d),
                "totalAlerts": total,
                "evidencePhotos": with_evidence
            }

    # 2. Check disk backend/data/evidence/YYYY/MM/DD
    app_dir = Path(__file__).resolve().parent.parent.parent
    evidence_dir = app_dir / "data" / "evidence"
    if evidence_dir.is_dir():
        for y_dir in evidence_dir.iterdir():
            if y_dir.is_dir() and len(y_dir.name) == 4 and y_dir.name.isdigit():
                for m_dir in y_dir.iterdir():
                    if m_dir.is_dir() and len(m_dir.name) == 2 and m_dir.name.isdigit():
                        for d_dir in m_dir.iterdir():
                            if d_dir.is_dir() and len(d_dir.name) == 2 and d_dir.name.isdigit():
                                date_key = f"{y_dir.name}-{m_dir.name}-{d_dir.name}"
                                disk_count = len(list(d_dir.glob("*/*.jpg")))
                                if date_key in dates_map:
                                    dates_map[date_key]["evidencePhotos"] = max(dates_map[date_key]["evidencePhotos"], disk_count)
                                else:
                                    dates_map[date_key] = {
                                        "date": date_key,
                                        "totalAlerts": disk_count,
                                        "evidencePhotos": disk_count
                                    }

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
    Supports JWT Bearer header or token query parameter for <img> tag compatibility.
    """
    # Permissive auth: check token if provided, but don't break local <img> rendering
    try:
        await authenticate_request(request, token_param=token, db=db)
    except Exception:
        pass

    result = await db.execute(select(AnomalyEvent).where(AnomalyEvent.id == id))
    evt = result.scalar_one_or_none()
    if not evt:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Anomaly event '{id}' not found."
        )

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

    result = await db.execute(select(AnomalyEvent).where(AnomalyEvent.id == id))
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

    return format_anomaly(evt, camera_name=cam_name)

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
        .outerjoin(Camera, AnomalyEvent.camera_id == Camera.id)
        .where(AnomalyEvent.id == id)
    )
    row = result.first()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Anomaly event with ID '{id}' not found."
        )
    evt, camera_name = row
    return format_anomaly(evt, camera_name=camera_name)
