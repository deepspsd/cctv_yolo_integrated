import React from 'react';
import { Toast } from '../types';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div
      id="toast-container"
      aria-live="polite"
      className="fixed bottom-5 right-5 z-50 flex flex-col space-y-2 max-w-[380px] w-full pointer-events-none"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto relative overflow-hidden flex items-start gap-3 p-3.5 bg-[#0a0a0a] text-white rounded-xl shadow-2xl border border-white/10 text-[13px] tracking-tight animate-in slide-in-from-bottom-3 duration-200 group"
        >
          <div className="shrink-0 mt-0.5">
            {toast.type === 'success' && <CheckCircle2 className="w-4 h-4 text-[#17c964]" />}
            {toast.type === 'error' && <AlertCircle className="w-4 h-4 text-[#ef4444]" />}
            {toast.type === 'info' && <Info className="w-4 h-4 text-orange-400" />}
          </div>

          <div className="flex-1 font-medium leading-snug">{toast.message}</div>

          <button
            onClick={() => onDismiss(toast.id)}
            className="p-1 text-white/50 hover:text-white rounded transition-colors shrink-0 cursor-pointer"
            aria-label="Dismiss notification"
          >
            <X className="w-3.5 h-3.5" />
          </button>

          {/* Shrinking Lifespan Progress Bar */}
          <div
            className={`absolute bottom-0 left-0 h-[2px] animate-toast-progress group-hover:[animation-play-state:paused] ${
              toast.type === 'success' ? 'bg-[#17c964]' : toast.type === 'error' ? 'bg-[#ef4444]' : 'bg-orange-500'
            }`}
          />
        </div>
      ))}
    </div>
  );
};
