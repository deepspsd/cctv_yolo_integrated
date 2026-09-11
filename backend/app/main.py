import logging
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, func

from app.config import settings
from app.database import engine, Base, AsyncSessionLocal
from app.models import Camera
from app.routes.cameras import router as cameras_router
from app.routes.auth import router as auth_router, seed_default_users
from app.routes.ai import router as ai_router
from app.routes.anomalies import router as anomalies_router
from app.health_manager import health_manager
from app.ai_engine import ai_engine
from app.websocket_manager import ws_manager
from fastapi.staticfiles import StaticFiles
from pathlib import Path

# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("main")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing database tables...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as db:
        # Seed default operator accounts if users table is empty
        await seed_default_users(db)
        # Note: Do not auto-seed cameras; database remains clean for user-configured cameras

    # Start asynchronous background camera health checker
    health_manager.start()

    # Start asynchronous low-load AI inference engine (YOLOv8 + PPE)
    ai_engine.start()

    yield

    # Shutdown
    logger.info("Shutting down background tasks...")
    await ai_engine.stop()
    await health_manager.stop()
    await engine.dispose()
    logger.info("Application shutdown complete.")

app = FastAPI(
    title=settings.PROJECT_NAME,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc"
)

# CORS middleware - privacy-first, allow localhost + local LAN access + specified origins
clean_origins = [orig for orig in settings.CORS_ORIGINS if orig != "*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=clean_origins,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
    expose_headers=["Content-Range", "X-Total-Count"],
)

# Include API routes
app.include_router(auth_router, prefix=settings.API_V1_STR)
app.include_router(cameras_router, prefix=settings.API_V1_STR)
app.include_router(ai_router, prefix=settings.API_V1_STR)
app.include_router(anomalies_router, prefix=settings.API_V1_STR)

# Mount evidence snapshots directory for local inspection
evidence_dir = Path(settings.AI_EVIDENCE_DIR)
evidence_dir.mkdir(parents=True, exist_ok=True)
app.mount("/data/evidence", StaticFiles(directory=str(evidence_dir)), name="evidence")


# Real-time WebSocket endpoint — token validated via ?token= query param
@app.websocket("/ws/cameras")
async def websocket_cameras_endpoint(websocket: WebSocket, token: str | None = None):
    # Validate JWT before accepting connection
    if not token:
        await websocket.accept()
        await websocket.close(code=4001, reason="Missing authentication token.")
        return
    try:
        from app.auth import decode_access_token
        decode_access_token(token)
    except Exception as e:
        logger.debug(f"WS auth token rejected: {e}")
        await websocket.accept()
        await websocket.close(code=4001, reason="Invalid or expired token.")
        return

    await ws_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
            elif data.startswith("{"):
                try:
                    import json
                    msg = json.loads(data)
                    if msg.get("action") == "DETECT_FRAME" and "image" in msg:
                        cam_id = msg.get("cameraId", "")
                        cam_code = msg.get("cameraCode", "CAM")
                        loop = asyncio.get_running_loop()
                        ai_state = await loop.run_in_executor(
                            None, ai_engine.process_b64_frame, cam_id, cam_code, msg["image"]
                        )
                        await websocket.send_text(json.dumps({
                            "type": "CAMERA_AI_UPDATE",
                            "payload": ai_state
                        }))
                except Exception as e:
                    logger.debug(f"WS frame detection error: {e}")
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception as e:
        logger.warning(f"WebSocket client error: {e}")
        ws_manager.disconnect(websocket)


@app.get("/health")
@app.get("/api/health")
async def health_check():
    import httpx
    db_status = "ok"
    try:
        async with AsyncSessionLocal() as db:
            await db.execute(select(func.count(Camera.id)))
    except Exception:
        db_status = "error"

    streaming_status = "ok"
    try:
        async with httpx.AsyncClient(timeout=1.0) as client:
            resp = await client.get(f"{settings.MEDIAMTX_API_URL}/v3/config/global/get")
            if resp.status_code != 200:
                streaming_status = "degraded"
    except Exception:
        streaming_status = "unavailable"

    overall = "ok" if db_status == "ok" else "degraded"
    return {
        "status": overall,
        "database": db_status,
        "streaming_service": streaming_status,
        "camera_health_manager": "running" if health_manager._running else "stopped",
        "ai_inference_engine": "running" if ai_engine._running else "stopped"
    }


@app.get("/")
async def root():
    return {
        "message": "CCTV Priya Textiles Camera Management API is running",
        "docs": "/docs",
        "websocket": "/ws/cameras"
    }

if __name__ == "__main__":
    import uvicorn
    import sys
    from pathlib import Path

    backend_dir = Path(__file__).resolve().parent.parent
    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))

    uvicorn.run("app.main:app", host="0.0.0.0", port=settings.PORT, reload=True)
