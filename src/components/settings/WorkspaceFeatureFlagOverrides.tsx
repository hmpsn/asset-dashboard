import { Flag, RotateCcw, Loader2 } from 'lucide-react';
import { SectionCard, Icon, IconButton, Toggle, Badge } from '../ui';
import { useToast } from '../Toast';
import { useWorkspaceFeatureFlags, useSetWorkspaceFlagOverride } from '../../hooks/admin';
import {
  FEATURE_FLAG_GROUPS,
  type FeatureFlagValueSource,
  type WorkspaceFeatureFlagValueSource,
  type WorkspaceFeatureFlagMeta,
} from '../../../shared/types/feature-flags';

// Source labels mirror FeatureFlagSettings, plus the per-workspace source.
const SOURCE_LABEL: Record<WorkspaceFeatureFlagValueSource, string> = {
  workspace: 'Workspace override',
  db: 'Global override',
  env: 'Env var',
  default: 'Default',
};

const INHERITED_SOURCE_LABEL: Record<FeatureFlagValueSource, string> = {
  db: 'global override',
  env: 'env var',
  default: 'default',
};

interface Props {
  workspaceId: string;
}

/**
 * Per-workspace feature-flag override control (admin canary).
 *
 * Reads GET /api/admin/workspaces/:id/feature-flags and lets an admin force a
 * flag ON / OFF for THIS workspace only, or clear the override to revert to the
 * inherited (global → env → default) value. The flag's precedence is shown
 * inline so it's clear what "clear" reverts to.
 *
 * Admin UI — no client-purple rule. Teal for actions; shared ui/ primitives
 * (SectionCard, Toggle, Badge). No raw fetch — typed React Query hooks.
 */
export function WorkspaceFeatureFlagOverrides({ workspaceId }: Props) {
  const { toast } = useToast();
  const { data: flags, isLoading, isError, error } = useWorkspaceFeatureFlags(workspaceId);
  const { mutate: setOverride, isPending } = useSetWorkspaceFlagOverride(workspaceId);

  const flagMap = new Map<string, WorkspaceFeatureFlagMeta>(flags?.map(f => [f.key, f]) ?? []);

  const handleToggle = (flag: WorkspaceFeatureFlagMeta, enabled: boolean) => {
    setOverride(
      { key: flag.key, enabled },
      {
        onSuccess: () => toast(`${flag.key} ${enabled ? 'forced ON' : 'forced OFF'} for this workspace`),
        onError: () => toast('Failed to update override', 'error'),
      },
    );
  };

  const handleClear = (flag: WorkspaceFeatureFlagMeta) => {
    setOverride(
      { key: flag.key, enabled: null },
      {
        onSuccess: () =>
          toast(
            `${flag.key} override cleared — now inherits ${flag.inheritedEnabled ? 'ON' : 'OFF'} (${INHERITED_SOURCE_LABEL[flag.inheritedSource]})`,
          ),
        onError: () => toast('Failed to clear override', 'error'),
      },
    );
  };

  return (
    <SectionCard noPadding>
      <div className="px-5 py-4 flex items-center gap-3 border-b border-[var(--brand-border)]">
        <div className="w-8 h-8 rounded-[var(--radius-lg)] bg-teal-500/10 flex items-center justify-center">
          <Icon as={Flag} size="md" className="text-accent-brand" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-[var(--brand-text-bright)]">Per-Workspace Feature Flags</h3>
          <p className="t-caption text-[var(--brand-text-muted)]">
            Canary a flag for this workspace only. A workspace override beats the global override, env var, and default.
          </p>
        </div>
        {isPending && <Icon as={Loader2} size="md" className="text-[var(--brand-text-muted)] animate-spin" />}
      </div>

      {isLoading ? (
        <div className="px-5 py-8 flex items-center justify-center gap-2 t-caption text-[var(--brand-text-muted)]">
          <Icon as={Loader2} size="md" className="animate-spin" /> Loading flags...
        </div>
      ) : isError ? (
        <div className="px-5 py-6 t-caption text-accent-danger space-y-1">
          <p className="font-medium">Failed to load workspace feature flags</p>
          <p className="text-[var(--brand-text-muted)] font-mono break-all">
            {error instanceof Error ? error.message : String(error)}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[var(--brand-border)]/60">
          {FEATURE_FLAG_GROUPS.map(group => {
            const groupFlags = group.keys
              .map(k => flagMap.get(k))
              .filter(Boolean) as WorkspaceFeatureFlagMeta[];
            if (groupFlags.length === 0) return null;
            return (
              <div key={group.label} className="px-5 py-3 space-y-2.5">
                <div className="t-caption-sm font-medium text-[var(--brand-text-muted)] uppercase tracking-wider pt-1">
                  {group.label}
                </div>
                {groupFlags.map(flag => (
                  <WorkspaceFlagRow
                    key={flag.key}
                    flag={flag}
                    disabled={isPending}
                    onToggle={enabled => handleToggle(flag, enabled)}
                    onClear={() => handleClear(flag)}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

interface WorkspaceFlagRowProps {
  flag: WorkspaceFeatureFlagMeta;
  disabled: boolean;
  onToggle: (enabled: boolean) => void;
  onClear: () => void;
}

function WorkspaceFlagRow({ flag, disabled, onToggle, onClear }: WorkspaceFlagRowProps) {
  const hasOverride = flag.source === 'workspace';

  return (
    <div className="flex items-center gap-3">
      <Toggle
        checked={flag.enabled}
        onChange={onToggle}
        label={`${flag.enabled ? 'Disable' : 'Enable'} ${flag.key} for this workspace`}
        srOnlyLabel
        disabled={disabled}
      />

      <div className="flex-1 min-w-0">
        <span className="t-caption text-[var(--brand-text)] truncate">{flag.label}</span>
        <span className="ml-2 t-caption-sm font-mono text-[var(--brand-text-muted)]">{flag.key}</span>
        <div className="t-caption-sm text-[var(--brand-text-muted)] truncate">
          {hasOverride
            ? `Overridden for this workspace · inherits ${flag.inheritedEnabled ? 'ON' : 'OFF'} (${INHERITED_SOURCE_LABEL[flag.inheritedSource]}) when cleared`
            : `Inherited ${flag.inheritedEnabled ? 'ON' : 'OFF'} from ${INHERITED_SOURCE_LABEL[flag.inheritedSource]}`}
        </div>
      </div>

      <Badge
        label={SOURCE_LABEL[flag.source]}
        tone={flag.source === 'workspace' ? 'teal' : flag.source === 'db' ? 'amber' : flag.source === 'env' ? 'blue' : 'zinc'}
        variant="soft"
        size="sm"
        className="shrink-0"
      />

      {hasOverride ? (
        <IconButton
          onClick={onClear}
          disabled={disabled}
          icon={RotateCcw}
          label={`Clear ${flag.key} workspace override`}
          variant="ghost"
          size="sm"
          title="Clear workspace override (revert to global / env / default)"
          className="rounded hover:bg-white/5 disabled:opacity-50 shrink-0 text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]"
        />
      ) : (
        <div className="w-5 shrink-0" />
      )}
    </div>
  );
}
