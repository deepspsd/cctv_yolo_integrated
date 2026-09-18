import React, { useState, useEffect } from 'react';
import { Video, Shield, Activity, Radio, Eye, RefreshCw, Crosshair, AlertTriangle } from 'lucide-react';

export const SurveillanceLiveVisualizer: React.FC = () => {
  const [activeCam, setActiveCam] = useState<'CAM-01' | 'CAM-02' | 'CAM-03' | 'CAM-04'>('CAM-01');
  const [visionMode, setVisionMode] = useState<'orange' | 'night' | 'flir'>('orange');
  const [timecode, setTimecode] = useState('');
  const [fps, setFps] = useState(59.94);
  const [bitrate, setBitrate] = useState(8.4);
  const [motionAlert, setMotionAlert] = useState(false);

  // Live millisecond timecode generator
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      const iso = now.toISOString().replace('T', ' ').slice(0, 23);
      setTimecode(`${iso} UTC`);
    };
    updateClock();
    const interval = setInterval(updateClock, 47);
    return () => clearInterval(interval);
  }, []);

  // Subtle telemetry jitter
  useEffect(() => {
    const jitter = setInterval(() => {
      setFps(+(59.8 + Math.random() * 0.4).toFixed(2));
      setBitrate(+(8.1 + Math.random() * 0.7).toFixed(1));
    }, 2000);
    return () => clearInterval(jitter);
  }, []);

  // Trigger motion flash
  const handleTriggerMotion = () => {
    setMotionAlert(true);
    setTimeout(() => setMotionAlert(false), 2400);
  };

  const isOrange = visionMode === 'orange';
  const isNight = visionMode === 'night';

  const accentColor = isOrange ? '#f97316' : isNight ? '#17c964' : '#ffffff';

  return (
    <div
      id="surveillance-visualizer-panel"
      className={`h-full w-full flex flex-col justify-between p-3.5 sm:p-4 text-white relative select-none overflow-hidden transition-colors duration-500 ${
        isOrange ? 'bg-[#08080a]' : isNight ? 'bg-[#031408]' : 'bg-[#0a0a0a]'
      }`}
    >
      {/* Background Matrix Grid Pattern */}
      <div
        className="absolute inset-0 pointer-events-none opacity-25"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, ${accentColor} 1.2px, transparent 0)`,
          backgroundSize: '20px 20px',
        }}
      />

      {/* Sweeping CRT Scanline Overlay */}
      <div className="absolute inset-x-0 h-16 pointer-events-none bg-gradient-to-b from-transparent via-orange-500/[0.08] to-transparent animate-scanline z-20" />

      {/* Top Bar: Terminal Node Header & Stream Status */}
      <div className="relative z-10 shrink-0">
        <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/[0.1]">
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500" />
            </span>
            <span className="text-[10px] font-mono font-bold tracking-widest text-white uppercase">
              REC [LIVE]
            </span>
            <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-white/[0.08] text-[#a3a3a3]">
              {fps} FPS
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                setVisionMode((m) => (m === 'orange' ? 'night' : m === 'night' ? 'flir' : 'orange'))
              }
              className={`px-2 py-0.5 rounded text-[10px] font-mono flex items-center gap-1 transition-all cursor-pointer border ${
                isOrange
                  ? 'bg-orange-500 text-black border-orange-500 font-bold shadow-[0_0_10px_rgba(249,115,22,0.5)]'
                  : isNight
                  ? 'bg-[#17c964] text-black border-[#17c964] font-semibold'
                  : 'bg-white/[0.06] hover:bg-white/[0.12] text-white/80 border-white/[0.12]'
              }`}
              title="Toggle Vision Mode: Cyber Orange / NVG Green / FLIR B&W"
            >
              <Eye className="w-2.5 h-2.5" />
              <span>{isOrange ? 'ORANGE OPTIC' : isNight ? 'NVG GREEN' : 'FLIR B&W'}</span>
            </button>

            <button
              type="button"
              onClick={handleTriggerMotion}
              className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-white/[0.06] hover:bg-white/[0.12] text-white/80 border border-white/[0.12] flex items-center gap-1 cursor-pointer hover:border-orange-500/50"
              title="Simulate Motion Breach"
            >
              <Radio className="w-2.5 h-2.5 text-orange-400" />
              <span>PING</span>
            </button>
          </div>
        </div>

        {/* Camera Selector Tabs */}
        <div className="grid grid-cols-4 gap-1 mt-2">
          {[
            { id: 'CAM-01', label: '01 GATE', zone: 'North Ingress' },
            { id: 'CAM-02', label: '02 VAULT', zone: 'Server Rm 4B' },
            { id: 'CAM-03', label: '03 PERIM', zone: 'East Fence' },
            { id: 'CAM-04', label: '04 DRONE', zone: 'Air Patrol' },
          ].map((cam) => {
            const isSelected = activeCam === cam.id;
            return (
              <button
                key={cam.id}
                type="button"
                onClick={() => setActiveCam(cam.id as any)}
                className={`py-1 px-1.5 rounded-md text-left transition-all cursor-pointer border ${
                  isSelected
                    ? isOrange
                      ? 'bg-orange-500/20 border-orange-500 text-orange-400 shadow-[0_0_8px_rgba(249,115,22,0.3)]'
                      : isNight
                      ? 'bg-[#17c964]/20 border-[#17c964] text-[#17c964]'
                      : 'bg-white text-black border-white shadow-xs'
                    : 'bg-white/[0.04] border-white/[0.08] text-white/60 hover:text-white hover:bg-white/[0.08]'
                }`}
              >
                <div className="text-[10px] font-mono font-semibold leading-none">{cam.label}</div>
                <div
                  className={`text-[8px] truncate mt-0.5 ${
                    isSelected ? (isOrange ? 'text-orange-300' : isNight ? 'text-[#17c964]/80' : 'text-black/70') : 'text-white/40'
                  }`}
                >
                  {cam.zone}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Middle: Simulated Live CCTV Feed Screen with Optical Reticles & Animated Radar */}
      <div
        className={`my-2 relative rounded-lg border overflow-hidden flex-1 min-h-[140px] max-h-[220px] flex flex-col justify-between p-2.5 transition-colors duration-500 ${
          isOrange
            ? 'border-orange-500/40 bg-black/85 text-orange-400'
            : isNight
            ? 'border-[#17c964]/40 bg-black/80 text-[#17c964]'
            : 'border-white/[0.15] bg-black/60 text-white'
        }`}
      >
        {/* Optical Viewfinder Corner Brackets */}
        <div className="absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-current pointer-events-none opacity-80" />
        <div className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-current pointer-events-none opacity-80" />
        <div className="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-current pointer-events-none opacity-80" />
        <div className="absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-current pointer-events-none opacity-80" />

        {/* Center Optical Crosshair */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-30">
          <Crosshair className="w-16 h-16 stroke-[1]" />
        </div>

        {/* Live Camera View Mode Visuals */}
        {activeCam === 'CAM-01' && (
          /* Radar Sweep / Gate Scanner */
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative w-48 h-48 rounded-full border border-current opacity-25">
              {/* Concentric rings */}
              <div className="absolute inset-6 rounded-full border border-current" />
              <div className="absolute inset-14 rounded-full border border-current" />
              {/* Rotating radar sweep beam */}
              <div
                className="absolute inset-0 rounded-full animate-radar pointer-events-none"
                style={{
                  background: `conic-gradient(from 0deg, transparent 0deg, transparent 270deg, ${
                    isOrange ? 'rgba(249,115,22,0.45)' : isNight ? 'rgba(23,201,100,0.35)' : 'rgba(255,255,255,0.3)'
                  } 360deg)`,
                }}
              />
              {/* Radar Blips */}
              <div className="absolute top-10 left-12 w-2 h-2 rounded-full bg-orange-500 animate-ping" />
              <div className="absolute top-10 left-12 w-2 h-2 rounded-full bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.8)]" />
              <div className="absolute bottom-12 right-10 w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            </div>
          </div>
        )}

        {activeCam === 'CAM-02' && (
          /* High Security Server Vault with Moving Laser Grid */
          <div className="absolute inset-0 pointer-events-none overflow-hidden flex flex-col justify-center">
            <div className="absolute inset-x-4 h-0.5 bg-orange-500 animate-laser shadow-[0_0_10px_#f97316]" />
            <div className="text-center font-mono text-[11px] opacity-70 tracking-wider text-orange-400">
              [VAULT INTRUSION TRIPWIRE: ARMED]
            </div>
          </div>
        )}

        {activeCam === 'CAM-03' && (
          /* Perimeter AI Tracking Box */
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="w-36 h-44 border-2 border-dashed border-orange-500 rounded p-1.5 animate-pulse-subtle relative shadow-[0_0_12px_rgba(249,115,22,0.25)]">
              <div className="absolute -top-5 left-0 px-1.5 py-0.5 bg-orange-500 text-black text-[9px] font-mono font-bold rounded">
                PERSON [99.4%]
              </div>
              <div className="absolute -bottom-4 right-0 text-[9px] font-mono opacity-80 text-orange-300">
                VEL: 1.2 m/s
              </div>
            </div>
          </div>
        )}

        {activeCam === 'CAM-04' && (
          /* Aerial Patrol Topological Overlay */
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="w-40 h-40 border border-current rounded-full flex items-center justify-center opacity-30">
              <div className="w-28 h-28 border border-current rounded-full flex items-center justify-center">
                <div className="w-16 h-16 border border-current rounded-full" />
              </div>
            </div>
            <div className="absolute bottom-4 left-4 font-mono text-[10px] opacity-75">
              ALT: 120M • PTZ 45°
            </div>
          </div>
        )}

        {/* Motion Alert Flash Banner */}
        {motionAlert && (
          <div className="absolute inset-x-3 top-10 bg-orange-600 text-black font-extrabold p-2 rounded flex items-center justify-center gap-2 font-mono text-[11px] tracking-wider animate-bounce z-30 shadow-[0_0_15px_rgba(249,115,22,0.8)]">
            <AlertTriangle className="w-3.5 h-3.5 text-black" />
            <span>MOTION DETECTED IN PERIMETER SECTOR 03</span>
          </div>
        )}

        {/* Live HUD Overlay Info */}
        <div className="relative z-10 flex items-start justify-between">
          <div className="font-mono text-[10px] space-y-0.5 bg-black/60 p-1.5 rounded backdrop-blur-xs border border-white/[0.08]">
            <div className="font-bold flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500 shadow-[0_0_6px_rgba(249,115,22,0.8)]" />
              <span>NODE: {activeCam}</span>
            </div>
            <div className="opacity-80">CODEC: H.265 / HEVC</div>
            <div className="opacity-80">BITRATE: {bitrate} Mbps</div>
          </div>

          <div className="font-mono text-[10px] text-right bg-black/60 p-1.5 rounded backdrop-blur-xs border border-white/[0.08]">
            <div className="opacity-80">LATENCY: 18ms</div>
            <div className="text-orange-400 font-semibold">ENCRYPTED</div>
          </div>
        </div>

        {/* Bottom Audio/Telemetry Equalizer Waveform & Timestamp */}
        <div className="relative z-10 shrink-0">
          {/* Animated Waveform Bars */}
          <div className="flex items-end gap-0.5 h-3.5 mb-1 opacity-80">
            {[45, 80, 60, 95, 30, 70, 85, 40, 65, 90, 50, 75, 95, 60, 80, 55, 35, 70].map(
              (height, idx) => (
                <div
                  key={idx}
                  className="flex-1 bg-orange-500 rounded-xs transition-all duration-300 shadow-[0_0_4px_rgba(249,115,22,0.4)]"
                  style={{
                    height: `${Math.max(15, (height * (fps / 60)) % 100)}%`,
                    opacity: 0.4 + (idx % 3) * 0.2,
                  }}
                />
              )
            )}
          </div>

          <div className="flex items-center justify-between text-[9.5px] font-mono pt-1 border-t border-current/20">
            <span className="truncate">{timecode || 'SYNCHRONIZING TELEMETRY...'}</span>
            <span className="shrink-0 font-bold ml-2">OCCUSAFE® RTSP</span>
          </div>
        </div>
      </div>

      {/* Bottom Status Telemetry Metrics */}
      <div className="relative z-10 pt-1.5 border-t border-white/[0.1] shrink-0">
        <div className="grid grid-cols-3 gap-1.5 text-center">
          <div className="p-1.5 rounded-md bg-white/[0.04] border border-white/[0.06]">
            <div className="text-[9px] font-mono text-[#8c8c8c] uppercase tracking-wider">
              Surveillance
            </div>
            <div className="text-[11px] font-semibold font-mono text-orange-400 mt-0.2">
              22/22 Online
            </div>
          </div>

          <div className="p-1.5 rounded-md bg-white/[0.04] border border-white/[0.06]">
            <div className="text-[9px] font-mono text-[#8c8c8c] uppercase tracking-wider">
              Ingress Sec
            </div>
            <div className="text-[11px] font-semibold font-mono text-white mt-0.2">
              AES-256-GCM
            </div>
          </div>

          <div className="p-1.5 rounded-md bg-white/[0.04] border border-white/[0.06]">
            <div className="text-[9px] font-mono text-[#8c8c8c] uppercase tracking-wider">
              Pipeline
            </div>
            <div className="text-[11px] font-semibold font-mono text-white mt-0.2">
              Sub-200ms
            </div>
          </div>
        </div>

        <div className="mt-1.5 flex items-center justify-between text-[10px] font-mono text-[#8c8c8c]">
          <span className="flex items-center gap-1">
            <Activity className="w-2.5 h-2.5 text-orange-400" />
            <span>Zero-Leak Protocol</span>
          </span>
          <span>Gateway v2.4.9</span>
        </div>
      </div>
    </div>
  );
};
