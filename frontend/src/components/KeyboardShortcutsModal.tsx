import React, { useEffect } from 'react';
import { soundService } from '../services/soundService';
import { X, Keyboard } from 'lucide-react';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutGroup {
  category: string;
  items: { key: string; description: string }[];
}

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({ isOpen, onClose }) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const shortcuts: ShortcutGroup[] = [
    {
      category: 'Navigation & Search',
      items: [
        { key: '/ or Ctrl+K', description: 'Focus camera search bar' },
        { key: 'N or +', description: 'Open Add Camera modal' },
        { key: 'V', description: 'Toggle Table / Grid view mode' },
        { key: '?', description: 'Open this keyboard shortcuts modal' },
        { key: 'Esc', description: 'Close active modal or live drawer' },
      ],
    },
    {
      category: 'Status Filter Fast-Keys',
      items: [
        { key: '1', description: 'Filter: All Camera Nodes' },
        { key: '2', description: 'Filter: Online nodes only' },
        { key: '3', description: 'Filter: Offline alert nodes' },
        { key: '4', description: 'Clear all active filters' },
      ],
    },
    {
      category: 'Live Stream Drawer Controls',
      items: [
        { key: 'F', description: 'Toggle full screen video display' },
        { key: 'M', description: 'Mute / unmute audio stream' },
        { key: 'S', description: 'Capture snapshot with timestamp' },
        { key: 'R', description: 'Reconnect / refresh WebRTC stream' },
        { key: '← / →', description: 'Switch to previous / next camera' },
      ],
    },
  ];

  return (
    <div
      id="keyboard-shortcuts-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-xs transition-opacity animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[560px] bg-white dark:bg-[#111115] border border-black/[0.12] dark:border-white/[0.12] rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-black/[0.08] dark:border-white/[0.08] flex items-center justify-between bg-[#fafafa] dark:bg-[#15151b]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-black dark:bg-orange-500 text-white dark:text-black flex items-center justify-center font-bold">
              <Keyboard className="w-4 h-4" />
            </div>
            <div>
              <h3 id="shortcuts-modal-title" className="text-[16px] font-semibold text-[#0a0a0a] dark:text-white tracking-tight">
                Terminal Keyboard Shortcuts
              </h3>
              <p className="text-[11px] font-mono text-[#6b6b6b] dark:text-[#a1a1aa] tracking-tight">
                Quick commands for fast operator workflow
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              soundService.playTactileBlip(500, 0.02);
              onClose();
            }}
            className="p-1.5 text-[#6b6b6b] dark:text-[#a1a1aa] hover:text-black dark:hover:text-white rounded-lg hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
            aria-label="Close shortcuts modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
          {shortcuts.map((group) => (
            <div key={group.category} className="space-y-2">
              <h4 className="text-[11px] font-mono uppercase tracking-wider text-[#8c8c8c] dark:text-[#71717a] font-semibold">
                {group.category}
              </h4>
              <div className="divide-y divide-black/[0.05] dark:divide-white/[0.06] rounded-xl border border-black/[0.06] dark:border-white/[0.08] bg-[#fbfbfb] dark:bg-[#15151b] overflow-hidden">
                {group.items.map((item) => (
                  <div
                    key={item.key}
                    className="px-3.5 py-2 flex items-center justify-between text-[12.5px] hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors"
                  >
                    <span className="text-[#374151] dark:text-[#d1d5db] font-medium tracking-tight">
                      {item.description}
                    </span>
                    <kbd className="px-2 py-0.5 text-[11px] font-mono font-semibold bg-white dark:bg-[#202028] text-[#0a0a0a] dark:text-orange-400 border border-black/[0.12] dark:border-white/[0.15] rounded shadow-2xs">
                      {item.key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-black/[0.08] dark:border-white/[0.08] bg-[#fafafa] dark:bg-[#15151b] flex items-center justify-between text-[11.5px] text-[#8c8c8c] dark:text-[#71717a]">
          <span>Press <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-black/5 dark:bg-white/10 rounded">Esc</kbd> anytime to dismiss</span>
          <button
            onClick={onClose}
            className="px-3 py-1 bg-[#0a0a0a] dark:bg-orange-500 text-white dark:text-black rounded-lg text-[12px] font-semibold cursor-pointer"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
};
