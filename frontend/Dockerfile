# syntax=docker/dockerfile:1.7
# ================================================================
# OccuSafe frontend: Vite build served by nginx, which also
# reverse-proxies /api, /ws and /webrtc so the browser only ever
# talks to one origin (no CORS, no hard-coded hosts).
# ================================================================

# ---------- Stage 1: build static bundle ----------
FROM node:22-alpine AS build
WORKDIR /src

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

COPY . .

# Same-origin paths; nginx routes them to the backend / MediaMTX.
ARG VITE_API_BASE_URL=/api
ARG VITE_WS_URL=/ws/cameras
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    VITE_WS_URL=${VITE_WS_URL}

RUN npm run build


# ---------- Stage 2: nginx runtime ----------
FROM nginx:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1/nginx-health || exit 1
