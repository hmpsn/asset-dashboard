import { ArrowRight, Zap } from 'lucide-react';
import { SectionCard, Badge, EmptyState, Skeleton } from '../../ui';
import { useOutcomePlaybooks } from '../../../hooks/admin/useOutcomes';
import { pct } from './outcomeConstants';
import type { ActionPlaybook, PlaybookConfidence } from '../../../../shared/types/outcome-tracking';

interface Props {
  workspaceId: string;
}

function confidenceColor(confidence: PlaybookConfidence): 'emerald' | 'amber' | 'red' {
  if (confidence === 'high') return 'emerald';
  if (confidence === 'medium') return 'amber';
  return 'red';
}

function PlaybookCard({ playbook }: { playbook: ActionPlaybook }) {
  const steps = playbook.actionSequence.map(s => s.actionType.replace(/_/g, ' '));

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-medium text-[var(--brand-text-bright)] capitalize">{playbook.name}</h3>
        <Badge label={`${playbook.confidence} confidence`} color={confidenceColor(playbook.confidence)} />
      </div>

      {/* Action sequence */}
      <div className="flex flex-wrap items-center gap-1.5">
        {steps.map((step, i) => (
          <span key={i} className="flex items-center gap-1.5">
            <span className="rounded bg-[var(--surface-3)] px-2 py-0.5 text-xs text-[var(--brand-text-bright)] capitalize">
              {step}
            </span>
            {i < steps.length - 1 && (
              <ArrowRight className="h-3 w-3 text-[var(--brand-text-muted)] flex-shrink-0" />
            )}
          </span>
        ))}
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 text-xs text-[var(--brand-text)]">
        <span>
          <span className="font-medium text-blue-400">{pct(playbook.historicalWinRate)}</span>{' '}
          win rate
        </span>
        <span>
          <span className="font-medium text-[var(--brand-text-bright)]">{playbook.sampleSize}</span>{' '}
          {playbook.sampleSize === 1 ? 'page' : 'pages'}
        </span>
      </div>
    </div>
  );
}

export default function OutcomePlaybooks({ workspaceId }: Props) {
  const { data: playbooks, isLoading } = useOutcomePlaybooks(workspaceId);

  if (isLoading) {
    return (
      <SectionCard title="Action Playbooks">
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      </SectionCard>
    );
  }

  if (!playbooks?.length) {
    return (
      <SectionCard title="Action Playbooks">
        <EmptyState
          icon={Zap}
          title="No playbooks discovered yet"
          description="Playbooks emerge automatically once enough pages have multiple tracked actions with scored outcomes. Keep applying recommendations."
        />
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Action Playbooks"
      titleExtra={
        <span className="text-xs text-[var(--brand-text-muted)]">
          {`${playbooks.length} pattern${playbooks.length === 1 ? '' : 's'} discovered`}
        </span>
      }
    >
      <div className="space-y-3">
        {playbooks.map(p => (
          <PlaybookCard key={p.id} playbook={p} />
        ))}
      </div>
    </SectionCard>
  );
}
