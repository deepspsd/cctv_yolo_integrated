export type CameraStatus = 'ONLINE' | 'OFFLINE' | 'CHECKING' | 'UNKNOWN';

export interface Camera {
  id: string;
  name: string;
  code: string;
  zone: string;
  rtspUrl: string;
  username?: string;
  password?: string;
  status: CameraStatus;
  lastChecked: string;
  lastOnline: string;
  resolution: string;
  fps: number;
  codec: string;
  bitrate: string;
  ip: string;
  model?: string;
}

export interface CameraSummary {
  total: number;
  online: number;
  offline: number;
  currentlyViewing: number;
}

export interface StreamInfo {
  streamUrl: string;
  whepUrl?: string;
  type: 'webrtc' | 'hls' | 'simulated';
  resolution: string;
  fps: number;
  codec: string;
  bitrate?: string;
  status: CameraStatus;
  startedAt: string;
}

export interface CameraTestResult {
  success: boolean;
  latencyMs: number;
  details: string;
  reachable: boolean;
  streamAvailable: boolean;
  codec?: string;
  resolution?: string;
  fps?: number;
  error?: string;
}

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
  timestamp: number;
}

export interface CameraFormData {
  name: string;
  zone: string;
  rtspUrl: string;
  username: string;
  password?: string;
  userLogin?: string;
  userPassword?: string;
}

export type StatusFilter = 'All' | CameraStatus;

export type ThemeMode = 'light' | 'dark';

export type AppView = 'cameras' | 'login' | 'register';

export type UserRole =
  | 'Administrator'
  | 'Security Officer'
  | 'Surveillance Operator'
  | 'Facility Manager';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  facility: string;
  badgeId?: string;   // optional: may be null for newly-created accounts
  lastLogin?: string;
}

/** Shape of the JWT login/register API response. */
export interface AuthTokenResponse {
  access_token: string;
  token_type: 'bearer';
  expires_in: number;
  user: User;
}

export interface LoginCredentials {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export interface RegisterData {
  name: string;
  email: string;
  role: UserRole;
  facility: string;
  badgeId?: string;
  password: string;
  confirmPassword: string;
  agreeToTerms: boolean;
}
