import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bell, AlertTriangle, X, Activity, Loader2, CheckCircle2, Ban, StopCircle } from 'lucide-react';
import { adminPath, type Page } from '../routes';
import { useNotifications } from '../hooks/admin/useNotifications';
import { useBackgroundTasks, type BackgroundJob } from '../hooks/useBackgroundTasks';
import { getBackgroundJobLabel, isBackgroundJobCancellable } from '../../shared/types/background-jobs';
import { EmptyState, Icon, Button, IconButton, ClickableRow } from './ui';

interface NotificationBellProps {
  onSelectWorkspace: (workspaceId: string) => void;
  workspaceId?: string;
}

function getWorkspaceIdFromPathname(pathname: string): string | undefined {
  return pathname.match(/^\/ws\/([^/]+)/)?.[1];
}

function notificationCategory(id: string): 'actions' | 'alerts' | 'system' {
  if (id.startsWith('anomaly-') || id.startsWith('churn-')) return 'alerts';
  if (
    id.startsWith('requests-')
    || id.startsWith('approvals-')
    || id.startsWith('content-')
    || id.startsWith('content-plan-')
    || id.startsWith('orders-')
    || id.startsWith('signals-')
  ) return 'actions';
  return 'system';
}

function isTerminalJob(job: BackgroundJob): boolean {
  return job.status === 'done' || job.status === 'error' || job.status === 'cancelled';
}

function JobRow({ job, onDismiss, onCancel }: { job: BackgroundJob; onDismiss: () => void; onCancel: () => void }) {
  const label = getBackgroundJobLabel(job.type);
  const isActive = !isTerminalJob(job);
  const canCancel = isActive && isBackgroundJobCancellable(job.type);
  const pct = job.total && job.progress != null ? Math.round((job.progress / job.total) * 100) : null;
  const progressText = job.total && job.progress != null ? `${job.progress}/${job.total}` : null;

  return (
    <div className="px-4 py-2.5 border-b border-[var(--brand-border)] last:border-0 group">
      <div className="flex items-center gap-2">
        {isActive && <Icon as={Loader2} size="md" className="animate-spin text-teal-400 flex-shrink-0" />}
        {job.status === 'done' && <Icon as={CheckCircle2} size="md" className="text-emerald-400 flex-shrink-0" />}
        {job.status === 'error' && <Icon as={AlertTriangle} size="md" className="text-red-400/80 flex-shrink-0" />}
        {job.status === 'cancelled' && <Icon as={Ban} size="md" className="text-[var(--brand-text-muted)] flex-shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="t-caption font-medium text-[var(--brand-text-bright)] truncate">{label}</div>
          <div className="t-micro text-[var(--brand-text-muted)] truncate">{job.message}</div>
        </div>
        {canCancel && (
          <IconButton
            icon={StopCircle}
            label={`Stop ${label}`}
            title="Stop task"
            size="sm"
            variant="ghost"
            onClick={onCancel}
            className="opacity-0 group-hover:opacity-100 text-[var(--brand-text-muted)] hover:text-red-400 transition-all"
          />
        )}
        {!isActive && (
          <IconButton
            icon={X}
            label={`Dismiss ${label}`}
            size="sm"
            variant="ghost"
            onClick={onDismiss}
            className="opacity-0 group-hover:opacity-100 text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-all"
          />
        )}
      </div>
      {isActive && (pct != null || progressText) && (
        <div className="mt-1.5 flex items-center gap-2">
          {pct != null && (
            <div className="h-1 bg-[var(--surface-3)] rounded-[var(--radius-pill)] overflow-hidden flex-1">
              <div className="h-full bg-teal-500 rounded-[var(--radius-pill)] transition-all duration-300" style={{ width: `${pct}%` }} />
            </div>
          )}
          {progressText && <span className="t-micro text-[var(--brand-text-muted)] tabular-nums">{progressText}</span>}
        </div>
      )}
    </div>
  );
}

export function NotificationBell({ onSelectWorkspace, workspaceId }: NotificationBellProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const { data: items = [] } = useNotifications();
  const { jobsForWorkspace, dismissJob, cancelJob, clearDone } = useBackgroundTasks();
  const visibleWorkspaceId = workspaceId ?? getWorkspaceIdFromPathname(location.pathname);
  const jobItems = jobsForWorkspace(visibleWorkspaceId).filter((job) => !job.dismissed).slice(0, 10);
  const actionItems = items.filter(item => notificationCategory(item.id) === 'actions');
  const alertItems = items.filter(item => notificationCategory(item.id) === 'alerts');
  const systemItems = items.filter(item => notificationCategory(item.id) === 'system');
  const doneJobs = jobItems.filter(isTerminalJob);
  const hasAnyItems = (items.length + jobItems.length) > 0;

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
        {hasAnyItems && (
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
              {hasAnyItems && (
                <span className="t-micro font-bold px-1.5 py-0.5 rounded-[var(--radius-pill)] badge-span-ok bg-red-500/20 text-red-400/80 tabular-nums">
                  {items.length + jobItems.length}
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
            {hasAnyItems ? (
              <div>
                {actionItems.length > 0 && (
                  <>
                    <div className="px-4 py-2 border-b border-[var(--brand-border)] bg-[var(--surface-3)]">
                      <span className="t-micro uppercase tracking-wider text-[var(--brand-text-muted)] font-semibold">Actions Needed</span>
                    </div>
                    <div className="divide-y divide-[var(--brand-border)]">
                      {actionItems.map(item => {
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
                  </>
                )}

                {alertItems.length > 0 && (
                  <>
                    <div className="px-4 py-2 border-b border-[var(--brand-border)] bg-[var(--surface-3)]">
                      <span className="t-micro uppercase tracking-wider text-[var(--brand-text-muted)] font-semibold">Alerts</span>
                    </div>
                    <div className="divide-y divide-[var(--brand-border)]">
                      {alertItems.map(item => {
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
                  </>
                )}

                {(systemItems.length > 0 || jobItems.length > 0) && (
                  <>
                    <div className="px-4 py-2 border-b border-[var(--brand-border)] bg-[var(--surface-3)] flex items-center justify-between">
                      <span className="t-micro uppercase tracking-wider text-[var(--brand-text-muted)] font-semibold">System Events</span>
                      {doneJobs.length > 0 && (
                        <Button
                          onClick={() => clearDone(visibleWorkspaceId)}
                          variant="ghost"
                          size="sm"
                          className="t-micro text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] px-1.5 py-0.5"
                        >
                          Clear completed
                        </Button>
                      )}
                    </div>
                    {systemItems.length > 0 && (
                      <div className="divide-y divide-[var(--brand-border)]">
                        {systemItems.map(item => {
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
                              <Icon as={Activity} size="sm" className="text-[var(--brand-text-dim)] flex-shrink-0" />
                            </ClickableRow>
                          );
                        })}
                      </div>
                    )}
                    {jobItems.length > 0 && (
                      <div className="divide-y divide-[var(--brand-border)]">
                        {jobItems.map(job => (
                          <JobRow
                            key={job.id}
                            job={job}
                            onDismiss={() => dismissJob(job.id)}
                            onCancel={() => cancelJob(job.id)}
                          />
                        ))}
                      </div>
                    )}
                  </>
                )}
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
