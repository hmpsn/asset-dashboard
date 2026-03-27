import { Clipboard, Flag } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { SectionCard, Badge } from '../ui';
import { adminPath } from '../../routes';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface RequestEntry {
  id: string;
  title: string;
  status: string;
  category: string;
  createdAt: string;
}

interface AnnotationEntry {
  id: string;
  date: string;
  label: string;
  color?: string;
}

interface ActiveRequestsAnnotationsProps {
  requests: RequestEntry[];
  annotations: AnnotationEntry[];
  workspaceId: string;
}

export function ActiveRequestsAnnotations({ requests, annotations, workspaceId }: ActiveRequestsAnnotationsProps) {
  const navigate = useNavigate();
  if (requests.length === 0 && annotations.length === 0) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {requests.length > 0 && (
        <SectionCard
          title="Active Requests"
          titleIcon={<Clipboard className="w-4 h-4 text-amber-400" />}
          action={<button onClick={() => navigate(adminPath(workspaceId, 'requests'))} className="text-[11px] text-teal-400 hover:text-teal-300 transition-colors">View All →</button>}
          noPadding
        >
          <div className="divide-y divide-zinc-800/50">
            {requests.slice(0, 5).map(req => {
              const statusColor = req.status === 'new' || req.status === 'open' ? 'red' : req.status === 'in_progress' ? 'teal' : 'zinc';
              return (
                <div key={req.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-zinc-200 truncate">{req.title}</div>
                    <div className="text-[11px] text-zinc-500 mt-0.5">{req.category} · {timeAgo(req.createdAt)}</div>
                  </div>
                  <Badge label={req.status} color={statusColor} />
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {annotations.length > 0 && (
        <SectionCard
          title="Recent Annotations"
          titleIcon={<Flag className="w-4 h-4 text-zinc-500" />}
          action={<button onClick={() => navigate(adminPath(workspaceId, 'analytics-hub'))} className="text-[11px] text-teal-400 hover:text-teal-300 transition-colors">View All →</button>}
          noPadding
        >
          <div className="divide-y divide-zinc-800/50">
            {annotations.map(ann => (
              <div key={ann.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: ann.color || '#2dd4bf' }} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-zinc-200 truncate">{ann.label}</div>
                </div>
                <span className="text-[11px] text-zinc-500 flex-shrink-0">{ann.date}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
