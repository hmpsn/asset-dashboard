import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Loader2, CheckCircle2, AlertTriangle, X, ChevronDown, ChevronUp, Activity, StopCircle, Ban } from 'lucide-react';
import { Icon, Button, IconButton } from './ui';
import { useBackgroundTasks, type BackgroundJob } from '../hooks/useBackgroundTasks';
import { getBackgroundJobLabel, isBackgroundJobCancellable } from '../../shared/types/background-jobs';

function getWorkspaceIdFromPathname(pathname: string): string | undefined {
  return pathname.match(/^\/ws\/([^/]+)/)?.[1];
}

function JobRow({ job, onDismiss, onCancel }: { job: BackgroundJob; onDismiss: () => void; onCancel: () => void }) {
  const label = getBackgroundJobLabel(job.type);
  const isActive = job.status === 'pending' || job.status === 'running';
  const canCancel = isActive && isBackgroundJobCancellable(job.type);
  const pct = job.total && job.progress != null ? Math.round((job.progress / job.total) * 100) : null;
  const progressText = job.total && job.progress != null ? `${job.progress}/${job.total}` : null;

  return (
    <div className="px-3 py-2.5 border-b border-[var(--brand-border)] last:border-0 group">
      <div className="flex items-center gap-2">
        {isActive && <Icon as={Loader2} size="md" className="animate-spin text-teal-400 flex-shrink-0" />}
        {job.status === 'done' && <Icon as={CheckCircle2} size="md" className="text-emerald-400 flex-shrink-0" />}
        {job.status === 'error' && <Icon as={AlertTriangle} size="md" className="text-red-400/80 flex-shrink-0" />}
        {job.status === 'cancelled' && <Icon as={Ban} size="md" className="text-[var(--brand-text-muted)] flex-shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="t-caption font-medium text-[var(--brand-text-bright)] truncate">{label}</div>
          <div className="t-caption-sm text-[var(--brand-text-muted)] truncate">{job.message}</div>
        </div>
        {canCancel && (
          <IconButton
            icon={StopCircle}
            label={`Stop ${label}`}
            title="Stop"
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
              <div
                className="h-full bg-teal-500 rounded-[var(--radius-pill)] transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
          {progressText && <span className="t-micro text-[var(--brand-text-muted)] tabular-nums">{progressText}</span>}
        </div>
      )}
    </div>
  );
}

export function TaskPanel({ workspaceId }: { workspaceId?: string }) {
  const location = useLocation();
  const { jobsForWorkspace, dismissJob, cancelJob, clearDone } = useBackgroundTasks();
  const [expanded, setExpanded] = useState(false);
  const visibleWorkspaceId = workspaceId ?? getWorkspaceIdFromPathname(location.pathname);

  const scopedJobs = jobsForWorkspace(visibleWorkspaceId);
  const activeJobs = scopedJobs.filter(j => j.status === 'pending' || j.status === 'running');
  const recentJobs = scopedJobs.filter(j => !j.dismissed).slice(0, 10);
  const doneCount = recentJobs.filter(j => j.status === 'done' || j.status === 'error' || j.status === 'cancelled').length;
  const summary = activeJobs.length > 0
    ? `${activeJobs.length} task${activeJobs.length > 1 ? 's' : ''} running`
    : `${doneCount} task${doneCount > 1 ? 's' : ''} completed`;

  if (recentJobs.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[var(--z-modal)] w-80">
      {/* Header pill */}
      <div
        className="w-full flex items-center gap-2 px-3 py-2 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-t-[var(--radius-xl)] hover:border-[var(--brand-border-hover)] transition-colors"
        style={!expanded ? { borderRadius: 'var(--radius-xl)' } : undefined}
      >
        <Button
          onClick={() => setExpanded(!expanded)}
          variant="ghost"
          size="sm"
          className="flex items-center gap-2 flex-1 min-w-0 !px-0 !py-0 !justify-start text-left bg-transparent hover:bg-transparent"
          aria-expanded={expanded}
          aria-label={`${summary}. ${expanded ? 'Hide' : 'Show'} background tasks`}
        >
          {activeJobs.length > 0 ? (
            <Icon as={Loader2} size="md" className="animate-spin text-teal-400" />
          ) : (
            <Icon as={Activity} size="md" className="text-[var(--brand-text-muted)]" />
          )}
          <span className="t-caption font-medium text-[var(--brand-text)] flex-1 truncate">
            {summary}
          </span>
          {expanded
            ? <Icon as={ChevronDown} size="sm" className="text-[var(--brand-text-muted)]" />
            : <Icon as={ChevronUp} size="sm" className="text-[var(--brand-text-muted)]" />
          }
        </Button>
        {doneCount > 0 && !expanded && (
          <Button
            onClick={(e) => { e.stopPropagation(); clearDone(visibleWorkspaceId); }}
            variant="ghost"
            size="sm"
            className="t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] !px-1"
          >
            Clear
          </Button>
        )}
      </div>

      {/* Expandable list */}
      {expanded && (
        <div className="bg-[var(--surface-2)] border border-t-0 border-[var(--brand-border)] rounded-b-[var(--radius-xl)] max-h-[300px] overflow-y-auto">
          {recentJobs.map(job => (
            <JobRow key={job.id} job={job} onDismiss={() => dismissJob(job.id)} onCancel={() => cancelJob(job.id)} />
          ))}
          {doneCount > 0 && (
            <div className="px-3 py-2 text-center">
              <Button
                onClick={() => clearDone(visibleWorkspaceId)}
                variant="ghost"
                size="sm"
                className="t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]"
              >
                Clear completed
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
