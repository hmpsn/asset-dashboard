import { AlertTriangle, X } from 'lucide-react';
import { Icon, Button, IconButton } from '../ui';
import { formatDate } from '../../utils/formatDates';
import type { StrategyStalenessNudgesProps } from './types';

export function StrategyStalenessNudges({
  hasVolumeValidation,
  localSyncApplies,
  strategyStaleVsLocal,
  lastLocalRefreshAt,
  lastStrategyGeneratedAt,
  dismissedRefreshAt,
  onDismiss,
  onGenerate,
}: StrategyStalenessNudgesProps) {
  return (
    <>
      {/* ── Unvalidated Strategy Warning ── */}
      {!hasVolumeValidation && (
        <div className="bg-accent-warning-soft border border-accent-warning-soft rounded-[var(--radius-lg)] px-4 py-3 flex items-start gap-2.5">
          <Icon as={AlertTriangle} size="md" className="text-accent-warning flex-shrink-0 mt-0.5" />
          <div className="t-caption text-accent-warning leading-relaxed">
            <strong className="text-accent-warning">This strategy was generated without keyword volume validation.</strong>{' '}
            Keywords, volume, and difficulty data may not reflect real search demand. Enable DataForSEO for validated keyword recommendations.
          </div>
        </div>
      )}

      {/* ── Reverse-Staleness Nudge (strategy older than local SEO data) ── */}
      {localSyncApplies && strategyStaleVsLocal && dismissedRefreshAt !== lastLocalRefreshAt && (
        <div
          data-testid="reverse-staleness-nudge"
          className="bg-accent-warning-soft border border-accent-warning-soft rounded-[var(--radius-lg)] px-4 py-3 flex items-start gap-2.5"
        >
          <Icon as={AlertTriangle} size="md" className="text-accent-warning flex-shrink-0 mt-0.5" />
          <div className="flex-1 t-caption text-accent-warning leading-relaxed">
            <strong className="text-accent-warning">Your local SEO data is newer than this strategy.</strong>{' '}
            {lastLocalRefreshAt && lastStrategyGeneratedAt && (
              <>Local data was refreshed {formatDate(lastLocalRefreshAt)}, after this strategy was generated ({formatDate(lastStrategyGeneratedAt)}). </>
            )}
            Regenerate to reflect your current local data.
            <div className="mt-2">
              <Button
                size="sm"
                variant="primary"
                onClick={() => onGenerate()}
              >
                Generate Strategy
              </Button>
            </div>
          </div>
          <IconButton
            onClick={() => onDismiss()}
            title="Dismiss"
            label="Dismiss"
            icon={X}
            size="sm"
            variant="ghost"
            className="text-accent-warning hover:text-[var(--brand-text-muted)] flex-shrink-0"
          />
        </div>
      )}
    </>
  );
}
