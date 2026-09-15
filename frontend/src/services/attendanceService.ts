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
    const rawList: any[] = await res.json();
    return rawList.map((r) => ({
      id: r.id,
      employeeId: r.employeeId || r.employee_id || '',
      employeeCode: r.employeeCode || r.employee_code || '',
      employeeName: r.employeeName || r.employee_name || 'Staff',
      department: r.department || 'General',
      designation: r.designation || r.role || 'Staff',
      date: r.date || '',
      clockInTime: r.clockInTime || r.firstSeenAt || r.first_seen_at || '',
      clockInCameraName: r.clockInCameraName || r.clock_in_camera_name || null,
      lastSeenTime: r.lastSeenTime || r.lastSeenAt || r.last_seen_at || '',
      lastSeenCameraName: r.lastSeenCameraName || r.last_seen_camera_name || null,
      clockOutTime: r.clockOutTime || null,
      totalHours: r.totalHours !== undefined ? Number(r.totalHours) : (r.durationHours ? parseFloat(r.durationHours) : 0),
      status: r.status || 'PRESENT',
      bestQualityScore: r.clockInConfidence || r.bestQualityScore || 1.0,
      observationsCount: r.observationsCount || 1,
      ppeViolationsCount: r.ppeViolationsCount || 0,
      updatedAt: r.lastSeenAt || r.updatedAt || new Date().toISOString(),
    }));
  },

  async getSummary(date?: string): Promise<AttendanceSummary> {
    const qs = date ? `?date=${encodeURIComponent(date)}` : '';
    const res = await apiFetch(`/attendance/summary${qs}`);
    if (!res.ok) throw new Error(`Failed to load attendance summary: ${res.statusText}`);
    const s: any = await res.json();
    return {
      date: s.date || '',
      totalRegistered: s.totalRegistered ?? s.totalEmployees ?? s.total_employees ?? 0,
      totalPresent: s.totalPresent ?? s.clockedInToday ?? s.clocked_in_today ?? 0,
      currentlyOnSite: s.currentlyOnSite ?? s.activeOnSite ?? s.active_on_site ?? 0,
      attendanceRate: s.attendanceRate ?? s.attendance_rate ?? 0,
      totalPpeViolationsToday: s.totalPpeViolationsToday ?? 0,
    };
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
