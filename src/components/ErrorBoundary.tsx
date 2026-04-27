import { Component, type ReactNode, type ErrorInfo } from 'react';
import { Icon } from './ui';
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
        <div className="flex items-center gap-3 px-4 py-3 rounded-[var(--radius-xl)] bg-red-500/8 border border-red-500/15">
          <Icon as={AlertTriangle} size="md" className="text-red-400/80 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="t-caption font-medium text-red-300">
              {this.props.label ? `${this.props.label} failed to load` : 'Something went wrong'}
            </div>
            <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5 truncate">
              {this.state.error?.message || 'An unexpected error occurred'}
            </div>
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] px-2 py-1 rounded-[var(--radius-lg)] border border-[var(--brand-border-hover)] hover:border-[var(--brand-border-hover)] transition-colors flex-shrink-0"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
