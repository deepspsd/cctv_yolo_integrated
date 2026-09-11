import React, { useRef } from 'react';
import {
  Search,
  Filter,
  X,
  LayoutGrid,
  Table as TableIcon,
  SlidersHorizontal,
  Rows3,
  AlignJustify,
} from 'lucide-react';
import { CameraStatus, StatusFilter } from '../types';
import { soundService } from '../services/soundService';

interface CameraControlsProps {
  searchQuery: string;
  onSearchChange: (val: string) => void;
  selectedZone: string;
  onZoneChange: (zone: string) => void;
  availableZones: string[];
  selectedStatus: StatusFilter;
  onStatusChange: (status: StatusFilter) => void;
  totalFilteredCount: number;
  totalCount: number;
  onResetFilters: () => void;
  viewMode?: 'table' | 'grid';
  onViewModeChange?: (mode: 'table' | 'grid') => void;
  density?: 'comfortable' | 'compact';
  onDensityChange?: (density: 'comfortable' | 'compact') => void;
}

export const CameraControls: React.FC<CameraControlsProps> = ({
  searchQuery,
  onSearchChange,
  selectedZone,
  onZoneChange,
  availableZones,
  selectedStatus,
  onStatusChange,
  totalFilteredCount,
  totalCount,
  onResetFilters,
  viewMode = 'table',
  onViewModeChange,
  density = 'comfortable',
  onDensityChange,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const hasActiveFilters = searchQuery !== '' || selectedZone !== 'ALL' || selectedStatus !== 'All';

  return (
    <div
      id="camera-controls-bar"
      className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-3 sm:p-3.5 bg-white dark:bg-[#111116] border border-black/[0.08] dark:border-white/[0.08] rounded-2xl shadow-xs transition-colors"
    >
      {/* Left: Tactical Command Search input */}
      <div className="relative flex-1 min-w-[240px]">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8c8c8c] dark:text-[#71717a] pointer-events-none" />
        <input
          ref={inputRef}
          id="camera-search-input"
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search camera name, ID, or IP... (Press / to focus)"
          className="w-full pl-9 pr-16 py-2 text-[13.5px] bg-[#fbfbfb] dark:bg-[#171720] border border-black/[0.1] dark:border-white/[0.1] rounded-xl text-[#0a0a0a] dark:text-white placeholder-[#8c8c8c] dark:placeholder-[#71717a] tracking-tight focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30 transition-all"
        />
        {searchQuery ? (
          <button
            onClick={() => {
              soundService.playTactileBlip(500, 0.02);
              onSearchChange('');
            }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8c8c8c] hover:text-black dark:hover:text-white p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer transition-colors"
            title="Clear search (Esc)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ) : (
          <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono text-[#8c8c8c] dark:text-[#71717a] bg-black/[0.04] dark:bg-white/[0.08] border border-black/[0.06] dark:border-white/[0.08] rounded absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
            Ctrl+K
          </kbd>
        )}
      </div>

      {/* Right: Filters, Density, View Mode & Counter */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
        {/* Zone Dropdown */}
        <div className="relative">
          <select
            id="zone-filter-select"
            value={selectedZone}
            onChange={(e) => {
              soundService.playTactileBlip(600, 0.02);
              onZoneChange(e.target.value);
            }}
            className="appearance-none text-[13px] font-medium tracking-tight bg-[#fbfbfb] dark:bg-[#171720] text-[#0a0a0a] dark:text-white border border-black/[0.1] dark:border-white/[0.1] rounded-xl pl-3 pr-8 py-2 hover:border-black/30 dark:hover:border-orange-500/50 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30 cursor-pointer transition-all"
          >
            <option value="ALL">All Facility Zones</option>
            {availableZones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
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
            id="status-filter-select"
            value={selectedStatus}
            onChange={(e) => {
              soundService.playTactileBlip(600, 0.02);
              onStatusChange(e.target.value as StatusFilter);
            }}
            className="appearance-none text-[13px] font-medium tracking-tight bg-[#fbfbfb] dark:bg-[#171720] text-[#0a0a0a] dark:text-white border border-black/[0.1] dark:border-white/[0.1] rounded-xl pl-3 pr-8 py-2 hover:border-black/30 dark:hover:border-orange-500/50 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30 cursor-pointer transition-all"
          >
            <option value="All">All Ingress States</option>
            <option value="ONLINE">Online (Reachable)</option>
            <option value="OFFLINE">Offline (Disconnected)</option>
            <option value="CHECKING">Checking Socket</option>
            <option value="UNKNOWN">Unknown Node</option>
          </select>
          <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-[#8c8c8c] dark:text-[#71717a]">
            ▼
          </div>
        </div>

        {/* Reset filters if active */}
        {hasActiveFilters && (
          <button
            id="reset-filters-btn"
            onClick={() => {
              soundService.playTactileBlip(450, 0.03);
              onResetFilters();
            }}
            className="flex items-center gap-1 text-[12px] font-medium text-[#6b6b6b] dark:text-[#a1a1aa] hover:text-black dark:hover:text-white px-2.5 py-2 rounded-xl bg-[#fbfbfb] dark:bg-[#171720] border border-black/[0.08] dark:border-white/[0.1] hover:border-black/20 dark:hover:border-orange-500/40 transition-all cursor-pointer"
            title="Reset all filters"
          >
            <X className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>
        )}

        {/* Density Toggle (Comfortable vs Compact) for Data Table */}
        {viewMode === 'table' && onDensityChange && (
          <div className="hidden sm:flex items-center p-0.5 rounded-xl border border-black/[0.1] dark:border-white/[0.1] bg-[#fbfbfb] dark:bg-[#171720]">
            <button
              type="button"
              id="density-comfortable-btn"
              onClick={() => {
                soundService.playTactileBlip(700, 0.02);
                onDensityChange('comfortable');
              }}
              className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                density === 'comfortable'
                  ? 'bg-black dark:bg-orange-500 text-white dark:text-black shadow-xs'
                  : 'text-[#6b6b6b] dark:text-[#a1a1aa] hover:text-black dark:hover:text-white'
              }`}
              title="Comfortable Row Density"
              aria-label="Comfortable Row Density"
            >
              <Rows3 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              id="density-compact-btn"
              onClick={() => {
                soundService.playTactileBlip(750, 0.02);
                onDensityChange('compact');
              }}
              className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                density === 'compact'
                  ? 'bg-black dark:bg-orange-500 text-white dark:text-black shadow-xs'
                  : 'text-[#6b6b6b] dark:text-[#a1a1aa] hover:text-black dark:hover:text-white'
              }`}
              title="High-Density Compact View (20+ Nodes)"
              aria-label="High-Density Compact View"
            >
              <AlignJustify className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* View Mode Toggle: Table vs Surveillance Grid Wall */}
        {onViewModeChange && (
          <div className="flex items-center p-0.5 rounded-xl border border-black/[0.1] dark:border-white/[0.1] bg-[#fbfbfb] dark:bg-[#171720]">
            <button
              type="button"
              id="table-view-toggle-btn"
              onClick={() => {
                soundService.playTactileBlip(680, 0.02);
                onViewModeChange('table');
              }}
              className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                viewMode === 'table'
                  ? 'bg-black dark:bg-orange-500 text-white dark:text-black shadow-xs'
                  : 'text-[#6b6b6b] dark:text-[#a1a1aa] hover:text-black dark:hover:text-white'
              }`}
              title="Data Table View"
              aria-label="Data Table View"
            >
              <TableIcon className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              id="grid-view-toggle-btn"
              onClick={() => {
                soundService.playTactileBlip(750, 0.02);
                onViewModeChange('grid');
              }}
              className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                viewMode === 'grid'
                  ? 'bg-black dark:bg-orange-500 text-white dark:text-black shadow-xs'
                  : 'text-[#6b6b6b] dark:text-[#a1a1aa] hover:text-black dark:hover:text-white'
              }`}
              title="Surveillance Wall Grid View"
              aria-label="Surveillance Wall Grid View"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Filtered Count Pill */}
        <div className="hidden lg:flex items-center px-2.5 py-1 text-[11px] font-mono text-[#6b6b6b] dark:text-[#a1a1aa] bg-black/[0.03] dark:bg-white/[0.04] rounded-lg border border-black/[0.05] dark:border-white/[0.06]">
          <span>
            {totalFilteredCount} of {totalCount} Nodes
          </span>
        </div>
      </div>
    </div>
  );
};
