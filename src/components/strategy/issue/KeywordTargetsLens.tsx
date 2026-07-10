/**
 * KeywordTargetsLens — The Issue (Phase 5, Lane C) · job #4 keyword targets.
 *
 * An ADMIN read-projection of the curated Issue rec set: every curated keyword_gap / topic_cluster
 * rec as an operator-legible target, each deep-linking into the Keyword Hub so the operator can act
 * on it. Pure read — no mutations here; curation happens in the cockpit's BackingMovesQueue.
 *
 * Deep-link (two-halves contract): this is the SENDER half — it appends `?q=<normalized>` via
 * buildHubDeepLinkQuery to the seo-keywords path; the Keyword Hub reads it via readHubDeepLink.
 * Rows whose deepLinkKeyword is null render as plain text (no actionable link).
 *
 * Brand-law compliance: teal=action link (Law 1), no purple, no TierGate. Tokens from src/tokens.css;
 * typography via .t-* utilities.
 */
import { useNavigate } from 'react-router-dom';
import { Target, Search } from 'lucide-react';
import { SectionCard, Badge, Button, EmptyState, Icon } from '../../ui';
import { useIssueLenses } from '../../../hooks/admin/useIssueLenses';
import { adminPath } from '../../../routes';
import { buildHubDeepLinkQuery } from '../../../lib/keywordHubDeepLink';
import type { KeywordTargetRow } from '../../../../shared/types/strategy-issue-lenses';

export interface KeywordTargetsLensProps {
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

/** A single keyword/topic target row: label + sent/proposed badge + Keyword Hub deep-link. */
function TargetRow({
  row,
  onOpen,
  compact,
}: {
  row: KeywordTargetRow;
  onOpen: (keyword: string) => void;
  compact: boolean;
}) {
  const canDeepLink = row.deepLinkKeyword != null;
  return (
    <div
      data-testid="keyword-target-row"
      className={compact
        ? 'flex flex-col items-stretch gap-2 py-2 sm:flex-row sm:items-center sm:justify-between'
        : 'flex items-center justify-between gap-4 py-3'}
    >
      <div className="min-w-0">
        <div className="t-ui font-medium text-[var(--brand-text-bright)] truncate">{row.label}</div>
        <div className="t-caption-sm mt-0.5 text-[var(--brand-text-muted)]">
          {row.type === 'topic_cluster' ? 'Topic cluster' : 'Keyword gap'}
        </div>
      </div>
      <div className={compact ? 'flex flex-wrap items-center gap-2 sm:shrink-0' : 'flex items-center gap-3 shrink-0'}>
        <Badge
          tone={row.sent ? 'teal' : 'zinc'}
          variant="soft"
          size="sm"
          label={row.sent ? 'In front of client' : 'Proposed'}
        />
        {canDeepLink ? (
          <Button
            variant="link"
            size="sm"
            onClick={() => onOpen(row.deepLinkKeyword as string)}
            className="t-caption-sm font-medium whitespace-nowrap"
          >
            View in Keyword Hub
          </Button>
        ) : (
          <span className="t-caption-sm text-[var(--brand-text-muted)] whitespace-nowrap">
            No keyword link
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * KeywordTargetsLens — the operator's curated keyword/topic target lens (job #4).
 *
 * Renders one row per curated keyword_gap / topic_cluster rec. `theIssueEnabled` is threaded into the
 * hook's `enabled` arg, so flag-OFF makes zero network calls even if mounted outside the overview gate.
 */
export function KeywordTargetsLens({
  workspaceId,
  theIssueEnabled = false,
  embedded = false,
  includedRecIds,
  presentation = 'default',
}: KeywordTargetsLensProps) {
  const navigate = useNavigate();
  const { keywordTargets, isLoading, isError } = useIssueLenses(workspaceId, theIssueEnabled);
  const visibleTargets = includedRecIds
    ? keywordTargets.filter((row) => includedRecIds.has(row.recId))
    : keywordTargets;
  const engineSpine = presentation === 'engine-spine';

  const openInHub = (keyword: string) => {
    navigate(adminPath(workspaceId, 'seo-keywords') + buildHubDeepLinkQuery({ keyword }));
  };

  const titleIcon = <Icon as={Target} size="md" className="text-accent-brand" />;

  const content = (
    <>
      {!engineSpine && (
        <p className="t-caption-sm text-[var(--brand-text-muted)] mb-2">
          Staged keyword &amp; topic targets — open each in the Keyword Hub to act.
        </p>
      )}

      {isLoading ? (
        <p className={`t-caption-sm text-[var(--brand-text-muted)] ${engineSpine ? 'py-3' : 'py-4'} text-center`}>
          Projecting curated targets…
        </p>
      ) : isError ? (
        <p className={`t-caption-sm text-red-400/80 ${engineSpine ? 'py-3' : 'py-4'} text-center`}>
          Couldn't load keyword targets. It'll retry shortly.
        </p>
      ) : visibleTargets.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No keyword targets yet"
          description="Stage a keyword-gap or topic-cluster move above, then open it here to act in the Keyword Hub."
          className={engineSpine ? '!py-6 [&>div:first-child]:h-10 [&>div:first-child]:w-10' : undefined}
        />
      ) : (
        <div className="divide-y divide-[var(--brand-border)]">
          {visibleTargets.map((row) => (
            <TargetRow key={row.recId} row={row} onOpen={openInHub} compact={engineSpine} />
          ))}
        </div>
      )}
    </>
  );

  if (embedded) {
    return (
      <div
        data-testid="keyword-targets-embedded"
        className={engineSpine ? 'px-2 py-1.5' : 'px-4 py-3'}
      >
        {content}
      </div>
    );
  }

  return (
    <SectionCard title="Keyword targets" titleIcon={titleIcon}>
      {content}
    </SectionCard>
  );
}
