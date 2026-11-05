import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in component tree:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  private handleGoHome = () => {
    window.location.href = '/';
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center" data-testid="error-boundary-fallback">
          <div className="w-12 h-12 rounded-2xl bg-rose-500/10 text-rose-500 flex items-center justify-center mb-4">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h2 className="text-base font-semibold text-cme-text-base mb-1">
            Something went wrong displaying this view
          </h2>
          <p className="text-xs text-cme-text-muted max-w-md mb-4 leading-relaxed">
            An unexpected error occurred. You can try refreshing the page or navigating back to your dashboard.
          </p>

          {this.state.error?.message && (
            <div className="mb-6 p-3 rounded-lg bg-cme-bg-subtle border border-cme-border-base text-xs font-mono text-rose-600 max-w-lg text-left overflow-auto max-h-32">
              {this.state.error.message}
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={this.handleReset}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cme-border-base bg-cme-bg-surface hover:bg-cme-bg-hover text-xs font-medium text-cme-text-base transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Try Again</span>
            </button>
            <button
              onClick={this.handleGoHome}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cme-primary text-white hover:bg-cme-primary-hover text-xs font-medium transition-colors shadow-sm"
            >
              <Home className="w-3.5 h-3.5" />
              <span>Go to Tasks</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
