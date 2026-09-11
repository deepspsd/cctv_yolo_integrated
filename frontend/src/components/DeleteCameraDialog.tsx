import React, { useEffect, useRef } from 'react';
import { Camera } from '../types';
import { AlertTriangle, Loader2 } from 'lucide-react';

interface DeleteCameraDialogProps {
  camera: Camera | null;
  isOpen: boolean;
  isDeleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const DeleteCameraDialog: React.FC<DeleteCameraDialogProps> = ({
  camera,
  isOpen,
  isDeleting,
  onConfirm,
  onCancel,
}) => {
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => cancelBtnRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isDeleting) {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isDeleting, onCancel]);

  if (!isOpen || !camera) return null;

  return (
    <div
      id="delete-camera-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs transition-opacity"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="delete-dialog-title"
      aria-describedby="delete-dialog-description"
    >
      <div
        className="w-full max-w-[420px] bg-white dark:bg-[#111115] border border-black/[0.1] dark:border-white/[0.1] rounded-2xl shadow-2xl overflow-hidden p-6 animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-12 h-12 rounded-full bg-[#ef4444]/10 text-[#ef4444] flex items-center justify-center mb-4">
          <AlertTriangle className="w-6 h-6" />
        </div>

        <h3
          id="delete-dialog-title"
          className="text-[19px] font-semibold text-[#0a0a0a] dark:text-white tracking-tight"
        >
          Delete Camera?
        </h3>

        <p
          id="delete-dialog-description"
          className="text-[14px] text-[#6b6b6b] dark:text-[#a1a1aa] mt-2 leading-relaxed tracking-tight"
        >
          Are you sure you want to remove <strong className="text-[#0a0a0a] dark:text-white">"{camera.name}"</strong>?
          This action cannot be undone.
        </p>

        <div className="mt-4 p-3 rounded-lg bg-[#fafafa] dark:bg-[#181820] border border-black/[0.06] dark:border-white/[0.08] text-[12px] text-[#6b6b6b] dark:text-[#a1a1aa] font-mono space-y-0.5">
          <div>ID: {camera.code}</div>
          <div>Zone: {camera.zone}</div>
          <div className="truncate">IP: {camera.ip}</div>
        </div>

        {/* Action Buttons: [ Cancel ] [ Delete Camera ] */}
        <div className="mt-6 flex items-center justify-end gap-2.5">
          <button
            ref={cancelBtnRef}
            type="button"
            id="cancel-delete-btn"
            onClick={onCancel}
            disabled={isDeleting}
            className="px-4 py-2 border border-black/[0.12] dark:border-white/[0.15] hover:bg-black/[0.04] dark:hover:bg-white/[0.05] text-[#0a0a0a] dark:text-white rounded-lg text-[13px] font-medium tracking-tight transition-all cursor-pointer focus:ring-2 focus:ring-black dark:focus:ring-white/20"
          >
            Cancel
          </button>

          <button
            type="button"
            id="confirm-delete-btn"
            onClick={onConfirm}
            disabled={isDeleting}
            className="px-4 py-2 bg-[#ef4444] hover:bg-[#dc2626] text-white rounded-lg text-[13px] font-semibold tracking-tight transition-all cursor-pointer flex items-center gap-2 shadow-xs active:scale-98"
          >
            {isDeleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>{isDeleting ? 'Removing...' : 'Delete Camera'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
