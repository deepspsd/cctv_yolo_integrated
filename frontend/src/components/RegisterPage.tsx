import React, { useState } from 'react';
import { User, RegisterData, UserRole } from '../types';
import { authService } from '../services/authService';
import {
  Shield,
  Eye,
  EyeOff,
  Lock,
  Mail,
  User as UserIcon,
  Building2,
  BadgeCheck,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { OperatorCredentialVisualizer } from './OperatorCredentialVisualizer';
import { soundService } from '../services/soundService';

interface RegisterPageProps {
  onSuccess: (user: User) => void;
  onNavigateToLogin: () => void;
  onBackToConsole: () => void;
}

export const RegisterPage: React.FC<RegisterPageProps> = ({
  onSuccess,
  onNavigateToLogin,
  onBackToConsole,
}) => {
  const [formData, setFormData] = useState<RegisterData>({
    name: '',
    email: '',
    role: 'Security Officer',
    facility: 'Main Campus HQ',
    badgeId: '',
    password: '',
    confirmPassword: '',
    agreeToTerms: true,
  });

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [capsLockActive, setCapsLockActive] = useState(false);

  const calculatePasswordStrength = (pass: string): { score: number; label: string } => {
    if (!pass) return { score: 0, label: 'Empty' };
    let score = 0;
    if (pass.length >= 8) score += 1;
    if (/[A-Z]/.test(pass)) score += 1;
    if (/[0-9]/.test(pass)) score += 1;
    if (/[^A-Za-z0-9]/.test(pass)) score += 1;

    if (score <= 1) return { score: 1, label: 'Weak' };
    if (score === 2) return { score: 2, label: 'Fair' };
    if (score === 3) return { score: 3, label: 'Good' };
    return { score: 4, label: 'Strong' };
  };

  const strength = calculatePasswordStrength(formData.password);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // Form Validations
    if (!formData.name.trim()) {
      setErrorMessage('Full name is required.');
      return;
    }
    if (!formData.email.trim()) {
      setErrorMessage('Work email is required.');
      return;
    }
    if (!formData.email.includes('@') || !formData.email.includes('.')) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }
    if (!formData.password) {
      setErrorMessage('Password is required.');
      return;
    }
    if (formData.password.length < 8) {
      setErrorMessage('Password must be at least 8 characters long.');
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }
    if (!formData.agreeToTerms) {
      setErrorMessage('You must acknowledge the CCTV security compliance protocol.');
      return;
    }

    setIsLoading(true);
    soundService.playTactileBlip(750, 0.025);
    try {
      const user = await authService.register(formData);
      soundService.playTactileBlip(880, 0.04);
      onSuccess(user);
    } catch (err: any) {
      soundService.playTactileBlip(320, 0.05);
      setErrorMessage(err.message || 'Failed to create operator account.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-[1040px] mx-auto py-1 sm:py-2 flex flex-col justify-center animate-in fade-in zoom-in-95 duration-200">
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
          <span>Surveillance Enclave Enrollment</span>
        </div>
      </div>

      {/* Main Horizontal Split Card */}
      <div className="bg-white dark:bg-[#111115] border border-black/[0.1] dark:border-white/[0.1] rounded-2xl sm:rounded-3xl shadow-xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 max-h-[calc(100vh-125px)] min-h-0">
        {/* Left Side: Registration Form */}
        <div className="lg:col-span-7 p-4 sm:p-5 lg:p-6 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-black/[0.08] dark:border-white/[0.08] overflow-y-auto">
          <div>
            {/* Brand Header */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-2">
                <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-black dark:bg-orange-500 text-white dark:text-black shadow-xs">
                  <BadgeCheck className="w-3.5 h-3.5" />
                </div>
                <span className="px-2 py-0.5 rounded-full text-[9.5px] font-mono font-semibold bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/25 uppercase tracking-wide">
                  New Operator Enrolment
                </span>
              </div>

              <div className="flex items-baseline">
                <span
                  className="font-serif italic font-semibold text-[26px] leading-none text-[#0a0a0a] dark:text-white"
                  style={{ letterSpacing: '-0.08em' }}
                >
                  CamEye
                </span>
                <sup
                  className="font-sans font-semibold text-[12px] text-[#0a0a0a] dark:text-white ml-0.5"
                  style={{ letterSpacing: '-0.02em', top: '-0.5em' }}
                >
                  ®
                </sup>
              </div>

              <h2 className="text-[17px] font-semibold text-[#0a0a0a] dark:text-white tracking-tight mt-1">
                Register Operator Credentials
              </h2>
              <p className="text-[12px] text-[#6b6b6b] dark:text-[#a1a1aa] mt-0.5 tracking-tight">
                Enroll authorized personnel to monitor security zones and manage CCTV streams
              </p>
            </div>

            {/* Error Banner */}
            {errorMessage && (
              <div
                id="register-error-banner"
                className="mb-2.5 p-2 rounded-lg bg-[#ef4444]/10 border border-[#ef4444]/25 text-[12px] text-[#b91c1c] dark:text-[#f87171] flex items-center gap-2 leading-snug"
              >
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Registration Form */}
            <form onSubmit={handleSubmit} className="space-y-2.5">
              {/* Row 1: Name and Email */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label
                    htmlFor="reg-name"
                    className="block text-[12px] font-medium text-[#0a0a0a] dark:text-white mb-1 tracking-tight"
                  >
                    Full Name <span className="text-[#ef4444]">*</span>
                  </label>
                  <div className="relative">
                    <input
                      id="reg-name"
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g. Alex Rivera"
                      disabled={isLoading}
                      required
                      className="w-full pl-8 pr-3 py-1.5 text-[12.5px] bg-white dark:bg-[#181820] border border-black/[0.15] dark:border-white/[0.15] focus:border-black dark:focus:border-orange-500 focus:ring-1 focus:ring-black dark:focus:ring-orange-500/30 rounded-lg text-[#0a0a0a] dark:text-white placeholder-[#8c8c8c] dark:placeholder-[#71717a] tracking-tight focus:outline-none transition-all"
                    />
                    <UserIcon className="w-3.5 h-3.5 text-[#8c8c8c] dark:text-[#71717a] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="reg-email"
                    className="block text-[12px] font-medium text-[#0a0a0a] dark:text-white mb-1 tracking-tight"
                  >
                    Work Email <span className="text-[#ef4444]">*</span>
                  </label>
                  <div className="relative">
                    <input
                      id="reg-email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder="alex.rivera@cameye.internal"
                      disabled={isLoading}
                      required
                      className="w-full pl-8 pr-3 py-1.5 text-[12.5px] bg-white dark:bg-[#181820] border border-black/[0.15] dark:border-white/[0.15] focus:border-black dark:focus:border-orange-500 focus:ring-1 focus:ring-black dark:focus:ring-orange-500/30 rounded-lg text-[#0a0a0a] dark:text-white placeholder-[#8c8c8c] dark:placeholder-[#71717a] tracking-tight focus:outline-none transition-all"
                    />
                    <Mail className="w-3.5 h-3.5 text-[#8c8c8c] dark:text-[#71717a] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>
              </div>

              {/* Row 2: Role & Facility */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label
                    htmlFor="reg-role"
                    className="block text-[12px] font-medium text-[#0a0a0a] dark:text-white mb-1 tracking-tight"
                  >
                    Assigned Role <span className="text-[#ef4444]">*</span>
                  </label>
                  <select
                    id="reg-role"
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value as UserRole })}
                    disabled={isLoading}
                    className="w-full px-2.5 py-1.5 text-[12.5px] bg-white dark:bg-[#181820] border border-black/[0.15] dark:border-white/[0.15] focus:border-black dark:focus:border-orange-500 focus:ring-1 focus:ring-black dark:focus:ring-orange-500/30 rounded-lg text-[#0a0a0a] dark:text-white tracking-tight focus:outline-none transition-all cursor-pointer"
                  >
                    <option value="Security Officer">Security Officer</option>
                    <option value="Surveillance Operator">Surveillance Operator</option>
                    <option value="Facility Manager">Facility Manager</option>
                    <option value="Administrator">Administrator</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="reg-facility"
                    className="block text-[12px] font-medium text-[#0a0a0a] dark:text-white mb-1 tracking-tight"
                  >
                    Primary Facility <span className="text-[#ef4444]">*</span>
                  </label>
                  <div className="relative">
                    <input
                      id="reg-facility"
                      type="text"
                      value={formData.facility}
                      onChange={(e) => setFormData({ ...formData, facility: e.target.value })}
                      placeholder="Main Campus HQ"
                      disabled={isLoading}
                      className="w-full pl-7 pr-3 py-1.5 text-[12.5px] bg-white dark:bg-[#181820] border border-black/[0.15] dark:border-white/[0.15] focus:border-black dark:focus:border-orange-500 focus:ring-1 focus:ring-black dark:focus:ring-orange-500/30 rounded-lg text-[#0a0a0a] dark:text-white tracking-tight focus:outline-none transition-all"
                    />
                    <Building2 className="w-3 h-3 text-[#8c8c8c] dark:text-[#71717a] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>
              </div>

              {/* Row 3: Password and Confirm Password */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label
                      htmlFor="reg-password"
                      className="block text-[12px] font-medium text-[#0a0a0a] dark:text-white tracking-tight"
                    >
                      Password (8+ chars) <span className="text-[#ef4444]">*</span>
                    </label>
                    {capsLockActive && (
                      <span className="text-[10px] font-mono text-amber-600 dark:text-amber-400 font-semibold animate-pulse">
                        [CAPS ON]
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      id="reg-password"
                      type={showPassword ? 'text' : 'password'}
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      onKeyDown={(e) => setCapsLockActive(e.getModifierState('CapsLock'))}
                      onKeyUp={(e) => setCapsLockActive(e.getModifierState('CapsLock'))}
                      placeholder="Secure pass"
                      disabled={isLoading}
                      required
                      className="w-full pl-8 pr-8 py-1.5 text-[12.5px] bg-white dark:bg-[#181820] border border-black/[0.15] dark:border-white/[0.15] focus:border-black dark:focus:border-orange-500 focus:ring-1 focus:ring-black dark:focus:ring-orange-500/30 rounded-lg text-[#0a0a0a] dark:text-white placeholder-[#8c8c8c] dark:placeholder-[#71717a] tracking-tight focus:outline-none transition-all"
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

                <div>
                  <label
                    htmlFor="reg-confirm-password"
                    className="block text-[12px] font-medium text-[#0a0a0a] dark:text-white mb-1 tracking-tight"
                  >
                    Confirm Password <span className="text-[#ef4444]">*</span>
                  </label>
                  <div className="relative">
                    <input
                      id="reg-confirm-password"
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={formData.confirmPassword}
                      onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                      onKeyDown={(e) => setCapsLockActive(e.getModifierState('CapsLock'))}
                      onKeyUp={(e) => setCapsLockActive(e.getModifierState('CapsLock'))}
                      placeholder="Repeat pass"
                      disabled={isLoading}
                      required
                      className="w-full pl-8 pr-8 py-1.5 text-[12.5px] bg-white dark:bg-[#181820] border border-black/[0.15] dark:border-white/[0.15] focus:border-black dark:focus:border-orange-500 focus:ring-1 focus:ring-black dark:focus:ring-orange-500/30 rounded-lg text-[#0a0a0a] dark:text-white placeholder-[#8c8c8c] dark:placeholder-[#71717a] tracking-tight focus:outline-none transition-all"
                    />
                    <Lock className="w-3.5 h-3.5 text-[#8c8c8c] dark:text-[#71717a] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#8c8c8c] dark:text-[#71717a] hover:text-black dark:hover:text-white transition-colors cursor-pointer"
                      title={showConfirmPassword ? 'Hide password' : 'Show password'}
                      aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                    >
                      {showConfirmPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Password strength bar */}
              {formData.password && (
                <div className="flex items-center gap-2 pt-0.2">
                  <div className="flex-1 h-1.5 bg-black/[0.08] dark:bg-white/[0.08] rounded-full overflow-hidden flex gap-1">
                    <div
                      className={`h-full transition-all duration-300 ${
                        strength.score >= 1
                          ? strength.score === 1
                            ? 'bg-[#ef4444] w-1/4'
                            : strength.score === 2
                            ? 'bg-[#f59e0b] w-2/4'
                            : strength.score === 3
                            ? 'bg-orange-500 w-3/4'
                            : 'bg-[#17c964] w-full'
                          : 'w-0'
                      }`}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-[#6b6b6b] dark:text-[#a1a1aa]">{strength.label}</span>
                </div>
              )}

              {/* Compliance Checkbox */}
              <div className="pt-0.5">
                <label className="flex items-start gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={formData.agreeToTerms}
                    onChange={(e) => setFormData({ ...formData, agreeToTerms: e.target.checked })}
                    className="w-3.5 h-3.5 mt-0.5 rounded border-black/20 text-black dark:text-orange-500 focus:ring-black dark:focus:ring-orange-500 accent-black dark:accent-orange-500 cursor-pointer"
                  />
                  <span className="text-[11px] text-[#4a4a4a] dark:text-[#d4d4d8] leading-snug tracking-tight">
                    I acknowledge corporate CCTV surveillance compliance, privacy mandates, and zero-leak stream security policies.
                  </span>
                </label>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                id="register-submit-btn"
                disabled={isLoading}
                className="w-full mt-1.5 py-2 px-3 bg-[#0a0a0a] dark:bg-orange-500 hover:bg-black/85 dark:hover:bg-orange-400 text-white dark:text-black rounded-lg text-[13px] font-semibold tracking-tight transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-xs dark:shadow-[0_0_15px_rgba(249,115,22,0.35)] active:scale-98 disabled:opacity-60"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Enrolling Security Enclave...</span>
                  </>
                ) : (
                  <>
                    <span>Enroll Operator Profile</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Bottom Switch to Login */}
          <div className="mt-2.5 pt-2 border-t border-black/[0.08] dark:border-white/[0.08] flex items-center justify-between text-[12px] text-[#6b6b6b] dark:text-[#a1a1aa] shrink-0">
            <span>Already have an operator pass?</span>
            <button
              type="button"
              onClick={onNavigateToLogin}
              className="font-semibold text-[#0a0a0a] dark:text-orange-400 hover:underline underline-offset-2 transition-colors cursor-pointer"
            >
              Sign in
            </button>
          </div>
        </div>

        {/* Right Side: Awesome Dynamic Holographic Credential Visualizer */}
        <div className="lg:col-span-5 bg-[#08080a] h-full min-h-0 overflow-hidden">
          <OperatorCredentialVisualizer
            name={formData.name}
            email={formData.email}
            role={formData.role}
            facility={formData.facility}
            passwordStrength={strength.score}
          />
        </div>
      </div>

      {/* Security notice footer */}
      <div className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-[#8c8c8c] text-center shrink-0">
        <Shield className="w-3 h-3 text-[#17c964]" />
        <span>Cryptographic credential issuance • ISO 27001 CCTV Telemetry Compliant</span>
      </div>
    </div>
  );
};
