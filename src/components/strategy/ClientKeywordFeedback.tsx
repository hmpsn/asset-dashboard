import { Users, Plus } from 'lucide-react';
import { Badge, SectionCard, Icon, Button, InlineBanner } from '../ui';
import type { ClientKeywordFeedbackProps } from './types';
import { formatDate } from '../../utils/formatDates';

export function ClientKeywordFeedback({
  rows,
  requested,
  declined,
  approved,
  addPending,
  addError,
  onAdd,
  onDismissError,
}: ClientKeywordFeedbackProps) {
  return (
    <SectionCard
      title="Client Keyword Feedback"
      titleIcon={<Icon as={Users} size="md" className="text-accent-brand" />}
      titleExtra={(
        <span className="t-caption-sm text-[var(--brand-text-muted)]">
          {declined.length} declined · {requested.length} requested · {approved.length} approved
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
      {rows.length === 0 ? (
        <p className="t-caption-sm text-[var(--brand-text-muted)]">
          No client feedback submitted yet. Declined keywords and reasons will appear here.
        </p>
      ) : (
        <div className="space-y-4">
          {requested.length > 0 && (
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
          )}
          {declined.length > 0 ? (
            <div className="space-y-2">
              {requested.length > 0 && (
                <p className="t-caption-sm font-semibold text-[var(--brand-text)] uppercase tracking-wider">Declined by client</p>
              )}
              {declined.slice(0, 12).map((item) => (
                <div
                  key={`declined-${item.keyword}`}
                  className="rounded-[var(--radius-md)] border border-red-500/20 bg-red-500/5 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <Badge label="Declined" tone="red" size="sm" />
                    <span className="t-caption-sm font-medium text-[var(--brand-text-bright)]">{item.keyword}</span>
                    {item.updated_at && (
                      <span className="t-caption-sm text-[var(--brand-text-muted)]">
                        {formatDate(item.updated_at)}
                      </span>
                    )}
                  </div>
                  {item.reason && (
                    <p className="mt-1 t-caption-sm text-[var(--brand-text)]">
                      {item.reason}
                    </p>
                  )}
                </div>
              ))}
              {declined.length > 12 && (
                <p className="t-caption-sm text-[var(--brand-text-muted)]">
                  Showing latest 12 declines ({declined.length} total).
                </p>
              )}
            </div>
          ) : requested.length === 0 ? null : (
            <p className="t-caption-sm text-[var(--brand-text-muted)]">
              No declined keywords right now.
            </p>
          )}
        </div>
      )}
    </SectionCard>
  );
}
