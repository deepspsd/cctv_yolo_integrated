import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Users,
  UserPlus,
  Search,
  Check,
  X,
  Upload,
  Camera as CameraIcon,
  ShieldCheck,
  AlertTriangle,
  Trash2,
  Edit2,
  RefreshCw,
  Sparkles,
  Info,
  CheckCircle2,
  User,
} from 'lucide-react';
import { Employee, FaceTemplate, BodyTemplate } from '../types';
import { employeeService, CreateEmployeePayload, UpdateEmployeePayload } from '../services/employeeService';
import { soundService } from '../services/soundService';

export const EmployeesPage: React.FC = () => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('ALL');
  const [photoVersion, setPhotoVersion] = useState<number>(Date.now());

  // Modal States
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [enrollModalEmployee, setEnrollModalEmployee] = useState<Employee | null>(null);

  // Add Form State
  const [formData, setFormData] = useState<CreateEmployeePayload>({
    employeeCode: '',
    fullName: '',
    department: 'Spinning',
    designation: 'Operator',
    notes: '',
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Edit Form State
  const [editModalEmployee, setEditModalEmployee] = useState<Employee | null>(null);
  const [editFormData, setEditFormData] = useState<UpdateEmployeePayload>({
    employeeCode: '',
    fullName: '',
    department: 'Spinning',
    designation: 'Operator',
    isActive: true,
    notes: '',
  });
  const [editFormError, setEditFormError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  // Delete State
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; code: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Face & Body Enrollment State
  const [enrollMode, setEnrollMode] = useState<'FACE' | 'BODY'>('FACE');
  const [enrollPose, setEnrollPose] = useState<string>('FRONTAL');
  const [enrollImageBase64, setEnrollImageBase64] = useState<string | null>(null);
  const [enrollStatus, setEnrollStatus] = useState<string | null>(null);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [existingTemplates, setExistingTemplates] = useState<{
    faceTemplates: FaceTemplate[];
    bodyTemplates: BodyTemplate[];
  } | null>(null);
  const [isDeletingTemplate, setIsDeletingTemplate] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadEmployees = async () => {
    setIsLoading(true);
    try {
      const list = await employeeService.getEmployees({
        department: selectedDepartment !== 'ALL' ? selectedDepartment : undefined,
        search: searchQuery.trim() ? searchQuery : undefined,
      });
      setEmployees(list);
      setPhotoVersion(Date.now());
    } catch (err) {
      console.error('Failed to load employees:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadEmployees();
  }, [selectedDepartment]);

  const departments = useMemo(() => {
    const set = new Set<string>();
    employees.forEach((e) => {
      if (e.department) set.add(e.department);
    });
    if (!set.has('Spinning')) set.add('Spinning');
    if (!set.has('Weaving')) set.add('Weaving');
    if (!set.has('Quality Control')) set.add('Quality Control');
    if (!set.has('Maintenance')) set.add('Maintenance');
    return Array.from(set).sort();
  }, [employees]);

  const filteredEmployees = useMemo(() => {
    if (!searchQuery.trim()) return employees;
    const q = searchQuery.toLowerCase();
    return employees.filter(
      (e) =>
        e.fullName.toLowerCase().includes(q) ||
        e.employeeCode.toLowerCase().includes(q) ||
        e.designation.toLowerCase().includes(q) ||
        e.department.toLowerCase().includes(q)
    );
  }, [employees, searchQuery]);

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.employeeCode || !formData.fullName) {
      setFormError('Employee Code and Full Name are required.');
      return;
    }
    setIsSaving(true);
    setFormError(null);
    soundService.playTactileBlip(840, 0.02);
    try {
      const created = await employeeService.createEmployee(formData);
      setIsAddModalOpen(false);
      setFormData({
        employeeCode: '',
        fullName: '',
        department: 'Spinning',
        designation: 'Operator',
        notes: '',
      });
      await loadEmployees();
      // Prompt direct face enrollment for the newly created employee
      setEnrollModalEmployee(created);
    } catch (err: any) {
      setFormError(err.message || 'Failed to create employee');
    } finally {
      setIsSaving(false);
    }
  };

  const openEnrollmentModal = async (emp: Employee) => {
    setEnrollModalEmployee(emp);
    setEnrollImageBase64(null);
    setEnrollStatus(null);
    setEnrollError(null);
    try {
      const t = await employeeService.getTemplates(emp.id);
      setExistingTemplates(t);
      const hasFrontal = (t.faceTemplates || []).some((x) => x.poseAngle === 'FRONTAL');
      const hasLeft = (t.faceTemplates || []).some((x) => x.poseAngle === 'LEFT_PROFILE');
      const hasRight = (t.faceTemplates || []).some((x) => x.poseAngle === 'RIGHT_PROFILE');
      const hasBody = (t.bodyTemplates || []).length > 0;

      if (!hasFrontal) {
        setEnrollMode('FACE');
        setEnrollPose('FRONTAL');
      } else if (!hasLeft) {
        setEnrollMode('FACE');
        setEnrollPose('LEFT_PROFILE');
      } else if (!hasRight) {
        setEnrollMode('FACE');
        setEnrollPose('RIGHT_PROFILE');
      } else if (!hasBody) {
        setEnrollMode('BODY');
        setEnrollPose('BODY');
      } else {
        setEnrollMode('FACE');
        setEnrollPose('FRONTAL');
      }
    } catch {
      setExistingTemplates(null);
      setEnrollMode('FACE');
      setEnrollPose('FRONTAL');
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = reader.result as string;
      setEnrollImageBase64(b64);
      setEnrollStatus(null);
      setEnrollError(null);
    };
    reader.readAsDataURL(file);
  };

  const handleEnroll = async () => {
    if (!enrollModalEmployee || !enrollImageBase64) return;
    setIsEnrolling(true);
    setEnrollStatus(null);
    setEnrollError(null);
    soundService.playTactileBlip(860, 0.03);
    try {
      let successMsg = '';
      if (enrollMode === 'FACE') {
        const res = await employeeService.enrollFace(enrollModalEmployee.id, enrollImageBase64, enrollPose);
        successMsg = `✓ ${enrollPose} face template enrolled! Quality: ${(res.qualityScore * 100).toFixed(0)}%`;
      } else {
        await employeeService.enrollBody(enrollModalEmployee.id, enrollImageBase64);
        successMsg = '✓ Full-Body Re-ID profile enrolled!';
      }

      const updatedVersion = Date.now();
      setPhotoVersion(updatedVersion);
      setEnrollImageBase64(null);

      const updatedTemplates = await employeeService.getTemplates(enrollModalEmployee.id);
      setExistingTemplates(updatedTemplates);
      await loadEmployees();

      // Gracious auto-progression through compulsory captures
      if (enrollMode === 'FACE' && enrollPose === 'FRONTAL') {
        setEnrollStatus(`${successMsg} — Frontal saved to card! Gracioulsy moving to Left Profile (~30°)...`);
        setTimeout(() => {
          setEnrollMode('FACE');
          setEnrollPose('LEFT_PROFILE');
          setEnrollStatus(null);
        }, 850);
      } else if (enrollMode === 'FACE' && enrollPose === 'LEFT_PROFILE') {
        setEnrollStatus(`${successMsg} — Left Profile saved! Gracioulsy moving to Right Profile (~30°)...`);
        setTimeout(() => {
          setEnrollMode('FACE');
          setEnrollPose('RIGHT_PROFILE');
          setEnrollStatus(null);
        }, 850);
      } else if (enrollMode === 'FACE' && enrollPose === 'RIGHT_PROFILE') {
        setEnrollStatus(`${successMsg} — Right Profile saved! Gracioulsy moving to Full-Body Re-ID...`);
        setTimeout(() => {
          setEnrollMode('BODY');
          setEnrollPose('BODY');
          setEnrollStatus(null);
        }, 850);
      } else if (enrollMode === 'BODY') {
        setEnrollStatus('🎉 Complete! All 4/4 Biometric Profiles Enrolled! Employee is fully primed for CCTV recognition.');
      }
    } catch (err: any) {
      setEnrollError(err.message || `${enrollMode === 'FACE' ? 'Face' : 'Body Re-ID'} enrollment failed.`);
    } finally {
      setIsEnrolling(false);
    }
  };

  const handleDeleteCurrentTemplate = async () => {
    if (!enrollModalEmployee) return;
    const poseToDelete = enrollMode === 'FACE' ? enrollPose : 'BODY';
    if (!confirm(`Delete ${poseToDelete} biometric template from database for ${enrollModalEmployee.fullName}?`)) return;
    setIsDeletingTemplate(true);
    soundService.playTactileBlip(500, 0.04);
    try {
      await employeeService.deleteTemplate(enrollModalEmployee.id, poseToDelete);
      const updated = await employeeService.getTemplates(enrollModalEmployee.id);
      setExistingTemplates(updated);
      setEnrollImageBase64(null);
      setEnrollStatus(`✓ ${poseToDelete} template removed from database.`);
      await loadEmployees();
    } catch (err: any) {
      setEnrollError(err.message || 'Failed to delete template');
    } finally {
      setIsDeletingTemplate(false);
    }
  };

  const openEditModal = (emp: Employee) => {
    setEditModalEmployee(emp);
    setEditFormData({
      employeeCode: emp.employeeCode,
      fullName: emp.fullName,
      department: emp.department,
      designation: emp.designation,
      isActive: emp.isActive,
      notes: emp.notes || '',
    });
    setEditFormError(null);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModalEmployee) return;
    if (!editFormData.fullName?.trim() || !editFormData.employeeCode?.trim()) {
      setEditFormError('Employee Code and Full Name are required.');
      return;
    }
    setIsUpdating(true);
    setEditFormError(null);
    soundService.playTactileBlip(840, 0.02);
    try {
      await employeeService.updateEmployee(editModalEmployee.id, editFormData);
      setEditModalEmployee(null);
      await loadEmployees();
    } catch (err: any) {
      setEditFormError(err.message || 'Failed to update employee in database');
    } finally {
      setIsUpdating(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    soundService.playTactileBlip(500, 0.04);
    try {
      await employeeService.deleteEmployee(deleteTarget.id);
      setDeleteTarget(null);
      await loadEmployees();
    } catch (err: any) {
      alert(err.message || 'Failed to delete employee from database');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="w-full space-y-6">
      {/* ─── Top Header Section ────────────────────────────────────────── */}
      <section id="employees-header-section" className="relative">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-4 border-b border-black/[0.08] dark:border-white/[0.08]">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse shadow-[0_0_6px_rgba(6,182,212,0.8)]" />
              <span className="text-[11px] font-mono uppercase tracking-wider text-[#6b6b6b] dark:text-[#a1a1aa]">
                Workforce & Biometric Enrollment
              </span>
            </div>
            <h1
              id="employees-main-title"
              className="text-[30px] sm:text-[38px] font-semibold text-[#0a0a0a] dark:text-[#fafafa] tracking-tightest leading-tight flex items-center gap-3"
            >
              Employee Directory
            </h1>
            <p className="text-[14px] sm:text-[15px] text-[#6b6b6b] dark:text-[#a1a1aa] mt-0.5 tracking-tight">
              Manage registered staff, multi-angle face embeddings, and Person Re-ID biometric templates.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => {
                soundService.playTactileBlip(750, 0.02);
                setIsAddModalOpen(true);
              }}
              className="flex items-center gap-1.5 rounded-xl border border-orange-500/50 bg-orange-500 hover:bg-orange-600 px-4 py-2 text-xs font-semibold text-white transition cursor-pointer shadow-[0_0_12px_rgba(249,115,22,0.3)]"
            >
              <UserPlus className="w-4 h-4" />
              <span>Enroll New Employee</span>
            </button>

            <button
              onClick={loadEmployees}
              disabled={isLoading}
              className="flex items-center gap-1.5 rounded-xl border border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.05] hover:bg-black/[0.06] dark:hover:bg-white/10 px-3.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200 transition cursor-pointer disabled:opacity-50"
              title="Refresh Directory"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>
      </section>

      {/* ─── Search & Filter Toolbar ───────────────────────────────────── */}
      <section
        id="employee-controls-bar"
        className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-3 sm:p-3.5 bg-white dark:bg-[#111116] border border-black/[0.08] dark:border-white/[0.08] rounded-2xl shadow-xs transition-colors"
      >
        {/* Left: Command Search input */}
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8c8c8c] dark:text-[#71717a] pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search employee name, code, designation, or department..."
            className="w-full pl-9 pr-10 py-2 text-[13.5px] bg-[#fbfbfb] dark:bg-[#171720] border border-black/[0.1] dark:border-white/[0.1] rounded-xl text-[#0a0a0a] dark:text-white placeholder-[#8c8c8c] dark:placeholder-[#71717a] tracking-tight focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30 transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8c8c8c] hover:text-black dark:hover:text-white p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer transition-colors"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Right: Department Select & Counter */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
          <div className="relative">
            <select
              value={selectedDepartment}
              onChange={(e) => {
                soundService.playTactileBlip(600, 0.02);
                setSelectedDepartment(e.target.value);
              }}
              className="appearance-none text-[13px] font-medium tracking-tight bg-[#fbfbfb] dark:bg-[#171720] text-[#0a0a0a] dark:text-white border border-black/[0.1] dark:border-white/[0.1] rounded-xl pl-3 pr-8 py-2 hover:border-black/30 dark:hover:border-orange-500/50 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30 cursor-pointer transition-all"
            >
              <option value="ALL">All Departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-[#8c8c8c] dark:text-[#71717a]">
              ▼
            </div>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-2 bg-black/[0.04] dark:bg-white/[0.05] border border-black/[0.06] dark:border-white/[0.08] rounded-xl font-mono text-[12px] text-[#6b6b6b] dark:text-[#a1a1aa]">
            <span className="font-semibold text-black dark:text-white">{filteredEmployees.length}</span>
            <span>of</span>
            <span>{employees.length}</span>
            <span className="hidden sm:inline">Staff</span>
          </div>
        </div>
      </section>

      {/* ─── Employee Cards Grid ───────────────────────────────────────── */}
      <section className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5">
        {filteredEmployees.length === 0 ? (
          <div className="col-span-full py-16 text-center text-slate-500 bg-white dark:bg-[#111116] rounded-2xl border border-black/[0.08] dark:border-white/[0.08] p-8">
            <Users className="w-10 h-10 mx-auto mb-2 text-slate-400 opacity-50" />
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">No employees found.</p>
            <p className="text-xs text-slate-400 mt-1">
              Click "Enroll New Employee" to register staff and add biometric templates.
            </p>
          </div>
        ) : (
          filteredEmployees.map((emp) => {
            const initials =
              (emp.fullName || 'Staff')
                .split(' ')
                .filter(Boolean)
                .map((n) => n[0])
                .slice(0, 2)
                .join('') || 'ST';
            const hasBiometrics = (emp.faceTemplatesCount || 0) > 0 || (emp.enrolledAngles && emp.enrolledAngles.length > 0);
            const completeness = emp.completenessScore ?? ((emp.enrolledAngles?.length) || (hasBiometrics ? 1 : 0));
            const isAllDone = completeness === 4;
            const photoUrl = (hasBiometrics || emp.avatarUrl)
              ? employeeService.getEmployeePhotoUrl(emp.id, 'FRONTAL', photoVersion)
              : null;

            return (
              <div
                key={emp.id}
                className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border bg-white dark:bg-[#111116] border-black/[0.08] dark:border-white/[0.08] hover:border-orange-500/50 dark:hover:border-orange-500/50 shadow-xs hover:shadow-xl dark:hover:shadow-[0_8px_30px_rgba(0,0,0,0.8)] transition-all duration-200"
              >
                {/* 1. CCTV Face / Video Viewport */}
                <div className="relative h-48 w-full overflow-hidden bg-black flex flex-col justify-between p-3 select-none">
                  {/* Frontal Face Photo (Decrypted from DB) */}
                  {photoUrl ? (
                    <img
                      key={`photo-${emp.id}-${photoVersion}`}
                      src={photoUrl}
                      alt={emp.fullName}
                      className="absolute inset-0 w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-300"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        const fallback = e.currentTarget.parentElement?.querySelector('.avatar-fallback') as HTMLElement;
                        if (fallback) fallback.style.display = 'flex';
                      }}
                    />
                  ) : null}

                  {/* Clean top and bottom edge vignettes for badge contrast, keeping photo bright and vivid */}
                  <div className="absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-black/70 to-transparent pointer-events-none z-10" />
                  <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/75 to-transparent pointer-events-none z-10" />

                  {/* Top Bar inside Viewport: ONLY Code on Left and Active Status on Right (Un-compacted!) */}
                  <div className="relative z-20 flex items-center justify-between">
                    <span className="px-2.5 py-1 rounded-md text-[11px] font-mono font-bold bg-black/85 text-white backdrop-blur-md border border-white/20 shadow-xs tracking-wider">
                      {emp.employeeCode}
                    </span>

                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-tight backdrop-blur-md flex items-center gap-1.5 shadow-xs ${
                        emp.isActive ? 'bg-emerald-500/90 text-white' : 'bg-red-500/90 text-white'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          emp.isActive ? 'bg-white animate-pulse' : 'bg-white'
                        }`}
                      />
                      {emp.isActive ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </div>

                  {/* Center HUD / Avatar fallback when no photo is uploaded */}
                  <div
                    className={`avatar-fallback relative z-20 flex flex-col items-center justify-center my-auto transition-transform duration-200 ${
                      photoUrl ? 'hidden' : 'flex'
                    }`}
                  >
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#1c1c26] to-[#0d0d12] border border-white/20 text-orange-400 font-bold font-mono text-xl flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform duration-200">
                      {initials}
                    </div>
                    <span className="text-[10px] text-zinc-400 font-mono mt-1">No Frontal Photo</span>
                  </div>

                  {/* Quick Action Overlay on Hover */}
                  <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-30 flex flex-col items-center justify-center gap-2 pointer-events-auto">
                    <button
                      type="button"
                      onClick={() => openEnrollmentModal(emp)}
                      className="px-3.5 py-1.5 rounded-full bg-orange-500 hover:bg-orange-600 text-white font-semibold text-[12px] flex items-center gap-1.5 shadow-lg transform hover:scale-105 transition-all cursor-pointer"
                      title="Enroll Face & Body Biometrics"
                    >
                      <CameraIcon className="w-3.5 h-3.5" />
                      <span>{hasBiometrics ? 'Manage Biometrics' : 'Enroll Biometrics'}</span>
                    </button>
                    <span className="text-[10px] font-mono text-zinc-300 drop-shadow">
                      {completeness}/4 biometric angles
                    </span>
                  </div>

                  {/* Bottom Bar Info on Viewport: Frontal View Badge + Department/Role */}
                  <div className="relative z-20 flex items-center justify-between text-[11px] font-mono text-zinc-300">
                    {photoUrl ? (
                      <span className="px-2 py-0.5 rounded bg-black/80 border border-cyan-500/40 text-cyan-300 text-[9.5px] font-mono backdrop-blur-md flex items-center gap-1 shadow-xs">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                        <span>FRONTAL VIEW</span>
                      </span>
                    ) : (
                      <span className="text-[10.5px] text-zinc-400 truncate">{emp.department}</span>
                    )}
                    <span className="text-[10.5px] font-semibold text-orange-400 truncate bg-black/60 px-2 py-0.5 rounded backdrop-blur-md">
                      {emp.designation}
                    </span>
                  </div>
                </div>

                {/* 2. DEDICATED BIOMETRICS RIBBON (Completely Un-compacted & Clear!) */}
                <div className="px-3.5 py-2.5 bg-black/[0.02] dark:bg-white/[0.02] border-t border-b border-black/[0.06] dark:border-white/[0.06] flex items-center justify-between gap-2">
                  {/* Left: 1/4 or 4/4 Enrolled Status Badge */}
                  <div
                    className={`px-2 py-0.5 rounded text-[10.5px] font-mono font-bold uppercase backdrop-blur-md border flex items-center gap-1.5 ${
                      isAllDone
                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                        : completeness > 0
                        ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                        : 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                    }`}
                  >
                    <ShieldCheck className="w-3 h-3" />
                    <span>{isAllDone ? '4/4 PRIME' : `${completeness}/4 ${completeness > 0 ? 'PARTIAL' : 'ENROLL'}`}</span>
                  </div>

                  {/* Right: 4 Dedicated Angle Indicators [F] [L] [R] [B] with clean badges */}
                  <div className="flex items-center gap-1.5">
                    {[
                      { id: 'FRONTAL', label: 'Front', short: 'F' },
                      { id: 'LEFT_PROFILE', label: 'Left', short: 'L' },
                      { id: 'RIGHT_PROFILE', label: 'Right', short: 'R' },
                      { id: 'BODY', label: 'Body', short: 'B' },
                    ].map((ang) => {
                      const isPresent =
                        (emp.enrolledAngles || []).includes(ang.id) ||
                        (ang.id === 'FRONTAL' && (emp.faceTemplatesCount || 0) > 0);
                      return (
                        <span
                          key={ang.id}
                          title={`${ang.label}: ${isPresent ? 'Enrolled in Database' : 'Missing (Compulsory)'}`}
                          className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold flex items-center gap-1 border transition-all ${
                            isPresent
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-xs'
                              : 'bg-black/[0.04] dark:bg-white/[0.04] text-zinc-400 dark:text-zinc-500 border-dashed border-black/20 dark:border-white/20'
                          }`}
                        >
                          <span
                            className={`w-1 h-1 rounded-full ${
                              isPresent ? 'bg-emerald-400' : 'bg-zinc-400'
                            }`}
                          />
                          <span>{ang.short}</span>
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* 3. Card Body Footer with Employee Info & EDIT / ENROLL / DELETE Actions */}
                <div className="p-3.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="font-semibold text-[14px] text-[#0a0a0a] dark:text-white tracking-tight truncate">
                      {emp.fullName}
                    </h4>
                    <p className="text-[11px] font-mono text-[#8c8c8c] dark:text-[#71717a] truncate mt-0.5">
                      {emp.employeeCode} • {emp.department}
                    </p>
                    {!isAllDone ? (
                      <div className="text-[10.5px] text-amber-500 font-mono mt-1 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                        <span>Requires {4 - completeness} more capture{4 - completeness > 1 ? 's' : ''}</span>
                      </div>
                    ) : (
                      <div className="text-[10.5px] text-emerald-400 font-mono mt-1 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span>Full CCTV Primed</span>
                      </div>
                    )}
                  </div>

                  {/* Action Buttons: Edit, Biometrics, Delete */}
                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => openEditModal(emp)}
                      className="p-1.5 text-zinc-400 hover:text-orange-400 hover:bg-orange-500/10 rounded-lg transition-colors cursor-pointer border border-transparent hover:border-orange-500/20"
                      title="Edit Employee Information (Database)"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openEnrollmentModal(emp)}
                      className="p-1.5 text-orange-500 hover:text-orange-400 hover:bg-orange-500/10 rounded-lg transition-colors cursor-pointer border border-transparent hover:border-orange-500/20"
                      title="Enroll Biometrics & Re-ID"
                    >
                      <CameraIcon className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget({ id: emp.id, name: emp.fullName || 'Staff', code: emp.employeeCode })}
                      className="p-1.5 text-rose-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer border border-transparent hover:border-rose-500/20"
                      title="Delete Employee from Database"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </section>

      {/* ─── Add Employee Modal ────────────────────────────────────────── */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#121217] p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-black/[0.08] dark:border-white/[0.08]">
              <div className="flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-orange-400" />
                <h3 className="font-bold text-base text-[#0a0a0a] dark:text-white">
                  Add New Employee
                </h3>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 text-xs">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateSubmit} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-[#6b6b6b] dark:text-[#a1a1aa] mb-1 font-mono uppercase text-[10px]">
                  Employee Code *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. EMP-101"
                  value={formData.employeeCode}
                  onChange={(e) => setFormData({ ...formData, employeeCode: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-black/[0.03] dark:bg-black/40 border border-black/[0.08] dark:border-white/[0.1] text-[#0a0a0a] dark:text-white focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block text-[#6b6b6b] dark:text-[#a1a1aa] mb-1 font-mono uppercase text-[10px]">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Priya Sharma"
                  value={formData.fullName}
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-black/[0.03] dark:bg-black/40 border border-black/[0.08] dark:border-white/[0.1] text-[#0a0a0a] dark:text-white focus:outline-none focus:border-orange-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#6b6b6b] dark:text-[#a1a1aa] mb-1 font-mono uppercase text-[10px]">
                    Department
                  </label>
                  <input
                    type="text"
                    value={formData.department}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-black/[0.03] dark:bg-black/40 border border-black/[0.08] dark:border-white/[0.1] text-[#0a0a0a] dark:text-white focus:outline-none focus:border-orange-500"
                  />
                </div>
                <div>
                  <label className="block text-[#6b6b6b] dark:text-[#a1a1aa] mb-1 font-mono uppercase text-[10px]">
                    Designation
                  </label>
                  <input
                    type="text"
                    value={formData.designation}
                    onChange={(e) => setFormData({ ...formData, designation: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-black/[0.03] dark:bg-black/40 border border-black/[0.08] dark:border-white/[0.1] text-[#0a0a0a] dark:text-white focus:outline-none focus:border-orange-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[#6b6b6b] dark:text-[#a1a1aa] mb-1 font-mono uppercase text-[10px]">
                  Notes / Shift Info
                </label>
                <input
                  type="text"
                  placeholder="Optional notes or shift details"
                  value={formData.notes || ''}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-black/[0.03] dark:bg-black/40 border border-black/[0.08] dark:border-white/[0.1] text-[#0a0a0a] dark:text-white focus:outline-none focus:border-orange-500"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-black/10 dark:border-white/10 text-slate-400 hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold cursor-pointer disabled:opacity-50"
                >
                  {isSaving ? 'Creating...' : 'Save & Proceed'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Multi-Angle Biometric Enrollment Modal ────────────────────── */}
      {enrollModalEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#121217] p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-black/[0.08] dark:border-white/[0.08]">
              <div>
                <div className="flex items-center gap-2">
                  <CameraIcon className="w-5 h-5 text-cyan-400" />
                  <h3 className="font-bold text-base text-[#0a0a0a] dark:text-white">
                    Biometric & Re-ID Enrollment
                  </h3>
                </div>
                <p className="text-xs text-[#8c8c8c] dark:text-[#71717a] font-mono mt-0.5">
                  {enrollModalEmployee.fullName} ({enrollModalEmployee.employeeCode})
                </p>
              </div>
              <button
                onClick={() => setEnrollModalEmployee(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Compulsory Biometrics Warning Notice */}
            <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-300 text-xs font-mono flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
              <div>
                <span className="font-bold text-amber-200">CCTV Mandatory 4-Angle Biometrics:</span>
                <span className="text-amber-300/90 ml-1">
                  All 4 captures (Frontal 0°, Left ~30°, Right ~30°, Full-Body Re-ID) are compulsory. Cameras require all angles to accurately match employees across warehouse aisles, turns, and masked conditions.
                </span>
              </div>
            </div>

            {/* 4-Step Compulsory Stepper Bar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] font-mono uppercase text-[#8c8c8c] dark:text-[#71717a]">
                <span>Biometric Capture Steps (4 Required)</span>
                <span className="text-orange-400 font-bold">
                  {(() => {
                    const fCount = (existingTemplates?.faceTemplates || []).length;
                    const bCount = (existingTemplates?.bodyTemplates || []).length;
                    const poses = new Set((existingTemplates?.faceTemplates || []).map((t) => t.poseAngle));
                    let done = 0;
                    if (poses.has('FRONTAL')) done++;
                    if (poses.has('LEFT_PROFILE')) done++;
                    if (poses.has('RIGHT_PROFILE')) done++;
                    if (bCount > 0) done++;
                    return `${done} of 4 Enrolled`;
                  })()}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { id: 'FRONTAL', mode: 'FACE' as const, pose: 'FRONTAL', title: '1. Frontal', angle: '0°' },
                  { id: 'LEFT_PROFILE', mode: 'FACE' as const, pose: 'LEFT_PROFILE', title: '2. Left', angle: '~30°' },
                  { id: 'RIGHT_PROFILE', mode: 'FACE' as const, pose: 'RIGHT_PROFILE', title: '3. Right', angle: '~30°' },
                  { id: 'BODY', mode: 'BODY' as const, pose: 'BODY', title: '4. Body Re-ID', angle: 'Full' },
                ].map((step) => {
                  const isFace = step.mode === 'FACE';
                  const match = isFace
                    ? (existingTemplates?.faceTemplates || []).find((t) => t.poseAngle === step.pose)
                    : (existingTemplates?.bodyTemplates || [])[0];
                  const isEnrolled = !!match;
                  const isActive =
                    (enrollMode === 'FACE' && enrollPose === step.pose) ||
                    (enrollMode === 'BODY' && step.mode === 'BODY');

                  return (
                    <button
                      key={step.id}
                      type="button"
                      onClick={() => {
                        setEnrollMode(step.mode);
                        setEnrollPose(step.pose);
                        setEnrollImageBase64(null);
                        setEnrollStatus(null);
                        setEnrollError(null);
                      }}
                      className={`relative p-2.5 rounded-xl border text-left flex flex-col justify-between transition-all cursor-pointer select-none ${
                        isActive
                          ? 'border-cyan-400 bg-cyan-500/15 shadow-[0_0_15px_rgba(6,182,212,0.25)] ring-1 ring-cyan-400'
                          : isEnrolled
                          ? 'border-emerald-500/40 bg-emerald-500/10 hover:border-emerald-500'
                          : 'border-black/[0.1] dark:border-white/[0.1] bg-black/[0.02] dark:bg-white/[0.02] hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 mb-1.5">
                        <span className="text-[11px] font-bold font-mono tracking-tight text-[#0a0a0a] dark:text-white">
                          {step.title}
                        </span>
                        {isEnrolled ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        ) : (
                          <span className="text-[9px] font-mono uppercase px-1 py-0.2 rounded bg-red-500/20 text-red-300 border border-red-500/30">
                            Req
                          </span>
                        )}
                      </div>

                      {/* Thumbnail or Angle Indicator */}
                      <div className="relative aspect-video w-full rounded-lg overflow-hidden bg-black/60 border border-black/[0.08] dark:border-white/[0.08] flex items-center justify-center">
                        {isEnrolled ? (
                          <img
                            key={`thumb-${enrollModalEmployee.id}-${step.pose}-${photoVersion}`}
                            src={employeeService.getEmployeePhotoUrl(enrollModalEmployee.id, step.pose, photoVersion)}
                            alt={step.title}
                            className="w-full h-full object-cover object-top"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center text-zinc-500 font-mono text-[10px]">
                            <CameraIcon className="w-3.5 h-3.5 opacity-40 mb-0.5" />
                            <span>{step.angle}</span>
                          </div>
                        )}
                        {isActive && (
                          <div className="absolute inset-0 border-2 border-cyan-400 rounded-lg pointer-events-none animate-pulse" />
                        )}
                      </div>

                      <div className="mt-1.5 flex items-center justify-between text-[9.5px] font-mono text-zinc-400">
                        <span>{step.angle}</span>
                        <span className={isEnrolled ? 'text-emerald-400 font-semibold' : 'text-zinc-500'}>
                          {isEnrolled ? 'ENROLLED' : 'PENDING'}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Active Capture Heading & Guidance */}
            <div className="p-3 rounded-xl bg-black/[0.03] dark:bg-black/30 border border-black/[0.08] dark:border-white/[0.08] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold font-mono text-cyan-400 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                  <span>
                    {enrollMode === 'FACE'
                      ? `Active Capture: ${enrollPose === 'FRONTAL' ? 'Frontal Face (0°)' : enrollPose === 'LEFT_PROFILE' ? 'Left Profile (~30°)' : 'Right Profile (~30°)'}`
                      : 'Active Capture: Full-Body Person Re-ID'}
                  </span>
                </span>
                <span className="text-[10px] font-mono text-zinc-400 uppercase">
                  {enrollMode === 'FACE' ? 'Compulsory Face Model' : 'Compulsory FastReID Model'}
                </span>
              </div>
              <p className="text-[11.5px] text-zinc-300 font-sans">
                {enrollMode === 'FACE' && enrollPose === 'FRONTAL' && (
                  'Direct camera view. Clear lighting, neutral expression, without hat or mask. This is the primary avatar shown on the employee card.'
                )}
                {enrollMode === 'FACE' && enrollPose === 'LEFT_PROFILE' && (
                  'Turn head ~30° to the left. Enables camera identification when the person approaches from side aisles.'
                )}
                {enrollMode === 'FACE' && enrollPose === 'RIGHT_PROFILE' && (
                  'Turn head ~30° to the right. Enables camera identification when the person approaches from opposite aisles.'
                )}
                {enrollMode === 'BODY' && (
                  'Full-body standing photograph or CCTV person crop from head to shoes. Enables temporal tracking across CCTV cameras even when face is turned away or occluded.'
                )}
              </p>
            </div>

            {/* Status if already enrolled: Edit or Delete banner */}
            {(() => {
              const isEnrolled = enrollMode === 'FACE'
                ? (existingTemplates?.faceTemplates || []).some((t) => t.poseAngle === enrollPose)
                : (existingTemplates?.bodyTemplates || []).length > 0;
              if (!isEnrolled) return null;
              return (
                <div className="p-3 rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 text-xs font-mono flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0" />
                    <span className="truncate">
                      <strong>{enrollMode === 'FACE' ? enrollPose : 'Body'} registered in DB.</strong> Uploading a new photo will edit & replace it in place.
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={isDeletingTemplate}
                    onClick={handleDeleteCurrentTemplate}
                    className="px-2.5 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-[10.5px] font-bold flex items-center gap-1 cursor-pointer transition shrink-0"
                    title="Delete this template from database"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Delete Template</span>
                  </button>
                </div>
              );
            })()}

            {/* File Upload Box */}
            <div>
              <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />

              {enrollImageBase64 ? (
                <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-black/80 border border-cyan-500/40 flex items-center justify-center">
                  <img
                    src={enrollImageBase64}
                    alt="Preview"
                    className="max-h-full max-w-full object-contain"
                  />
                  <div className="absolute top-2 right-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-2.5 py-1 rounded-full bg-black/80 text-xs font-mono text-cyan-300 border border-cyan-500/40 hover:bg-black cursor-pointer"
                    >
                      Change Photo
                    </button>
                    <button
                      type="button"
                      onClick={() => setEnrollImageBase64(null)}
                      className="p-1.5 rounded-full bg-black/80 text-white hover:bg-black cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full border-2 border-dashed border-black/[0.15] dark:border-white/[0.15] hover:border-cyan-500/60 rounded-xl p-6 text-center cursor-pointer transition flex flex-col items-center justify-center gap-2 bg-black/[0.02] dark:bg-white/[0.02]"
                >
                  <Upload className="w-7 h-7 text-cyan-400 opacity-80" />
                  <div className="text-xs text-[#0a0a0a] dark:text-white font-medium">
                    {enrollMode === 'FACE'
                      ? `Click to select or drop ${enrollPose === 'FRONTAL' ? 'Frontal (0°)' : enrollPose === 'LEFT_PROFILE' ? 'Left Profile' : 'Right Profile'} face photo`
                      : 'Click to select or drop Full-Body standing person photo'}
                  </div>
                  <span className="text-[10px] text-slate-400">
                    {enrollMode === 'FACE'
                      ? 'Real-time quality filtering will reject blurry or low-res images'
                      : 'Extracts spatial color pyramid & structural body descriptor for FastReID'}
                  </span>
                </div>
              )}
            </div>

            {enrollStatus && (
              <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-xs font-medium flex items-center gap-2 animate-fadeIn">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{enrollStatus}</span>
              </div>
            )}

            {enrollError && (
              <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 text-xs font-medium flex items-center gap-2 animate-fadeIn">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{enrollError}</span>
              </div>
            )}

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEnrollModalEmployee(null)}
                className="px-4 py-2 rounded-xl border border-black/10 dark:border-white/10 text-slate-400 hover:text-white cursor-pointer"
              >
                Done / Close
              </button>
              <button
                type="button"
                disabled={!enrollImageBase64 || isEnrolling}
                onClick={handleEnroll}
                className="px-5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-600 text-black font-bold cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shadow-md"
              >
                {isEnrolling ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving to Database...</span>
                  </>
                ) : (
                  <>
                    {(() => {
                      const isEnrolled = enrollMode === 'FACE'
                        ? (existingTemplates?.faceTemplates || []).some((t) => t.poseAngle === enrollPose)
                        : (existingTemplates?.bodyTemplates || []).length > 0;
                      return isEnrolled ? (
                        <>
                          <Edit2 className="w-4 h-4" />
                          <span>Update & Replace in DB</span>
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="w-4 h-4" />
                          <span>
                            {enrollMode === 'FACE'
                              ? `Save & Encrypt ${enrollPose === 'FRONTAL' ? 'Frontal Face' : enrollPose === 'LEFT_PROFILE' ? 'Left Profile' : 'Right Profile'}`
                              : 'Save & Encrypt Body Re-ID'}
                          </span>
                        </>
                      );
                    })()}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Edit Employee Modal (Database Updates) ────────────────────── */}
      {editModalEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#121217] p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-black/[0.08] dark:border-white/[0.08]">
              <div className="flex items-center gap-2">
                <Edit2 className="w-5 h-5 text-orange-400" />
                <h3 className="font-bold text-base text-[#0a0a0a] dark:text-white">
                  Edit Employee
                </h3>
              </div>
              <button
                onClick={() => setEditModalEmployee(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {editFormError && (
              <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 text-xs">
                {editFormError}
              </div>
            )}

            <form onSubmit={handleEditSubmit} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-[#6b6b6b] dark:text-[#a1a1aa] mb-1 font-mono uppercase text-[10px]">
                  Employee Code *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 89443"
                  value={editFormData.employeeCode || ''}
                  onChange={(e) => setEditFormData({ ...editFormData, employeeCode: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-black/[0.03] dark:bg-black/40 border border-black/[0.08] dark:border-white/[0.1] text-[#0a0a0a] dark:text-white focus:outline-none focus:border-orange-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-[#6b6b6b] dark:text-[#a1a1aa] mb-1 font-mono uppercase text-[10px]">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Deepak Prasad S"
                  value={editFormData.fullName || ''}
                  onChange={(e) => setEditFormData({ ...editFormData, fullName: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-black/[0.03] dark:bg-black/40 border border-black/[0.08] dark:border-white/[0.1] text-[#0a0a0a] dark:text-white focus:outline-none focus:border-orange-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#6b6b6b] dark:text-[#a1a1aa] mb-1 font-mono uppercase text-[10px]">
                    Department
                  </label>
                  <input
                    type="text"
                    value={editFormData.department || ''}
                    onChange={(e) => setEditFormData({ ...editFormData, department: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-black/[0.03] dark:bg-black/40 border border-black/[0.08] dark:border-white/[0.1] text-[#0a0a0a] dark:text-white focus:outline-none focus:border-orange-500"
                  />
                </div>
                <div>
                  <label className="block text-[#6b6b6b] dark:text-[#a1a1aa] mb-1 font-mono uppercase text-[10px]">
                    Designation / Role
                  </label>
                  <input
                    type="text"
                    value={editFormData.designation || ''}
                    onChange={(e) => setEditFormData({ ...editFormData, designation: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-black/[0.03] dark:bg-black/40 border border-black/[0.08] dark:border-white/[0.1] text-[#0a0a0a] dark:text-white focus:outline-none focus:border-orange-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[#6b6b6b] dark:text-[#a1a1aa] mb-1 font-mono uppercase text-[10px]">
                  Status
                </label>
                <select
                  value={editFormData.isActive ? 'active' : 'inactive'}
                  onChange={(e) => setEditFormData({ ...editFormData, isActive: e.target.value === 'active' })}
                  className="w-full px-3 py-2 rounded-xl bg-black/[0.03] dark:bg-black/40 border border-black/[0.08] dark:border-white/[0.1] text-[#0a0a0a] dark:text-white focus:outline-none focus:border-orange-500"
                >
                  <option value="active">Active (Monitored by CCTV)</option>
                  <option value="inactive">Inactive (Suspended)</option>
                </select>
              </div>

              <div>
                <label className="block text-[#6b6b6b] dark:text-[#a1a1aa] mb-1 font-mono uppercase text-[10px]">
                  Notes / Shift Info
                </label>
                <input
                  type="text"
                  placeholder="Optional notes"
                  value={editFormData.notes || ''}
                  onChange={(e) => setEditFormData({ ...editFormData, notes: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-black/[0.03] dark:bg-black/40 border border-black/[0.08] dark:border-white/[0.1] text-[#0a0a0a] dark:text-white focus:outline-none focus:border-orange-500"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditModalEmployee(null)}
                  className="px-4 py-2 rounded-xl border border-black/10 dark:border-white/10 text-slate-400 hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUpdating}
                  className="px-5 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shadow-md"
                >
                  {isUpdating ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Updating Database...</span>
                    </>
                  ) : (
                    <span>Save Changes in DB</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Delete Employee Confirmation Modal ──────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-rose-500/30 bg-white dark:bg-[#141214] p-6 shadow-2xl space-y-4 animate-fadeIn">
            <div className="flex items-center gap-3 text-rose-500">
              <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20">
                <Trash2 className="w-6 h-6 text-rose-500" />
              </div>
              <div>
                <h3 className="font-bold text-base text-[#0a0a0a] dark:text-white">
                  Delete Employee from Database?
                </h3>
                <p className="text-xs text-rose-400/90 font-mono">
                  Irreversible Database Action
                </p>
              </div>
            </div>

            <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
              Are you sure you want to permanently delete <strong className="text-[#0a0a0a] dark:text-white font-semibold">{deleteTarget.name}</strong> (<span className="font-mono text-orange-400">{deleteTarget.code}</span>)?
              <br /><br />
              This will permanently delete the employee record and cascade-purge all associated face templates, multi-angle embeddings, and Re-ID models from SQLite database <span className="font-mono text-cyan-400">cctv.db</span>.
            </p>

            <div className="pt-2 flex justify-end gap-2.5 border-t border-black/[0.06] dark:border-white/[0.08]">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-xl border border-black/10 dark:border-white/10 text-slate-400 hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={confirmDelete}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shadow-lg shadow-rose-600/30"
              >
                {isDeleting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting from DB...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Permanently Delete</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
