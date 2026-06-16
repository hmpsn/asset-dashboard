import { AlertTriangle } from 'lucide-react';
import { Icon } from '../ui';
import type { StrategyFeedbackNudgeProps } from './types';

export function StrategyFeedbackNudge({ requestedCount, declinedCount }: StrategyFeedbackNudgeProps) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-start gap-3">
      <Icon as={AlertTriangle} size="md" className="text-accent-warning mt-0.5 shrink-0" />
      <div>
        <p className="t-caption font-semibold text-[var(--brand-text-bright)]">New client feedback since last strategy generation</p>
        <p className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">
          {requestedCount > 0 && `${requestedCount} requested keyword${requestedCount === 1 ? '' : 's'}`}
          {requestedCount > 0 && declinedCount > 0 && ' and '}
          {declinedCount > 0 && `${declinedCount} declined keyword${declinedCount === 1 ? '' : 's'}`}
          {' '}arrived after the last generation. Regenerate the strategy to apply this feedback.
        </p>
      </div>
    </div>
  );
}
