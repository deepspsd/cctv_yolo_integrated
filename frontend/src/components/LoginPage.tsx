import React, { useState } from 'react';
import { User, LoginCredentials } from '../types';
import { authService } from '../services/authService';
import {
  Shield,
  Eye,
  EyeOff,
  Lock,
  Mail,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  Loader2,
  Video,
} from 'lucide-react';
import { SurveillanceLiveVisualizer } from './SurveillanceLiveVisualizer';
import { soundService } from '../services/soundService';

interface LoginPageProps {
  onSuccess: (user: User) => void;
  onNavigateToRegister: () => void;
  onBackToConsole: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  onSuccess,
  onNavigateToRegister,
  onBackToConsole,
}) => {
  const [formData, setFormData] = useState<LoginCredentials>({
    email: '',
    password: '',
    rememberMe: false,
  });

  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [capsLockActive, setCapsLockActive] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!formData.email.trim()) {
      setErrorMessage('Please enter your work email.');
      return;
    }
    if (!formData.password) {
      setErrorMessage('Please enter your password.');
      return;
    }

    setIsLoading(true);
    soundService.playTactileBlip(750, 0.025);
    try {
      const user = await authService.login(formData);
      soundService.playTactileBlip(880, 0.04);
      onSuccess(user);
    } catch (err: any) {
      soundService.playTactileBlip(320, 0.05);
      setErrorMessage(err.message || 'Authentication failed. Please verify credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-[1020px] mx-auto py-1 sm:py-2 flex flex-col justify-center animate-in fade-in zoom-in-95 duration-200">
      {/* Top back link & breadcrumb */}
      <div className="mb-2 sm:mb-2.5 flex items-center justify-between shrink-0">
        <button
          onClick={onBackToConsole}
          className="group inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[#6b6b6b] dark:text-[#a1a1aa] hover:text-[#0a0a0a] dark:hover:text-white transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" />
          <span>Back to Live Console</span>
        </button>

        <div className="flex items-center gap-2 text-[10.5px] font-mono text-[#8c8c8c] dark:text-[#a1a1aa] uppercase tracking-wider">
          <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse shadow-[0_0_6px_rgba(249,115,22,0.8)]" />
          <span>Surveillance Gateway 443</span>
        </div>
      </div>

      {/* Main Horizontal Split Card */}
      <div className="bg-white dark:bg-[#111115] border border-black/[0.1] dark:border-white/[0.1] rounded-2xl sm:rounded-3xl shadow-xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 max-h-[calc(100vh-125px)] min-h-0">
        {/* Left Side: Authentication Form */}
        <div className="lg:col-span-6 p-4 sm:p-5 lg:p-6 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-black/[0.08] dark:border-white/[0.08] overflow-y-auto">
          <div>
            {/* Brand Header */}
            <div className="mb-3 sm:mb-3.5">
              <div className="flex items-center justify-between mb-2">
                <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-black dark:bg-orange-500 text-white dark:text-black shadow-xs">
                  <Lock className="w-3.5 h-3.5" />
                </div>
                <span className="px-2 py-0.5 rounded-full text-[9.5px] font-mono font-semibold bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/25 uppercase tracking-wide">
                  Terminal Access
                </span>
              </div>

              <div className="flex items-baseline">
                <span
                  className="font-serif italic font-semibold text-[26px] leading-none text-[#0a0a0a] dark:text-white"
                  style={{ letterSpacing: '-0.08em' }}
                >
                  OccuSafe
                </span>
                <sup
                  className="font-sans font-semibold text-[12px] text-[#0a0a0a] dark:text-white ml-0.5"
                  style={{ letterSpacing: '-0.02em', top: '-0.5em' }}
                >
                  ®
                </sup>
              </div>

              <h2 className="text-[17px] font-semibold text-[#0a0a0a] dark:text-white tracking-tight mt-1">
                Surveillance Terminal Login
              </h2>
              <p className="text-[12px] text-[#6b6b6b] dark:text-[#a1a1aa] mt-0.5 tracking-tight">
                Enter authorized credentials to control CCTV cameras and live RTSP telemetry
              </p>
            </div>

            {/* Error Banner */}
            {errorMessage && (
              <div
                id="login-error-banner"
                className="mb-2.5 p-2 rounded-lg bg-[#ef4444]/10 border border-[#ef4444]/25 text-[12px] text-[#b91c1c] dark:text-[#f87171] flex items-center gap-2 leading-snug"
              >
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Login Form */}
            <form onSubmit={handleSubmit} className="space-y-2.5">
              {/* Work Email */}
              <div>
                <label
                  htmlFor="login-email"
                  className="block text-[12px] font-medium text-[#0a0a0a] dark:text-white mb-1 tracking-tight"
                >
                  Work Email
                </label>
                <div className="relative">
                  <input
                    id="login-email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="officer@occusafe.internal"
                    disabled={isLoading}
                    required
                    className="w-full pl-8 pr-3 py-1.5 text-[13px] bg-white dark:bg-[#181820] border border-black/[0.15] dark:border-white/[0.15] focus:border-black dark:focus:border-orange-500 focus:ring-1 focus:ring-black dark:focus:ring-orange-500/30 rounded-lg text-[#0a0a0a] dark:text-white placeholder-[#8c8c8c] dark:placeholder-[#71717a] tracking-tight focus:outline-none transition-all"
                  />
                  <Mail className="w-3.5 h-3.5 text-[#8c8c8c] dark:text-[#71717a] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              {/* Password */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label
                    htmlFor="login-password"
                    className="block text-[12px] font-medium text-[#0a0a0a] dark:text-white tracking-tight"
                  >
                    Password
                  </label>
                  <div className="flex items-center gap-2">
                    {capsLockActive && (
                      <span className="text-[10.5px] font-mono text-amber-600 dark:text-amber-400 font-semibold animate-pulse">
                        [CAPS LOCK ON]
                      </span>
                    )}
                    <span className="text-[11px] text-[#8c8c8c] dark:text-[#71717a]">
                      Secured by Argon2id
                    </span>
                  </div>
                </div>
                <div className="relative">
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    onKeyDown={(e) => setCapsLockActive(e.getModifierState('CapsLock'))}
                    onKeyUp={(e) => setCapsLockActive(e.getModifierState('CapsLock'))}
                    placeholder="Enter password"
                    disabled={isLoading}
                    required
                    className="w-full pl-8 pr-9 py-1.5 text-[13px] bg-white dark:bg-[#181820] border border-black/[0.15] dark:border-white/[0.15] focus:border-black dark:focus:border-orange-500 focus:ring-1 focus:ring-black dark:focus:ring-orange-500/30 rounded-lg text-[#0a0a0a] dark:text-white placeholder-[#8c8c8c] dark:placeholder-[#71717a] tracking-tight focus:outline-none transition-all"
                  />
                  <Lock className="w-3.5 h-3.5 text-[#8c8c8c] dark:text-[#71717a] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#8c8c8c] dark:text-[#71717a] hover:text-black dark:hover:text-white transition-colors cursor-pointer"
                    title={showPassword ? 'Hide password' : 'Show password'}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Remember terminal */}
              <div className="flex items-center justify-between pt-0.5">
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={formData.rememberMe}
                    onChange={(e) => setFormData({ ...formData, rememberMe: e.target.checked })}
                    className="w-3.5 h-3.5 rounded border-black/20 text-black dark:text-orange-500 focus:ring-black dark:focus:ring-orange-500 accent-black dark:accent-orange-500 cursor-pointer"
                  />
                  <span className="text-[12px] text-[#4a4a4a] dark:text-[#d4d4d8] tracking-tight">
                    Remember terminal authorization
                  </span>
                </label>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                id="login-submit-btn"
                disabled={isLoading}
                className="w-full mt-1.5 py-2 px-3 bg-[#0a0a0a] dark:bg-orange-500 hover:bg-black/85 dark:hover:bg-orange-400 text-white dark:text-black rounded-lg text-[13px] font-semibold tracking-tight transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-xs dark:shadow-[0_0_15px_rgba(249,115,22,0.35)] active:scale-98 disabled:opacity-60"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Authorizing Ingress Key...</span>
                  </>
                ) : (
                  <>
                    <span>Sign In to Terminal</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Bottom Switch to Register */}
          <div className="mt-2.5 pt-2 border-t border-black/[0.08] dark:border-white/[0.08] flex items-center justify-between text-[12px] text-[#6b6b6b] dark:text-[#a1a1aa] shrink-0">
            <span>Need operator credentials?</span>
            <button
              type="button"
              onClick={onNavigateToRegister}
              className="font-semibold text-[#0a0a0a] dark:text-orange-400 hover:underline underline-offset-2 transition-colors cursor-pointer"
            >
              Create Account
            </button>
          </div>
        </div>

        {/* Right Side: Awesome Interactive Surveillance Feed Visualizer */}
        <div className="lg:col-span-6 bg-[#08080a] h-full min-h-0 overflow-hidden">
          <SurveillanceLiveVisualizer />
        </div>
      </div>

      {/* Security Footer Notice */}
      <div className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-[#8c8c8c] text-center shrink-0">
        <Shield className="w-3 h-3 text-[#17c964]" />
        <span>Hardware encrypted WebRTC link • Zero-leak RTSP node isolation</span>
      </div>
    </div>
  );
};
