import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  ShieldAlert,
  AlertTriangle,
  Camera as CameraIcon,
  Calendar,
  Clock,
  Filter,
  Search,
  CheckCircle2,
  XCircle,
  Eye,
  RefreshCw,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Check,
  CalendarDays,
  Layers,
  SlidersHorizontal,
  Table as TableIcon,
  LayoutGrid,
  ArrowUpDown,
  FileSearch,
  Flame,
  Info,
  AlertOctagon,
  Sparkles,
  FolderOpen,
  Grid,
  Trash2,
  User,
  CameraOff,
  Download,
} from 'lucide-react';
import { AnomalyAlertEvent, Camera } from '../types';
import { anomalyService, AnomalyStats } from '../services/anomalyService';
import { soundService } from '../services/soundService';
import { cameraWebSocket } from '../services/cameraService';

interface AlertsPageProps {
  alerts: AnomalyAlertEvent[];
  cameras?: Camera[];
  onRefresh?: () => void;
  isLoading?: boolean;
  onStatusUpdate?: (id: string, newStatus: string) => void;
  onDeleteAlert?: (id: string) => void;
}

// ─── Formatters & Style Helpers ─────────────────────────────────────────────

const formatAnomalyLabel = (type: string) => {
  if (!type) return 'Unknown Violation';
  return type
    .replace(/^NO[_-]/i, 'No ')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

const getSeverity = (alert: AnomalyAlertEvent): 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO' => {
  if (alert.severity) {
    const s = alert.severity.toUpperCase();
    if (s === 'CRITICAL' || s === 'HIGH' || s === 'MEDIUM' || s === 'LOW' || s === 'INFO') return s;
  }
  const t = (alert.anomalyType || '').toUpperCase();
  if (t.includes('HARDHAT') || t.includes('HAZARD')) return 'CRITICAL';
  if (t.includes('MASK') || t.includes('VEST')) return 'HIGH';
  if (t.includes('PHONE')) return 'MEDIUM';
  if (t.includes('PERSON')) return 'LOW';
  return alert.eventCategory === 'VIOLATION' ? 'HIGH' : 'INFO';
};

const getSeverityTheme = (sev: string) => {
  switch (sev) {
    case 'CRITICAL':
      return {
        badge: 'bg-[#ef4444]/15 text-[#f87171] border-[#ef4444]/30',
        dot: 'bg-[#ef4444]',
        icon: AlertOctagon,
        text: 'text-[#f87171]',
      };
    case 'HIGH':
      return {
        badge: 'bg-[#f97316]/15 text-[#fb923c] border-[#f97316]/30',
        dot: 'bg-[#f97316]',
        icon: Flame,
        text: 'text-[#fb923c]',
      };
    case 'MEDIUM':
      return {
        badge: 'bg-[#f59e0b]/15 text-[#fbbf24] border-[#f59e0b]/30',
        dot: 'bg-[#f59e0b]',
        icon: AlertTriangle,
        text: 'text-[#fbbf24]',
      };
    case 'LOW':
      return {
        badge: 'bg-[#06b6d4]/15 text-[#22d3ee] border-[#06b6d4]/30',
        dot: 'bg-[#06b6d4]',
        icon: Info,
        text: 'text-[#22d3ee]',
      };
    default:
      return {
        badge: 'bg-[#10b981]/15 text-[#34d399] border-[#10b981]/30',
        dot: 'bg-[#10b981]',
        icon: CheckCircle2,
        text: 'text-[#34d399]',
      };
  }
};

const getStatusBadge = (status: string) => {
  const norm = (status || 'NEW').toUpperCase();
  switch (norm) {
    case 'RESOLVED':
      return {
        label: 'RESOLVED',
        style: 'bg-[#17c964]/15 text-[#17c964] border-[#17c964]/30',
        dot: 'bg-[#17c964]',
      };
    case 'REVIEWED':
      return {
        label: 'REVIEWED',
        style: 'bg-[#06b6d4]/15 text-[#06b6d4] border-[#06b6d4]/30',
        dot: 'bg-[#06b6d4]',
      };
    case 'NEW':
    case 'CONFIRMED':
    case 'ACTIVE':
    default:
      return {
        label: 'NEW',
        style: 'bg-[#f97316]/15 text-[#f97316] border-[#f97316]/30',
        dot: 'bg-[#f97316] animate-pulse',
      };
  }
};

const getLocalDateKey = (d: Date = new Date()): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getAdjacentDateKey = (currentDateKey: string, offsetDays: number): string => {
  if (!currentDateKey) currentDateKey = getLocalDateKey();
  const parts = currentDateKey.split('-');
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    const dateObj = new Date(y, m, d + offsetDays);
    return getLocalDateKey(dateObj);
  }
  const dateObj = new Date();
  dateObj.setDate(dateObj.getDate() + offsetDays);
  return getLocalDateKey(dateObj);
};

const parseDateKey = (iso?: string | null): string => {
  if (!iso) return '';
  const match = String(iso).match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return getLocalDateKey(d);
};

const getAlertDateKeys = (iso?: string | null): string[] => {
  if (!iso) return [];
  const keys = new Set<string>();
  const match = String(iso).match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (match) {
    keys.add(`${match[1]}-${match[2]}-${match[3]}`);
  }
  const d = new Date(iso);
  if (!Number.isNaN(d.getTime())) {
    const localY = d.getFullYear();
    const localM = String(d.getMonth() + 1).padStart(2, '0');
    const localD = String(d.getDate()).padStart(2, '0');
    keys.add(`${localY}-${localM}-${localD}`);

    const utcY = d.getUTCFullYear();
    const utcM = String(d.getUTCMonth() + 1).padStart(2, '0');
    const utcD = String(d.getUTCDate()).padStart(2, '0');
    keys.add(`${utcY}-${utcM}-${utcD}`);
  }
  return Array.from(keys);
};

const getSeverityRank = (alert: AnomalyAlertEvent): number => {
  const sev = getSeverity(alert);
  switch (sev) {
    case 'CRITICAL': return 4;
    case 'HIGH': return 3;
    case 'MEDIUM': return 2;
    case 'LOW': return 1;
    default: return 0;
  }
};

const formatRegisteredDate = (iso?: string | null): string => {
  if (!iso) return '--';
  const match = String(iso).match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (match) {
    const y = parseInt(match[1], 10);
    const m = parseInt(match[2], 10) - 1;
    const d = parseInt(match[3], 10);
    return new Date(y, m, d).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }); // e.g. "11 Sep 2026"
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }); // e.g. "11 Sep 2026"
};

const formatFullDate = (iso?: string | null): string => {
  if (!iso) return '--';
  const match = String(iso).match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (match) {
    const y = parseInt(match[1], 10);
    const m = parseInt(match[2], 10) - 1;
    const d = parseInt(match[3], 10);
    return new Date(y, m, d).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }); // e.g. "11 September 2026"
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }); // e.g. "11 September 2026"
};

export const parseIsoToUtc = (iso?: string | null): Date | null => {
  if (!iso) return null;
  let s = String(iso).trim();
  // If no timezone indicator is present, explicitly treat as UTC ISO
  if (!s.endsWith('Z') && !s.includes('+') && !s.match(/-\d{2}:\d{2}$/)) {
    s = s.replace(' ', 'T') + 'Z';
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

const formatRegisteredTime = (iso?: string | null, fallbackIst?: string | null): string => {
  if (fallbackIst) return fallbackIst;
  if (!iso) return '--:--:-- IST';
  const d = parseIsoToUtc(iso);
  if (!d) return iso;
  const timeStr = d.toLocaleTimeString('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
  return `${timeStr} IST`;
};

// ─── Evidence Thumbnail Component ───────────────────────────────────────────

const EvidenceThumbnail: React.FC<{
  alert: AnomalyAlertEvent;
  onClick: () => void;
  className?: string;
}> = ({ alert, onClick, className = '' }) => {
  const [loadError, setLoadError] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [useFallback, setUseFallback] = useState(false);

  // Primary: direct static URL /data/evidence/..., Secondary: /api/anomalies/{id}/evidence
  const primaryUrl = useMemo(() => {
    return anomalyService.getSnapshotUrl(alert.snapshotPath, alert.id);
  }, [alert.snapshotPath, alert.id]);

  const fallbackUrl = useMemo(() => {
    return alert.id ? anomalyService.getEvidenceUrl(alert.id) : '';
  }, [alert.id]);

  const activeUrl = useFallback && fallbackUrl ? fallbackUrl : primaryUrl;

  const handleImgError = () => {
    if (!useFallback && fallbackUrl && fallbackUrl !== primaryUrl) {
      setUseFallback(true);
    } else {
      setLoadError(true);
    }
  };

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`group relative cursor-pointer overflow-hidden rounded-lg border border-black/10 dark:border-white/10 bg-[#070b14] transition-all hover:border-[#f97316]/50 ${className}`}
      title="Click to inspect full evidence"
    >
      {!loadError && activeUrl ? (
        <>
          <img
            src={activeUrl}
            alt={`${alert.anomalyType} Evidence`}
            loading="lazy"
            onLoad={() => setIsLoaded(true)}
            onError={handleImgError}
            className={`h-full w-full object-cover transition-transform duration-300 group-hover:scale-105 ${
              isLoaded ? 'opacity-100' : 'opacity-0'
            }`}
          />
          {!isLoaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#070b14]/80">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#f97316] border-t-transparent" />
            </div>
          )}
        </>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-[#090e18] p-2 text-center text-slate-500 dark:text-slate-500">
          <ShieldAlert className="h-5 w-5 text-slate-600 dark:text-slate-600" />
          <span className="text-[9px] font-mono uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Evidence unavailable
          </span>
        </div>
      )}

      {/* Snapshot Verification Badge */}
      {alert.snapshotPath && (
        <div className="absolute top-1.5 left-1.5 z-10 flex items-center gap-1 rounded bg-black/80 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-emerald-400 backdrop-blur-sm border border-emerald-500/30">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          PHOTO EVIDENCE
        </div>
      )}

      {/* Hover Inspect Pill */}
      <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 backdrop-blur-[1px] transition-opacity group-hover:opacity-100">
        <span className="flex items-center gap-1 rounded-md bg-[#0a0a0a]/90 px-2 py-1 text-[10px] font-semibold text-white shadow-md border border-white/15">
          <Eye className="h-3 w-3 text-[#f97316]" /> View
        </span>
      </div>

      {/* Mini Confidence Chip */}
      {alert.confidence > 0 && (
        <div className="absolute bottom-1 right-1 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[9px] text-white/90 backdrop-blur-sm">
          {Math.round(alert.confidence * 100)}%
        </div>
      )}
    </div>
  );
};

// ─── Full Evidence Viewer Modal ─────────────────────────────────────────────

interface EvidenceViewerModalProps {
  alert: AnomalyAlertEvent | null;
  alertsList: AnomalyAlertEvent[];
  onClose: () => void;
  onStatusChange: (id: string, newStatus: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}

const EvidenceViewerModal: React.FC<EvidenceViewerModalProps> = ({
  alert,
  alertsList,
  onClose,
  onStatusChange,
  onDelete,
}) => {
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [imgError, setImgError] = useState<boolean>(false);
  const [imgLoading, setImgLoading] = useState<boolean>(true);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [useFallbackUrl, setUseFallbackUrl] = useState<boolean>(false);
  const [retryKey, setRetryKey] = useState<number>(0);

  // Find index in current filtered list for Next / Prev navigation
  const currentIndex = useMemo(() => {
    if (!alert) return -1;
    return alertsList.findIndex((a) => a.id === alert.id);
  }, [alert, alertsList]);

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < alertsList.length - 1;

  const currentAlert = alert || (currentIndex >= 0 ? alertsList[currentIndex] : null);

  const primaryUrl = useMemo(() => {
    if (!currentAlert) return '';
    return anomalyService.getSnapshotUrl(currentAlert.snapshotPath, currentAlert.id);
  }, [currentAlert, retryKey]);

  const fallbackUrl = useMemo(() => {
    if (!currentAlert?.id) return '';
    return anomalyService.getEvidenceUrl(currentAlert.id);
  }, [currentAlert, retryKey]);

  const evidenceUrl = useFallbackUrl && fallbackUrl ? fallbackUrl : primaryUrl;

  // Reset zoom & loading when alert changes
  useEffect(() => {
    setZoomLevel(1);
    setImgLoading(true);
    setImgError(false);
    setUseFallbackUrl(false);
  }, [currentAlert?.id]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft' && hasPrev) {
        // Navigate prev
        const prevAlert = alertsList[currentIndex - 1];
        if (prevAlert) {
          (window as any).__cameye_select_alert?.(prevAlert);
        }
      } else if (e.key === 'ArrowRight' && hasNext) {
        // Navigate next
        const nextAlert = alertsList[currentIndex + 1];
        if (nextAlert) {
          (window as any).__cameye_select_alert?.(nextAlert);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, hasPrev, hasNext, onClose, alertsList]);

  if (!currentAlert) return null;

  const severity = getSeverity(currentAlert);
  const sevTheme = getSeverityTheme(severity);
  const statusBadge = getStatusBadge(currentAlert.status);
  const SevIcon = sevTheme.icon;

  const handleStatusClick = async (newStatus: string) => {
    setIsUpdatingStatus(true);
    try {
      await onStatusChange(currentAlert.id, newStatus);
    } catch (err) {
      console.error('Failed to change status:', err);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleDeleteClick = async () => {
    if (!onDelete || !currentAlert?.id) return;
    if (!window.confirm('Permanently delete this incident and erase its stored evidence photo from disk?')) {
      return;
    }
    setIsDeleting(true);
    try {
      await onDelete(currentAlert.id);
      onClose();
    } catch (err) {
      console.error('Failed to delete incident:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 p-2 sm:p-4 backdrop-blur-md animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="relative flex h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-black/20 dark:border-white/15 bg-[#0a0c14] text-slate-100 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-white/10 bg-[#0e1422] px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#f97316]/40 bg-[#f97316]/10 text-[#f97316]">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
                  Evidence Inspector
                </h2>
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wide ${sevTheme.badge}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${sevTheme.dot}`} />
                  {severity}
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase ${statusBadge.style}`}
                >
                  {statusBadge.label}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono">
                Event ID: {currentAlert.id}
              </p>
            </div>
          </div>

          {/* Header Controls */}
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1 border-r border-white/10 pr-2">
              <button
                disabled={!hasPrev}
                onClick={() => {
                  if (hasPrev) (window as any).__cameye_select_alert?.(alertsList[currentIndex - 1]);
                }}
                className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
                title="Previous Incident (Left Arrow)"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Prev
              </button>
              <span className="px-1 text-[11px] font-mono text-slate-500">
                {currentIndex + 1} / {alertsList.length}
              </span>
              <button
                disabled={!hasNext}
                onClick={() => {
                  if (hasNext) (window as any).__cameye_select_alert?.(alertsList[currentIndex + 1]);
                }}
                className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
                title="Next Incident (Right Arrow)"
              >
                Next <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <button
              onClick={onClose}
              className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-slate-400 transition hover:bg-white/15 hover:text-white"
              title="Close (Esc)"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Modal Main Body */}
        <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
          {/* Evidence Image Viewer Container */}
          <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-[#05070d] p-3 sm:p-6">
            {/* Zoom / Presentation Toolbar */}
            <div className="absolute right-4 top-4 z-10 flex items-center gap-1 rounded-lg border border-white/15 bg-[#0a0e1a]/85 p-1 backdrop-blur-md">
              <button
                onClick={() => setZoomLevel((z) => Math.max(0.6, z - 0.2))}
                className="rounded p-1 text-slate-300 hover:bg-white/10 hover:text-white"
                title="Zoom Out"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <span className="px-1 font-mono text-[10px] text-slate-400">
                {Math.round(zoomLevel * 100)}%
              </span>
              <button
                onClick={() => setZoomLevel((z) => Math.min(3.0, z + 0.2))}
                className="rounded p-1 text-slate-300 hover:bg-white/10 hover:text-white"
                title="Zoom In"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
              <button
                onClick={() => setZoomLevel(1)}
                className="rounded p-1 text-slate-300 hover:bg-white/10 hover:text-white"
                title="Reset Fit to Screen"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Evidence Image or Loading / Error State */}
            <div className="flex h-full w-full items-center justify-center overflow-auto">
              {!imgError && evidenceUrl ? (
                <div
                  className="relative transition-transform duration-150 ease-out"
                  style={{ transform: `scale(${zoomLevel})` }}
                >
                  <img
                    key={evidenceUrl}
                    src={evidenceUrl}
                    alt={`${currentAlert.anomalyType} Captured Evidence`}
                    onLoad={() => setImgLoading(false)}
                    onError={() => {
                      if (!useFallbackUrl && fallbackUrl && fallbackUrl !== primaryUrl) {
                        setUseFallbackUrl(true);
                      } else {
                        setImgLoading(false);
                        setImgError(true);
                      }
                    }}
                    className={`max-h-[75vh] max-w-full rounded-lg object-contain shadow-2xl transition-opacity duration-300 ${
                      imgLoading ? 'opacity-0' : 'opacity-100'
                    }`}
                  />
                  {imgLoading && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#05070d]/90">
                      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#f97316] border-t-transparent" />
                      <span className="text-xs font-mono text-slate-400">
                        Loading high-resolution evidence...
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-3 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/10 text-red-400">
                    <AlertTriangle className="h-7 w-7" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-200">Unable to load evidence.</h3>
                    <p className="mt-1 text-xs text-slate-500 max-w-sm">
                      The snapshot frame may be in transit or was not captured for this specific event.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setImgError(false);
                      setImgLoading(true);
                      setRetryKey((k) => k + 1);
                    }}
                    className="mt-2 flex items-center gap-2 rounded-lg border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20"
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Retry
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right Detail Panel */}
          <div className="w-full border-t border-white/10 bg-[#0b101d] p-4 sm:p-6 lg:w-[360px] lg:border-l lg:border-t-0 flex flex-col justify-between overflow-y-auto">
            <div className="space-y-5">
              {/* Violation Heading */}
              <div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-[#f97316]">
                  Anomaly Classification & Identity
                </div>
                <h3 className="mt-1 text-xl font-bold text-white tracking-tight flex items-center gap-2">
                  <SevIcon className={`h-5 w-5 ${sevTheme.text}`} />
                  {currentAlert.employeeName && currentAlert.employeeName !== 'Unidentified person'
                    ? `${currentAlert.employeeName} has not worn ${formatAnomalyLabel(currentAlert.anomalyType).toLowerCase()}`
                    : currentAlert.alertMessage || formatAnomalyLabel(currentAlert.anomalyType)}
                </h3>
                <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-slate-400">
                    Category: {currentAlert.eventCategory || 'VIOLATION'}
                  </span>
                  {currentAlert.employeeName && currentAlert.employeeName !== 'Unidentified person' ? (
                    <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-orange-500/20 text-orange-400 border border-orange-500/30 flex items-center gap-1">
                      <User className="w-3 h-3" />
                      Staff: {currentAlert.employeeName}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[11px] font-mono text-slate-500 bg-white/5 border border-white/10">
                      Unidentified Person
                    </span>
                  )}
                </div>
              </div>

              {/* Primary Telemetry Grid */}
              <div className="rounded-xl border border-white/10 bg-[#080d18] p-3.5 space-y-3 text-xs">
                <div className="flex items-center justify-between border-b border-white/5 pb-2">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <CameraIcon className="h-3.5 w-3.5 text-[#f97316]" /> Camera
                  </span>
                  <span className="font-semibold text-white">
                    {currentAlert.cameraName || currentAlert.cameraId}
                  </span>
                </div>

                <div className="flex items-center justify-between border-b border-white/5 pb-2">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5 text-[#f97316]" /> Facility Zone
                  </span>
                  <span className="font-medium text-slate-200">
                    {currentAlert.zone || 'General Facility'}
                  </span>
                </div>

                <div className="flex items-center justify-between border-b border-white/5 pb-2">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-[#f97316]" /> Registered Date
                  </span>
                  <span className="font-mono text-slate-200">
                    {formatFullDate(currentAlert.confirmedAt || currentAlert.createdAt)}
                  </span>
                </div>

                <div className="flex items-center justify-between border-b border-white/5 pb-2">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-[#f97316]" /> Registered Time (IST)
                  </span>
                  <span className="font-mono font-bold text-amber-400">
                    {currentAlert.confirmedTimeIst || formatRegisteredTime(currentAlert.confirmedAt || currentAlert.createdAt)}
                  </span>
                </div>

                <div className="flex items-center justify-between border-b border-white/5 pb-2">
                  <span className="text-slate-400">AI Confidence</span>
                  <span className="font-mono font-bold text-[#17c964]">
                    {Math.round((currentAlert.confidence || 0) * 100)}%
                  </span>
                </div>

                <div className="flex items-center justify-between border-b border-white/5 pb-2">
                  <span className="text-slate-400">Severity</span>
                  <span className={`font-mono font-bold uppercase ${sevTheme.text}`}>
                    {severity}
                  </span>
                </div>

                {currentAlert.trackId !== undefined && currentAlert.trackId !== null && (
                  <div className="flex items-center justify-between border-b border-white/5 pb-2">
                    <span className="text-slate-400">Track ID</span>
                    <span className="font-mono text-slate-200">
                      #{currentAlert.trackId}
                    </span>
                  </div>
                )}

                {currentAlert.durationSeconds !== undefined && currentAlert.durationSeconds !== null && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Duration</span>
                    <span className="font-mono text-slate-200">
                      {currentAlert.durationSeconds.toFixed(1)}s
                    </span>
                  </div>
                )}

                {currentAlert.snapshotPath && (
                  <div className="flex flex-col gap-1 border-t border-white/5 pt-2">
                    <span className="text-[10px] text-slate-400 flex items-center gap-1 font-mono">
                      <CameraIcon className="h-3 w-3 text-[#f97316]" /> Evidence Storage Path
                    </span>
                    <span className="font-mono text-[10px] text-emerald-400 break-all bg-black/50 p-2 rounded-lg border border-white/5 select-all">
                      backend/{currentAlert.snapshotPath}
                    </span>
                  </div>
                )}
              </div>

              {/* Status Section */}
              <div className="rounded-xl border border-white/10 bg-[#080d18] p-3.5">
                <div className="text-[10px] font-mono uppercase tracking-widest text-slate-400 mb-2">
                  Investigation Status
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-300">Current state:</span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-mono font-bold uppercase ${statusBadge.style}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${statusBadge.dot}`} />
                    {statusBadge.label}
                  </span>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="mt-6 space-y-2 border-t border-white/10 pt-4">
              <div className="grid grid-cols-2 gap-2">
                <button
                  disabled={isUpdatingStatus || currentAlert.status === 'REVIEWED'}
                  onClick={() => handleStatusClick('REVIEWED')}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-[#06b6d4]/40 bg-[#06b6d4]/10 px-3 py-2 text-xs font-semibold text-[#06b6d4] transition hover:bg-[#06b6d4]/20 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  <Check className="h-3.5 w-3.5" />
                  Mark Reviewed
                </button>

                <button
                  disabled={isUpdatingStatus || currentAlert.status === 'RESOLVED'}
                  onClick={() => handleStatusClick('RESOLVED')}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-[#17c964]/40 bg-[#17c964]/10 px-3 py-2 text-xs font-semibold text-[#17c964] transition hover:bg-[#17c964]/20 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Resolve
                </button>
              </div>

              {/* Export Watermarked Evidence Photo Button */}
              <button
                onClick={() => {
                  soundService.playTactileBlip(800, 0.03);
                  anomalyService.downloadEvidencePhoto(currentAlert.id, currentAlert.anomalyType);
                }}
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-orange-500/40 bg-orange-500/15 hover:bg-orange-500/25 text-orange-400 py-2 text-xs font-bold transition shadow-xs cursor-pointer"
                title="Export high-resolution evidence photo with official CamEye® watermark overlay"
              >
                <Download className="h-4 w-4 text-orange-400" />
                <span>Export Photo (CamEye® Watermark)</span>
              </button>

              {onDelete && (
                <button
                  disabled={isDeleting}
                  onClick={handleDeleteClick}
                  className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-400 py-2 text-xs font-semibold transition cursor-pointer disabled:opacity-40"
                  title="Delete incident and permanently remove photo from database and storage"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>{isDeleting ? 'Deleting Evidence...' : 'Delete Incident & Erase Photo'}</span>
                </button>
              )}

              <button
                onClick={onClose}
                className="w-full rounded-xl border border-white/10 bg-white/5 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/10 hover:text-white cursor-pointer"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Individual Incident Evidence Photo Card Component ────────────────────────

interface IncidentEvidenceCardProps {
  alert: AnomalyAlertEvent;
  onInspect: () => void;
  onQuickResolve?: (e: React.MouseEvent) => void;
  onDelete?: (e: React.MouseEvent) => void;
  isResolving?: boolean;
}

const IncidentEvidenceCard: React.FC<IncidentEvidenceCardProps> = ({
  alert,
  onInspect,
  onQuickResolve,
  onDelete,
  isResolving = false,
}) => {
  const severity = getSeverity(alert);
  const sevTheme = getSeverityTheme(severity);
  const statusBadge = getStatusBadge(alert.status);
  const SevIcon = sevTheme.icon;

  const isRecent = useMemo(() => {
    const d = parseIsoToUtc(alert.confirmedAt || alert.createdAt);
    if (!d) return false;
    return Date.now() - d.getTime() < 10 * 60 * 1000;
  }, [alert.confirmedAt, alert.createdAt]);

  return (
    <div
      onClick={onInspect}
      className={`group relative flex flex-col justify-between overflow-hidden rounded-2xl border bg-white dark:bg-[#111116] border-black/[0.08] dark:border-white/[0.08] hover:border-orange-500/50 dark:hover:border-orange-500/50 shadow-xs hover:shadow-xl dark:hover:shadow-[0_8px_30px_rgba(0,0,0,0.8)] transition-all duration-200 cursor-pointer ${
        isRecent
          ? 'border-red-500/40 shadow-[0_0_12px_rgba(239,68,68,0.15)] ring-1 ring-red-500/20'
          : ''
      }`}
    >
      <div>
        {/* Visual Viewport Frame matching Camera cards */}
        <div className="relative aspect-video w-full overflow-hidden bg-black flex flex-col justify-between p-2.5 select-none">
          {/* Subtle CCTV scanline backdrop */}
          <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.4)_50%)] bg-[length:100%_4px] pointer-events-none z-10 opacity-60" />

          {/* Top Badges */}
          <div className="relative z-20 flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5">
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-black/85 text-white backdrop-blur-md border border-white/20 shadow-xs">
                {alert.cameraId}
              </span>
              {alert.trackId !== undefined && alert.trackId !== null && (
                <span className="px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 backdrop-blur-md">
                  #{alert.trackId}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {isRecent && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-red-600/90 text-white backdrop-blur-md flex items-center gap-1 shadow-xs animate-pulse">
                  JUST NOW
                </span>
              )}
              <span
                className={`px-2 py-0.5 rounded-full text-[9.5px] font-mono font-bold uppercase tracking-tight backdrop-blur-md flex items-center gap-1 shadow-xs ${sevTheme.badge}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${sevTheme.dot}`} />
                {severity}
              </span>
            </div>
          </div>

          {/* Evidence Photo / Visual representation */}
          <div className="absolute inset-0 z-0">
            <EvidenceThumbnail
              alert={alert}
              onClick={onInspect}
              className="h-full w-full object-cover"
            />
          </div>

          {/* Quick Action Overlay on Hover */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-30 flex flex-col items-center justify-center gap-2 pointer-events-auto">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                soundService.playTactileBlip(800, 0.03);
                onInspect();
              }}
              className="px-3.5 py-1.5 rounded-full bg-orange-500 hover:bg-orange-600 text-black font-semibold text-[11.5px] flex items-center gap-1.5 shadow-lg transform hover:scale-105 transition-all cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Inspect Proof</span>
            </button>
            <span className="text-[10px] font-mono text-zinc-300 drop-shadow">
              Click to open high-res evidence viewer
            </span>
          </div>

          {/* Bottom Bar Info on video viewport */}
          <div className="relative z-20 flex items-center justify-between text-[10.5px] font-mono text-zinc-300 pt-1">
            <span className="truncate text-[10px] tracking-tight flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              {alert.zone || 'General Facility'}
            </span>
            <span className="text-[10.5px] tracking-tight text-amber-400 font-bold drop-shadow">
              {alert.confirmedTimeIst || formatRegisteredTime(alert.confirmedAt || alert.createdAt)}
            </span>
          </div>
        </div>

        {/* Card Body Info */}
        <div className="p-3">
          <div className="flex items-start justify-between gap-1.5">
            <div className="min-w-0 flex-1">
              <h4 className="font-semibold text-[13px] text-[#0a0a0a] dark:text-white tracking-tight flex items-center gap-1.5">
                <SevIcon className={`w-3.5 h-3.5 shrink-0 ${sevTheme.text}`} />
                <span className="truncate">
                  {alert.employeeName && alert.employeeName !== 'Unidentified person'
                    ? `${alert.employeeName} has not worn ${formatAnomalyLabel(alert.anomalyType).toLowerCase()}`
                    : alert.alertMessage || formatAnomalyLabel(alert.anomalyType)}
                </span>
              </h4>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                {alert.employeeName && alert.employeeName !== 'Unidentified person' ? (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-orange-500/15 text-orange-500 dark:text-orange-400 border border-orange-500/30">
                    <User className="w-2.5 h-2.5" />
                    {alert.employeeName}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-mono text-slate-500 bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5">
                    Unidentified
                  </span>
                )}
                <span className="text-[11px] font-mono text-[#8c8c8c] dark:text-[#71717a] truncate">
                  {alert.cameraName || alert.cameraId}
                </span>
              </div>

              {/* Real-time confidence bar indicator */}
              <div className="mt-2 flex items-center gap-2">
                <div className="h-1.5 flex-1 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      alert.confidence >= 0.8
                        ? 'bg-emerald-500'
                        : alert.confidence >= 0.6
                        ? 'bg-amber-500'
                        : 'bg-red-500'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(10, Math.round((alert.confidence || 0) * 100)))}%` }}
                  />
                </div>
                <span className="text-[10px] font-mono font-bold text-zinc-400 shrink-0">
                  {Math.round((alert.confidence || 0) * 100)}% Conf
                </span>
              </div>
            </div>

            <span
              className={`px-2 py-0.5 rounded-full text-[9.5px] font-mono font-bold uppercase shrink-0 border ${statusBadge.style}`}
            >
              {statusBadge.label}
            </span>
          </div>
        </div>
      </div>

      {/* Card Body Footer with Actions */}
      <div className="px-3 py-2.5 flex items-center justify-between gap-2 border-t border-black/[0.04] dark:border-white/[0.06] bg-black/[0.01] dark:bg-white/[0.01]">
        <span className="text-[10px] font-mono text-[#8c8c8c] dark:text-[#71717a]">
          {formatRegisteredDate(alert.confirmedAt || alert.createdAt)}
        </span>

        <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          {(alert.status || 'NEW').toUpperCase() !== 'RESOLVED' && onQuickResolve && (
            <button
              disabled={isResolving}
              onClick={(e) => {
                soundService.playTactileBlip(880, 0.02);
                onQuickResolve(e);
              }}
              title="Mark Resolved"
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 transition cursor-pointer disabled:opacity-50"
            >
              <Check className="w-3 h-3" />
              <span>Resolve</span>
            </button>
          )}
          <button
            onClick={() => {
              soundService.playTactileBlip(750, 0.02);
              onInspect();
            }}
            className="p-1.5 text-[#6b6b6b] dark:text-[#a1a1aa] hover:text-black dark:hover:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.06] rounded-md transition-colors cursor-pointer"
            title="Inspect Incident Proof"
          >
            <Eye className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              soundService.playTactileBlip(820, 0.02);
              anomalyService.downloadEvidencePhoto(alert.id, alert.anomalyType);
            }}
            className="p-1.5 text-amber-500 hover:text-amber-400 hover:bg-amber-500/10 rounded-md transition-colors cursor-pointer"
            title="Export Evidence Photo with CamEye® Watermark"
          >
            <Download className="w-3.5 h-3.5" />
          </button>

          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                soundService.playTactileBlip(500, 0.03);
                onDelete(e);
              }}
              className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-500/10 rounded-md transition-colors cursor-pointer"
              title="Delete Incident & Erase Evidence Photo"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Pagination Number Generator Helper ────────────────────────────────────
const getPageNumbers = (current: number, total: number): (number | string)[] => {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  if (current <= 4) {
    return [1, 2, 3, 4, 5, '...', total];
  }
  if (current >= total - 3) {
    return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
  }
  return [1, '...', current - 1, current, current + 1, '...', total];
};

// ─── Main Alerts & Evidence Page Component ──────────────────────────────────

export const AlertsPage: React.FC<AlertsPageProps> = ({
  alerts = [],
  cameras = [],
  onRefresh,
  isLoading = false,
  onStatusUpdate,
  onDeleteAlert,
}) => {
  // Available evidence dates fetched from backend/data/evidence
  const [evidenceDates, setEvidenceDates] = useState<{ date: string; totalAlerts: number; evidencePhotos: number }[]>([]);
  const [loadingDates, setLoadingDates] = useState(false);

  // Real DB total count — not capped by pagination limit
  const [realTotalCount, setRealTotalCount] = useState<number | null>(null);

  // Real DB KPI stats — all counts from server with date/filter support
  const [dbStats, setDbStats] = useState<AnomalyStats | null>(null);

  // Locally deleted incident IDs for instant reactive feedback
  const [deletedAlertIds, setDeletedAlertIds] = useState<Set<string>>(new Set());

  // Today & Yesterday Local Date Keys
  const todayKey = useMemo(() => getLocalDateKey(new Date()), []);
  const yesterdayKey = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return getLocalDateKey(d);
  }, []);

  // Filters State - Default strictly to TODAY so only today's anomalies are shown by default
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const [selectedCamera, setSelectedCamera] = useState('ALL');
  const [selectedZone, setSelectedZone] = useState('ALL');
  const [selectedType, setSelectedType] = useState('ALL');
  const [selectedSeverity, setSelectedSeverity] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  const [selectedDate, setSelectedDate] = useState<string>(() => getLocalDateKey(new Date())); // YYYY-MM-DD (Defaults to Today)
  const [datePreset, setDatePreset] = useState<'ALL' | 'TODAY' | 'YESTERDAY' | 'CUSTOM'>('TODAY');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc' | 'severity' | 'confidence'>('desc');
  const [viewMode, setViewMode] = useState<'byCamera' | 'grid' | 'table'>('byCamera');
  const [evidenceOnly, setEvidenceOnly] = useState<boolean>(false); // default show all alerts

  // Evidence Inspector Modal State
  const [inspectAlert, setInspectAlert] = useState<AnomalyAlertEvent | null>(null);

  // Local alert status override cache & loading tracker
  const [localStatuses, setLocalStatuses] = useState<Record<string, string>>({});
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  // ── Proper Server-Side Pagination Data Layer ────────────────────────────────
  const [pageSize, setPageSize] = useState<number>(24);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalCount, setTotalCount] = useState<number>(0);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(totalCount / pageSize)), [totalCount, pageSize]);
  const [backendAlerts, setBackendAlerts] = useState<AnomalyAlertEvent[]>([]);
  const [liveSessionAlerts, setLiveSessionAlerts] = useState<AnomalyAlertEvent[]>([]);
  const [byCameraAlerts, setByCameraAlerts] = useState<AnomalyAlertEvent[]>([]);
  const [isFetchingBackend, setIsFetchingBackend] = useState(false);

  // Real-time live listener for incoming CCTV anomaly alerts across all cameras
  useEffect(() => {
    const unsub = cameraWebSocket.subscribe((event) => {
      if (event.type === 'CAMERA_ANOMALY_ALERT') {
        const raw = event.payload;
        if (!raw || !raw.id) return;
        const newAlert: AnomalyAlertEvent = {
          id: raw.id,
          cameraId: raw.cameraId || raw.camera_id || '',
          cameraName: raw.cameraName || raw.camera_name || raw.cameraId || raw.camera_id || '',
          zone: raw.zone || 'General Facility',
          eventCategory: raw.eventCategory || raw.event_category || 'VIOLATION',
          anomalyType: raw.anomalyType || raw.anomaly_type || 'ANOMALY',
          modelClassId: raw.modelClassId ?? raw.model_class_id,
          modelClassName: raw.modelClassName || raw.model_class_name,
          confidence: raw.confidence ?? 0.85,
          severity: raw.severity || ((raw.anomaly_type || '').includes('NO_') || (raw.anomaly_type || '').includes('HAZARD') ? 'CRITICAL' : 'HIGH'),
          trackId: raw.trackId ?? raw.track_id,
          employeeId: raw.employeeId || raw.employee_id || null,
          employeeName: raw.employeeName || raw.employee_name || null,
          alertMessage: raw.alertMessage || raw.alert_message || null,
          firstSeenAt: raw.firstSeenAt || raw.first_seen_at || new Date().toISOString(),
          confirmedAt: raw.confirmedAt || raw.confirmed_at || raw.timestamp || new Date().toISOString(),
          endedAt: raw.endedAt || raw.ended_at,
          durationSeconds: raw.durationSeconds ?? raw.duration_seconds,
          status: 'NEW',
          snapshotPath: raw.snapshotPath || raw.snapshot_path || null,
          createdAt: raw.createdAt || raw.created_at || new Date().toISOString(),
        };

        // Add to live session alerts (newest first)
        setLiveSessionAlerts((prev) => {
          if (prev.some((a) => a.id === newAlert.id)) return prev;
          return [newAlert, ...prev];
        });

        // Increment pagination counts
        setTotalCount((prev) => prev + 1);
        setRealTotalCount((prev) => prev + 1);

        // Increment stats live (including per-camera count)
        setDbStats((prev) => {
          if (!prev) return prev;
          const isCritical = newAlert.severity === 'CRITICAL';
          const camId = newAlert.cameraId;
          const prevCounts = prev.cameraCounts || {};
          return {
            ...prev,
            total: prev.total + 1,
            today: prev.today + 1,
            dateCount: prev.dateCount + 1,
            evidencePhotos: newAlert.snapshotPath ? prev.evidencePhotos + 1 : prev.evidencePhotos,
            critical: isCritical ? prev.critical + 1 : prev.critical,
            high: !isCritical ? prev.high + 1 : prev.high,
            highSeverity: prev.highSeverity + 1,
            unresolved: prev.unresolved + 1,
            cameraCounts: {
              ...prevCounts,
              [camId]: (prevCounts[camId] || 0) + 1,
            },
          };
        });
      }
    });
    return () => { unsub(); };
  }, []);

  /**
   * Fetches an exact page of alerts from backend with all active filters applied server-side.
   */
  const fetchBackendAlerts = useCallback(async (page: number = currentPage, currentSize: number = pageSize) => {
    setIsFetchingBackend(true);
    const offset = Math.max(0, (page - 1) * currentSize);
    try {
      const apiOrder: 'asc' | 'desc' = (sortOrder === 'asc') ? 'asc' : 'desc';
      const { items, total } = await anomalyService.getAnomaliesPaginated({
        date: selectedDate || undefined,
        cameraId: selectedCamera !== 'ALL' ? selectedCamera : undefined,
        zone: selectedZone !== 'ALL' ? selectedZone : undefined,
        anomalyType: selectedType !== 'ALL' ? selectedType : undefined,
        severity: selectedSeverity !== 'ALL' ? selectedSeverity : undefined,
        status: selectedStatus !== 'ALL' ? selectedStatus : undefined,
        evidenceOnly: evidenceOnly ? true : undefined,
        search: debouncedSearch.trim() || undefined,
        order: apiOrder,
        limit: currentSize,
        offset,
      });
      setBackendAlerts(items);
      setTotalCount(total);
      setCurrentPage(page);
    } catch (err) {
      console.error('Backend alert fetch failed:', err);
    } finally {
      setIsFetchingBackend(false);
    }
  }, [
    currentPage, pageSize, sortOrder, selectedDate,
    selectedCamera, selectedZone, selectedType, selectedSeverity,
    selectedStatus, evidenceOnly, debouncedSearch
  ]);

  // Fetch all KPI stats from backend
  const fetchStats = useCallback(async () => {
    try {
      const stats = await anomalyService.getStats({
        date: selectedDate || undefined,
        cameraId: selectedCamera !== 'ALL' ? selectedCamera : undefined,
        zone: selectedZone !== 'ALL' ? selectedZone : undefined,
        anomalyType: selectedType !== 'ALL' ? selectedType : undefined,
      });
      setDbStats(stats);
      setRealTotalCount(stats.total);
    } catch { /* ignore */ }
  }, [selectedDate, selectedCamera, selectedZone, selectedType]);

  // Fetch balanced recent alerts per camera for By Camera stream view
  const fetchByCameraAlerts = useCallback(async () => {
    try {
      const items = await anomalyService.getByCameraRecent({
        date: selectedDate || undefined,
        limitPerCamera: 6,
        evidenceOnly: evidenceOnly ? true : undefined,
      });
      setByCameraAlerts(items);
    } catch (err) {
      console.error('Failed to fetch by-camera alerts:', err);
    }
  }, [selectedDate, evidenceOnly]);

  // Reset to page 1 & re-fetch whenever any filter changes
  useEffect(() => {
    setCurrentPage(1);
    fetchBackendAlerts(1, pageSize);
    fetchStats();
    fetchByCameraAlerts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedDate, selectedCamera, selectedZone, selectedType,
    selectedSeverity, selectedStatus, evidenceOnly, debouncedSearch, sortOrder
  ]);

  // Fetch evidence dates from backend
  const fetchEvidenceDates = useCallback(async () => {
    setLoadingDates(true);
    try {
      const dates = await anomalyService.getEvidenceDates();
      setEvidenceDates(dates);
    } catch (err) {
      console.error('Failed to load evidence dates from backend:', err);
    } finally {
      setLoadingDates(false);
    }
  }, []);

  // Fetch real total count (unfiltered, all-time)
  const fetchRealTotal = useCallback(async () => {
    try {
      const total = await anomalyService.getTotal();
      setRealTotalCount(total);
    } catch { /* ignore */ }
  }, []);

  // Light polling — evidence dates every 60s, stats every 60s, backend refresh every 60s
  useEffect(() => {
    fetchEvidenceDates();
    fetchRealTotal();
    fetchStats();
    fetchByCameraAlerts();
    const interval = setInterval(() => {
      fetchEvidenceDates();
      fetchRealTotal();
      fetchStats();
      fetchByCameraAlerts();
      fetchBackendAlerts(currentPage, pageSize);
    }, 60_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchEvidenceDates, fetchRealTotal, fetchStats, fetchByCameraAlerts, currentPage, pageSize]);

  // Merged alerts — live WebSocket additions for current session + backend paged results
  const mergedAlerts = useMemo(() => {
    let list: AnomalyAlertEvent[] = [];

    if (currentPage === 1) {
      // On page 1: filter brand-new live session arrivals for active UI filters
      const liveFiltered = liveSessionAlerts.filter((a) => {
        if (selectedDate) {
          const keys = getAlertDateKeys(a.confirmedAt || a.createdAt);
          if (!keys.includes(selectedDate)) return false;
        }
        if (selectedCamera !== 'ALL' && a.cameraId !== selectedCamera) return false;
        if (selectedZone !== 'ALL' && a.zone !== selectedZone) return false;
        if (selectedType !== 'ALL' && a.anomalyType !== selectedType) return false;
        if (selectedSeverity !== 'ALL' && a.severity !== selectedSeverity) return false;
        if (selectedStatus !== 'ALL') {
          if (selectedStatus === 'UNRESOLVED' && a.status === 'RESOLVED') return false;
          if (selectedStatus === 'RESOLVED' && a.status !== 'RESOLVED') return false;
        }
        if (evidenceOnly && (!a.snapshotPath || !a.snapshotPath.trim())) return false;
        return true;
      });

      // Deduplicate live session alerts against backendAlerts
      const liveIds = new Set(liveFiltered.map((a) => a.id));
      const backendWithoutLive = backendAlerts.filter((a) => !liveIds.has(a.id));
      list = [...liveFiltered, ...backendWithoutLive];
    } else {
      // On Page 2, 3, etc.: strictly show the exact page from backend!
      list = [...backendAlerts];
    }

    return list
      .filter((raw: any) => !deletedAlertIds.has(raw?.id))
      .map((raw: any) => {
        const a: AnomalyAlertEvent = {
          ...raw,
          cameraId: raw.cameraId || raw.camera_id || '',
          cameraName: raw.cameraName || raw.camera_name || raw.cameraId || raw.camera_id || '',
          eventCategory: raw.eventCategory || raw.event_category || 'VIOLATION',
          anomalyType: raw.anomalyType || raw.anomaly_type || 'ANOMALY',
          trackId: raw.trackId ?? raw.track_id,
          employeeId: raw.employeeId || raw.employee_id || null,
          employeeName: raw.employeeName || raw.employee_name || null,
          alertMessage: raw.alertMessage || raw.alert_message || null,
          confirmedAt: raw.confirmedAt || raw.confirmed_at || raw.createdAt || raw.created_at || raw.timestamp,
          createdAt: raw.createdAt || raw.created_at || raw.confirmedAt || raw.confirmed_at || raw.timestamp,
          snapshotPath: raw.snapshotPath || raw.snapshot_path || null,
          status: localStatuses[raw.id] || raw.status || 'NEW',
        };
        return a;
      });
  }, [
    currentPage, liveSessionAlerts, backendAlerts, selectedDate, selectedCamera,
    selectedZone, selectedType, selectedSeverity, selectedStatus, evidenceOnly,
    localStatuses, deletedAlertIds
  ]);

  // Derived available dates combining backend discovery + in-memory alerts
  const availableDateOptions = useMemo(() => {
    const map = new Map<string, { date: string; totalAlerts: number; evidencePhotos: number }>();

    evidenceDates.forEach((ed) => {
      map.set(ed.date, { ...ed });
    });

    mergedAlerts.forEach((a) => {
      const dKey = parseDateKey(a.confirmedAt || a.createdAt);
      if (dKey) {
        if (!map.has(dKey)) {
          map.set(dKey, { date: dKey, totalAlerts: 0, evidencePhotos: 0 });
        }
        const item = map.get(dKey)!;
        item.totalAlerts += 1;
        if (a.snapshotPath && a.snapshotPath.trim()) {
          item.evidencePhotos += 1;
        }
      }
    });

    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [evidenceDates, mergedAlerts]);

  // Calendar dates that strictly contain real captured evidence photos, sorted newest calendar date first
  const datesWithPhotos = useMemo(() => {
    return availableDateOptions
      .filter((d) => d.evidencePhotos > 0)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [availableDateOptions]);

  // Immediate previous and next calendar dates that have photos (relative to current selectedDate)
  const adjacentPhotoDates = useMemo(() => {
    if (datesWithPhotos.length === 0) {
      return { prevDateWithPhotos: null, nextDateWithPhotos: null, latestDateWithPhotos: null };
    }
    const latest = datesWithPhotos[0].date;
    if (!selectedDate) {
      return { prevDateWithPhotos: latest, nextDateWithPhotos: null, latestDateWithPhotos: latest };
    }

    const earlierDates = datesWithPhotos.filter((d) => d.date < selectedDate);
    const laterDates = datesWithPhotos.filter((d) => d.date > selectedDate);

    return {
      prevDateWithPhotos: earlierDates.length > 0 ? earlierDates[0].date : null,
      nextDateWithPhotos: laterDates.length > 0 ? laterDates[laterDates.length - 1].date : null,
      latestDateWithPhotos: latest,
    };
  }, [selectedDate, datesWithPhotos]);

  // Connect global window helper for modal prev/next keyboard navigation
  useEffect(() => {
    (window as any).__cameye_select_alert = (alert: AnomalyAlertEvent) => {
      setInspectAlert(alert);
    };
    return () => {
      delete (window as any).__cameye_select_alert;
    };
  }, []);

  // Handle Date Preset Buttons
  const handleDatePreset = (preset: 'ALL' | 'TODAY' | 'YESTERDAY' | 'CUSTOM') => {
    setDatePreset(preset);
    if (preset === 'TODAY') {
      setSelectedDate(todayKey);
    } else if (preset === 'YESTERDAY') {
      setSelectedDate(yesterdayKey);
    } else if (preset === 'ALL') {
      setSelectedDate('');
    }
  };

  // Day Stepper Helpers
  const handlePrevDay = useCallback(() => {
    soundService.playTactileBlip(650, 0.02);
    const current = selectedDate || todayKey;
    const prev = getAdjacentDateKey(current, -1);
    setSelectedDate(prev);
    setDatePreset(prev === yesterdayKey ? 'YESTERDAY' : prev === todayKey ? 'TODAY' : 'CUSTOM');
  }, [selectedDate, todayKey, yesterdayKey]);

  const handleNextDay = useCallback(() => {
    if (!selectedDate || selectedDate >= todayKey) return;
    soundService.playTactileBlip(750, 0.02);
    const next = getAdjacentDateKey(selectedDate, 1);
    setSelectedDate(next);
    setDatePreset(next === todayKey ? 'TODAY' : next === yesterdayKey ? 'YESTERDAY' : 'CUSTOM');
  }, [selectedDate, todayKey, yesterdayKey]);

  // ─── Interactive Calendar Popover State & Helpers ───────────────────────────
  const [isCalendarOpen, setIsCalendarOpen] = useState<boolean>(false);
  const calendarRef = useRef<HTMLDivElement>(null);
  const [calendarViewDate, setCalendarViewDate] = useState<Date>(() => new Date());

  // Date -> Stats map for fast day badge & dot indicators
  const dateStatsMap = useMemo(() => {
    const map = new Map<string, { totalAlerts: number; evidencePhotos: number }>();
    availableDateOptions.forEach((opt) => {
      map.set(opt.date, { totalAlerts: opt.totalAlerts, evidencePhotos: opt.evidencePhotos });
    });
    return map;
  }, [availableDateOptions]);

  const selectedDateStats = useMemo(() => {
    if (!selectedDate) return null;
    return dateStatsMap.get(selectedDate) || null;
  }, [selectedDate, dateStatsMap]);

  // Sync calendar view month when selectedDate changes
  useEffect(() => {
    if (selectedDate) {
      const parts = selectedDate.split('-');
      if (parts.length === 3) {
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1;
        setCalendarViewDate(new Date(y, m, 1));
      }
    }
  }, [selectedDate]);

  // Click outside to close calendar popover
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (calendarRef.current && !calendarRef.current.contains(event.target as Node)) {
        setIsCalendarOpen(false);
      }
    };
    if (isCalendarOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isCalendarOpen]);

  // Escape key to dismiss calendar popover
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isCalendarOpen) {
        setIsCalendarOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCalendarOpen]);

  // Generate 35-42 calendar day cells for current view month
  const calendarGrid = useMemo(() => {
    const year = calendarViewDate.getFullYear();
    const month = calendarViewDate.getMonth();

    const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0 = Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();

    const cells: Array<{ day: number; isCurrentMonth: boolean; dateKey: string }> = [];

    // Leading days from previous month
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      const d = prevMonthDays - i;
      const prevDate = new Date(year, month - 1, d);
      const key = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({ day: d, isCurrentMonth: false, dateKey: key });
    }

    // Days in current month
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({ day: d, isCurrentMonth: true, dateKey: key });
    }

    // Trailing days to round to complete weeks (35 or 42)
    const targetLength = cells.length > 35 ? 42 : 35;
    const remaining = targetLength - cells.length;
    for (let d = 1; d <= remaining; d++) {
      const nextDate = new Date(year, month + 1, d);
      const key = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({ day: d, isCurrentMonth: false, dateKey: key });
    }

    return cells;
  }, [calendarViewDate]);

  const viewMonthLabel = useMemo(() => {
    return calendarViewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }, [calendarViewDate]);

  // Unique camera list for camera dropdown
  const cameraOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    cameras.forEach((c) => {
      map.set(c.id, { id: c.id, name: c.name || c.id });
    });
    alerts.forEach((a) => {
      if (a.cameraId && !map.has(a.cameraId)) {
        map.set(a.cameraId, { id: a.cameraId, name: a.cameraName || a.cameraId });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [cameras, alerts]);

  // Unique zones
  const zoneOptions = useMemo(() => {
    const zones = new Set<string>();
    alerts.forEach((a) => {
      if (a.zone) zones.add(a.zone);
    });
    cameras.forEach((c) => {
      if (c.zone) zones.add(c.zone);
    });
    return Array.from(zones).sort();
  }, [alerts, cameras]);

  // Unique anomaly types
  const anomalyTypeOptions = useMemo(() => {
    const types = new Set<string>();
    alerts.forEach((a) => {
      if (a.anomalyType) types.add(a.anomalyType);
    });
    ['NO_HARDHAT', 'NO_MASK', 'NO_SAFETY_VEST', 'PHONE_VIOLATION', 'PERSON_DETECTED', 'MACHINERY_HAZARD'].forEach((t) =>
      types.add(t)
    );
    return Array.from(types).sort();
  }, [alerts]);

  // Filtered alerts — backend already handles search, filters, pagination, and sort.
  // Client only applies session-level deletions and local status overrides.
  const filteredAlerts = useMemo(() => {
    return mergedAlerts.filter((alert) => {
      if (deletedAlertIds.has(alert.id)) return false;
      return true;
    });
  }, [mergedAlerts, deletedAlertIds]);

  // Total count of real captured snapshots sourced from DB stats
  const totalWithEvidenceCount = useMemo(() => {
    return dbStats?.evidencePhotos ?? totalCount;
  }, [dbStats, totalCount]);

  // Dedicated metrics specifically for the currently selected calendar date
  const selectedDateMetrics = useMemo(() => {
    return {
      hasDate: Boolean(selectedDate),
      totalEvents: dbStats?.dateCount ?? totalCount,
      totalPhotos: dbStats?.evidencePhotos ?? totalCount,
    };
  }, [selectedDate, dbStats, totalCount]);

  // Group alerts per camera for the "By Camera" card stream view
  const cameraGroups = useMemo(() => {
    const map = new Map<
      string,
      {
        cameraId: string;
        cameraName: string;
        zone: string;
        isOnline: boolean;
        totalViolations: number;
        alerts: AnomalyAlertEvent[];
      }
    >();

    // 1. Initialize all facility cameras matching active camera and zone filters
    const visibleCameras = selectedCamera !== 'ALL'
      ? cameras.filter((c) => c.id === selectedCamera)
      : cameras.filter((c) => selectedZone === 'ALL' || c.zone === selectedZone);

    visibleCameras.forEach((cam) => {
      const dbCount = dbStats?.cameraCounts?.[cam.id] ?? 0;
      map.set(cam.id, {
        cameraId: cam.id,
        cameraName: cam.name || cam.id,
        zone: cam.zone || 'General Facility',
        isOnline: cam.status === 'ONLINE',
        totalViolations: dbCount,
        alerts: [],
      });
    });

    // 2. Select alert source:
    // If viewing ALL cameras in By Camera mode, use balanced byCameraAlerts + live arrivals.
    // If viewing single camera filter, use filteredAlerts (full pagination).
    const isViewingAllInByCamera = selectedCamera === 'ALL';
    const baseSource = isViewingAllInByCamera ? byCameraAlerts : filteredAlerts;

    // Filter live session arrivals for active UI date/zone/type filters
    const liveForFilter = liveSessionAlerts.filter((a) => {
      if (deletedAlertIds.has(a.id)) return false;
      if (selectedDate) {
        const keys = getAlertDateKeys(a.confirmedAt || a.createdAt);
        if (!keys.includes(selectedDate)) return false;
      }
      if (selectedZone !== 'ALL' && a.zone !== selectedZone) return false;
      if (selectedType !== 'ALL' && a.anomalyType !== selectedType) return false;
      if (selectedSeverity !== 'ALL' && a.severity !== selectedSeverity) return false;
      if (evidenceOnly && (!a.snapshotPath || !a.snapshotPath.trim())) return false;
      return true;
    });

    const liveIds = new Set(liveForFilter.map((a) => a.id));
    const combined = [...liveForFilter, ...baseSource.filter((a) => !liveIds.has(a.id) && !deletedAlertIds.has(a.id))];

    combined.forEach((raw: any) => {
      const alert: AnomalyAlertEvent = {
        ...raw,
        cameraId: raw.cameraId || raw.camera_id || '',
        cameraName: raw.cameraName || raw.camera_name || raw.cameraId || raw.camera_id || '',
        eventCategory: raw.eventCategory || raw.event_category || 'VIOLATION',
        anomalyType: raw.anomalyType || raw.anomaly_type || 'ANOMALY',
        trackId: raw.trackId ?? raw.track_id,
        employeeId: raw.employeeId || raw.employee_id || null,
        employeeName: raw.employeeName || raw.employee_name || null,
        alertMessage: raw.alertMessage || raw.alert_message || null,
        confirmedAt: raw.confirmedAt || raw.confirmed_at || raw.createdAt || raw.created_at || raw.timestamp,
        createdAt: raw.createdAt || raw.created_at || raw.confirmedAt || raw.confirmed_at || raw.timestamp,
        snapshotPath: raw.snapshotPath || raw.snapshot_path || null,
        status: localStatuses[raw.id] || raw.status || 'NEW',
      };

      const camId = alert.cameraId;
      if (!map.has(camId)) {
        const camObj = cameras.find((c) => c.id === camId);
        const dbCount = dbStats?.cameraCounts?.[camId] ?? 0;
        map.set(camId, {
          cameraId: camId,
          cameraName: alert.cameraName || camObj?.name || camId,
          zone: alert.zone || camObj?.zone || 'General Facility',
          isOnline: camObj ? camObj.status === 'ONLINE' : true,
          totalViolations: dbCount,
          alerts: [],
        });
      }

      const targetGroup = map.get(camId)!;
      if (!isViewingAllInByCamera || targetGroup.alerts.length < 6) {
        targetGroup.alerts.push(alert);
      }
    });

    // 3. Sort: cameras with violations first (most violations in DB first), then natural sort by name
    return Array.from(map.values()).sort((a, b) => {
      const countA = a.totalViolations > 0 ? a.totalViolations : a.alerts.length;
      const countB = b.totalViolations > 0 ? b.totalViolations : b.alerts.length;
      if (countA > 0 && countB === 0) return -1;
      if (countA === 0 && countB > 0) return 1;
      if (countA !== countB) return countB - countA;
      return a.cameraName.localeCompare(b.cameraName, undefined, { numeric: true });
    });
  }, [
    filteredAlerts, byCameraAlerts, liveSessionAlerts, cameras, selectedCamera,
    selectedZone, selectedDate, selectedType, selectedSeverity, evidenceOnly,
    dbStats, deletedAlertIds, localStatuses
  ]);

  // Selected camera details for camera banner (if single camera filter applied)
  const selectedCameraMeta = useMemo(() => {
    if (selectedCamera === 'ALL') return null;
    const found = cameras.find((c) => c.id === selectedCamera);
    const cameraAlerts = mergedAlerts.filter((a) => a.cameraId === selectedCamera);
    return {
      id: selectedCamera,
      code: found?.code || selectedCamera,
      name: found?.name || selectedCamera,
      zone: found?.zone || cameraAlerts[0]?.zone || 'General Facility',
      isOnline: found ? found.status === 'ONLINE' : true,
      violationsCount: cameraAlerts.length,
    };
  }, [selectedCamera, cameras, mergedAlerts]);

  // Summary card counts — strictly sourced from database via getStats()
  const summary = useMemo(() => {
    const total = dbStats?.total ?? totalCount;
    const today = dbStats?.today ?? 0;
    const dateCount = dbStats?.dateCount ?? total;
    const evidencePhotos = dbStats?.evidencePhotos ?? total;
    const highSeverity = dbStats?.highSeverity ?? 0;
    const critical = dbStats?.critical ?? 0;
    const high = dbStats?.high ?? 0;
    const unresolved = dbStats?.unresolved ?? 0;
    const resolved = dbStats?.resolved ?? 0;
    return { total, today, dateCount, evidencePhotos, highSeverity, critical, high, unresolved, resolved };
  }, [dbStats, totalCount]);

  // Status Change Handler
  const handleStatusUpdate = async (id: string, newStatus: string) => {
    try {
      setResolvingId(id);
      await anomalyService.updateAnomalyStatus(id, newStatus);
      setLocalStatuses((prev) => ({ ...prev, [id]: newStatus }));
      setBackendAlerts((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status: newStatus } : a))
      );
      if (inspectAlert && inspectAlert.id === id) {
        setInspectAlert((prev) => (prev ? { ...prev, status: newStatus } : null));
      }
      fetchStats();
      onStatusUpdate?.(id, newStatus);
    } catch (e) {
      console.error('Failed to update anomaly status:', e);
    } finally {
      setResolvingId(null);
    }
  };

  // Incident & Evidence Deletion Handler (Purges DB record and physical photo from disk)
  const handleDeleteIncident = async (id: string) => {
    try {
      await anomalyService.deleteAnomaly(id);
      setDeletedAlertIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      setBackendAlerts((prev) => prev.filter((a) => a.id !== id));
      if (inspectAlert && inspectAlert.id === id) {
        setInspectAlert(null);
      }
      onDeleteAlert?.(id);
      fetchEvidenceDates();
      fetchStats();
      soundService.playTactileBlip(550, 0.04);
    } catch (e) {
      console.error('Failed to delete incident:', e);
      alert('Failed to delete incident: ' + (e instanceof Error ? e.message : String(e)));
      throw e;
    }
  };

  // Reset Filters
  const hasActiveFilters =
    selectedCamera !== 'ALL' ||
    selectedZone !== 'ALL' ||
    selectedType !== 'ALL' ||
    selectedSeverity !== 'ALL' ||
    selectedStatus !== 'ALL' ||
    selectedDate !== todayKey ||
    Boolean(searchQuery) ||
    evidenceOnly;

  const resetFilters = () => {
    setSelectedCamera('ALL');
    setSelectedZone('ALL');
    setSelectedType('ALL');
    setSelectedSeverity('ALL');
    setSelectedStatus('ALL');
    setSelectedDate(todayKey);
    setDatePreset('TODAY');
    setSearchQuery('');
    setEvidenceOnly(false);
  };

  return (
    <div className="w-full space-y-6">
      {/* ─── Top Header Section ────────────────────────────────────────── */}
      <section id="alerts-header-section" className="relative">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-4 border-b border-black/[0.08] dark:border-white/[0.08]">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`w-2 h-2 rounded-full ${
                  summary.unresolved > 0
                    ? 'bg-[#ef4444] animate-pulse shadow-[0_0_6px_rgba(239,68,68,0.8)]'
                    : 'bg-[#17c964] shadow-[0_0_6px_rgba(23,201,100,0.8)]'
                }`}
              />
              <span className="text-[11px] font-mono uppercase tracking-wider text-[#6b6b6b] dark:text-[#a1a1aa]">
                Anomaly Evidence Stream
              </span>
            </div>
            <h1
              id="alerts-main-title"
              className="text-[30px] sm:text-[38px] font-semibold text-[#0a0a0a] dark:text-[#fafafa] tracking-tightest leading-tight flex items-center gap-3 flex-wrap"
            >
              <span>Alerts & Evidence</span>
              {summary.unresolved > 0 ? (
                <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-500 border border-amber-500/30">
                  {summary.unresolved} Pending
                </span>
              ) : (
                <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-500 border border-emerald-500/30">
                  All Resolved ✓
                </span>
              )}
            </h1>
            <p className="text-[14px] sm:text-[15px] text-[#6b6b6b] dark:text-[#a1a1aa] mt-0.5 tracking-tight">
              Review detected violations and inspect captured evidence photos from backend storage.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="hidden sm:flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-mono font-medium text-emerald-600 dark:text-emerald-400 shadow-xs">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
              <span>LIVE AI MONITORING ACTIVE</span>
            </div>

            {onRefresh && (
              <button
                onClick={() => {
                  onRefresh();
                  fetchEvidenceDates();
                }}
                disabled={isLoading}
                className="flex items-center gap-1.5 rounded-xl border border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.05] px-3.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200 transition hover:bg-black/[0.06] dark:hover:bg-white/10 disabled:opacity-50 cursor-pointer"
                title="Refresh alerts and evidence"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ─── Top 4 Summary Cards ───────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {/* Card 1: Evidence Photos */}
        <div
          onClick={() => {
            soundService.playTactileBlip(750, 0.02);
            setEvidenceOnly((prev) => !prev);
          }}
          className={`group relative cursor-pointer overflow-hidden rounded-2xl border p-4 transition-all shadow-sm ${
            evidenceOnly
              ? 'border-[#f97316] bg-[#f97316]/10 dark:bg-[#f97316]/15 ring-1 ring-[#f97316]/40'
              : 'border-black/[0.08] dark:border-white/[0.08] bg-white dark:bg-[#0f0f12] hover:border-[#f97316]/50'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-slate-500 dark:text-slate-400">
              Evidence Photos
            </span>
            <div className="rounded-lg bg-[#f97316]/10 p-2 text-[#f97316]">
              <CameraIcon className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            {summary.evidencePhotos}
          </div>
          <p className="mt-1 text-[11px] font-mono text-[#f97316]">
            {realTotalCount !== null ? realTotalCount : summary.total} total events captured
          </p>
        </div>

        {/* Card 2: Today / Selected Date */}
        <div
          onClick={() => handleDatePreset(selectedDate === todayKey ? 'ALL' : 'TODAY')}
          className={`group relative cursor-pointer overflow-hidden rounded-2xl border p-4 transition-all shadow-sm ${
            datePreset === 'TODAY'
              ? 'border-[#06b6d4] bg-[#06b6d4]/10 dark:bg-[#06b6d4]/15 ring-1 ring-[#06b6d4]/40'
              : 'border-black/[0.08] dark:border-white/[0.08] bg-white dark:bg-[#0f0f12] hover:border-[#06b6d4]/50'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-slate-500 dark:text-slate-400">
              {selectedDate && selectedDate !== todayKey ? formatRegisteredDate(selectedDate) : 'Today'}
            </span>
            <div className="rounded-lg bg-[#06b6d4]/10 p-2 text-[#06b6d4]">
              <Calendar className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight text-[#06b6d4]">
            {selectedDate && selectedDate !== todayKey ? summary.dateCount : summary.today}
          </div>
          <p className="mt-1 text-[11px] font-mono text-slate-500 dark:text-slate-400">
            {selectedDate && selectedDate !== todayKey ? 'Violations on selected date' : 'Violations recorded today'}
          </p>
        </div>

        {/* Card 3: High Severity */}
        <div
          onClick={() => setSelectedSeverity((prev) => (prev === 'HIGH' ? 'ALL' : 'HIGH'))}
          className={`group relative cursor-pointer overflow-hidden rounded-2xl border p-4 transition-all shadow-sm ${
            selectedSeverity === 'HIGH'
              ? 'border-[#ef4444] bg-[#ef4444]/10 dark:bg-[#ef4444]/15 ring-1 ring-[#ef4444]/40'
              : 'border-black/[0.08] dark:border-white/[0.08] bg-white dark:bg-[#0f0f12] hover:border-[#ef4444]/50'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-slate-500 dark:text-slate-400">
              High Severity
            </span>
            <div className="rounded-lg bg-[#ef4444]/10 p-2 text-[#ef4444]">
              <AlertTriangle className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight text-[#ef4444]">
            {summary.highSeverity}
          </div>
          <p className="mt-1 text-[11px] font-mono text-slate-500 dark:text-slate-400">
            {summary.critical} Critical · {summary.high} High
          </p>
        </div>

        {/* Card 4: Unresolved */}
        <div
          onClick={() => {
            soundService.playTactileBlip(750, 0.02);
            setSelectedStatus((prev) => (prev === 'UNRESOLVED' ? 'ALL' : 'UNRESOLVED'));
          }}
          className={`group relative cursor-pointer overflow-hidden rounded-2xl border p-4 transition-all shadow-sm ${
            selectedStatus === 'UNRESOLVED'
              ? 'border-[#f59e0b] bg-[#f59e0b]/10 dark:bg-[#f59e0b]/15 ring-1 ring-[#f59e0b]/40'
              : 'border-black/[0.08] dark:border-white/[0.08] bg-white dark:bg-[#0f0f12] hover:border-[#f59e0b]/50'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-slate-500 dark:text-slate-400">
              Unresolved
            </span>
            <div className="rounded-lg bg-[#f59e0b]/10 p-2 text-[#f59e0b]">
              <Clock className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight text-[#f59e0b]">
            {summary.unresolved}
          </div>
          <p className="mt-1 text-[11px] font-mono text-slate-500 dark:text-slate-400">
            {selectedStatus === 'UNRESOLVED' ? 'Filtering active (Click to clear)' : 'Pending operator action'}
          </p>
        </div>
      </section>

      {/* ─── Camera Filter Active HUD Banner ─────────────────────────── */}
      {selectedCameraMeta && (
        <div className="relative overflow-hidden rounded-2xl border border-orange-500/30 bg-[#090b10] p-4 text-slate-100 shadow-xl">
          {/* Subtle Cyber Grid & Scanline Background */}
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:16px_16px] opacity-40" />
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,transparent_50%,rgba(0,0,0,0.4)_51%)] bg-[length:100%_4px] opacity-25" />

          <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            {/* Left: Camera Identification & Telemetry */}
            <div className="flex items-center gap-3.5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-orange-500/30 bg-orange-500/10 text-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.15)]">
                <CameraIcon className="h-5 w-5" />
              </div>

              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[11px] font-bold text-orange-500 tracking-wider">
                    {selectedCameraMeta.code}
                  </span>
                  <span className="text-slate-600 dark:text-slate-500 text-xs">/</span>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
                    {selectedCameraMeta.name}
                  </h3>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-mono font-bold uppercase ${
                      selectedCameraMeta.isOnline
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
                        : 'border-red-500/30 bg-red-500/10 text-red-500'
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        selectedCameraMeta.isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'
                      }`}
                    />
                    {selectedCameraMeta.isOnline ? 'LIVE FEED ACTIVE' : 'OFFLINE'}
                  </span>
                </div>

                <div className="flex items-center gap-3 mt-1 text-xs text-slate-400 font-mono">
                  <span className="flex items-center gap-1.5 text-slate-300">
                    <Layers className="h-3 w-3 text-orange-500" />
                    <span>Zone: <strong className="text-slate-100">{selectedCameraMeta.zone}</strong></span>
                  </span>
                  <span>•</span>
                  <span>Filtered Channel View</span>
                </div>
              </div>
            </div>

            {/* Right: Violation Stats & Dismiss Filter */}
            <div className="flex items-center gap-3 self-end sm:self-auto">
              <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/40 px-3.5 py-2">
                <div className="text-right">
                  <div className="text-[9px] font-mono uppercase tracking-widest text-slate-400">
                    Evidence Records
                  </div>
                  <div className="text-lg font-bold font-mono text-orange-500 leading-tight">
                    {selectedCameraMeta.violationsCount}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  soundService.playTactileBlip(600, 0.02);
                  setSelectedCamera('ALL');
                }}
                className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white transition cursor-pointer"
                title="Clear camera filter (Show all cameras)"
              >
                <X className="h-3.5 w-3.5" />
                <span>Show All</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Comprehensive Filters & Toolbar (Consolidated Single Box) ───── */}
      <section className="space-y-3 rounded-2xl border border-black/[0.08] dark:border-white/[0.08] bg-white dark:bg-[#0f0f12] p-4 shadow-sm">
        {/* Row 1: Search + Date Selector Presets + Date Picker + View Modes + Sort */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          {/* Debounced Search */}
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search camera, anomaly type, zone, track ID..."
              className="w-full rounded-xl border border-black/10 dark:border-white/10 bg-slate-50 dark:bg-[#090b10] py-2 pl-10 pr-4 text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-500 focus:border-[#f97316] focus:outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Day Stepper & Interactive Calendar Component */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Previous Day Stepper (<) */}
            <button
              type="button"
              onClick={handlePrevDay}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-black/10 dark:border-white/10 bg-slate-50 dark:bg-[#090b10] text-slate-700 dark:text-slate-300 hover:border-orange-500/40 hover:bg-orange-500/10 hover:text-orange-500 dark:hover:text-orange-400 transition cursor-pointer shadow-xs"
              title="Previous Day (Navigate earlier date)"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            <div className="relative" ref={calendarRef}>
              <button
                type="button"
                onClick={() => {
                  soundService.playTactileBlip(750, 0.02);
                  setIsCalendarOpen((prev) => !prev);
                }}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition cursor-pointer shadow-xs ${
                  selectedDate
                    ? 'border-orange-500/60 bg-orange-500/10 text-orange-500 dark:text-orange-400 ring-1 ring-orange-500/30'
                    : 'border-black/10 dark:border-white/10 bg-slate-50 dark:bg-[#090b10] text-slate-700 dark:text-slate-300 hover:border-orange-500/40 dark:hover:border-white/20'
                }`}
                title="Open Incident Calendar"
              >
                <CalendarDays className={`h-4 w-4 shrink-0 ${selectedDate ? 'text-orange-500' : 'text-slate-400'}`} />
                <span className="tracking-tight select-none font-medium">
                  {selectedDate === todayKey
                    ? `Today, ${formatRegisteredDate(selectedDate)}`
                    : selectedDate === yesterdayKey
                    ? `Yesterday, ${formatRegisteredDate(selectedDate)}`
                    : selectedDate
                    ? formatRegisteredDate(selectedDate)
                    : 'All Dates (History)'}
                </span>

                {/* Day Incident Count Badge */}
                {selectedDate && (
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono text-[9.5px] font-bold border ${
                      selectedDateMetrics.totalPhotos > 0
                        ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                        : selectedDateMetrics.totalEvents > 0
                        ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30'
                        : 'bg-black/5 dark:bg-white/10 text-slate-500 dark:text-slate-400 border-black/10 dark:border-white/10'
                    }`}
                  >
                    {selectedDateMetrics.totalPhotos > 0
                      ? `${selectedDateMetrics.totalPhotos} photos`
                      : '0 photos'}
                  </span>
                )}

                {/* Clear Button or Dropdown Chevron */}
                {selectedDate ? (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      soundService.playTactileBlip(600, 0.02);
                      setSelectedDate('');
                      setDatePreset('ALL');
                      setIsCalendarOpen(false);
                    }}
                    title="Clear date filter"
                    className="ml-0.5 p-0.5 text-slate-400 hover:text-red-500 transition rounded cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </span>
                ) : (
                  <ChevronDown
                    className={`h-3.5 w-3.5 text-slate-400 transition-transform duration-200 ${
                      isCalendarOpen ? 'rotate-180 text-orange-500' : ''
                    }`}
                  />
                )}
              </button>

              {/* Custom Awesome Calendar Dropdown Popover */}
              {isCalendarOpen && (
                <div
                  className="absolute right-0 sm:left-0 top-full mt-2 z-50 w-[310px] sm:w-[340px] overflow-hidden rounded-2xl border border-orange-500/30 bg-[#090b10] p-4 text-slate-100 shadow-[0_20px_50px_rgba(0,0,0,0.85)] backdrop-blur-xl animate-fadeIn"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Micro Scanline & Grid Background */}
                  <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#ffffff04_1px,transparent_1px),linear-gradient(to_bottom,#ffffff04_1px,transparent_1px)] bg-[size:12px_12px] opacity-30" />
                  <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,transparent_50%,rgba(0,0,0,0.35)_51%)] bg-[length:100%_4px] opacity-20" />

                  <div className="relative z-10">
                    {/* Popover Header: Month Navigation */}
                    <div className="flex items-center justify-between pb-3 border-b border-white/10">
                      <button
                        type="button"
                        onClick={() => {
                          soundService.playTactileBlip(650, 0.02);
                          setCalendarViewDate(
                            (prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1)
                          );
                        }}
                        className="p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition cursor-pointer"
                        title="Previous month"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>

                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-white tracking-tight">
                          {viewMonthLabel}
                        </span>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            soundService.playTactileBlip(800, 0.02);
                            const now = new Date();
                            setCalendarViewDate(new Date(now.getFullYear(), now.getMonth(), 1));
                            setSelectedDate(todayKey);
                            setDatePreset('TODAY');
                            setIsCalendarOpen(false);
                          }}
                          className="px-2 py-1 text-[10px] font-mono font-bold uppercase rounded-md border border-orange-500/30 bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 transition cursor-pointer"
                          title="Jump to today"
                        >
                          Today
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            soundService.playTactileBlip(650, 0.02);
                            setCalendarViewDate(
                              (prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1)
                            );
                          }}
                          className="p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition cursor-pointer"
                          title="Next month"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {/* Day of Week Headers */}
                    <div className="grid grid-cols-7 gap-1 pt-3 pb-1 text-center font-mono text-[10.5px] font-bold text-slate-500 uppercase tracking-wider">
                      <span>Su</span>
                      <span>Mo</span>
                      <span>Tu</span>
                      <span>We</span>
                      <span>Th</span>
                      <span>Fr</span>
                      <span>Sa</span>
                    </div>

                    {/* Days Grid */}
                    <div className="grid grid-cols-7 gap-1 py-1">
                      {calendarGrid.map(({ day, isCurrentMonth, dateKey }) => {
                        const isSelected = selectedDate === dateKey;
                        const isToday = dateKey === todayKey;
                        const stats = dateStatsMap.get(dateKey);
                        const hasIncidents = Boolean(stats && stats.totalAlerts > 0);
                        const photoCount = stats?.evidencePhotos || 0;

                        return (
                          <button
                            key={dateKey}
                            type="button"
                            onClick={() => {
                              soundService.playTactileBlip(820, 0.03);
                              setSelectedDate(dateKey);
                              setDatePreset('CUSTOM');
                              setIsCalendarOpen(false);
                            }}
                            title={
                              hasIncidents
                                ? `${formatRegisteredDate(dateKey)}: ${stats!.totalAlerts} incident(s), ${photoCount} evidence photo(s)`
                                : formatRegisteredDate(dateKey)
                            }
                            className={`group relative flex flex-col items-center justify-center h-8.5 rounded-xl text-xs font-mono transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-gradient-to-br from-orange-500 to-amber-500 text-black font-bold shadow-[0_0_12px_rgba(249,115,22,0.6)] z-10'
                                : isToday
                                ? 'border border-orange-500/60 text-orange-400 bg-orange-500/10 font-bold'
                                : !isCurrentMonth
                                ? 'text-slate-600 opacity-30 hover:opacity-70 hover:bg-white/5'
                                : hasIncidents
                                ? 'text-white bg-white/[0.05] hover:bg-orange-500/20 font-semibold border border-orange-500/25'
                                : 'text-slate-400 hover:text-white hover:bg-white/5'
                            }`}
                          >
                            <span className="text-[11.5px]">{day}</span>

                            {/* Incident indicator beacon */}
                            {hasIncidents && !isSelected && (
                              <span
                                className={`absolute bottom-1 h-1.5 w-1.5 rounded-full ${
                                  photoCount > 0
                                    ? 'bg-orange-400 shadow-[0_0_6px_rgba(249,115,22,0.8)] animate-pulse'
                                    : 'bg-cyan-400'
                                }`}
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {/* Quick Incident Dates Selector */}
                    {availableDateOptions.length > 0 && (
                      <div className="mt-2.5 pt-2.5 border-t border-white/10">
                        <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mb-1.5">
                          <span className="flex items-center gap-1 font-semibold text-slate-300">
                            <Sparkles className="h-3 w-3 text-orange-400" />
                            Incident Dates in System
                          </span>
                          <span className="text-[9px] text-slate-400 font-mono">
                            {availableDateOptions.length} active
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                          {availableDateOptions.map((opt) => {
                            const isOptSelected = selectedDate === opt.date;
                            return (
                              <button
                                key={opt.date}
                                type="button"
                                onClick={() => {
                                  soundService.playTactileBlip(800, 0.02);
                                  setSelectedDate(opt.date);
                                  setDatePreset('CUSTOM');
                                  setIsCalendarOpen(false);
                                }}
                                className={`px-2 py-1 rounded-lg text-[10.5px] font-mono flex items-center gap-1.5 transition cursor-pointer ${
                                  isOptSelected
                                    ? 'bg-orange-500 text-black font-bold shadow-xs'
                                    : 'bg-white/5 hover:bg-orange-500/15 text-slate-300 hover:text-white border border-white/10'
                                }`}
                              >
                                <span className="h-1.5 w-1.5 rounded-full bg-orange-400" />
                                <span>{formatRegisteredDate(opt.date)}</span>
                                <span
                                  className={`rounded px-1.5 py-0.2 text-[9px] font-bold font-mono border ${
                                    opt.evidencePhotos > 0
                                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                                      : 'bg-black/40 text-slate-400 border-white/5'
                                  }`}
                                >
                                  {opt.evidencePhotos > 0 ? `${opt.evidencePhotos} photos` : '0 photos'}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Popover Footer */}
                    <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => {
                          soundService.playTactileBlip(600, 0.02);
                          setSelectedDate('');
                          setDatePreset('ALL');
                          setIsCalendarOpen(false);
                        }}
                        className="text-xs font-semibold text-slate-400 hover:text-red-400 transition cursor-pointer flex items-center gap-1"
                      >
                        <X className="h-3 w-3" />
                        <span>Show All Dates</span>
                      </button>
                      <span className="text-[10px] font-mono text-slate-400">
                        {mergedAlerts.length} total events
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Next Day Stepper (>) */}
            <button
              type="button"
              disabled={Boolean(!selectedDate || selectedDate >= todayKey)}
              onClick={handleNextDay}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-black/10 dark:border-white/10 bg-slate-50 dark:bg-[#090b10] text-slate-700 dark:text-slate-300 hover:border-orange-500/40 hover:bg-orange-500/10 hover:text-orange-500 dark:hover:text-orange-400 transition cursor-pointer shadow-xs disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-black/10 dark:disabled:hover:border-white/10 dark:disabled:hover:bg-[#090b10] dark:disabled:hover:text-slate-300"
              title={selectedDate && selectedDate >= todayKey ? 'Current day (Cannot navigate to future)' : 'Next Day'}
            >
              <ChevronRight className="h-4 w-4" />
            </button>

            {/* Quick Hop to Nearest Previous Date with Stored Photos */}
            {selectedDateMetrics.totalPhotos === 0 && adjacentPhotoDates.prevDateWithPhotos && (
              <button
                type="button"
                onClick={() => {
                  soundService.playTactileBlip(800, 0.02);
                  setSelectedDate(adjacentPhotoDates.prevDateWithPhotos!);
                  setDatePreset('CUSTOM');
                }}
                className="hidden sm:flex items-center gap-1.5 rounded-xl border border-orange-500/40 bg-orange-500/10 hover:bg-orange-500/20 px-2.5 py-2 text-xs font-semibold text-orange-500 dark:text-orange-400 transition cursor-pointer shadow-xs"
                title={`Hop to earlier date with photos: ${formatRegisteredDate(adjacentPhotoDates.prevDateWithPhotos)}`}
              >
                <CameraIcon className="h-3.5 w-3.5 text-orange-400" />
                <span>Jump to {formatRegisteredDate(adjacentPhotoDates.prevDateWithPhotos)}</span>
              </button>
            )}

            {/* Quick Today Button */}
            <button
              type="button"
              onClick={() => {
                soundService.playTactileBlip(750, 0.02);
                setSelectedDate(todayKey);
                setDatePreset('TODAY');
              }}
              className={`rounded-xl border px-3 py-2 text-xs font-semibold transition cursor-pointer shadow-xs ${
                selectedDate === todayKey
                  ? 'border-[#f97316] bg-[#f97316] text-white font-bold'
                  : 'border-black/10 dark:border-white/10 bg-slate-50 dark:bg-[#090b10] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Today
            </button>

            {/* All Dates History Toggle */}
            <button
              type="button"
              onClick={() => {
                soundService.playTactileBlip(700, 0.02);
                if (selectedDate === '') {
                  setSelectedDate(todayKey);
                  setDatePreset('TODAY');
                } else {
                  setSelectedDate('');
                  setDatePreset('ALL');
                }
              }}
              className={`rounded-xl border px-3 py-2 text-xs font-semibold transition cursor-pointer shadow-xs ${
                selectedDate === ''
                  ? 'border-amber-500/50 bg-amber-500/15 text-amber-500 dark:text-amber-400 font-bold ring-1 ring-amber-500/30'
                  : 'border-black/10 dark:border-white/10 bg-slate-50 dark:bg-[#090b10] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
              title="Show all recorded history across all dates"
            >
              All Dates
            </button>
          </div>

          {/* Right Toolbar: View Modes + Sort */}
          <div className="flex flex-wrap items-center gap-2">
            {/* View Mode Switcher: By Camera (Default) / All Cards / Table */}
            <div className="flex items-center rounded-xl border border-black/10 dark:border-white/10 bg-slate-100 dark:bg-[#090b10] p-0.5">
              <button
                onClick={() => {
                  soundService.playTactileBlip(700, 0.02);
                  setViewMode('byCamera');
                }}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                  viewMode === 'byCamera'
                    ? 'bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
                title="Grouped Cards Per Camera"
              >
                <Grid className="h-3.5 w-3.5 text-[#f97316]" />
                <span className="hidden sm:inline">Per-Camera</span>
              </button>

              <button
                onClick={() => {
                  soundService.playTactileBlip(700, 0.02);
                  setViewMode('grid');
                }}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                  viewMode === 'grid'
                    ? 'bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
                title="All Evidence Cards Grid"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">All Cards</span>
              </button>

              <button
                onClick={() => {
                  soundService.playTactileBlip(700, 0.02);
                  setViewMode('table');
                }}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                  viewMode === 'table'
                    ? 'bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
                title="Telemetry Data Table"
              >
                <TableIcon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Table</span>
              </button>
            </div>

            {/* Comprehensive Sort Dropdown */}
            <div className="relative">
              <select
                value={sortOrder}
                onChange={(e) => {
                  soundService.playTactileBlip(600, 0.02);
                  setSortOrder(e.target.value as any);
                }}
                className="appearance-none text-xs font-semibold tracking-tight bg-slate-50 dark:bg-[#090b10] text-slate-800 dark:text-slate-200 border border-black/10 dark:border-white/10 rounded-xl pl-3 pr-8 py-2 hover:border-orange-500/50 focus:outline-none focus:border-orange-500 cursor-pointer"
              >
                <option value="desc">Newest First</option>
                <option value="asc">Oldest First</option>
                <option value="severity">Highest Severity</option>
                <option value="confidence">Highest Confidence</option>
              </select>
              <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">
                ▼
              </div>
            </div>
          </div>
        </div>

        {/* Row 2: Secondary Dropdown Filters */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-black/[0.06] dark:border-white/[0.06]">
          {/* Camera Filter */}
          <div className="flex items-center gap-1.5 rounded-xl border border-black/10 dark:border-white/10 bg-slate-50 dark:bg-[#090b10] px-2.5 py-1.5 text-xs text-slate-600 dark:text-slate-300">
            <CameraIcon className="h-3.5 w-3.5 text-[#f97316]" />
            <select
              value={selectedCamera}
              onChange={(e) => setSelectedCamera(e.target.value)}
              className="bg-transparent text-xs text-slate-800 dark:text-slate-200 outline-none [color-scheme:dark]"
            >
              <option value="ALL">All Cameras</option>
              {cameraOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Zone Filter */}
          <div className="flex items-center gap-1.5 rounded-xl border border-black/10 dark:border-white/10 bg-slate-50 dark:bg-[#090b10] px-2.5 py-1.5 text-xs text-slate-600 dark:text-slate-300">
            <Layers className="h-3.5 w-3.5 text-[#f97316]" />
            <select
              value={selectedZone}
              onChange={(e) => setSelectedZone(e.target.value)}
              className="bg-transparent text-xs text-slate-800 dark:text-slate-200 outline-none [color-scheme:dark]"
            >
              <option value="ALL">All Zones</option>
              {zoneOptions.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </div>

          {/* Anomaly Type Filter */}
          <div className="flex items-center gap-1.5 rounded-xl border border-black/10 dark:border-white/10 bg-slate-50 dark:bg-[#090b10] px-2.5 py-1.5 text-xs text-slate-600 dark:text-slate-300">
            <ShieldAlert className="h-3.5 w-3.5 text-[#f97316]" />
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="bg-transparent text-xs text-slate-800 dark:text-slate-200 outline-none [color-scheme:dark]"
            >
              <option value="ALL">All Anomaly Types</option>
              {anomalyTypeOptions.map((t) => (
                <option key={t} value={t}>
                  {formatAnomalyLabel(t)}
                </option>
              ))}
            </select>
          </div>

          {/* Severity Filter */}
          <div className="flex items-center gap-1.5 rounded-xl border border-black/10 dark:border-white/10 bg-slate-50 dark:bg-[#090b10] px-2.5 py-1.5 text-xs text-slate-600 dark:text-slate-300">
            <Flame className="h-3.5 w-3.5 text-[#f97316]" />
            <select
              value={selectedSeverity}
              onChange={(e) => setSelectedSeverity(e.target.value)}
              className="bg-transparent text-xs text-slate-800 dark:text-slate-200 outline-none [color-scheme:dark]"
            >
              <option value="ALL">All Severities</option>
              <option value="CRITICAL">Critical</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
              <option value="INFO">Info</option>
            </select>
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1.5 rounded-xl border border-black/10 dark:border-white/10 bg-slate-50 dark:bg-[#090b10] px-2.5 py-1.5 text-xs text-slate-600 dark:text-slate-300">
            <SlidersHorizontal className="h-3.5 w-3.5 text-[#f97316]" />
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="bg-transparent text-xs text-slate-800 dark:text-slate-200 outline-none [color-scheme:dark]"
            >
              <option value="ALL">All Statuses</option>
              <option value="UNRESOLVED">Unresolved Only ({summary.unresolved})</option>
              <option value="NEW">New</option>
              <option value="REVIEWED">Reviewed</option>
              <option value="RESOLVED">Resolved</option>
            </select>
          </div>

          {/* Segment: All Incidents vs Photo Proof */}
          <div className="flex items-center rounded-xl border border-black/10 dark:border-white/10 bg-slate-100 dark:bg-[#090b10] p-0.5">
            <button
              onClick={() => {
                soundService.playTactileBlip(750, 0.02);
                setEvidenceOnly(false);
              }}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg transition cursor-pointer ${
                !evidenceOnly
                  ? 'bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <span>All Incidents ({mergedAlerts.length})</span>
            </button>
            <button
              onClick={() => {
                soundService.playTactileBlip(750, 0.02);
                setEvidenceOnly(true);
              }}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg transition cursor-pointer ${
                evidenceOnly
                  ? 'bg-white dark:bg-white/15 text-emerald-600 dark:text-emerald-400 shadow-xs'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <CameraIcon className="w-3 h-3 text-emerald-500" />
              <span>With Photo Proof ({totalWithEvidenceCount})</span>
            </button>
          </div>

          {/* Calendar Chronological Time Sort */}
          <div className="flex items-center gap-1.5 rounded-xl border border-black/10 dark:border-white/10 bg-slate-50 dark:bg-[#090b10] px-2.5 py-1.5 text-xs text-slate-600 dark:text-slate-300">
            <ArrowUpDown className="h-3.5 w-3.5 text-[#f97316]" />
            <select
              value={sortOrder}
              onChange={(e) => {
                soundService.playTactileBlip(700, 0.02);
                setSortOrder(e.target.value as any);
              }}
              className="bg-transparent text-xs text-slate-800 dark:text-slate-200 outline-none [color-scheme:dark] cursor-pointer"
            >
              <option value="desc">Newest Time First</option>
              <option value="asc">Oldest Time First</option>
              <option value="severity">Highest Severity</option>
              <option value="confidence">Highest Confidence</option>
            </select>
          </div>

          {/* Reset Filters Button */}
          {hasActiveFilters && (
            <button
              onClick={resetFilters}
              className="flex items-center gap-1 rounded-xl border border-red-500/20 bg-red-500/10 px-2.5 py-1.5 text-xs font-semibold text-red-500 dark:text-red-400 hover:bg-red-500/20 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" /> Clear Filters
            </button>
          )}

          {/* Match Count Badge */}
          <div className="ml-auto text-xs font-mono text-slate-500">
            Showing <span className="font-bold text-slate-900 dark:text-white">{totalCount > 0 ? (currentPage - 1) * pageSize + 1 : 0}–{Math.min(currentPage * pageSize, totalCount)}</span> of <span className="font-bold text-slate-900 dark:text-white">{totalCount}</span> {evidenceOnly ? 'evidence photos' : 'events'}
          </div>
        </div>
      </section>

      {/* ─── Alerts Evidence Views ──────────────────────────────────────── */}
      {filteredAlerts.length === 0 ? (
        /* ─── Dedicated Empty State: Crystal-Clear Communication for No Photos ─── */
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-black/15 dark:border-white/10 bg-white/50 dark:bg-[#0c101c]/60 py-16 px-4 text-center">
          {/* Visual Icon Badge */}
          <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-orange-500/20 bg-orange-500/10 text-orange-500 shadow-[0_0_20px_rgba(249,115,22,0.12)]">
            <CameraOff className="h-8 w-8" />
            <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black border border-orange-500/40 font-mono text-[9px] font-bold text-orange-400">
              0
            </span>
          </div>

          {/* Main Title */}
          <h3 className="mt-5 text-lg font-bold text-slate-900 dark:text-white tracking-tight">
            {selectedDate === todayKey
              ? 'No Evidence Photos Captured Today'
              : selectedDate
              ? `No Evidence Photos on ${formatRegisteredDate(selectedDate)}`
              : 'No Alerts Found'}
          </h3>

          {/* Status Badge */}
          <div className="mt-2">
            {selectedDate === todayKey ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-0.5 text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                0 PHOTOS RECORDED TODAY · FACILITY FULLY COMPLIANT
              </span>
            ) : selectedDate ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-0.5 text-xs font-mono font-bold text-amber-500 dark:text-amber-400">
                <span>0 PHOTOS RECORDED ON THIS DATE</span>
              </span>
            ) : null}
          </div>

          {/* Subtext explanation */}
          <p className="mt-2.5 text-xs text-slate-500 dark:text-slate-400 max-w-lg leading-relaxed">
            {selectedDate === todayKey
              ? `All monitored cameras are running smoothly with zero PPE violations or hazards detected today (${formatRegisteredDate(todayKey)}). AI detection is actively scanning in the background.`
              : selectedDate && selectedDateMetrics.totalEvents > 0 && selectedDateMetrics.totalPhotos === 0
              ? `There are ${selectedDateMetrics.totalEvents} alert events registered for ${formatRegisteredDate(selectedDate)}, but none have stored snapshot photo proofs.`
              : selectedDate
              ? `There are zero surveillance violation photos or evidence snapshots stored for ${formatRegisteredDate(selectedDate)}. Use the date switcher or fast jump buttons below to inspect other days.`
              : 'No alerts match your current filter criteria. Try adjusting your search keywords or clearing filters.'}
          </p>

          {/* Smart Calendar Navigation Quick Actions */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5 max-w-xl">
            {/* Action 1: If there are events without photos and evidenceOnly is on */}
            {selectedDate && selectedDateMetrics.totalEvents > 0 && selectedDateMetrics.totalPhotos === 0 && evidenceOnly && (
              <button
                type="button"
                onClick={() => {
                  soundService.playTactileBlip(750, 0.02);
                  setEvidenceOnly(false);
                }}
                className="flex items-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 px-4 py-2.5 text-xs font-semibold transition cursor-pointer shadow-xs"
              >
                <span>View {selectedDateMetrics.totalEvents} Violation Events (Without Photos)</span>
              </button>
            )}

            {/* Action 2: Jump to Closest Previous Date with Photos */}
            {adjacentPhotoDates.prevDateWithPhotos && (
              <button
                type="button"
                onClick={() => {
                  soundService.playTactileBlip(800, 0.02);
                  setSelectedDate(adjacentPhotoDates.prevDateWithPhotos!);
                  setDatePreset('CUSTOM');
                }}
                className="flex items-center gap-2 rounded-xl border border-orange-500/40 bg-orange-500/10 hover:bg-orange-500/20 text-orange-500 dark:text-orange-400 px-4 py-2.5 text-xs font-semibold transition cursor-pointer shadow-xs hover:border-orange-500/60"
              >
                <ChevronLeft className="h-3.5 w-3.5 text-orange-400" />
                <span>
                  View Earlier Photos: <strong>{formatRegisteredDate(adjacentPhotoDates.prevDateWithPhotos)}</strong>
                </span>
              </button>
            )}

            {/* Action 3: Jump to Closest Later Date with Photos */}
            {adjacentPhotoDates.nextDateWithPhotos && (
              <button
                type="button"
                onClick={() => {
                  soundService.playTactileBlip(800, 0.02);
                  setSelectedDate(adjacentPhotoDates.nextDateWithPhotos!);
                  setDatePreset('CUSTOM');
                }}
                className="flex items-center gap-2 rounded-xl border border-orange-500/40 bg-orange-500/10 hover:bg-orange-500/20 text-orange-500 dark:text-orange-400 px-4 py-2.5 text-xs font-semibold transition cursor-pointer shadow-xs hover:border-orange-500/60"
              >
                <span>
                  Next Photos Day: <strong>{formatRegisteredDate(adjacentPhotoDates.nextDateWithPhotos)}</strong>
                </span>
                <ChevronRight className="h-3.5 w-3.5 text-orange-400" />
              </button>
            )}

            {/* Action 4: Return to Today */}
            {selectedDate !== todayKey && (
              <button
                type="button"
                onClick={() => {
                  soundService.playTactileBlip(750, 0.02);
                  setSelectedDate(todayKey);
                  setDatePreset('TODAY');
                }}
                className="flex items-center gap-1.5 rounded-xl border border-black/10 dark:border-white/10 bg-white/5 hover:bg-white/10 px-3.5 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 transition cursor-pointer"
              >
                <Calendar className="h-3.5 w-3.5 text-[#06b6d4]" />
                <span>Return to Today</span>
              </button>
            )}

            {/* Action 5: Reset all filters */}
            {hasActiveFilters && (
              <button
                onClick={resetFilters}
                className="rounded-xl border border-red-500/20 bg-red-500/10 px-3.5 py-2.5 text-xs font-semibold text-red-500 dark:text-red-400 hover:bg-red-500/20 transition cursor-pointer"
              >
                Reset All Filters
              </button>
            )}
          </div>
        </div>
      ) : viewMode === 'byCamera' ? (
        /* ─── 1. Per-Camera Card Stream View (Default) ──────────────────── */
        <div className="space-y-6">
          {cameraGroups.map((group) => {
            return (
              <div
                key={group.cameraId}
                className="overflow-hidden rounded-2xl border border-black/[0.08] dark:border-white/[0.08] bg-white dark:bg-[#0b0e18] p-4 sm:p-5 shadow-sm transition-all"
              >
                {/* Camera Header Banner */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-black/[0.06] dark:border-white/[0.06]">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f97316]/10 text-[#f97316] border border-[#f97316]/25">
                      <CameraIcon className="h-5 w-5" />
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold tracking-tight text-slate-900 dark:text-white">
                          {group.cameraName}
                        </h3>

                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-mono font-bold uppercase ${
                            group.isOnline
                              ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
                              : 'bg-red-500/10 text-red-500 border-red-500/30'
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              group.isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'
                            }`}
                          />
                          {group.isOnline ? 'ONLINE' : 'OFFLINE'}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500">
                        <span className="font-mono text-[10px] text-slate-400">
                          {group.cameraId}
                        </span>
                        <span>·</span>
                        <span className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                          <Layers className="h-3 w-3 text-[#f97316]" /> {group.zone}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Header Badges & Actions */}
                  <div className="flex items-center gap-2.5 self-start sm:self-auto">
                    {group.totalViolations > 0 && (
                      <span
                        className="inline-flex items-center gap-1 rounded-xl px-2.5 py-1 text-xs font-mono font-bold bg-amber-500/10 border border-amber-500/25 text-amber-500"
                        title={`Total violations recorded today for ${group.cameraName} in database`}
                      >
                        {group.totalViolations} Recorded Today
                      </span>
                    )}

                    <span
                      className={`inline-flex items-center gap-1 rounded-xl px-3 py-1 text-xs font-mono font-bold ${
                        group.alerts.length > 0
                          ? 'bg-[#f97316]/10 border border-[#f97316]/25 text-[#f97316]'
                          : group.totalViolations > 0
                          ? 'bg-slate-500/10 border border-slate-500/20 text-slate-400'
                          : !group.isOnline
                          ? 'bg-red-500/10 border border-red-500/25 text-red-500'
                          : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {group.alerts.length > 0
                        ? `${group.alerts.length} Evidence Photo${group.alerts.length > 1 ? 's' : ''}`
                        : group.totalViolations > 0
                        ? 'Photos on Other Pages'
                        : !group.isOnline
                        ? 'Camera Stream Offline'
                        : '0 Violations • Compliant'}
                    </span>

                    <button
                      onClick={() => {
                        if (selectedCamera === group.cameraId) {
                          setSelectedCamera('ALL');
                        } else {
                          setSelectedCamera(group.cameraId);
                        }
                      }}
                      className={`flex items-center gap-1 rounded-xl border px-2.5 py-1 text-xs font-medium transition ${
                        selectedCamera === group.cameraId
                          ? 'border-[#f97316] bg-[#f97316] text-white font-semibold'
                          : 'border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.05] text-slate-700 dark:text-slate-300 hover:bg-black/[0.06] dark:hover:bg-white/10'
                      }`}
                      title="Filter only this camera"
                    >
                      <Filter className="h-3 w-3" />
                      <span>{selectedCamera === group.cameraId ? 'Showing Only' : 'Filter Camera'}</span>
                    </button>
                  </div>
                </div>

                {/* Evidence Photos Grid: Cards One by One OR Clean Compliant State */}
                {group.alerts.length > 0 ? (
                  <>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 mt-4">
                      {group.alerts.map((alert) => (
                        <IncidentEvidenceCard
                          key={alert.id}
                          alert={alert}
                          onInspect={() => setInspectAlert(alert)}
                          onQuickResolve={() => handleStatusUpdate(alert.id, 'RESOLVED')}
                          onDelete={() => {
                            if (window.confirm('Permanently delete this incident and its stored evidence photo from disk?')) {
                              handleDeleteIncident(alert.id);
                            }
                          }}
                          isResolving={resolvingId === alert.id}
                        />
                      ))}
                    </div>

                    {group.totalViolations > group.alerts.length && (
                      <div className="mt-3 flex items-center justify-between pt-3 border-t border-black/[0.06] dark:border-white/[0.06] text-xs font-mono">
                        <span className="text-slate-500">
                          Showing latest <strong>{group.alerts.length}</strong> of <strong>{group.totalViolations}</strong> violations recorded today
                        </span>
                        <button
                          onClick={() => {
                            setSelectedCamera(group.cameraId);
                            setCurrentPage(1);
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 hover:bg-amber-500/25 text-amber-500 font-bold transition cursor-pointer"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span>View All {group.totalViolations} Photos for {group.cameraName}</span>
                        </button>
                      </div>
                    )}
                  </>
                ) : group.totalViolations > 0 ? (
                  <div className="mt-4 py-4 px-4 rounded-xl border border-dashed border-amber-500/20 bg-amber-500/[0.03] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs font-mono">
                    <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                      <Layers className="h-4 w-4 text-amber-500 shrink-0" />
                      <span>
                        <strong>{group.totalViolations}</strong> violations recorded today for {group.cameraName} across earlier/later pages.
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        setSelectedCamera(group.cameraId);
                        setCurrentPage(1);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 hover:bg-amber-500/25 text-amber-500 font-bold transition cursor-pointer shrink-0"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span>View All {group.totalViolations} Photos for {group.cameraName}</span>
                    </button>
                  </div>
                ) : !group.isOnline ? (
                  <div className="mt-4 py-4 px-4 rounded-xl border border-dashed border-red-500/20 bg-red-500/[0.02] flex flex-col sm:flex-row items-center justify-between gap-2 text-xs font-mono text-slate-500">
                    <span className="flex items-center gap-2 text-red-500">
                      <CameraOff className="h-4 w-4 shrink-0" />
                      <span>Camera Stream Offline · RTSP source disconnected or unreachable</span>
                    </span>
                    <span className="text-[10px] text-slate-400">0 Violations Detected (Offline)</span>
                  </div>
                ) : (
                  <div className="mt-4 py-4 px-4 rounded-xl border border-dashed border-black/10 dark:border-white/10 bg-black/[0.01] dark:bg-white/[0.01] flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500 font-mono">
                    <span className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                      <span>0 violations recorded today • Monitored node fully compliant</span>
                    </span>
                    <span className="text-[10px] text-slate-400">Continuous AI Stream Active</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : viewMode === 'grid' ? (
        /* ─── 2. All Evidence Photos Grid (Date-Grouped when All Dates) ───── */
        selectedDate === '' ? (
          <div className="space-y-6">
            {availableDateOptions.map((dateOpt) => {
              const dayAlerts = filteredAlerts.filter((a) => {
                const keys = getAlertDateKeys(a.confirmedAt || a.createdAt);
                return keys.includes(dateOpt.date);
              });
              if (dayAlerts.length === 0) return null;
              return (
                <div key={dateOpt.date} className="space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-black/[0.08] dark:border-white/[0.08]">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-[#f97316]" />
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                        {formatFullDate(dateOpt.date)}
                      </h4>
                      {dateOpt.date === todayKey && (
                        <span className="px-1.5 py-0.2 rounded text-[9.5px] font-mono font-bold bg-orange-500/20 text-orange-400 border border-orange-500/30">
                          TODAY
                        </span>
                      )}
                    </div>
                    <span className="text-xs font-mono text-slate-500">
                      {dayAlerts.length} {dayAlerts.length === 1 ? 'photo' : 'photos'}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                    {dayAlerts.map((alert) => (
                      <IncidentEvidenceCard
                        key={alert.id}
                        alert={alert}
                        onInspect={() => setInspectAlert(alert)}
                        onQuickResolve={() => handleStatusUpdate(alert.id, 'RESOLVED')}
                        onDelete={() => {
                          if (window.confirm('Permanently delete this incident and its stored evidence photo from disk?')) {
                            handleDeleteIncident(alert.id);
                          }
                        }}
                        isResolving={resolvingId === alert.id}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {filteredAlerts.map((alert) => (
              <IncidentEvidenceCard
                key={alert.id}
                alert={alert}
                onInspect={() => setInspectAlert(alert)}
                onQuickResolve={() => handleStatusUpdate(alert.id, 'RESOLVED')}
                onDelete={() => {
                  if (window.confirm('Permanently delete this incident and its stored evidence photo from disk?')) {
                    handleDeleteIncident(alert.id);
                  }
                }}
                isResolving={resolvingId === alert.id}
              />
            ))}
          </div>
        )
      ) : (
        /* ─── 3. Evidence Table View ─────────────────────────────────────── */
        <div className="overflow-hidden rounded-2xl border border-black/[0.08] dark:border-white/[0.08] bg-white dark:bg-[#0f0f12] shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-black/[0.08] dark:border-white/[0.08] bg-slate-50 dark:bg-[#0a0c14] text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Evidence</th>
                  <th className="px-4 py-3">Anomaly</th>
                  <th className="px-4 py-3">Camera</th>
                  <th className="px-4 py-3">Zone</th>
                  <th className="px-4 py-3">Severity</th>
                  <th className="px-4 py-3">Registered Date</th>
                  <th className="px-4 py-3">Registered Time</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.04]">
                {filteredAlerts.map((alert) => {
                  const severity = getSeverity(alert);
                  const sevTheme = getSeverityTheme(severity);
                  const statusBadge = getStatusBadge(alert.status);
                  const SevIcon = sevTheme.icon;

                  return (
                    <tr
                      key={alert.id}
                      onClick={() => setInspectAlert(alert)}
                      className="group cursor-pointer transition hover:bg-slate-50 dark:hover:bg-[#151928]"
                    >
                      {/* Evidence Thumbnail */}
                      <td className="px-4 py-2.5">
                        <div className="h-12 w-20">
                          <EvidenceThumbnail
                            alert={alert}
                            onClick={() => setInspectAlert(alert)}
                            className="h-full w-full"
                          />
                        </div>
                      </td>

                      {/* Anomaly */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <SevIcon className={`h-4 w-4 shrink-0 ${sevTheme.text}`} />
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-slate-900 dark:text-white">
                                {alert.employeeName && alert.employeeName !== 'Unidentified person'
                                  ? `${alert.employeeName} has not worn ${formatAnomalyLabel(alert.anomalyType).toLowerCase()}`
                                  : alert.alertMessage || formatAnomalyLabel(alert.anomalyType)}
                              </span>
                              {(() => {
                                const d = parseIsoToUtc(alert.confirmedAt || alert.createdAt);
                                const isRecent = d && (Date.now() - d.getTime()) < 10 * 60 * 1000;
                                return isRecent ? (
                                  <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-red-600/90 text-white animate-pulse">
                                    JUST NOW
                                  </span>
                                ) : null;
                              })()}
                            </div>
                            <div className="text-[10px] font-mono text-slate-500 flex items-center gap-1.5 mt-0.5">
                              <span>Conf: {Math.round((alert.confidence || 0) * 100)}%</span>
                              {alert.employeeName && alert.employeeName !== 'Unidentified person' ? (
                                <span className="text-orange-500 dark:text-orange-400 font-bold">• {alert.employeeName}</span>
                              ) : (
                                <span className="text-slate-400">• Unidentified</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Camera */}
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          {alert.cameraName || alert.cameraId}
                        </div>
                        <div className="text-[10px] font-mono text-slate-500">
                          {alert.cameraId}
                        </div>
                      </td>

                      {/* Zone */}
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {alert.zone || 'General Facility'}
                      </td>

                      {/* Severity Badge */}
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-mono font-bold uppercase ${sevTheme.badge}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${sevTheme.dot}`} />
                          {severity}
                        </span>
                      </td>

                      {/* Registered Date */}
                      <td className="px-4 py-3 font-mono text-slate-700 dark:text-slate-300">
                        {formatRegisteredDate(alert.confirmedAt || alert.createdAt)}
                      </td>

                      {/* Registered Time */}
                      <td className="px-4 py-3 font-mono font-semibold text-slate-800 dark:text-slate-200">
                        {formatRegisteredTime(alert.confirmedAt || alert.createdAt)}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-mono font-bold uppercase ${statusBadge.style}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${statusBadge.dot}`} />
                          {statusBadge.label}
                        </span>
                      </td>

                      {/* Action */}
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setInspectAlert(alert);
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-slate-100 dark:bg-white/5 px-3 py-1 text-xs font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-[#f97316] hover:text-white hover:border-[#f97316] cursor-pointer"
                          >
                            <Eye className="h-3 w-3" /> View
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (window.confirm('Permanently delete this incident and its stored evidence photo from disk?')) {
                                handleDeleteIncident(alert.id);
                              }
                            }}
                            className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition cursor-pointer"
                            title="Delete Incident & Erase Photo"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      
      {/* ─── Modern Server-Side Pagination Bar ────────────────────────────── */}
      {totalCount > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-4 px-4 sm:px-6 rounded-2xl border border-black/[0.08] dark:border-white/[0.08] bg-white dark:bg-[#0f0f12] shadow-sm">
          {/* Left: Range and Items Per Page */}
          <div className="flex items-center gap-3 text-xs font-mono text-slate-500 dark:text-slate-400">
            <span>
              Showing <strong className="text-slate-900 dark:text-white">{(currentPage - 1) * pageSize + 1}</strong>–<strong className="text-slate-900 dark:text-white">{Math.min(currentPage * pageSize, totalCount)}</strong> of <strong className="text-slate-900 dark:text-white">{totalCount}</strong>
            </span>
            <span className="text-slate-300 dark:text-slate-700">|</span>
            <div className="flex items-center gap-1.5">
              <span>Per page:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  const newSize = Number(e.target.value);
                  setPageSize(newSize);
                  setCurrentPage(1);
                  fetchBackendAlerts(1, newSize);
                }}
                className="rounded-lg border border-black/10 dark:border-white/10 bg-slate-50 dark:bg-black/40 px-2 py-1 text-xs text-slate-800 dark:text-slate-200 outline-none cursor-pointer"
              >
                <option value={12}>12</option>
                <option value={24}>24</option>
                <option value={48}>48</option>
              </select>
            </div>
            {isFetchingBackend && (
              <span className="text-xs font-mono text-orange-500 animate-pulse ml-2">Loading…</span>
            )}
          </div>

          {/* Right: Page Navigation Buttons */}
          <div className="flex items-center gap-1.5 flex-wrap justify-center">
            {/* First Page */}
            <button
              onClick={() => {
                if (currentPage > 1) {
                  setCurrentPage(1);
                  fetchBackendAlerts(1, pageSize);
                }
              }}
              disabled={currentPage <= 1 || isFetchingBackend}
              className="px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-slate-50 dark:bg-white/[0.04] text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition"
              title="First Page"
            >
              «
            </button>

            {/* Previous Page */}
            <button
              onClick={() => {
                if (currentPage > 1) {
                  const prevPage = currentPage - 1;
                  setCurrentPage(prevPage);
                  fetchBackendAlerts(prevPage, pageSize);
                }
              }}
              disabled={currentPage <= 1 || isFetchingBackend}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-slate-50 dark:bg-white/[0.04] text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition"
              title="Previous Page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Prev</span>
            </button>

            {/* Page Number Pills */}
            {getPageNumbers(currentPage, totalPages).map((p, idx) => {
              if (p === '...') {
                return (
                  <span key={`ellipsis-${idx}`} className="px-1.5 text-xs text-slate-400">
                    …
                  </span>
                );
              }
              const pageNum = p as number;
              const isActive = pageNum === currentPage;
              return (
                <button
                  key={`page-${pageNum}`}
                  onClick={() => {
                    if (pageNum !== currentPage) {
                      setCurrentPage(pageNum);
                      fetchBackendAlerts(pageNum, pageSize);
                    }
                  }}
                  disabled={isFetchingBackend}
                  className={`min-w-[32px] h-8 rounded-lg text-xs font-mono font-semibold transition cursor-pointer ${
                    isActive
                      ? 'bg-[#f97316] text-white shadow-xs'
                      : 'border border-black/10 dark:border-white/10 bg-slate-50 dark:bg-white/[0.04] text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}

            {/* Next Page */}
            <button
              onClick={() => {
                if (currentPage < totalPages) {
                  const nextPage = currentPage + 1;
                  setCurrentPage(nextPage);
                  fetchBackendAlerts(nextPage, pageSize);
                }
              }}
              disabled={currentPage >= totalPages || isFetchingBackend}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-slate-50 dark:bg-white/[0.04] text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition"
              title="Next Page"
            >
              <span className="hidden sm:inline">Next</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>

            {/* Last Page */}
            <button
              onClick={() => {
                if (currentPage < totalPages) {
                  setCurrentPage(totalPages);
                  fetchBackendAlerts(totalPages, pageSize);
                }
              }}
              disabled={currentPage >= totalPages || isFetchingBackend}
              className="px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-slate-50 dark:bg-white/[0.04] text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition"
              title="Last Page"
            >
              »
            </button>
          </div>
        </div>
      )}

      {/* ─── Full Evidence Viewer Modal ────────────────────────────────── */}
      {inspectAlert && (
        <EvidenceViewerModal
          alert={inspectAlert}
          alertsList={filteredAlerts}
          onClose={() => setInspectAlert(null)}
          onStatusChange={handleStatusUpdate}
          onDelete={handleDeleteIncident}
        />
      )}
    </div>
  );
};