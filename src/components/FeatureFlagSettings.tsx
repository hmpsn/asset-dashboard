import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Flag, RotateCcw, Loader2 } from 'lucide-react';
import { put, get } from '../api/client';
import { useToast } from './Toast';
import { Icon, Toggle } from './ui';
import { queryKeys } from '../lib/queryKeys';

interface FlagMeta {
  key: string;
  enabled: boolean;
  source: 'db' | 'env' | 'default';
  default: boolean;
}

// FLAG_GROUPS and FLAG_LABELS are intentionally maintained alongside FEATURE_FLAGS
// in shared/types/feature-flags.ts. When adding a new flag:
//   1. Add the key to FEATURE_FLAGS (source of truth)
//   2. Add it to the appropriate FLAG_GROUPS entry (or it falls into the "Other" bucket)
//   3. Add a human-readable label to FLAG_LABELS (or the raw key is displayed as fallback)
const FLAG_GROUPS: Array<{ label: string; keys: string[] }> = [
  {
    label: 'Outcome Intelligence Engine',
    keys: [
      'outcome-tracking',
      'outcome-dashboard',
      'outcome-playbooks',
      'outcome-external-detection',
      'outcome-ai-injection',
      'outcome-client-reporting',
      'outcome-predictive',
    ],
  },
  {
    label: 'Copy & Brand Engine',
    keys: ['copy-engine', 'copy-engine-voice', 'copy-engine-pipeline'],
  },
  {
    label: 'Self-Service Onboarding',
    keys: ['self-service-onboarding', 'self-service-gsc-ga4'],
  },
  {
    label: 'Team & Collaboration',
    keys: ['team-collaboration'],
  },
  {
    label: 'White-Label',
    keys: ['white-label'],
  },
  {
    label: 'Workspace Intelligence Bridges',
    keys: [
      'intelligence-shadow-mode',
      'bridge-outcome-reweight',
      'bridge-decay-suggested-brief',
      'bridge-strategy-invalidate',
      'bridge-insight-to-action',
      'bridge-page-analysis-invalidate',
      'bridge-action-auto-resolve',
      'bridge-content-to-insight',
      'bridge-schema-to-insight',
      'bridge-anomaly-boost',
      'bridge-settings-cascade',
      'bridge-audit-page-health',
      'bridge-action-annotation',
      'bridge-annotation-to-insight',
      'bridge-audit-site-health',
      'bridge-audit-auto-resolve',
      'bridge-client-signal',
    ],
  },
  {
    label: 'Deep Diagnostics',
    keys: ['deep-diagnostics'],
  },
  {
    label: 'Platform Intelligence Enhancements',
    keys: ['smart-placeholders', 'client-brand-section', 'seo-editor-unified'],
  },
];

const FLAG_LABELS: Record<string, string> = {
  // Outcome Intelligence Engine
  'outcome-tracking':           'Action tracking & measurement',
  'outcome-dashboard':          'Outcomes admin dashboard',
  'outcome-playbooks':          'Playbook pattern detection',
  'outcome-external-detection': 'External change detection (weekly)',
  'outcome-ai-injection':       'Inject outcomes into AI context',
  'outcome-client-reporting':   'Client-facing outcome reporting',
  'outcome-predictive':         'Predictive scoring (future)',
  // Copy & Brand Engine
  'copy-engine':                'Copy Engine — core',
  'copy-engine-voice':          'Copy Engine — voice calibration',
  'copy-engine-pipeline':       'Copy Engine — pipeline',
  // Self-Service
  'self-service-onboarding':    'Self-service Webflow onboarding',
  'self-service-gsc-ga4':       'Self-service GSC / GA4 connection',
  // Team
  'team-collaboration':         'Team management',
  // White-label
  'white-label':                'White-label domains',
  // Workspace Intelligence Bridges
  'intelligence-shadow-mode':        'Shadow-mode comparison logging',
  'bridge-outcome-reweight':         '#1: Outcome → reweight insight scores',
  'bridge-decay-suggested-brief':    '#2: Content decay → suggested brief',
  'bridge-strategy-invalidate':      '#3: Strategy update → cache invalidation',
  'bridge-insight-to-action':        '#4: Insight resolved → tracked action',
  'bridge-page-analysis-invalidate': '#5: Page analysis → cache invalidation',
  'bridge-action-auto-resolve':      '#7: Action recorded → auto-resolve insights',
  'bridge-content-to-insight':       '#8: Content published → staleness insight',
  'bridge-schema-to-insight':        '#9: Schema validation → schema health insight',
  'bridge-anomaly-boost':            '#10: Anomaly → boost insight severity',
  'bridge-settings-cascade':         '#11: Settings change → cascade invalidation',
  'bridge-audit-page-health':        '#12: Audit → page health insights',
  'bridge-action-annotation':        '#13: Action recorded → analytics annotation',
  'bridge-annotation-to-insight':    '#14: Annotation → insight correlation',
  'bridge-audit-site-health':        '#15: Audit → site health insight',
  'bridge-audit-auto-resolve':       'IG-4: Auto-resolve audit_finding insights on clean audit',
  'bridge-client-signal':            '#16: Client feedback → signal insights',
  // Platform Intelligence Enhancements
  'smart-placeholders':   'Smart placeholders (admin chips + client ghost text)',
  'client-brand-section': 'Client portal — Brand tab (business profile)',
  'seo-editor-unified':   'SEO editor — merged static + CMS with collection filter',
  // Deep Diagnostics
  'deep-diagnostics':     'Deep diagnostics mode',
};

const SOURCE_LABEL: Record<FlagMeta['source'], string> = {
  db:      'Admin override',
  env:     'Env var',
  default: 'Default',
};

async function fetchAdminFlags(): Promise<FlagMeta[]> {
  return get<FlagMeta[]>('/api/admin/feature-flags');
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

  const flagMap = new Map<string, FlagMeta>(flags?.map(f => [f.key, f]) ?? []);

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
          {FLAG_GROUPS.map(group => {
            const groupFlags = group.keys.map(k => flagMap.get(k)).filter(Boolean) as FlagMeta[];
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

          {/* Any flags not in a defined group */}
          {(() => {
            const defined = new Set(FLAG_GROUPS.flatMap(g => g.keys));
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
  flag: FlagMeta;
  disabled: boolean;
  onToggle: (enabled: boolean) => void;
  onReset: () => void;
}

function FlagRow({ flag, disabled, onToggle, onReset }: FlagRowProps) {
  const label = FLAG_LABELS[flag.key] ?? flag.key;
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

      {/* Label */}
      <div className="flex-1 min-w-0">
        <span className="t-caption text-[var(--brand-text)] truncate">{label}</span>
        <span className="ml-2 t-caption-sm font-mono text-[var(--brand-text-muted)]">{flag.key}</span>
      </div>

      {/* Source badge */}
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

      {/* Reset button — only shown when DB override is set */}
      {isOverridden ? (
        <button
          onClick={onReset}
          disabled={disabled}
          title="Remove DB override (revert to env var or default)"
          className="p-1 rounded hover:bg-white/5 transition-colors disabled:opacity-50 shrink-0"
        >
          <Icon as={RotateCcw} size="sm" className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]" />
        </button>
      ) : (
        <div className="w-5 shrink-0" />
      )}
    </div>
  );
}
