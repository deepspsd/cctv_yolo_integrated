import { AnomalyAlertEvent } from '../types';
import { apiFetch, getStoredToken } from './authService';

const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:5000/api';

export interface AnomalyFilters {
  cameraId?: string;
  zone?: string;
  anomalyType?: string;
  status?: string;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export const anomalyService = {
  async getAnomalies(filters: AnomalyFilters = {}): Promise<AnomalyAlertEvent[]> {
    const params = new URLSearchParams();
    if (filters.cameraId) params.append('cameraId', filters.cameraId);
    if (filters.zone && filters.zone !== 'ALL') params.append('zone', filters.zone);
    if (filters.anomalyType && filters.anomalyType !== 'ALL') params.append('anomalyType', filters.anomalyType);
    if (filters.status && filters.status !== 'ALL') params.append('status', filters.status);
    if (filters.date) params.append('date', filters.date);
    if (filters.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters.dateTo) params.append('dateTo', filters.dateTo);
    if (filters.order) params.append('order', filters.order);
    if (filters.limit) params.append('limit', String(filters.limit));
    if (filters.offset) params.append('offset', String(filters.offset));

    const qs = params.toString();
    const path = `/anomalies${qs ? `?${qs}` : ''}`;
    const res = await apiFetch(path);
    if (!res.ok) {
      throw new Error(`Failed to load anomalies: ${res.statusText}`);
    }
    return res.json();
  },

  async getEvidenceDates(): Promise<{ date: string; totalAlerts: number; evidencePhotos: number }[]> {
    try {
      const res = await apiFetch('/anomalies/dates');
      if (!res.ok) return [];
      return await res.json();
    } catch {
      return [];
    }
  },

  async getAnomaly(id: string): Promise<AnomalyAlertEvent> {
    const res = await apiFetch(`/anomalies/${id}`);
    if (!res.ok) {
      throw new Error(`Failed to load anomaly: ${res.statusText}`);
    }
    return res.json();
  },

  async updateAnomalyStatus(id: string, status: string): Promise<AnomalyAlertEvent> {
    const res = await apiFetch(`/anomalies/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `Failed to update status: ${res.statusText}`);
    }
    return res.json();
  },

  async deleteAnomaly(id: string): Promise<{ success: boolean; id: string; message: string }> {
    const res = await apiFetch(`/anomalies/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `Failed to delete incident: ${res.statusText}`);
    }
    return res.json();
  },

  async getAiStatus(): Promise<any> {
    const res = await apiFetch('/ai/status');
    if (!res.ok) {
      throw new Error(`Failed to fetch AI status: ${res.statusText}`);
    }
    return res.json();
  },

  async getAiClasses(): Promise<any> {
    const res = await apiFetch('/ai/classes');
    if (!res.ok) {
      throw new Error(`Failed to fetch AI classes: ${res.statusText}`);
    }
    return res.json();
  },

  /**
   * Safe backend-served endpoint for evidence images.
   * Direct streaming via /api/anomalies/{id}/evidence?token=...
   */
  getEvidenceUrl(id: string): string {
    if (!id) return '';
    const token = getStoredToken();
    const qs = token ? `?token=${encodeURIComponent(token)}` : '';
    return `${API_BASE_URL}/anomalies/${id}/evidence${qs}`;
  },

  /**
   * Direct snapshot path resolver pointing to static file mount or streaming endpoint.
   */
  getSnapshotUrl(snapshotPath: string | null | undefined, anomalyId?: string): string {
    // Primary: stream decrypted AES-256 evidence image from database via authenticated endpoint
    if (anomalyId) {
      return this.getEvidenceUrl(anomalyId);
    }
    if (snapshotPath) {
      const clean = snapshotPath.replace(/\\/g, '/').replace(/^\.?\//, '');
      if (clean.startsWith('http')) return clean;
      return `http://localhost:5000/${clean}`;
    }
    return '';
  }
};
