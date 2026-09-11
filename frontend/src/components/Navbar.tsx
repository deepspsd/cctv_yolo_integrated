import React, { useState, useEffect } from 'react';
import {
  ChevronUp,
  Menu,
  X,
  Activity,
  Shield,
  Video,
  Layers,
  Database,
  Sliders,
  FileText,
  User as UserIcon,
  LogIn,
  UserPlus,
  LogOut,
  Sun,
  Moon,
  HelpCircle,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { User, AppView } from '../types';
import { soundService } from '../services/soundService';

interface NavbarProps {
  activeSection?: AppView | string;
  onNavigate?: (section: AppView | string) => void;
  onlineCount?: number;
  totalCount?: number;
  currentUser?: User | null;
  onSignOut?: () => void;
  isDark?: boolean;
  onToggleTheme?: () => void;
  onOpenShortcuts?: () => void;
  onOpenZones?: () => void;
  onOpenGateway?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeSection = 'cameras',
  onNavigate,
  onlineCount = 19,
  totalCount = 22,
  currentUser,
  onSignOut,
  isDark = true,
  onToggleTheme,
  onOpenShortcuts,
  onOpenZones,
  onOpenGateway,
}) => {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => soundService.isEnabled());

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && drawerOpen) {
        setDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [drawerOpen]);

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [drawerOpen]);

  const navLinks = [
    { id: 'cameras', label: 'Camera Management', icon: Video, active: true },
    { id: 'zones', label: 'Zones & Facilities', icon: Layers },
    { id: 'gateway', label: 'RTSP Stream Gateway', icon: Activity },
    { id: 'storage', label: 'Storage & Retention', icon: Database, comingSoon: true },
    { id: 'logs', label: 'Audit Logs', icon: FileText, comingSoon: true },
    { id: 'settings', label: 'Settings', icon: Sliders, comingSoon: true },
  ];

  const handleLinkClick = (id: string, comingSoon?: boolean) => {
    if (comingSoon) return;
    if (id === 'zones' && onOpenZones) {
      setDrawerOpen(false);
      onOpenZones();
      return;
    }
    if (id === 'gateway' && onOpenGateway) {
      setDrawerOpen(false);
      onOpenGateway();
      return;
    }
    if (onNavigate) onNavigate(id);
    setDrawerOpen(false);
  };

  return (
    <>
      <header
        id="navbar-header"
        className="fixed top-0 left-0 right-0 z-50 bg-white/90 dark:bg-[#09090b]/90 backdrop-blur-md border-b border-black/[0.06] dark:border-white/[0.08] transition-all"
        style={{ height: '72px' }}
      >
        <div
          className="max-w-[1240px] mx-auto h-full flex items-center justify-between"
          style={{ padding: '0 36px' }}
        >
          {/* Brand Logo */}
          <div className="flex items-center gap-3">
            <button
              id="brand-logo-btn"
              onClick={() => handleLinkClick('cameras')}
              className="group flex items-baseline text-left focus:outline-none cursor-pointer"
            >
              <span
                className="font-serif italic font-semibold text-[30px] leading-none text-[#0a0a0a] dark:text-white"
                style={{ letterSpacing: '-0.08em' }}
              >
                CamEye
              </span>
              <sup
                className="font-sans font-semibold text-[14px] text-[#0a0a0a] dark:text-orange-400 ml-0.5"
                style={{ letterSpacing: '-0.02em', top: '-0.6em' }}
              >
                ®
              </sup>
            </button>

            <span className="hidden sm:inline-flex items-center px-2 py-0.5 text-[11px] font-medium tracking-tight bg-black/[0.04] dark:bg-orange-500/10 text-[#6b6b6b] dark:text-orange-400 dark:border dark:border-orange-500/20 rounded-full ml-2">
              Enterprise CCTV
            </span>
          </div>

          {/* Right Action Stack */}
          <div className="flex items-center gap-2.5 sm:gap-3">
            {/* Live Socket Telemetry Indicator (Click to open Gateway Diagnostics) */}
            <button
              id="telemetry-pill"
              type="button"
              onClick={() => {
                soundService.playTactileBlip(750, 0.02);
                if (onOpenGateway) onOpenGateway();
              }}
              className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#fbfbfb] dark:bg-[#121217] border border-black/[0.06] dark:border-white/[0.08] hover:border-black/20 dark:hover:border-orange-500/40 text-[12px] font-medium text-[#6b6b6b] dark:text-[#a1a1aa] transition-all cursor-pointer"
              title="Click to view RTSP Stream Gateway Diagnostics"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#17c964] dark:bg-orange-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#17c964] dark:bg-orange-500"></span>
              </span>
              <span className="text-[#0a0a0a] dark:text-white font-semibold">
                {onlineCount}/{totalCount}
              </span>
              <span className="text-[11px] text-[#8c8c8c] dark:text-[#71717a]">
                Streaming Nodes
              </span>
            </button>

            {/* Terminal Sound Effects Toggle */}
            <button
              id="sound-toggle-btn"
              type="button"
              onClick={() => {
                const next = soundService.toggleSound();
                setSoundEnabled(next);
              }}
              className={`flex items-center justify-center w-8 h-8 rounded-full border transition-all cursor-pointer ${
                soundEnabled
                  ? 'border-orange-500/40 text-orange-500 bg-orange-500/10 hover:border-orange-500'
                  : 'border-black/[0.08] dark:border-white/[0.1] bg-[#fbfbfb] dark:bg-[#15151c] text-[#8c8c8c] hover:text-black dark:hover:text-white'
              }`}
              title={soundEnabled ? 'Mute Terminal Audio Effects' : 'Enable Terminal Audio Effects'}
              aria-label="Toggle terminal sound effects"
            >
              {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            </button>

            {/* Dark Matt Black Theme Toggle Button */}
            <button
              id="theme-toggle-btn"
              type="button"
              onClick={() => {
                soundService.playTactileBlip(800, 0.03);
                if (onToggleTheme) onToggleTheme();
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition-all cursor-pointer select-none text-[12px] font-medium ${
                isDark
                  ? 'bg-[#15151c] border-orange-500/30 text-orange-400 hover:border-orange-500/60 shadow-[0_0_12px_rgba(249,115,22,0.2)]'
                  : 'bg-[#fbfbfb] border-black/[0.08] text-[#0a0a0a] hover:border-black/30'
              }`}
              title={isDark ? 'Switch to Clean Light Mode' : 'Switch to Dark Matt Black & Orange Mode'}
              aria-label="Toggle theme mode"
            >
              {isDark ? (
                <>
                  <Sun className="w-3.5 h-3.5 text-orange-400" />
                  <span className="hidden sm:inline font-mono text-[11px] tracking-tight">
                    Dark Ops
                  </span>
                </>
              ) : (
                <>
                  <Moon className="w-3.5 h-3.5 text-[#6b6b6b]" />
                  <span className="hidden sm:inline font-mono text-[11px] tracking-tight text-[#6b6b6b]">
                    Dark Mode
                  </span>
                </>
              )}
            </button>

            {/* Keyboard Shortcuts Trigger Button */}
            {onOpenShortcuts && (
              <button
                id="shortcuts-trigger-btn"
                type="button"
                onClick={() => {
                  soundService.playTactileBlip(700, 0.02);
                  onOpenShortcuts();
                }}
                className="hidden sm:flex items-center justify-center w-8 h-8 rounded-full border border-black/[0.08] dark:border-white/[0.1] bg-[#fbfbfb] dark:bg-[#15151c] text-[#6b6b6b] dark:text-[#a1a1aa] hover:text-black dark:hover:text-white hover:border-black/30 dark:hover:border-orange-500/50 transition-all cursor-pointer"
                title="Keyboard Shortcuts (?)"
                aria-label="View keyboard shortcuts"
              >
                <HelpCircle className="w-4 h-4" />
              </button>
            )}

            {/* User Profile or Sign In / Register in Header */}
            {currentUser ? (
              <div className="relative">
                <button
                  id="user-profile-menu-btn"
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-black/[0.12] dark:border-white/[0.12] hover:border-black/[0.3] dark:hover:border-orange-500/40 bg-white dark:bg-[#15151c] transition-all cursor-pointer text-left"
                >
                  <div className="w-6 h-6 rounded-full bg-black dark:bg-orange-500 text-white dark:text-black text-[11px] font-bold flex items-center justify-center shrink-0">
                    {currentUser.name
                      .split(' ')
                      .map((n) => n[0])
                      .slice(0, 2)
                      .join('')}
                  </div>
                  <div className="hidden sm:block leading-none">
                    <div className="text-[12px] font-semibold text-[#0a0a0a] dark:text-white tracking-tight truncate max-w-[110px]">
                      {currentUser.name}
                    </div>
                    <div className="text-[10px] text-[#6b6b6b] dark:text-[#a1a1aa] font-mono tracking-tight">
                      {currentUser.role === 'Administrator' ? 'Admin' : 'Operator'}
                    </div>
                  </div>
                  <ChevronUp
                    className={`w-3.5 h-3.5 text-[#6b6b6b] dark:text-[#a1a1aa] transition-transform ${
                      userMenuOpen ? '' : 'rotate-180'
                    }`}
                  />
                </button>

                {/* Dropdown Menu */}
                {userMenuOpen && (
                  <div
                    className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-[#15151c] border border-black/[0.1] dark:border-white/[0.1] rounded-xl shadow-xl py-2 z-50 animate-in fade-in zoom-in-95 duration-150"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="px-3.5 py-2 border-b border-black/[0.06] dark:border-white/[0.08]">
                      <p className="text-[11px] font-mono text-[#8c8c8c] dark:text-[#71717a] uppercase tracking-wider">
                        Authorized Terminal
                      </p>
                      <p className="text-[13px] font-semibold text-[#0a0a0a] dark:text-white mt-0.5 truncate">
                        {currentUser.name}
                      </p>
                      <p className="text-[11px] text-[#6b6b6b] dark:text-[#a1a1aa] truncate">{currentUser.email}</p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="px-1.5 py-0.5 text-[10px] font-medium bg-[#17c964]/10 dark:bg-orange-500/15 text-[#0d7d3d] dark:text-orange-400 rounded">
                          {currentUser.role}
                        </span>
                        <span className="text-[10px] font-mono text-[#8c8c8c] dark:text-[#71717a]">
                          {currentUser.badgeId}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        handleLinkClick('cameras');
                      }}
                      className="w-full px-3.5 py-2 text-left text-[13px] text-[#0a0a0a] dark:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.06] flex items-center gap-2 cursor-pointer"
                    >
                      <Video className="w-3.5 h-3.5 text-[#6b6b6b] dark:text-[#a1a1aa]" />
                      <span>Camera Console</span>
                    </button>

                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        handleLinkClick('register');
                      }}
                      className="w-full px-3.5 py-2 text-left text-[13px] text-[#0a0a0a] dark:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.06] flex items-center gap-2 cursor-pointer"
                    >
                      <UserPlus className="w-3.5 h-3.5 text-[#6b6b6b] dark:text-[#a1a1aa]" />
                      <span>Add Operator</span>
                    </button>

                    <div className="my-1 border-t border-black/[0.06] dark:border-white/[0.08]" />

                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        if (onSignOut) onSignOut();
                      }}
                      className="w-full px-3.5 py-2 text-left text-[13px] text-[#ef4444] dark:text-[#f87171] hover:bg-[#ef4444]/10 flex items-center gap-2 cursor-pointer font-medium"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  id="nav-login-btn"
                  onClick={() => handleLinkClick('login')}
                  className={`px-3.5 py-1.5 text-[13px] font-medium tracking-tight rounded-full transition-all cursor-pointer ${
                    activeSection === 'login'
                      ? 'bg-black/[0.06] dark:bg-orange-500/20 text-[#0a0a0a] dark:text-orange-400'
                      : 'text-[#6b6b6b] dark:text-[#a1a1aa] hover:text-[#0a0a0a] dark:hover:text-white'
                  }`}
                >
                  Sign In
                </button>
                <button
                  id="nav-register-btn"
                  onClick={() => handleLinkClick('register')}
                  className={`hidden sm:inline-flex px-3.5 py-1.5 text-[13px] font-medium tracking-tight rounded-full border border-black/[0.12] dark:border-white/[0.15] hover:border-black dark:hover:border-orange-500 transition-all cursor-pointer ${
                    activeSection === 'register'
                      ? 'bg-[#0a0a0a] dark:bg-orange-500 text-white dark:text-black font-semibold'
                      : 'text-[#0a0a0a] dark:text-white hover:bg-black/[0.03] dark:hover:bg-white/[0.05]'
                  }`}
                >
                  Register
                </button>
              </div>
            )}

            {/* Menu Pill Button from theme specs */}
            <button
              id="menu-toggle-btn"
              onClick={() => {
                soundService.playTactileBlip(drawerOpen ? 550 : 700, 0.025);
                setDrawerOpen(!drawerOpen);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-[#0a0a0a] dark:bg-orange-500 text-white dark:text-black font-semibold rounded-full text-[14px] tracking-tight hover:bg-black/80 dark:hover:bg-orange-400 transition-all cursor-pointer shadow-sm active:scale-98"
              aria-label={drawerOpen ? 'Close navigation drawer' : 'Open navigation drawer'}
              aria-expanded={drawerOpen}
            >
              <span>{drawerOpen ? 'Close' : 'Menu'}</span>
              {drawerOpen ? (
                <X className="w-4 h-4 text-white dark:text-black" />
              ) : (
                <ChevronUp className="w-4 h-4 text-white dark:text-black rotate-180 group-hover:translate-y-[-1px] transition-transform" />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Full-Screen Drawer Overlay on Click (theme specification) */}
      <div
        id="nav-drawer-overlay"
        className={`fixed inset-0 z-40 bg-white dark:bg-[#09090b] flex flex-col justify-between transition-opacity duration-300 ease-in-out overflow-y-auto ${
          drawerOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        style={{
          paddingTop: '80px',
          paddingBottom: '24px',
          paddingLeft: 'clamp(16px, 4vw, 36px)',
          paddingRight: 'clamp(16px, 4vw, 36px)',
        }}
        aria-hidden={!drawerOpen}
      >
        {/* Background decorative watermark */}
        <div className="absolute right-12 bottom-12 select-none pointer-events-none opacity-[0.02] dark:opacity-[0.03] font-serif text-[180px] lg:text-[240px] font-bold italic leading-none text-black dark:text-orange-500">
          CCTV
        </div>

        <div className="max-w-[1200px] w-full mx-auto my-auto py-2">
          {/* User Auth Status Banner in Drawer */}
          <div className="mb-4 p-3 sm:p-4 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-[#fafafa] dark:bg-[#121217] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-black dark:bg-orange-500 text-white dark:text-black flex items-center justify-center font-bold text-[12px] sm:text-[13px] shrink-0">
                {currentUser
                  ? currentUser.name
                      .split(' ')
                      .map((n) => n[0])
                      .slice(0, 2)
                      .join('')
                  : 'CE'}
              </div>
              <div className="min-w-0">
                <div className="text-[13px] sm:text-[14px] font-semibold text-[#0a0a0a] dark:text-white flex items-center gap-2">
                  <span className="truncate">{currentUser ? currentUser.name : 'Terminal Unauthenticated'}</span>
                  {currentUser && (
                    <span className="px-2 py-0.5 text-[9.5px] font-medium bg-[#17c964]/15 dark:bg-orange-500/20 text-[#0d7d3d] dark:text-orange-400 rounded-full shrink-0">
                      {currentUser.role}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-[#6b6b6b] dark:text-[#a1a1aa] font-mono truncate">
                  {currentUser
                    ? `${currentUser.email} • ${currentUser.badgeId || 'NO-BADGE'} • ${currentUser.facility}`
                    : 'Log in with operator or admin credentials to authorize camera management'}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* Theme toggle also inside the drawer for easy switching */}
              <button
                type="button"
                onClick={onToggleTheme}
                className="px-3 py-1 text-[11.5px] font-medium rounded-full border border-black/[0.12] dark:border-orange-500/30 text-[#0a0a0a] dark:text-orange-400 hover:border-black/30 dark:hover:border-orange-500/60 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                {isDark ? (
                  <>
                    <Sun className="w-3 h-3 text-orange-400" />
                    <span>Clean Light</span>
                  </>
                ) : (
                  <>
                    <Moon className="w-3 h-3 text-[#6b6b6b]" />
                    <span>Dark Ops</span>
                  </>
                )}
              </button>

              {currentUser ? (
                <button
                  onClick={() => {
                    setDrawerOpen(false);
                    if (onSignOut) onSignOut();
                  }}
                  className="px-3 py-1 text-[11.5px] font-medium text-[#ef4444] dark:text-[#f87171] border border-[#ef4444]/30 hover:bg-[#ef4444]/10 rounded-full transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <LogOut className="w-3 h-3" />
                  <span>Sign Out</span>
                </button>
              ) : (
                <>
                  <button
                    onClick={() => handleLinkClick('login')}
                    className="px-3 py-1 text-[11.5px] font-semibold bg-[#0a0a0a] dark:bg-orange-500 text-white dark:text-black rounded-full hover:bg-black/80 dark:hover:bg-orange-400 transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <LogIn className="w-3 h-3" />
                    <span>Sign In</span>
                  </button>
                  <button
                    onClick={() => handleLinkClick('register')}
                    className="px-3 py-1 text-[11.5px] font-semibold border border-black/[0.2] dark:border-white/[0.2] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] text-[#0a0a0a] dark:text-white rounded-full transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <UserPlus className="w-3 h-3" />
                    <span>Register</span>
                  </button>
                </>
              )}
            </div>
          </div>

          <p className="text-[11px] sm:text-[12px] font-semibold uppercase tracking-wider text-[#8c8c8c] dark:text-[#71717a] mb-2 sm:mb-3">
            Platform Navigation • Control Center
          </p>
          <nav className="flex flex-col divide-y divide-black/[0.05] dark:divide-white/[0.06] border-y border-black/[0.05] dark:border-white/[0.06]">
            {/* Custom nav items including Login and Register */}
            {[
              { id: 'cameras', label: 'Camera Management', icon: Video },
              { id: 'login', label: 'Sign In (Terminal Auth)', icon: LogIn },
              { id: 'register', label: 'Register Operator', icon: UserPlus },
              { id: 'zones', label: 'Zones & Facilities', icon: Layers },
              { id: 'gateway', label: 'RTSP Stream Gateway', icon: Activity },
              { id: 'storage', label: 'Storage & Retention', icon: Database, comingSoon: true },
              { id: 'logs', label: 'Audit Logs', icon: FileText, comingSoon: true },
            ].map((link, idx) => {
              const Icon = link.icon;
              const isSelected = activeSection === link.id;
              const isComingSoon = Boolean((link as any).comingSoon);
              return (
                <button
                  key={link.id}
                  id={`nav-link-${link.id}`}
                  onClick={() => handleLinkClick(link.id, isComingSoon)}
                  disabled={isComingSoon}
                  className={`group flex items-center justify-between text-left py-2.5 sm:py-3 transition-all ${
                    isComingSoon
                      ? 'cursor-not-allowed opacity-50 text-[#8c8c8c] dark:text-[#71717a]'
                      : isSelected
                      ? 'cursor-pointer text-[#0a0a0a] dark:text-orange-400'
                      : 'cursor-pointer text-[#6b6b6b] dark:text-[#a1a1aa] hover:text-[#0a0a0a] dark:hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                    <span className="text-[12px] sm:text-[13px] font-mono text-[#a3a3a3] dark:text-[#71717a] group-hover:text-black group-hover:dark:text-orange-400 transition-colors shrink-0">
                      [0{idx + 1}]
                    </span>
                    <span className={`text-[20px] sm:text-[26px] md:text-[30px] font-medium tracking-tight truncate ${!isComingSoon ? 'transition-transform group-hover:translate-x-1.5' : ''}`}>
                      {link.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                    {isComingSoon ? (
                      <span className="px-2.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider bg-black/5 dark:bg-white/10 text-[#8c8c8c] dark:text-[#a1a1aa] border border-black/10 dark:border-white/10 rounded-full">
                        Coming Soon
                      </span>
                    ) : isSelected ? (
                      <span className="px-2.5 py-0.5 text-[11px] font-semibold bg-[#17c964]/10 dark:bg-orange-500/15 text-[#17c964] dark:text-orange-400 rounded-full">
                        Active View
                      </span>
                    ) : null}
                    <Icon className="w-4 h-4 sm:w-5 sm:h-5 text-black/30 dark:text-white/30 group-hover:text-black group-hover:dark:text-orange-400 group-hover:translate-x-1 transition-all" />
                  </div>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Drawer Footer with Copyright & System Stats */}
        <div className="max-w-[1200px] w-full mx-auto pt-8 border-t border-black/[0.08] dark:border-white/[0.08] flex flex-col sm:flex-row justify-between items-start sm:items-center text-[13px] text-[#6b6b6b] dark:text-[#a1a1aa] gap-4">
          <div className="flex items-center gap-4">
            <span>© 2026 CamEye Technologies Inc.</span>
            <span className="w-1 h-1 rounded-full bg-black/20 dark:bg-white/20" />
            <span>Firmware v4.8.2-rtsp</span>
            <span className="w-1 h-1 rounded-full bg-black/20 dark:bg-white/20" />
            <span className="text-[#17c964] dark:text-orange-400 font-medium flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#17c964] dark:bg-orange-500" />{' '}
              Gateway Synchronized
            </span>
          </div>
          <div className="text-[12px] font-mono text-[#8c8c8c] dark:text-[#71717a]">
            Encrypted WebRTC Channel • 0 Active Ingress Alerts
          </div>
        </div>
      </div>
    </>
  );
};
