import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Camera, CameraFormData, CameraStatus, CameraSummary, StatusFilter, Toast, AppView, User, AnomalyAlertEvent } from './types';
import { cameraService, cameraWebSocket } from './services/cameraService';
import { authService } from './services/authService';
import { anomalyService } from './services/anomalyService';
import { Navbar } from './components/Navbar';
import { LoginPage } from './components/LoginPage';
import { RegisterPage } from './components/RegisterPage';
import { AlertsPage } from './components/AlertsPage';
import { AttendancePage } from './components/AttendancePage';
import { EmployeesPage } from './components/EmployeesPage';
import { CameraSummaryCards } from './components/CameraSummaryCards';
import { CameraControls } from './components/CameraControls';
import { CameraTable } from './components/CameraTable';
import { CameraViewerDrawer } from './components/CameraViewerDrawer';
import { AddEditCameraModal } from './components/AddEditCameraModal';
import { DeleteCameraDialog } from './components/DeleteCameraDialog';
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal';
import { FacilityZonesModal } from './components/FacilityZonesModal';
import { GatewayStatusModal } from './components/GatewayStatusModal';
import { CameraLoadingSkeleton } from './components/CameraLoadingSkeleton';
import { CameraEmptyState } from './components/CameraEmptyState';
import { ToastContainer } from './components/ToastContainer';
import { DecorativeCurvedLines } from './components/DecorativeCurvedLines';
import { MarqueeTicker } from './components/MarqueeTicker';
import { SurveillanceGridCard } from './components/SurveillanceGridCard';
import { soundService } from './services/soundService';
import {
  Plus,
  RefreshCw,
  AlertCircle,
  ShieldCheck,
  Video,
  Play,
  Pencil,
  Trash2,
  ExternalLink,
  Wifi,
  WifiOff,
  Radio,
  Maximize2,
  Command,
} from 'lucide-react';

function getViewFromPath(pathname: string, isLoggedIn: boolean): AppView {
  const clean = pathname.toLowerCase().replace(/^\/+|\/+$/g, '');
  if (!isLoggedIn) {
    return clean === 'register' ? 'register' : 'login';
  }
  if (clean === 'alerts' || clean === 'evidence') return 'alerts';
  if (clean === 'attendance') return 'attendance';
  if (clean === 'employees' || clean === 'staff') return 'employees';
  if (clean === 'login') return 'login';
  if (clean === 'register') return 'register';
  return 'cameras';
}

function getPathFromView(view: AppView): string {
  switch (view) {
    case 'alerts': return '/alerts';
    case 'attendance': return '/attendance';
    case 'employees': return '/employees';
    case 'login': return '/login';
    case 'register': return '/register';
    case 'cameras':
    default:
      return '/';
  }
}

export default function App() {
  // Navigation & Auth States — synchronized with browser URL
  const [currentUser, setCurrentUser] = useState<User | null>(() => authService.getCurrentUser());
  const [currentView, setCurrentView] = useState<AppView>(() =>
    getViewFromPath(window.location.pathname, authService.isLoggedIn())
  );

  // Dark Mode Theme State (Matt Black + Cyber Orange Accents)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('cameye_theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return 'dark'; // Default to awesome dark matt black mode as requested
  });

  const isDark = theme === 'dark';

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem('cameye_theme', next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  // Browser history & URL synchronization
  useEffect(() => {
    const handlePopState = () => {
      const view = getViewFromPath(window.location.pathname, authService.isLoggedIn());
      setCurrentView(view);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Sync browser URL bar when active view changes
  useEffect(() => {
    const targetPath = getPathFromView(currentView);
    if (window.location.pathname !== targetPath) {
      window.history.pushState({ view: currentView }, '', targetPath);
    }
  }, [currentView]);

  // Main Data States
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [apiError, setApiError] = useState<string | null>(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedZone, setSelectedZone] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<StatusFilter>('All');
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable');

  // Modal dialog states
  const [isShortcutsOpen, setIsShortcutsOpen] = useState<boolean>(false);
  const [isZonesOpen, setIsZonesOpen] = useState<boolean>(false);
  const [isGatewayOpen, setIsGatewayOpen] = useState<boolean>(false);

  // Live Viewer State (On-Demand)
  const [selectedCamera, setSelectedCamera] = useState<Camera | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState<boolean>(false);

  // Add / Edit Modal State
  const [isAddEditOpen, setIsAddEditOpen] = useState<boolean>(false);
  const [cameraToEdit, setCameraToEdit] = useState<Camera | null>(null);

  // Delete Dialog State
  const [isDeleteOpen, setIsDeleteOpen] = useState<boolean>(false);
  const [cameraToDelete, setCameraToDelete] = useState<Camera | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  // Toasts
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Real-time AI Anomaly Alerts & Evidence Snapshots
  const [alerts, setAlerts] = useState<AnomalyAlertEvent[]>([]);

  const addToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    setToasts((prev) => [...prev, { id, message, type, timestamp: Date.now() }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3800);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Fetch Anomaly Alerts & Evidence
  const loadAlerts = useCallback(async () => {
    if (!authService.isLoggedIn()) return;
    try {
      const data = await anomalyService.getAnomalies({ limit: 500 });
      setAlerts(data);
    } catch (err: any) {
      console.error('Failed to load anomaly alerts:', err);
    }
  }, []);

  // Fetch Cameras Initial Load — only when authenticated
  const loadCameras = useCallback(async () => {
    if (!authService.isLoggedIn()) return;
    setIsLoading(true);
    setApiError(null);
    try {
      const data = await cameraService.getAllCameras();
      setCameras(data);
      loadAlerts();
    } catch (err: any) {
      if (err.message?.includes('Session expired')) {
        handleForceLogout();
        return;
      }
      setApiError(err.message || 'Failed to connect to CCTV camera gateway.');
    } finally {
      setIsLoading(false);
    }
  }, [loadAlerts]);

  useEffect(() => {
    if (authService.isLoggedIn()) {
      loadCameras();
      loadAlerts();
    }
  }, [loadCameras, loadAlerts]);

  // Force logout helper — used by AUTH_EXPIRED and 401 errors
  const handleForceLogout = useCallback(() => {
    authService.logout();
    cameraWebSocket.disconnect();
    setCameras([]);
    setCurrentUser(null);
    setCurrentView('login');
    setIsViewerOpen(false);
    setSelectedCamera(null);
    addToast('Session expired. Please log in again.', 'error');
  }, [addToast]);

  // Subscribe to Real-Time WebSocket Updates (/ws/cameras)
  useEffect(() => {
    const unsubscribe = cameraWebSocket.subscribe((event) => {
      if (event.type === 'AUTH_EXPIRED') {
        handleForceLogout();
        return;
      }
      if (event.type === 'CAMERA_STATUS_UPDATE') {
        const { id, status, lastChecked, lastOnline } = event.payload;
        setCameras((prev) =>
          prev.map((cam) =>
            cam.id === id ? { ...cam, status, lastChecked, lastOnline } : cam
          )
        );
        setSelectedCamera((current) => {
          if (current && current.id === id) {
            return { ...current, status, lastChecked, lastOnline };
          }
          return current;
        });
      } else if (event.type === 'CAMERA_CREATED') {
        if (!event.payload?.userId || (currentUser && event.payload.userId === currentUser.id)) {
          setCameras((prev) => [event.payload, ...prev]);
        }
      } else if (event.type === 'CAMERA_UPDATED') {
        setCameras((prev) =>
          prev.map((cam) => (cam.id === event.payload.id ? event.payload : cam))
        );
        setSelectedCamera((current) =>
          current && current.id === event.payload.id ? event.payload : current
        );
      } else if (event.type === 'CAMERA_DELETED') {
        setCameras((prev) => prev.filter((cam) => cam.id !== event.payload.id));
        setSelectedCamera((current) =>
          current && current.id === event.payload.id ? null : current
        );
      } else if (event.type === 'CAMERAS_RESET') {
        setCameras(event.payload);
      } else if (event.type === 'CAMERA_AI_UPDATE') {
        const aiState = event.payload;
        setCameras((prev) =>
          prev.map((cam) =>
            cam.id === aiState.cameraId ? { ...cam, aiState } : cam
          )
        );
        setSelectedCamera((current) => {
          if (current && current.id === aiState.cameraId) {
            return { ...current, aiState };
          }
          return current;
        });
      } else if (event.type === 'ATTENDANCE_UPDATE') {
        const att = event.payload;
        soundService.playTactileBlip(920, 0.02);
        addToast(`✅ Attendance Clocked: ${att.employeeName || 'Staff'} (${att.status || 'PRESENT'})`, 'info');
      } else if (event.type === 'CAMERA_ANOMALY_ALERT') {
        const raw = event.payload;
        const newAlert: AnomalyAlertEvent = {
          id: raw.id || `evt_${Date.now()}`,
          cameraId: raw.cameraId || raw.camera_id || '',
          cameraName: raw.cameraName || raw.camera_name || raw.cameraId || raw.camera_id || '',
          zone: raw.zone || 'General Facility',
          eventCategory: raw.eventCategory || raw.event_category || 'VIOLATION',
          anomalyType: raw.anomalyType || raw.anomaly_type || 'ANOMALY',
          modelClassId: raw.modelClassId ?? raw.model_class_id,
          modelClassName: raw.modelClassName || raw.model_class_name,
          confidence: raw.confidence ?? 0.85,
          severity: raw.severity || (raw.anomaly_type && (raw.anomaly_type.includes('NO_') || raw.anomaly_type.includes('HAZARD')) ? 'HIGH' : 'MEDIUM'),
          trackId: raw.trackId ?? raw.track_id,
          firstSeenAt: raw.firstSeenAt || raw.first_seen_at || new Date().toISOString(),
          confirmedAt: raw.confirmedAt || raw.confirmed_at || raw.timestamp || new Date().toISOString(),
          endedAt: raw.endedAt || raw.ended_at,
          durationSeconds: raw.durationSeconds ?? raw.duration_seconds,
          status: raw.status || 'NEW',
          snapshotPath: raw.snapshotPath || raw.snapshot_path || null,
          createdAt: raw.createdAt || raw.created_at || raw.confirmed_at || new Date().toISOString(),
        };

        soundService.playAlert();
        setAlerts((prev) => {
          if (prev.some((a) => a.id === newAlert.id)) return prev;
          return [newAlert, ...prev];
        });
        addToast(`🚨 AI Alert: ${newAlert.anomalyType} on ${newAlert.cameraName}!`, 'error');
      }
    });

    return () => { unsubscribe(); };
  }, [handleForceLogout]);

  // Dynamically derived summary stats
  const summary: CameraSummary = useMemo(() => {
    const total = cameras.length;
    const online = cameras.filter((c) => c.status === 'ONLINE').length;
    const offline = cameras.filter((c) => c.status === 'OFFLINE').length;
    const currentlyViewing = isViewerOpen && selectedCamera ? 1 : 0;
    return { total, online, offline, currentlyViewing };
  }, [cameras, isViewerOpen, selectedCamera]);

  // Dynamically populated zones
  const availableZones = useMemo(() => {
    const zoneSet = new Set<string>();
    cameras.forEach((c) => {
      if (c.zone) zoneSet.add(c.zone);
    });
    return Array.from(zoneSet).sort();
  }, [cameras]);

  // Filtered cameras based on search and dropdown selections
  const filteredCameras = useMemo(() => {
    return cameras.filter((cam) => {
      // 1. Search filter (camera name, code, zone, or IP)
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesName = cam.name.toLowerCase().includes(query);
        const matchesCode = cam.code.toLowerCase().includes(query);
        const matchesZone = cam.zone.toLowerCase().includes(query);
        const matchesIp = cam.ip.toLowerCase().includes(query);
        if (!matchesName && !matchesCode && !matchesZone && !matchesIp) {
          return false;
        }
      }

      // 2. Zone filter
      if (selectedZone !== 'ALL' && cam.zone !== selectedZone) {
        return false;
      }

      // 3. Status filter
      if (selectedStatus !== 'All' && cam.status !== selectedStatus) {
        return false;
      }

      return true;
    }).sort((a, b) => {
      const extractNum = (name: string, code?: string): number => {
        const matchName = name.match(/\d+/);
        if (matchName) return parseInt(matchName[0], 10);
        if (code) {
          const matchCode = code.match(/\d+/);
          if (matchCode) return parseInt(matchCode[0], 10);
        }
        return 999999;
      };
      const numA = extractNum(a.name, a.code);
      const numB = extractNum(b.name, b.code);
      if (numA !== numB) return numA - numB;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [cameras, searchQuery, selectedZone, selectedStatus]);

  // Handler to open on-demand live viewer (Row, Name, Status, or View button)
  const handleSelectCamera = useCallback((camera: Camera) => {
    setSelectedCamera(camera);
    setIsViewerOpen(true);
  }, []);

  const handleCloseViewer = useCallback(() => {
    setIsViewerOpen(false);
    setSelectedCamera(null);
  }, []);

  // Camera drawer cycling
  const currentCameraIndex = useMemo(() => {
    if (!selectedCamera) return -1;
    return filteredCameras.findIndex((c) => c.id === selectedCamera.id);
  }, [selectedCamera, filteredCameras]);

  const handleNextCamera = useCallback(() => {
    if (filteredCameras.length === 0) return;
    if (currentCameraIndex === -1) {
      setSelectedCamera(filteredCameras[0]);
    } else {
      const nextIdx = (currentCameraIndex + 1) % filteredCameras.length;
      setSelectedCamera(filteredCameras[nextIdx]);
    }
  }, [currentCameraIndex, filteredCameras]);

  const handlePrevCamera = useCallback(() => {
    if (filteredCameras.length === 0) return;
    if (currentCameraIndex === -1) {
      setSelectedCamera(filteredCameras[filteredCameras.length - 1]);
    } else {
      const prevIdx = (currentCameraIndex - 1 + filteredCameras.length) % filteredCameras.length;
      setSelectedCamera(filteredCameras[prevIdx]);
    }
  }, [currentCameraIndex, filteredCameras]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable;

      // Escape always closes any open top-level modal/viewer
      if (e.key === 'Escape') {
        if (isShortcutsOpen) {
          setIsShortcutsOpen(false);
          return;
        }
        if (isZonesOpen) {
          setIsZonesOpen(false);
          return;
        }
        if (isGatewayOpen) {
          setIsGatewayOpen(false);
          return;
        }
      }

      // Ignore remaining hotkeys if inside text input
      if (isInput) return;

      // Focus search: '/' or 'Ctrl+K' / 'Meta+K'
      if (e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        const searchInput = document.getElementById('camera-search-input') as HTMLInputElement | null;
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
        return;
      }

      // Toggle shortcuts modal: '?'
      if (e.key === '?') {
        e.preventDefault();
        setIsShortcutsOpen((prev) => !prev);
        return;
      }

      // Toggle view mode: 'v' or 'V'
      if (e.key.toLowerCase() === 'v') {
        e.preventDefault();
        setViewMode((prev) => (prev === 'table' ? 'grid' : 'table'));
        return;
      }

      // Quick add camera: 'n' or 'N' (only on camera screen)
      if (e.key.toLowerCase() === 'n' && currentView === 'cameras' && !isViewerOpen && !isAddEditOpen && !isDeleteOpen) {
        e.preventDefault();
        handleOpenAddModal();
        return;
      }

      // Fast status filters: 1 = All, 2 = Online, 3 = Offline, 4 = Clear
      if (currentView === 'cameras' && !isViewerOpen && !isAddEditOpen) {
        if (e.key === '1') {
          setSelectedStatus('All');
        } else if (e.key === '2') {
          setSelectedStatus('ONLINE');
        } else if (e.key === '3') {
          setSelectedStatus('OFFLINE');
        } else if (e.key === '4') {
          handleResetFilters();
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [
    isShortcutsOpen,
    isZonesOpen,
    isGatewayOpen,
    currentView,
    isViewerOpen,
    isAddEditOpen,
    isDeleteOpen,
  ]);

  // Handler for Add Camera
  const handleOpenAddModal = useCallback(() => {
    soundService.playTactileBlip(750, 0.025);
    setCameraToEdit(null);
    setIsAddEditOpen(true);
  }, []);

  // Handler for Edit Camera
  const handleOpenEditModal = useCallback((camera: Camera) => {
    soundService.playTactileBlip(680, 0.025);
    setCameraToEdit(camera);
    setIsAddEditOpen(true);
  }, []);

  // Handler for Save Camera (Add / Edit)
  const handleSaveCamera = async (data: CameraFormData, id?: string) => {
    if (id) {
      await cameraService.updateCamera(id, data);
      addToast(`Camera updated successfully`, 'success');
    } else {
      await cameraService.createCamera(data);
      addToast(`New camera "${data.name}" added to ${data.zone}`, 'success');
    }
  };

  // Handler for Delete Camera
  const handleOpenDeleteDialog = useCallback((camera: Camera) => {
    soundService.playTactileBlip(480, 0.03);
    setCameraToDelete(camera);
    setIsDeleteOpen(true);
  }, []);

  const handleConfirmDelete = async () => {
    if (!cameraToDelete) return;
    setIsDeleting(true);
    try {
      await cameraService.deleteCamera(cameraToDelete.id);
      addToast(`Camera "${cameraToDelete.name}" removed`, 'info');
      setIsDeleteOpen(false);
      setCameraToDelete(null);
      if (selectedCamera?.id === cameraToDelete.id) {
        setIsViewerOpen(false);
        setSelectedCamera(null);
      }
    } catch (err: any) {
      addToast(err.message || 'Failed to delete camera', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedZone('ALL');
    setSelectedStatus('All');
  };

  // Auth Handlers
  const handleLoginSuccess = (user: User) => {
    setCurrentUser(user);
    setCurrentView('cameras');
    cameraWebSocket.reconnect();   // start WS with fresh token
    loadCameras();                 // fetch cameras now that we're authed
    addToast(`Welcome back, ${user.name}! Terminal authenticated.`, 'success');
  };

  const handleRegisterSuccess = (user: User) => {
    setCurrentUser(user);
    setCurrentView('cameras');
    cameraWebSocket.reconnect();
    loadCameras();
    addToast(`Operator account created for ${user.name} (${user.role}).`, 'success');
  };

  const handleSignOut = async () => {
    await authService.logout();        // revokes token server-side
    cameraWebSocket.disconnect();     // close WS cleanly
    setCameras([]);
    setCurrentUser(null);
    setCurrentView('login');
    setIsViewerOpen(false);
    setSelectedCamera(null);
    addToast('Signed out of surveillance terminal.', 'info');
  };

  const handleNavigate = (section: AppView | string) => {
    if (section === 'login' || section === 'register') {
      setCurrentView(section as AppView);
    } else if (section === 'cameras') {
      setCurrentView('cameras');
      handleResetFilters();
    } else if (section === 'alerts') {
      setCurrentView('alerts');
      setIsViewerOpen(false);
      setSelectedCamera(null);
      loadAlerts();
    } else if (section === 'attendance') {
      setCurrentView('attendance');
      setIsViewerOpen(false);
      setSelectedCamera(null);
    } else if (section === 'employees') {
      setCurrentView('employees');
      setIsViewerOpen(false);
      setSelectedCamera(null);
    } else {
      setCurrentView('cameras');
      addToast(`Switched context to ${section.toUpperCase()}`, 'info');
    }
  };

  const isAuthView = currentView === 'login' || currentView === 'register';

  return (
    <div
      className={`${
        isAuthView ? 'h-screen overflow-hidden' : 'min-h-screen'
      } bg-white dark:bg-[#0c0c0e] text-[#0a0a0a] dark:text-[#f4f4f5] flex flex-col font-sans relative selection:bg-orange-500 selection:text-black transition-colors duration-300`}
    >
      {/* Decorative staggered curved lines matching theme specifications */}
      <DecorativeCurvedLines isDark={isDark} />

      {/* Fixed Navbar with Brand & Drawer */}
      <Navbar
        activeSection={currentView}
        onlineCount={summary.online}
        totalCount={summary.total}
        alertCount={alerts.length}
        currentUser={currentUser}
        onSignOut={handleSignOut}
        onNavigate={handleNavigate}
        isDark={isDark}
        onToggleTheme={toggleTheme}
        onOpenShortcuts={() => setIsShortcutsOpen(true)}
        onOpenZones={() => setIsZonesOpen(true)}
        onOpenGateway={() => setIsGatewayOpen(true)}
      />

      {/* Main Content Area */}
      <main
        id="camera-management-main"
        className={`flex-1 w-full mx-auto z-10 ${
          isAuthView
            ? 'max-w-[1080px] px-3 sm:px-6 pt-16 sm:pt-[70px] pb-2 flex flex-col justify-center overflow-hidden h-[calc(100vh-0px)]'
            : 'max-w-[1240px] px-4 sm:px-8 pt-24 sm:pt-26 pb-12'
        }`}
      >
        {currentView === 'login' ? (
          <LoginPage
            onSuccess={handleLoginSuccess}
            onNavigateToRegister={() => setCurrentView('register')}
            onBackToConsole={() => setCurrentView('cameras')}
          />
        ) : currentView === 'register' ? (
          <RegisterPage
            onSuccess={handleRegisterSuccess}
            onNavigateToLogin={() => setCurrentView('login')}
            onBackToConsole={() => setCurrentView('cameras')}
          />
        ) : currentView === 'attendance' ? (
          <AttendancePage cameras={cameras} />
        ) : currentView === 'employees' ? (
          <EmployeesPage />
        ) : currentView === 'alerts' ? (
          <AlertsPage
            alerts={alerts}
            cameras={cameras}
            onRefresh={loadAlerts}
            onStatusUpdate={(id, newStatus) => {
              setAlerts((prev) =>
                prev.map((a) => (a.id === id ? { ...a, status: newStatus } : a))
              );
            }}
            onDeleteAlert={(id) => {
              setAlerts((prev) => prev.filter((a) => a.id !== id));
              addToast('Incident record and evidence snapshot permanently erased', 'success');
            }}
          />
        ) : (
          <>
            {/* Page Header Section */}
            <section id="page-header-section" className="mb-4 sm:mb-5">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-4 border-b border-black/[0.08] dark:border-white/[0.08]">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse shadow-[0_0_6px_rgba(249,115,22,0.8)]" />
                    <span className="text-[11px] font-mono uppercase tracking-wider text-[#6b6b6b] dark:text-[#a1a1aa]">
                      Node Telemetry Stream Active
                    </span>
                  </div>
                  <h1
                    id="main-title"
                    className="text-[30px] sm:text-[38px] font-semibold text-[#0a0a0a] dark:text-[#fafafa] tracking-tightest leading-tight"
                  >
                    Camera Management
                  </h1>
                  <p className="text-[14px] sm:text-[15px] text-[#6b6b6b] dark:text-[#a1a1aa] mt-0.5 tracking-tight">
                    Manage CCTV cameras, zones and live connectivity
                  </p>
                </div>

                <div className="flex items-center gap-2.5">
                  <button
                    id="header-shortcuts-btn"
                    onClick={() => setIsShortcutsOpen(true)}
                    className="hidden sm:flex items-center gap-1.5 px-3 py-2 border border-black/[0.1] dark:border-white/[0.12] bg-[#fbfbfb] dark:bg-[#15151c] text-[#6b6b6b] dark:text-[#a1a1aa] hover:text-black dark:hover:text-white rounded-full text-[13px] font-medium transition-colors cursor-pointer"
                    title="Keyboard Shortcuts (?)"
                  >
                    <span className="font-mono text-[11px]">⌘ Shortcuts</span>
                    <kbd className="px-1 py-0.2 text-[10px] font-mono bg-black/5 dark:bg-white/10 rounded">?</kbd>
                  </button>

                  <button
                    id="header-add-camera-btn"
                    onClick={handleOpenAddModal}
                    className="flex items-center gap-2 px-4 py-2 sm:px-5 sm:py-2.5 bg-[#0a0a0a] hover:bg-black/85 dark:bg-orange-500 dark:hover:bg-orange-600 text-white dark:text-black dark:font-bold rounded-full text-[13px] sm:text-[14px] font-semibold tracking-tight transition-all cursor-pointer shadow-sm hover:translate-y-[-1px] active:scale-98 dark:shadow-[0_0_15px_rgba(249,115,22,0.35)]"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add Camera</span>
                  </button>
                </div>
              </div>
            </section>

            {/* Dynamic Summary Cards (Lifted up directly beneath header) */}
            <section className="mb-5 sm:mb-6">
              <CameraSummaryCards
                summary={summary}
                activeStatusFilter={selectedStatus}
                onSelectStatusFilter={(status) => setSelectedStatus(status)}
              />
            </section>

            {/* Error State Banner if API Fails */}
            {apiError && (
              <div
                id="api-error-banner"
                className="mb-6 p-4 rounded-xl bg-[#ef4444]/10 border border-[#ef4444]/20 text-[14px] text-[#b91c1c] flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <span>{apiError}</span>
                </div>
                <button
                  onClick={loadCameras}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#ef4444] text-white rounded-lg text-[13px] font-medium hover:bg-[#dc2626] transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry</span>
                </button>
              </div>
            )}

            {/* Loading State or Table Content */}
            {isLoading ? (
              <CameraLoadingSkeleton />
            ) : cameras.length === 0 ? (
              <CameraEmptyState
                onAddCamera={handleOpenAddModal}
              />
            ) : (
              <div className="space-y-4">
                {/* Search and Filters Bar with View Mode Toggle */}
                <CameraControls
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  selectedZone={selectedZone}
                  onZoneChange={setSelectedZone}
                  availableZones={availableZones}
                  selectedStatus={selectedStatus}
                  onStatusChange={setSelectedStatus}
                  totalFilteredCount={filteredCameras.length}
                  totalCount={cameras.length}
                  onResetFilters={handleResetFilters}
                  viewMode={viewMode}
                  onViewModeChange={setViewMode}
                  density={density}
                  onDensityChange={setDensity}
                />

                {/* If filters return 0 results */}
                {filteredCameras.length === 0 ? (
                  <CameraEmptyState
                    isFiltered={true}
                    onAddCamera={handleOpenAddModal}
                    onClearFilters={handleResetFilters}
                  />
                ) : viewMode === 'grid' ? (
                  /* Surveillance Wall Grid View */
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                      {filteredCameras.map((cam) => (
                        <SurveillanceGridCard
                          key={cam.id}
                          cam={cam}
                          isSelected={isViewerOpen && selectedCamera?.id === cam.id}
                          onSelect={handleSelectCamera}
                          onEdit={handleOpenEditModal}
                          onDelete={handleOpenDeleteDialog}
                          onSnapshot={(name) => addToast(`Snapshot saved for ${name}`, 'success')}
                        />
                      ))}
                    </div>

                    <div className="pt-2">
                      <MarqueeTicker />
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Camera Table comfortably rendering 20+ cameras simultaneously */}
                    <CameraTable
                      cameras={filteredCameras}
                      selectedCameraId={isViewerOpen && selectedCamera ? selectedCamera.id : null}
                      onSelectCamera={handleSelectCamera}
                      onEditCamera={handleOpenEditModal}
                      onDeleteCamera={handleOpenDeleteDialog}
                      onCopySuccess={(msg) => addToast(msg, 'success')}
                      searchQuery={searchQuery}
                      density={density}
                    />

                    {/* Network Telemetry Ticker positioned below the table at the end */}
                    <div className="pt-2">
                      <MarqueeTicker />
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* On-Demand Live Viewer Drawer with next/prev camera cycling */}
      <CameraViewerDrawer
        camera={selectedCamera}
        isOpen={isViewerOpen}
        onClose={handleCloseViewer}
        onSnapshotTaken={(cameraName) =>
          addToast(`Snapshot saved for ${cameraName}`, 'success')
        }
        onNextCamera={handleNextCamera}
        onPrevCamera={handlePrevCamera}
        hasNextCamera={filteredCameras.length > 1}
        hasPrevCamera={filteredCameras.length > 1}
      />

      {/* Add / Edit Camera Modal (Requirement 4 & 5) */}
      <AddEditCameraModal
        isOpen={isAddEditOpen}
        onClose={() => setIsAddEditOpen(false)}
        cameraToEdit={cameraToEdit}
        existingZones={availableZones}
        onSaveCamera={handleSaveCamera}
      />

      {/* Delete Confirmation Dialog (Requirement 6) */}
      <DeleteCameraDialog
        camera={cameraToDelete}
        isOpen={isDeleteOpen}
        isDeleting={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          setIsDeleteOpen(false);
          setCameraToDelete(null);
        }}
      />

      {/* Keyboard Shortcuts Modal */}
      <KeyboardShortcutsModal
        isOpen={isShortcutsOpen}
        onClose={() => setIsShortcutsOpen(false)}
      />

      {/* Facility Zones Telemetry Modal */}
      <FacilityZonesModal
        isOpen={isZonesOpen}
        onClose={() => setIsZonesOpen(false)}
        cameras={cameras}
        onSelectZone={(zone) => setSelectedZone(zone)}
      />

      {/* RTSP Stream Gateway Diagnostics Modal */}
      <GatewayStatusModal
        isOpen={isGatewayOpen}
        onClose={() => setIsGatewayOpen(false)}
        onlineCount={summary.online}
        totalCount={summary.total}
      />

      {/* Toast Notifications System */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
