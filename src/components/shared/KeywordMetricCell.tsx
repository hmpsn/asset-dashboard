/**
 * KeywordMetricCell — shared page-map leaf metric cell (Wave 2 T6).
 *
 * Renders the volume + KD + position triple, consuming the canonical authorities:
 *   - positionColor / positionTone  from ui/constants
 *   - kdColor                       from pageIntelligenceDisplay
 *   - fmtNum                        from utils/formatNumbers
 *
 * Props:
 *   mode       — 'span'  (admin)  renders position as a colored `#{n}` span
 *              — 'badge' (client) renders position via <Badge tone={positionTone}>
 *   kdForm     — 'kd-percent'  renders "KD {n}%"    (admin form)
 *              — 'difficulty'  renders "Difficulty {n}" (client form)
 *   partialMatch — when true, shows the "~" partial-match marker on volume + KD
 *
 * ADR-0004: this component renders ONLY the metric cell.
 * Admin-specific affordances (intent / optimization-score / track-in-rank-tracker)
 * and client-specific affordances (TierGate / feedback / content-request) remain
 * on their respective surface components — NOT here.
 */
import { Badge } from '../ui/Badge';
import { positionColor, positionTone } from '../ui/constants';
import { kdColor } from '../page-intelligence/pageIntelligenceDisplay';
import { fmtNum } from '../../utils/formatNumbers';

export interface KeywordMetricCellProps {
  volume?: number;
  difficulty?: number;
  position?: number;
  mode: 'span' | 'badge';
  kdForm: 'kd-percent' | 'difficulty';
  /** When true, renders the "~" partial-match marker beside volume and KD. */
  partialMatch?: boolean;
  /** Additional class applied to the root wrapper. */
  className?: string;
}

export function KeywordMetricCell({
  volume,
  difficulty,
  position,
  mode,
  kdForm,
  partialMatch = false,
  className,
}: KeywordMetricCellProps) {
  const kdLabel = kdForm === 'kd-percent' ? `KD ${difficulty}%` : `Difficulty ${difficulty}`;

  return (
    <span className={`inline-flex items-center gap-1.5 ${className ?? ''}`}>
      {/* Volume */}
      {volume != null && volume > 0 && (
        <span
          data-testid="volume-span"
          className="t-caption-sm text-[var(--brand-text-muted)] bg-[var(--surface-3)] px-1.5 py-0.5 rounded font-mono inline-flex items-center gap-0.5"
        >
          {fmtNum(volume)}/mo
          {partialMatch && (
            <span
              className="text-accent-warning"
              title="Metrics from a similar keyword — may not be exact"
            >
              ~
            </span>
          )}
        </span>
      )}

      {/* Keyword Difficulty */}
      {difficulty != null && difficulty > 0 && (
        <span
          data-testid="kd-span"
          className={`t-caption-sm ${kdColor(difficulty)} bg-[var(--surface-3)] px-1.5 py-0.5 rounded font-mono inline-flex items-center gap-0.5`}
        >
          {kdLabel}
          {partialMatch && (
            <span
              className="text-accent-warning"
              title="Metrics from a similar keyword — may not be exact"
            >
              ~
            </span>
          )}
        </span>
      )}

      {/* Position */}
      {mode === 'span' ? (
        position ? (
          <span
            data-testid="position-span"
            className={`t-caption-sm ${positionColor(position)} font-mono font-medium bg-[var(--surface-3)] px-1.5 py-0.5 rounded`}
          >
            #{position.toFixed(0)}
          </span>
        ) : null
      ) : (
        position != null ? (
          <span data-testid="position-badge">
            <Badge
              label={`#${Math.round(position)}`}
              tone={positionTone(position)}
              className="font-mono"
            />
          </span>
        ) : null
      )}
    </span>
  );
}
