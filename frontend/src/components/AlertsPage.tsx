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
} from 'lucide-react';
import { AnomalyAlertEvent, Camera } from '../types';
import { anomalyService } from '../services/anomalyService';

interface AlertsPageProps {
  alerts: AnomalyAlertEvent[];
  cameras?: Camera[];
  onRefresh?: () => void;
  isLoading?: boolean;
  onStatusUpdate?: (id: string, newStatus: string) => void;
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

const parseDateKey = (iso?: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatRegisteredDate = (iso?: string | null): string => {
  if (!iso) return '--';
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
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }); // e.g. "11 September 2026"
};

const formatRegisteredTime = (iso?: string | null): string => {
  if (!iso) return '--:--:--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }); // e.g. "12:42:31 PM"
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
}

const EvidenceViewerModal: React.FC<EvidenceViewerModalProps> = ({
  alert,
  alertsList,
  onClose,
  onStatusChange,
}) => {
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [imgError, setImgError] = useState<boolean>(false);
  const [imgLoading, setImgLoading] = useState<boolean>(true);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState<boolean>(false);
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
                  Anomaly Classification
                </div>
                <h3 className="mt-1 text-xl font-bold text-white tracking-tight flex items-center gap-2">
                  <SevIcon className={`h-5 w-5 ${sevTheme.text}`} />
                  {formatAnomalyLabel(currentAlert.anomalyType)}
                </h3>
                <p className="mt-0.5 text-xs text-slate-400">
                  Category: {currentAlert.eventCategory || 'VIOLATION'}
                </p>
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
                    <Clock className="h-3.5 w-3.5 text-[#f97316]" /> Registered Time
                  </span>
                  <span className="font-mono font-semibold text-slate-100">
                    {formatRegisteredTime(currentAlert.confirmedAt || currentAlert.createdAt)}
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
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-[#06b6d4]/40 bg-[#06b6d4]/10 px-3 py-2 text-xs font-semibold text-[#06b6d4] transition hover:bg-[#06b6d4]/20 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Check className="h-3.5 w-3.5" />
                  Mark Reviewed
                </button>

                <button
                  disabled={isUpdatingStatus || currentAlert.status === 'RESOLVED'}
                  onClick={() => handleStatusClick('RESOLVED')}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-[#17c964]/40 bg-[#17c964]/10 px-3 py-2 text-xs font-semibold text-[#17c964] transition hover:bg-[#17c964]/20 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Resolve
                </button>
              </div>

              <button
                onClick={onClose}
                className="w-full rounded-xl border border-white/10 bg-white/5 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/10 hover:text-white"
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
  isResolving?: boolean;
}

const IncidentEvidenceCard: React.FC<IncidentEvidenceCardProps> = ({
  alert,
  onInspect,
  onQuickResolve,
  isResolving = false,
}) => {
  const severity = getSeverity(alert);
  const sevTheme = getSeverityTheme(severity);
  const statusBadge = getStatusBadge(alert.status);
  const SevIcon = sevTheme.icon;

  const isRecent = useMemo(() => {
    const t = new Date(alert.confirmedAt || alert.createdAt).getTime();
    if (!t) return false;
    return Date.now() - t < 5 * 60 * 1000;
  }, [alert.confirmedAt, alert.createdAt]);

  return (
    <div
      onClick={onInspect}
      className={`group relative flex flex-col justify-between overflow-hidden rounded-2xl border bg-white dark:bg-[#0d121f] p-3.5 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-[#f97316]/50 hover:shadow-lg dark:hover:shadow-[0_8px_24px_rgba(0,0,0,0.6)] cursor-pointer ${
        isRecent
          ? 'border-red-500/40 shadow-[0_0_12px_rgba(239,68,68,0.15)] ring-1 ring-red-500/20'
          : 'border-black/[0.08] dark:border-white/[0.08]'
      }`}
    >
      <div>
        {/* Card Header: Anomaly Name + Severity Pill */}
        <div className="flex items-center justify-between gap-1.5 mb-2.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <SevIcon className={`h-3.5 w-3.5 shrink-0 ${sevTheme.text}`} />
            <span className="truncate text-xs font-bold text-slate-900 dark:text-white tracking-tight">
              {formatAnomalyLabel(alert.anomalyType)}
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {isRecent && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-500/20 border border-red-500/40 px-1.5 py-0.5 text-[8px] font-mono font-bold text-red-400 uppercase tracking-wider animate-pulse">
                <span className="h-1 w-1 rounded-full bg-red-400" />
                JUST NOW
              </span>
            )}
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider ${sevTheme.badge}`}
            >
              <span className={`h-1 w-1 rounded-full ${sevTheme.dot}`} />
              {severity}
            </span>
          </div>
        </div>

        {/* Evidence Photo Frame */}
        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black/90 border border-black/10 dark:border-white/10">
          <EvidenceThumbnail
            alert={alert}
            onClick={onInspect}
            className="h-full w-full"
          />

          {/* Overlay Status Badge */}
          <div className="absolute top-2 left-2 z-10 pointer-events-none">
            <span
              className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-mono font-semibold uppercase backdrop-blur-md shadow-sm ${statusBadge.style}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${statusBadge.dot}`} />
              {statusBadge.label}
            </span>
          </div>

          {/* Overlay Track ID */}
          {alert.trackId !== undefined && alert.trackId !== null && (
            <div className="absolute top-2 right-2 z-10 pointer-events-none rounded-md bg-black/75 px-1.5 py-0.5 text-[9px] font-mono text-slate-300 border border-white/10 backdrop-blur-md">
              #{alert.trackId}
            </div>
          )}

          {/* Scanline Effect Line on Card Hover */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-white/[0.03] to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
        </div>

        {/* Telemetry Row */}
        <div className="mt-3 space-y-2 text-[11px]">
          {/* Row 1: Time & Date */}
          <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-[#f97316]" />
              <span className="font-mono font-bold text-slate-900 dark:text-slate-100 text-xs">
                {formatRegisteredTime(alert.confirmedAt || alert.createdAt)}
              </span>
            </span>

            <span className="flex items-center gap-1 font-mono text-[10px] text-slate-500 dark:text-slate-400">
              <Calendar className="h-3 w-3 text-slate-400" />
              {formatRegisteredDate(alert.confirmedAt || alert.createdAt)}
            </span>
          </div>

          {/* Row 2: Camera Name & AI Confidence */}
          <div className="flex items-center justify-between text-[11px] border-t border-black/[0.04] dark:border-white/[0.05] pt-1.5 text-slate-500">
            <div className="flex items-center gap-1 min-w-0">
              <CameraIcon className="h-3 w-3 text-slate-400 shrink-0" />
              <span className="truncate font-semibold text-slate-800 dark:text-slate-200">
                {alert.cameraName || alert.cameraId}
              </span>
            </div>
            <span className="shrink-0 font-mono text-emerald-500 dark:text-emerald-400 font-bold text-[10px]">
              {Math.round((alert.confidence || 0) * 100)}% Conf
            </span>
          </div>

          {/* Row 3: Facility Zone & Snapshot Presence */}
          <div className="flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-500 pt-0.5">
            <span className="flex items-center gap-1 truncate">
              <Layers className="h-3 w-3 text-[#f97316]/70 shrink-0" />
              <span className="truncate">{alert.zone || 'General Facility'}</span>
            </span>
            {alert.snapshotPath ? (
              <span className="inline-flex items-center gap-0.5 text-[9px] font-mono text-emerald-500 dark:text-emerald-400 font-semibold">
                <Check className="h-2.5 w-2.5" /> Photo OK
              </span>
            ) : (
              <span className="text-[9px] font-mono text-slate-400">Log Event</span>
            )}
          </div>
        </div>
      </div>

      {/* Card Action Buttons */}
      <div className="mt-3 pt-2.5 border-t border-black/[0.06] dark:border-white/[0.06] flex items-center gap-1.5">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onInspect();
          }}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.05] py-1.5 text-[11px] font-semibold text-slate-800 dark:text-slate-200 transition hover:bg-[#f97316] hover:text-white hover:border-[#f97316]"
        >
          <Eye className="h-3.5 w-3.5" />
          <span>Inspect Proof</span>
        </button>

        {(alert.status || 'NEW').toUpperCase() !== 'RESOLVED' && onQuickResolve && (
          <button
            disabled={isResolving}
            onClick={(e) => {
              e.stopPropagation();
              onQuickResolve(e);
            }}
            title="Mark Resolved"
            className="flex items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};

// ─── Main Alerts & Evidence Page Component ──────────────────────────────────

export const AlertsPage: React.FC<AlertsPageProps> = ({
  alerts = [],
  cameras = [],
  onRefresh,
  isLoading = false,
  onStatusUpdate,
}) => {
  // Available evidence dates fetched from backend/data/evidence
  const [evidenceDates, setEvidenceDates] = useState<{ date: string; totalAlerts: number; evidencePhotos: number }[]>([]);
  const [loadingDates, setLoadingDates] = useState(false);

  // Filters State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCamera, setSelectedCamera] = useState('ALL');
  const [selectedZone, setSelectedZone] = useState('ALL');
  const [selectedType, setSelectedType] = useState('ALL');
  const [selectedSeverity, setSelectedSeverity] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  const [selectedDate, setSelectedDate] = useState<string>(''); // YYYY-MM-DD
  const [datePreset, setDatePreset] = useState<'ALL' | 'TODAY' | 'YESTERDAY' | 'CUSTOM'>('ALL');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [viewMode, setViewMode] = useState<'byCamera' | 'grid' | 'table'>('byCamera');
  const [evidenceOnly, setEvidenceOnly] = useState<boolean>(true);

  // Evidence Inspector Modal State
  const [inspectAlert, setInspectAlert] = useState<AnomalyAlertEvent | null>(null);

  // Local alert status override cache & loading tracker
  const [localStatuses, setLocalStatuses] = useState<Record<string, string>>({});
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  // Fetch evidence dates from backend/data/evidence
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

  // Auto-sync alerts and evidence every 5 seconds
  useEffect(() => {
    fetchEvidenceDates();
    const interval = setInterval(() => {
      onRefresh?.();
      fetchEvidenceDates();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchEvidenceDates, onRefresh]);

  // Merged alerts with normalization & local statuses
  const mergedAlerts = useMemo(() => {
    return alerts.map((raw: any) => {
      const a: AnomalyAlertEvent = {
        ...raw,
        cameraId: raw.cameraId || raw.camera_id || '',
        cameraName: raw.cameraName || raw.camera_name || raw.cameraId || raw.camera_id || '',
        eventCategory: raw.eventCategory || raw.event_category || 'VIOLATION',
        anomalyType: raw.anomalyType || raw.anomaly_type || 'ANOMALY',
        trackId: raw.trackId ?? raw.track_id,
        confirmedAt: raw.confirmedAt || raw.confirmed_at || raw.createdAt || raw.created_at || raw.timestamp,
        createdAt: raw.createdAt || raw.created_at || raw.confirmedAt || raw.confirmed_at || raw.timestamp,
        snapshotPath: raw.snapshotPath || raw.snapshot_path || null,
        status: localStatuses[raw.id] || raw.status || 'NEW',
      };
      return a;
    });
  }, [alerts, localStatuses]);

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
        if (a.snapshotPath || a.id) {
          item.evidencePhotos += 1;
        }
      }
    });

    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [evidenceDates, mergedAlerts]);

  // Connect global window helper for modal prev/next keyboard navigation
  useEffect(() => {
    (window as any).__cameye_select_alert = (alert: AnomalyAlertEvent) => {
      setInspectAlert(alert);
    };
    return () => {
      delete (window as any).__cameye_select_alert;
    };
  }, []);

  // Today & Yesterday ISO strings
  const todayKey = useMemo(() => {
    const d = new Date();
    return parseDateKey(d.toISOString());
  }, []);

  const yesterdayKey = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return parseDateKey(d.toISOString());
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

  // Filtered and sorted alerts list
  const filteredAlerts = useMemo(() => {
    return mergedAlerts
      .filter((alert) => {
        // Camera filter
        if (selectedCamera !== 'ALL' && alert.cameraId !== selectedCamera) {
          return false;
        }

        // Zone filter
        if (selectedZone !== 'ALL' && alert.zone !== selectedZone) {
          return false;
        }

        // Anomaly type filter
        if (selectedType !== 'ALL' && alert.anomalyType !== selectedType) {
          return false;
        }

        // Severity filter
        if (selectedSeverity !== 'ALL') {
          const sev = getSeverity(alert);
          if (sev !== selectedSeverity) return false;
        }

        // Status filter
        if (selectedStatus !== 'ALL') {
          const norm = (alert.status || 'NEW').toUpperCase();
          if (selectedStatus === 'NEW' && norm !== 'NEW' && norm !== 'CONFIRMED' && norm !== 'ACTIVE') {
            return false;
          } else if (selectedStatus !== 'NEW' && norm !== selectedStatus) {
            return false;
          }
        }

        // Date filter
        if (selectedDate) {
          const alertDateKey = parseDateKey(alert.confirmedAt || alert.createdAt);
          if (alertDateKey !== selectedDate) return false;
        }

        // Search query
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const matchCam = (alert.cameraName || alert.cameraId).toLowerCase().includes(q);
          const matchZone = (alert.zone || '').toLowerCase().includes(q);
          const matchType = (alert.anomalyType || '').toLowerCase().includes(q);
          const matchTrack = alert.trackId !== undefined && String(alert.trackId).includes(q);
          if (!matchCam && !matchZone && !matchType && !matchTrack) {
            return false;
          }
        }

        // Evidence photos only filter (filters out empty/non-photo events)
        if (evidenceOnly && (!alert.snapshotPath || !alert.snapshotPath.trim())) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        const timeA = new Date(a.confirmedAt || a.createdAt).getTime() || 0;
        const timeB = new Date(b.confirmedAt || b.createdAt).getTime() || 0;
        return sortOrder === 'desc' ? timeB - timeA : timeA - timeB;
      });
  }, [
    mergedAlerts,
    evidenceOnly,
    selectedCamera,
    selectedZone,
    selectedType,
    selectedSeverity,
    selectedStatus,
    selectedDate,
    searchQuery,
    sortOrder,
  ]);

  // Total count of real captured snapshots
  const totalWithEvidenceCount = useMemo(() => {
    return mergedAlerts.filter((a) => Boolean(a.snapshotPath && a.snapshotPath.trim())).length;
  }, [mergedAlerts]);

  // Group filtered alerts per camera for the "By Camera" card stream view
  const cameraGroups = useMemo(() => {
    const map = new Map<
      string,
      {
        cameraId: string;
        cameraName: string;
        zone: string;
        isOnline: boolean;
        alerts: AnomalyAlertEvent[];
      }
    >();

    filteredAlerts.forEach((alert) => {
      const camId = alert.cameraId;
      if (!map.has(camId)) {
        const camObj = cameras.find((c) => c.id === camId);
        map.set(camId, {
          cameraId: camId,
          cameraName: alert.cameraName || camObj?.name || camId,
          zone: alert.zone || camObj?.zone || 'General Facility',
          isOnline: camObj ? camObj.status === 'ONLINE' : true,
          alerts: [],
        });
      }
      map.get(camId)!.alerts.push(alert);
    });

    // Natural sort by camera name
    return Array.from(map.values()).sort((a, b) =>
      a.cameraName.localeCompare(b.cameraName, undefined, { numeric: true })
    );
  }, [filteredAlerts, cameras]);

  // Selected camera details for camera banner (if single camera filter applied)
  const selectedCameraMeta = useMemo(() => {
    if (selectedCamera === 'ALL') return null;
    const found = cameras.find((c) => c.id === selectedCamera);
    const cameraAlerts = mergedAlerts.filter((a) => a.cameraId === selectedCamera);
    return {
      name: found?.name || selectedCamera,
      zone: found?.zone || cameraAlerts[0]?.zone || 'General Facility',
      violationsCount: cameraAlerts.length,
    };
  }, [selectedCamera, cameras, mergedAlerts]);

  // Summary card counts
  const summary = useMemo(() => {
    const total = mergedAlerts.length;
    const today = mergedAlerts.filter((a) => parseDateKey(a.confirmedAt || a.createdAt) === todayKey).length;
    const highSeverity = mergedAlerts.filter((a) => {
      const s = getSeverity(a);
      return s === 'CRITICAL' || s === 'HIGH';
    }).length;
    const unresolved = mergedAlerts.filter((a) => (a.status || 'NEW').toUpperCase() !== 'RESOLVED').length;
    return { total, today, highSeverity, unresolved };
  }, [mergedAlerts, todayKey]);

  // Status Change Handler
  const handleStatusUpdate = async (id: string, newStatus: string) => {
    try {
      setResolvingId(id);
      await anomalyService.updateAnomalyStatus(id, newStatus);
      setLocalStatuses((prev) => ({ ...prev, [id]: newStatus }));
      if (inspectAlert && inspectAlert.id === id) {
        setInspectAlert((prev) => (prev ? { ...prev, status: newStatus } : null));
      }
      onStatusUpdate?.(id, newStatus);
    } catch (e) {
      console.error('Failed to update anomaly status:', e);
      throw e;
    } finally {
      setResolvingId(null);
    }
  };

  // Reset Filters
  const hasActiveFilters =
    selectedCamera !== 'ALL' ||
    selectedZone !== 'ALL' ||
    selectedType !== 'ALL' ||
    selectedSeverity !== 'ALL' ||
    selectedStatus !== 'ALL' ||
    Boolean(selectedDate) ||
    Boolean(searchQuery) ||
    !evidenceOnly;

  const resetFilters = () => {
    setSelectedCamera('ALL');
    setSelectedZone('ALL');
    setSelectedType('ALL');
    setSelectedSeverity('ALL');
    setSelectedStatus('ALL');
    setSelectedDate('');
    setDatePreset('ALL');
    setSearchQuery('');
    setEvidenceOnly(true);
  };

  return (
    <div className="w-full space-y-6">
      {/* ─── Top Header Section ────────────────────────────────────────── */}
      <section id="alerts-header-section" className="relative">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-4 border-b border-black/[0.08] dark:border-white/[0.08]">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-[#ef4444] animate-pulse shadow-[0_0_6px_rgba(239,68,68,0.8)]" />
              <span className="text-[11px] font-mono uppercase tracking-wider text-[#6b6b6b] dark:text-[#a1a1aa]">
                Anomaly Evidence Stream
              </span>
            </div>
            <h1
              id="alerts-main-title"
              className="text-[30px] sm:text-[38px] font-semibold text-[#0a0a0a] dark:text-[#fafafa] tracking-tightest leading-tight flex items-center gap-3"
            >
              Alerts & Evidence
            </h1>
            <p className="text-[14px] sm:text-[15px] text-[#6b6b6b] dark:text-[#a1a1aa] mt-0.5 tracking-tight">
              Review detected violations and inspect captured evidence photos from backend storage.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <Check className="h-3.5 w-3.5" />
              backend/data Connected
            </span>

            {onRefresh && (
              <button
                onClick={() => {
                  onRefresh();
                  fetchEvidenceDates();
                }}
                disabled={isLoading}
                className="flex items-center gap-1.5 rounded-xl border border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.05] px-3.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200 transition hover:bg-black/[0.06] dark:hover:bg-white/10 disabled:opacity-50"
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
            setEvidenceOnly(true);
            resetFilters();
          }}
          className="group relative cursor-pointer overflow-hidden rounded-2xl border border-black/[0.08] dark:border-white/[0.08] bg-white dark:bg-[#0f0f12] p-4 transition-all hover:border-[#f97316]/50 shadow-sm"
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
            {totalWithEvidenceCount}
          </div>
          <p className="mt-1 text-[11px] font-mono text-[#f97316]">
            {summary.total} total events captured
          </p>
        </div>

        {/* Card 2: Today */}
        <div
          onClick={() => handleDatePreset('TODAY')}
          className="group relative cursor-pointer overflow-hidden rounded-2xl border border-black/[0.08] dark:border-white/[0.08] bg-white dark:bg-[#0f0f12] p-4 transition-all hover:border-[#06b6d4]/50 shadow-sm"
        >
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-slate-500 dark:text-slate-400">
              Today
            </span>
            <div className="rounded-lg bg-[#06b6d4]/10 p-2 text-[#06b6d4]">
              <Calendar className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight text-[#06b6d4]">
            {summary.today}
          </div>
          <p className="mt-1 text-[11px] font-mono text-slate-500 dark:text-slate-400">
            Violations recorded today
          </p>
        </div>

        {/* Card 3: High Severity */}
        <div
          onClick={() => setSelectedSeverity('HIGH')}
          className="group relative cursor-pointer overflow-hidden rounded-2xl border border-black/[0.08] dark:border-white/[0.08] bg-white dark:bg-[#0f0f12] p-4 transition-all hover:border-[#ef4444]/50 shadow-sm"
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
            Critical & High hazards
          </p>
        </div>

        {/* Card 4: Unresolved */}
        <div
          onClick={() => setSelectedStatus('NEW')}
          className="group relative cursor-pointer overflow-hidden rounded-2xl border border-black/[0.08] dark:border-white/[0.08] bg-white dark:bg-[#0f0f12] p-4 transition-all hover:border-[#f59e0b]/50 shadow-sm"
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
            Pending operator action
          </p>
        </div>
      </section>

      {/* ─── Camera-based Banner View (If Camera selected) ──────────────── */}
      {selectedCameraMeta && (
        <div className="relative overflow-hidden rounded-2xl border border-[#f97316]/30 bg-gradient-to-r from-[#f97316]/10 via-[#0f1524] to-[#0a0e1a] p-4 text-white shadow-md">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#f97316]/20 text-[#f97316] border border-[#f97316]/40">
                <CameraIcon className="h-6 w-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base sm:text-lg font-bold tracking-tight text-white">
                    {selectedCameraMeta.name}
                  </h3>
                  <span className="rounded bg-[#f97316]/20 px-2 py-0.5 text-[10px] font-mono text-[#f97316]">
                    Camera Filtered
                  </span>
                </div>
                <p className="text-xs text-slate-300">
                  Zone: <span className="font-semibold text-white">{selectedCameraMeta.zone}</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="rounded-xl border border-white/10 bg-black/40 px-4 py-2 text-right">
                <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                  Evidence Photos
                </div>
                <div className="text-xl font-bold text-[#f97316]">
                  {selectedCameraMeta.violationsCount}
                </div>
              </div>

              <button
                onClick={() => setSelectedCamera('ALL')}
                className="rounded-lg border border-white/10 bg-white/5 p-2 text-slate-400 hover:bg-white/15 hover:text-white"
                title="Clear camera filter"
              >
                <X className="h-4 w-4" />
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

          {/* Date Selector Presets & Calendar Input (Integrated) */}
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Quick Date Presets */}
            <div className="flex items-center rounded-xl border border-black/10 dark:border-white/10 bg-slate-100 dark:bg-[#090b10] p-0.5">
              <button
                onClick={() => handleDatePreset('ALL')}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  !selectedDate
                    ? 'bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-xs font-semibold'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                All Dates
              </button>

              {availableDateOptions.slice(0, 3).map((ed) => {
                const isSelected = selectedDate === ed.date;
                return (
                  <button
                    key={ed.date}
                    onClick={() => {
                      setSelectedDate(ed.date);
                      setDatePreset('CUSTOM');
                    }}
                    className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                      isSelected
                        ? 'bg-white dark:bg-white/15 text-[#f97316] shadow-xs font-bold'
                        : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <span>{formatRegisteredDate(ed.date)}</span>
                    {ed.evidencePhotos > 0 && (
                      <span className="rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 px-1 py-0.2 text-[9px] font-mono font-bold">
                        {ed.evidencePhotos}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Calendar Specific Date Input */}
            <label className="flex items-center gap-1.5 rounded-xl border border-black/10 dark:border-white/10 bg-slate-50 dark:bg-[#090b10] px-2.5 py-1.5 text-xs text-slate-600 dark:text-slate-300">
              <CalendarDays className="h-3.5 w-3.5 text-[#f97316]" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => {
                  setSelectedDate(e.target.value);
                  setDatePreset('CUSTOM');
                }}
                className="bg-transparent text-xs text-slate-800 dark:text-slate-200 outline-none [color-scheme:dark]"
              />
              {selectedDate && (
                <button
                  onClick={() => {
                    setSelectedDate('');
                    setDatePreset('ALL');
                  }}
                  title="Clear date selection"
                  className="text-slate-400 hover:text-slate-900 dark:hover:text-white ml-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </label>
          </div>

          {/* Right Toolbar: View Modes + Sort */}
          <div className="flex flex-wrap items-center gap-2">
            {/* View Mode Switcher: By Camera (Default) / All Cards / Table */}
            <div className="flex items-center rounded-xl border border-black/10 dark:border-white/10 bg-slate-100 dark:bg-[#090b10] p-0.5">
              <button
                onClick={() => setViewMode('byCamera')}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
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
                onClick={() => setViewMode('grid')}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
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
                onClick={() => setViewMode('table')}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
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

            {/* Sort Order Toggle */}
            <button
              onClick={() => setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
              className="flex items-center gap-1.5 rounded-xl border border-black/10 dark:border-white/10 bg-slate-50 dark:bg-[#090b10] px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 hover:border-[#f97316]/50"
              title="Toggle sort order"
            >
              <ArrowUpDown className="h-3.5 w-3.5 text-[#f97316]" />
              <span>{sortOrder === 'desc' ? 'Newest' : 'Oldest'}</span>
            </button>
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
              <option value="NEW">New</option>
              <option value="REVIEWED">Reviewed</option>
              <option value="RESOLVED">Resolved</option>
            </select>
          </div>

          {/* Evidence Photos Only Toggle */}
          <button
            onClick={() => setEvidenceOnly((prev) => !prev)}
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
              evidenceOnly
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shadow-xs'
                : 'border-black/10 dark:border-white/10 bg-slate-50 dark:bg-[#090b10] text-slate-500 hover:text-slate-900 dark:hover:text-white'
            }`}
            title="Filter to only events with captured evidence photos"
          >
            <CameraIcon className="h-3.5 w-3.5 text-emerald-500" />
            <span>
              {evidenceOnly ? `Evidence Photos (${totalWithEvidenceCount})` : `All Logs (${mergedAlerts.length})`}
            </span>
          </button>

          {/* Reset Filters Button */}
          {hasActiveFilters && (
            <button
              onClick={resetFilters}
              className="flex items-center gap-1 rounded-xl border border-red-500/20 bg-red-500/10 px-2.5 py-1.5 text-xs font-semibold text-red-500 dark:text-red-400 hover:bg-red-500/20"
            >
              <X className="h-3.5 w-3.5" /> Clear Filters
            </button>
          )}

          {/* Match Count Badge */}
          <div className="ml-auto text-xs font-mono text-slate-500">
            Showing <span className="font-bold text-slate-900 dark:text-white">{filteredAlerts.length}</span> {evidenceOnly ? 'evidence photos' : 'events'} of {alerts.length}
          </div>
        </div>
      </section>

      {/* ─── Alerts Evidence Views ──────────────────────────────────────── */}
      {filteredAlerts.length === 0 ? (
        /* Empty State */
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-black/15 dark:border-white/10 bg-white/50 dark:bg-[#0c101c]/60 py-20 px-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.04] text-slate-400">
            <FileSearch className="h-7 w-7" />
          </div>
          <h3 className="mt-4 text-base font-bold text-slate-800 dark:text-slate-200">
            {selectedDate
              ? 'No violations recorded on this date.'
              : 'No alerts found.'}
          </h3>
          <p className="mt-1 text-xs text-slate-500 max-w-md">
            {selectedDate
              ? `No anomalous events matched the date ${formatRegisteredDate(selectedDate)}. Select another date from the ribbon or clear filters.`
              : 'No alerts match your current filter criteria. Try adjusting or clearing your filters.'}
          </p>
          {hasActiveFilters && (
            <button
              onClick={resetFilters}
              className="mt-4 rounded-xl border border-black/10 dark:border-white/10 bg-black/[0.05] dark:bg-white/[0.08] px-4 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-black/10 dark:hover:bg-white/15"
            >
              Reset All Filters
            </button>
          )}
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
                    <span className="inline-flex items-center gap-1 rounded-xl bg-[#f97316]/10 border border-[#f97316]/25 px-3 py-1 text-xs font-mono font-bold text-[#f97316]">
                      {group.alerts.length} Evidence {group.alerts.length === 1 ? 'Photo' : 'Photos'}
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

                {/* Evidence Photos Grid: Cards One by One */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 mt-4">
                  {group.alerts.map((alert) => (
                    <IncidentEvidenceCard
                      key={alert.id}
                      alert={alert}
                      onInspect={() => setInspectAlert(alert)}
                      onQuickResolve={() => handleStatusUpdate(alert.id, 'RESOLVED')}
                      isResolving={resolvingId === alert.id}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : viewMode === 'grid' ? (
        /* ─── 2. All Evidence Photos Flat Grid ───────────────────────────── */
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {filteredAlerts.map((alert) => (
            <IncidentEvidenceCard
              key={alert.id}
              alert={alert}
              onInspect={() => setInspectAlert(alert)}
              onQuickResolve={() => handleStatusUpdate(alert.id, 'RESOLVED')}
              isResolving={resolvingId === alert.id}
            />
          ))}
        </div>
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
                            <span className="font-bold text-slate-900 dark:text-white">
                              {formatAnomalyLabel(alert.anomalyType)}
                            </span>
                            <div className="text-[10px] font-mono text-slate-500">
                              Confidence: {Math.round((alert.confidence || 0) * 100)}%
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
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setInspectAlert(alert);
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-slate-100 dark:bg-white/5 px-3 py-1 text-xs font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-[#f97316] hover:text-white hover:border-[#f97316]"
                        >
                          <Eye className="h-3 w-3" /> View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
        />
      )}
    </div>
  );
};
