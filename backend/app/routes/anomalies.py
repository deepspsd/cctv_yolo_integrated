import csv
import io
from datetime import datetime, timezone, time, timedelta
from typing import Optional, List
from pathlib import Path
import cv2
import numpy as np
from fastapi import APIRouter, Depends, HTTPException, status, Query, Request
from fastapi.responses import FileResponse, Response, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc, asc, case, or_
from jose import JWTError

from app.database import get_db, AsyncSessionLocal
from app.models import AnomalyEvent, Camera, User, Employee
from app.dependencies import get_current_user
from app.auth import decode_access_token
from app.security import decrypt_bytes
from app.schemas import AnomalyEventResponse, AnomalyStatusUpdate
from app.config import settings

# Indian Standard Time (IST - Asia/Kolkata, UTC+5:30)
IST_TZ = timezone(timedelta(hours=5, minutes=30))

def apply_occusafe_watermark(img_bgr: np.ndarray, meta_text: Optional[str] = None) -> np.ndarray:
    """
    Renders an elegant, official OccuSafe® presentation watermark overlay along the bottom.
    Includes dark translucent ribbon, OccuSafe® italic branding, shield indicator, and IST timestamp.
    """
    if img_bgr is None or img_bgr.size == 0:
        return img_bgr

    img = img_bgr.copy()
    h, w = img.shape[:2]

    # Watermark bar height
    bar_h = max(34, int(h * 0.055))
    overlay = img.copy()
    cv2.rectangle(overlay, (0, h - bar_h), (w, h), (10, 12, 18), -1)
    # 70% opacity blend for clean translucent finish
    cv2.addWeighted(overlay, 0.75, img, 0.25, 0, img)

    # Accent orange line on top of ribbon
    cv2.line(img, (0, h - bar_h), (w, h - bar_h), (30, 140, 245), 2)

    # OccuSafe® Brand mark
    brand_text = "OccuSafe(R) SURVEILLANCE EVIDENCE"
    font = cv2.FONT_HERSHEY_DUPLEX
    font_scale = max(0.48, bar_h / 68.0)
    y_pos = int(h - bar_h / 2 + 5)

    # Glow / shadow for brand
    cv2.putText(img, brand_text, (16, y_pos + 1), font, font_scale, (0, 0, 0), 2, cv2.LINE_AA)
    # Bright white / orange brand
    cv2.putText(img, "OccuSafe", (16, y_pos), font, font_scale, (255, 255, 255), 1, cv2.LINE_AA)
    occusafe_size = cv2.getTextSize("OccuSafe", font, font_scale, 1)[0]
    cv2.putText(img, "(R) SURVEILLANCE EVIDENCE", (18 + occusafe_size[0], y_pos), font, font_scale * 0.85, (30, 140, 245), 1, cv2.LINE_AA)

    # Right-aligned IST metadata if provided
    if meta_text:
        meta_font_scale = max(0.40, bar_h / 80.0)
        text_size = cv2.getTextSize(meta_text, cv2.FONT_HERSHEY_SIMPLEX, meta_font_scale, 1)[0]
        x_meta = max(w - text_size[0] - 16, occusafe_size[0] + 160)
        cv2.putText(img, meta_text, (x_meta, y_pos), cv2.FONT_HERSHEY_SIMPLEX, meta_font_scale, (200, 220, 240), 1, cv2.LINE_AA)

    return img

def to_utc_iso(dt: Optional[datetime]) -> Optional[str]:
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

def to_ist_str(dt: Optional[datetime], fmt: str = "%d %b %Y, %I:%M:%S %p IST") -> Optional[str]:
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(IST_TZ).strftime(fmt)

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
    display_status = (evt.status or "").upper()
    if display_status in ("CONFIRMED", "ENDED", "ACTIVE"):
        display_status = "NEW"

    ppe_friendly_names = {
        "NO_HARDHAT": "headcap / hardhat",
        "NO_MASK": "protective mask",
        "NO_SAFETY_VEST": "safety vest",
        "PHONE_VIOLATION": "mobile phone in prohibited zone",
        "MACHINERY_HAZARD": "heavy machinery safety boundary"
    }
    friendly_ppe = ppe_friendly_names.get(evt.anomaly_type, evt.anomaly_type.lower().replace("_", " "))
    if evt.anomaly_type == "PHONE_VIOLATION":
        if e_name:
            alert_msg = f"{e_name} was using mobile phone in prohibited zone"
        else:
            alert_msg = "Unidentified person was using mobile phone in prohibited zone"
    elif evt.anomaly_type == "MACHINERY_HAZARD":
        if e_name:
            alert_msg = f"{e_name} entered heavy machinery danger boundary"
        else:
            alert_msg = "Worker entered heavy machinery danger boundary"
    elif e_name:
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
        "firstSeenAt": to_utc_iso(evt.first_seen_at),
        "confirmedAt": to_utc_iso(evt.confirmed_at),
        "endedAt": to_utc_iso(evt.ended_at),
        "durationSeconds": evt.duration_seconds,
        "status": display_status,
        "snapshotPath": evt.snapshot_path,
        "createdAt": to_utc_iso(evt.created_at),
        "confirmedAtIst": to_ist_str(evt.confirmed_at),
        "confirmedTimeIst": to_ist_str(evt.confirmed_at, "%I:%M:%S %p IST"),
        "confirmedDateIst": to_ist_str(evt.confirmed_at, "%d %b %Y")
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
    response: Response,
    camera_id: Optional[str] = Query(None, alias="cameraId"),
    zone: Optional[str] = None,
    anomaly_type: Optional[str] = Query(None, alias="anomalyType"),
    severity: Optional[str] = None,
    evidence_only: Optional[bool] = Query(None, alias="evidenceOnly"),
    search: Optional[str] = None,
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
    Returns total filtered count via X-Total-Count header.
    """
    user_role = (getattr(user, "role", "") or "").upper()
    is_admin = user_role in ("ADMINISTRATOR", "ADMIN", "FACILITY_MANAGER", "SECURITY_OFFICER")

    # Base select query
    query = select(
        AnomalyEvent,
        Camera.name.label("camera_name"),
        Employee.name.label("employee_name")
    ).join(
        Camera, AnomalyEvent.camera_id == Camera.id
    ).outerjoin(
        Employee, AnomalyEvent.employee_id == Employee.id
    ).where(
        AnomalyEvent.anomaly_type != "PERSON_DETECTED"
    )

    # Base count query matching exact same joins and base filter
    count_query = select(func.count(AnomalyEvent.id)).join(
        Camera, AnomalyEvent.camera_id == Camera.id
    ).outerjoin(
        Employee, AnomalyEvent.employee_id == Employee.id
    ).where(
        AnomalyEvent.anomaly_type != "PERSON_DETECTED"
    )

    if not is_admin:
        query = query.where((AnomalyEvent.user_id == user.id) | (Camera.user_id == user.id))
        count_query = count_query.where((AnomalyEvent.user_id == user.id) | (Camera.user_id == user.id))

    if camera_id:
        query = query.where(AnomalyEvent.camera_id == camera_id)
        count_query = count_query.where(AnomalyEvent.camera_id == camera_id)
    if employee_id:
        query = query.where(AnomalyEvent.employee_id == employee_id)
        count_query = count_query.where(AnomalyEvent.employee_id == employee_id)
    if zone and zone.upper() != "ALL":
        query = query.where(AnomalyEvent.zone == zone.strip())
        count_query = count_query.where(AnomalyEvent.zone == zone.strip())
    if anomaly_type and anomaly_type.upper() != "ALL":
        query = query.where(AnomalyEvent.anomaly_type == anomaly_type.strip())
        count_query = count_query.where(AnomalyEvent.anomaly_type == anomaly_type.strip())
    if status and status.upper() != "ALL":
        if status.upper() == "UNRESOLVED":
            query = query.where(AnomalyEvent.status != "RESOLVED")
            count_query = count_query.where(AnomalyEvent.status != "RESOLVED")
        elif status.upper() == "NEW":
            query = query.where(AnomalyEvent.status.in_(["NEW", "CONFIRMED", "ENDED", "ACTIVE"]))
            count_query = count_query.where(AnomalyEvent.status.in_(["NEW", "CONFIRMED", "ENDED", "ACTIVE"]))
        else:
            query = query.where(AnomalyEvent.status == status.strip().upper())
            count_query = count_query.where(AnomalyEvent.status == status.strip().upper())

    if severity and severity.upper() != "ALL":
        sev_list = [s.strip().upper() for s in severity.split(",") if s.strip()]
        if len(sev_list) == 1:
            query = query.where(AnomalyEvent.severity == sev_list[0])
            count_query = count_query.where(AnomalyEvent.severity == sev_list[0])
        elif len(sev_list) > 1:
            query = query.where(AnomalyEvent.severity.in_(sev_list))
            count_query = count_query.where(AnomalyEvent.severity.in_(sev_list))

    if evidence_only:
        cond = (AnomalyEvent.snapshot_path.isnot(None)) & (AnomalyEvent.snapshot_path != "")
        query = query.where(cond)
        count_query = count_query.where(cond)

    if search and search.strip():
        term = f"%{search.strip()}%"
        search_cond = or_(
            Camera.name.ilike(term),
            Camera.id.ilike(term),
            AnomalyEvent.zone.ilike(term),
            AnomalyEvent.anomaly_type.ilike(term),
            Employee.name.ilike(term),
        )
        query = query.where(search_cond)
        count_query = count_query.where(search_cond)

    if date:
        try:
            parsed_date = datetime.strptime(date, "%Y-%m-%d").date()
            start_dt = datetime.combine(parsed_date, time.min)
            end_dt = datetime.combine(parsed_date, time.max)
            query = query.where(AnomalyEvent.created_at >= start_dt, AnomalyEvent.created_at <= end_dt)
            count_query = count_query.where(AnomalyEvent.created_at >= start_dt, AnomalyEvent.created_at <= end_dt)
        except ValueError:
            pass

    if date_from:
        query = query.where(AnomalyEvent.created_at >= date_from)
        count_query = count_query.where(AnomalyEvent.created_at >= date_from)
    if date_to:
        query = query.where(AnomalyEvent.created_at <= date_to)
        count_query = count_query.where(AnomalyEvent.created_at <= date_to)

    # Calculate total count for pagination
    count_res = await db.execute(count_query)
    total_count = count_res.scalar() or 0
    response.headers["X-Total-Count"] = str(total_count)
    response.headers["Access-Control-Expose-Headers"] = "X-Total-Count"

    if order == "asc":
        query = query.order_by(asc(AnomalyEvent.created_at))
    else:
        query = query.order_by(desc(AnomalyEvent.created_at))

    query = query.offset(offset).limit(limit)
    result = await db.execute(query)
    rows = result.all()

    return [format_anomaly(evt, camera_name, employee_name) for evt, camera_name, employee_name in rows]

@router.get("/total")
async def get_anomaly_total(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Returns the real total count of anomaly events in the DB for this user.
    No pagination limit — always reflects exact DB row count.
    Excludes PERSON_DETECTED.
    """
    user_role = (getattr(user, "role", "") or "").upper()
    is_admin = user_role in ("ADMINISTRATOR", "ADMIN", "FACILITY_MANAGER", "SECURITY_OFFICER")

    count_q = select(func.count(AnomalyEvent.id)).join(
        Camera, AnomalyEvent.camera_id == Camera.id
    ).where(
        AnomalyEvent.anomaly_type != "PERSON_DETECTED"
    )

    if not is_admin:
        count_q = count_q.where((AnomalyEvent.user_id == user.id) | (Camera.user_id == user.id))

    result = await db.execute(count_q)
    total = result.scalar_one_or_none() or 0
    return {"total": total}

@router.get("/stats")
async def get_anomaly_stats(
    date: Optional[str] = None,
    camera_id: Optional[str] = Query(None, alias="cameraId"),
    zone: Optional[str] = None,
    anomaly_type: Optional[str] = Query(None, alias="anomalyType"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Returns real DB counts for all KPI summary cards:
    - total: events in DB for selected date / filters (or all-time if no date)
    - today: events created today in IST (UTC+5:30)
    - dateCount: events on the selected date
    - evidencePhotos: events with photo proof
    - highSeverity: CRITICAL + HIGH severity count
    - critical: CRITICAL severity count
    - high: HIGH severity count
    - medium: MEDIUM severity count
    - low: LOW severity count
    - unresolved: status != 'RESOLVED'
    - resolved: status == 'RESOLVED'
    All counts are scoped to authenticated user's cameras.
    """
    user_role = (getattr(user, "role", "") or "").upper()
    is_admin = user_role in ("ADMINISTRATOR", "ADMIN", "FACILITY_MANAGER", "SECURITY_OFFICER")

    def scoped(q):
        if not is_admin:
            q = q.where((AnomalyEvent.user_id == user.id) | (Camera.user_id == user.id))
        return q

    # Common base filters with single-query aggregation
    base_q = select(
        func.count(AnomalyEvent.id).label("total"),
        func.count(case(((AnomalyEvent.snapshot_path.isnot(None)) & (AnomalyEvent.snapshot_path != ""), AnomalyEvent.id))).label("photos"),
        func.count(case((AnomalyEvent.severity == "CRITICAL", AnomalyEvent.id))).label("critical"),
        func.count(case((AnomalyEvent.severity == "HIGH", AnomalyEvent.id))).label("high"),
        func.count(case((AnomalyEvent.severity.in_(["CRITICAL", "HIGH"]), AnomalyEvent.id))).label("high_severity"),
        func.count(case((AnomalyEvent.severity == "MEDIUM", AnomalyEvent.id))).label("medium"),
        func.count(case((AnomalyEvent.severity == "LOW", AnomalyEvent.id))).label("low"),
        func.count(case((AnomalyEvent.status != "RESOLVED", AnomalyEvent.id))).label("unresolved"),
        func.count(case((AnomalyEvent.status == "RESOLVED", AnomalyEvent.id))).label("resolved"),
    ).select_from(AnomalyEvent).join(
        Camera, AnomalyEvent.camera_id == Camera.id
    ).where(AnomalyEvent.anomaly_type != "PERSON_DETECTED")

    if camera_id:
        base_q = base_q.where(AnomalyEvent.camera_id == camera_id)
    if zone and zone.upper() != "ALL":
        base_q = base_q.where(AnomalyEvent.zone == zone.strip())
    if anomaly_type and anomaly_type.upper() != "ALL":
        base_q = base_q.where(AnomalyEvent.anomaly_type == anomaly_type.strip())

    filtered_q = base_q
    if date:
        try:
            parsed_date = datetime.strptime(date, "%Y-%m-%d").date()
            start_dt = datetime.combine(parsed_date, time.min)
            end_dt = datetime.combine(parsed_date, time.max)
            filtered_q = filtered_q.where(AnomalyEvent.created_at >= start_dt, AnomalyEvent.created_at <= end_dt)
        except ValueError:
            pass

    row = (await db.execute(scoped(filtered_q))).one()
    stats_data = dict(row._mapping)

    # Compute today's count in IST
    now_ist = datetime.now(IST_TZ)
    today_start = datetime(now_ist.year, now_ist.month, now_ist.day, 0, 0, 0, tzinfo=IST_TZ)
    today_end = datetime(now_ist.year, now_ist.month, now_ist.day, 23, 59, 59, tzinfo=IST_TZ)
    today_start_utc = today_start.astimezone(timezone.utc).replace(tzinfo=None)
    today_end_utc = today_end.astimezone(timezone.utc).replace(tzinfo=None)

    today_q = select(func.count(AnomalyEvent.id)).join(
        Camera, AnomalyEvent.camera_id == Camera.id
    ).where(
        AnomalyEvent.anomaly_type != "PERSON_DETECTED",
        AnomalyEvent.created_at >= today_start_utc,
        AnomalyEvent.created_at <= today_end_utc
    )
    if camera_id:
        today_q = today_q.where(AnomalyEvent.camera_id == camera_id)
    if zone and zone.upper() != "ALL":
        today_q = today_q.where(AnomalyEvent.zone == zone.strip())
    today_count = (await db.execute(scoped(today_q))).scalar() or 0

    # Compute per-camera counts for active date filter
    cam_count_q = select(
        AnomalyEvent.camera_id,
        func.count(AnomalyEvent.id).label("cnt")
    ).select_from(AnomalyEvent).join(
        Camera, AnomalyEvent.camera_id == Camera.id
    ).where(AnomalyEvent.anomaly_type != "PERSON_DETECTED")
    if date:
        try:
            parsed_date = datetime.strptime(date, "%Y-%m-%d").date()
            start_dt = datetime.combine(parsed_date, time.min)
            end_dt = datetime.combine(parsed_date, time.max)
            cam_count_q = cam_count_q.where(AnomalyEvent.created_at >= start_dt, AnomalyEvent.created_at <= end_dt)
        except ValueError:
            pass
    cam_count_q = cam_count_q.group_by(AnomalyEvent.camera_id)
    cam_rows = (await db.execute(scoped(cam_count_q))).all()
    camera_counts = {cid: cnt for cid, cnt in cam_rows if cid}

    return {
        "total": stats_data.get("total") or 0,
        "today": today_count,
        "dateCount": stats_data.get("total") or 0,
        "evidencePhotos": stats_data.get("photos") or 0,
        "highSeverity": stats_data.get("high_severity") or 0,
        "critical": stats_data.get("critical") or 0,
        "high": stats_data.get("high") or 0,
        "medium": stats_data.get("medium") or 0,
        "low": stats_data.get("low") or 0,
        "unresolved": stats_data.get("unresolved") or 0,
        "resolved": stats_data.get("resolved") or 0,
        "cameraCounts": camera_counts,
    }

@router.get("/by-camera-recent")
async def get_recent_anomalies_by_camera(
    date: Optional[str] = None,
    limit_per_camera: int = Query(6, ge=1, le=24),
    evidence_only: Optional[bool] = Query(None, alias="evidenceOnly"),
    anomaly_type: Optional[str] = Query(None, alias="anomalyType"),
    camera_id: Optional[str] = Query(None, alias="cameraId"),
    zone: Optional[str] = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Returns recent anomalies partitioned per camera for the By Camera card stream view.
    Ensures every camera gets up to `limit_per_camera` evidence photos,
    preventing high-frequency cameras from starving quieter cameras.
    """
    user_role = (getattr(user, "role", "") or "").upper()
    is_admin = user_role in ("ADMINISTRATOR", "ADMIN", "FACILITY_MANAGER", "SECURITY_OFFICER")

    rn = func.row_number().over(
        partition_by=AnomalyEvent.camera_id,
        order_by=desc(AnomalyEvent.created_at)
    ).label("rn")

    sub_q = select(
        AnomalyEvent.id.label("event_id"),
        Camera.name.label("camera_name"),
        Employee.name.label("employee_name"),
        rn
    ).join(
        Camera, AnomalyEvent.camera_id == Camera.id
    ).outerjoin(
        Employee, AnomalyEvent.employee_id == Employee.id
    ).where(
        AnomalyEvent.anomaly_type != "PERSON_DETECTED"
    )

    if not is_admin:
        sub_q = sub_q.where((AnomalyEvent.user_id == user.id) | (Camera.user_id == user.id))

    if evidence_only:
        sub_q = sub_q.where((AnomalyEvent.snapshot_path.isnot(None)) & (AnomalyEvent.snapshot_path != ""))

    if camera_id and camera_id.upper() != "ALL":
        sub_q = sub_q.where(AnomalyEvent.camera_id == camera_id.strip())

    if zone and zone.upper() != "ALL":
        sub_q = sub_q.where(AnomalyEvent.zone == zone.strip())

    if anomaly_type and anomaly_type.upper() != "ALL":
        sub_q = sub_q.where(AnomalyEvent.anomaly_type == anomaly_type.strip())

    if date:
        try:
            parsed_date = datetime.strptime(date, "%Y-%m-%d").date()
            start_dt = datetime.combine(parsed_date, time.min)
            end_dt = datetime.combine(parsed_date, time.max)
            sub_q = sub_q.where(AnomalyEvent.created_at >= start_dt, AnomalyEvent.created_at <= end_dt)
        except ValueError:
            pass

    sub_aliased = sub_q.subquery()

    q = select(AnomalyEvent, sub_aliased.c.camera_name, sub_aliased.c.employee_name).join(
        sub_aliased, AnomalyEvent.id == sub_aliased.c.event_id
    ).where(sub_aliased.c.rn <= limit_per_camera).order_by(desc(AnomalyEvent.created_at))

    res = await db.execute(q)
    rows = res.all()

    return [format_anomaly(evt, cname, ename) for evt, cname, ename in rows]

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

    # 1. Aggregate from database scoped to current user's cameras (or all for admins)
    user_role = (getattr(user, "role", "") or "").upper()
    is_admin = user_role in ("ADMINISTRATOR", "ADMIN", "FACILITY_MANAGER", "SECURITY_OFFICER")

    date_q = select(
        func.date(AnomalyEvent.created_at).label("d"),
        func.count(AnomalyEvent.id).label("total"),
        func.count(AnomalyEvent.snapshot_path).label("with_evidence")
    ).join(Camera, AnomalyEvent.camera_id == Camera.id).where(
        AnomalyEvent.anomaly_type != "PERSON_DETECTED"
    )

    if not is_admin:
        date_q = date_q.where((AnomalyEvent.user_id == user.id) | (Camera.user_id == user.id))

    date_q = date_q.group_by("d").order_by(desc("d"))
    result = await db.execute(date_q)
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

async def purge_expired_anomalies(retention_days: Optional[int] = None) -> int:
    """
    Purges anomaly events and associated physical evidence older than retention_days.
    Follows Privacy-by-Design storage limitation principles (GDPR / DPDP).
    """
    days = retention_days or getattr(settings, "EVIDENCE_RETENTION_DAYS", 90)
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    count = 0
    try:
        async with AsyncSessionLocal() as db:
            query = select(AnomalyEvent).where(AnomalyEvent.created_at < cutoff)
            res = await db.execute(query)
            expired = res.scalars().all()
            for evt in expired:
                if evt.snapshot_path:
                    try:
                        p = Path(evt.snapshot_path)
                        if p.is_file():
                            p.unlink(missing_ok=True)
                    except Exception:
                        pass
                await db.delete(evt)
                count += 1
            if count > 0:
                await db.commit()
    except Exception:
        pass
    return count

@router.get("/export")
async def export_anomalies(
    format: str = Query("csv", pattern="^(csv|xlsx)$"),
    camera_id: Optional[str] = Query(None, alias="cameraId"),
    zone: Optional[str] = None,
    anomaly_type: Optional[str] = Query(None, alias="anomalyType"),
    status: Optional[str] = None,
    date: Optional[str] = None,
    date_from: Optional[datetime] = Query(None, alias="dateFrom"),
    date_to: Optional[datetime] = Query(None, alias="dateTo"),
    employee_id: Optional[str] = Query(None, alias="employeeId"),
    order: Optional[str] = Query("desc", pattern="^(asc|desc)$"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Exports anomaly events directly from backend as CSV or styled Excel workbook.
    All timestamps strictly formatted in Indian Standard Time (IST - Asia/Kolkata).
    """
    user_role = (getattr(user, "role", "") or "").upper()
    is_admin = user_role in ("ADMINISTRATOR", "ADMIN", "FACILITY_MANAGER", "SECURITY_OFFICER")

    query = select(
        AnomalyEvent,
        Camera.name.label("camera_name"),
        Employee.name.label("employee_name")
    ).join(
        Camera, AnomalyEvent.camera_id == Camera.id
    ).outerjoin(
        Employee, AnomalyEvent.employee_id == Employee.id
    ).where(
        AnomalyEvent.anomaly_type != "PERSON_DETECTED"
    )

    if not is_admin:
        query = query.where((AnomalyEvent.user_id == user.id) | (Camera.user_id == user.id))

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

    query = query.limit(5000)
    result = await db.execute(query)
    rows = result.all()

    now_ist_str = datetime.now(IST_TZ).strftime("%Y%m%d_%H%M%S")

    if format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "Incident ID",
            "Date (IST)",
            "Time (IST)",
            "Camera",
            "Zone",
            "Violation Type",
            "Staff / Person",
            "Confidence",
            "Severity",
            "Status",
            "Duration (s)",
            "Track ID",
            "Evidence Path"
        ])
        for evt, c_name, e_name in rows:
            formatted = format_anomaly(evt, camera_name=c_name, employee_name=e_name)
            writer.writerow([
                formatted["id"],
                formatted["confirmedDateIst"] or "--",
                formatted["confirmedTimeIst"] or "--",
                formatted["cameraName"] or formatted["cameraId"],
                formatted["zone"] or "General",
                formatted["anomalyType"],
                formatted["employeeName"] or "Unidentified",
                f"{round((formatted['confidence'] or 0) * 100)}%",
                formatted["severity"],
                formatted["status"],
                f"{formatted['durationSeconds']:.1f}" if formatted['durationSeconds'] is not None else "--",
                formatted["trackId"] if formatted["trackId"] is not None else "--",
                formatted["snapshotPath"] or "None"
            ])
        output.seek(0)
        return Response(
            content=output.getvalue(),
            media_type="text/csv",
            headers={
                "Content-Disposition": f"attachment; filename=anomalies_ist_{now_ist_str}.csv"
            }
        )

    elif format == "xlsx":
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Anomalies Log (IST)"

        headers = [
            "Incident ID",
            "Date (IST)",
            "Time (IST)",
            "Camera",
            "Zone",
            "Violation Type",
            "Staff / Person",
            "Confidence",
            "Severity",
            "Status",
            "Duration (s)",
            "Track ID",
            "Evidence Path"
        ]
        ws.append(headers)

        header_font = Font(bold=True, color="FFFFFF", name="Segoe UI", size=11)
        header_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
        header_align = Alignment(horizontal="center", vertical="center")

        thin_side = Side(border_style="thin", color="CBD5E1")
        border = Border(top=thin_side, left=thin_side, right=thin_side, bottom=thin_side)

        for col_num in range(1, len(headers) + 1):
            cell = ws.cell(row=1, column=col_num)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = header_align
            cell.border = border
            ws.row_dimensions[1].height = 24

        row_font = Font(name="Segoe UI", size=10)
        for row_idx, (evt, c_name, e_name) in enumerate(rows, start=2):
            formatted = format_anomaly(evt, camera_name=c_name, employee_name=e_name)
            ws.append([
                formatted["id"],
                formatted["confirmedDateIst"] or "--",
                formatted["confirmedTimeIst"] or "--",
                formatted["cameraName"] or formatted["cameraId"],
                formatted["zone"] or "General",
                formatted["anomalyType"],
                formatted["employeeName"] or "Unidentified",
                f"{round((formatted['confidence'] or 0) * 100)}%",
                formatted["severity"],
                formatted["status"],
                f"{formatted['durationSeconds']:.1f}" if formatted['durationSeconds'] is not None else "--",
                formatted["trackId"] if formatted["trackId"] is not None else "--",
                formatted["snapshotPath"] or "None"
            ])
            for c_idx in range(1, len(headers) + 1):
                c = ws.cell(row=row_idx, column=c_idx)
                c.font = row_font
                c.border = border
                if c_idx in (2, 3, 8, 9, 10, 11, 12):
                    c.alignment = Alignment(horizontal="center", vertical="center")

        # Auto column width
        for col in ws.columns:
            max_len = max(len(str(cell.value or "")) for cell in col)
            col_letter = openpyxl.utils.get_column_letter(col[0].column)
            ws.column_dimensions[col_letter].width = min(max(max_len + 3, 12), 45)

        stream = io.BytesIO()
        wb.save(stream)
        stream.seek(0)
        return Response(
            content=stream.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={
                "Content-Disposition": f"attachment; filename=anomalies_ist_{now_ist_str}.xlsx"
            }
        )

@router.get("/{id}/evidence")
async def get_anomaly_evidence(
    id: str,
    request: Request,
    token: Optional[str] = Query(None),
    download: bool = Query(False),
    watermark: bool = Query(False),
    db: AsyncSession = Depends(get_db)
):
    """
    Stream evidence snapshot securely from local backend storage.
    Supports in-memory AES decryption, download attachment headers, and OccuSafe® presentation watermark.
    """
    req_user = await authenticate_request(request, token_param=token, db=db)

    query = select(AnomalyEvent, Camera.name.label("camera_name"), Camera.user_id.label("camera_user_id")).join(
        Camera, AnomalyEvent.camera_id == Camera.id
    ).where(AnomalyEvent.id == id)
    result = await db.execute(query)
    row = result.first()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Anomaly event '{id}' not found."
        )

    evt, camera_name, cam_user_id = row

    # Enforce user privacy isolation
    user_role = (getattr(req_user, "role", "") or "").upper()
    is_admin = user_role in ("ADMINISTRATOR", "ADMIN", "FACILITY_MANAGER", "SECURITY_OFFICER")
    if not is_admin:
        if evt.user_id and evt.user_id != req_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied: photo belongs to another user.")
        if not evt.user_id and cam_user_id and cam_user_id != req_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied: photo belongs to another user.")

    # Retrieve raw image bytes (1st: decrypted from DB; 2nd: physical disk)
    raw_bytes = None
    if evt.encrypted_image:
        try:
            raw_bytes = decrypt_bytes(evt.encrypted_image)
        except Exception:
            raw_bytes = None

    if not raw_bytes:
        if not evt.snapshot_path:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evidence snapshot path not set.")
        file_path = Path(evt.snapshot_path)
        if not file_path.is_file():
            app_dir = Path(__file__).resolve().parent.parent.parent
            candidates = [
                app_dir / evt.snapshot_path,
                app_dir.parent / "backend" / evt.snapshot_path,
                Path.cwd() / evt.snapshot_path,
                Path.cwd() / "backend" / evt.snapshot_path
            ]
            for cand in candidates:
                if cand.is_file():
                    file_path = cand
                    break
        if file_path.is_file():
            try:
                raw_bytes = file_path.read_bytes()
            except Exception:
                raw_bytes = None

    if not raw_bytes:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evidence image file not found or corrupted.")

    # Apply OccuSafe® presentation watermark if requested or downloaded
    final_bytes = raw_bytes
    if watermark or download:
        try:
            nparr = np.frombuffer(raw_bytes, np.uint8)
            img_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img_bgr is not None:
                ist_time_str = to_ist_str(evt.confirmed_at or evt.created_at, "%d %b %Y, %I:%M:%S %p IST")
                cam_label = camera_name or evt.camera_id
                meta = f"{cam_label} | {evt.anomaly_type} | {ist_time_str}"
                watermarked = apply_occusafe_watermark(img_bgr, meta_text=meta)
                success, enc = cv2.imencode('.jpg', watermarked, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
                if success:
                    final_bytes = enc.tobytes()
        except Exception as wm_err:
            pass

    disposition_type = "attachment" if download else "inline"
    filename = f"occusafe_evidence_{evt.anomaly_type}_{id}.jpg"

    return Response(
        content=final_bytes,
        media_type="image/jpeg",
        headers={
            "Cache-Control": "private, max-age=3600",
            "Content-Disposition": f"{disposition_type}; filename={filename}"
        }
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
