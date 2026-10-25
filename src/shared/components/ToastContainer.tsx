import { useLocale } from '../i18n/useLocale';
import { t } from '../i18n/locale';
import React from 'react';

import { AlertCircle, AlertTriangle, Info, CheckCircle2, X } from 'lucide-react';
import { useToast } from '../context/ToastContext';

export const ToastContainer: React.FC = () => {
  useLocale();
  const { toasts, dismissToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div
      style={{ zIndex: 999999 }}
      className="fixed top-5 left-1/2 -translate-x-1/2 sm:top-6 sm:right-6 sm:left-auto sm:translate-x-0 flex flex-col gap-2.5 max-w-md w-[calc(100vw-2rem)] sm:w-auto pointer-events-none select-none"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const isError = toast.type === 'error';
        const isWarning = toast.type === 'warning';
        const isSuccess = toast.type === 'success';

        let borderClass =
          'border-sky-500/60 bg-zinc-950/98 text-sky-100 shadow-2xl shadow-sky-950/60 ring-1 ring-sky-500/20';
        let icon = <Info className="w-5 h-5 text-sky-400 shrink-0" />;

        if (isError) {
          borderClass =
            'border-rose-500/80 bg-zinc-950/98 text-rose-100 shadow-2xl shadow-rose-950/80 ring-1 ring-rose-500/30';
          icon = <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />;
        } else if (isWarning) {
          borderClass =
            'border-amber-500/80 bg-zinc-950/98 text-amber-100 shadow-2xl shadow-amber-950/80 ring-1 ring-amber-500/30';
          icon = <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />;
        } else if (isSuccess) {
          borderClass =
            'border-emerald-500/80 bg-zinc-950/98 text-emerald-100 shadow-2xl shadow-emerald-950/80 ring-1 ring-emerald-500/30';
          icon = <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />;
        }

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center justify-between gap-3 px-4 py-3.5 rounded-2xl border-2 backdrop-blur-2xl animate-scale-in transition-all duration-300 ${borderClass}`}
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {icon}
              <p className="text-xs sm:text-sm font-bold leading-snug break-words">
                {toast.message}
              </p>
            </div>

            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              className="p-1 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white transition-colors shrink-0"
              title={t('Закрыть')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
