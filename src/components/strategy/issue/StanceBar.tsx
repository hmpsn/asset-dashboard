/**
 * StanceBar — proportional segmented allocation bar for "The Issue" cockpit.
 *
 * Shows the operator's current stance as the prototype's four directly labeled
 * allocations. The six persisted recommendation archetypes roll up into demand,
 * protect, technical, and local without changing their underlying contract.
 *
 * Props:
 *   recs   – raw Recommendation list (component derives stance internally)
 *   stance – pre-computed StanceResult (use when parent already has it)
 * Exactly one of `recs` or `stance` must be provided.
 *
 * Tokens: src/tokens.css only. Typography: .t-caption-sm.
 */
import type { Recommendation } from '../../../../shared/types/recommendations';
import { deriveStance, type StanceResult } from '../../../lib/recStance';

type StanceGroup = 'demand' | 'protect' | 'technical' | 'local';

const STANCE_GROUPS: Array<{
  id: StanceGroup;
  label: string;
  background: string;
}> = [
  { id: 'demand', label: 'Win demand', background: 'var(--teal)' },
  { id: 'protect', label: 'Protect', background: 'var(--emerald)' },
  { id: 'technical', label: 'Technical', background: 'var(--blue)' },
  { id: 'local', label: 'Local', background: 'var(--orange)' },
];

interface StanceBarProps {
  recs?: Recommendation[];
  stance?: StanceResult;
}

export function StanceBar({ recs, stance: stanceProp }: StanceBarProps) {
  const stance: StanceResult = stanceProp ?? deriveStance(recs ?? []);
  const counts: Record<StanceGroup, number> = {
    demand: stance.byArchetype.authority_bet + stance.byArchetype.quick_win,
    protect: stance.byArchetype.refresh_reclaim + stance.byArchetype.defend,
    technical: stance.byArchetype.technical,
    local: stance.byArchetype.local,
  };
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);

  return (
    <div className="flex flex-col gap-2">
      <div
        data-testid="stance-allocation-bar"
        className="flex h-[34px] min-h-[34px] w-full gap-px overflow-hidden rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--brand-border)] sm:h-[34px]"
        role="img"
        aria-label="Current strategy effort allocation"
      >
        {STANCE_GROUPS.map(group => {
          const count = counts[group.id];
          const percentage = total === 0 ? 0 : Math.round((count / total) * 100);
          return (
            <div
              key={group.id}
              data-stance-group={group.id}
              className={`flex min-h-[34px] min-w-0 items-center justify-center text-center t-caption-sm font-semibold ${
                total === 0 || count > 0 ? 'px-2' : 'px-0'
              }`}
              style={{
                background: group.background,
                color: 'var(--button-primary-text)',
                flexBasis: total === 0 ? '25%' : '0%',
                flexGrow: total === 0 ? 1 : count,
                flexShrink: total === 0 || count > 0 ? 1 : 0,
              }}
              title={`${group.label}: ${count} move${count === 1 ? '' : 's'} (${percentage}%)`}
            >
              <span className="truncate">{group.label} {percentage}%</span>
            </div>
          );
        })}
      </div>

      {(stance.cut > 0 || stance.parked > 0) && (
        <span // muted-tier-ok: cut/parked is tertiary metadata, intentionally dimmed
          className="ml-auto t-caption-sm text-[var(--brand-text-dim)]"
          data-testid="stance-bar-cutparked"
        >
          {stance.cut > 0 && `${stance.cut} cut`}
          {stance.cut > 0 && stance.parked > 0 && ' · '}
          {stance.parked > 0 && `${stance.parked} parked`}
        </span>
      )}
    </div>
  );
}
