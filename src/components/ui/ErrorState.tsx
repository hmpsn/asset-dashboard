import { AlertTriangle, RefreshCw, Wifi, Database } from 'lucide-react';
import { Button } from './Button';

interface ErrorStateProps {
  title?: string;
  message?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  actions?: {
    label: string;
    onClick: () => void;
    variant?: 'primary' | 'secondary';
  }[];
  type?: 'network' | 'data' | 'permission' | 'general';
  className?: string;
}

export function ErrorState({
  title = 'Something went wrong',
  message = 'Please try again or contact support if the issue persists.',
  action,
  actions,
  type = 'general',
  className = ''
}: ErrorStateProps) {
  const getIconConfig = () => {
    switch (type) {
      case 'network':
        return { Icon: Wifi, color: 'text-amber-400/80', bg: 'bg-amber-500/8' };
      case 'data':
        return { Icon: Database, color: 'text-red-400/80', bg: 'bg-red-500/8' };
      case 'permission':
        return { Icon: AlertTriangle, color: 'text-orange-400', bg: 'bg-orange-500/10' };
      default:
        return { Icon: AlertTriangle, color: 'text-red-400/80', bg: 'bg-red-500/8' };
    }
  };

  const { Icon, color: iconColor, bg: bgColor } = getIconConfig();

  const resolvedActions = actions ?? (action ? [{ ...action, variant: 'primary' as const }] : []);

  return (
    <div role="alert" className={`flex flex-col items-center justify-center py-8 text-center ${className}`}>
      <div className={`w-12 h-12 rounded-xl ${bgColor} flex items-center justify-center mb-4`}>
        <Icon className={`w-6 h-6 ${iconColor}`} />
      </div>
      <h3 className="t-h2 font-semibold text-[var(--brand-text-bright)] mb-2">{title}</h3>
      <p className="t-body text-[var(--brand-text-muted)] mb-4 max-w-md">{message}</p>
      {resolvedActions.length > 0 && (
        <div className="flex items-center gap-2">
          {resolvedActions.map((a) => (
            <Button
              key={a.label}
              onClick={a.onClick}
              variant={a.variant === 'secondary' ? 'secondary' : 'primary'}
              icon={a.variant !== 'secondary' ? RefreshCw : undefined}
            >
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

// Helper functions for common error scenarios
export const NetworkError = ({ onRetry, className }: { onRetry: () => void; className?: string }) => (
  <ErrorState
    title="Connection error"
    message="Unable to connect to the server. Check your internet connection and try again."
    action={{ label: 'Retry', onClick: onRetry }}
    type="network"
    className={className}
  />
);

export const DataError = ({ onRetry, className }: { onRetry: () => void; className?: string }) => (
  <ErrorState
    title="Data loading failed"
    message="We couldn't load your data. This might be a temporary issue."
    action={{ label: 'Try Again', onClick: onRetry }}
    type="data"
    className={className}
  />
);

export const PermissionError = ({ className }: { className?: string }) => (
  <ErrorState
    title="Access denied"
    message="You don't have permission to view this content. Contact your administrator if you think this is an error."
    type="permission"
    className={className}
  />
);
