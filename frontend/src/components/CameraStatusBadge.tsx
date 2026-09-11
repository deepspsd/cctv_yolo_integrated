import React from 'react';
import { CameraStatus } from '../types';
import { Loader2 } from 'lucide-react';

interface CameraStatusBadgeProps {
  status: CameraStatus;
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
  size?: 'sm' | 'md';
}

export const CameraStatusBadge: React.FC<CameraStatusBadgeProps> = ({
  status,
  onClick,
  className = '',
  size = 'md',
}) => {
  const getStatusConfig = () => {
    switch (status) {
      case 'ONLINE':
        return {
          label: 'Online',
          bg: 'bg-[#17c964]/10 text-[#0d7d3d] border-[#17c964]/25',
          dot: 'bg-[#17c964]',
          ping: true,
        };
      case 'OFFLINE':
        return {
          label: 'Offline',
          bg: 'bg-[#ef4444]/10 text-[#b91c1c] border-[#ef4444]/25',
          dot: 'bg-[#ef4444]',
          ping: false,
        };
      case 'CHECKING':
        return {
          label: 'Checking',
          bg: 'bg-[#f59e0b]/10 text-[#b45309] border-[#f59e0b]/25',
          dot: 'bg-[#f59e0b]',
          loading: true,
        };
      case 'UNKNOWN':
      default:
        return {
          label: 'Unknown',
          bg: 'bg-black/[0.04] text-[#6b6b6b] border-black/[0.08]',
          dot: 'bg-[#8c8c8c]',
          ping: false,
        };
    }
  };

  const config = getStatusConfig();
  const isClickable = Boolean(onClick);

  return (
    <span
      onClick={onClick}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={(e) => {
        if (isClickable && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick?.(e as any);
        }
      }}
      className={`inline-flex items-center gap-1.5 font-medium tracking-tight rounded-full border transition-all select-none ${
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-[12px]'
      } ${config.bg} ${
        isClickable
          ? 'cursor-pointer hover:shadow-xs hover:brightness-95 active:scale-95'
          : ''
      } ${className}`}
      title={`Camera status is currently ${config.label}. Click to open live stream.`}
    >
      {config.loading ? (
        <Loader2 className="w-3 h-3 animate-spin text-[#b45309]" />
      ) : (
        <span className="relative flex h-2 w-2">
          {config.ping && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#17c964] opacity-75"></span>
          )}
          <span className={`relative inline-flex rounded-full h-2 w-2 ${config.dot}`}></span>
        </span>
      )}
      <span className="font-semibold uppercase tracking-wider text-[11px]">{config.label}</span>
    </span>
  );
};
