import { Clipboard, Flag } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { SectionCard, Badge, Icon } from '../ui';
import { adminPath } from '../../routes';
import { timeAgo } from '../../lib/timeAgo';

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
          titleIcon={<Icon as={Clipboard} size="md" className="text-amber-400/80" />}
          action={<button onClick={() => navigate(adminPath(workspaceId, 'requests'))} className="t-caption-sm text-teal-400 hover:text-teal-300 transition-colors">View All →</button>}
          noPadding
        >
          <div className="divide-y divide-[var(--brand-border)]">
            {requests.slice(0, 5).map(req => {
              const statusColor = req.status === 'new' || req.status === 'open' ? 'red' : req.status === 'in_progress' ? 'teal' : 'zinc';
              return (
                <div key={req.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="t-caption text-[var(--brand-text-bright)] truncate">{req.title}</div>
                    <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">{req.category} · {timeAgo(req.createdAt)}</div>
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
          titleIcon={<Icon as={Flag} size="md" className="text-[var(--brand-text-muted)]" />}
          action={<button onClick={() => navigate(adminPath(workspaceId, 'analytics-hub'))} className="t-caption-sm text-teal-400 hover:text-teal-300 transition-colors">View All →</button>}
          noPadding
        >
          <div className="divide-y divide-[var(--brand-border)]">
            {annotations.map(ann => (
              <div key={ann.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: ann.color || '#2dd4bf' }} />
                <div className="flex-1 min-w-0">
                  <div className="t-caption text-[var(--brand-text-bright)] truncate">{ann.label}</div>
                </div>
                <span className="t-caption-sm text-[var(--brand-text-muted)] flex-shrink-0">{ann.date}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
