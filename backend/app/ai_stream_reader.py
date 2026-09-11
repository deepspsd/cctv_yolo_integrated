import os
import time
import queue
import logging
import threading
from typing import Optional, Dict, Any

import cv2
import numpy as np

from app.config import settings
from app.mediamtx import mediamtx_manager

logger = logging.getLogger("ai_stream_reader")

class CameraStreamReader:
    """
    Continuous background RTSP stream reader for a single CCTV camera.
    Maintains bounded frame buffer (maxsize=2) with latest-frame-wins behavior.
    Drops stale frames to guarantee zero lag and real-time freshness.
    """
    def __init__(self, camera_id: str, camera_name: str, direct_rtsp_url: str):
        self.camera_id = camera_id
        self.camera_name = camera_name
        self.direct_rtsp_url = direct_rtsp_url
        
        # Determine preferred MediaMTX RTSP URL vs direct
        clean_id = camera_id.replace("-", "_").lower()
        self.mediamtx_rtsp_url = f"rtsp://127.0.0.1:{settings.MEDIAMTX_RTSP_PORT}/camera/{clean_id}"

        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()

        # Bounded frame buffer (maxsize = 2)
        self.frame_queue: queue.Queue = queue.Queue(maxsize=settings.AI_MAX_FRAME_QUEUE)

        # Performance & telemetry metrics
        self.frames_received = 0
        self.frames_dropped = 0
        self.last_frame_time = 0.0
        self.is_connected = False
        self.last_error: Optional[str] = None
        self.reconnect_delay = 2.0

    def start(self):
        if not self._running:
            self._running = True
            self._thread = threading.Thread(
                target=self._capture_worker,
                name=f"ai_reader_{self.camera_id}",
                daemon=True
            )
            self._thread.start()
            logger.info(f"Stream reader started for camera {self.camera_id} ({self.camera_name})")

    def stop(self):
        self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        self._clear_queue()
        self.is_connected = False
        logger.info(f"Stream reader stopped for camera {self.camera_id}")

    def _clear_queue(self):
        while not self.frame_queue.empty():
            try:
                self.frame_queue.get_nowait()
            except queue.Empty:
                break

    def get_latest_frame(self) -> Optional[np.ndarray]:
        """
        Pulls latest available frame. Drains older frame if present.
        """
        frame = None
        while not self.frame_queue.empty():
            try:
                frame = self.frame_queue.get_nowait()
            except queue.Empty:
                break
        return frame

    def _get_active_stream_url(self) -> str:
        # Shared MediaMTX source first; capture loop falls back to direct RTSP.
        return self.mediamtx_rtsp_url

    def _capture_worker(self):
        """
        Background capture loop. Connects to RTSP, decodes frames,
        and pushes to bounded queue with stale frame drop.
        """
        # Low latency RTSP transport
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|fflags;nobuffer|flags;low_delay|analyzeduration;1000000|probesize;1000000|max_delay;0"

        if settings.AI_MOCK_MODE:
            self._mock_capture_worker()
            return

        while self._running:
            target_url = self._get_active_stream_url()
            cap = None
            try:
                cap = cv2.VideoCapture(target_url, cv2.CAP_FFMPEG)
                # Lower internal buffer size to 1 frame for real-time operation
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

                if not cap.isOpened() and target_url != self.direct_rtsp_url:
                    cap.release()
                    target_url = self.direct_rtsp_url
                    cap = cv2.VideoCapture(target_url, cv2.CAP_FFMPEG)
                if not cap.isOpened():
                    self.is_connected = False
                    self.last_error = "Could not open RTSP stream"
                    time.sleep(self.reconnect_delay)
                    continue

                self.is_connected = True
                self.last_error = None
                logger.info(f"RTSP stream connected for camera {self.camera_id}")

                while self._running:
                    ret, frame = cap.read()
                    if not ret or frame is None or frame.size == 0:
                        logger.warning(f"RTSP read error on camera {self.camera_id}, reconnecting...")
                        self.is_connected = False
                        break

                    now = time.monotonic()
                    self.frames_received += 1
                    self.last_frame_time = now

                    # Downsample frame if larger than configured image size for CPU/GPU efficiency
                    h, w = frame.shape[:2]
                    target_size = settings.AI_IMAGE_SIZE
                    if w > target_size:
                        scale = target_size / w
                        frame = cv2.resize(frame, (target_size, int(h * scale)), interpolation=cv2.INTER_LINEAR)

                    # Bounded queue insertion with drop-stale-frame logic
                    if self.frame_queue.full():
                        try:
                            self.frame_queue.get_nowait()
                            self.frames_dropped += 1
                        except queue.Empty:
                            pass

                    try:
                        self.frame_queue.put_nowait(frame)
                    except queue.Full:
                        self.frames_dropped += 1

            except Exception as e:
                self.is_connected = False
                self.last_error = str(e)
                logger.debug(f"Capture error on camera {self.camera_id}: {e}")
            finally:
                if cap is not None:
                    try:
                        cap.release()
                    except Exception:
                        pass
                self.is_connected = False

            if self._running:
                time.sleep(self.reconnect_delay)

    def _mock_capture_worker(self):
        """Synthetic bounded stream for scheduler tests; never used in production."""
        frame_no = 0
        while self._running:
            self.is_connected = True
            frame = np.zeros((360, 640, 3), dtype=np.uint8)
            x = 80 + ((frame_no * 7) % 360)
            cv2.rectangle(frame, (x, 70), (x + 120, 320), (80, 80, 80), -1)
            cv2.putText(frame, self.camera_name, (12, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (220, 220, 220), 2)
            self.frames_received += 1
            self.last_frame_time = time.monotonic()
            if self.frame_queue.full():
                try:
                    self.frame_queue.get_nowait()
                    self.frames_dropped += 1
                except queue.Empty:
                    pass
            try:
                self.frame_queue.put_nowait(frame)
            except queue.Full:
                self.frames_dropped += 1
            frame_no += 1
            time.sleep(1 / 15)
        self.is_connected = False

    def get_metrics(self) -> Dict[str, Any]:
        return {
            "camera_id": self.camera_id,
            "connected": self.is_connected,
            "frames_received": self.frames_received,
            "frames_dropped": self.frames_dropped,
            "queue_depth": self.frame_queue.qsize(),
            "last_error": self.last_error
        }
