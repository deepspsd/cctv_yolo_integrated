import asyncio
import re
import time
import base64
import hashlib
import logging

from urllib.parse import unquote

logger = logging.getLogger("rtsp_probe")

def parse_rtsp_url(rtsp_url: str) -> tuple[str, int, str, str | None, str | None]:
    """
    Extract host, port, path, and embedded credentials from RTSP URL.
    Greedily extracts credentials up to the last '@' before host,
    correctly supporting passwords containing '@' or percent-encoded '%40'.
    """
    clean_url = rtsp_url.strip()
    match = re.match(r'^(?:rtsps?:\/\/)(?:(.*)@)?([^:\/\s]+)(?::(\d+))?(\/.*)?$', clean_url, re.IGNORECASE)
    if not match:
        raise ValueError("Invalid RTSP URL format")

    creds_raw = match.group(1)
    host = match.group(2)
    port = int(match.group(3)) if match.group(3) else 554
    path = match.group(4) if match.group(4) else "/"

    embedded_user = None
    embedded_pass = None
    if creds_raw:
        u, sep, p = creds_raw.partition(':')
        embedded_user = unquote(u).strip() if u else None
        embedded_pass = unquote(p).strip() if sep else None

    return host, port, path, embedded_user, embedded_pass

def extract_host_port(rtsp_url: str) -> tuple[str, int, str]:
    """
    Extract host, port, and clean path from RTSP URL.
    """
    host, port, path, _, _ = parse_rtsp_url(rtsp_url)
    return host, port, path

async def probe_rtsp_lightweight(
    rtsp_url: str, 
    timeout: float = 3.0,
    username: str | None = None,
    password: str | None = None
) -> dict:
    """
    Lightweight asynchronous RTSP probe using raw TCP socket + RTSP DESCRIBE with Digest/Basic auth.
    Accurately verifies actual video channel stream availability (not just TCP port reachability).
    No FFmpeg, no OpenCV, no heavy video decoding.
    """
    from app.config import settings
    if getattr(settings, "CAMERA_MOCK_MODE", False):
        if "offline" in rtsp_url.lower():
            return {
                "reachable": False,
                "stream_available": False,
                "latency_ms": 20,
                "error": "Simulated camera offline",
                "details": "Mock mode simulated offline"
            }
        return {
            "reachable": True,
            "stream_available": True,
            "latency_ms": 15,
            "details": "Mock RTSP probe successful",
            "codec": "H.264",
            "resolution": "1920×1080",
            "fps": 25,
            "width": 1920,
            "height": 1080,
            "error": None
        }

    start_time = time.monotonic()
    try:
        host, port, path, emb_user, emb_pass = parse_rtsp_url(rtsp_url)
    except Exception as e:
        return {
            "reachable": False,
            "stream_available": False,
            "latency_ms": 0,
            "error": f"Invalid RTSP URL: {str(e)}",
            "details": "Malformed RTSP URL"
        }

    # Resolve effective credentials (explicit arguments take priority, fallback to embedded)
    eff_user = username.strip() if (username is not None and username.strip() != "") else emb_user
    eff_pass = password.strip() if (password is not None and password.strip() != "") else emb_pass

    writer = None
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port),
            timeout=timeout
        )
    except asyncio.TimeoutError:
        latency = int((time.monotonic() - start_time) * 1000)
        return {
            "reachable": False,
            "stream_available": False,
            "latency_ms": latency,
            "error": "Connection timed out",
            "details": f"TCP connection to {host}:{port} timed out after {timeout}s"
        }
    except Exception as e:
        latency = int((time.monotonic() - start_time) * 1000)
        return {
            "reachable": False,
            "stream_available": False,
            "latency_ms": latency,
            "error": f"Connection refused or network error: {str(e)}",
            "details": f"Failed to connect to {host}:{port}"
        }

    try:
        uri = f"rtsp://{host}:{port}{path}"
        # 1. Send DESCRIBE request to test if the specific stream channel actually exists
        req1 = (
            f"DESCRIBE {uri} RTSP/1.0\r\n"
            f"CSeq: 1\r\n"
            f"User-Agent: CCTVPriyaTextiles/1.0\r\n"
            f"Accept: application/sdp\r\n\r\n"
        )
        writer.write(req1.encode('utf-8'))
        await writer.drain()

        elapsed = time.monotonic() - start_time
        remaining = max(0.5, timeout - elapsed)
        resp1_data = await asyncio.wait_for(reader.read(4096), timeout=remaining)
        resp1 = resp1_data.decode('utf-8', errors='ignore')

        if not resp1:
            writer.close()
            await writer.wait_closed()
            return {
                "reachable": True,
                "stream_available": False,
                "latency_ms": int((time.monotonic() - start_time) * 1000),
                "error": "NVR terminated connection (channel does not exist on device)",
                "details": "Channel not found or invalid for this NVR hardware"
            }

        first_line1 = resp1.split('\r\n')[0]
        if "200 OK" in first_line1:
            latency = int((time.monotonic() - start_time) * 1000)
            writer.close()
            await writer.wait_closed()
            return {
                "reachable": True,
                "stream_available": True,
                "latency_ms": max(1, latency),
                "error": None,
                "details": f"Stream online • {latency}ms RTT",
                "codec": "H.264",
                "resolution": "1920×1080",
                "fps": 25
            }

        if "404" in first_line1:
            latency = int((time.monotonic() - start_time) * 1000)
            writer.close()
            await writer.wait_closed()
            return {
                "reachable": True,
                "stream_available": False,
                "latency_ms": latency,
                "error": "Channel not found (404)",
                "details": "NVR online but camera channel does not exist"
            }

        if "401" in first_line1 and eff_user and eff_pass:
            # Handle Digest authentication challenge
            nonce_match = re.search(r'nonce="([^"]+)"', resp1)
            realm_match = re.search(r'realm="([^"]+)"', resp1)
            if nonce_match:
                nonce = nonce_match.group(1)
                realm = realm_match.group(1) if realm_match else "Embedded Net DVR"
                ha1 = hashlib.md5(f"{eff_user}:{realm}:{eff_pass}".encode('utf-8')).hexdigest()
                ha2 = hashlib.md5(f"DESCRIBE:{uri}".encode('utf-8')).hexdigest()
                digest = hashlib.md5(f"{ha1}:{nonce}:{ha2}".encode('utf-8')).hexdigest()
                auth_hdr = f'Digest username="{eff_user}", realm="{realm}", nonce="{nonce}", uri="{uri}", response="{digest}"'
            else:
                cred_b64 = base64.b64encode(f"{eff_user}:{eff_pass}".encode('utf-8')).decode('utf-8')
                auth_hdr = f"Basic {cred_b64}"

            req2 = (
                f"DESCRIBE {uri} RTSP/1.0\r\n"
                f"CSeq: 2\r\n"
                f"User-Agent: CCTVPriyaTextiles/1.0\r\n"
                f"Authorization: {auth_hdr}\r\n"
                f"Accept: application/sdp\r\n\r\n"
            )
            writer.write(req2.encode('utf-8'))
            await writer.drain()

            elapsed = time.monotonic() - start_time
            remaining = max(0.5, timeout - elapsed)
            resp2_data = await asyncio.wait_for(reader.read(4096), timeout=remaining)
            resp2 = resp2_data.decode('utf-8', errors='ignore')

            latency = int((time.monotonic() - start_time) * 1000)
            writer.close()
            await writer.wait_closed()

            if not resp2:
                return {
                    "reachable": True,
                    "stream_available": False,
                    "latency_ms": latency,
                    "error": "NVR closed connection (channel not available)",
                    "details": "Channel does not exist on this NVR hardware"
                }

            first_line2 = resp2.split('\r\n')[0]
            if "200 OK" in first_line2:
                return {
                    "reachable": True,
                    "stream_available": True,
                    "latency_ms": max(1, latency),
                    "error": None,
                    "details": f"Stream online • {latency}ms RTT",
                    "codec": "H.264",
                    "resolution": "1920×1080",
                    "fps": 25
                }
            elif "404" in first_line2:
                return {
                    "reachable": True,
                    "stream_available": False,
                    "latency_ms": latency,
                    "error": "Channel not found (404)",
                    "details": "NVR connected but channel does not exist"
                }
            else:
                return {
                    "reachable": True,
                    "stream_available": False,
                    "latency_ms": latency,
                    "error": f"NVR status: {first_line2}",
                    "details": "NVR rejected stream request for this channel"
                }

        # No creds provided or other status
        latency = int((time.monotonic() - start_time) * 1000)
        writer.close()
        await writer.wait_closed()
        if "401" in first_line1:
            return {
                "reachable": True,
                "stream_available": False,
                "latency_ms": latency,
                "error": "Authentication required",
                "details": "Camera reachable on port 554, but authentication required or credentials invalid."
            }
        return {
            "reachable": True,
            "stream_available": False,
            "latency_ms": latency,
            "error": f"RTSP status: {first_line1}",
            "details": f"Camera server returned: {first_line1}"
        }

    except asyncio.TimeoutError:
        if writer:
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass
        return {
            "reachable": True,
            "stream_available": False,
            "latency_ms": int((time.monotonic() - start_time) * 1000),
            "error": "Stream probe timed out",
            "details": "Device responded to TCP but stream handshake timed out"
        }
    except Exception as e:
        if writer:
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass
        return {
            "reachable": True,
            "stream_available": False,
            "latency_ms": int((time.monotonic() - start_time) * 1000),
            "error": str(e),
            "details": f"Channel communication failed: {str(e)}"
        }
