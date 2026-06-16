import { Users, Plus } from 'lucide-react';
import { SectionCard, Icon, Badge, Button, InlineBanner } from '../ui';
import type { RequestedKeywordTriageProps } from './types';
import { formatDate } from '../../utils/formatDates';

export function RequestedKeywordTriage({
  requested,
  addPending,
  addError,
  onAdd,
  onDismissError,
}: RequestedKeywordTriageProps) {
  if (requested.length === 0) {
    return null;
  }

  return (
    <SectionCard
      title="Requested Keywords"
      titleIcon={<Icon as={Users} size="md" className="text-accent-brand" />}
      titleExtra={(
        <span className="t-caption-sm text-[var(--brand-text-muted)]">
          {requested.length} {requested.length === 1 ? 'keyword' : 'keywords'}
        </span>
      )}
    >
      {addError && (
        <InlineBanner
          size="sm"
          className="mb-3"
          onDismiss={onDismissError}
          dismissLabel="Dismiss error"
        >
          {addError}
        </InlineBanner>
      )}
      <div className="space-y-2">
        <p className="t-caption-sm font-semibold text-[var(--brand-text)] uppercase tracking-wider">Requested by client</p>
        {requested.map((item) => (
          <div
            key={`requested-${item.keyword}`}
            className="rounded-[var(--radius-md)] border border-teal-500/20 bg-teal-500/5 px-3 py-2 flex items-center justify-between gap-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Badge label="Requested" tone="teal" size="sm" />
              <span className="t-caption-sm font-medium text-[var(--brand-text-bright)] truncate">{item.keyword}</span>
              {item.updated_at && (
                <span className="t-caption-sm text-[var(--brand-text-muted)] shrink-0">
                  {formatDate(item.updated_at)}
                </span>
              )}
            </div>
            <Button
              size="sm"
              variant="secondary"
              icon={Plus}
              disabled={addPending}
              onClick={() => onAdd(item.keyword)}
              className="shrink-0"
            >
              Add to Strategy
            </Button>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
