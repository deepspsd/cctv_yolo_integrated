import React, { useState, useMemo, useEffect } from 'react';
import { Camera } from '../types';
import { CameraStatusBadge } from './CameraStatusBadge';
import { maskRtspUrl, formatRelativeTime, formatFullDateTime } from '../services/cameraService';
import { soundService } from '../services/soundService';
import {
  Video,
  Copy,
  Check,
  Eye,
  Edit2,
  Trash2,
  ArrowUpDown,
  ChevronUp,
  ChevronDown,
  Activity,
  Shield,
  Users,
  ShieldAlert,
} from 'lucide-react';

interface CameraTableProps {
  cameras: Camera[];
  selectedCameraId: string | null;
  onSelectCamera: (camera: Camera) => void;
  onEditCamera: (camera: Camera) => void;
  onDeleteCamera: (camera: Camera) => void;
  onCopySuccess: (msg: string) => void;
  searchQuery?: string;
  density?: 'comfortable' | 'compact';
}

type SortField = 'name' | 'zone' | 'rtspUrl' | 'status' | 'lastChecked' | 'lastOnline';
type SortOrder = 'asc' | 'desc';

export const CameraTable: React.FC<CameraTableProps> = ({
  cameras,
  selectedCameraId,
  onSelectCamera,
  onEditCamera,
  onDeleteCamera,
  onCopySuccess,
  searchQuery = '',
  density = 'comfortable',
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  // Real-time ticker: force re-render every 5 seconds so relative times update live
  const [, setClockTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setClockTick((t) => (t + 1) % 10000);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const handleSort = (field: SortField) => {
    soundService.playTactileBlip(620, 0.02);
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const extractCameraNumber = (name: string, code?: string): number | null => {
    const matchName = name.match(/\d+/);
    if (matchName) return parseInt(matchName[0], 10);
    if (code) {
      const matchCode = code.match(/\d+/);
      if (matchCode) return parseInt(matchCode[0], 10);
    }
    return null;
  };

  const sortedCameras = useMemo(() => {
    return [...cameras].sort((a, b) => {
      if (sortField === 'name') {
        const numA = extractCameraNumber(a.name, a.code);
        const numB = extractCameraNumber(b.name, b.code);
        if (numA !== null && numB !== null && numA !== numB) {
          return sortOrder === 'asc' ? numA - numB : numB - numA;
        }
        const cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        return sortOrder === 'asc' ? cmp : -cmp;
      }

      if (sortField === 'status') {
        const statusWeight: Record<string, number> = { ONLINE: 1, CHECKING: 2, OFFLINE: 3, UNKNOWN: 4 };
        const diff = (statusWeight[a.status] || 99) - (statusWeight[b.status] || 99);
        return sortOrder === 'asc' ? diff : -diff;
      }

      if (sortField === 'lastChecked' || sortField === 'lastOnline') {
        const timeA = a[sortField] ? new Date(a[sortField]!).getTime() : 0;
        const timeB = b[sortField] ? new Date(b[sortField]!).getTime() : 0;
        const diff = timeA - timeB;
        return sortOrder === 'asc' ? diff : -diff;
      }

      const aVal = a[sortField] || '';
      const bVal = b[sortField] || '';
      if (typeof aVal === 'string') {
        const cmp = aVal.localeCompare(String(bVal), undefined, { numeric: true, sensitivity: 'base' });
        return sortOrder === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
  }, [cameras, sortField, sortOrder]);

  const handleCopyRtsp = (e: React.MouseEvent, camera: Camera) => {
    e.stopPropagation();
    soundService.playTactileBlip(800, 0.03);
    navigator.clipboard.writeText(camera.rtspUrl);
    setCopiedId(camera.id);
    onCopySuccess(`Copied RTSP URL for ${camera.name}`);
    setTimeout(() => {
      setCopiedId(null);
    }, 2000);
  };

  // Search match highlight helper
  const highlightMatch = (text: string, query: string) => {
    if (!query.trim()) return text;
    const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
    return (
      <>
        {parts.map((part, i) =>
          part.toLowerCase() === query.toLowerCase() ? (
            <mark
              key={i}
              className="bg-orange-500/20 text-orange-600 dark:text-orange-400 font-semibold rounded px-0.5"
            >
              {part}
            </mark>
          ) : (
            part
          )
        )}
      </>
    );
  };

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 opacity-35 group-hover:opacity-80 transition-opacity" />;
    }
    return sortOrder === 'asc' ? (
      <ChevronUp className="w-3 h-3 text-orange-500 font-bold" />
    ) : (
      <ChevronDown className="w-3 h-3 text-orange-500 font-bold" />
    );
  };

  const isCompact = density === 'compact';
  const rowPadding = isCompact ? 'py-2' : 'py-3.5';

  return (
    <div
      id="camera-table-container"
      className="w-full bg-white dark:bg-[#111116] border border-black/[0.08] dark:border-white/[0.08] rounded-2xl overflow-hidden shadow-sm transition-colors flex flex-col"
    >
      <div className="w-full overflow-x-auto overflow-y-auto max-h-[660px] scroll-smooth">
        <table
          id="camera-management-table"
          className="w-full min-w-[820px] sm:min-w-0 table-fixed text-left border-collapse"
        >
          {/* Proportional Colgroup summing to 100% */}
          <colgroup>
            <col className="w-[26%]" />
            <col className="w-[12%]" />
            <col className="w-[23%]" />
            <col className="w-[11%]" />
            <col className="w-[9%]" />
            <col className="w-[9%]" />
            <col className="w-[10%]" />
          </colgroup>

          {/* Sticky Header with Sorting Controls */}
          <thead className="sticky top-0 z-20 bg-[#fafafa] dark:bg-[#16161f] border-b border-black/[0.08] dark:border-white/[0.08] text-[11px] font-semibold text-[#6b6b6b] dark:text-[#a1a1aa] uppercase tracking-wider select-none shadow-2xs">
            <tr>
              <th scope="col" className="py-3 pl-4 pr-2">
                <button
                  type="button"
                  onClick={() => handleSort('name')}
                  className="group flex items-center gap-1.5 hover:text-black dark:hover:text-white cursor-pointer uppercase font-semibold"
                >
                  <span>Camera Node</span>
                  {renderSortIcon('name')}
                </button>
              </th>
              <th scope="col" className="py-3 px-2">
                <button
                  type="button"
                  onClick={() => handleSort('zone')}
                  className="group flex items-center gap-1.5 hover:text-black dark:hover:text-white cursor-pointer uppercase font-semibold"
                >
                  <span>Zone</span>
                  {renderSortIcon('zone')}
                </button>
              </th>
              <th scope="col" className="py-3 px-2">
                <button
                  type="button"
                  onClick={() => handleSort('rtspUrl')}
                  className="group flex items-center gap-1.5 hover:text-black dark:hover:text-white cursor-pointer uppercase font-semibold"
                >
                  <span>RTSP Stream Endpoint</span>
                  {renderSortIcon('rtspUrl')}
                </button>
              </th>
              <th scope="col" className="py-3 px-2">
                <button
                  type="button"
                  onClick={() => handleSort('status')}
                  className="group flex items-center gap-1.5 hover:text-black dark:hover:text-white cursor-pointer uppercase font-semibold"
                >
                  <span>Status</span>
                  {renderSortIcon('status')}
                </button>
              </th>
              <th scope="col" className="py-3 px-2">
                <button
                  type="button"
                  onClick={() => handleSort('lastChecked')}
                  className="group flex items-center gap-1.5 hover:text-black dark:hover:text-white cursor-pointer uppercase font-semibold"
                >
                  <span>Checked</span>
                  {renderSortIcon('lastChecked')}
                </button>
              </th>
              <th scope="col" className="py-3 px-2">
                <button
                  type="button"
                  onClick={() => handleSort('lastOnline')}
                  className="group flex items-center gap-1.5 hover:text-black dark:hover:text-white cursor-pointer uppercase font-semibold"
                >
                  <span>Online</span>
                  {renderSortIcon('lastOnline')}
                </button>
              </th>
              <th scope="col" className="py-3 pr-4 pl-2 text-right">
                Actions
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.05] text-[13px] text-[#0a0a0a] dark:text-white">
            {sortedCameras.map((camera) => {
              const isSelected = selectedCameraId === camera.id;
              const maskedUrl = maskRtspUrl(camera.rtspUrl);
              const isCopied = copiedId === camera.id;

              return (
                <tr
                  key={camera.id}
                  id={`camera-row-${camera.id}`}
                  onClick={() => {
                    soundService.playTactileBlip(750, 0.02);
                    onSelectCamera(camera);
                  }}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectCamera(camera);
                    }
                  }}
                  className={`group transition-all duration-150 cursor-pointer ${
                    isSelected
                      ? 'bg-orange-500/10 dark:bg-orange-500/15 ring-1 ring-inset ring-orange-500/40'
                      : 'hover:bg-black/[0.02] dark:hover:bg-[#181822]'
                  }`}
                  aria-label={`View live stream for ${camera.name}`}
                >
                  {/* 1. Camera Name & Code */}
                  <td className={`${rowPadding} pl-4 pr-2 align-middle overflow-hidden`}>
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center border transition-colors shrink-0 shadow-2xs ${
                          camera.status === 'ONLINE'
                            ? 'bg-[#17c964]/10 border-[#17c964]/30 text-[#0d7d3d] dark:text-[#22c55e]'
                            : camera.status === 'OFFLINE'
                            ? 'bg-[#ef4444]/10 border-[#ef4444]/30 text-[#b91c1c] dark:text-[#f87171]'
                            : 'bg-black/[0.04] dark:bg-white/[0.05] border-black/[0.08] dark:border-white/[0.1] text-[#6b6b6b] dark:text-[#a1a1aa]'
                        }`}
                      >
                        <Video className="w-3.5 h-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectCamera(camera);
                          }}
                          className="font-semibold text-[#0a0a0a] dark:text-white group-hover:text-orange-500 dark:group-hover:text-orange-400 tracking-tight block truncate text-left cursor-pointer w-full text-[12.5px] sm:text-[13px] transition-colors"
                          title={camera.name}
                        >
                          {highlightMatch(camera.name, searchQuery)}
                        </button>
                        <span
                          className="font-mono text-[10.5px] text-[#8c8c8c] dark:text-[#71717a] tracking-tight block truncate"
                          title={`${camera.code} • ${camera.ip}`}
                        >
                          {highlightMatch(camera.code, searchQuery)} • {highlightMatch(camera.ip, searchQuery)}
                        </span>
                      </div>
                    </div>
                  </td>

                  {/* 2. Zone */}
                  <td className={`${rowPadding} px-2 align-middle overflow-hidden`}>
                    <span
                      id={`zone-badge-${camera.id}`}
                      className="inline-block max-w-full px-2 py-0.5 text-[10.5px] font-mono font-semibold tracking-tight uppercase bg-[#f5f5f5] dark:bg-[#1a1a22] text-[#404040] dark:text-[#d4d4d8] border border-black/[0.06] dark:border-white/[0.08] rounded-md truncate shadow-2xs"
                      title={camera.zone}
                    >
                      {highlightMatch(camera.zone, searchQuery)}
                    </span>
                  </td>

                  {/* 3. RTSP URL */}
                  <td className={`${rowPadding} px-2 align-middle overflow-hidden`}>
                    <div className="flex items-center gap-1 w-full min-w-0">
                      <div
                        className="font-mono text-[11px] text-[#4a4a4a] dark:text-[#d4d4d8] bg-[#fafafa] dark:bg-[#181820] border border-black/[0.06] dark:border-white/[0.08] px-2 py-1 rounded-lg truncate flex-1 min-w-0 select-all cursor-text"
                        title={`Full Stream: ${maskedUrl} (Click copy to clipboard)`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {maskedUrl}
                      </div>

                      {/* Copy Button */}
                      <button
                        type="button"
                        id={`copy-rtsp-btn-${camera.id}`}
                        onClick={(e) => handleCopyRtsp(e, camera)}
                        className={`p-1.5 rounded-md hover:bg-black/[0.06] dark:hover:bg-white/[0.08] text-[#6b6b6b] dark:text-[#a1a1aa] hover:text-black dark:hover:text-white border border-transparent transition-all shrink-0 cursor-pointer ${
                          isCopied ? 'text-[#17c964] dark:text-[#22c55e]' : ''
                        }`}
                        title="Copy RTSP URL"
                        aria-label="Copy RTSP URL"
                      >
                        {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </td>

                  {/* 4. Status */}
                  <td className={`${rowPadding} px-2 align-middle overflow-hidden`}>
                    <div className="flex flex-col gap-1 items-start">
                      <CameraStatusBadge
                        status={camera.status}
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectCamera(camera);
                        }}
                      />
                      {camera.aiState && (
                        <div className="flex items-center gap-1 font-mono text-[9.5px]">
                          <span
                            className="text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-1 py-0.5 rounded flex items-center gap-0.5"
                            title={`AI Count: ${camera.aiState.peopleCount} People Detected`}
                          >
                            <Users className="w-2.5 h-2.5" />
                            {camera.aiState.peopleCount}
                          </span>
                          {camera.aiState.anomalies.length > 0 && (
                            <span
                              className="text-red-400 bg-red-500/10 border border-red-500/20 px-1 py-0.5 rounded flex items-center gap-0.5 animate-pulse font-bold"
                              title={`${camera.aiState.anomalies.length} Anomaly Alerts`}
                            >
                              <ShieldAlert className="w-2.5 h-2.5" />
                              {camera.aiState.anomalies.length}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </td>

                  {/* 5. Last Checked */}
                  <td className={`${rowPadding} px-2 align-middle overflow-hidden`}>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0"
                        title="Live automatic health check active"
                      />
                      <span
                        className="text-[#6b6b6b] dark:text-[#a1a1aa] text-[11.5px] font-medium tracking-tight block truncate whitespace-nowrap"
                        title={formatFullDateTime(camera.lastChecked)}
                      >
                        {formatRelativeTime(camera.lastChecked)}
                      </span>
                    </div>
                  </td>

                  {/* 6. Last Online */}
                  <td className={`${rowPadding} px-2 align-middle overflow-hidden`}>
                    <span
                      className={`text-[11.5px] font-medium tracking-tight block truncate whitespace-nowrap ${
                        camera.status === 'ONLINE'
                          ? 'text-[#0d7d3d] dark:text-[#22c55e] font-semibold'
                          : 'text-[#8c8c8c] dark:text-[#71717a]'
                      }`}
                      title={formatFullDateTime(camera.lastOnline)}
                    >
                      {formatRelativeTime(camera.lastOnline)}
                    </span>
                  </td>

                  {/* 7. Action */}
                  <td className={`${rowPadding} pr-4 pl-2 align-middle text-right overflow-hidden`}>
                    <div className="flex items-center justify-end gap-1 shrink-0">
                      {/* View Feed Button */}
                      <button
                        type="button"
                        id={`view-cam-btn-${camera.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          soundService.playTactileBlip(750, 0.02);
                          onSelectCamera(camera);
                        }}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold tracking-tight transition-all cursor-pointer shrink-0 ${
                          isSelected
                            ? 'bg-orange-500 text-black shadow-xs'
                            : 'bg-white dark:bg-[#181820] text-[#0a0a0a] dark:text-white border border-black/[0.12] dark:border-white/[0.12] hover:bg-black hover:text-white dark:hover:bg-orange-500 dark:hover:text-black dark:hover:border-orange-500 shadow-2xs'
                        }`}
                        title="Open Live Stream"
                      >
                        <Eye className="w-3 h-3" />
                        <span>View</span>
                      </button>

                      {/* Edit Button */}
                      <button
                        type="button"
                        id={`edit-cam-btn-${camera.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          soundService.playTactileBlip(650, 0.02);
                          onEditCamera(camera);
                        }}
                        className="p-1.5 text-[#6b6b6b] dark:text-[#a1a1aa] hover:text-black dark:hover:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.06] rounded-md transition-colors cursor-pointer shrink-0"
                        title="Edit Camera Details"
                        aria-label="Edit Camera"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>

                      {/* Delete Button */}
                      <button
                        type="button"
                        id={`delete-cam-btn-${camera.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          soundService.playTactileBlip(500, 0.03);
                          onDeleteCamera(camera);
                        }}
                        className="p-1.5 text-[#6b6b6b] dark:text-[#a1a1aa] hover:text-[#ef4444] hover:bg-[#ef4444]/10 rounded-md transition-colors cursor-pointer shrink-0"
                        title="Delete Camera"
                        aria-label="Delete Camera"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Table Footer info bar */}
      <div className="px-4 py-2.5 bg-[#fafafa] dark:bg-[#16161f] border-t border-black/[0.08] dark:border-white/[0.08] flex items-center justify-between text-[11.5px] text-[#6b6b6b] dark:text-[#a1a1aa] shrink-0 select-none">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span>Showing {cameras.length} active node interfaces</span>
        </div>
        <span className="font-mono text-[10.5px] text-[#8c8c8c] dark:text-[#71717a]">
          Click row or View to open live stream
        </span>
      </div>
    </div>
  );
};
