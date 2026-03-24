import { AlertTriangle, RefreshCw, Wifi, Database } from 'lucide-react';

interface ErrorStateProps {
  title?: string;
  message?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  type?: 'network' | 'data' | 'permission' | 'general';
  className?: string;
}

export function ErrorState({ 
  title = 'Something went wrong', 
  message = 'Please try again or contact support if the issue persists.',
  action,
  type = 'general',
  className = ''
}: ErrorStateProps) {
  const getIconConfig = () => {
    switch (type) {
      case 'network': 
        return { Icon: Wifi, color: 'text-amber-400', bg: 'bg-amber-500/10' };
      case 'data': 
        return { Icon: Database, color: 'text-red-400', bg: 'bg-red-500/10' };
      case 'permission': 
        return { Icon: AlertTriangle, color: 'text-orange-400', bg: 'bg-orange-500/10' };
      default: 
        return { Icon: AlertTriangle, color: 'text-red-400', bg: 'bg-red-500/10' };
    }
  };

  const { Icon, color: iconColor, bg: bgColor } = getIconConfig();

  return (
    <div className={`flex flex-col items-center justify-center py-8 text-center ${className}`}>
      <div className={`w-12 h-12 rounded-xl ${bgColor} flex items-center justify-center mb-4`}>
        <Icon className={`w-6 h-6 ${iconColor}`} />
      </div>
      <h3 className="text-lg font-semibold text-zinc-200 mb-2">{title}</h3>
      <p className="text-sm text-zinc-500 mb-4 max-w-md">{message}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="px-4 py-2 bg-teal-600 hover:bg-teal-500 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
        >
          <RefreshCw className="w-3 h-3" />
          {action.label}
        </button>
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
