import React from 'react';

export const CameraLoadingSkeleton: React.FC = () => {
  return (
    <div id="camera-loading-skeleton" className="w-full space-y-6 animate-pulse" aria-busy="true">
      {/* Skeleton Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="p-5 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-white dark:bg-[#111115] space-y-3"
          >
            <div className="flex justify-between items-center">
              <div className="h-4 w-24 bg-black/[0.06] dark:bg-white/[0.06] rounded-md animate-shimmer" />
              <div className="h-6 w-6 bg-black/[0.06] dark:bg-white/[0.06] rounded-md animate-shimmer" />
            </div>
            <div className="h-8 w-16 bg-black/[0.08] dark:bg-white/[0.08] rounded-md animate-shimmer" />
            <div className="h-3 w-32 bg-black/[0.04] dark:bg-white/[0.04] rounded-md animate-shimmer" />
          </div>
        ))}
      </div>

      {/* Skeleton Controls Bar */}
      <div className="h-14 bg-black/[0.03] dark:bg-white/[0.03] border border-black/[0.06] dark:border-white/[0.08] rounded-xl animate-shimmer" />

      {/* Skeleton Table */}
      <div className="bg-white dark:bg-[#111115] border border-black/[0.08] dark:border-white/[0.08] rounded-xl overflow-hidden p-6 space-y-4">
        <div className="h-6 bg-black/[0.05] dark:bg-white/[0.06] rounded-md w-full animate-shimmer" />
        {[1, 2, 3, 4, 5, 6, 7].map((row) => (
          <div key={row} className="flex items-center justify-between py-3 border-b border-black/[0.04] dark:border-white/[0.05]">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-black/[0.06] dark:bg-white/[0.06] rounded-lg animate-shimmer" />
              <div className="space-y-1.5">
                <div className="h-4 w-44 bg-black/[0.07] dark:bg-white/[0.07] rounded animate-shimmer" />
                <div className="h-3 w-28 bg-black/[0.04] dark:bg-white/[0.04] rounded animate-shimmer" />
              </div>
            </div>
            <div className="h-5 w-20 bg-black/[0.05] dark:bg-white/[0.05] rounded animate-shimmer" />
            <div className="h-5 w-48 bg-black/[0.05] dark:bg-white/[0.05] rounded animate-shimmer" />
            <div className="h-5 w-16 bg-black/[0.06] dark:bg-white/[0.06] rounded-full animate-shimmer" />
            <div className="h-4 w-20 bg-black/[0.05] dark:bg-white/[0.05] rounded animate-shimmer" />
            <div className="h-8 w-20 bg-black/[0.07] dark:bg-white/[0.07] rounded-lg animate-shimmer" />
          </div>
        ))}
      </div>
    </div>
  );
};
