import React, { useEffect } from 'react';
import { soundService } from '../services/soundService';
import { X, Activity, Server, ShieldCheck, Radio, CheckCircle2, Cpu } from 'lucide-react';

interface GatewayStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  onlineCount: number;
  totalCount: number;
}

export const GatewayStatusModal: React.FC<GatewayStatusModalProps> = ({
  isOpen,
  onClose,
  onlineCount,
  totalCount,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      id="gateway-status-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-xs transition-opacity animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gateway-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[620px] bg-white dark:bg-[#111115] border border-black/[0.12] dark:border-white/[0.12] rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150 flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-black/[0.08] dark:border-white/[0.08] flex items-center justify-between bg-[#fafafa] dark:bg-[#15151b] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-black dark:bg-orange-500 text-white dark:text-black flex items-center justify-center font-bold">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <h3 id="gateway-modal-title" className="text-[16px] font-semibold text-[#0a0a0a] dark:text-white tracking-tight">
                RTSP Stream Gateway Diagnostics
              </h3>
              <p className="text-[11px] font-mono text-[#6b6b6b] dark:text-[#a1a1aa] tracking-tight">
                MediaMTX RTSP-to-WebRTC Multiplexing Cluster
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              soundService.playTactileBlip(500, 0.02);
              onClose();
            }}
            className="p-1.5 text-[#6b6b6b] dark:text-[#a1a1aa] hover:text-black dark:hover:text-white rounded-lg hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
            aria-label="Close gateway status"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 overflow-y-auto">
          {/* Status banner */}
          <div className="p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 dark:bg-emerald-500/15 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
              </span>
              <div>
                <div className="text-[13px] font-semibold text-emerald-800 dark:text-emerald-300">
                  Gateway Engine Operational
                </div>
                <div className="text-[11px] font-mono text-emerald-700/80 dark:text-emerald-400/80">
                  Port 5000 API • Port 8554 RTSP • Port 8889 WebRTC WHEP
                </div>
              </div>
            </div>
            <span className="px-2.5 py-1 text-[11px] font-mono font-bold bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 rounded-lg">
              SYNCED
            </span>
          </div>

          {/* Diagnostics Grid */}
          <div className="grid grid-cols-2 gap-3 text-[12.5px]">
            <div className="p-3.5 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-[#fbfbfb] dark:bg-[#15151b] space-y-1">
              <span className="text-[#8c8c8c] dark:text-[#71717a] text-[11px] font-mono block">
                ACTIVE INGRESS NODES
              </span>
              <div className="text-[20px] font-bold text-[#0a0a0a] dark:text-white font-mono">
                {onlineCount} <span className="text-[13px] text-[#8c8c8c] font-normal">/ {totalCount}</span>
              </div>
              <span className="text-[11px] text-[#17c964] flex items-center gap-1 font-medium">
                <CheckCircle2 className="w-3 h-3" /> Live feed ready
              </span>
            </div>

            <div className="p-3.5 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-[#fbfbfb] dark:bg-[#15151b] space-y-1">
              <span className="text-[#8c8c8c] dark:text-[#71717a] text-[11px] font-mono block">
                AVERAGE LATENCY (RTT)
              </span>
              <div className="text-[20px] font-bold text-orange-500 font-mono">
                &lt; 180ms
              </div>
              <span className="text-[11px] text-[#8c8c8c] dark:text-[#71717a] font-mono">
                Sub-frame jitter buffer
              </span>
            </div>

            <div className="p-3.5 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-[#fbfbfb] dark:bg-[#15151b] space-y-1">
              <span className="text-[#8c8c8c] dark:text-[#71717a] text-[11px] font-mono block">
                TRANSCODING ENGINE
              </span>
              <div className="text-[14px] font-semibold text-[#0a0a0a] dark:text-white font-mono">
                H.264 / H.265 Passthrough
              </div>
              <span className="text-[11px] text-[#8c8c8c] dark:text-[#71717a]">
                Zero CPU re-encode penalty
              </span>
            </div>

            <div className="p-3.5 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-[#fbfbfb] dark:bg-[#15151b] space-y-1">
              <span className="text-[#8c8c8c] dark:text-[#71717a] text-[11px] font-mono block">
                SECURITY ENCRYPTION
              </span>
              <div className="text-[14px] font-semibold text-emerald-600 dark:text-emerald-400 font-mono flex items-center gap-1">
                <ShieldCheck className="w-4 h-4" />
                AES-256-GCM
              </div>
              <span className="text-[11px] text-[#8c8c8c] dark:text-[#71717a]">
                Hardware key vault active
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-black/[0.08] dark:border-white/[0.08] bg-[#fafafa] dark:bg-[#15151b] flex items-center justify-between text-[11.5px] text-[#8c8c8c] dark:text-[#71717a]">
          <span>MediaMTX v1.11.3 • WebRTC WHEP Engine</span>
          <button
            onClick={onClose}
            className="px-3 py-1 bg-[#0a0a0a] dark:bg-orange-500 text-white dark:text-black rounded-lg text-[12px] font-semibold cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
