import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, MessageSquare, AlertTriangle, X } from 'lucide-react';
import { adminPath, type Page } from '../routes';
import { useClientSignals } from '../hooks/admin/useClientSignals';
import { useNotifications } from '../hooks/admin/useNotifications';
import { EmptyState } from './ui/EmptyState';

interface NotificationBellProps {
  onSelectWorkspace: (workspaceId: string) => void;
  /** Optional: when provided, shows new client signal count badge in the drawer */
  workspaceId?: string;
}

export function NotificationBell({ onSelectWorkspace, workspaceId }: NotificationBellProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { data: items = [] } = useNotifications();
  const { data: clientSignals } = useClientSignals(workspaceId);
  const newSignalCount = (clientSignals ?? []).filter(s => s.status === 'new').length;

  // Keyboard close (Escape)
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  const hasItems = items.length > 0;

  return (
    <>
      {/* Bell trigger button */}
      <button
        onClick={() => setOpen(prev => !prev)}
        title="Notifications"
        className={`p-2 rounded-lg transition-all relative ${
          open ? 'text-teal-400 bg-teal-500/10' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
        }`}
      >
        <Bell className="w-4 h-4" />
        {(hasItems || newSignalCount > 0) && (
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500 ring-2 ring-[#0f1219]" />
        )}
      </button>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Fixed slide-out drawer — slides in from left, 360px wide, z-50 */}
      {open && (
        <div
          data-testid="notification-drawer"
          className="fixed top-0 left-0 h-screen w-[360px] bg-zinc-900 border-r border-zinc-800 shadow-2xl shadow-black/40 z-50 flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 flex-shrink-0">
            <span className="text-xs font-semibold text-zinc-200">Notifications</span>
            <div className="flex items-center gap-2">
              {hasItems && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400/80 tabular-nums">
                  {items.length}
                </span>
              )}
              <button
                onClick={() => setOpen(false)}
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
                aria-label="Close notifications"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Client Signals section (shown when workspaceId provided and signals exist) */}
          {newSignalCount > 0 && (
            <div className="px-4 py-2.5 border-b border-zinc-800 bg-amber-500/5 flex-shrink-0">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-3.5 h-3.5 text-amber-400/80 flex-shrink-0" />
                <span className="text-[11px] font-medium text-zinc-200">
                  {newSignalCount} new client signal{newSignalCount > 1 ? 's' : ''}
                </span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400/80 border border-amber-500/20 ml-auto tabular-nums">
                  {newSignalCount}
                </span>
              </div>
            </div>
          )}

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto">
            {items.length > 0 ? (
              <div className="divide-y divide-zinc-800/50">
                {items.map(item => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        if (item.workspaceId) {
                          onSelectWorkspace(item.workspaceId);
                          navigate(adminPath(item.workspaceId, item.tab as Page));
                        }
                        setOpen(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-zinc-800/30 transition-colors text-left"
                    >
                      <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${item.color}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-medium text-zinc-200 truncate">{item.label}</div>
                        <div className="text-[10px] text-zinc-500 truncate">{item.sub}</div>
                      </div>
                      <AlertTriangle className="w-3 h-3 text-zinc-700 flex-shrink-0" />
                    </button>
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
