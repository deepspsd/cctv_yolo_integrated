import React, { useEffect, useMemo } from 'react';
import { Camera } from '../types';
import { soundService } from '../services/soundService';
import { X, Layers, Video, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';

interface FacilityZonesModalProps {
  isOpen: boolean;
  onClose: () => void;
  cameras: Camera[];
  onSelectZone: (zone: string) => void;
}

export const FacilityZonesModal: React.FC<FacilityZonesModalProps> = ({
  isOpen,
  onClose,
  cameras,
  onSelectZone,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const zoneStats = useMemo(() => {
    const map = new Map<string, { total: number; online: number; offline: number; cameras: Camera[] }>();
    cameras.forEach((cam) => {
      const z = cam.zone || 'UNASSIGNED';
      const entry = map.get(z) || { total: 0, online: 0, offline: 0, cameras: [] };
      entry.total += 1;
      if (cam.status === 'ONLINE') entry.online += 1;
      else if (cam.status === 'OFFLINE') entry.offline += 1;
      entry.cameras.push(cam);
      map.set(z, entry);
    });

    return Array.from(map.entries()).map(([zone, stats]) => ({
      zone,
      ...stats,
      healthPct: stats.total > 0 ? Math.round((stats.online / stats.total) * 100) : 0,
    })).sort((a, b) => b.total - a.total);
  }, [cameras]);

  if (!isOpen) return null;

  return (
    <div
      id="facility-zones-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-xs transition-opacity animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="zones-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[680px] bg-white dark:bg-[#111115] border border-black/[0.12] dark:border-white/[0.12] rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150 flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-black/[0.08] dark:border-white/[0.08] flex items-center justify-between bg-[#fafafa] dark:bg-[#15151b] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-black dark:bg-orange-500 text-white dark:text-black flex items-center justify-center font-bold">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h3 id="zones-modal-title" className="text-[16px] font-semibold text-[#0a0a0a] dark:text-white tracking-tight">
                Zones & Facility Telemetry
              </h3>
              <p className="text-[11px] font-mono text-[#6b6b6b] dark:text-[#a1a1aa] tracking-tight">
                Priya Textiles site camera distribution ({zoneStats.length} active zones)
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-[#6b6b6b] dark:text-[#a1a1aa] hover:text-black dark:hover:text-white rounded-lg hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
            aria-label="Close zones modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Zones List */}
        <div className="p-6 overflow-y-auto space-y-3">
          {zoneStats.length === 0 ? (
            <div className="text-center py-8 text-[13px] text-[#8c8c8c]">
              No active zones detected in network.
            </div>
          ) : (
            zoneStats.map((item) => (
              <div
                key={item.zone}
                onClick={() => {
                  soundService.playTactileBlip(750, 0.02);
                  onSelectZone(item.zone);
                  onClose();
                }}
                className="group p-4 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-[#fbfbfb] dark:bg-[#15151b] hover:border-black/30 dark:hover:border-orange-500/50 hover:bg-white dark:hover:bg-[#181822] transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-[13.5px] text-[#0a0a0a] dark:text-white tracking-tight truncate">
                      {item.zone}
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.06] text-[#6b6b6b] dark:text-[#a1a1aa]">
                      {item.total} {item.total === 1 ? 'node' : 'nodes'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[11.5px] font-mono">
                    <span className="flex items-center gap-1 text-[#17c964] dark:text-[#22c55e]">
                      <CheckCircle2 className="w-3 h-3" /> {item.online} Online
                    </span>
                    {item.offline > 0 && (
                      <span className="flex items-center gap-1 text-[#ef4444] dark:text-[#f87171]">
                        <AlertCircle className="w-3 h-3" /> {item.offline} Offline
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  {/* Progress bar */}
                  <div className="w-24 sm:w-32 hidden xs:block">
                    <div className="flex justify-between text-[10px] font-mono text-[#8c8c8c] dark:text-[#71717a] mb-1">
                      <span>Health</span>
                      <span>{item.healthPct}%</span>
                    </div>
                    <div className="h-1.5 w-full bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#17c964] dark:bg-orange-500 rounded-full transition-all"
                        style={{ width: `${item.healthPct}%` }}
                      />
                    </div>
                  </div>

                  <span className="text-[12px] font-medium text-black dark:text-orange-400 group-hover:translate-x-0.5 transition-transform flex items-center gap-1">
                    Filter Zone <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-black/[0.08] dark:border-white/[0.08] bg-[#fafafa] dark:bg-[#15151b] flex items-center justify-between text-[12px] text-[#6b6b6b] dark:text-[#a1a1aa]">
          <span>Click any zone above to instantly filter camera table & wall</span>
          <button
            onClick={() => {
              onSelectZone('ALL');
              onClose();
            }}
            className="px-3 py-1 text-black dark:text-orange-400 font-semibold hover:underline cursor-pointer"
          >
            Show All Zones
          </button>
        </div>
      </div>
    </div>
  );
};
