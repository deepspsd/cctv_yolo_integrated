import { AttendanceRecord, AttendanceSummary } from '../types';
import { apiFetch } from './authService';

export interface AttendanceFilters {
  date?: string;
  employeeId?: string;
  department?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export const attendanceService = {
  async getAttendanceRecords(filters: AttendanceFilters = {}): Promise<AttendanceRecord[]> {
    const qs = new URLSearchParams();
    if (filters.date) qs.append('date', filters.date);
    if (filters.employeeId) qs.append('employeeId', filters.employeeId);
    if (filters.department && filters.department !== 'ALL') qs.append('department', filters.department);
    if (filters.status && filters.status !== 'ALL') qs.append('status', filters.status);
    if (filters.limit) qs.append('limit', String(filters.limit));
    if (filters.offset) qs.append('offset', String(filters.offset));

    const query = qs.toString();
    const res = await apiFetch(`/attendance${query ? `?${query}` : ''}`);
    if (!res.ok) throw new Error(`Failed to load attendance records: ${res.statusText}`);
    return res.json();
  },

  async getSummary(date?: string): Promise<AttendanceSummary> {
    const qs = date ? `?date=${encodeURIComponent(date)}` : '';
    const res = await apiFetch(`/attendance/summary${qs}`);
    if (!res.ok) throw new Error(`Failed to load attendance summary: ${res.statusText}`);
    return res.json();
  },

  async exportAttendance(format: 'csv' | 'xlsx', date?: string, department?: string): Promise<void> {
    const qs = new URLSearchParams();
    qs.append('format', format);
    if (date) qs.append('date', date);
    if (department && department !== 'ALL') qs.append('department', department);

    const res = await apiFetch(`/attendance/export?${qs.toString()}`);
    if (!res.ok) throw new Error(`Export failed: ${res.statusText}`);

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance_export_${date || new Date().toISOString().split('T')[0]}.${format}`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  },
};
