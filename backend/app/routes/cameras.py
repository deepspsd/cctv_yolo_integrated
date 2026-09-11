import re
import uuid
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_

from app.database import get_db
from app.models import Camera, CameraStatusEnum, User, StreamSession
from app.schemas import (
    CameraCreate,
    CameraUpdate,
    CameraResponse,
    CameraSummaryResponse,
    CameraTestRequest,
    CameraTestExistingRequest,
    CameraTestResponse,
    StreamStartResponse,
    StreamStopRequest
)
from app.auth import verify_password
from app.config import settings
from app.security import (
    encrypt_credential,
    decrypt_credential,
    mask_rtsp_url,
    build_authenticated_rtsp_url
)
from app.rtsp_probe import probe_rtsp_lightweight, parse_rtsp_url
from app.mediamtx import mediamtx_manager
from app.websocket_manager import ws_manager
from app.health_manager import health_manager
from app.dependencies import get_current_user

# All camera endpoints require a valid JWT Bearer token
router = APIRouter(
    prefix="/cameras",
    tags=["Cameras"],
    dependencies=[Depends(get_current_user)],
)

def extract_ip_from_rtsp(url: str) -> str:
    try:
        host, _, _, _, _ = parse_rtsp_url(url)
        return host
    except Exception:
        pass
    return "192.168.1.100"

def to_utc_iso(dt: datetime | None) -> str | None:
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()

def format_camera_response(cam: Camera) -> dict:
    now_iso = datetime.now(timezone.utc).isoformat()
    masked = mask_rtsp_url(cam.rtsp_url)
    return {
        "id": cam.id,
        "name": cam.name,
        "code": cam.code,
        "zone": cam.zone,
        "rtspUrl": masked,
        "rtsp_url": masked,
        "rtsp_url_display": masked,
        "rtspUrlDisplay": masked,
        "username": cam.username or "admin",
        "status": cam.status.value,
        "lastChecked": to_utc_iso(cam.last_checked_at) or now_iso,
        "lastOnline": to_utc_iso(cam.last_online_at) or now_iso,
        "lastError": cam.last_error,
        "consecutiveFailures": cam.consecutive_failures,
        "resolution": cam.resolution,
        "fps": cam.fps,
        "codec": cam.codec,
        "bitrate": cam.bitrate,
        "ip": cam.ip,
        "model": cam.model
    }

@router.get("", response_model=list[CameraResponse])
async def list_cameras(
    search: str | None = None,
    zone: str | None = None,
    status: str | None = None,
    db: AsyncSession = Depends(get_db)
):
    """
    List cameras. Supports optional query filtering: search, zone, status.
    Never returns passwords or unmasked credentials.
    """
    query = select(Camera)

    if zone and zone.upper() != "ALL":
        query = query.where(Camera.zone == zone.upper().strip())

    if status and status.upper() != "ALL":
        try:
            status_enum = CameraStatusEnum[status.upper().strip()]
            query = query.where(Camera.status == status_enum)
        except KeyError:
            pass

    if search and search.strip():
        term = f"%{search.strip()}%"
        query = query.where(
            or_(
                Camera.name.ilike(term),
                Camera.code.ilike(term),
                Camera.zone.ilike(term),
                Camera.ip.ilike(term)
            )
        )

    query = query.order_by(Camera.created_at.asc())
    result = await db.execute(query)
    cameras = result.scalars().all()
    return [format_camera_response(cam) for cam in cameras]

@router.get("/summary", response_model=CameraSummaryResponse)
async def get_cameras_summary(db: AsyncSession = Depends(get_db)):
    """
    Internal summary metrics endpoint for dashboard cards.
    """
    result = await db.execute(select(Camera))
    cams = result.scalars().all()

    total = len(cams)
    online = sum(1 for c in cams if c.status == CameraStatusEnum.ONLINE)
    offline = sum(1 for c in cams if c.status == CameraStatusEnum.OFFLINE)
    checking = sum(1 for c in cams if c.status == CameraStatusEnum.CHECKING)
    unknown = sum(1 for c in cams if c.status == CameraStatusEnum.UNKNOWN)

    active_sess_res = await db.execute(
        select(func.count(StreamSession.id)).where(StreamSession.ended_at == None)
    )
    active_viewers = active_sess_res.scalar_one() or 0

    return CameraSummaryResponse(
        total=total,
        online=online,
        offline=offline,
        checking=checking,
        unknown=unknown,
        active_viewers=active_viewers
    )

@router.post("", response_model=CameraResponse, status_code=status.HTTP_201_CREATED)
async def create_camera(payload: CameraCreate, db: AsyncSession = Depends(get_db)):
    """
    Create a new camera record with encrypted credentials.
    Performs initial lightweight probe and registers with MediaMTX.
    """
    # Check duplicate name
    existing_name = await db.execute(select(Camera).where(Camera.name == payload.name.strip()))
    if existing_name.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Camera with name '{payload.name}' already exists."
        )

    # Validate RTSP format
    clean_url = payload.rtsp_url.strip()
    if not clean_url.lower().startswith(('rtsp://', 'rtsps://')):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="RTSP URL must begin with rtsp:// or rtsps://"
        )

    # Generate next code (e.g. CAM-001)
    count_res = await db.execute(select(func.count(Camera.id)))
    total_count = count_res.scalar_one() or 0
    code = f"CAM-{str(total_count + 1).zfill(3)}"
    camera_id = f"cam_{datetime.now().strftime('%Y%m%d%H%M%S')}_{total_count + 1}"

    ip = extract_ip_from_rtsp(clean_url)
    encrypted_pass = encrypt_credential(payload.password) if payload.password else None

    # Initial lightweight reachability probe (no AI, no continuous decode)
    probe = await probe_rtsp_lightweight(
        rtsp_url=clean_url,
        timeout=settings.HEALTH_CHECK_TIMEOUT_SECONDS,
        username=payload.username,
        password=payload.password
    )

    initial_status = CameraStatusEnum.ONLINE if (probe.get("reachable") and probe.get("stream_available")) else CameraStatusEnum.OFFLINE
    now = datetime.now(timezone.utc)

    new_camera = Camera(
        id=camera_id,
        name=payload.name.strip(),
        code=code,
        zone=payload.zone.upper().strip(),
        rtsp_url=clean_url,
        username=payload.username.strip() if payload.username else "admin",
        password_encrypted=encrypted_pass,
        status=initial_status,
        last_checked_at=now,
        last_online_at=now if initial_status == CameraStatusEnum.ONLINE else None,
        last_error=probe.get("error"),
        consecutive_failures=0 if initial_status == CameraStatusEnum.ONLINE else 1,
        resolution=probe.get("resolution", "1920×1080"),
        fps=probe.get("fps", 25),
        codec=probe.get("codec", "H.264"),
        bitrate="4.0 Mbps",
        ip=ip,
        model="Industrial IP Camera"
    )

    db.add(new_camera)
    await db.commit()
    await db.refresh(new_camera)

    # Register dynamic path on MediaMTX on-demand
    await mediamtx_manager.register_camera_path(
        camera_id=new_camera.id,
        rtsp_url=clean_url,
        username=new_camera.username,
        password=payload.password
    )

    # Broadcast over WebSocket
    resp_dict = format_camera_response(new_camera)
    await ws_manager.broadcast("CAMERA_CREATED", resp_dict)

    return resp_dict

@router.get("/{camera_id}", response_model=CameraResponse)
async def get_camera(camera_id: str, db: AsyncSession = Depends(get_db)):
    """
    Get camera details and real-time metadata without exposing credentials.
    """
    result = await db.execute(select(Camera).where(Camera.id == camera_id))
    camera = result.scalar_one_or_none()
    if not camera:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Camera with ID '{camera_id}' not found."
        )
    return format_camera_response(camera)

@router.put("/{camera_id}", response_model=CameraResponse)
async def update_camera(
    camera_id: str,
    payload: CameraUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Update camera fields.
    MANDATORY REQUIREMENT: Caller must provide their user login and password.
    Only if valid, changes are saved to the database.
    """
    # 1. Require user login and password
    login_id = payload.user_login.strip() if payload.user_login else ""
    user_pass = payload.user_password if payload.user_password else ""

    if not login_id or not user_pass:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User verification required: Provide your login and password to authorize camera edits."
        )

    # 2. Verify against users table
    user_res = await db.execute(
        select(User).where(or_(User.email == login_id, User.name == login_id))
    )
    auth_user = user_res.scalar_one_or_none()

    if not auth_user and (current_user.email == login_id or current_user.name == login_id):
        auth_user = current_user

    if not auth_user or not verify_password(user_pass, auth_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication failed: Incorrect login or password. Camera edit denied."
        )

    if not auth_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is deactivated. Camera edit denied."
        )

    # 3. Lookup camera to edit
    result = await db.execute(select(Camera).where(Camera.id == camera_id))
    camera = result.scalar_one_or_none()
    if not camera:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Camera with ID '{camera_id}' not found."
        )

    # 4. Check duplicate name with other cameras
    if payload.name:
        existing = await db.execute(
            select(Camera).where(Camera.name == payload.name.strip(), Camera.id != camera_id)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Camera with name '{payload.name}' already exists."
            )
        camera.name = payload.name.strip()

    if payload.zone:
        camera.zone = payload.zone.upper().strip()

    if payload.username is not None:
        camera.username = payload.username.strip()

    if payload.password is not None and payload.password != "":
        camera.password_encrypted = encrypt_credential(payload.password)

    if payload.rtsp_url:
        clean_url = payload.rtsp_url.strip()
        if not clean_url.lower().startswith(('rtsp://', 'rtsps://')):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="RTSP URL must begin with rtsp:// or rtsps://"
            )
        camera.rtsp_url = clean_url
        camera.ip = extract_ip_from_rtsp(clean_url)

    camera.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(camera)

    # Re-register path on MediaMTX
    plain_pass = decrypt_credential(camera.password_encrypted) if camera.password_encrypted else None
    await mediamtx_manager.register_camera_path(
        camera_id=camera.id,
        rtsp_url=camera.rtsp_url,
        username=camera.username,
        password=plain_pass
    )

    resp_dict = format_camera_response(camera)
    await ws_manager.broadcast("CAMERA_UPDATED", resp_dict)
    return resp_dict

@router.delete("/{camera_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_camera(camera_id: str, db: AsyncSession = Depends(get_db)):
    """
    Delete a camera, end active stream sessions, and release MediaMTX path.
    """
    result = await db.execute(select(Camera).where(Camera.id == camera_id))
    camera = result.scalar_one_or_none()
    if not camera:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Camera with ID '{camera_id}' not found."
        )

    cam_name = camera.name

    # End any active stream sessions
    active_sess_res = await db.execute(
        select(StreamSession).where(
            StreamSession.camera_id == camera_id,
            StreamSession.ended_at == None
        )
    )
    for sess in active_sess_res.scalars().all():
        sess.ended_at = datetime.now(timezone.utc)

    await db.delete(camera)
    await db.commit()

    # Remove path from MediaMTX
    await mediamtx_manager.remove_camera_path(camera_id)

    # Broadcast event
    await ws_manager.broadcast("CAMERA_DELETED", {"id": camera_id, "name": cam_name})
    return None

@router.post("/test", response_model=CameraTestResponse)
async def test_connection_adhoc(payload: CameraTestRequest):
    """
    Test connection to an ad-hoc RTSP URL before saving.
    No AI model or continuous decoding invoked.
    """
    clean_url = payload.rtsp_url.strip()
    if not clean_url.lower().startswith(('rtsp://', 'rtsps://')):
        return CameraTestResponse(
            success=False,
            latencyMs=0,
            details="Invalid protocol: URL must start with rtsp:// or rtsps://",
            reachable=False,
            streamAvailable=False,
            error="Protocol validation failed"
        )

    res = await probe_rtsp_lightweight(
        rtsp_url=clean_url,
        timeout=settings.HEALTH_CHECK_TIMEOUT_SECONDS,
        username=payload.username,
        password=payload.password
    )

    is_live = bool(res.get("reachable", False) and res.get("stream_available", False))
    details = res.get("details", "Connection test finished")
    if not is_live:
        if res.get("reachable"):
            details = res.get("error") or "Host reachable, but live feed/channel is not streaming or rejected by NVR."
        else:
            details = res.get("error") or "Connection failed: host unreachable or network timeout."

    return CameraTestResponse(
        success=is_live,
        latencyMs=res.get("latency_ms", 0),
        details=details,
        reachable=res.get("reachable", False),
        streamAvailable=res.get("stream_available", False),
        codec=res.get("codec"),
        resolution=res.get("resolution"),
        fps=res.get("fps"),
        error=res.get("error")
    )

@router.post("/{camera_id}/test", response_model=CameraTestResponse)
async def test_camera_connection(
    camera_id: str,
    payload: CameraTestExistingRequest | None = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Test connection to an existing camera by ID using stored encrypted credentials,
    with optional overrides if user modified URL/credentials in Edit modal.
    """
    result = await db.execute(select(Camera).where(Camera.id == camera_id))
    camera = result.scalar_one_or_none()
    if not camera:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Camera with ID '{camera_id}' not found."
        )

    clean_payload_pass = payload.password.strip() if (payload and payload.password) else None
    plain_pass = clean_payload_pass or (decrypt_credential(camera.password_encrypted) if camera.password_encrypted else None)

    target_url = payload.rtsp_url.strip() if (payload and payload.rtsp_url) else camera.rtsp_url
    target_user = payload.username.strip() if (payload and payload.username is not None and payload.username.strip() != "") else camera.username

    res = await probe_rtsp_lightweight(
        rtsp_url=target_url,
        timeout=settings.HEALTH_CHECK_TIMEOUT_SECONDS,
        username=target_user,
        password=plain_pass
    )

    is_live = bool(res.get("reachable", False) and res.get("stream_available", False))
    details = res.get("details", "Probe completed")
    if not is_live:
        if res.get("reachable"):
            details = res.get("error") or "Host reachable, but live feed/channel is not streaming or rejected by NVR."
        else:
            details = res.get("error") or "Connection failed: host unreachable or network timeout."

    return CameraTestResponse(
        success=is_live,
        latencyMs=res.get("latency_ms", 0),
        details=details,
        reachable=res.get("reachable", False),
        streamAvailable=res.get("stream_available", False),
        codec=res.get("codec"),
        resolution=res.get("resolution"),
        fps=res.get("fps"),
        error=res.get("error")
    )

@router.post("/{camera_id}/stream/start", response_model=StreamStartResponse)
async def start_stream(camera_id: str, db: AsyncSession = Depends(get_db)):
    """
    Start on-demand live stream. Tracks session in stream_sessions.
    Returns WebRTC WHEP endpoint.
    MediaMTX handles source pulling and viewer fan-out.
    No local CPU video decoding.
    """
    result = await db.execute(select(Camera).where(Camera.id == camera_id))
    camera = result.scalar_one_or_none()
    if not camera:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Camera with ID '{camera_id}' not found."
        )

    # Register path on MediaMTX if not already registered
    plain_pass = decrypt_credential(camera.password_encrypted) if camera.password_encrypted else None
    await mediamtx_manager.register_camera_path(
        camera_id=camera.id,
        rtsp_url=camera.rtsp_url,
        username=camera.username,
        password=plain_pass
    )

    whep_endpoint = mediamtx_manager.get_whep_endpoint(camera.id)
    stream_path = mediamtx_manager.get_stream_path(camera.id)

    # Create session in stream_sessions table
    now = datetime.now(timezone.utc)
    session_id = f"sess_{uuid.uuid4().hex[:12]}"
    expires_at = (now + timedelta(seconds=settings.STREAM_SESSION_TIMEOUT)).isoformat()

    active_res = await db.execute(
        select(func.count(StreamSession.id)).where(
            StreamSession.camera_id == camera_id,
            StreamSession.ended_at == None
        )
    )
    current_viewers = (active_res.scalar_one() or 0) + 1

    new_session = StreamSession(
        id=session_id,
        camera_id=camera_id,
        started_at=now,
        last_activity_at=now,
        viewer_count=current_viewers
    )
    db.add(new_session)
    await db.commit()

    return StreamStartResponse(
        camera_id=camera.id,
        protocol="webrtc",
        stream_path=stream_path,
        stream_url=f"webrtc://{stream_path}",
        whep_url=whep_endpoint,
        session_id=session_id,
        expires_at=expires_at,
        type="webrtc",
        resolution=camera.resolution,
        fps=camera.fps,
        codec=camera.codec,
        bitrate=camera.bitrate,
        status=camera.status,
        started_at=now.isoformat()
    )

@router.post("/{camera_id}/stream/stop")
async def stop_stream(
    camera_id: str,
    payload: StreamStopRequest | None = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Notify backend that a viewer stopped viewing this camera.
    Updates stream_sessions and decrements viewer count.
    MediaMTX on-demand source automatically closes after timeout if no readers remain.
    """
    result = await db.execute(select(Camera).where(Camera.id == camera_id))
    camera = result.scalar_one_or_none()
    if not camera:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Camera with ID '{camera_id}' not found."
        )

    now = datetime.now(timezone.utc)
    if payload and payload.session_id:
        sess_res = await db.execute(
            select(StreamSession).where(
                StreamSession.id == payload.session_id,
                StreamSession.camera_id == camera_id
            )
        )
        sess = sess_res.scalar_one_or_none()
        if sess:
            sess.ended_at = now
            await db.commit()

    return {
        "status": "stopped",
        "cameraId": camera_id,
        "stoppedAt": now.isoformat()
    }

@router.get("/{camera_id}/stream")
async def get_camera_stream_info(camera_id: str, db: AsyncSession = Depends(get_db)):
    """
    Return currently available browser stream endpoint without exposing credentials.
    """
    result = await db.execute(select(Camera).where(Camera.id == camera_id))
    camera = result.scalar_one_or_none()
    if not camera:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Camera with ID '{camera_id}' not found."
        )

    whep_endpoint = mediamtx_manager.get_whep_endpoint(camera.id)
    stream_path = mediamtx_manager.get_stream_path(camera.id)

    active_res = await db.execute(
        select(func.count(StreamSession.id)).where(
            StreamSession.camera_id == camera_id,
            StreamSession.ended_at == None
        )
    )
    viewers = active_res.scalar_one() or 0

    return {
        "cameraId": camera.id,
        "protocol": "webrtc",
        "streamPath": stream_path,
        "streamUrl": f"webrtc://{stream_path}",
        "whepUrl": whep_endpoint,
        "resolution": camera.resolution,
        "fps": camera.fps,
        "codec": camera.codec,
        "status": camera.status.value,
        "activeViewers": viewers
    }

@router.get("/{camera_id}/status")
async def get_camera_status(camera_id: str, db: AsyncSession = Depends(get_db)):
    """
    Get live status for a specific camera.
    """
    result = await db.execute(select(Camera).where(Camera.id == camera_id))
    camera = result.scalar_one_or_none()
    if not camera:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Camera with ID '{camera_id}' not found."
        )

    return {
        "id": camera.id,
        "name": camera.name,
        "status": camera.status.value,
        "lastChecked": camera.last_checked_at.isoformat() if camera.last_checked_at else None,
        "lastOnline": camera.last_online_at.isoformat() if camera.last_online_at else None,
        "lastError": camera.last_error,
        "consecutiveFailures": camera.consecutive_failures,
        "resolution": camera.resolution,
        "fps": camera.fps,
        "codec": camera.codec,
        "bitrate": camera.bitrate,
        "ip": camera.ip
    }
