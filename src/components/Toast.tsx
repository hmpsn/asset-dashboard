import { useState, useEffect, useCallback, createContext, useContext, type ReactNode } from 'react';
import { CheckCircle, AlertTriangle, X, Info } from 'lucide-react';
import { Icon, IconButton } from './ui';

interface ToastItem {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface ToastContextType {
  toast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const ToastContext = createContext<ToastContextType>({ toast: () => {} });

interface ToastProviderProps {
  children: ReactNode;
  durationMs?: number;
  placement?: 'bottom-right' | 'bottom-center';
  mode?: 'stack' | 'single';
  variant?: 'default' | 'client';
}

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({
  children,
  durationMs = 3000,
  placement = 'bottom-right',
  mode = 'stack',
  variant = 'default',
}: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts(prev => mode === 'single' ? [{ id, message, type }] : [...prev, { id, message, type }]);
  }, [mode]);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const containerClass = placement === 'bottom-center'
    ? 'fixed bottom-6 left-1/2 -translate-x-1/2 z-[var(--z-client-toast)] flex flex-col gap-2 pointer-events-none'
    : 'fixed bottom-4 right-4 z-[var(--z-system-toast)] flex flex-col gap-2 pointer-events-none';

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className={containerClass}>
        {toasts.map(t => (
          <ToastMessage key={t.id} item={t} onDismiss={dismiss} durationMs={durationMs} variant={variant} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastMessage({
  item,
  onDismiss,
  durationMs,
  variant,
}: {
  item: ToastItem;
  onDismiss: (id: string) => void;
  durationMs: number;
  variant: 'default' | 'client';
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => { // effect-layout-ok — intentional post-paint animation + dismiss timer
    requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onDismiss(item.id), 200);
    }, durationMs);
    return () => clearTimeout(timer);
  }, [durationMs, item.id, onDismiss]);

  const icons = {
    success: <Icon as={CheckCircle} size="md" className="text-emerald-400 shrink-0" />,
    error: <Icon as={AlertTriangle} size="md" className="text-red-400/80 shrink-0" />,
    info: <Icon as={Info} size="md" className="text-blue-400 shrink-0" />,
  };

  const borders = {
    success: 'border-emerald-500/20',
    error: 'border-red-500/20',
    info: 'border-blue-500/20',
  };

  if (variant === 'client') {
    const clientClasses = {
      success: 'bg-emerald-500/15 border-emerald-500/30 text-accent-success',
      error: 'bg-red-500/15 border-red-500/30 text-accent-danger',
      info: 'bg-blue-500/15 border-blue-500/30 text-blue-400',
    };

    return (
      <div
        className={`pointer-events-auto px-5 py-3 rounded-[var(--radius-xl)] border shadow-lg backdrop-blur-sm flex items-center gap-2.5 t-caption font-medium transition-all duration-200 ${clientClasses[item.type]} ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}
      >
        {icons[item.type]}
        <span className="t-caption font-medium">{item.message}</span>
        <IconButton
          onClick={() => { setVisible(false); setTimeout(() => onDismiss(item.id), 200); }}
          icon={X}
          label="Dismiss notification"
          variant="ghost"
          size="sm"
          className="ml-1"
        />
      </div>
    );
  }

  return (
    <div
      className={`pointer-events-auto flex items-center gap-2.5 px-4 py-3 rounded-[var(--radius-xl)] bg-[var(--surface-2)] border ${borders[item.type]} shadow-2xl shadow-black/40 t-caption text-[var(--brand-text-bright)] transition-all duration-200 ${visible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4'}`}
    >
        {icons[item.type]}
        <span className="t-caption">{item.message}</span>
        <IconButton
          onClick={() => { setVisible(false); setTimeout(() => onDismiss(item.id), 200); }}
          icon={X}
          label="Dismiss toast"
          variant="ghost"
          size="sm"
          className="ml-1 text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]"
        />
    </div>
  );
}
