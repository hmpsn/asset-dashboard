import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Flag, RotateCcw, Loader2 } from 'lucide-react';
import { put, get } from '../api/client';
import { useToast } from './Toast';
import { Icon, IconButton, Toggle } from './ui';
import { queryKeys } from '../lib/queryKeys';
import {
  FEATURE_FLAG_GROUPS,
  type FeatureFlagAdminMeta,
  type FeatureFlagValueSource,
} from '../../shared/types/feature-flags';

const SOURCE_LABEL: Record<FeatureFlagValueSource, string> = {
  db: 'Admin override',
  env: 'Env var',
  default: 'Default',
};

async function fetchAdminFlags(): Promise<FeatureFlagAdminMeta[]> {
  return get<FeatureFlagAdminMeta[]>('/api/admin/feature-flags');
}

export function FeatureFlagSettings() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: flags, isLoading, isError, error } = useQuery({
    queryKey: queryKeys.admin.featureFlags(),
    queryFn: fetchAdminFlags,
  });

  const { mutate: setFlag, isPending } = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean | null }) =>
      put(`/api/admin/feature-flags/${key}`, { enabled }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.featureFlags() });
      qc.invalidateQueries({ queryKey: queryKeys.shared.featureFlags() });
      const action = vars.enabled === null ? 'reset to default' : vars.enabled ? 'enabled' : 'disabled';
      toast(`${vars.key} ${action}`);
    },
    onError: () => toast('Failed to update flag'),
  });

  const flagMap = new Map<string, FeatureFlagAdminMeta>(flags?.map(f => [f.key, f]) ?? []);

  return (
    // pr-check-disable-next-line -- hand-rolled section card with inner subsections; mirrors SectionCard brand signature intentionally
    <section className="bg-[var(--surface-2)] overflow-hidden border border-[var(--brand-border)]" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
      <div className="px-5 py-4 border-b border-[var(--brand-border)] flex items-center gap-3">
        <div className="w-8 h-8 rounded-[var(--radius-lg)] bg-teal-500/10 flex items-center justify-center">
          <Icon as={Flag} size="md" className="text-accent-brand" />
        </div>
        <div className="flex-1">
          <h3 className="t-body font-semibold text-[var(--brand-text-bright)]">Feature Flags</h3>
          <p className="t-caption text-[var(--brand-text-muted)]">Toggle dark-launched features. DB overrides take priority over env vars.</p>
        </div>
        {isPending && <Icon as={Loader2} size="md" className="text-[var(--brand-text-muted)] animate-spin" />}
      </div>

      {isLoading ? (
        <div className="px-5 py-8 flex items-center justify-center gap-2 t-caption text-[var(--brand-text-muted)]">
          <Icon as={Loader2} size="md" className="animate-spin" /> Loading flags...
        </div>
      ) : isError ? (
        <div className="px-5 py-6 t-caption text-accent-danger space-y-1">
          <p className="font-medium">Failed to load feature flags</p>
          <p className="text-[var(--brand-text-muted)] font-mono break-all">{error instanceof Error ? error.message : String(error)}</p>
        </div>
      ) : (
        <div className="divide-y divide-[var(--brand-border)]/60">
          {FEATURE_FLAG_GROUPS.map(group => {
            const groupFlags = group.keys.map(k => flagMap.get(k)).filter(Boolean) as FeatureFlagAdminMeta[];
            if (groupFlags.length === 0) return null;
            return (
              <div key={group.label} className="px-5 py-3 space-y-2.5">
                <div className="t-caption-sm font-medium text-[var(--brand-text-muted)] uppercase tracking-wider pt-1">
                  {group.label}
                </div>
                {groupFlags.map(flag => (
                  <FlagRow
                    key={flag.key}
                    flag={flag}
                    disabled={isPending}
                    onToggle={enabled => setFlag({ key: flag.key, enabled })}
                    onReset={() => setFlag({ key: flag.key, enabled: null })}
                  />
                ))}
              </div>
            );
          })}

          {(() => {
            const defined = new Set(FEATURE_FLAG_GROUPS.flatMap(g => g.keys));
            const ungrouped = (flags ?? []).filter(f => !defined.has(f.key));
            if (ungrouped.length === 0) return null;
            return (
              <div className="px-5 py-3 space-y-2.5">
                <div className="t-caption-sm font-medium text-[var(--brand-text-muted)] uppercase tracking-wider pt-1">Other</div>
                {ungrouped.map(flag => (
                  <FlagRow
                    key={flag.key}
                    flag={flag}
                    disabled={isPending}
                    onToggle={enabled => setFlag({ key: flag.key, enabled })}
                    onReset={() => setFlag({ key: flag.key, enabled: null })}
                  />
                ))}
              </div>
            );
          })()}
        </div>
      )}
    </section>
  );
}

interface FlagRowProps {
  flag: FeatureFlagAdminMeta;
  disabled: boolean;
  onToggle: (enabled: boolean) => void;
  onReset: () => void;
}

function FlagRow({ flag, disabled, onToggle, onReset }: FlagRowProps) {
  const isOverridden = flag.source === 'db';

  return (
    <div className="flex items-center gap-3">
      <Toggle
        checked={flag.enabled}
        onChange={onToggle}
        label={`${flag.enabled ? 'Disable' : 'Enable'}: ${flag.key}`}
        srOnlyLabel
        disabled={disabled}
      />

      <div className="flex-1 min-w-0">
        <span className="t-caption text-[var(--brand-text)] truncate">{flag.label}</span>
        <span className="ml-2 t-caption-sm font-mono text-[var(--brand-text-muted)]">{flag.key}</span>
        <div
          className="t-caption-sm text-[var(--brand-text-muted)] truncate"
          title={`Owner: ${flag.lifecycle.owner} | Target: ${flag.lifecycle.rolloutTarget} | Remove when: ${flag.lifecycle.removalCondition} | Roadmap: ${flag.lifecycle.linkedRoadmapItemId}`}
        >
          {flag.lifecycle.owner} · {flag.lifecycle.rolloutTarget} · review {flag.lifecycle.staleAuditCadence} (last {flag.lifecycle.lastReviewedAt})
        </div>
      </div>

      <span
        className={`t-caption-sm px-1.5 py-0.5 rounded font-medium shrink-0 ${
          flag.source === 'db'
            ? 'bg-teal-500/10 text-accent-brand'
            : flag.source === 'env'
            ? 'bg-blue-500/10 text-accent-info'
            : 'bg-[var(--surface-3)] text-[var(--brand-text-muted)]'
        }`}
      >
        {SOURCE_LABEL[flag.source]}
      </span>

      {isOverridden ? (
        <IconButton
          onClick={onReset}
          disabled={disabled}
          icon={RotateCcw}
          label="Reset override"
          variant="ghost"
          size="sm"
          title="Remove DB override (revert to env var or default)"
          className="rounded hover:bg-white/5 disabled:opacity-50 shrink-0 text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]"
        />
      ) : (
        <div className="w-5 shrink-0" />
      )}
    </div>
  );
}
