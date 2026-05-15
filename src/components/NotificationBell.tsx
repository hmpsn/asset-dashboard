import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, AlertTriangle, X } from 'lucide-react';
import { adminPath, type Page } from '../routes';
import { useNotifications } from '../hooks/admin/useNotifications';
import { EmptyState, Icon, Button, IconButton, ClickableRow } from './ui';

interface NotificationBellProps {
  onSelectWorkspace: (workspaceId: string) => void;
}

export function NotificationBell({ onSelectWorkspace }: NotificationBellProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { data: items = [] } = useNotifications();

  // Keyboard close (Escape) — guards against hijacking text input.
  // The drawer can be opened via mouse click while focus is still in an
  // unrelated input/textarea elsewhere on the page; in that scenario,
  // pressing Escape to clear the input would unintentionally close the
  // drawer. The isContentEditable guard early-returns when the user is
  // typing, leaving Escape free to do its native dismiss-input job.
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable) return;
      setOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  const hasItems = items.length > 0;

  return (
    <>
      {/* Bell trigger button */}
      <Button
        onClick={() => setOpen(prev => !prev)}
        title="Notifications"
        variant="ghost"
        size="sm"
        className={`p-2 rounded-[var(--radius-lg)] transition-all relative ${
          open ? 'text-teal-400 bg-teal-500/10' : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--surface-3)]'
        }`}
      >
        <Icon as={Bell} size="md" />
        {hasItems && (
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-[var(--radius-pill)] bg-red-500 ring-2 ring-[var(--surface-1)]" />
        )}
      </Button>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-[var(--z-modal-backdrop)]" // fixed-inset-ok — dropdown backdrop
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Fixed slide-out drawer — slides in from left, 360px wide, z-[var(--z-modal)] */}
      {open && (
        <div
          data-testid="notification-drawer"
          className="fixed top-0 left-0 h-screen w-[360px] bg-[var(--surface-2)] border-r border-[var(--brand-border)] shadow-2xl shadow-black/40 z-[var(--z-modal)] flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--brand-border)] flex-shrink-0">
            <span className="t-caption font-semibold text-[var(--brand-text-bright)]">Notifications</span>
            <div className="flex items-center gap-2">
              {hasItems && (
                <span className="t-micro font-bold px-1.5 py-0.5 rounded-[var(--radius-pill)] bg-red-500/20 text-red-400/80 tabular-nums">
                  {items.length}
                </span>
              )}
              <IconButton
                onClick={() => setOpen(false)}
                icon={X}
                label="Close notifications"
                variant="ghost"
                size="sm"
                className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
              />
            </div>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto">
            {hasItems ? (
              <div className="divide-y divide-[var(--brand-border)]">
                {items.map(item => {
                  const ItemIcon = item.icon;
                  return (
                    <ClickableRow
                      key={item.id}
                      onClick={() => {
                        if (item.workspaceId) {
                          onSelectWorkspace(item.workspaceId);
                          navigate(adminPath(item.workspaceId, item.tab as Page));
                        }
                        setOpen(false);
                      }}
                      className="flex items-center gap-2.5 px-4 py-3 hover:bg-[var(--surface-3)] text-left bg-transparent"
                    >
                      <Icon as={ItemIcon} size="sm" className={`flex-shrink-0 ${item.color}`} />
                      <div className="flex-1 min-w-0">
                        <div className="t-caption font-medium text-[var(--brand-text-bright)] truncate">{item.label}</div>
                        <div className="t-micro text-[var(--brand-text-muted)] truncate">{item.sub}</div>
                      </div>
                      <Icon as={AlertTriangle} size="sm" className="text-[var(--brand-text-dim)] flex-shrink-0" />
                    </ClickableRow>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                icon={Bell}
                title="All clear"
                description="Nothing needs attention right now"
                className="py-8"
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
