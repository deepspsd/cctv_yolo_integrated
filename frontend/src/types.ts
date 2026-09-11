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
  model?: string;
  aiState?: CameraAiState;
}

export interface AiDetection {
  type: string;
  label: string;
  confidence: number;
  bbox: [number, number, number, number]; // [x, y, w, h] normalized (0.0 - 1.0)
  category: 'OBJECT' | 'VIOLATION' | 'COMPLIANT';
  severity: 'NORMAL' | 'MEDIUM' | 'HIGH';
}

export interface CameraAnomaly {
  id: string;
  cameraId: string;
  cameraCode: string;
  type: string;
  label: string;
  confidence: number;
  bbox?: [number, number, number, number];
  severity: 'HIGH' | 'MEDIUM' | 'WARNING';
  timestamp: string;
}

export interface CameraAiState {
  cameraId: string;
  cameraCode?: string;
  peopleCount: number;
  phoneViolations: number;
  ppeViolations: number;
  complianceScore: number;
  detections: AiDetection[];
  anomalies: CameraAnomaly[];
  lastAnalyzed: string | null;
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

export type AppView = 'cameras' | 'alerts' | 'login' | 'register';

export interface AnomalyAlertEvent {
  id: string;
  cameraId: string;
  cameraName?: string;
  zone: string;
  eventCategory: string;
  anomalyType: string;
  modelClassId?: number;
  modelClassName?: string;
  confidence: number;
  severity?: string;
  trackId?: number;
  firstSeenAt: string;
  confirmedAt: string;
  endedAt?: string | null;
  durationSeconds?: number | null;
  status: string;
  snapshotPath?: string | null;
  createdAt: string;
}

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
