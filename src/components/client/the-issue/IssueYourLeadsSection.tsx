// ── IssueYourLeadsSection — The Issue (Client) P1b Lane C — the client's OWN captured leads ─────
//
// The client seeing their own form submissions (name / email / form / when). This is the client
// looking at THEIR OWN data — appropriate, and it rides the AUTHED client-portal surface ONLY
// (useClientMyLeads → GET /api/public/export/:id/my-leads, requireAuthenticatedClientPortalAuth).
// PII never crosses the public unauthed payload (D3/D7); the guard, not the shape, enforces it.
//
// Progressive disclosure: collapsed <details> "Your captured leads" (matches the page's
// "Under the hood" reveal pattern) so a cold surface stays decision-first.
//
// Four Laws: tokens only, no purple. `data-p1b` root tag is the Lane D flag-OFF DOM-probe hook.

import { ChevronDown, Inbox } from 'lucide-react';
import { EmptyState, Skeleton, Icon } from '../../ui';
import { useClientMyLeads } from '../../../hooks/client';
import { timeAgo } from '../../../lib/timeAgo';

interface IssueYourLeadsSectionProps {
  workspaceId: string;
  /** Test override for the return-hook gate; defaults to enabled (the page only mounts when ON). */
  enabled?: boolean;
}

export function IssueYourLeadsSection({ workspaceId, enabled = true }: IssueYourLeadsSectionProps) {
  const { leads, isLoading } = useClientMyLeads(workspaceId, enabled);

  return (
    <div data-p1b data-testid="issue-your-leads">
      <details className="group bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-signature)] overflow-hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 [&::-webkit-details-marker]:hidden">
          <span className="t-label text-[var(--brand-text-muted)] uppercase tracking-wider">Your captured leads</span>
          <span className="inline-flex items-center gap-1 t-caption-sm text-accent-brand flex-shrink-0">
            See your leads
            <Icon as={ChevronDown} size="sm" className="transition-transform group-open:rotate-180" />
          </span>
        </summary>
        <div className="px-4 pb-4 pt-1">
          {isLoading ? (
            <div className="space-y-2" data-testid="issue-your-leads-loading">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : leads.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No captured leads yet"
              description="Leads from your website forms will appear here as they come in."
            />
          ) : (
            <ul className="divide-y divide-[var(--brand-border)]" data-testid="issue-your-leads-list">
              {leads.map((lead) => (
                <li key={lead.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="t-ui font-medium text-[var(--brand-text-bright)] truncate">
                      {lead.leadName ?? '—'}
                    </p>
                    <p className="t-caption-sm text-[var(--brand-text-muted)] truncate">
                      {lead.leadEmail ?? 'No email provided'}
                    </p>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className="t-caption-sm text-[var(--brand-text-muted)] truncate">{lead.formName}</p>
                    <p className="t-caption-sm text-[var(--brand-text-muted)]">
                      {timeAgo(lead.submittedAt, { style: 'long' })}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </div>
  );
}
