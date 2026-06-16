/**
 * LostQueryRecoveryCard — Act band surface for queries that lost search visibility.
 *
 * Reads the lost_visibility insight (useLostVisibility) and lists the top lost queries with a
 * single "Create recovery content" CTA that opens the content pipeline pre-seeded with the
 * highest-impact lost query. Renders nothing when there is no lost_visibility insight. Admin page.
 */
import { useNavigate } from 'react-router-dom';
import { Search, FileText } from 'lucide-react';
import { Button, Icon, SectionCard } from '../ui';
import { adminPath } from '../../routes';
import { useLostVisibility } from '../../hooks/admin/useLostVisibility';
import type { LostQueryRecoveryCardProps } from './types';

export function LostQueryRecoveryCard({ workspaceId }: LostQueryRecoveryCardProps) {
  const navigate = useNavigate();
  const { data } = useLostVisibility(workspaceId);

  const queries = data?.topQueries ?? [];
  if (queries.length === 0) return null;

  const recover = () =>
    navigate(adminPath(workspaceId, 'content-pipeline'), {
      state: { fixContext: { targetRoute: 'content-pipeline', primaryKeyword: queries[0].query, autoGenerate: true } },
    });

  return (
    <SectionCard
      title="Lost visibility"
      titleIcon={<Icon as={Search} size="md" className="text-blue-400" />}
      action={
        <Button
          onClick={recover}
          variant="ghost"
          size="sm"
          className="gap-1 px-2.5 py-1 rounded-[var(--radius-lg)] bg-teal-600/20 border border-teal-500/30 t-caption-sm text-teal-300 font-medium hover:bg-teal-600/40"
        >
          <Icon as={FileText} size="sm" className="text-teal-300" /> Create recovery content
        </Button>
      }
    >
      <p className="t-caption-sm text-[var(--brand-text-muted)] mb-3">Queries that recently stopped showing in search — win them back with refreshed or new content.</p>
      <div className="space-y-1.5">
        {queries.slice(0, 5).map(q => (
          <div key={q.query} className="flex items-center justify-between gap-3 px-3 py-2 bg-[var(--surface-3)]/50 rounded-[var(--radius-lg)]">
            <span className="t-caption-sm text-[var(--brand-text-bright)] truncate">{q.query}</span>
            <div className="flex items-center gap-3 flex-shrink-0">
              <span className="t-caption-sm text-[var(--brand-text-muted)]">{q.lastPosition != null ? `was #${q.lastPosition}` : 'unranked'}</span>
              <span className="t-mono text-blue-400 bg-blue-500/10 border border-blue-500/20 px-1.5 py-0.5 rounded">{q.totalImpressions.toLocaleString()} imp at risk</span>
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
