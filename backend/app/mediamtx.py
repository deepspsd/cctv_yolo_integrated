import httpx
import logging
from app.config import settings
from app.security import decrypt_credential, build_authenticated_rtsp_url

logger = logging.getLogger("mediamtx")

class MediaMTXManager:
    """
    Integrates with MediaMTX REST API to dynamically configure RTSP paths on-demand.
    Enables low-latency WebRTC streaming without decoding video on the Python server.
    """
    def __init__(self):
        self.api_url = settings.MEDIAMTX_API_URL.rstrip('/')
        self.whep_url = settings.MEDIAMTX_WHEP_URL.rstrip('/')

    def get_stream_path(self, camera_id: str) -> str:
        # Standardize path name: camera/<camera_id>
        clean_id = camera_id.replace('-', '_').lower()
        return f"camera/{clean_id}"

    def get_whep_endpoint(self, camera_id: str) -> str:
        path = self.get_stream_path(camera_id)
        return f"{self.whep_url}/{path}/whep"

    async def register_camera_path(self, camera_id: str, rtsp_url: str, username: str | None = None, password: str | None = None) -> bool:
        """
        Registers or updates path in MediaMTX with sourceOnDemand=yes.
        MediaMTX will only connect to the camera when a user actively views the stream!
        """
        path_name = self.get_stream_path(camera_id)
        auth_url = build_authenticated_rtsp_url(rtsp_url, username, password)

        payload = {
            "source": auth_url,
            "sourceOnDemand": True,
            "sourceOnDemandStartTimeout": "10s",
            "sourceOnDemandCloseAfter": "10s",
            # Never record by default
            "record": False
        }

        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                # First check if path exists
                resp = await client.get(f"{self.api_url}/v3/config/paths/get/{path_name}")
                if resp.status_code == 200:
                    # Update existing path
                    patch_resp = await client.patch(
                        f"{self.api_url}/v3/config/paths/patch/{path_name}",
                        json=payload
                    )
                    logger.info(f"MediaMTX path updated: {path_name} (Status: {patch_resp.status_code})")
                    return patch_resp.status_code in (200, 201)
                else:
                    # Add new path
                    add_resp = await client.post(
                        f"{self.api_url}/v3/config/paths/add/{path_name}",
                        json=payload
                    )
                    logger.info(f"MediaMTX path added: {path_name} (Status: {add_resp.status_code})")
                    return add_resp.status_code in (200, 201)
        except Exception as e:
            # If MediaMTX is not running locally yet, log gracefully
            logger.warning(f"Could not reach MediaMTX API at {self.api_url}: {e}")
            return False

    async def remove_camera_path(self, camera_id: str) -> bool:
        path_name = self.get_stream_path(camera_id)
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.delete(f"{self.api_url}/v3/config/paths/delete/{path_name}")
                return resp.status_code in (200, 204)
        except Exception as e:
            logger.warning(f"Error removing path from MediaMTX: {e}")
            return False

mediamtx_manager = MediaMTXManager()
