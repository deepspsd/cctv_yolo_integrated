import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Camera, CameraFormData, CameraTestResult } from '../types';
import { cameraService } from '../services/cameraService';
import { authService } from '../services/authService';
import { soundService } from '../services/soundService';
import { X, Eye, EyeOff, CheckCircle2, AlertCircle, Loader2, Video, Key, ShieldCheck, Cpu, Wifi, Sparkles } from 'lucide-react';

interface AddEditCameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  cameraToEdit?: Camera | null;
  existingZones: string[];
  onSaveCamera: (cameraData: CameraFormData, id?: string) => Promise<void>;
}

const DEFAULT_FACILITY_ZONES = [
  'ENTRY GATE',
  'WEAVING SECTION',
  'SPINNING FLOOR',
  'FINISHING & PACKING',
  'RAW MATERIAL WAREHOUSE',
  'DISPATCH DOCK',
  'PERIMETER NORTH',
  'SERVER ROOM',
];

export const AddEditCameraModal: React.FC<AddEditCameraModalProps> = ({
  isOpen,
  onClose,
  cameraToEdit,
  existingZones,
  onSaveCamera,
}) => {
  const isEditMode = Boolean(cameraToEdit);

  // Combine standard zones with existing zones
  const selectableZones = useMemo(() => {
    const set = new Set([...DEFAULT_FACILITY_ZONES, ...existingZones]);
    return Array.from(set);
  }, [existingZones]);

  // Form State
  const [formData, setFormData] = useState<CameraFormData>({
    name: '',
    zone: '',
    rtspUrl: '',
    username: 'admin',
    password: '',
  });

  // User Authentication Required State for Editing
  const [userLogin, setUserLogin] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [showUserPassword, setShowUserPassword] = useState(false);

  const [isCustomZone, setIsCustomZone] = useState(false);
  const [customZone, setCustomZone] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showRtspPassword, setShowRtspPassword] = useState(false);
  const [extractedNotice, setExtractedNotice] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<CameraTestResult | null>(null);

  // Track opening transitions to prevent background polling from clearing form fields
  const prevOpenRef = useRef<boolean>(false);
  const prevCameraIdRef = useRef<string | null>(null);

  // Initialize form ONLY once when modal opens or cameraToEdit ID changes
  useEffect(() => {
    const currentTargetId = cameraToEdit ? cameraToEdit.id : '__NEW_CAMERA__';
    const isOpening = isOpen && !prevOpenRef.current;
    const isSwitchingCamera = isOpen && currentTargetId !== prevCameraIdRef.current;

    prevOpenRef.current = isOpen;
    prevCameraIdRef.current = isOpen ? currentTargetId : null;

    if (!isOpen) {
      setErrors({});
      setTestResult(null);
      setIsSaving(false);
      setIsTesting(false);
      setUserLogin('');
      setUserPassword('');
      setIsCustomZone(false);
      setCustomZone('');
      return;
    }

    // Modal is already open and same camera (or new camera): DO NOT clear user input
    if (!isOpening && !isSwitchingCamera) {
      return;
    }

    if (cameraToEdit) {
      const inList = selectableZones.includes(cameraToEdit.zone);
      const credMatch = cameraToEdit.rtspUrl.match(/^(rtsps?:\/\/)(.*)@([^:\/\s]+(?::\d+)?(?:\/.*)?)$/i);
      let initUrl = cameraToEdit.rtspUrl;
      let initUser = cameraToEdit.username || 'admin';
      let initPass = '';
      if (credMatch) {
        const [, proto, userinfo, rest] = credMatch;
        const colonIdx = userinfo.indexOf(':');
        const rawUser = colonIdx !== -1 ? userinfo.slice(0, colonIdx) : userinfo;
        const rawPass = colonIdx !== -1 ? userinfo.slice(colonIdx + 1) : '';
        initUser = decodeURIComponent(rawUser) || initUser;
        initPass = decodeURIComponent(rawPass);
        initUrl = `${proto}${rest}`;
      }
      setFormData({
        name: cameraToEdit.name,
        zone: cameraToEdit.zone,
        rtspUrl: initUrl,
        username: initUser,
        password: initPass,
      });
      setShowRtspPassword(false);
      setExtractedNotice(false);
      if (inList) {
        setIsCustomZone(false);
        setCustomZone('');
      } else {
        setIsCustomZone(true);
        setCustomZone(cameraToEdit.zone);
      }
      const loggedUser = authService.getCurrentUser();
      setUserLogin(loggedUser?.email || '');
      setUserPassword('');
    } else {
      const defaultZone = selectableZones[0] || 'ENTRY GATE';
      setFormData({
        name: '',
        zone: defaultZone,
        rtspUrl: '', // Clean initial state, no mock URL
        username: 'admin',
        password: '',
      });
      setShowRtspPassword(false);
      setExtractedNotice(false);
      setIsCustomZone(false);
      setCustomZone('');
      setUserLogin('');
      setUserPassword('');
    }
  }, [isOpen, cameraToEdit?.id]);

  // Escape key closes modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isSaving) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSaving, onClose]);

  const validate = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Camera name is required.';
    }

    const effectiveZone = isCustomZone ? customZone.trim() : formData.zone.trim();
    if (!effectiveZone) {
      newErrors.zone = 'Zone name is required.';
    }

    if (!formData.rtspUrl.trim()) {
      newErrors.rtspUrl = 'RTSP URL is required.';
    } else {
      const url = formData.rtspUrl.trim().toLowerCase();
      if (!url.startsWith('rtsp://') && !url.startsWith('rtsps://')) {
        newErrors.rtspUrl = 'Please enter a valid RTSP URL (starting with rtsp:// or rtsps://).';
      }
    }

    if (!isEditMode && !formData.password) {
      newErrors.password = 'Password is required.';
    }

    if (isEditMode) {
      if (!userLogin.trim()) {
        newErrors.userLogin = 'Your login is required to authorize camera edits.';
      }
      if (!userPassword) {
        newErrors.userPassword = 'Your password is required to authorize camera edits.';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleTestConnection = async () => {
    // Validate RTSP URL first
    if (!formData.rtspUrl.trim()) {
      setErrors((prev) => ({ ...prev, rtspUrl: 'Please enter a valid RTSP URL to test.' }));
      return;
    }
    const url = formData.rtspUrl.trim().toLowerCase();
    if (!url.startsWith('rtsp://') && !url.startsWith('rtsps://')) {
      setErrors((prev) => ({
        ...prev,
        rtspUrl: 'Please enter a valid RTSP URL (e.g. rtsp://host/stream).',
      }));
      return;
    }

    const cleanTestPass = formData.password?.replace(/[•\u2022]/g, '').trim();

    // In Add mode: warn if no password provided and no inline credentials in URL
    if (!isEditMode && !cleanTestPass && !hasRtspPassword) {
      setErrors((prev) => ({
        ...prev,
        password: 'Password is required to verify live RTSP stream connection.',
      }));
      soundService.playTactileBlip(320, 0.05);
      return;
    }

    setIsTesting(true);
    setTestResult(null);
    soundService.playTactileBlip(750, 0.03);

    try {
      let res: CameraTestResult;
      if (isEditMode && cameraToEdit) {
        // Test existing camera using decrypted DB credentials (or newly entered password if provided)
        res = await cameraService.testExistingCameraConnection(cameraToEdit.id, {
          rtspUrl: formData.rtspUrl,
          username: formData.username,
          password: cleanTestPass || undefined,
        });
      } else {
        // Test ad-hoc connection for new camera
        res = await cameraService.testConnection({
          rtspUrl: formData.rtspUrl,
          username: formData.username,
          password: cleanTestPass || undefined,
        });
      }

      setTestResult(res);
      if (res.success) {
        soundService.playTactileBlip(880, 0.04);
      } else {
        soundService.playTactileBlip(320, 0.05);
      }
    } catch (err: any) {
      soundService.playTactileBlip(320, 0.05);
      setTestResult({
        success: false,
        latencyMs: 0,
        reachable: false,
        streamAvailable: false,
        details: err.message || 'RTSP handshake failed.',
        error: err.message,
      });
    } finally {
      setIsTesting(false);
    }
  };

  // Live RTSP URL syntax parser (cleansed of sensitive internal host & path leaks)
  const parsedRtsp = useMemo(() => {
    if (!formData.rtspUrl.trim()) return null;
    try {
      const match = formData.rtspUrl.trim().match(/^(rtsps?):\/\/(?:(.*)@)?([^:\/\s]+)(?::(\d+))?(\/[^\s]*)?$/i);
      if (!match) return null;
      return {
        protocol: match[1]?.toUpperCase() || 'RTSP',
        port: match[4] || '554',
      };
    } catch {
      return null;
    }
  }, [formData.rtspUrl]);

  // Check if camera has password either in formData.password or inline in URL
  const hasRtspPassword = Boolean(
    formData.password ||
    formData.rtspUrl.match(/^(rtsps?:\/\/)(?:.*)@/i)
  );

  // Compute displayed URL: masked by default with '••••••••' unless showRtspPassword is true
  const getDisplayRtspUrl = () => {
    const raw = formData.rtspUrl;
    if (!raw) return '';

    // If raw contains inline user:pass@ (matching up to last @ before host)
    const inlineMatch = raw.match(/^(rtsps?:\/\/)(.*)@([^:\/\s]+(?::\d+)?(?:\/.*)?)$/i);
    if (inlineMatch) {
      const [, proto, userinfo, rest] = inlineMatch;
      if (showRtspPassword) return raw;
      const colonIdx = userinfo.indexOf(':');
      const user = colonIdx !== -1 ? userinfo.slice(0, colonIdx) : userinfo;
      return `${proto}${user}:••••••••@${rest}`;
    }

    // If raw does not have inline password, but password exists in formData.password
    if (formData.password) {
      const protoMatch = raw.match(/^(rtsps?:\/\/)(.*)$/i);
      if (protoMatch) {
        const [, proto, rest] = protoMatch;
        const cleanRest = rest.replace(/^(?:.*)@/, '');
        const user = formData.username || 'admin';
        if (showRtspPassword) {
          return `${proto}${user}:${encodeURIComponent(formData.password)}@${cleanRest}`;
        }
        return `${proto}${user}:••••••••@${cleanRest}`;
      }
    }

    return raw;
  };

  // Handle typing or pasting with auto-extraction and stripping
  const handleRtspChange = (val: string) => {
    let processedVal = val;
    // If input had mask bullets '••••••••', substitute underlying password
    if (val.includes('••••••••') && formData.password) {
      processedVal = val.replace('••••••••', encodeURIComponent(formData.password));
    }

    // Auto-extract credentials when user pastes or types user:pass@
    const credMatch = processedVal.match(/^(rtsps?:\/\/)(.*)@([^:\/\s]+(?::\d+)?(?:\/.*)?)$/i);
    if (credMatch) {
      const [, proto, userinfo, rest] = credMatch;
      const colonIdx = userinfo.indexOf(':');
      const rawUser = colonIdx !== -1 ? userinfo.slice(0, colonIdx) : userinfo;
      const rawPass = colonIdx !== -1 ? userinfo.slice(colonIdx + 1) : '';
      const cleanUser = decodeURIComponent(rawUser);
      const cleanPass = decodeURIComponent(rawPass);

      setFormData((prev) => ({
        ...prev,
        username: cleanUser || prev.username || 'admin',
        password: cleanPass || prev.password,
        rtspUrl: `${proto}${rest}`, // strip password and credentials from stored base URL
      }));
      setExtractedNotice(true);
      if (errors.rtspUrl) setErrors((prev) => ({ ...prev, rtspUrl: '' }));
      if (errors.password) setErrors((prev) => ({ ...prev, password: '' }));
      setTestResult(null);
      return;
    }

    setFormData((prev) => ({ ...prev, rtspUrl: processedVal }));
    if (errors.rtspUrl) setErrors((prev) => ({ ...prev, rtspUrl: '' }));
    setTestResult(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setIsSaving(true);
    const effectiveZone = isCustomZone ? customZone.toUpperCase().trim() : formData.zone.toUpperCase().trim();

    const cleanCameraPass = formData.password?.replace(/[•\u2022]/g, '').trim() || undefined;

    try {
      await onSaveCamera(
        {
          name: formData.name,
          zone: effectiveZone,
          rtspUrl: formData.rtspUrl,
          username: formData.username,
          password: cleanCameraPass,
          userLogin: isEditMode ? userLogin.trim() : undefined,
          userPassword: isEditMode ? userPassword : undefined,
        },
        cameraToEdit ? cameraToEdit.id : undefined
      );
      soundService.playTactileBlip(850, 0.04);
      onClose();
    } catch (err: any) {
      setErrors((prev) => ({
        ...prev,
        form: err.message || 'Failed to save camera. Please retry.',
      }));
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      id="add-edit-camera-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs transition-opacity"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div
        className="w-full max-w-[540px] bg-white dark:bg-[#111115] border border-black/[0.1] dark:border-white/[0.1] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-black/[0.08] dark:border-white/[0.08] flex items-center justify-between bg-[#fafafa] dark:bg-[#15151b]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-black dark:bg-orange-500 text-white dark:text-black flex items-center justify-center">
              <Video className="w-4 h-4" />
            </div>
            <div>
              <h3 id="modal-title" className="text-[18px] font-semibold text-[#0a0a0a] dark:text-white tracking-tight">
                {isEditMode ? `Edit Camera: ${cameraToEdit?.code}` : 'Add New Camera'}
              </h3>
              <p className="text-[12px] text-[#6b6b6b] dark:text-[#a1a1aa] tracking-tight">
                Configure RTSP credentials and facility zone assignment
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={isSaving}
            className="p-1.5 text-[#6b6b6b] dark:text-[#a1a1aa] hover:text-black dark:hover:text-white rounded-lg hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Form Content */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4">
          {/* General Form Error if any */}
          {errors.form && (
            <div className="p-3 bg-[#ef4444]/10 border border-[#ef4444]/20 rounded-lg text-[13px] text-[#b91c1c] dark:text-[#f87171] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errors.form}</span>
            </div>
          )}

          {/* Camera Name */}
          <div>
            <label
              htmlFor="camera-name-input"
              className="block text-[13px] font-medium text-[#0a0a0a] dark:text-white mb-1.5 tracking-tight"
            >
              Camera Name <span className="text-[#ef4444]">*</span>
            </label>
            <input
              id="camera-name-input"
              type="text"
              value={formData.name}
              onChange={(e) => {
                setFormData({ ...formData, name: e.target.value });
                if (errors.name) setErrors({ ...errors, name: '' });
              }}
              placeholder="e.g. Camera 05 - Packing Station"
              disabled={isSaving}
              className={`w-full px-3.5 py-2 text-[14px] bg-white dark:bg-[#181820] border rounded-lg text-[#0a0a0a] dark:text-white placeholder-[#8c8c8c] dark:placeholder-[#71717a] tracking-tight focus:outline-none focus:ring-1 transition-all ${
                errors.name
                  ? 'border-[#ef4444] focus:border-[#ef4444] focus:ring-[#ef4444]'
                  : 'border-black/[0.15] dark:border-white/[0.15] focus:border-black dark:focus:border-orange-500 focus:ring-black dark:focus:ring-orange-500/30'
              }`}
            />
            {errors.name && (
              <p className="mt-1 text-[12px] text-[#ef4444] font-medium tracking-tight">
                {errors.name}
              </p>
            )}
          </div>

          {/* Zone Selector */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor={isCustomZone ? 'camera-custom-zone-input' : 'camera-zone-select'}
                className="block text-[13px] font-medium text-[#0a0a0a] dark:text-white tracking-tight"
              >
                Zone <span className="text-[#ef4444]">*</span>
              </label>
              <button
                type="button"
                onClick={() => {
                  const next = !isCustomZone;
                  setIsCustomZone(next);
                  if (!next && !formData.zone && selectableZones.length > 0) {
                    setFormData((prev) => ({ ...prev, zone: selectableZones[0] }));
                  }
                  if (errors.zone) setErrors((prev) => ({ ...prev, zone: '' }));
                }}
                className="text-[12px] font-medium text-orange-600 dark:text-orange-400 hover:underline cursor-pointer tracking-tight"
              >
                {isCustomZone ? '← Choose from standard zones' : '+ Add new zone'}
              </button>
            </div>

            {isCustomZone ? (
              <div>
                <input
                  id="camera-custom-zone-input"
                  type="text"
                  value={customZone}
                  onChange={(e) => {
                    setCustomZone(e.target.value);
                    if (errors.zone) setErrors((prev) => ({ ...prev, zone: '' }));
                  }}
                  autoFocus
                  placeholder="ENTER CUSTOM ZONE NAME (E.G. BOILER ROOM)"
                  className={`w-full px-3.5 py-2 text-[14px] bg-white dark:bg-[#181820] border rounded-lg text-[#0a0a0a] dark:text-white tracking-tight focus:outline-none focus:ring-1 transition-all uppercase ${
                    errors.zone
                      ? 'border-[#ef4444] focus:border-[#ef4444] focus:ring-[#ef4444]'
                      : 'border-black/[0.15] dark:border-white/[0.15] focus:border-black dark:focus:border-orange-500 focus:ring-black dark:focus:ring-orange-500/30'
                  }`}
                />
                <p className="mt-1 text-[11px] text-black/50 dark:text-white/50 tracking-tight">
                  New zone will be saved with this camera and available across all filters.
                </p>
              </div>
            ) : (
              <select
                id="camera-zone-select"
                value={formData.zone}
                onChange={(e) => {
                  if (e.target.value === 'NEW_ZONE') {
                    setIsCustomZone(true);
                    setCustomZone('');
                  } else {
                    setFormData({ ...formData, zone: e.target.value });
                  }
                  if (errors.zone) setErrors((prev) => ({ ...prev, zone: '' }));
                }}
                disabled={isSaving}
                className={`w-full px-3.5 py-2 text-[14px] bg-white dark:bg-[#181820] border rounded-lg text-[#0a0a0a] dark:text-white tracking-tight focus:outline-none focus:ring-1 transition-all ${
                  errors.zone
                    ? 'border-[#ef4444] focus:border-[#ef4444] focus:ring-[#ef4444]'
                    : 'border-black/[0.15] dark:border-white/[0.15] focus:border-black dark:focus:border-orange-500 focus:ring-black dark:focus:ring-orange-500/30'
                }`}
              >
                <option value="" disabled>
                  Select Zone ▼
                </option>
                {selectableZones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
                <option value="NEW_ZONE">+ Add New Zone...</option>
              </select>
            )}

            {errors.zone && (
              <p className="mt-1 text-[12px] text-[#ef4444] font-medium tracking-tight">
                {errors.zone}
              </p>
            )}
          </div>

          {/* RTSP URL */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="camera-rtsp-input"
                className="block text-[13px] font-medium text-[#0a0a0a] dark:text-white tracking-tight"
              >
                RTSP URL <span className="text-[#ef4444]">*</span>
              </label>
              {hasRtspPassword && (
                <span className="text-[11px] text-[#8c8c8c] dark:text-[#a1a1aa] flex items-center gap-1">
                  {showRtspPassword ? 'Password revealed' : 'Password masked by default'}
                </span>
              )}
            </div>

            {/* Quick Brand Presets */}
            <div className="mb-2 flex items-center gap-1.5 flex-wrap">
              <span className="text-[10.5px] font-mono text-[#8c8c8c] dark:text-[#71717a] mr-0.5">Presets:</span>
              {[
                { name: 'Hikvision NVR', url: 'rtsp://192.168.100.201:554/Streaming/Channels/101' },
                { name: 'Dahua', url: 'rtsp://192.168.1.108:554/cam/realmonitor?channel=1&subtype=0' },
                { name: 'Uniview', url: 'rtsp://192.168.1.120:554/unicast/c1/s0/live' },
                { name: 'Axis', url: 'rtsp://192.168.1.150:554/axis-media/media.amp' },
              ].map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => {
                    soundService.playTactileBlip(700, 0.02);
                    setFormData((prev) => ({ ...prev, rtspUrl: p.url }));
                    if (errors.rtspUrl) setErrors((prev) => ({ ...prev, rtspUrl: '' }));
                  }}
                  className="px-2 py-0.5 rounded text-[10.5px] font-mono bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.12] text-[#6b6b6b] dark:text-[#a1a1aa] hover:text-black dark:hover:text-orange-400 border border-black/[0.05] dark:border-white/[0.08] transition-colors cursor-pointer"
                >
                  +{p.name}
                </button>
              ))}
            </div>
            <div className="relative">
              <input
                id="camera-rtsp-input"
                type="text"
                value={getDisplayRtspUrl()}
                onChange={(e) => handleRtspChange(e.target.value)}
                placeholder="rtsp://admin:password@192.168.1.10:554/live/ch0"
                disabled={isSaving}
                className={`w-full pl-3.5 pr-10 py-2 text-[13px] font-mono bg-white dark:bg-[#181820] border rounded-lg text-[#0a0a0a] dark:text-white placeholder-[#8c8c8c] dark:placeholder-[#71717a] tracking-tight focus:outline-none focus:ring-1 transition-all ${
                  errors.rtspUrl
                    ? 'border-[#ef4444] focus:border-[#ef4444] focus:ring-[#ef4444]'
                    : 'border-black/[0.15] dark:border-white/[0.15] focus:border-black dark:focus:border-orange-500 focus:ring-black dark:focus:ring-orange-500/30'
                }`}
              />
              {hasRtspPassword && (
                <button
                  type="button"
                  onClick={() => setShowRtspPassword(!showRtspPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#8c8c8c] hover:text-black dark:hover:text-white cursor-pointer transition-colors"
                  title={showRtspPassword ? 'Hide RTSP credentials' : 'Show RTSP credentials'}
                  aria-label={showRtspPassword ? 'Hide RTSP credentials' : 'Show RTSP credentials'}
                >
                  {showRtspPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              )}
            </div>
            {errors.rtspUrl && (
              <p className="mt-1 text-[12px] text-[#ef4444] font-medium tracking-tight">
                {errors.rtspUrl}
              </p>
            )}

            {/* Clean RTSP URL Inspector Chips (Protocol & Port only; no sensitive host IP/path leak) */}
            {parsedRtsp && !errors.rtspUrl && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
                <span className="px-2 py-0.5 rounded bg-black/5 dark:bg-white/10 text-[#6b6b6b] dark:text-[#a1a1aa] flex items-center gap-1">
                  <Wifi className="w-3 h-3 text-orange-500" />
                  {parsedRtsp.protocol}
                </span>
                <span className="px-2 py-0.5 rounded bg-black/5 dark:bg-white/10 text-[#6b6b6b] dark:text-[#a1a1aa]">
                  Port: {parsedRtsp.port}
                </span>
                <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-sans text-[10.5px] font-medium flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Valid RTSP Syntax
                </span>
                {extractedNotice && (
                  <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-sans text-[10.5px] font-medium flex items-center gap-1 animate-in fade-in duration-150">
                    <CheckCircle2 className="w-3 h-3" /> Credentials safely auto-extracted
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Username (and Password only in Add mode) */}
          <div className={isEditMode ? '' : 'grid grid-cols-1 sm:grid-cols-2 gap-3'}>
            <div>
              <label
                htmlFor="camera-username-input"
                className="block text-[13px] font-medium text-[#0a0a0a] dark:text-white mb-1.5 tracking-tight"
              >
                Username
              </label>
              <input
                id="camera-username-input"
                type="text"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                placeholder="admin"
                disabled={isSaving}
                className="w-full px-3.5 py-2 text-[14px] bg-white dark:bg-[#181820] border border-black/[0.15] dark:border-white/[0.15] rounded-lg text-[#0a0a0a] dark:text-white tracking-tight focus:outline-none focus:border-black dark:focus:border-orange-500 focus:ring-1 focus:ring-black dark:focus:ring-orange-500/30"
              />
            </div>

            {!isEditMode && (
              <div>
                <label
                  htmlFor="camera-password-input"
                  className="block text-[13px] font-medium text-[#0a0a0a] dark:text-white mb-1.5 tracking-tight"
                >
                  Password <span className="text-[#ef4444]">*</span>
                </label>
                <div className="relative">
                  <input
                    id="camera-password-input"
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={(e) => {
                      setFormData({ ...formData, password: e.target.value });
                      if (errors.password) setErrors({ ...errors, password: '' });
                    }}
                    placeholder="Enter camera password"
                    disabled={isSaving}
                    className={`w-full pl-3.5 pr-10 py-2 text-[14px] bg-white dark:bg-[#181820] border rounded-lg text-[#0a0a0a] dark:text-white placeholder-[#8c8c8c] dark:placeholder-[#71717a] tracking-tight focus:outline-none focus:ring-1 transition-all ${
                      errors.password
                        ? 'border-[#ef4444] focus:border-[#ef4444] focus:ring-[#ef4444]'
                        : 'border-black/[0.15] dark:border-white/[0.15] focus:border-black dark:focus:border-orange-500 focus:ring-black dark:focus:ring-orange-500/30'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#8c8c8c] hover:text-black dark:hover:text-white cursor-pointer"
                    title={showPassword ? 'Hide password' : 'Show password'}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {errors.password && (
                  <p className="mt-1 text-[12px] text-[#ef4444] font-medium tracking-tight">
                    {errors.password}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Security Re-Authentication required when editing camera */}
          {isEditMode && (
            <div className="p-4 rounded-xl border border-orange-500/30 bg-orange-500/5 dark:bg-orange-500/10 space-y-3 animate-in fade-in duration-150">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-orange-500 text-black flex items-center justify-center font-bold">
                  <Key className="w-3.5 h-3.5" />
                </div>
                <div>
                  <h4 className="text-[13px] font-semibold text-[#0a0a0a] dark:text-white tracking-tight">
                    Security Authorization Required
                  </h4>
                  <p className="text-[11px] text-[#6b6b6b] dark:text-[#a1a1aa] tracking-tight">
                    Enter your operator/admin login and password to authorize edits to the current system.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label
                    htmlFor="user-auth-login"
                    className="block text-[12px] font-medium text-[#0a0a0a] dark:text-white mb-1 tracking-tight"
                  >
                    Your Login Email / Name <span className="text-[#ef4444]">*</span>
                  </label>
                  <input
                    id="user-auth-login"
                    type="text"
                    value={userLogin}
                    onChange={(e) => {
                      setUserLogin(e.target.value);
                      if (errors.userLogin) setErrors({ ...errors, userLogin: '' });
                    }}
                    placeholder="officer@cameye.internal"
                    disabled={isSaving}
                    required
                    className={`w-full px-3 py-1.5 text-[13px] bg-white dark:bg-[#181820] border rounded-lg text-[#0a0a0a] dark:text-white placeholder-[#8c8c8c] dark:placeholder-[#71717a] tracking-tight focus:outline-none focus:ring-1 transition-all ${
                      errors.userLogin
                        ? 'border-[#ef4444] focus:border-[#ef4444] focus:ring-[#ef4444]'
                        : 'border-black/[0.15] dark:border-white/[0.15] focus:border-orange-500 focus:ring-orange-500/30'
                    }`}
                  />
                  {errors.userLogin && (
                    <p className="mt-1 text-[11px] text-[#ef4444] font-medium tracking-tight">
                      {errors.userLogin}
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="user-auth-password"
                    className="block text-[12px] font-medium text-[#0a0a0a] dark:text-white mb-1 tracking-tight"
                  >
                    Your Account Password <span className="text-[#ef4444]">*</span>
                  </label>
                  <div className="relative">
                    <input
                      id="user-auth-password"
                      type={showUserPassword ? 'text' : 'password'}
                      value={userPassword}
                      onChange={(e) => {
                        setUserPassword(e.target.value);
                        if (errors.userPassword) setErrors({ ...errors, userPassword: '' });
                      }}
                      placeholder="Enter account password"
                      disabled={isSaving}
                      required
                      className={`w-full pl-3 pr-8 py-1.5 text-[13px] bg-white dark:bg-[#181820] border rounded-lg text-[#0a0a0a] dark:text-white placeholder-[#8c8c8c] dark:placeholder-[#71717a] tracking-tight focus:outline-none focus:ring-1 transition-all ${
                        errors.userPassword
                          ? 'border-[#ef4444] focus:border-[#ef4444] focus:ring-[#ef4444]'
                          : 'border-black/[0.15] dark:border-white/[0.15] focus:border-orange-500 focus:ring-orange-500/30'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowUserPassword(!showUserPassword)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#8c8c8c] hover:text-black dark:hover:text-white cursor-pointer"
                      title={showUserPassword ? 'Hide password' : 'Show password'}
                    >
                      {showUserPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  {errors.userPassword && (
                    <p className="mt-1 text-[11px] text-[#ef4444] font-medium tracking-tight">
                      {errors.userPassword}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Test Connection Feedback */}
          {testResult && (() => {
            const isAuthIssue = !testResult.success && testResult.reachable && (
              testResult.error?.toLowerCase().includes('auth') ||
              testResult.details?.toLowerCase().includes('auth')
            );
            return (
              <div
                className={`p-3.5 rounded-xl border text-[12px] space-y-1.5 transition-all ${
                  testResult.success
                    ? 'bg-[#17c964]/10 border-[#17c964]/30 text-[#0d7d3d] dark:text-[#22c55e]'
                    : isAuthIssue
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300'
                    : 'bg-[#ef4444]/10 border-[#ef4444]/30 text-[#b91c1c] dark:text-[#f87171]'
                }`}
              >
                <div className="flex items-center gap-2 font-semibold">
                  {testResult.success ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0" />
                  )}
                  <span>
                    {testResult.success
                      ? 'RTSP Live Stream Verified (Online)'
                      : isAuthIssue
                      ? 'Host Reachable • Authentication Required'
                      : 'Stream Offline (No Live Feed)'}
                  </span>
                  {testResult.latencyMs > 0 && (
                    <span className="ml-auto font-mono text-[11px] opacity-80">
                      {testResult.latencyMs}ms RTT
                    </span>
                  )}
                </div>
                
                <p className="text-[11.5px] opacity-90 pl-6 leading-relaxed">
                  {testResult.details}
                </p>

                <div className="pl-6 pt-1 flex flex-wrap gap-2 text-[10.5px] font-mono opacity-85">
                  <span className={`px-2 py-0.5 rounded ${testResult.reachable ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-red-500/15 text-red-700 dark:text-red-300'}`}>
                    Host: {testResult.reachable ? 'Reachable' : 'Unreachable'}
                  </span>
                  <span className={`px-2 py-0.5 rounded ${
                    testResult.streamAvailable 
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' 
                      : isAuthIssue
                      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                      : 'bg-red-500/15 text-red-700 dark:text-red-300'
                  }`}>
                    Live Feed: {testResult.streamAvailable ? 'Active Stream' : isAuthIssue ? 'Auth Required' : 'Offline / Unavailable'}
                  </span>
                  {testResult.codec && (
                    <span className="px-2 py-0.5 rounded bg-black/5 dark:bg-white/10">
                      Codec: {testResult.codec}
                    </span>
                  )}
                  {testResult.resolution && (
                    <span className="px-2 py-0.5 rounded bg-black/5 dark:bg-white/10">
                      Res: {testResult.resolution}
                    </span>
                  )}
                  {testResult.fps && (
                    <span className="px-2 py-0.5 rounded bg-black/5 dark:bg-white/10">
                      FPS: {testResult.fps}
                    </span>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Modal Action Buttons: [ Cancel ] [ Test Connection ] [ Save Camera ] */}
          <div className="pt-4 border-t border-black/[0.08] dark:border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              id="test-connection-btn"
              onClick={handleTestConnection}
              disabled={isTesting || isSaving}
              className="px-4 py-2 border border-black/[0.15] dark:border-white/[0.15] hover:bg-black/[0.03] dark:hover:bg-white/[0.05] text-[#0a0a0a] dark:text-white rounded-lg text-[13px] font-medium tracking-tight transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
            >
              {isTesting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Testing...</span>
                </>
              ) : (
                <span>Test Connection</span>
              )}
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                id="cancel-camera-btn"
                onClick={onClose}
                disabled={isSaving}
                className="px-4 py-2 text-[#6b6b6b] dark:text-[#a1a1aa] hover:text-[#0a0a0a] dark:hover:text-white text-[13px] font-medium tracking-tight transition-colors cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="submit"
                id="save-camera-btn"
                disabled={isSaving}
                className="px-5 py-2 bg-[#0a0a0a] dark:bg-orange-500 hover:bg-black/80 dark:hover:bg-orange-400 text-white dark:text-black font-semibold rounded-lg text-[13px] tracking-tight transition-all cursor-pointer flex items-center gap-2 disabled:opacity-60 active:scale-98"
              >
                {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{isSaving ? 'Saving...' : 'Save Camera'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
