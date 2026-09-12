import { Employee, FaceTemplate, BodyTemplate } from '../types';
import { apiFetch } from './authService';

export interface CreateEmployeePayload {
  employeeCode: string;
  fullName: string;
  department: string;
  designation: string;
  notes?: string;
}

export interface UpdateEmployeePayload {
  employeeCode?: string;
  fullName?: string;
  department?: string;
  designation?: string;
  isActive?: boolean;
  notes?: string;
}

export interface EnrollmentResult {
  templateId: string;
  qualityScore: number;
  qualityCategory: string;
  poseAngle: string;
  message: string;
}

export const employeeService = {
  async getEmployees(params?: { department?: string; activeOnly?: boolean; search?: string }): Promise<Employee[]> {
    const qs = new URLSearchParams();
    if (params?.department && params.department !== 'ALL') qs.append('department', params.department);
    if (params?.activeOnly !== undefined) qs.append('activeOnly', String(params.activeOnly));
    if (params?.search) qs.append('search', params.search);

    const query = qs.toString();
    const res = await apiFetch(`/employees${query ? `?${query}` : ''}`);
    if (!res.ok) throw new Error(`Failed to load employees: ${res.statusText}`);
    const data = await res.json();
    return (data || []).map((raw: any) => ({
      id: raw.id,
      employeeCode: raw.employeeCode || raw.employee_code || '',
      fullName: raw.fullName || raw.name || 'Unknown Staff',
      department: raw.department || 'Production',
      designation: raw.designation || raw.role || 'Staff',
      avatarUrl: raw.avatarUrl || null,
      isActive: raw.isActive !== undefined ? raw.isActive : (raw.active !== undefined ? raw.active : true),
      notes: raw.notes || null,
      faceTemplatesCount: raw.faceTemplatesCount || raw.templateCount || 0,
      bodyTemplatesCount: raw.bodyTemplatesCount || 0,
      createdAt: raw.createdAt || raw.created_at || new Date().toISOString(),
      updatedAt: raw.updatedAt || raw.updated_at || new Date().toISOString(),
    }));
  },

  async getEmployee(id: string): Promise<Employee> {
    const res = await apiFetch(`/employees/${id}`);
    if (!res.ok) throw new Error(`Failed to get employee details: ${res.statusText}`);
    const raw = await res.json();
    return {
      id: raw.id,
      employeeCode: raw.employeeCode || raw.employee_code || '',
      fullName: raw.fullName || raw.name || 'Unknown Staff',
      department: raw.department || 'Production',
      designation: raw.designation || raw.role || 'Staff',
      avatarUrl: raw.avatarUrl || null,
      isActive: raw.isActive !== undefined ? raw.isActive : (raw.active !== undefined ? raw.active : true),
      notes: raw.notes || null,
      faceTemplatesCount: raw.faceTemplatesCount || raw.templateCount || 0,
      bodyTemplatesCount: raw.bodyTemplatesCount || 0,
      createdAt: raw.createdAt || raw.created_at || new Date().toISOString(),
      updatedAt: raw.updatedAt || raw.updated_at || new Date().toISOString(),
    };
  },

  async createEmployee(payload: CreateEmployeePayload): Promise<Employee> {
    const res = await apiFetch('/employees', {
      method: 'POST',
      body: JSON.stringify({
        employeeCode: payload.employeeCode,
        name: payload.fullName,
        department: payload.department,
        role: payload.designation,
        active: true,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to create employee');
    }
    const raw = await res.json();
    return {
      id: raw.id,
      employeeCode: raw.employeeCode || raw.employee_code || '',
      fullName: raw.fullName || raw.name || payload.fullName,
      department: raw.department || payload.department,
      designation: raw.designation || raw.role || payload.designation,
      avatarUrl: null,
      isActive: true,
      notes: payload.notes || null,
      faceTemplatesCount: 0,
      bodyTemplatesCount: 0,
      createdAt: raw.createdAt || new Date().toISOString(),
      updatedAt: raw.updatedAt || new Date().toISOString(),
    };
  },

  async updateEmployee(id: string, payload: UpdateEmployeePayload): Promise<Employee> {
    const res = await apiFetch(`/employees/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: payload.fullName,
        department: payload.department,
        role: payload.designation,
        active: payload.isActive,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to update employee');
    }
    const raw = await res.json();
    return {
      id: raw.id,
      employeeCode: raw.employeeCode || raw.employee_code || '',
      fullName: raw.fullName || raw.name || '',
      department: raw.department || '',
      designation: raw.designation || raw.role || '',
      avatarUrl: null,
      isActive: raw.isActive !== undefined ? raw.isActive : (raw.active !== undefined ? raw.active : true),
      notes: payload.notes || null,
      faceTemplatesCount: raw.faceTemplatesCount || raw.templateCount || 0,
      bodyTemplatesCount: 0,
      createdAt: raw.createdAt || new Date().toISOString(),
      updatedAt: raw.updatedAt || new Date().toISOString(),
    };
  },

  async deleteEmployee(id: string): Promise<void> {
    const res = await apiFetch(`/employees/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`Failed to delete employee: ${res.statusText}`);
  },

  async enrollFace(employeeId: string, imageBase64: string, poseAngle: string = 'FRONTAL'): Promise<EnrollmentResult> {
    const res = await apiFetch(`/employees/${employeeId}/face-enrollment`, {
      method: 'POST',
      body: JSON.stringify({
        imageBase64,
        poseAngle,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to enroll face');
    }
    return res.json();
  },

  async enrollBody(employeeId: string, imageBase64: string): Promise<EnrollmentResult> {
    const res = await apiFetch(`/employees/${employeeId}/body-enrollment`, {
      method: 'POST',
      body: JSON.stringify({ imageBase64 }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to enroll body descriptor');
    }
    return res.json();
  },

  async getTemplates(employeeId: string): Promise<{ faceTemplates: FaceTemplate[]; bodyTemplates: BodyTemplate[] }> {
    const res = await apiFetch(`/employees/${employeeId}/templates`);
    if (!res.ok) throw new Error('Failed to fetch biometric templates');
    const raw = await res.json();
    if (Array.isArray(raw)) {
      const faceTemplates: FaceTemplate[] = raw
        .filter((t: any) => t.type === 'face')
        .map((t: any) => ({
          id: t.id,
          poseAngle: t.pose || t.poseAngle || 'FRONTAL',
          qualityScore: t.qualityScore ?? 1.0,
          sourceCamera: t.cameraId || t.sourceCamera || null,
          createdAt: t.createdAt || new Date().toISOString(),
        }));
      const bodyTemplates: BodyTemplate[] = raw
        .filter((t: any) => t.type === 'body')
        .map((t: any) => ({
          id: t.id,
          qualityScore: t.qualityScore ?? 1.0,
          sourceCamera: t.cameraId || t.sourceCamera || null,
          createdAt: t.createdAt || new Date().toISOString(),
        }));
      return { faceTemplates, bodyTemplates };
    }
    return {
      faceTemplates: Array.isArray(raw?.faceTemplates) ? raw.faceTemplates : [],
      bodyTemplates: Array.isArray(raw?.bodyTemplates) ? raw.bodyTemplates : [],
    };
  },

  async deleteTemplate(templateId: string, type: 'face' | 'body'): Promise<void> {
    const res = await apiFetch(`/employees/templates/${templateId}?type=${type}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`Failed to delete template: ${res.statusText}`);
  },
};
