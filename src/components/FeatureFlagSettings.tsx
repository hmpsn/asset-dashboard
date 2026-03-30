import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Flag, RotateCcw, Loader2 } from 'lucide-react';
import { put, get } from '../api/client';
import { useToast } from './Toast';

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
      'outcome-adaptive-pipeline',
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
];

const FLAG_LABELS: Record<string, string> = {
  // Outcome Intelligence Engine
  'outcome-tracking':           'Action tracking & measurement',
  'outcome-dashboard':          'Outcomes admin dashboard',
  'outcome-playbooks':          'Playbook pattern detection',
  'outcome-external-detection': 'External change detection (12h)',
  'outcome-ai-injection':       'Inject outcomes into AI context',
  'outcome-client-reporting':   'Client-facing outcome reporting',
  'outcome-adaptive-pipeline':  'Adaptive measurement pipeline',
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

  const { data: flags, isLoading } = useQuery({
    queryKey: ['admin-feature-flags'],
    queryFn: fetchAdminFlags,
  });

  const { mutate: setFlag, isPending } = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean | null }) =>
      put(`/api/admin/feature-flags/${key}`, { enabled }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['admin-feature-flags'] });
      qc.invalidateQueries({ queryKey: ['feature-flags'] });
      const action = vars.enabled === null ? 'reset to default' : vars.enabled ? 'enabled' : 'disabled';
      toast(`${vars.key} ${action}`);
    },
    onError: () => toast('Failed to update flag'),
  });

  const flagMap = new Map<string, FlagMeta>(flags?.map(f => [f.key, f]) ?? []);

  return (
    <section className="bg-zinc-900 overflow-hidden border border-zinc-800" style={{ borderRadius: '10px 24px 10px 24px' }}>
      <div className="px-5 py-4 border-b border-zinc-800 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center">
          <Flag className="w-4 h-4 text-teal-400" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-zinc-200">Feature Flags</h3>
          <p className="text-xs text-zinc-500">Toggle dark-launched features. DB overrides take priority over env vars.</p>
        </div>
        {isPending && <Loader2 className="w-4 h-4 text-zinc-500 animate-spin" />}
      </div>

      {isLoading ? (
        <div className="px-5 py-8 flex items-center justify-center gap-2 text-xs text-zinc-500">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading flags...
        </div>
      ) : (
        <div className="divide-y divide-zinc-800/60">
          {FLAG_GROUPS.map(group => {
            const groupFlags = group.keys.map(k => flagMap.get(k)).filter(Boolean) as FlagMeta[];
            if (groupFlags.length === 0) return null;
            return (
              <div key={group.label} className="px-5 py-3 space-y-2.5">
                <div className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider pt-1">
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
                <div className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider pt-1">Other</div>
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
      {/* Toggle */}
      <button
        role="switch"
        aria-checked={flag.enabled}
        aria-label={`Toggle ${label}`}
        disabled={disabled}
        onClick={() => onToggle(!flag.enabled)}
        className={`relative w-9 h-5 rounded-full transition-colors shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:opacity-50 ${
          flag.enabled
            ? 'bg-gradient-to-r from-teal-600 to-emerald-600'
            : 'bg-zinc-700'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
            flag.enabled ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>

      {/* Label */}
      <div className="flex-1 min-w-0">
        <span className="text-xs text-zinc-300 truncate">{label}</span>
        <span className="ml-2 text-[10px] text-zinc-600 font-mono">{flag.key}</span>
      </div>

      {/* Source badge */}
      <span
        className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${
          flag.source === 'db'
            ? 'bg-teal-500/10 text-teal-400'
            : flag.source === 'env'
            ? 'bg-blue-500/10 text-blue-400'
            : 'bg-zinc-800 text-zinc-500'
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
          <RotateCcw className="w-3 h-3 text-zinc-500 hover:text-zinc-300" />
        </button>
      ) : (
        <div className="w-5 shrink-0" />
      )}
    </div>
  );
}
