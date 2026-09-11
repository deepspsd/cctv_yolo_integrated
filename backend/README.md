# CCTV Camera Management Backend

FastAPI + SQLite backend with asynchronous health checks, AES-GCM encrypted camera credentials, MediaMTX WebRTC support, and real-time WebSocket telemetry.

## Quick Start (Recommended with uv)

1. Navigate to backend directory:
```bash
cd backend
```

2. Run development server:
```bash
uv run uvicorn app.main:app --host 0.0.0.0 --port 5000 --reload
```
or simply:
```bash
uv run python app/main.py
```

Server runs at:
- API: `http://localhost:5000`
- Swagger Docs: `http://localhost:5000/docs`
- WebSocket: `ws://localhost:5000/ws/cameras`

---

## Run with Standard pip / Python

```bash
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --port 5000 --reload
```

---

## Run Pytest Tests

```bash
cd backend
uv run pytest
```

---

## MediaMTX (Optional WebRTC RTSP Streaming Layer)

Download MediaMTX binary and run with config:
```bash
mediamtx backend/mediamtx.yml
```
WebRTC WHEP endpoint: `http://localhost:8889`
