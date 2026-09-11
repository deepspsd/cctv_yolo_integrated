/**
 * authService — connects to real FastAPI JWT backend.
 * Token stored in localStorage under CAMEYE_TOKEN_KEY.
 * All API calls send Authorization: Bearer <token>.
 */
import { User, LoginCredentials, RegisterData } from '../types';

const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:5000/api';

const TOKEN_KEY = 'cameye_access_token';
const REFRESH_TOKEN_KEY = 'cameye_refresh_token';
const USER_KEY  = 'cameye_current_user';

// ─── Token storage helpers ──────────────────────────────────────────────────

export function getStoredToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function getStoredRefreshToken(): string | null {
  try { return localStorage.getItem(REFRESH_TOKEN_KEY); } catch { return null; }
}

function storeToken(token: string): void {
  try { localStorage.setItem(TOKEN_KEY, token); } catch {}
}

function storeRefreshToken(token: string): void {
  try { localStorage.setItem(REFRESH_TOKEN_KEY, token); } catch {}
}

function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {}
}

function storeUser(user: User): void {
  try { localStorage.setItem(USER_KEY, JSON.stringify(user)); } catch {}
}

// ─── Fetch with auth header & silent token refresh ─────────────────────────

let refreshPromise: Promise<boolean> | null = null;

async function tryRefreshToken(): Promise<boolean> {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) return false;

  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) {
      clearToken();
      return false;
    }
    const data = await res.json();
    if (data.access_token) {
      storeToken(data.access_token);
      if (data.refresh_token) {
        storeRefreshToken(data.refresh_token);
      }
      return true;
    }
  } catch {
    clearToken();
    return false;
  }
  return false;
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  let res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  // If 401 Unauthorized on protected routes, attempt silent token refresh once
  if (res.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/refresh')) {
    if (!refreshPromise) {
      refreshPromise = tryRefreshToken().finally(() => {
        refreshPromise = null;
      });
    }
    const refreshed = await refreshPromise;
    if (refreshed) {
      const newToken = getStoredToken();
      if (newToken) {
        headers['Authorization'] = `Bearer ${newToken}`;
      }
      res = await fetch(`${API_BASE}${path}`, { ...init, headers });
    }
  }

  return res;
}

// ─── Map API user profile → frontend User type ──────────────────────────────

function mapProfile(profile: any): User {
  return {
    id:        profile.id,
    name:      profile.name,
    email:     profile.email,
    role:      profile.role,
    facility:  profile.facility,
    badgeId:   profile.badge_id ?? '',
    lastLogin: profile.last_login ?? undefined,
  };
}

// ─── AuthService class ──────────────────────────────────────────────────────

class AuthService {
  /** Return cached user without network call — null if not logged in. */
  getCurrentUser(): User | null {
    try {
      const token = getStoredToken();
      if (!token) return null;
      const raw = localStorage.getItem(USER_KEY);
      if (raw) return JSON.parse(raw) as User;
    } catch {}
    return null;
  }

  /** POST /api/auth/login — returns User, stores token. */
  async login(credentials: LoginCredentials): Promise<User> {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: credentials.email,
        password: credentials.password,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Authentication failed. Please verify credentials.');
    }

    const data = await res.json();
    storeToken(data.access_token);
    if (data.refresh_token) {
      storeRefreshToken(data.refresh_token);
    }
    const user = mapProfile(data.user);
    storeUser(user);
    return user;
  }

  /** POST /api/auth/register — returns User, stores token. */
  async register(data: RegisterData): Promise<User> {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:             data.name,
        email:            data.email,
        password:         data.password,
        confirm_password: data.confirmPassword,
        role:             data.role,
        facility:         data.facility,
        badge_id:         data.badgeId || undefined,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      // Pydantic validation errors come as an array
      if (Array.isArray(err.detail)) {
        const msg = err.detail.map((e: any) => e.msg).join(' ');
        throw new Error(msg);
      }
      throw new Error(err.detail || 'Registration failed.');
    }

    const payload = await res.json();
    storeToken(payload.access_token);
    if (payload.refresh_token) {
      storeRefreshToken(payload.refresh_token);
    }
    const user = mapProfile(payload.user);
    storeUser(user);
    return user;
  }

  /** GET /api/auth/me — refresh profile from server. */
  async refreshMe(): Promise<User | null> {
    try {
      const res = await apiFetch('/auth/me');
      if (!res.ok) return null;
      const profile = await res.json();
      const user = mapProfile(profile);
      storeUser(user);
      return user;
    } catch {
      return null;
    }
  }

  /** POST /api/auth/logout — revokes token server-side + clears local storage. */
  async logout(): Promise<void> {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch {
      // Always clear local even if request fails
    } finally {
      clearToken();
    }
  }

  /** True if a token is present in storage (does NOT validate expiry). */
  isLoggedIn(): boolean {
    return !!getStoredToken();
  }
}

export const authService = new AuthService();
