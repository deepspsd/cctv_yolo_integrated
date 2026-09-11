import { Camera, CameraStatus, StreamInfo, CameraTestResult, CameraAiState, CameraAnomaly } from '../types';
import { apiFetch, getStoredToken, tryRefreshToken } from './authService';

const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:5000/api';
const WS_BASE_URL  = (import.meta as any).env?.VITE_WS_URL       || 'ws://localhost:5000/ws/cameras';

// Mask credentials in RTSP URLs for security
export function maskRtspUrl(url: string): string {
  if (!url) return '';
  try {
    const match = url.match(/^(rtsps?:\/\/)(.*)@([^:\/\s]+(?::\d+)?(?:\/.*)?)$/i);
    if (match) {
      const [, protocol, userinfo, rest] = match;
      const colonIdx = userinfo.indexOf(':');
      const user = colonIdx !== -1 ? userinfo.slice(0, colonIdx) : userinfo;
      return `${protocol}${user}:••••••@${rest}`;
    }
    return url;
  } catch {
    return url;
  }
}

// Helper to safely parse ISO timestamps into UTC Date objects, ensuring naive ISO strings are not parsed as local time
export function parseIsoToUtc(isoString: string): Date {
  let s = isoString.trim().replace(' ', 'T');
  if (!s.endsWith('Z') && !s.includes('+') && !/T.*-\d{2}:?\d{2}$/.test(s)) {
    s += 'Z';
  }
  return new Date(s);
}

// Format relative timestamp ("Just now", "12 sec ago", "2 min ago")
export function formatRelativeTime(isoString: string): string {
  if (!isoString) return 'Never';
  const parsed = parseIsoToUtc(isoString);
  if (isNaN(parsed.getTime())) return 'Never';

  const diffMs  = Date.now() - parsed.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  // Clock skew or checked within 5 seconds
  if (diffSec < 5)  return 'Just now';
  if (diffSec < 60) return `${diffSec} sec ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} hr${diffHours > 1 ? 's' : ''} ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
}

// Format full human-readable timestamp in user's local timezone
export function formatFullDateTime(isoString: string): string {
  if (!isoString) return 'N/A';
  const date = parseIsoToUtc(isoString);
  if (isNaN(date.getTime())) return 'N/A';
  return date.toLocaleString('en-US', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
  });
}

// ─── WebSocket Event Bus — JWT token passed as ?token= query param ──────────

type WsListener = (event: { type: string; payload: any }) => void;

class CameraWebSocketClient {
  private ws: WebSocket | null = null;
  private listeners: Set<WsListener> = new Set();
  private reconnectTimer: any = null;
  private pingInterval: any = null;
  private isConnecting: boolean = false;

  constructor() {
    // Defer connection until token is available
    if (getStoredToken()) {
      this.connect();
    }
  }

  /** Call after login to start WS connection with fresh token. */
  reconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.isConnecting = false;
    this.connect();
  }

  /** Call on logout to close WS. */
  disconnect() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.onclose = null; // prevent auto-reconnect
      this.ws.close();
      this.ws = null;
    }
    this.isConnecting = false;
  }

  send(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(typeof data === 'string' ? data : JSON.stringify(data));
    }
  }

  private connect() {
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) return;

    const token = getStoredToken();
    if (!token) return; // don't attempt if not logged in

    this.isConnecting = true;
    const url = `${WS_BASE_URL}?token=${encodeURIComponent(token)}`;

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.isConnecting = false;
        if (this.pingInterval) clearInterval(this.pingInterval);
        this.pingInterval = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send('ping');
          }
        }, 20000);
      };

      this.ws.onmessage = (messageEvent) => {
        if (messageEvent.data === 'pong') return;
        try {
          const data = JSON.parse(messageEvent.data);
          if (data && data.type) {
            this.listeners.forEach((fn) => {
              try { fn(data); } catch (err) { console.error('WS listener error:', err); }
            });
          }
        } catch { /* ignore non-JSON */ }
      };

      this.ws.onclose = async (event: CloseEvent) => {
        this.isConnecting = false;
        if (this.pingInterval) clearInterval(this.pingInterval);
        
        // If auth failed (4001) or expired token, attempt silent refresh
        if (event.code === 4001) {
          const refreshed = await tryRefreshToken();
          if (refreshed) {
            this.connect();
            return;
          }
        }

        // Reconnect after 3s if token exists
        if (!this.reconnectTimer && getStoredToken()) {
          this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = null;
            // Proactively try token refresh if previous connection dropped
            await tryRefreshToken().catch(() => {});
            this.connect();
          }, 3000);
        }
      };

      this.ws.onerror = () => {
        this.isConnecting = false;
      };
    } catch {
      this.isConnecting = false;
      if (!this.reconnectTimer && getStoredToken()) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.connect();
        }, 3000);
      }
    }
  }

  subscribe(listener: WsListener) {
    this.listeners.add(listener);
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      this.connect();
    }
    return () => { this.listeners.delete(listener); };
  }

  broadcast(event: { type: string; payload: any }) {
    this.listeners.forEach((fn) => {
      try { fn(event); } catch (e) { console.error('Local broadcast error:', e); }
    });
  }
}

export const cameraWebSocket = new CameraWebSocketClient();

// ─── Camera REST client — all requests include Bearer token via apiFetch ────

class CameraService {
  private async _fetch(path: string, init: RequestInit = {}): Promise<Response> {
    return apiFetch(path, init);
  }

  private async _json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this._fetch(path, init);
    if (res.status === 401) {
      // Token expired or revoked — broadcast logout event
      cameraWebSocket.broadcast({ type: 'AUTH_EXPIRED', payload: {} });
      throw new Error('Session expired. Please log in again.');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Request failed: ${res.statusText} (${res.status})`);
    }
    return res.json();
  }

  async getAllCameras(): Promise<Camera[]> {
    return this._json<Camera[]>('/cameras');
  }

  async getCameraById(id: string): Promise<Camera> {
    return this._json<Camera>(`/cameras/${id}`);
  }

  async createCamera(cameraData: {
    name: string; zone: string; rtspUrl: string; username?: string; password?: string;
  }): Promise<Camera> {
    return this._json<Camera>('/cameras', {
      method: 'POST',
      body: JSON.stringify(cameraData),
    });
  }

  async updateCamera(
    id: string,
    updates: Partial<{
      name: string;
      zone: string;
      rtspUrl: string;
      username: string;
      password?: string;
      userLogin?: string;
      userPassword?: string;
    }>
  ): Promise<Camera> {
    return this._json<Camera>(`/cameras/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  async deleteCamera(id: string): Promise<boolean> {
    const res = await this._fetch(`/cameras/${id}`, { method: 'DELETE' });
    if (res.status === 401) {
      cameraWebSocket.broadcast({ type: 'AUTH_EXPIRED', payload: {} });
      throw new Error('Session expired. Please log in again.');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Failed to delete camera: ${res.statusText}`);
    }
    return true;
  }

  async testConnection(data: {
    rtspUrl: string; username?: string; password?: string;
  }): Promise<CameraTestResult> {
    return this._json<CameraTestResult>('/cameras/test', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async testExistingCameraConnection(
    cameraId: string,
    overrideData?: { rtspUrl?: string; username?: string; password?: string }
  ): Promise<CameraTestResult> {
    return this._json<CameraTestResult>(`/cameras/${cameraId}/test`, {
      method: 'POST',
      body: overrideData ? JSON.stringify(overrideData) : undefined,
    });
  }

  async requestStream(cameraId: string): Promise<StreamInfo> {
    return this._json<StreamInfo>(`/cameras/${cameraId}/stream/start`, { method: 'POST' });
  }

  async stopStream(cameraId: string): Promise<void> {
    try {
      await this._fetch(`/cameras/${cameraId}/stream/stop`, { method: 'POST' });
    } catch (e) {
      console.warn(`Failed to notify stream stop for ${cameraId}:`, e);
    }
  }

  async getCameraStatus(cameraId: string): Promise<Camera> {
    return this._json<Camera>(`/cameras/${cameraId}/status`);
  }

  async getCameraAi(cameraId: string): Promise<CameraAiState> {
    return this._json<CameraAiState>(`/cameras/${cameraId}/ai`);
  }

  async triggerCameraAiAnalysis(cameraId: string): Promise<CameraAiState> {
    return this._json<CameraAiState>(`/cameras/${cameraId}/ai/analyze`, { method: 'POST' });
  }

  async detectFrame(cameraId: string, imageBase64: string): Promise<CameraAiState> {
    return this._json<CameraAiState>(`/cameras/${cameraId}/ai/detect-frame`, {
      method: 'POST',
      body: JSON.stringify({ image: imageBase64 }),
    });
  }

  async getRecentAnomalies(limit: number = 20): Promise<CameraAnomaly[]> {
    return this._json<CameraAnomaly[]>(`/cameras/anomalies/recent?limit=${limit}`);
  }

  async resetToDefaults(): Promise<Camera[]> {
    return this._json<Camera[]>('/cameras/seed', { method: 'POST' });
  }
}

export const cameraService = new CameraService();
