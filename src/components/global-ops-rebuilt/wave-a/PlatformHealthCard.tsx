// @ds-rebuilt
import { Icon, SectionCard, Skeleton } from '../../ui';
import type { GlobalOpsHealthStatus } from '../../../hooks/admin/useGlobalOpsSettings';
import { formatNumber } from '../globalOpsFormatters';

interface PlatformHealthCardProps {
  health: GlobalOpsHealthStatus | undefined;
  loading: boolean;
  workspaceCount: number;
  linkedWorkspaceCount: number;
}

export function PlatformHealthCard({
  health,
  loading,
  workspaceCount,
  linkedWorkspaceCount,
}: PlatformHealthCardProps) {
  const rows = [
    { label: 'OpenAI', ok: health?.hasOpenAIKey, icon: 'key' as const },
    { label: 'Webflow', ok: health?.hasWebflowToken, icon: 'globe' as const },
    { label: 'Google Auth', ok: health?.hasGoogleAuth, icon: 'search' as const },
    { label: 'Email', ok: health?.hasEmailConfig, icon: 'message' as const },
    { label: 'Stripe', ok: health?.hasStripe, icon: 'trophy' as const },
  ];

  return (
    <SectionCard
      title="Platform Health"
      subtitle="Connection status and workspace overview"
      titleIcon={<Icon name="settings" size="md" className="text-[var(--brand-text)]" />}
      iconChip
    >
      {loading ? (
        <Skeleton className="h-[178px] w-full" />
      ) : (
        <div>
          <div className="mb-2 t-micro uppercase tracking-[0.06em] text-[var(--brand-text-dim)]">Connections</div>
          <div className="space-y-1">
            {rows.map((row) => (
              <div key={row.label} className="flex items-center gap-2 py-1">
                <Icon name={row.icon} size="sm" className="text-[var(--brand-text-muted)]" />
                <span className="flex-1 t-caption text-[var(--brand-text)]">{row.label}</span>
                <Icon
                  name={row.ok ? 'check' : 'x'}
                  size="sm"
                  className={row.ok ? 'text-[var(--emerald)]' : 'text-[var(--brand-text-dim)]'}
                />
              </div>
            ))}
          </div>
          <div className="mb-2 mt-4 t-micro uppercase tracking-[0.06em] text-[var(--brand-text-dim)]">Workspaces</div>
          <div className="flex items-center justify-between py-1 t-caption">
            <span className="text-[var(--brand-text-muted)]">Total</span>
            <span className="font-semibold tabular-nums text-[var(--brand-text-bright)]">{formatNumber(workspaceCount)}</span>
          </div>
          <div className="flex items-center justify-between py-1 t-caption">
            <span className="text-[var(--brand-text-muted)]">With Webflow site</span>
            <span className="font-semibold tabular-nums text-[var(--brand-text-bright)]">{formatNumber(linkedWorkspaceCount)}</span>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
