// ── IssueExportBar — The Issue (Client) P1b Lane C — the forwardable one-pager affordance ──────
//
// The "download / forward your one-pager" CTA. Opens Lane A's server-rendered, print-optimized
// one-pager HTML (GET /api/public/export/:id/one-pager, client-authed) in a new tab; the client
// uses the browser's native print-to-PDF (there is NO PDF library — print-from-browser, DR-4).
//
// Locked decisions:
//   • NOT tier-gated (DR-5) — the forwardable one-pager is the anti-hostage guard for every segment.
//   • D7 — this is a button, not a data surface. Lead PII appears only INSIDE the authed export HTML
//     and the separate "your leads" view; never on the public payload.
//   • Segment-aware framing: when a resolved exportProfile is supplied, the sub-line names the
//     destination the client would forward to (board / partner / portfolio / quick recap).
//
// Four Laws: teal = the action CTA (Law 1). Tokens only, no purple. `data-p1b` root tag is the
// Lane D flag-OFF DOM-probe hook.

import { Download } from 'lucide-react';
import { SectionCard, Button } from '../../ui';
import { getOnePagerExportUrl } from '../../../api/conversionTracking';
import type { ResolvedSegmentProfile } from '../../../../shared/types/workspace';

interface IssueExportBarProps {
  workspaceId: string;
  /** Admin "Preview as client": suppress the window.open so the operator can preview safely. */
  previewMode?: boolean;
  /** Resolved segment profile — drives the segment-aware forwarding sub-line. Optional. */
  segmentProfile?: ResolvedSegmentProfile | null;
}

type ExportProfile = ResolvedSegmentProfile['exportProfile'];

/** Segment-aware sub-line: names the destination the client would forward the one-pager to. */
function forwardingFraming(profile: ExportProfile | null | undefined): string {
  switch (profile) {
    case 'partner_summary':
      return 'Forward to your partners — exports as a print-ready PDF.';
    case 'owner_portfolio':
      return 'Forward to your ownership group — exports as a print-ready PDF.';
    case 'sms_recap':
      return 'A quick recap you can text or forward — exports as a print-ready PDF.';
    case 'board_one_pager':
    default:
      return 'Forward to your board — exports as a print-ready PDF.';
  }
}

export function IssueExportBar({ workspaceId, previewMode = false, segmentProfile }: IssueExportBarProps) {
  const handleExport = () => {
    if (previewMode) return;
    window.open(getOnePagerExportUrl(workspaceId), '_blank', 'noopener');
  };

  return (
    <div data-p1b data-testid="issue-export-bar">
      <SectionCard>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="t-body font-semibold text-[var(--brand-text-bright)]">Your one-pager</p>
            <p className="mt-1 t-caption-sm text-[var(--brand-text-muted)]">
              {forwardingFraming(segmentProfile?.exportProfile)}
            </p>
          </div>
          <Button
            type="button"
            variant="primary"
            icon={Download}
            onClick={handleExport}
            data-testid="issue-export-cta"
            className="flex-shrink-0"
          >
            Download one-pager
          </Button>
        </div>
      </SectionCard>
    </div>
  );
}
