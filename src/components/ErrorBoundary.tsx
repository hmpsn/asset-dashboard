import { Component, type ReactNode, type ErrorInfo } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  label?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.label ? ` · ${this.props.label}` : ''}]`, error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500/8 border border-red-500/15">
          <AlertTriangle className="w-4 h-4 text-red-400/80 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-red-300">
              {this.props.label ? `${this.props.label} failed to load` : 'Something went wrong'}
            </div>
            <div className="text-[11px] text-zinc-500 mt-0.5 truncate">
              {this.state.error?.message || 'An unexpected error occurred'}
            </div>
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="text-[11px] text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded-lg border border-zinc-700 hover:border-zinc-600 transition-colors flex-shrink-0"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
