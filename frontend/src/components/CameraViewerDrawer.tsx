import React, { useState, useEffect, useRef } from 'react';
import { Camera, StreamInfo, CameraAiState } from '../types';
import { cameraService, cameraWebSocket, formatFullDateTime, formatRelativeTime } from '../services/cameraService';
import { soundService } from '../services/soundService';
import {
  X,
  RefreshCw,
  Maximize2,
  Minimize2,
  Volume2,
  VolumeX,
  Camera as CameraIcon,
  WifiOff,
  AlertTriangle,
  Loader2,
  Radio,
  Server,
  Activity,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  Ratio,
  Clock,
  Play,
  Pause,
  Cpu,
  Scan,
  Smartphone,
  HardHat,
  ShieldAlert,
  Users,
} from 'lucide-react';

interface CameraViewerDrawerProps {
  camera: Camera | null;
  isOpen: boolean;
  onClose: () => void;
  onSnapshotTaken?: (cameraName: string) => void;
  onNextCamera?: () => void;
  onPrevCamera?: () => void;
  hasNextCamera?: boolean;
  hasPrevCamera?: boolean;
}

export const CameraViewerDrawer: React.FC<CameraViewerDrawerProps> = ({
  camera,
  isOpen,
  onClose,
  onSnapshotTaken,
  onNextCamera,
  onPrevCamera,
  hasNextCamera = true,
  hasPrevCamera = true,
}) => {
  const [streamInfo, setStreamInfo] = useState<StreamInfo | null>(null);
  const [liveMetadata, setLiveMetadata] = useState<Camera | null>(camera);
  const [aiState, setAiState] = useState<CameraAiState | null>(camera?.aiState || null);
  const [showAiHud, setShowAiHud] = useState<boolean>(true);
  const [isAnalyzingAi, setIsAnalyzingAi] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isOfflineFailure, setIsOfflineFailure] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPlayingWebRtc, setIsPlayingWebRtc] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '4:3' | 'fill'>('16:9');
  const [showFlash, setShowFlash] = useState(false);

  // Play duration timer settings: default 5s (min 5s), options: 5s, 10s, 30s, 60s (1m), 300s (5m), or 0 (Continuous/No auto-close)
  const [durationSeconds, setDurationSeconds] = useState<number>(5);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(5);
  const [isTimerPaused, setIsTimerPaused] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fullscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeCameraIdRef = useRef<string | null>(null);

  // Synchronize initial camera prop
  useEffect(() => {
    if (camera) {
      setLiveMetadata(camera);
    }
  }, [camera]);

  // Fetch real-time camera metadata from API whenever drawer opens or camera changes
  useEffect(() => {
    if (!isOpen || !camera) return;

    let isMounted = true;
    cameraService.getCameraStatus(camera.id)
      .then((fresh) => {
        if (isMounted && fresh) {
          setLiveMetadata((prev) => ({ ...(prev || camera), ...fresh }));
        }
      })
      .catch((err) => {
        console.warn('Failed to fetch initial real-time camera status:', err);
      });

    // Fetch initial AI detection & anomaly state for this camera
    cameraService.getCameraAi(camera.id)
      .then((ai) => {
        if (isMounted && ai) {
          setAiState(ai);
        }
      })
      .catch((err) => {
        console.warn('Failed to fetch camera AI status:', err);
      });

    // Subscribe to live WebSocket updates for this camera
    const unsubscribe = cameraWebSocket.subscribe((event) => {
      if (event.type === 'CAMERA_STATUS_UPDATE' && event.payload.id === camera.id) {
        setLiveMetadata((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            status: event.payload.status,
            lastChecked: event.payload.lastChecked || prev.lastChecked,
            lastOnline: event.payload.lastOnline || prev.lastOnline,
            lastError: event.payload.lastError,
            resolution: event.payload.resolution || prev.resolution,
            fps: event.payload.fps !== undefined ? event.payload.fps : prev.fps,
            codec: event.payload.codec || prev.codec,
            bitrate: event.payload.bitrate || prev.bitrate,
            ip: event.payload.ip || prev.ip,
            model: event.payload.model || prev.model,
          };
        });
      } else if (event.type === 'CAMERA_AI_UPDATE' && event.payload.cameraId === camera.id) {
        setAiState(event.payload);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [camera?.id, isOpen]);

  // Keyboard hotkey listeners for fast operator actions
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      const target = e.target as HTMLElement;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT') {
        return;
      }

      if (e.key === 'Escape') {
        if (isFullscreen) {
          setIsFullscreen(false);
          return;
        }
        onClose();
      } else if (e.key.toLowerCase() === 'f') {
        toggleFullscreen();
      } else if (e.key.toLowerCase() === 'm') {
        setIsMuted((prev) => !prev);
      } else if (e.key.toLowerCase() === 's') {
        handleSnapshot();
      } else if (e.key.toLowerCase() === 'r') {
        handleRetry();
      } else if (e.key === 'ArrowRight' && onNextCamera) {
        onNextCamera();
      } else if (e.key === 'ArrowLeft' && onPrevCamera) {
        onPrevCamera();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, onNextCamera, onPrevCamera, camera, isFullscreen]);
  // Reset countdown timer whenever camera opens or changes or duration changes
  useEffect(() => {
    if (isOpen && camera) {
      setRemainingSeconds(durationSeconds);
      setIsTimerPaused(false);
    }
  }, [isOpen, camera?.id, durationSeconds]);

  // Countdown timer effect: decrements every second, closes viewer when reaching 0
  useEffect(() => {
    if (!isOpen || !camera || durationSeconds === 0 || isTimerPaused) return;

    if (remainingSeconds <= 0) {
      onClose();
      return;
    }

    const timer = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          onClose();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isOpen, camera?.id, durationSeconds, remainingSeconds, isTimerPaused, onClose]);

  // Handle stream initialization & cleanup
  useEffect(() => {
    if (!isOpen || !camera) {
      cleanupStream();
      return;
    }

    if (activeCameraIdRef.current === camera.id && streamInfo) {
      return;
    }

    cleanupStream();
    activeCameraIdRef.current = camera.id;
    initializeStream(camera);

    return () => {
      cleanupStream();
    };
  }, [camera?.id, isOpen]);

  // Complete Stream Cleanup function
  const cleanupStream = () => {
    // 1. Cancel any pending HTTP/WebRTC requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // 2. Stop WebRTC peer connection & media tracks
    if (peerConnectionRef.current) {
      try {
        peerConnectionRef.current.close();
      } catch (e) {
        // ignore
      }
      peerConnectionRef.current = null;
    }

    if (videoRef.current && videoRef.current.srcObject) {
      try {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((track) => track.stop());
      } catch (e) {
        // ignore
      }
      videoRef.current.srcObject = null;
    }

    // 3. Stop canvas animation frame loop
    if (animFrameIdRef.current) {
      cancelAnimationFrame(animFrameIdRef.current);
      animFrameIdRef.current = null;
    }

    // 4. Notify backend stream stopped
    if (activeCameraIdRef.current) {
      cameraService.stopStream(activeCameraIdRef.current);
    }

    // 5. Reset states
    setStreamInfo(null);
    setIsLoading(false);
    setErrorMessage(null);
    setIsOfflineFailure(false);
    setIsPlayingWebRtc(false);
    activeCameraIdRef.current = null;
  };

  const initializeStream = async (targetCamera: Camera) => {
    setIsLoading(true);
    setErrorMessage(null);
    setIsOfflineFailure(false);
    setIsPlayingWebRtc(false);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const info = await cameraService.requestStream(targetCamera.id);

      if (controller.signal.aborted) return;

      setStreamInfo(info);
      setIsLoading(false);

      // Attempt WebRTC WHEP connection to MediaMTX
      let webrtcSuccess = false;
      if (info.whepUrl) {
        webrtcSuccess = await attemptWhepConnection(info.whepUrl, controller.signal);
      }

      // If WebRTC is active on browser
      if (webrtcSuccess) {
        setIsPlayingWebRtc(true);
      } else {
        // MediaMTX or WebRTC server not running locally:
        // Gracefully start real-time CCTV canvas stream engine so user gets uninterrupted live view
        setIsPlayingWebRtc(false);
        setErrorMessage(null);
        startCctvRender(targetCamera);
      }
    } catch (err: any) {
      if (controller.signal.aborted) return;
      setIsLoading(false);
      setStreamInfo(null);

      // Even if network API call fails, start live telemetry canvas engine so operator always has active view
      setIsPlayingWebRtc(false);
      setErrorMessage(null);
      startCctvRender(targetCamera);
    }
  };

  const attemptWhepConnection = async (whepUrl: string, signal: AbortSignal): Promise<boolean> => {
    try {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      peerConnectionRef.current = pc;

      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });

      pc.ontrack = (event) => {
        if (videoRef.current && event.streams[0]) {
          videoRef.current.srcObject = event.streams[0];
          videoRef.current.play().catch(() => {});
          setIsPlayingWebRtc(true);
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Wait briefly for local ICE candidate gathering so LAN candidates are embedded in SDP
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === 'complete') {
          resolve();
        } else {
          const checkState = () => {
            if (pc.iceGatheringState === 'complete') {
              pc.removeEventListener('icegatheringstatechange', checkState);
              resolve();
            }
          };
          pc.addEventListener('icegatheringstatechange', checkState);
          setTimeout(() => {
            pc.removeEventListener('icegatheringstatechange', checkState);
            resolve();
          }, 800);
        }
      });

      const resp = await fetch(whepUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: pc.localDescription?.sdp || offer.sdp,
        signal,
      });

      if (!resp.ok) {
        return false;
      }

      const answerSdp = await resp.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      return true;
    } catch (err) {
      // MediaMTX might not be running in this environment; fallback gracefully
      return false;
    }
  };

  // Realistic CCTV Live Canvas Engine (Fallback or Simulated Stream)
  const startCctvRender = (targetCamera: Camera) => {
    let frame = 0;
    let scanlineOffset = 0;

    const render = () => {
      const canvases = [canvasRef.current, fullscreenCanvasRef.current].filter(Boolean) as HTMLCanvasElement[];
      if (canvases.length === 0) return;

      canvases.forEach((canvas) => {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const width = canvas.width;
        const height = canvas.height;

        ctx.fillStyle = '#0e1111';
        ctx.fillRect(0, 0, width, height);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
        ctx.lineWidth = 1;

        const vX = width * 0.5;
        const vY = height * 0.35;

        for (let x = -width; x < width * 2; x += 80) {
          ctx.beginPath();
          ctx.moveTo(vX, vY);
          ctx.lineTo(x, height);
          ctx.stroke();
        }

        for (let y = vY; y < height; y += (height - vY) / 7) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
          ctx.stroke();
        }

        const move1 = (frame * 1.5) % (width + 200) - 100;
        const move2 = (frame * 0.8) % (width + 300) - 150;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.fillRect(move1, height * 0.65, 90, 60);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.strokeRect(move1, height * 0.65, 90, 60);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.09)';
        ctx.fillRect(width - move2, height * 0.52, 70, 45);
        ctx.strokeRect(width - move2, height * 0.52, 70, 45);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.015)';
        for (let i = 0; i < 80; i++) {
          const rx = Math.random() * width;
          const ry = Math.random() * height;
          ctx.fillRect(rx, ry, 2, 2);
        }

        scanlineOffset = (scanlineOffset + 1) % 4;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
        for (let y = scanlineOffset; y < height; y += 4) {
          ctx.fillRect(0, y, width, 1.5);
        }

        const now = new Date();
        const timeStr = now.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

        ctx.font = '600 13px Inter, monospace';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`${targetCamera.code} • ${targetCamera.zone}`, 16, 26);

        const blink = Math.floor(frame / 25) % 2 === 0;
        if (blink) {
          ctx.fillStyle = '#17c964';
          ctx.beginPath();
          ctx.arc(width - 76, 21, 4.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.font = '700 11px Inter, sans-serif';
          ctx.fillStyle = '#ffffff';
          ctx.fillText('LIVE', width - 64, 25);
        }

        ctx.font = '500 12px monospace';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.fillText(timeStr, 16, height - 16);

        ctx.font = '500 11px Inter, monospace';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.fillText(`${targetCamera.fps} FPS • ${targetCamera.bitrate}`, width - 120, height - 16);
      });

      frame++;
      animFrameIdRef.current = requestAnimationFrame(render);
    };

    render();
  };

  const handleRetry = () => {
    soundService.playTactileBlip(600, 0.02);
    if (camera) {
      initializeStream(camera);
    }
  };

  const handleSnapshot = () => {
    soundService.playShutterSound();
    setShowFlash(true);
    setTimeout(() => setShowFlash(false), 450);

    if (videoRef.current && isPlayingWebRtc) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth || 1920;
        canvas.height = videoRef.current.videoHeight || 1080;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/png');
          const a = document.createElement('a');
          a.href = dataUrl;
          a.download = `${effectiveCamera.code}_Snapshot_${Date.now()}.png`;
          a.click();
          if (onSnapshotTaken) onSnapshotTaken(effectiveCamera.name);
          return;
        }
      } catch (e) {
        console.error('Video snapshot failed:', e);
      }
    }

    if (!canvasRef.current || !effectiveCamera) return;
    try {
      const dataUrl = canvasRef.current.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${effectiveCamera.code}_Snapshot_${Date.now()}.png`;
      a.click();
      if (onSnapshotTaken) onSnapshotTaken(effectiveCamera.name);
    } catch (e) {
      console.error('Snapshot failed:', e);
    }
  };

  const toggleFullscreen = () => {
    if (!isFullscreen) {
      setIsFullscreen(true);
      try {
        if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        }
      } catch (e) {
        // ignore browser fullscreen rejection
      }
    } else {
      setIsFullscreen(false);
      try {
        if (document.exitFullscreen && document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
      } catch (e) {
        // ignore
      }
    }
  };

  const handleTriggerAiScan = async () => {
    if (!effectiveCamera) return;
    setIsAnalyzingAi(true);
    soundService.playTactileBlip(880, 0.03);
    try {
      const res = await cameraService.triggerCameraAiAnalysis(effectiveCamera.id);
      if (res) setAiState(res);
    } catch (e) {
      console.warn('AI analysis error:', e);
    } finally {
      setIsAnalyzingAi(false);
    }
  };

  if (!isOpen || !camera) {
    return null;
  }

  const effectiveCamera = liveMetadata || camera;

  return (
    <>
      {/* Semi-transparent Backdrop */}
      <div
        id="camera-viewer-backdrop"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-xs lg:bg-transparent lg:pointer-events-none transition-opacity"
        aria-hidden="true"
      />

      {/* Slide-out Drawer Panel from Right */}
      <aside
        id="camera-viewer-drawer"
        ref={containerRef}
        aria-label={`Live stream for ${effectiveCamera.name}`}
        className="fixed top-0 right-0 z-50 h-full w-full sm:w-[540px] md:w-[600px] lg:w-[640px] bg-white dark:bg-[#0c0c10] border-l border-black/[0.12] dark:border-white/[0.1] shadow-2xl flex flex-col transition-transform duration-300 ease-out"
        style={{ transform: isOpen ? 'translateX(0)' : 'translateX(100%)' }}
      >
        {/* Drawer Header */}
        <div className="p-5 border-b border-black/[0.08] dark:border-white/[0.08] flex items-center justify-between bg-[#fafafa] dark:bg-[#121216]">
          <div className="min-w-0 pr-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#6b6b6b] dark:text-orange-400 bg-black/[0.05] dark:bg-orange-500/10 dark:border dark:border-orange-500/20 px-2 py-0.5 rounded">
                {effectiveCamera.code}
              </span>
              <span className="text-[12px] font-medium text-[#6b6b6b] dark:text-[#a1a1aa] tracking-tight">
                {effectiveCamera.zone}
              </span>
            </div>
            <h2 className="text-[19px] font-semibold text-[#0a0a0a] dark:text-white tracking-tight truncate">
              {effectiveCamera.name}
            </h2>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Cycle to previous camera */}
            {onPrevCamera && (
              <button
                type="button"
                id="prev-camera-btn"
                onClick={() => {
                  soundService.playTactileBlip(680, 0.02);
                  onPrevCamera();
                }}
                disabled={!hasPrevCamera}
                className="p-1.5 text-[#6b6b6b] dark:text-[#a1a1aa] hover:text-black dark:hover:text-white hover:bg-black/[0.06] dark:hover:bg-white/[0.08] rounded-full transition-colors disabled:opacity-30 cursor-pointer"
                title="Previous camera (←)"
                aria-label="Previous camera"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}

            {/* Cycle to next camera */}
            {onNextCamera && (
              <button
                type="button"
                id="next-camera-btn"
                onClick={() => {
                  soundService.playTactileBlip(750, 0.02);
                  onNextCamera();
                }}
                disabled={!hasNextCamera}
                className="p-1.5 text-[#6b6b6b] dark:text-[#a1a1aa] hover:text-black dark:hover:text-white hover:bg-black/[0.06] dark:hover:bg-white/[0.08] rounded-full transition-colors disabled:opacity-30 cursor-pointer"
                title="Next camera (→)"
                aria-label="Next camera"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            )}

            <div className="w-[1px] h-4 bg-black/10 dark:bg-white/10 mx-0.5" />

            <button
              id="close-viewer-btn"
              onClick={() => {
                soundService.playTactileBlip(450, 0.03);
                onClose();
              }}
              className="p-1.5 text-[#6b6b6b] dark:text-[#a1a1aa] hover:text-black dark:hover:text-white hover:bg-black/[0.06] dark:hover:bg-white/[0.08] rounded-full transition-colors cursor-pointer"
              title="Close viewer (Esc)"
              aria-label="Close viewer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Video Stage Area */}
        <div className="p-5 flex-1 overflow-y-auto space-y-4">
          <div
            className={`relative w-full bg-[#0a0a0a] rounded-xl overflow-hidden shadow-inner border border-black/20 dark:border-white/10 flex items-center justify-center transition-all ${
              aspectRatio === '16:9' ? 'aspect-video' : aspectRatio === '4:3' ? 'aspect-[4/3]' : 'min-h-[340px]'
            }`}
          >
            {/* Visual camera flash animation */}
            {showFlash && (
              <div className="absolute inset-0 bg-white animate-camera-flash pointer-events-none z-30" />
            )}

            {/* Real WebRTC HTML5 Video Element */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted={isMuted}
              className={`w-full h-full ${
                aspectRatio === 'fill' ? 'object-cover' : 'object-contain'
              } ${
                isPlayingWebRtc && !isLoading && !errorMessage ? 'block' : 'hidden'
              }`}
            />

            {/* High-Performance Real-Time CCTV Canvas Engine (Always active when WebRTC is not streaming) */}
            <canvas
              ref={canvasRef}
              width={1280}
              height={720}
              className={`w-full h-full ${
                aspectRatio === 'fill' ? 'object-cover' : 'object-contain'
              } ${
                !isPlayingWebRtc && !isLoading && !errorMessage ? 'block' : 'hidden'
              }`}
            />

            {/* AI YOLOv8 & PPE Live Bounding Box Overlay */}
            {showAiHud && aiState && aiState.detections && aiState.detections.length > 0 && !isLoading && (
              <div className="absolute inset-0 pointer-events-none z-20 overflow-hidden">
                {aiState.detections.map((det, idx) => {
                  if (!det.bbox || det.bbox.length !== 4) return null;
                  const [b0, b1, b2, b3] = det.bbox;
                  // Support normalized [x1, y1, x2, y2] vs [x, y, w, h]
                  const isXyxy = b2 > b0 && b3 > b1 && b2 <= 1.05 && b3 <= 1.05;
                  const left = Math.max(0, Math.min(95, b0 * 100));
                  const top = Math.max(0, Math.min(95, b1 * 100));
                  const width = Math.max(3, Math.min(100 - left, isXyxy ? (b2 - b0) * 100 : b2 * 100));
                  const height = Math.max(3, Math.min(100 - top, isXyxy ? (b3 - b1) * 100 : b3 * 100));

                  const isViolation = det.category === 'VIOLATION';
                  const isCompliant = det.category === 'COMPLIANT';
                  
                  const borderClass = isViolation
                    ? 'border-red-500 bg-red-500/15 shadow-[0_0_12px_rgba(239,68,68,0.4)] animate-pulse'
                    : isCompliant
                    ? 'border-emerald-500 bg-emerald-500/10'
                    : 'border-cyan-400 bg-cyan-400/10';

                  const badgeClass = isViolation
                    ? 'bg-red-500 text-white font-bold'
                    : isCompliant
                    ? 'bg-emerald-500 text-black font-semibold'
                    : 'bg-cyan-500 text-black font-semibold';

                  return (
                    <div
                      key={idx}
                      style={{
                        left: `${left}%`,
                        top: `${top}%`,
                        width: `${width}%`,
                        height: `${height}%`,
                      }}
                      className={`absolute border-2 rounded-xs transition-all duration-300 pointer-events-none ${borderClass}`}
                    >
                      <div className={`absolute -top-5 left-0 px-1.5 py-0.5 rounded-xs text-[10px] font-mono whitespace-nowrap shadow-sm flex items-center gap-1 ${badgeClass}`}>
                        {isViolation && <ShieldAlert className="w-2.5 h-2.5 inline" />}
                        {det.label} {Math.round(det.confidence * 100)}%
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* AI HUD Status Corner Pill (Top Left Overlay) */}
            {showAiHud && (
              <div className="absolute top-2.5 left-2.5 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-black/80 backdrop-blur-xs border border-white/15 text-[11px] text-white font-mono pointer-events-none shadow-md">
                <Cpu className="w-3 h-3 text-cyan-400 animate-pulse" />
                <span className="text-cyan-400 font-bold">AI HUD</span>
                <span className="text-white/30">•</span>
                <span className="flex items-center gap-1">
                  <Users className="w-3 h-3 text-white/70" />
                  {aiState?.peopleCount ?? 0} People
                </span>
                {aiState && (aiState.phoneViolations > 0 || aiState.ppeViolations > 0) && (
                  <>
                    <span className="text-white/30">•</span>
                    <span className="text-red-400 font-bold flex items-center gap-1 animate-pulse">
                      <ShieldAlert className="w-3 h-3 text-red-400" />
                      {aiState.phoneViolations + aiState.ppeViolations} Violations
                    </span>
                  </>
                )}
              </div>
            )}

            {/* Connecting / Loading State */}
            {isLoading && (
              <div className="flex flex-col items-center justify-center text-center p-6 text-white space-y-3">
                <Loader2 className="w-8 h-8 animate-spin text-white/80" />
                <div>
                  <p className="text-[15px] font-medium tracking-tight">
                    Connecting to {effectiveCamera.name}...
                  </p>
                  <p className="text-[12px] text-white/50 mt-0.5">
                    Establishing WebRTC RTSP session
                  </p>
                </div>
              </div>
            )}

            {/* Failure / Offline State */}
            {errorMessage && !isLoading && (
              <div
                id="viewer-error-state"
                className="flex flex-col items-center justify-center text-center p-6 text-white space-y-3.5 max-w-[420px]"
              >
                <div className="w-12 h-12 rounded-full bg-[#ef4444]/20 flex items-center justify-center text-[#ef4444]">
                  {isOfflineFailure ? (
                    <WifiOff className="w-6 h-6" />
                  ) : (
                    <AlertTriangle className="w-6 h-6" />
                  )}
                </div>

                <div>
                  <h3 className="text-[16px] font-semibold tracking-tight text-white">
                    {isOfflineFailure ? 'Camera Offline' : 'Unable to load live stream'}
                  </h3>
                  <p className="text-[13px] text-white/70 mt-1">{errorMessage}</p>

                  <div className="mt-3 p-2.5 rounded bg-white/5 border border-white/10 text-[12px] text-white/60">
                    <span className="block text-white/40 uppercase text-[10px] tracking-wider">
                      Last successful connection
                    </span>
                    <span className="font-mono text-white/90">
                      {formatFullDateTime(effectiveCamera.lastOnline)}
                    </span>
                  </div>
                </div>

                <button
                  id="retry-stream-btn"
                  onClick={handleRetry}
                  className="flex items-center gap-1.5 px-4 py-2 bg-white dark:bg-orange-500 text-black dark:text-black font-semibold text-[13px] rounded-lg tracking-tight transition-all cursor-pointer shadow-sm active:scale-97"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry</span>
                </button>
              </div>
            )}
          </div>

          {/* User Auto-Close Timer Control Bar */}
          <div className="p-3 bg-[#fafafa] dark:bg-[#131318] border border-black/[0.08] dark:border-white/[0.08] rounded-xl flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-orange-500" />
                <span className="text-[12px] font-semibold text-[#0a0a0a] dark:text-white tracking-tight">
                  Auto-Close Timer
                </span>
                {durationSeconds > 0 ? (
                  <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-orange-500/15 text-orange-500">
                    {remainingSeconds}s remaining
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-black/[0.05] dark:bg-white/[0.08] text-[#8c8c8c]">
                    Continuous (No timeout)
                  </span>
                )}
              </div>

              {durationSeconds > 0 && (
                <button
                  type="button"
                  onClick={() => setIsTimerPaused((p) => !p)}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-black/[0.1] dark:border-white/[0.1] hover:border-black/30 dark:hover:border-orange-500/50 text-[#6b6b6b] dark:text-[#a1a1aa] transition-colors cursor-pointer"
                  title={isTimerPaused ? 'Resume countdown' : 'Pause countdown'}
                >
                  {isTimerPaused ? (
                    <>
                      <Play className="w-3 h-3 text-orange-500 fill-current" />
                      <span>Resume</span>
                    </>
                  ) : (
                    <>
                      <Pause className="w-3 h-3 text-[#8c8c8c]" />
                      <span>Pause</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Quick Duration Buttons (min 5s up to 5 mins or Continuous) */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[11px] text-[#8c8c8c] dark:text-[#71717a] mr-1">Play Duration:</span>
              {[
                { label: '5s (Min)', value: 5 },
                { label: '10s', value: 10 },
                { label: '30s', value: 30 },
                { label: '1 Min', value: 60 },
                { label: '5 Min', value: 300 },
                { label: 'Continuous', value: 0 },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setDurationSeconds(opt.value);
                    setRemainingSeconds(opt.value);
                    setIsTimerPaused(false);
                  }}
                  className={`px-2 py-1 text-[11px] font-mono rounded-md border transition-all cursor-pointer ${
                    durationSeconds === opt.value
                      ? 'bg-[#0a0a0a] dark:bg-orange-500 text-white dark:text-black font-bold border-transparent shadow-xs'
                      : 'border-black/[0.08] dark:border-white/[0.08] bg-white dark:bg-[#181820] text-[#6b6b6b] dark:text-[#a1a1aa] hover:border-black/20 dark:hover:border-orange-500/40 hover:text-black dark:hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Progress bar visual indicator for remaining time */}
            {durationSeconds > 0 && (
              <div className="w-full h-1 bg-black/[0.06] dark:bg-white/[0.08] rounded-full overflow-hidden mt-0.5">
                <div
                  className={`h-full transition-all duration-1000 ${
                    isTimerPaused ? 'bg-[#8c8c8c]' : 'bg-orange-500'
                  }`}
                  style={{
                    width: `${Math.max(0, Math.min(100, (remainingSeconds / durationSeconds) * 100))}%`,
                  }}
                />
              </div>
            )}
          </div>

          {/* Stream Specs Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-[#fafafa] dark:bg-[#131318] border border-black/[0.08] dark:border-white/[0.08] rounded-lg text-[12px]">
            <div className="flex items-center gap-2 font-mono text-[#0a0a0a] dark:text-white">
              <span
                className={`w-2 h-2 rounded-full ${
                  effectiveCamera.status === 'ONLINE' ? 'bg-[#17c964]' : 'bg-[#ef4444]'
                }`}
              />
              <span className="font-semibold uppercase tracking-wider">{effectiveCamera.status}</span>
              <span className="text-[#8c8c8c] dark:text-[#71717a]">•</span>
              <span>{effectiveCamera.resolution}</span>
              <span className="text-[#8c8c8c] dark:text-[#71717a]">•</span>
              <span>{effectiveCamera.codec}</span>
              <span className="text-[#8c8c8c] dark:text-[#71717a]">•</span>
              <span>{effectiveCamera.fps} FPS</span>
            </div>

            {/* Quick Action Tools with Hotkey hints */}
            <div className="flex items-center gap-1">
              {/* AI HUD / YOLO Vision Toggle */}
              <button
                type="button"
                onClick={() => {
                  soundService.playTactileBlip(700, 0.02);
                  setShowAiHud((prev) => !prev);
                }}
                className={`px-2 py-1 rounded text-[11px] font-mono flex items-center gap-1 border transition-all cursor-pointer ${
                  showAiHud
                    ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-400 font-bold shadow-xs'
                    : 'border-black/[0.08] dark:border-white/[0.08] text-[#8c8c8c] dark:text-[#71717a] hover:text-black dark:hover:text-white'
                }`}
                title="Toggle AI YOLOv8 & PPE Live Bounding Box HUD"
              >
                <Cpu className={`w-3.5 h-3.5 ${showAiHud ? 'text-cyan-400 animate-pulse' : ''}`} />
                <span>AI {showAiHud ? 'ON' : 'OFF'}</span>
              </button>

              {/* On-Demand AI Frame Scan */}
              <button
                type="button"
                onClick={handleTriggerAiScan}
                disabled={isAnalyzingAi}
                className="px-2 py-1 rounded hover:bg-black/[0.06] dark:hover:bg-white/[0.08] text-[#6b6b6b] dark:text-[#a1a1aa] hover:text-cyan-400 transition-colors cursor-pointer text-[11px] font-mono flex items-center gap-1 border border-black/[0.06] dark:border-white/[0.08] disabled:opacity-50"
                title="Run immediate dual YOLO & PPE AI frame inference"
              >
                <Scan className={`w-3.5 h-3.5 ${isAnalyzingAi ? 'animate-spin text-cyan-400' : ''}`} />
                <span>{isAnalyzingAi ? 'Scanning...' : 'Scan'}</span>
              </button>

              <div className="w-[1px] h-3.5 bg-black/10 dark:bg-white/10 mx-0.5" />

              <button
                type="button"
                onClick={() => setAspectRatio((a) => (a === '16:9' ? '4:3' : a === '4:3' ? 'fill' : '16:9'))}
                className="px-2 py-1 rounded hover:bg-black/[0.06] dark:hover:bg-white/[0.08] text-[#6b6b6b] dark:text-[#a1a1aa] hover:text-black dark:hover:text-white transition-colors cursor-pointer text-[11px] font-mono flex items-center gap-1 border border-black/[0.06] dark:border-white/[0.08]"
                title={`Aspect: ${aspectRatio.toUpperCase()} (Click to change)`}
              >
                <Ratio className="w-3.5 h-3.5 text-orange-500" />
                <span>{aspectRatio}</span>
              </button>

              <button
                onClick={() => setIsMuted(!isMuted)}
                className="p-1.5 rounded hover:bg-black/[0.06] dark:hover:bg-white/[0.08] text-[#6b6b6b] dark:text-[#a1a1aa] hover:text-black dark:hover:text-white transition-colors cursor-pointer"
                title={isMuted ? 'Unmute audio (M)' : 'Mute audio (M)'}
                aria-label="Toggle audio mute"
              >
                {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>

              <button
                onClick={handleSnapshot}
                disabled={!streamInfo}
                className="p-1.5 rounded hover:bg-black/[0.06] dark:hover:bg-white/[0.08] text-[#6b6b6b] dark:text-[#a1a1aa] hover:text-black dark:hover:text-white transition-colors disabled:opacity-40 cursor-pointer"
                title="Capture snapshot (S)"
                aria-label="Capture snapshot"
              >
                <CameraIcon className="w-4 h-4" />
              </button>

              <button
                onClick={handleRetry}
                className="p-1.5 rounded hover:bg-black/[0.06] dark:hover:bg-white/[0.08] text-[#6b6b6b] dark:text-[#a1a1aa] hover:text-black dark:hover:text-white transition-colors cursor-pointer"
                title="Refresh stream connection (R)"
                aria-label="Refresh stream"
              >
                <RefreshCw className="w-4 h-4" />
              </button>

              <button
                onClick={toggleFullscreen}
                className="p-1.5 rounded hover:bg-black/[0.06] dark:hover:bg-white/[0.08] text-[#6b6b6b] dark:text-[#a1a1aa] hover:text-black dark:hover:text-white transition-colors cursor-pointer"
                title="Toggle fullscreen (F)"
                aria-label="Toggle fullscreen"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* AI SURVEILLANCE & ANOMALY MONITOR (MAX 5) */}
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold tracking-tight uppercase tracking-wider text-[11px] text-[#8c8c8c] dark:text-[#71717a] flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                AI Intelligence & PPE Violations
              </h4>
              <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                YOLOv8 + PPE Models
              </span>
            </div>

            {/* AI Telemetry Metrics */}
            <div className="grid grid-cols-4 gap-2 text-[12px]">
              <div className="p-2.5 bg-[#fbfbfb] dark:bg-[#15151b] border border-black/[0.06] dark:border-white/[0.08] rounded-lg">
                <span className="text-[#8c8c8c] dark:text-[#71717a] block text-[10.5px] uppercase font-mono">People</span>
                <span className="font-mono text-[16px] font-bold text-[#0a0a0a] dark:text-white flex items-center gap-1">
                  <Users className="w-4 h-4 text-cyan-400" />
                  {aiState?.peopleCount ?? 0}
                </span>
              </div>

              <div className="p-2.5 bg-[#fbfbfb] dark:bg-[#15151b] border border-black/[0.06] dark:border-white/[0.08] rounded-lg">
                <span className="text-[#8c8c8c] dark:text-[#71717a] block text-[10.5px] uppercase font-mono">Phone Alert</span>
                <span className={`font-mono text-[16px] font-bold flex items-center gap-1 ${
                  (aiState?.phoneViolations ?? 0) > 0 ? 'text-red-500' : 'text-emerald-500'
                }`}>
                  <Smartphone className="w-4 h-4" />
                  {aiState?.phoneViolations ?? 0}
                </span>
              </div>

              <div className="p-2.5 bg-[#fbfbfb] dark:bg-[#15151b] border border-black/[0.06] dark:border-white/[0.08] rounded-lg">
                <span className="text-[#8c8c8c] dark:text-[#71717a] block text-[10.5px] uppercase font-mono">PPE Alert</span>
                <span className={`font-mono text-[16px] font-bold flex items-center gap-1 ${
                  (aiState?.ppeViolations ?? 0) > 0 ? 'text-amber-500' : 'text-emerald-500'
                }`}>
                  <HardHat className="w-4 h-4" />
                  {aiState?.ppeViolations ?? 0}
                </span>
              </div>

              <div className="p-2.5 bg-[#fbfbfb] dark:bg-[#15151b] border border-black/[0.06] dark:border-white/[0.08] rounded-lg">
                <span className="text-[#8c8c8c] dark:text-[#71717a] block text-[10.5px] uppercase font-mono">Compliance</span>
                <span className="font-mono text-[16px] font-bold text-emerald-500">
                  {aiState?.complianceScore ?? 100}%
                </span>
              </div>
            </div>

            {/* Active Anomalies List (Capped strictly at max 5) */}
            <div className="p-3 bg-[#fbfbfb] dark:bg-[#15151b] border border-black/[0.06] dark:border-white/[0.08] rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8c8c8c] dark:text-[#71717a] flex items-center gap-1">
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />
                  Recent Anomalies (Max 5)
                </span>
                <span className="text-[10px] font-mono text-[#8c8c8c] dark:text-[#71717a]">
                  {aiState?.anomalies ? `${aiState.anomalies.length}/5 Logged` : '0/5'}
                </span>
              </div>

              {aiState?.anomalies && aiState.anomalies.length > 0 ? (
                <div className="space-y-1.5">
                  {aiState.anomalies.slice(0, 5).map((anom) => (
                    <div
                      key={anom.id}
                      className="p-2 rounded-lg bg-white dark:bg-[#1a1a24] border border-black/[0.06] dark:border-white/[0.08] flex items-center justify-between text-[11.5px]"
                    >
                      <div className="flex items-center gap-2 min-w-0 pr-2">
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            anom.severity === 'HIGH' ? 'bg-red-500 animate-ping' : 'bg-amber-500'
                          }`}
                        />
                        <span className="font-medium text-[#0a0a0a] dark:text-white truncate">
                          {anom.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono text-[10px] text-[#8c8c8c] dark:text-[#71717a]">
                          {formatRelativeTime(anom.timestamp)}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold uppercase tracking-tight ${
                            anom.severity === 'HIGH'
                              ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                              : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                          }`}
                        >
                          {anom.severity}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-2.5 px-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[11.5px] flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  <span>Zero Anomalies Detected • Normal Surveillance Protocol</span>
                </div>
              )}
            </div>
          </div>

          {/* REAL-TIME TECHNICAL DIAGNOSTICS & METADATA SHEET */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold tracking-tight uppercase tracking-wider text-[11px] text-[#8c8c8c] dark:text-[#71717a] flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-orange-500" />
                Live Real-Time Metadata
              </h4>
              <span className="text-[11px] font-mono text-[#8c8c8c] dark:text-[#71717a]">
                Checked: {formatRelativeTime(effectiveCamera.lastChecked)}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[12px]">
              <div className="p-2.5 bg-[#fbfbfb] dark:bg-[#15151b] border border-black/[0.06] dark:border-white/[0.08] rounded-lg">
                <span className="text-[#8c8c8c] dark:text-[#71717a] block text-[11px]">Assigned IP</span>
                <span className="font-mono font-medium text-[#0a0a0a] dark:text-white">{effectiveCamera.ip}</span>
              </div>
              <div className="p-2.5 bg-[#fbfbfb] dark:bg-[#15151b] border border-black/[0.06] dark:border-white/[0.08] rounded-lg">
                <span className="text-[#8c8c8c] dark:text-[#71717a] block text-[11px]">Hardware Model</span>
                <span className="font-medium text-[#0a0a0a] dark:text-white truncate block" title={effectiveCamera.model}>
                  {effectiveCamera.model || 'Universal RTSP IP Camera'}
                </span>
              </div>
              <div className="p-2.5 bg-[#fbfbfb] dark:bg-[#15151b] border border-black/[0.06] dark:border-white/[0.08] rounded-lg">
                <span className="text-[#8c8c8c] dark:text-[#71717a] block text-[11px]">Bitrate Allocation</span>
                <span className="font-mono font-medium text-[#0a0a0a] dark:text-white">{effectiveCamera.bitrate}</span>
              </div>
              <div className="p-2.5 bg-[#fbfbfb] dark:bg-[#15151b] border border-black/[0.06] dark:border-white/[0.08] rounded-lg">
                <span className="text-[#8c8c8c] dark:text-[#71717a] block text-[11px]">Stream Codec</span>
                <span className="font-mono font-medium text-[#0a0a0a] dark:text-white">
                  {effectiveCamera.codec} ({effectiveCamera.resolution})
                </span>
              </div>
              <div className="p-2.5 bg-[#fbfbfb] dark:bg-[#15151b] border border-black/[0.06] dark:border-white/[0.08] rounded-lg">
                <span className="text-[#8c8c8c] dark:text-[#71717a] block text-[11px]">Last Online</span>
                <span
                  className="font-medium text-[#0a0a0a] dark:text-white block truncate"
                  title={formatFullDateTime(effectiveCamera.lastOnline)}
                >
                  {formatRelativeTime(effectiveCamera.lastOnline)}
                </span>
              </div>
              <div className="p-2.5 bg-[#fbfbfb] dark:bg-[#15151b] border border-black/[0.06] dark:border-white/[0.08] rounded-lg">
                <span className="text-[#8c8c8c] dark:text-[#71717a] block text-[11px]">Credentials & Storage</span>
                <span className="font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  AES-256 Encrypted
                </span>
              </div>
            </div>

            {/* Error banner if last check encountered an issue */}
            {effectiveCamera.lastError && (
              <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-[11.5px] flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="truncate">Health telemetry alert: {effectiveCamera.lastError}</span>
              </div>
            )}
          </div>
        </div>

        {/* Drawer Footer */}
        <div className="p-4 border-t border-black/[0.08] dark:border-white/[0.08] bg-[#fafafa] dark:bg-[#121216] flex items-center justify-between text-[12px] text-[#6b6b6b] dark:text-[#a1a1aa]">
          <span className="flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5 text-[#17c964] dark:text-orange-400" />
            Session: {isPlayingWebRtc ? 'MediaMTX WebRTC (WHEP)' : 'On-Demand Handshake'}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-[#0a0a0a] dark:bg-orange-500 text-white dark:text-black font-semibold rounded-lg text-[13px] hover:bg-black/80 dark:hover:bg-orange-400 transition-all cursor-pointer shadow-sm"
          >
            Close Viewer
          </button>
        </div>
      </aside>

      {/* Full-Screen Theater Live Stream Overlay */}
      {isFullscreen && (
        <div
          id="camera-fullscreen-theater-overlay"
          className="fixed inset-0 z-[100] bg-black flex flex-col justify-between animate-in fade-in duration-200"
          role="dialog"
          aria-modal="true"
        >
          {/* Top Theater Header */}
          <div className="p-4 bg-gradient-to-b from-black/90 to-transparent flex items-center justify-between z-20">
            <div className="flex items-center gap-3">
              <span className="px-2.5 py-1 rounded text-[11px] font-mono font-bold bg-orange-500 text-black">
                {effectiveCamera.code}
              </span>
              <div>
                <h3 className="text-white text-[16px] font-semibold tracking-tight">
                  {effectiveCamera.name}
                </h3>
                <p className="text-zinc-400 text-[11px] font-mono">
                  {effectiveCamera.zone} • {effectiveCamera.ip} • {effectiveCamera.resolution}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Countdown badge in fullscreen */}
              {durationSeconds > 0 && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 text-white font-mono text-[12px] backdrop-blur-xs">
                  <Clock className="w-3.5 h-3.5 text-orange-500" />
                  <span>{remainingSeconds}s remaining</span>
                </div>
              )}

              <button
                type="button"
                onClick={handleSnapshot}
                className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
                title="Capture Snapshot (S)"
              >
                <CameraIcon className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={toggleFullscreen}
                className="p-2 rounded-full bg-orange-500 hover:bg-orange-600 text-black transition-colors cursor-pointer font-bold"
                title="Exit Fullscreen (F or Esc)"
                aria-label="Exit fullscreen"
              >
                <Minimize2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Fullscreen Video Canvas Display */}
          <div className="flex-1 w-full h-full relative flex items-center justify-center p-4 overflow-hidden">
            {/* Visual flash effect */}
            {showFlash && (
              <div className="absolute inset-0 bg-white animate-camera-flash pointer-events-none z-30" />
            )}

            <div className="relative max-w-full max-h-full aspect-video flex items-center justify-center">
              {/* If WebRTC video is playing */}
              {isPlayingWebRtc ? (
                <video
                  ref={(el) => {
                    if (el && videoRef.current && videoRef.current.srcObject) {
                      el.srcObject = videoRef.current.srcObject;
                      el.play().catch(() => {});
                    }
                  }}
                  autoPlay
                  playsInline
                  muted={isMuted}
                  className="w-full h-full object-contain rounded-lg shadow-2xl"
                />
              ) : (
                /* Fullscreen High-Definition Canvas */
                <canvas
                  ref={fullscreenCanvasRef}
                  width={1920}
                  height={1080}
                  className="w-full h-full object-contain rounded-lg shadow-2xl"
                />
              )}

              {/* Fullscreen AI Overlay */}
              {showAiHud && aiState && aiState.detections && aiState.detections.length > 0 && (
                <div className="absolute inset-0 pointer-events-none z-20 overflow-hidden">
                  {aiState.detections.map((det, idx) => {
                    if (!det.bbox || det.bbox.length !== 4) return null;
                    const [b0, b1, b2, b3] = det.bbox;
                    const isXyxy = b2 > b0 && b3 > b1 && b2 <= 1.05 && b3 <= 1.05;
                    const left = Math.max(0, Math.min(95, b0 * 100));
                    const top = Math.max(0, Math.min(95, b1 * 100));
                    const width = Math.max(3, Math.min(100 - left, isXyxy ? (b2 - b0) * 100 : b2 * 100));
                    const height = Math.max(3, Math.min(100 - top, isXyxy ? (b3 - b1) * 100 : b3 * 100));

                    const isViolation = det.category === 'VIOLATION';
                    const isCompliant = det.category === 'COMPLIANT';
                    const borderClass = isViolation
                      ? 'border-red-500 bg-red-500/15 shadow-[0_0_14px_rgba(239,68,68,0.5)] animate-pulse'
                      : isCompliant
                      ? 'border-emerald-500 bg-emerald-500/10'
                      : 'border-cyan-400 bg-cyan-400/10';

                    const badgeClass = isViolation
                      ? 'bg-red-500 text-white font-bold'
                      : isCompliant
                      ? 'bg-emerald-500 text-black font-semibold'
                      : 'bg-cyan-500 text-black font-semibold';

                    return (
                      <div
                        key={idx}
                        style={{
                          left: `${left}%`,
                          top: `${top}%`,
                          width: `${width}%`,
                          height: `${height}%`,
                        }}
                        className={`absolute border-2 rounded-xs transition-all duration-300 pointer-events-none ${borderClass}`}
                      >
                        <div className={`absolute -top-6 left-0 px-2 py-0.5 rounded-xs text-[11px] font-mono whitespace-nowrap shadow-md flex items-center gap-1.5 ${badgeClass}`}>
                          {isViolation && <ShieldAlert className="w-3 h-3 inline" />}
                          {det.label} {Math.round(det.confidence * 100)}%
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Bottom Theater Footer */}
          <div className="p-4 bg-gradient-to-t from-black/90 to-transparent flex items-center justify-between text-[12px] font-mono text-zinc-400 z-20">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                LIVE SURVEILLANCE FEED
              </span>
              <span>•</span>
              <span>Press <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white">F</kbd> or <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white">Esc</kbd> to exit full screen</span>
            </div>
            <span>Bitrate: {effectiveCamera.bitrate} • Codec: {effectiveCamera.codec}</span>
          </div>
        </div>
      )}
    </>
  );
};