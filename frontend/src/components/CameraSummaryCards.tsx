import React from 'react';
import { Video, CheckCircle2, AlertCircle, Eye, Radio, Activity } from 'lucide-react';
import { CameraSummary, StatusFilter } from '../types';
import { soundService } from '../services/soundService';

interface CameraSummaryCardsProps {
  summary: CameraSummary;
  activeStatusFilter: StatusFilter;
  onSelectStatusFilter: (status: StatusFilter) => void;
}

export const CameraSummaryCards: React.FC<CameraSummaryCardsProps> = ({
  summary,
  activeStatusFilter,
  onSelectStatusFilter,
}) => {
  const total = summary.total || 0;
  const online = summary.online || 0;
  const offline = summary.offline || 0;
  const viewing = summary.currentlyViewing || 0;
  const onlinePct = total > 0 ? Math.round((online / total) * 100) : 0;

  const cards = [
    {
      id: 'total-cameras-card',
      label: 'Total Nodes',
      value: total,
      filter: 'All' as StatusFilter,
      icon: Video,
      description: 'Full network camera inventory',
      tag: '100% Ingress',
      tagStyle: 'bg-black/[0.04] dark:bg-white/[0.06] text-[#4a4a4a] dark:text-[#d4d4d8] border-black/[0.06] dark:border-white/[0.08]',
      progressPct: 100,
      progressColor: 'bg-black/50 dark:bg-white/50',
      dotColor: 'bg-black/60 dark:bg-white/60',
      glowColor: 'group-hover:shadow-[0_0_25px_rgba(255,255,255,0.06)]',
    },
    {
      id: 'online-cameras-card',
      label: 'Online Telemetry',
      value: online,
      filter: 'ONLINE' as StatusFilter,
      icon: CheckCircle2,
      description: `${onlinePct}% availability across zones`,
      tag: `${onlinePct}% Active`,
      tagStyle: 'bg-[#17c964]/10 text-[#0d7d3d] dark:text-[#22c55e] border-[#17c964]/25',
      progressPct: onlinePct,
      progressColor: 'bg-[#17c964]',
      dotColor: 'bg-[#17c964]',
      pulse: true,
      glowColor: 'hover:shadow-[0_0_25px_rgba(23,201,100,0.12)]',
    },
    {
      id: 'offline-cameras-card',
      label: 'Offline Alerts',
      value: offline,
      filter: 'OFFLINE' as StatusFilter,
      icon: AlertCircle,
      description: offline > 0 ? 'Attention: RTSP link lost' : 'Optimal network health',
      tag: offline > 0 ? `${offline} Dropped` : 'Zero Faults',
      tagStyle:
        offline > 0
          ? 'bg-[#ef4444]/10 text-[#b91c1c] dark:text-[#f87171] border-[#ef4444]/25'
          : 'bg-[#17c964]/10 text-[#0d7d3d] dark:text-[#22c55e] border-[#17c964]/25',
      progressPct: total > 0 ? Math.round((offline / total) * 100) : 0,
      progressColor: offline > 0 ? 'bg-[#ef4444]' : 'bg-[#17c964]',
      dotColor: offline > 0 ? 'bg-[#ef4444]' : 'bg-[#17c964]',
      glowColor: offline > 0 ? 'hover:shadow-[0_0_25px_rgba(239,68,68,0.15)]' : 'hover:shadow-[0_0_25px_rgba(23,201,100,0.12)]',
    },
    {
      id: 'viewing-cameras-card',
      label: 'Active Stream',
      value: viewing,
      filter: 'All' as StatusFilter,
      icon: Eye,
      description: viewing > 0 ? 'Live WebRTC pipeline open' : 'No active feed open',
      tag: viewing > 0 ? 'Streaming Now' : 'Standby',
      tagStyle:
        viewing > 0
          ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30'
          : 'bg-black/[0.04] dark:bg-white/[0.06] text-[#6b6b6b] dark:text-[#a1a1aa] border-black/[0.06] dark:border-white/[0.08]',
      progressPct: viewing > 0 ? 100 : 0,
      progressColor: 'bg-orange-500',
      dotColor: viewing > 0 ? 'bg-orange-500' : 'bg-[#8c8c8c]',
      disableFilterClick: true,
      glowColor: viewing > 0 ? 'hover:shadow-[0_0_25px_rgba(249,115,22,0.2)]' : '',
    },
  ];

  return (
    <section id="camera-summary-section" aria-label="Camera Status Summary" className="w-full">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {cards.map((card) => {
          const isFilterActive = !card.disableFilterClick && activeStatusFilter === card.filter;
          const Icon = card.icon;

          return (
            <button
              key={card.id}
              id={card.id}
              type="button"
              onClick={() => {
                if (!card.disableFilterClick) {
                  soundService.playTactileBlip(isFilterActive ? 480 : 640, 0.025);
                  if (activeStatusFilter === card.filter && card.filter !== 'All') {
                    onSelectStatusFilter('All');
                  } else {
                    onSelectStatusFilter(card.filter);
                  }
                }
              }}
              disabled={card.disableFilterClick}
              className={`group text-left p-4 sm:p-5 rounded-2xl border transition-all duration-200 relative overflow-hidden flex flex-col justify-between ${
                card.disableFilterClick
                  ? 'cursor-default bg-white dark:bg-[#111116]'
                  : 'cursor-pointer hover:border-black/30 dark:hover:border-orange-500/50 bg-white dark:bg-[#111116] hover:bg-[#fafafa] dark:hover:bg-[#15151c]'
              } ${card.glowColor} ${
                isFilterActive
                  ? 'ring-2 ring-orange-500/70 border-orange-500 bg-[#fbfbfb] dark:bg-[#16161f] shadow-md dark:shadow-[0_0_20px_rgba(249,115,22,0.15)]'
                  : 'border-black/[0.08] dark:border-white/[0.08]'
              }`}
            >
              {/* Header: Label & Icon */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="relative flex h-2 w-2 shrink-0">
                      {card.pulse && (
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#17c964] opacity-75" />
                      )}
                      <span className={`relative inline-flex rounded-full h-2 w-2 ${card.dotColor}`} />
                    </span>
                    <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#6b6b6b] dark:text-[#a1a1aa] truncate">
                      {card.label}
                    </span>
                  </div>

                  <span className="p-1.5 rounded-lg border border-black/[0.05] dark:border-white/[0.08] bg-[#fbfbfb] dark:bg-[#171720] text-[#6b6b6b] dark:text-[#a1a1aa] group-hover:text-black dark:group-hover:text-orange-400 group-hover:border-black/20 dark:group-hover:border-orange-500/30 transition-all shrink-0">
                    <Icon className="w-4 h-4" />
                  </span>
                </div>

                {/* Big Metric Value & Tag */}
                <div className="flex items-baseline justify-between gap-2 mb-3">
                  <div className="font-sans font-bold text-[34px] sm:text-[40px] leading-none text-[#0a0a0a] dark:text-white tracking-tightest tabular-nums">
                    {card.value}
                  </div>
                  <span
                    className={`text-[10.5px] font-mono font-semibold tracking-tight px-2 py-0.5 rounded-full border shrink-0 shadow-2xs ${card.tagStyle}`}
                  >
                    {card.tag}
                  </span>
                </div>
              </div>

              {/* Progress Bar & Subtitle */}
              <div>
                <div className="w-full h-1.5 bg-black/[0.05] dark:bg-white/[0.06] rounded-full overflow-hidden mb-2">
                  <div
                    className={`h-full rounded-full transition-all duration-600 ${card.progressColor}`}
                    style={{ width: `${Math.max(card.progressPct, 4)}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11.5px] text-[#8c8c8c] dark:text-[#71717a] tracking-tight">
                  <span className="truncate">{card.description}</span>
                  {!card.disableFilterClick && (
                    <span
                      className={`text-[10.5px] font-medium font-mono uppercase transition-opacity ml-1.5 shrink-0 ${
                        isFilterActive
                          ? 'text-black dark:text-orange-400 opacity-100 font-bold'
                          : 'text-[#6b6b6b] dark:text-orange-400 opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      {isFilterActive ? 'Filtered' : 'Filter'}
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
};
