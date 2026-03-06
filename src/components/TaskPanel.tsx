import { useState } from 'react';
import { Loader2, CheckCircle2, AlertTriangle, X, ChevronDown, ChevronUp, Activity } from 'lucide-react';
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
};

function JobRow({ job, onDismiss }: { job: BackgroundJob; onDismiss: () => void }) {
  const label = TYPE_LABELS[job.type] || job.type;
  const isActive = job.status === 'pending' || job.status === 'running';
  const pct = job.total && job.progress != null ? Math.round((job.progress / job.total) * 100) : null;

  return (
    <div className="px-3 py-2.5 border-b border-zinc-800/50 last:border-0 group">
      <div className="flex items-center gap-2">
        {isActive && <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-400 flex-shrink-0" />}
        {job.status === 'done' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />}
        {job.status === 'error' && <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-zinc-200 truncate">{label}</div>
          <div className="text-[10px] text-zinc-500 truncate">{job.message}</div>
        </div>
        {!isActive && (
          <button onClick={onDismiss} className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-zinc-400 transition-all">
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      {isActive && pct != null && (
        <div className="mt-1.5 h-1 bg-zinc-800 rounded-full overflow-hidden">
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
  const { jobs, activeJobs, dismissJob, clearDone } = useBackgroundTasks();
  const [expanded, setExpanded] = useState(false);

  const recentJobs = jobs.filter(j => !j.dismissed).slice(0, 10);
  const doneCount = recentJobs.filter(j => j.status === 'done' || j.status === 'error').length;

  if (recentJobs.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80">
      {/* Header pill */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-t-xl hover:border-zinc-700 transition-colors"
        style={!expanded ? { borderRadius: '12px' } : undefined}
      >
        {activeJobs.length > 0 ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-400" />
        ) : (
          <Activity className="w-3.5 h-3.5 text-zinc-500" />
        )}
        <span className="text-xs font-medium text-zinc-300 flex-1 text-left">
          {activeJobs.length > 0
            ? `${activeJobs.length} task${activeJobs.length > 1 ? 's' : ''} running`
            : `${doneCount} task${doneCount > 1 ? 's' : ''} completed`
          }
        </span>
        {doneCount > 0 && !expanded && (
          <button
            onClick={(e) => { e.stopPropagation(); clearDone(); }}
            className="text-[10px] text-zinc-600 hover:text-zinc-400 px-1"
          >
            Clear
          </button>
        )}
        {expanded ? <ChevronDown className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronUp className="w-3.5 h-3.5 text-zinc-500" />}
      </button>

      {/* Expandable list */}
      {expanded && (
        <div className="bg-zinc-900 border border-t-0 border-zinc-800 rounded-b-xl max-h-[300px] overflow-y-auto">
          {recentJobs.map(job => (
            <JobRow key={job.id} job={job} onDismiss={() => dismissJob(job.id)} />
          ))}
          {doneCount > 0 && (
            <div className="px-3 py-2 text-center">
              <button onClick={clearDone} className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">
                Clear completed
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
