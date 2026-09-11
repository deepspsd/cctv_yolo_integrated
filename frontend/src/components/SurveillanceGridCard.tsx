import React, { useState, useEffect, useRef } from 'react';
import { Camera } from '../types';
import { cameraService } from '../services/cameraService';
import { soundService } from '../services/soundService';
import {
  Maximize2,
  Camera as CameraIcon,
  Pencil,
  Trash2,
  Wifi,
  WifiOff,
  Activity,
  Shield,
  Eye,
  Users,
  ShieldAlert,
} from 'lucide-react';

interface SurveillanceGridCardProps {
  cam: Camera;
  isSelected: boolean;
  onSelect: (cam: Camera) => void;
  onEdit: (cam: Camera) => void;
  onDelete: (cam: Camera) => void;
  onSnapshot?: (cameraName: string) => void;
}

export const SurveillanceGridCard: React.FC<SurveillanceGridCardProps> = ({
  cam,
  isSelected,
  onSelect,
  onEdit,
  onDelete,
  onSnapshot,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isPlayingWebRtc, setIsPlayingWebRtc] = useState<boolean>(false);
  const [isHovered, setIsHovered] = useState<boolean>(false);
  const [snapshotFlash, setSnapshotFlash] = useState<boolean>(false);
  const isOnline = cam.status === 'ONLINE';

  // Real-time WebRTC WHEP connection
  useEffect(() => {
    if (!isOnline) {
      setIsPlayingWebRtc(false);
      return;
    }

    let isMounted = true;
    let peerConnection: RTCPeerConnection | null = null;
    let streamTracks: MediaStreamTrack[] = [];

    const connectStream = async () => {
      try {
        const info = await cameraService.requestStream(cam.id);
        if (!isMounted || !info?.whepUrl) return;

        const pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        });
        peerConnection = pc;

        pc.addTransceiver('video', { direction: 'recvonly' });

        pc.ontrack = (event) => {
          if (isMounted && videoRef.current && event.streams[0]) {
            streamTracks = event.streams[0].getTracks();
            videoRef.current.srcObject = event.streams[0];
            videoRef.current.play().catch(() => {});
            setIsPlayingWebRtc(true);
          }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        await new Promise<void>((resolve) => {
          if (pc.iceGatheringState === 'complete') resolve();
          else {
            const check = () => {
              if (pc.iceGatheringState === 'complete') {
                pc.removeEventListener('icegatheringstatechange', check);
                resolve();
              }
            };
            pc.addEventListener('icegatheringstatechange', check);
            setTimeout(() => {
              pc.removeEventListener('icegatheringstatechange', check);
              resolve();
            }, 800);
          }
        });

        if (!isMounted) return;

        const resp = await fetch(info.whepUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/sdp' },
          body: pc.localDescription?.sdp || offer.sdp,
        });

        if (resp.ok && isMounted) {
          const answerSdp = await resp.text();
          await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
        }
      } catch {
        // Fallback to dynamic canvas engine
      }
    };

    connectStream();

    return () => {
      isMounted = false;
      if (peerConnection) {
        try {
          peerConnection.close();
        } catch {}
      }
      streamTracks.forEach((t) => t.stop());
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [cam.id, isOnline]);

  // Dynamic CCTV Canvas Engine Fallback
  useEffect(() => {
    if (isPlayingWebRtc) return;

    let animId: number;
    let frame = 0;

    const render = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;

      // Dark background with perspective floor grid
      ctx.fillStyle = isOnline ? '#090d14' : '#08080a';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = isOnline ? 'rgba(30, 58, 138, 0.22)' : 'rgba(255, 255, 255, 0.04)';
      ctx.lineWidth = 1;
      const step = 40;
      for (let x = 0; x < w; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Live UTC Timestamp
      const now = new Date();
      const ts = `${now.toISOString().slice(0, 10)} ${now.toTimeString().split(' ')[0]}.${String(
        now.getMilliseconds()
      ).padStart(3, '0')}`;
      ctx.font = '11px monospace';
      ctx.fillStyle = isOnline ? 'rgba(255, 255, 255, 0.7)' : 'rgba(239, 68, 68, 0.6)';
      ctx.textAlign = 'right';
      ctx.fillText(ts, w - 12, 20);

      // Camera Code
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ff7300';
      ctx.fillText(cam.code, 12, 20);

      // Center Status Notification
      ctx.textAlign = 'center';
      if (isOnline) {
        ctx.fillStyle = 'rgba(16, 185, 129, 0.9)';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText('CONNECTING LIVE FEED...', w / 2, h / 2 - 6);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.font = '10.5px monospace';
        ctx.fillText(`${cam.resolution || '640×360'} • 25 FPS • H.264`, w / 2, h / 2 + 12);
      } else {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.9)';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText('SIGNAL LOST / OFFLINE', w / 2, h / 2 - 6);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.font = '10.5px monospace';
        ctx.fillText(cam.lastError || 'RTSP Stream Unreachable', w / 2, h / 2 + 12);
      }

      // Sweeping Laser Scanline
      const scanY = (frame * 2) % h;
      ctx.fillStyle = isOnline ? 'rgba(249, 115, 22, 0.08)' : 'rgba(239, 68, 68, 0.08)';
      ctx.fillRect(0, scanY, w, 2);

      frame++;
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [isPlayingWebRtc, isOnline, cam.code, cam.resolution, cam.lastError]);

  // Quick Snapshot Action from Card
  const handleQuickSnapshot = (e: React.MouseEvent) => {
    e.stopPropagation();
    soundService.playShutterSound();
    setSnapshotFlash(true);
    setTimeout(() => setSnapshotFlash(false), 450);
    if (onSnapshot) {
      onSnapshot(cam.name);
    }
  };

  return (
    <div
      className={`group hud-bracket relative rounded-2xl overflow-hidden border transition-all duration-250 flex flex-col justify-between cursor-pointer ${
        isSelected
          ? 'border-orange-500 ring-2 ring-orange-500/50 shadow-[0_0_20px_rgba(249,115,22,0.25)] bg-[#fcfcfc] dark:bg-[#14141b]'
          : 'border-black/[0.08] dark:border-white/[0.08] hover:border-orange-500/50 hover:shadow-xl bg-white dark:bg-[#101015]'
      }`}
      onClick={() => {
        soundService.playTactileBlip(750, 0.02);
        onSelect(cam);
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Video Stage Container */}
      <div className="relative aspect-video w-full bg-black flex items-center justify-center overflow-hidden">
        {/* Real HTML5 WebRTC Video (live feed) */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover transition-opacity duration-300 ${
            isPlayingWebRtc ? 'opacity-100 block' : 'opacity-0 hidden'
          }`}
        />

        {/* Real-time CCTV Canvas fallback/connecting engine */}
        <canvas
          ref={canvasRef}
          width={640}
          height={360}
          className={`w-full h-full object-cover ${isPlayingWebRtc ? 'hidden' : 'block'}`}
        />

        {/* Scanlines overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%)] bg-[length:100%_4px] pointer-events-none z-10 opacity-50" />

        {/* Shutter Camera Flash */}
        {snapshotFlash && (
          <div className="absolute inset-0 bg-white z-40 animate-camera-flash pointer-events-none" />
        )}

        {/* Top Badges */}
        <div className="absolute top-2.5 left-2.5 z-20 flex items-center gap-1.5">
          <span className="px-2 py-0.5 rounded text-[10.5px] font-mono font-bold bg-black/80 text-white backdrop-blur-md border border-white/15 shadow-xs">
            {cam.code}
          </span>
          {cam.aiState && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 backdrop-blur-md flex items-center gap-1">
              <Users className="w-2.5 h-2.5" />
              {cam.aiState.peopleCount}
            </span>
          )}
          {cam.aiState && (cam.aiState.phoneViolations > 0 || cam.aiState.ppeViolations > 0) && (
            <span className="px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold bg-red-600/90 text-white backdrop-blur-md flex items-center gap-1 shadow-xs animate-pulse">
              <ShieldAlert className="w-2.5 h-2.5" />
              {cam.aiState.phoneViolations + cam.aiState.ppeViolations} ALERTS
            </span>
          )}
          {isPlayingWebRtc && (
            <span className="px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold bg-red-600 text-white flex items-center gap-1 shadow-xs animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-white" />
              LIVE
            </span>
          )}
        </div>

        <div className="absolute top-2.5 right-2.5 z-20 flex items-center gap-1.5">
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-tight backdrop-blur-md flex items-center gap-1 shadow-xs ${
              isOnline ? 'bg-emerald-500/90 text-white' : 'bg-red-500/90 text-white'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isOnline ? 'bg-white animate-pulse' : 'bg-white'
              }`}
            />
            {cam.status}
          </span>
        </div>

        {/* Hover Quick Action Overlay */}
        <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-30 flex flex-col items-center justify-center gap-2 pointer-events-auto">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                soundService.playTactileBlip(800, 0.03);
                onSelect(cam);
              }}
              className="px-3 py-1.5 rounded-full bg-orange-500 hover:bg-orange-600 text-black font-semibold text-[11.5px] flex items-center gap-1.5 shadow-lg transform hover:scale-105 transition-all cursor-pointer"
              title="Inspect Live Stream"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Open Feed</span>
            </button>

            <button
              type="button"
              onClick={handleQuickSnapshot}
              className="p-1.5 rounded-full bg-white/20 hover:bg-white text-white hover:text-black border border-white/20 backdrop-blur-md transition-all transform hover:scale-105 cursor-pointer"
              title="Capture Instant Snapshot (S)"
            >
              <CameraIcon className="w-3.5 h-3.5" />
            </button>
          </div>

          <span className="text-[10px] font-mono text-zinc-300 drop-shadow">
            Click card to open live drawer
          </span>
        </div>

        {/* Bottom Bar Info */}
        <div className="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-black/90 via-black/50 to-transparent z-20 flex items-center justify-between text-[11px] font-mono text-zinc-300 pointer-events-none">
          <span className="truncate max-w-[140px] text-[10.5px] tracking-tight">{cam.zone}</span>
          <span className="text-[10.5px] tracking-tight text-zinc-400">{cam.ip}</span>
        </div>
      </div>

      {/* Card Body Footer */}
      <div className="p-3.5 flex items-center justify-between gap-2 border-t border-black/[0.04] dark:border-white/[0.06]">
        <div className="min-w-0">
          <h4 className="font-semibold text-[13.5px] text-[#0a0a0a] dark:text-white tracking-tight truncate">
            {cam.name}
          </h4>
          <p className="text-[11px] font-mono text-[#8c8c8c] dark:text-[#71717a] truncate mt-0.5">
            Port {cam.port} • {cam.brand || 'Industrial IP Node'}
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => {
              soundService.playTactileBlip(650, 0.02);
              onEdit(cam);
            }}
            className="p-1.5 text-[#6b6b6b] dark:text-[#a1a1aa] hover:text-black dark:hover:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.06] rounded-md transition-colors cursor-pointer"
            title="Edit Camera Configuration"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              soundService.playTactileBlip(500, 0.03);
              onDelete(cam);
            }}
            className="p-1.5 text-[#ef4444] dark:text-[#f87171] hover:bg-[#ef4444]/10 rounded-md transition-colors cursor-pointer"
            title="Delete Camera"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
