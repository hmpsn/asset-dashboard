import { Loader2, Target, RefreshCw, Sparkles } from 'lucide-react';
import { PageHeader, Icon, Button } from '../ui';
import { formatDate } from '../../utils/formatDates';
import type { StrategyHeaderProps } from './types';

export function StrategyHeader({
  isRealStrategy,
  generatedAt,
  pageCount,
  generating,
  localSyncApplies,
  localNeedsRefresh,
  refreshPending,
  onIncremental,
  onFullRefresh,
  onGenerate,
}: StrategyHeaderProps) {
  return (
    <PageHeader
      title="Keyword Strategy"
      subtitle={
        isRealStrategy
          ? `Generated ${formatDate(generatedAt)} · ${pageCount} pages mapped`
          : 'AI-powered keyword mapping for your entire site'
      }
      icon={<Icon as={Target} size="lg" className="text-accent-brand" />}
      actions={
        <div className="flex items-center gap-2">
          {isRealStrategy && (
            <Button
              onClick={onIncremental}
              disabled={generating}
              title="Re-analyzes only pages not updated in the last 7 days. Faster and lower cost than a full regeneration."
              variant="ghost"
              size="sm"
              className="rounded-[var(--radius-lg)] t-caption border border-[var(--brand-border)] text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] hover:border-[var(--brand-border-hover)]"
            >
              Update changed pages
            </Button>
          )}
          {/* Full refresh — shown only for local/hybrid workspaces (applies=true).
              Amber ring signals the recommended state when local data needs refresh. */}
          {localSyncApplies && (
            <Button
              onClick={onFullRefresh}
              disabled={generating || refreshPending}
              variant="secondary"
              size="sm"
              className={[
                'rounded-[var(--radius-lg)] t-caption',
                localNeedsRefresh
                  ? 'ring-1 ring-amber-500/60'
                  : '',
              ].filter(Boolean).join(' ')}
            >
              <Icon as={RefreshCw} size="sm" />
              Full refresh
            </Button>
          )}
          <Button
            onClick={onGenerate}
            disabled={generating}
            size="sm"
            className="rounded-[var(--radius-lg)] bg-teal-600 hover:bg-teal-500 text-slate-900 t-caption font-medium"
          >
            {generating ? (
              <><Icon as={Loader2} size="sm" className="animate-spin" /> Generating...</>
            ) : isRealStrategy ? (
              <><Icon as={RefreshCw} size="sm" /> Regenerate</>
            ) : (
              <><Icon as={Sparkles} size="sm" /> Generate Strategy</>
            )}
          </Button>
        </div>
      }
    />
  );
}
