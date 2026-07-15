import { useState, type FormEvent } from 'react';
import { FilePlus2 } from 'lucide-react';
import { SectionCard, FormField, FormInput, FormSelect, Button } from '../../ui';
import { useRecordOutcomeAction } from '../../../hooks/admin/useOutcomes';
import type { Attribution } from '../../../../shared/types/outcome-tracking';

interface Props {
  workspaceId: string;
}

// Curated ActionType subset relevant to manually-published / agency work — the full
// ActionType union is broad; these are the ones an operator records by hand for a page
// published outside the platform flow.
const WORK_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'content_published', label: 'New page / blog post' },
  { value: 'content_refreshed', label: 'Refreshed an existing page' },
  { value: 'meta_updated', label: 'Title / meta description update' },
  { value: 'internal_link_added', label: 'Internal links added' },
  { value: 'audit_fix_applied', label: 'Technical / audit fix' },
];

// Agency-posted → platform_executed (we did it). Client-posted → externally_executed
// (their own team) — kept honest so manual work is never silently over-credited to us.
const AUTHOR_OPTIONS: Array<{ value: Attribution; label: string }> = [
  { value: 'platform_executed', label: 'We published it (agency)' },
  { value: 'externally_executed', label: 'Client published it themselves' },
];

// Deterministic sourceId so re-submitting the same page dedups server-side (the route
// is idempotent on (sourceType, sourceId) — see POST /api/outcomes/:ws/actions).
function sourceIdFromUrl(url: string): string {
  const slug = url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
  return `manual:${slug}`;
}

export default function RecordPublishedWorkCard({ workspaceId }: Props) {
  const record = useRecordOutcomeAction(workspaceId);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [workType, setWorkType] = useState(WORK_TYPE_OPTIONS[0].value);
  const [attribution, setAttribution] = useState<Attribution>(AUTHOR_OPTIONS[0].value);
  const [recorded, setRecorded] = useState(false);

  const canSubmit = url.trim().length > 0 && title.trim().length > 0 && !record.isPending;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    const page = url.trim();
    const label = title.trim();
    record.mutate(
      {
        actionType: workType,
        sourceType: 'manual',
        sourceId: sourceIdFromUrl(page),
        pageUrl: page,
        attribution,
        source: { label, snapshot: { title: label, type: 'manual', page } },
      },
      {
        onSuccess: () => {
          setRecorded(true);
          setUrl('');
          setTitle('');
          window.setTimeout(() => setRecorded(false), 4000);
        },
      },
    );
  }

  return (
    <SectionCard
      title="Record published work"
      titleIcon={<FilePlus2 className="w-4 h-4 text-accent-brand" />}
    >
      <p className="t-caption text-[var(--brand-text-muted)] mb-3">
        Log work published outside the platform (a manual post, an edit) so it enters the outcome
        ledger and can become a measured win. Honestly attributed — client-published work is
        recorded as theirs, never claimed as ours.
      </p>
      <form onSubmit={handleSubmit} className="space-y-3">
        <FormField label="Page URL">
          <FormInput
            value={url}
            onChange={setUrl}
            type="url"
            placeholder="https://example.com/blog/how-to-choose-a-plumber"
          />
        </FormField>
        <FormField label="Title">
          <FormInput
            value={title}
            onChange={setTitle}
            placeholder="How to choose a local plumber"
          />
        </FormField>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label="Type of work">
            <FormSelect value={workType} onChange={setWorkType} options={WORK_TYPE_OPTIONS} />
          </FormField>
          <FormField label="Who published it?">
            <FormSelect
              value={attribution}
              onChange={(v) => setAttribution(v as Attribution)}
              options={AUTHOR_OPTIONS}
            />
          </FormField>
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={!canSubmit}>
            {record.isPending ? 'Recording…' : 'Record'}
          </Button>
          {recorded && (
            <span className="t-caption-sm text-accent-success">
              Recorded — it&apos;ll show up in outcomes.
            </span>
          )}
          {record.isError && (
            <span className="t-caption-sm text-accent-danger">Couldn&apos;t record — try again.</span>
          )}
        </div>
      </form>
    </SectionCard>
  );
}
