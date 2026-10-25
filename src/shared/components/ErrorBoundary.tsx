import { t } from '../i18n/locale';
import { Component, ErrorInfo, ReactNode } from 'react';
import { logger } from '../utils/logger';

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  mode?: 'full' | 'inline' | 'silent';
  name?: string;
  onReset?: () => void;
  onError?: (error: Error) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.props.onError?.(error);
    const componentName = this.props.name || 'UnknownComponent';
    logger.error(
      `[ErrorBoundary:${componentName}] Caught unhandled error:`,
      error,
      errorInfo.componentStack,
    );
    this.setState({ errorInfo });
  }

  resetError = (): void => {
    if (this.props.onReset) {
      this.props.onReset();
    }
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  handleHardReload = (): void => {
    window.location.reload();
  };

  handleClearCacheAndReload = (): void => {
    try {
      localStorage.removeItem('soso_audio_state');
      localStorage.removeItem('soso_queue');
      sessionStorage.clear();
    } catch (e) {
      logger.warn('[ErrorBoundary] Failed to clear local cache:', e);
    }
    window.location.reload();
  };

  render(): ReactNode {
    const { hasError, error } = this.state;
    const { children, fallback, mode = 'full', name } = this.props;

    if (!hasError) {
      return children;
    }

    if (typeof fallback === 'function') {
      return fallback(error || new Error('Unknown error'), this.resetError);
    }

    if (fallback !== undefined) {
      return fallback;
    }

    if (mode === 'silent') {
      return null;
    }

    if (mode === 'inline') {
      return (
        <div className="p-3 my-2 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-200 flex items-center justify-between gap-2">
          <span>
            {t('Сбой компонента')} {name ? `«${name}»` : ''}
          </span>
          <button
            onClick={this.resetError}
            className="px-2.5 py-1 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-100 transition font-medium"
          >
            {t('Повторить')}{' '}
          </button>
        </div>
      );
    }

    // mode === 'full' (Root error fallback)
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-slate-950 text-slate-100 p-6 selection:bg-rose-500/30">
        <div className="max-w-md w-full bg-slate-900/90 border border-slate-800 backdrop-blur-xl rounded-2xl p-6 shadow-2xl space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center text-red-400">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">{t('Произошла ошибка в SoSo Music')}</h2>
              <p className="text-xs text-slate-400">
                {t('Приложение перехвачено системой защиты от сбоев')}{' '}
              </p>
            </div>
          </div>

          <div className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-xl text-xs font-mono text-slate-300 break-words max-h-36 overflow-y-auto">
            {error?.message || t('Неизвестная ошибка рендеринга')}
          </div>

          <div className="flex flex-col gap-2 pt-2">
            <button
              onClick={this.resetError}
              className="w-full py-2.5 px-4 rounded-xl bg-linear-to-r from-rose-500 to-pink-600 hover:from-rose-600 hover:to-pink-700 text-white font-medium text-sm transition shadow-lg shadow-rose-500/20 active:scale-[0.99]"
            >
              {t('Попробовать продолжить')}{' '}
            </button>
            <div className="flex gap-2">
              <button
                onClick={this.handleHardReload}
                className="flex-1 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition"
              >
                {t('Перезагрузить окно')}{' '}
              </button>
              <button
                onClick={this.handleClearCacheAndReload}
                className="flex-1 py-2 px-3 rounded-xl bg-red-950/40 hover:bg-red-900/40 border border-red-800/30 text-red-300 text-xs font-medium transition"
              >
                {t('Сбросить кэш и рестарт')}{' '}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
