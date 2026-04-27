import { useState } from 'react';
import { Loader2, CheckCircle2, AlertTriangle, X, ChevronDown, ChevronUp, Activity, StopCircle, Ban } from 'lucide-react';
import { Icon } from './ui';
import { useBackgroundTasks, type BackgroundJob } from '../hooks/useBackgroundTasks';

const TYPE_LABELS: Record<string, string> = {
  'seo-audit': 'SEO Audit',
  'compress': 'Compress Image',
  'bulk-compress': 'Bulk Compress',
  'bulk-alt': 'Bulk Alt Text',
  'bulk-seo-fix': 'Bulk SEO Fix',
  'sales-report': 'Sales Report',
  'schema-generator': 'Schema Generator',
  'keyword-strategy': 'Keyword Strategy',
  'page-analysis': 'Page Analysis',
};

function JobRow({ job, onDismiss, onCancel }: { job: BackgroundJob; onDismiss: () => void; onCancel: () => void }) {
  const label = TYPE_LABELS[job.type] || job.type;
  const isActive = job.status === 'pending' || job.status === 'running';
  const pct = job.total && job.progress != null ? Math.round((job.progress / job.total) * 100) : null;

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
        {isActive && (
          <button onClick={onCancel} className="opacity-0 group-hover:opacity-100 text-[var(--brand-text-muted)] hover:text-red-400 transition-all" title="Stop">
            <Icon as={StopCircle} size="sm" />
          </button>
        )}
        {!isActive && (
          <button onClick={onDismiss} className="opacity-0 group-hover:opacity-100 text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-all">
            <Icon as={X} size="sm" />
          </button>
        )}
      </div>
      {isActive && pct != null && (
        <div className="mt-1.5 h-1 bg-[var(--surface-3)] rounded-full overflow-hidden">
          <div
            className="h-full bg-teal-500 rounded-full transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

export function TaskPanel() {
  const { jobs, activeJobs, dismissJob, cancelJob, clearDone } = useBackgroundTasks();
  const [expanded, setExpanded] = useState(false);

  const recentJobs = jobs.filter(j => !j.dismissed).slice(0, 10);
  const doneCount = recentJobs.filter(j => j.status === 'done' || j.status === 'error').length;

  if (recentJobs.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80">
      {/* Header pill */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-t-[var(--radius-xl)] hover:border-[var(--brand-border-hover)] transition-colors"
        style={!expanded ? { borderRadius: 'var(--radius-xl)' } : undefined}
      >
        {activeJobs.length > 0 ? (
          <Icon as={Loader2} size="md" className="animate-spin text-teal-400" />
        ) : (
          <Icon as={Activity} size="md" className="text-[var(--brand-text-muted)]" />
        )}
        <span className="t-caption font-medium text-[var(--brand-text)] flex-1 text-left">
          {activeJobs.length > 0
            ? `${activeJobs.length} task${activeJobs.length > 1 ? 's' : ''} running`
            : `${doneCount} task${doneCount > 1 ? 's' : ''} completed`
          }
        </span>
        {doneCount > 0 && !expanded && (
          <button
            onClick={(e) => { e.stopPropagation(); clearDone(); }}
            className="t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] px-1"
          >
            Clear
          </button>
        )}
        {expanded
          ? <Icon as={ChevronDown} size="sm" className="text-[var(--brand-text-muted)]" />
          : <Icon as={ChevronUp} size="sm" className="text-[var(--brand-text-muted)]" />
        }
      </button>

      {/* Expandable list */}
      {expanded && (
        <div className="bg-[var(--surface-2)] border border-t-0 border-[var(--brand-border)] rounded-b-[var(--radius-xl)] max-h-[300px] overflow-y-auto">
          {recentJobs.map(job => (
            <JobRow key={job.id} job={job} onDismiss={() => dismissJob(job.id)} onCancel={() => cancelJob(job.id)} />
          ))}
          {doneCount > 0 && (
            <div className="px-3 py-2 text-center">
              <button onClick={clearDone} className="t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors">
                Clear completed
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
