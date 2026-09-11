import React from 'react';
import { Video, Plus, RotateCcw } from 'lucide-react';

interface CameraEmptyStateProps {
  onAddCamera: () => void;
  isFiltered?: boolean;
  onClearFilters?: () => void;
}

export const CameraEmptyState: React.FC<CameraEmptyStateProps> = ({
  onAddCamera,
  isFiltered = false,
  onClearFilters,
}) => {
  return (
    <div
      id="camera-empty-state"
      className="w-full bg-white dark:bg-[#111115] border border-black/[0.08] dark:border-white/[0.08] rounded-xl p-12 text-center flex flex-col items-center justify-center space-y-4"
    >
      <div className="w-14 h-14 rounded-2xl bg-black/[0.04] dark:bg-white/[0.04] border border-black/[0.08] dark:border-white/[0.08] flex items-center justify-center text-[#0a0a0a] dark:text-white">
        <Video className="w-7 h-7" />
      </div>

      <div className="max-w-[420px]">
        <h3 className="text-[20px] font-semibold text-[#0a0a0a] dark:text-white tracking-tight">
          {isFiltered ? 'No Matching Cameras' : 'No Cameras Configured'}
        </h3>
        <p className="text-[14px] text-[#6b6b6b] dark:text-[#a1a1aa] mt-1.5 leading-relaxed tracking-tight">
          {isFiltered
            ? 'No cameras match your current search query or status filter. Try clearing the filter to see all cameras.'
            : 'Add your first CCTV camera to begin monitoring camera connectivity, RTSP streams, and live facility zones.'}
        </p>

        {!isFiltered && (
          <div className="mt-4 p-3.5 rounded-xl border border-black/[0.06] dark:border-white/[0.08] bg-[#fafafa] dark:bg-[#16161c] text-left text-[12px] font-mono text-[#6b6b6b] dark:text-[#a1a1aa] space-y-1">
            <div className="font-semibold uppercase tracking-wider text-[10px] text-orange-500 mb-1">
              Quick Setup Checklist:
            </div>
            <div>• Connect camera to Priya Textiles local surveillance LAN</div>
            <div>• Ensure camera RTSP port 554 is reachable</div>
            <div>• Have stream credentials ready (admin / camera password)</div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-2">
        {isFiltered ? (
          <button
            onClick={onClearFilters}
            className="px-4 py-2 bg-[#0a0a0a] dark:bg-white dark:text-black hover:bg-black/80 text-white rounded-lg text-[13px] font-medium tracking-tight transition-all cursor-pointer shadow-xs"
          >
            Clear Active Filters
          </button>
        ) : (
          <button
            id="empty-add-camera-btn"
            onClick={onAddCamera}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#0a0a0a] dark:bg-orange-500 hover:bg-black/80 dark:hover:bg-orange-600 text-white dark:text-black rounded-lg text-[13px] font-semibold tracking-tight transition-all cursor-pointer shadow-xs active:scale-98"
          >
            <Plus className="w-4 h-4" />
            <span>+ Add Camera</span>
          </button>
        )}
      </div>
    </div>
  );
};
