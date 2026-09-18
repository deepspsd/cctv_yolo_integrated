# OccuSafe - Occupational Safety Monitoring System

A comprehensive CCTV-based safety monitoring platform with real-time YOLO object detection, anomaly alerts, and evidence management.

![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux-blue)
![Python](https://img.shields.io/badge/Python-3.11+-green)
![Node.js](https://img.shields.io/badge/Node.js-18+-green)

## 🚀 Quick Start Guide

### Prerequisites
- **Python 3.11+** with pip or [uv](https://docs.astral.sh/uv/getting-started/installation/)
- **Node.js 18+** with npm
- **MediaMTX** binary for RTSP streaming (included in `backend/mediamtx/`)

### 🎯 Step 1: Clone and Setup

```bash
git clone <repository-url>
cd cctv_priya_yolo_model
```

### 🎯 Step 2: Backend Setup

#### Option A: Using uv (Recommended)

```bash
cd backend
uv run uvicorn app.main:app --host 0.0.0.0 --port 5000 --reload
```

#### Option B: Using pip/Python

```bash
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 5000 --reload
```

The backend will start at:
- **API Server**: http://localhost:5000
- **API Documentation**: http://localhost:5000/docs
- **WebSocket**: ws://localhost:5000/ws/cameras

### 🎯 Step 3: MediaMTX Setup (RTSP Streaming)

MediaMTX enables real-time RTSP to WebRTC conversion for browser-based live streaming.

#### Windows:
```bash
cd backend
mediamtx\mediamtx.exe mediamtx.yml
```

#### Linux/Mac:
```bash
cd backend
# Download MediaMTX if not present
wget https://github.com/bluenviron/mediamtx/releases/latest/download/mediamtx_v1.8.4_linux_amd64.tar.gz
tar -xzf mediamtx_*.tar.gz
./mediamtx mediamtx.yml
```

MediaMTX will start with:
- **RTSP Server**: rtsp://localhost:8554
- **WebRTC (WHEP)**: http://localhost:8889
- **HLS Server**: http://localhost:8888
- **API Server**: http://localhost:9997

> **Note**: The configuration has been updated to use `rtspTransports` instead of the deprecated `protocols` parameter, and uses valid path names for camera routing.

### 🎯 Step 4: Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

The frontend will be available at: http://localhost:3000

## 🔐 Default Login Credentials

| Role | Email | Password |
|------|--------|----------|
| Administrator | admin@occusafe.internal | Security2026! |
| Surveillance Operator | operator@occusafe.internal | Watchdog2026! |
| Security Officer | elena@occusafe.internal | Sentinel2026! |

## 🏗️ Architecture Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Frontend      │    │    Backend       │    │    MediaMTX     │
│   (React/Vite)  │◄──►│   (FastAPI)      │◄──►│  (RTSP/WebRTC)  │
│   Port: 3000    │    │   Port: 5000     │    │   Port: 8889    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                        │                        │
         │                        ▼                        │
         │              ┌──────────────────┐              │
         │              │    SQLite DB     │              │
         │              │   (Cameras,      │              │
         │              │   Anomalies,     │              │
         └──────────────┤   Evidence)      │◄─────────────┘
                        └──────────────────┘
```

## 🎥 Camera Configuration

### Adding RTSP Cameras

1. **Login** to the platform at http://localhost:3000
2. **Navigate** to Cameras → Add Camera
3. **Configure** your RTSP camera:
   ```
   Camera Name: Factory Floor Cam 1
   RTSP URL: rtsp://192.168.1.100:554/stream
   Username: admin
   Password: your-camera-password
   ```

### Supported RTSP Formats
- `rtsp://ip:port/stream`
- `rtsp://username:password@ip:port/path`
- Most IP cameras (Hikvision, Dahua, Axis, etc.)

## 🚨 YOLO Safety Detection

The system uses YOLOv8 for real-time safety monitoring:

### Detected Anomalies:
- ❌ **No Hard Hat** - Workers without protective headgear
- ❌ **No Safety Vest** - Workers without high-visibility vests
- ⚠️ **Restricted Area Access** - Unauthorized zone entry
- 🔥 **Fire/Smoke Detection** - Emergency situations

### Evidence Collection:
- 📸 **Automatic Screenshots** - Captured when anomalies detected
- 🏷️ **OccuSafe® Watermarks** - Official evidence branding
- 💾 **Secure Storage** - AES-encrypted evidence files
- 📊 **IST Timestamps** - Indian Standard Time formatting

## 🛠️ Development Commands

### Backend Development
```bash
cd backend

# Run with auto-reload
uv run uvicorn app.main:app --reload

# Run tests
uv run pytest

# Check code style
uv run ruff check app/
```

### Frontend Development
```bash
cd frontend

# Development server
npm run dev

# Build for production
npm run build

# Type checking
npm run lint
```

## 📁 Project Structure

```
cctv_priya_yolo_model/
├── backend/                 # FastAPI backend
│   ├── app/
│   │   ├── routes/         # API endpoints
│   │   ├── models.py       # Database models
│   │   ├── ai_engine.py    # YOLO detection
│   │   └── main.py         # FastAPI app
│   ├── data/
│   │   └── evidence/       # Evidence storage
│   ├── mediamtx/          # Streaming server
│   └── requirements.txt   # Python dependencies
├── frontend/               # React frontend
│   ├── src/
│   │   ├── components/    # UI components
│   │   └── services/      # API services
│   └── package.json       # Node.js dependencies
└── models/                # YOLO model files
```

## 🔧 Configuration

### Environment Variables (.env)
```bash
# Backend Configuration
DATABASE_URL=sqlite:///./cctv.db
SECRET_KEY=your-secret-key-here
CORS_ORIGINS=http://localhost:3000

# YOLO Model Settings
YOLO_MODEL_PATH=../models/best.pt
CONFIDENCE_THRESHOLD=0.5
NMS_THRESHOLD=0.4

# MediaMTX Integration
MEDIAMTX_API_URL=http://localhost:9997
```

### MediaMTX Configuration (mediamtx.yml)
The configuration supports:
- **On-demand streaming** - RTSP cameras start only when viewed (requires source URL)
- **Publisher mode** - Your application can publish streams to MediaMTX
- **WebRTC low latency** - Real-time browser streaming
- **Multi-protocol support** - RTSP, HLS, WebRTC
- **Dynamic path registration** - Automatic camera discovery

#### Camera Configuration Options:

**Option 1: Direct RTSP Sources (On-demand)**
```yaml
camera1:
  source: rtsp://admin:password@192.168.1.100:554/stream
  sourceOnDemand: yes
  sourceOnDemandStartTimeout: 10s
  sourceOnDemandCloseAfter: 10s
```

**Option 2: Publisher Mode (from your application)**
```yaml
app_camera1:
  maxReaders: 50
```

## 🚀 Production Deployment

### Docker Deployment (Coming Soon)
```bash
# Build and run with docker-compose
docker-compose up -d
```

### Manual Production Setup
1. **Backend**: Use Gunicorn with multiple workers
2. **Frontend**: Build static files with `npm run build`
3. **Database**: Consider PostgreSQL for production
4. **Reverse Proxy**: Use Nginx for SSL and load balancing

## 📊 Features

### 🎯 Real-Time Monitoring
- Live RTSP camera feeds via WebRTC
- Real-time anomaly detection with YOLO
- WebSocket-based alert notifications
- Multi-camera dashboard view

### 🔐 Security & Authentication
- JWT-based authentication system
- Role-based access control (Admin, Operator, Officer)
- AES-encrypted evidence storage
- Secure RTSP credential management

### 📈 Analytics & Reporting
- Anomaly statistics and trends
- Evidence photo gallery with filters
- Export capabilities with official watermarks
- Indian Standard Time (IST) formatting

### 🎨 Modern UI/UX
- Dark/Light theme support
- Responsive design for mobile/desktop
- Real-time sound notifications
- Keyboard shortcuts for power users

## 🐛 Troubleshooting

### Common Issues:

**Backend won't start:**
```bash
# Check Python version
python --version  # Should be 3.11+

# Install dependencies
pip install -r backend/requirements.txt
```

**MediaMTX connection failed:**
```bash
# Ensure MediaMTX is running
cd backend
mediamtx\mediamtx.exe mediamtx.yml

# Check if port 8889 is available
netstat -an | findstr 8889
```

**Camera connection issues:**
- Verify RTSP URL format
- Check network connectivity to camera
- Ensure camera credentials are correct
- Test with VLC media player first

**YOLO model not found:**
- Ensure model file exists at `models/best.pt`
- Check file permissions
- Verify model format compatibility

## 📝 License

This project is proprietary software for Priya Textiles CCTV monitoring system.

## 🤝 Support

For technical support or feature requests, contact the development team.

---

**OccuSafe - Occupational Safety Monitoring** | *Keeping workplaces safe with AI-powered surveillance*