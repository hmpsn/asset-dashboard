/**
 * ContentWorkOrderLens — The Issue (Phase 5, Lane C) · job #3 content work-orders.
 *
 * An ADMIN read-projection of the curated Issue rec set: every curated content / content_refresh rec
 * as a work-order, joined (server-side, by recommendationId) to its content_topic_request for a
 * production stage. Each row deep-links into the content pipeline so the operator can advance it.
 *
 * Deep-link (two-halves contract): this is the SENDER half — it appends `?tab=posts` when a post
 * already exists, else `?tab=briefs`; ContentPipeline reads the `tab` param via useSearchParams.
 *
 * Brand-law compliance: teal=action link (Law 1), no purple, no TierGate. Stage badge tones follow
 * the status palette (Three Laws). Tokens from src/tokens.css; typography via .t-* utilities.
 */
import { useNavigate } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import { SectionCard, Badge, Button, EmptyState, Icon } from '../../ui';
import type { BadgeTone } from '../../ui';
import { useIssueLenses } from '../../../hooks/admin/useIssueLenses';
import { adminPath } from '../../../routes';
import type {
  ContentWorkOrderRow,
  ContentWorkOrderStage,
} from '../../../../shared/types/strategy-issue-lenses';

export interface ContentWorkOrderLensProps {
  workspaceId: string;
  /** The Issue feature gate. Threaded into the hook's `enabled` arg so flag-OFF makes zero network
   *  calls even if this panel is ever mounted outside the issueOverviewEl gate. Defaults to FALSE
   *  (opt-in) so an omitted prop never fires a flag-OFF fetch — the byte-identical-OFF safe default. */
  theIssueEnabled?: boolean;
  /** Render only the lens body when a parent owns the shared section shell. */
  embedded?: boolean;
  /** Optional local curation set. When present, project only rows whose recommendation is staged. */
  includedRecIds?: ReadonlySet<string>;
  /** Opt-in compact composition for the Engine spine. */
  presentation?: 'default' | 'engine-spine';
}

/** Production-stage → badge tone + operator-legible label. */
const STAGE_BADGE: Record<ContentWorkOrderStage, { tone: BadgeTone; label: string }> = {
  not_started: { tone: 'zinc', label: 'Not started' },
  queued: { tone: 'blue', label: 'Queued' },
  in_progress: { tone: 'teal', label: 'In progress' },
  awaiting_client: { tone: 'amber', label: 'Awaiting client' },
  changes_requested: { tone: 'orange', label: 'Changes requested' },
  approved: { tone: 'emerald', label: 'Approved' },
  completed: { tone: 'emerald', label: 'Completed' },
  declined: { tone: 'red', label: 'Declined' },
};

/** A single content work-order row: title + stage badge + content-pipeline deep-link. */
function WorkOrderRow({
  row,
  onOpen,
  compact,
}: {
  row: ContentWorkOrderRow;
  onOpen: (row: ContentWorkOrderRow) => void;
  compact: boolean;
}) {
  const stage = STAGE_BADGE[row.stage];
  return (
    <div
      data-testid="content-work-order-row"
      className={compact
        ? 'flex flex-col items-stretch gap-2 py-2 sm:flex-row sm:items-center sm:justify-between'
        : 'flex items-center justify-between gap-4 py-3'}
    >
      <div className="min-w-0">
        <div className="t-ui font-medium text-[var(--brand-text-bright)] truncate">{row.title}</div>
        <div className="t-caption-sm mt-0.5 text-[var(--brand-text-muted)]">
          {row.type === 'content_refresh' ? 'Content refresh' : 'New content'}
        </div>
      </div>
      <div className={compact ? 'flex flex-wrap items-center gap-2 sm:shrink-0' : 'flex items-center gap-3 shrink-0'}>
        <Badge tone={stage.tone} variant="soft" size="sm" label={stage.label} />
        <Button
          variant="link"
          size="sm"
          onClick={() => onOpen(row)}
          className="t-caption-sm font-medium whitespace-nowrap"
        >
          {row.hasPost ? 'Open post' : 'Open brief'}
        </Button>
      </div>
    </div>
  );
}

/**
 * ContentWorkOrderLens — the operator's curated content work-order lens (job #3).
 *
 * Renders one row per curated content / content_refresh rec with its production stage. `theIssueEnabled`
 * is threaded into the hook's `enabled` arg, so flag-OFF makes zero network calls even if mounted
 * outside the overview gate.
 */
export function ContentWorkOrderLens({
  workspaceId,
  theIssueEnabled = false,
  embedded = false,
  includedRecIds,
  presentation = 'default',
}: ContentWorkOrderLensProps) {
  const navigate = useNavigate();
  const { contentWorkOrders, isLoading, isError } = useIssueLenses(workspaceId, theIssueEnabled);
  const visibleWorkOrders = includedRecIds
    ? contentWorkOrders.filter((row) => includedRecIds.has(row.recId))
    : contentWorkOrders;
  const engineSpine = presentation === 'engine-spine';

  // Empty → null (Blocker 4): when there are no curated content work-orders, render nothing rather
  // than an empty SectionCard, so a cold workspace shows zero placeholder chrome (mirrors
  // IssueAlsoOnPlanSection). Loading/error keep their inline states (transient, not "cold").
  if (!embedded && !isLoading && !isError && visibleWorkOrders.length === 0) return null;

  const openInPipeline = (row: ContentWorkOrderRow) => {
    navigate(adminPath(workspaceId, 'content-pipeline') + (row.hasPost ? '?tab=posts' : '?tab=briefs'));
  };

  const titleIcon = <Icon as={ClipboardList} size="md" className="text-accent-brand" />;

  const content = (
    <>
      {!engineSpine && (
        <p className="t-caption-sm text-[var(--brand-text-muted)] mb-2">
          Staged content moves and where each stands in production.
        </p>
      )}

      {isLoading ? (
        <p className={`t-caption-sm text-[var(--brand-text-muted)] ${engineSpine ? 'py-3' : 'py-4'} text-center`}>
          Projecting curated work-orders…
        </p>
      ) : isError ? (
        <p className={`t-caption-sm text-red-400/80 ${engineSpine ? 'py-3' : 'py-4'} text-center`}>
          Couldn't load content work-orders. It'll retry shortly.
        </p>
      ) : visibleWorkOrders.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No content work orders yet"
          description="Stage a content or content-refresh move above to track it here and open it in Content Pipeline."
          className={engineSpine ? '!py-6 [&>div:first-child]:h-10 [&>div:first-child]:w-10' : undefined}
        />
      ) : (
        <div className="divide-y divide-[var(--brand-border)]">
          {visibleWorkOrders.map((row) => (
            <WorkOrderRow key={row.recId} row={row} onOpen={openInPipeline} compact={engineSpine} />
          ))}
        </div>
      )}
    </>
  );

  if (embedded) {
    return (
      <div
        data-testid="content-work-orders-embedded"
        className={engineSpine ? 'px-2 py-1.5' : 'px-4 py-3'}
      >
        {content}
      </div>
    );
  }

  return (
    <SectionCard title="Content work-orders" titleIcon={titleIcon}>
      {content}
    </SectionCard>
  );
}
