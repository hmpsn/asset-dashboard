/**
 * AdminLeadsReadout — The Issue (Client) P1b admin named-leads readout (Lane B, consumes A5).
 *
 * The operator's view of captured leads. PII (leadName/leadEmail) is admin-only — this is the admin
 * surface (requireWorkspaceAccess), so showing identity here is correct (D7: the guard, not the
 * shape, enforces the boundary). Self-contained, props-only — re-mountable in any admin spine.
 *
 * Color (Four Laws): the count badge is read-only DATA → BLUE (Law 2), never teal (teal is for
 * actions). The connect CTA is an action → teal (Law 1). No purple (admin AI only, not here).
 */
import { Users, ArrowRight } from 'lucide-react';
import { SectionCard, EmptyState, Button, Icon } from '../../ui';
import { timeAgo } from '../../../lib/timeAgo';
import type { NamedLeadView, OutcomeType } from '../../../../shared/types/the-issue';

export interface AdminLeadsReadoutProps {
  /** The current page of captured leads (PII visible — admin surface). */
  leads: NamedLeadView[];
  /** The UNBOUNDED total captured-lead count (may exceed leads.length when paginated). Header N. */
  total: number;
  /** Whether the leads query is still loading (shows a contextual message, not a spinner). */
  loading?: boolean;
  /** Deep-link into the form-source picker when the operator has no captured leads yet. */
  onConnectCta?: () => void;
}

const OUTCOME_TYPE_LABEL: Record<OutcomeType, string> = {
  form_fill: 'Form fill',
  call: 'Call',
  booking: 'Booking',
  email: 'Email',
  directions: 'Directions',
  chat: 'Chat',
  other: 'Other',
};

export function AdminLeadsReadout({ leads, total, loading = false, onConnectCta }: AdminLeadsReadoutProps) {
  return (
    <SectionCard noPadding>
      <div className="px-5 py-4 flex items-center gap-3 border-b border-[var(--brand-border)]">
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-[var(--brand-text-bright)]">Captured leads</h3>
          <p className="t-caption text-[var(--brand-text-muted)]">
            The named leads captured from this client&rsquo;s website forms.
          </p>
        </div>
        {/* Count is read-only DATA → blue (Law 2). Uses the unbounded `total`, not the page length. */}
        <span className="t-caption-sm font-semibold px-2 py-0.5 rounded-[var(--radius-sm)] badge-span-ok border bg-blue-500/10 text-blue-400 border-blue-500/20 tabular-nums">
          {total.toLocaleString()} captured
        </span>
      </div>

      <div className="px-5 py-4">
        {loading ? (
          <p className="t-caption-sm text-[var(--brand-text-muted)]">Loading captured leads&hellip;</p>
        ) : total === 0 ? (
          <EmptyState
            icon={Users}
            title="No leads captured yet"
            description="Connect a Webflow form to start capturing named leads from this client's website."
            action={
              onConnectCta ? (
                <Button variant="secondary" size="sm" icon={ArrowRight} onClick={onConnectCta}>
                  Connect a Webflow form
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-[var(--brand-border)]">
            {leads.map((lead) => (
              <li
                key={lead.id}
                data-lead-id={lead.id}
                className="flex items-center justify-between gap-3 py-2.5"
                aria-label={`Lead ${lead.leadName ?? lead.leadEmail ?? 'unknown'} via ${lead.formName}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="t-ui font-medium text-[var(--brand-text-bright)] truncate">
                    {lead.leadName ?? '—'}
                  </div>
                  {/* t-caption-sm has no color — add an explicit muted-tier color. */}
                  <div className="t-caption-sm text-[var(--brand-text-muted)] truncate">
                    {lead.leadEmail ?? '—'}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {/* Lead-type chip — read-only data → blue, never actionable. */}
                  <span className="t-caption-sm font-medium px-2 py-0.5 rounded-[var(--radius-sm)] badge-span-ok border bg-blue-500/10 text-blue-400 border-blue-500/20">
                    {OUTCOME_TYPE_LABEL[lead.outcomeType] ?? OUTCOME_TYPE_LABEL.other}
                  </span>
                  <div className="text-right">
                    <div className="t-caption-sm text-[var(--brand-text)] truncate max-w-[10rem]" title={lead.formName}>
                      {lead.formName}
                    </div>
                    <div className="t-caption-sm text-[var(--brand-text-muted)] tabular-nums">
                      {timeAgo(lead.submittedAt)}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {!loading && total > leads.length && leads.length > 0 && (
          <p className="t-caption-sm text-[var(--brand-text-muted)] pt-3 flex items-center gap-1.5">
            <Icon as={Users} size="sm" className="text-[var(--brand-text-muted)]" />
            Showing {leads.length.toLocaleString()} of {total.toLocaleString()} captured leads.
          </p>
        )}
      </div>
    </SectionCard>
  );
}
