import asyncio
import logging
from datetime import datetime, timezone, timedelta
from sqlalchemy import select
from app.config import settings
from app.database import AsyncSessionLocal
from app.models import Camera, CameraStatusEnum, StreamSession
from app.rtsp_probe import probe_rtsp_lightweight
from app.security import decrypt_credential, build_authenticated_rtsp_url
from app.websocket_manager import ws_manager

logger = logging.getLogger("health_manager")

class CameraHealthManager:
    def __init__(self):
        self._running = False
        self._task: asyncio.Task | null = None
        self._semaphore = asyncio.Semaphore(settings.HEALTH_CHECK_CONCURRENCY)

    def start(self):
        if not self._running:
            self._running = True
            self._task = asyncio.create_task(self._health_check_loop())
            logger.info("CameraHealthManager started.")

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            logger.info("CameraHealthManager stopped.")

    async def _health_check_loop(self):
        """
        Periodic background task that checks all cameras with bounded concurrency
        and automatically expires stale viewer sessions.
        """
        # Initial wait before first cycle to allow server bootstrap
        await asyncio.sleep(2)

        while self._running:
            try:
                await self._check_all_cameras()
                await self._cleanup_stale_sessions()
            except Exception as e:
                logger.error(f"Error during camera health check cycle: {e}", exc_info=True)
            
            # Wait configured interval
            await asyncio.sleep(settings.HEALTH_CHECK_INTERVAL_SECONDS)

    async def _cleanup_stale_sessions(self):
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=settings.STREAM_SESSION_TIMEOUT)
        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(StreamSession).where(
                        StreamSession.ended_at == None,
                        StreamSession.last_activity_at < cutoff
                    )
                )
                stale_sessions = result.scalars().all()
                if stale_sessions:
                    now = datetime.now(timezone.utc)
                    for sess in stale_sessions:
                        sess.ended_at = now
                    await db.commit()
                    logger.info(f"Cleaned up {len(stale_sessions)} stale viewer sessions.")
        except Exception as e:
            logger.error(f"Error cleaning stale sessions: {e}")


    async def _check_all_cameras(self):
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Camera))
            cameras = result.scalars().all()
            if not cameras:
                return

        # Staggered execution with semaphore
        tasks = [self._check_single_camera_bounded(cam_id) for cam_id in [c.id for c in cameras]]
        await asyncio.gather(*tasks, return_exceptions=True)

    async def _check_single_camera_bounded(self, camera_id: str):
        async with self._semaphore:
            await self.check_camera(camera_id)
            # Small stagger delay between camera checks
            await asyncio.sleep(0.05)

    async def check_camera(self, camera_id: str) -> dict:
        """
        Perform a single lightweight async health check for a camera and update DB + WebSocket.
        """
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Camera).where(Camera.id == camera_id))
            cam = result.scalar_one_or_none()
            if not cam:
                return {}

            # Notify frontend checking status if UNKNOWN
            now_iso = datetime.now(timezone.utc).isoformat()
            
            # Extract decrypted credentials for probing
            plain_pass = decrypt_credential(cam.password_encrypted) if cam.password_encrypted else None
            
            # Perform lightweight async probe (no video decode, 3s timeout)
            probe_result = await probe_rtsp_lightweight(
                rtsp_url=cam.rtsp_url,
                timeout=settings.HEALTH_CHECK_TIMEOUT_SECONDS,
                username=cam.username,
                password=plain_pass
            )

            previous_status = cam.status
            cam.last_checked_at = datetime.now(timezone.utc)

            is_online = bool(probe_result.get("reachable", False) and probe_result.get("stream_available", False))
            if is_online:
                cam.status = CameraStatusEnum.ONLINE
                cam.last_online_at = datetime.now(timezone.utc)
                cam.consecutive_failures = 0
                cam.last_error = None
                
                # Update telemetry if discovered
                if probe_result.get("resolution"):
                    cam.resolution = probe_result["resolution"]
                if probe_result.get("fps"):
                    cam.fps = probe_result["fps"]
                if probe_result.get("codec"):
                    cam.codec = probe_result["codec"]
            else:
                cam.consecutive_failures += 1
                cam.last_error = probe_result.get("error") or probe_result.get("details", "Live feed unavailable")
                cam.status = CameraStatusEnum.OFFLINE

            await db.commit()
            await db.refresh(cam)

            def to_utc_iso(dt):
                if not dt:
                    return None
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt.isoformat()

            last_chk_iso = to_utc_iso(cam.last_checked_at) or now_iso
            last_onl_iso = to_utc_iso(cam.last_online_at) or ""

            # Broadcast update via WebSocket if status changed or lastChecked updated
            await ws_manager.broadcast("CAMERA_STATUS_UPDATE", {
                "id": cam.id,
                "status": cam.status.value,
                "lastChecked": last_chk_iso,
                "lastOnline": last_onl_iso,
                "lastError": cam.last_error,
                "consecutiveFailures": cam.consecutive_failures,
                "resolution": cam.resolution,
                "fps": cam.fps,
                "codec": cam.codec,
                "bitrate": cam.bitrate,
                "ip": cam.ip,
                "model": cam.model
            })

            return {
                "id": cam.id,
                "status": cam.status.value,
                "lastChecked": last_chk_iso,
                "lastOnline": last_onl_iso,
                "error": cam.last_error
            }

health_manager = CameraHealthManager()
