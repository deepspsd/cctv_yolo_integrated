import React, { useState, useEffect, useMemo } from 'react';
import {
  CalendarCheck,
  Users,
  Clock,
  Download,
  Filter,
  Search,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Camera as CameraIcon,
  ShieldCheck,
  FileSpreadsheet,
  FileText,
  Calendar,
  Building,
  UserCheck,
  AlertOctagon,
  ArrowUpDown,
  X,
} from 'lucide-react';
import { AttendanceRecord, AttendanceSummary, Camera } from '../types';
import { attendanceService } from '../services/attendanceService';
import { soundService } from '../services/soundService';

interface AttendancePageProps {
  cameras?: Camera[];
}

export const AttendancePage: React.FC<AttendancePageProps> = ({ cameras = [] }) => {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [selectedDept, setSelectedDept] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [recData, sumData] = await Promise.all([
        attendanceService.getAttendanceRecords({
          date: selectedDate,
          department: selectedDept !== 'ALL' ? selectedDept : undefined,
          status: selectedStatus !== 'ALL' ? selectedStatus : undefined,
        }),
        attendanceService.getSummary(selectedDate),
      ]);
      setRecords(recData);
      setSummary(sumData);
    } catch (err) {
      console.error('Failed to load attendance data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedDate, selectedDept, selectedStatus]);

  const handleExport = async (format: 'csv' | 'xlsx') => {
    setIsExporting(true);
    soundService.playTactileBlip(880, 0.03);
    try {
      await attendanceService.exportAttendance(format, selectedDate, selectedDept !== 'ALL' ? selectedDept : undefined);
    } catch (err) {
      console.error('Export failed:', err);
      alert('Failed to export attendance report.');
    } finally {
      setIsExporting(false);
    }
  };

  const departments = useMemo(() => {
    const set = new Set<string>();
    records.forEach((r) => {
      if (r.department) set.add(r.department);
    });
    return Array.from(set).sort();
  }, [records]);

  const filteredRecords = useMemo(() => {
    let list = records;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (r) =>
          (r.employeeName || '').toLowerCase().includes(q) ||
          (r.employeeCode || '').toLowerCase().includes(q) ||
          (r.designation || '').toLowerCase().includes(q) ||
          (r.clockInCameraName && r.clockInCameraName.toLowerCase().includes(q))
      );
    }
    return [...list].sort((a, b) => {
      const tA = new Date(a.clockInTime).getTime();
      const tB = new Date(b.clockInTime).getTime();
      return sortOrder === 'desc' ? tB - tA : tA - tB;
    });
  }, [records, searchQuery, sortOrder]);

  const formatTime = (iso?: string | null) => {
    if (!iso) return '--:--';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '--:--';
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  };

  return (
    <div className="w-full space-y-6">
      {/* ─── Top Header Section ────────────────────────────────────────── */}
      <section id="attendance-header-section" className="relative">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-4 border-b border-black/[0.08] dark:border-white/[0.08]">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_6px_rgba(16,185,129,0.8)]" />
              <span className="text-[11px] font-mono uppercase tracking-wider text-[#6b6b6b] dark:text-[#a1a1aa]">
                Automatic CCTV Attendance
              </span>
            </div>
            <h1
              id="attendance-main-title"
              className="text-[30px] sm:text-[38px] font-semibold text-[#0a0a0a] dark:text-[#fafafa] tracking-tightest leading-tight flex items-center gap-3"
            >
              Surveillance Attendance
            </h1>
            <p className="text-[14px] sm:text-[15px] text-[#6b6b6b] dark:text-[#a1a1aa] mt-0.5 tracking-tight">
              Real-time facial recognition & person re-identification clock-in system across 20 cameras.
            </p>
          </div>

          {/* Action Bar: Export Buttons & Refresh */}
          <div className="flex items-center flex-wrap gap-2.5">
            <button
              onClick={() => handleExport('xlsx')}
              disabled={isExporting}
              className="flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 px-3.5 py-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400 transition cursor-pointer disabled:opacity-50"
              title="Download Excel Report (.xlsx) with formatting"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Export Excel</span>
            </button>

            <button
              onClick={() => handleExport('csv')}
              disabled={isExporting}
              className="flex items-center gap-1.5 rounded-xl border border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.05] hover:bg-black/[0.06] dark:hover:bg-white/10 px-3.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200 transition cursor-pointer disabled:opacity-50"
              title="Download CSV file"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>CSV</span>
            </button>

            <button
              onClick={loadData}
              disabled={isLoading}
              className="flex items-center gap-1.5 rounded-xl border border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.05] hover:bg-black/[0.06] dark:hover:bg-white/10 px-3.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200 transition cursor-pointer disabled:opacity-50"
              title="Refresh Records"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>
      </section>

      {/* ─── Top 4 KPI Summary Cards ───────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {/* Card 1: Registered Total */}
        <div className="group relative overflow-hidden rounded-2xl border border-black/[0.08] dark:border-white/[0.08] bg-white dark:bg-[#111116] p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-orange-500/40 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-[#a1a1aa] mb-2">
            <span className="text-[11px] font-mono uppercase tracking-wider">Registered Staff</span>
            <Users className="w-4 h-4 text-orange-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold font-mono text-[#0a0a0a] dark:text-[#fafafa]">
            {summary ? summary.totalRegistered : '--'}
          </div>
          <div className="mt-1 text-[11px] text-[#6b6b6b] dark:text-[#71717a]">
            Active enrolled workforce
          </div>
        </div>

        {/* Card 2: Total Present Today */}
        <div className="group relative overflow-hidden rounded-2xl border border-black/[0.08] dark:border-white/[0.08] bg-white dark:bg-[#111116] p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-500/40 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-[#a1a1aa] mb-2">
            <span className="text-[11px] font-mono uppercase tracking-wider">Present Today</span>
            <UserCheck className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
            {summary ? summary.totalPresent : '--'}
          </div>
          <div className="mt-1 text-[11px] text-[#6b6b6b] dark:text-[#71717a]">
            {summary ? `${summary.attendanceRate}% attendance rate` : '--'}
          </div>
        </div>

        {/* Card 3: Currently On-Site */}
        <div className="group relative overflow-hidden rounded-2xl border border-black/[0.08] dark:border-white/[0.08] bg-white dark:bg-[#111116] p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-cyan-500/40 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-[#a1a1aa] mb-2">
            <span className="text-[11px] font-mono uppercase tracking-wider">Active On-Site</span>
            <Building className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold font-mono text-cyan-600 dark:text-cyan-400">
            {summary ? summary.currentlyOnSite : '--'}
          </div>
          <div className="mt-1 text-[11px] text-[#6b6b6b] dark:text-[#71717a]">
            Seen within last 30 minutes
          </div>
        </div>

        {/* Card 4: PPE Violations Today */}
        <div className="group relative overflow-hidden rounded-2xl border border-black/[0.08] dark:border-white/[0.08] bg-white dark:bg-[#111116] p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-red-500/40 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-[#a1a1aa] mb-2">
            <span className="text-[11px] font-mono uppercase tracking-wider">PPE Violations</span>
            <AlertOctagon className="w-4 h-4 text-red-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold font-mono text-red-600 dark:text-red-400">
            {summary ? summary.totalPpeViolationsToday : '--'}
          </div>
          <div className="mt-1 text-[11px] text-[#6b6b6b] dark:text-[#71717a]">
            Cross-referenced by employee
          </div>
        </div>
      </section>

      {/* ─── Filter & Search Toolbar (matching Camera Controls style) ───── */}
      <section
        id="attendance-controls-bar"
        className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-3 sm:p-3.5 bg-white dark:bg-[#111116] border border-black/[0.08] dark:border-white/[0.08] rounded-2xl shadow-xs transition-colors"
      >
        {/* Search Box */}
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8c8c8c] dark:text-[#71717a] pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by employee name, code, designation, or camera node..."
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

        {/* Filters & View Switcher */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
          {/* Date Picker */}
          <div className="relative flex items-center">
            <Calendar className="absolute left-3 w-3.5 h-3.5 text-orange-400 pointer-events-none" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="pl-8 pr-2.5 py-2 text-[13px] font-mono rounded-xl bg-[#fbfbfb] dark:bg-[#171720] border border-black/[0.1] dark:border-white/[0.1] text-[#0a0a0a] dark:text-white focus:outline-none focus:border-orange-500 cursor-pointer"
            />
          </div>

          {/* Department Dropdown */}
          <div className="relative">
            <select
              value={selectedDept}
              onChange={(e) => {
                soundService.playTactileBlip(600, 0.02);
                setSelectedDept(e.target.value);
              }}
              className="appearance-none text-[13px] font-medium tracking-tight bg-[#fbfbfb] dark:bg-[#171720] text-[#0a0a0a] dark:text-white border border-black/[0.1] dark:border-white/[0.1] rounded-xl pl-3 pr-8 py-2 hover:border-black/30 dark:hover:border-orange-500/50 focus:outline-none focus:border-orange-500 cursor-pointer transition-all"
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

          {/* Status Dropdown */}
          <div className="relative">
            <select
              value={selectedStatus}
              onChange={(e) => {
                soundService.playTactileBlip(600, 0.02);
                setSelectedStatus(e.target.value);
              }}
              className="appearance-none text-[13px] font-medium tracking-tight bg-[#fbfbfb] dark:bg-[#171720] text-[#0a0a0a] dark:text-white border border-black/[0.1] dark:border-white/[0.1] rounded-xl pl-3 pr-8 py-2 hover:border-black/30 dark:hover:border-orange-500/50 focus:outline-none focus:border-orange-500 cursor-pointer transition-all"
            >
              <option value="ALL">All Statuses</option>
              <option value="PRESENT">PRESENT</option>
              <option value="ON_DUTY">ON_DUTY</option>
              <option value="HALF_DAY">HALF_DAY</option>
            </select>
            <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-[#8c8c8c] dark:text-[#71717a]">
              ▼
            </div>
          </div>

          {/* Sort Toggle */}
          <button
            onClick={() => setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
            className="flex items-center gap-1.5 px-3 py-2 text-[13px] rounded-xl border border-black/[0.1] dark:border-white/[0.1] bg-[#fbfbfb] dark:bg-[#171720] text-[#6b6b6b] dark:text-[#a1a1aa] hover:text-black dark:hover:text-white transition cursor-pointer"
            title="Toggle Sort Time"
          >
            <ArrowUpDown className="w-3.5 h-3.5 text-orange-400" />
            <span className="font-mono text-[11px] uppercase">{sortOrder}</span>
          </button>

          {/* View Mode Switcher */}
          <div className="flex items-center rounded-xl border border-black/[0.1] dark:border-white/[0.1] bg-black/[0.03] dark:bg-[#171720] p-0.5">
            <button
              onClick={() => setViewMode('grid')}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                viewMode === 'grid'
                  ? 'bg-white dark:bg-white/15 text-black dark:text-white shadow-xs'
                  : 'text-[#6b6b6b] dark:text-[#a1a1aa] hover:text-black dark:hover:text-white'
              }`}
              title="Card Grid View"
            >
              <span>Cards</span>
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                viewMode === 'table'
                  ? 'bg-white dark:bg-white/15 text-black dark:text-white shadow-xs'
                  : 'text-[#6b6b6b] dark:text-[#a1a1aa] hover:text-black dark:hover:text-white'
              }`}
              title="Table View"
            >
              <span>Table</span>
            </button>
          </div>
        </div>
      </section>

      {/* ─── Attendance Content (Cards Grid or Table) ──────────────────── */}
      {filteredRecords.length === 0 ? (
        <div className="py-20 text-center text-slate-500 bg-white dark:bg-[#111116] rounded-2xl border border-black/[0.08] dark:border-white/[0.08] p-8">
          <UserCheck className="w-10 h-10 mx-auto mb-2 text-slate-400 opacity-50" />
          <p className="text-base font-semibold text-slate-800 dark:text-slate-200">
            No attendance records found for this date & filter.
          </p>
          <span className="text-xs text-slate-400 mt-1 block">
            Employees will be automatically clocked in when recognized by CCTV cameras.
          </span>
        </div>
      ) : viewMode === 'grid' ? (
        /* Card Grid View matching Camera Cards design */
        <section className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5">
          {filteredRecords.map((r) => {
            const isPresent = r.status === 'PRESENT' || r.status === 'ON_DUTY';
            const initials =
              (r.employeeName || 'Staff')
                .split(' ')
                .filter(Boolean)
                .map((n) => n[0])
                .slice(0, 2)
                .join('') || 'ST';

            return (
              <div
                key={r.id}
                className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border bg-white dark:bg-[#111116] border-black/[0.08] dark:border-white/[0.08] hover:border-orange-500/50 dark:hover:border-orange-500/50 shadow-xs hover:shadow-xl dark:hover:shadow-[0_8px_30px_rgba(0,0,0,0.8)] transition-all duration-200"
              >
                {/* Visual Viewport Header with CCTV scanlines */}
                <div className="relative aspect-video w-full overflow-hidden bg-black flex flex-col justify-between p-3 select-none">
                  {/* Subtle CCTV scanline backdrop */}
                  <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.4)_50%)] bg-[length:100%_4px] pointer-events-none z-10 opacity-60" />

                  {/* Top Badges */}
                  <div className="relative z-20 flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="px-2 py-0.5 rounded text-[10.5px] font-mono font-bold bg-black/85 text-white backdrop-blur-md border border-white/20 shadow-xs">
                        {r.employeeCode || '--'}
                      </span>
                      {r.ppeViolationsCount > 0 ? (
                        <span className="px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold bg-red-600/90 text-white backdrop-blur-md flex items-center gap-1 shadow-xs animate-pulse">
                          <AlertTriangle className="w-2.5 h-2.5" />
                          {r.ppeViolationsCount} VIOLATIONS
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 backdrop-blur-md flex items-center gap-1">
                          <ShieldCheck className="w-2.5 h-2.5" />
                          COMPLIANT
                        </span>
                      )}
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-tight backdrop-blur-md flex items-center gap-1 shadow-xs ${
                        isPresent ? 'bg-emerald-500/90 text-white' : 'bg-amber-500/90 text-white'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          isPresent ? 'bg-white animate-pulse' : 'bg-white'
                        }`}
                      />
                      {r.status}
                    </span>
                  </div>

                  {/* Centered Employee Avatar */}
                  <div className="relative z-20 flex flex-col items-center justify-center py-2">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#1a1a24] to-[#0c0c10] border border-white/20 text-emerald-400 font-bold font-mono text-lg flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform duration-200">
                      {initials}
                    </div>
                  </div>

                  {/* Bottom Bar Info */}
                  <div className="relative z-20 flex items-center justify-between text-[11px] font-mono text-zinc-300 pt-1">
                    <span className="truncate text-[10.5px] tracking-tight flex items-center gap-1">
                      <CameraIcon className="w-3 h-3 text-orange-400" />
                      {r.clockInCameraName || 'First Node'}
                    </span>
                    <span className="text-[10.5px] tracking-tight text-emerald-400 font-bold font-mono">
                      {formatTime(r.clockInTime)}
                    </span>
                  </div>
                </div>

                {/* Card Body Footer */}
                <div className="p-3.5 flex items-center justify-between gap-2 border-t border-black/[0.04] dark:border-white/[0.06]">
                  <div className="min-w-0">
                    <h4 className="font-semibold text-[13.5px] text-[#0a0a0a] dark:text-white tracking-tight truncate">
                      {r.employeeName || 'Staff'}
                    </h4>
                    <p className="text-[11px] font-mono text-[#8c8c8c] dark:text-[#71717a] truncate mt-0.5">
                      {r.department} • {r.designation}
                    </p>
                  </div>

                  <div className="text-right font-mono shrink-0">
                    <span className="text-[12px] font-bold text-black dark:text-white">
                      {r.totalHours ? `${r.totalHours}h` : 'Active'}
                    </span>
                    <span className="block text-[10px] text-[#8c8c8c] dark:text-[#71717a]">
                      Last: {formatTime(r.lastSeenTime)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      ) : (
        /* Table View */
        <section className="overflow-hidden rounded-2xl border border-black/[0.08] dark:border-white/[0.08] bg-white dark:bg-[#111116] shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-black/[0.08] dark:border-white/[0.08] bg-black/[0.02] dark:bg-white/[0.02] text-[#6b6b6b] dark:text-[#a1a1aa] font-mono text-[11px] uppercase tracking-wider">
                  <th className="py-3 px-4">Employee</th>
                  <th className="py-3 px-4">Department / Role</th>
                  <th className="py-3 px-4">Clock In</th>
                  <th className="py-3 px-4">First Node</th>
                  <th className="py-3 px-4">Last Seen</th>
                  <th className="py-3 px-4">Last Node</th>
                  <th className="py-3 px-4">Hours</th>
                  <th className="py-3 px-4">PPE Alerts</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.05] dark:divide-white/[0.05]">
                {filteredRecords.map((r) => {
                  const isPresent = r.status === 'PRESENT' || r.status === 'ON_DUTY';
                  return (
                    <tr
                      key={r.id}
                      className="hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors"
                    >
                      {/* Employee Info */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-400 font-bold font-mono text-[11px] flex items-center justify-center shrink-0">
                            {(r.employeeName || 'Staff')
                              .split(' ')
                              .filter(Boolean)
                              .map((n) => n[0])
                              .slice(0, 2)
                              .join('') || 'ST'}
                          </div>
                          <div>
                            <div className="font-semibold text-[#0a0a0a] dark:text-white">
                              {r.employeeName || 'Staff'}
                            </div>
                            <div className="font-mono text-[10px] text-[#8c8c8c] dark:text-[#71717a]">
                              {r.employeeCode || '--'}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Department / Role */}
                      <td className="py-3.5 px-4">
                        <div className="text-[#0a0a0a] dark:text-[#fafafa] font-medium">{r.department}</div>
                        <div className="text-[11px] text-[#8c8c8c] dark:text-[#71717a]">{r.designation}</div>
                      </td>

                      {/* Clock In Time */}
                      <td className="py-3.5 px-4 font-mono font-medium text-emerald-600 dark:text-emerald-400">
                        {formatTime(r.clockInTime)}
                      </td>

                      {/* First Camera */}
                      <td className="py-3.5 px-4 text-[#6b6b6b] dark:text-[#a1a1aa]">
                        <span className="inline-flex items-center gap-1 font-mono text-[11px]">
                          <CameraIcon className="w-3 h-3 text-orange-400" />
                          {r.clockInCameraName || 'Camera Feed'}
                        </span>
                      </td>

                      {/* Last Seen Time */}
                      <td className="py-3.5 px-4 font-mono text-[#0a0a0a] dark:text-[#fafafa]">
                        {formatTime(r.lastSeenTime)}
                      </td>

                      {/* Last Camera */}
                      <td className="py-3.5 px-4 text-[#6b6b6b] dark:text-[#a1a1aa]">
                        <span className="inline-flex items-center gap-1 font-mono text-[11px]">
                          <CameraIcon className="w-3 h-3 text-cyan-400" />
                          {r.lastSeenCameraName || 'Camera Feed'}
                        </span>
                      </td>

                      {/* Total Hours */}
                      <td className="py-3.5 px-4 font-mono text-[#0a0a0a] dark:text-[#fafafa]">
                        {r.totalHours ? `${r.totalHours} hrs` : '--'}
                      </td>

                      {/* PPE Violations Count */}
                      <td className="py-3.5 px-4">
                        {r.ppeViolationsCount > 0 ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-mono font-bold bg-red-500/15 text-red-400 border border-red-500/30">
                            <AlertTriangle className="w-3 h-3" />
                            {r.ppeViolationsCount}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <ShieldCheck className="w-3 h-3" />
                            Compliant
                          </span>
                        )}
                      </td>

                      {/* Status Badge */}
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-mono font-bold uppercase border ${
                            isPresent
                              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                              : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              isPresent ? 'bg-emerald-400' : 'bg-amber-400'
                            }`}
                          />
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};
