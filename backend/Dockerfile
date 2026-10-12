# syntax=docker/dockerfile:1.7
# ================================================================
# OccuSafe backend (FastAPI + YOLO inference)
# Build context: repository root (needs ../models next to backend/)
#   docker build -f backend/Dockerfile -t occusafe-backend .
# ================================================================

FROM ghcr.io/astral-sh/uv:0.12.9 AS uv

# ---------- Stage 1: resolve and install Python dependencies ----------
FROM python:3.12-slim-bookworm AS builder

COPY --from=uv /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv

WORKDIR /build

# Dependencies only (project itself is not packaged), installed from the lockfile
# so the image gets exactly the torch/CUDA build used in development.
COPY backend/pyproject.toml backend/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev

# Pre-fetch torchvision MobileNetV3 weights used by the Re-ID pipeline so the
# container never needs internet access at runtime.
ENV TORCH_HOME=/opt/torch
RUN /opt/venv/bin/python -c "import torchvision.models as m; m.mobilenet_v3_small(weights=m.MobileNet_V3_Small_Weights.DEFAULT)"


# ---------- Stage 2: slim runtime ----------
FROM python:3.12-slim-bookworm AS runtime

# libGL/glib are required by opencv-python (pulled in by ultralytics);
# curl is used by the container healthcheck.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libgomp1 curl tini \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --home-dir /app --shell /usr/sbin/nologin app

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TORCH_HOME=/opt/torch \
    YOLO_CONFIG_DIR=/tmp/ultralytics \
    MPLCONFIGDIR=/tmp/matplotlib \
    PORT=5000 \
    CAMERA_DB_PATH=/app/data/cameras.db \
    AI_EVIDENCE_DIR=/app/data/evidence \
    AI_MODEL_PATH=/app/models/ppe.pt \
    AI_PHONE_MODEL_PATH=/app/models/phone.pt \
    AI_COCO_MODEL_PATH=/app/models/yolov8n.pt

COPY --from=builder /opt/venv /opt/venv
COPY --from=builder /opt/torch /opt/torch

WORKDIR /app
COPY --chown=app:app backend/app ./app
COPY --chown=app:app models ./models

RUN mkdir -p /app/data/evidence && chown -R app:app /app/data

USER app

VOLUME ["/app/data"]
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/health" || exit 1

# Single worker on purpose: the AI engine, health manager and WebSocket
# broadcaster are in-process singletons and must not be duplicated.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1 --proxy-headers --forwarded-allow-ips='*' --no-server-header"]
