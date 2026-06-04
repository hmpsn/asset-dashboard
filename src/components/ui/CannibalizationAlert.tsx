/**
 * Unified CannibalizationAlert (Wave 2 T5).
 *
 * Accepts a normalized `CannibalizationEntry[]` and optional `tier` + `variant`.
 *
 * - No `tier` prop → ungated (KeywordStrategy call site, existing posture preserved).
 * - `tier` prop provided → TierGate(required='growth') (ContentPipeline call site).
 * - `variant='detailed'` (default) → per-page rows + remediation action label.
 * - `variant='compact'` → condensed list, no remediation block.
 *
 * Accent tokens only (no raw red/amber). Uses SectionCard for chrome.
 * Remediates via `actionLabel()` mapping (canonical_tag / redirect_301 / differentiate / noindex).
 */
import { AlertTriangle, Copy, Link2, ArrowRight, GitBranch, EyeOff } from 'lucide-react';
import { SectionCard } from './SectionCard';
import { TierGate } from './TierGate';
import { Badge } from './Badge';
import { Icon } from './Icon';
import { normalizePageUrl } from '../../lib/pathUtils';
import type { CannibalizationEntry } from '../../../shared/types/intelligence';
import type { Tier } from './TierGate';

export interface CannibalizationAlertProps {
  entries: CannibalizationEntry[];
  tier?: Tier;
  variant?: 'detailed' | 'compact';
}

// ── Severity → Badge tone ────────────────────────────────────────────────────
// Four Laws: amber = warning, red = error, zinc = low/info
const SEV_TONE: Record<CannibalizationEntry['severity'], 'red' | 'amber' | 'zinc'> = {
  high: 'red',
  medium: 'amber',
  low: 'zinc',
};

// ── Severity → icon color (accent tokens) ────────────────────────────────────
const SEV_ICON_COLOR: Record<CannibalizationEntry['severity'], string> = {
  high: 'text-accent-danger',
  medium: 'text-accent-warning',
  low: 'text-[var(--brand-text-muted)]',
};

// ── Severity → card border/bg tokens ─────────────────────────────────────────
const SEV_CARD: Record<CannibalizationEntry['severity'], string> = {
  high: 'border-red-500/20 bg-red-500/5',
  medium: 'border-amber-500/20 bg-amber-500/5',
  low: 'border-[var(--brand-border)] bg-[var(--surface-3)]/20',
};

// ── Remediation action label mapping ─────────────────────────────────────────
function actionLabel(action: CannibalizationEntry['action']) {
  switch (action) {
    case 'canonical_tag':
      return { label: 'Canonical Tag', Icon: Link2, color: 'text-blue-400 bg-blue-500/10' };
    case 'redirect_301':
      return { label: '301 Redirect', Icon: ArrowRight, color: 'text-orange-400 bg-orange-500/10' };
    case 'differentiate':
      return { label: 'Differentiate', Icon: GitBranch, color: 'text-[var(--brand-text)] bg-[var(--brand-text-muted)]/10' };
    case 'noindex':
      return { label: 'Noindex', Icon: EyeOff, color: 'text-[var(--brand-text)] bg-[var(--surface-3)]/30' };
    default:
      return null;
  }
}

// ── Normalize a page path (handles full URLs from admin pipeline) ─────────────
function toPath(raw: string): string {
  // If it looks like an absolute URL, strip protocol + host
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return normalizePageUrl(raw);
  }
  return raw;
}

// ── Inner card list (shared between gated + ungated renders) ─────────────────
function EntryList({ entries, variant }: { entries: CannibalizationEntry[]; variant: 'detailed' | 'compact' }) {
  return (
    <div className="space-y-2">
      {entries.slice(0, 10).map((entry, i) => {
        const act = actionLabel(entry.action);
        return (
          <div
            key={`${entry.keyword}-${i}`}
            className={`px-3 py-2.5 rounded-[var(--radius-lg)] border ${SEV_CARD[entry.severity]}`}
          >
            {/* Keyword row */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <AlertTriangle className={`w-3.5 h-3.5 flex-shrink-0 ${SEV_ICON_COLOR[entry.severity]}`} />
                <span className="t-body font-medium text-[var(--brand-text-bright)]">&ldquo;{entry.keyword}&rdquo;</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Badge tone={SEV_TONE[entry.severity]} label={entry.severity} />
                <span className="t-caption-sm text-[var(--brand-text-muted)]">{entry.pages.length} pages</span>
              </div>
            </div>

            {/* Per-page rows */}
            <div className="mt-1.5 space-y-0.5 ml-5">
              {entry.pages.map((page, pi) => (
                <div key={pi} className="flex items-center gap-2 t-caption-sm">
                  <span className={`font-mono ${pi === 0 ? 'text-emerald-400' : 'text-[var(--brand-text)]'}`}>
                    {toPath(page.path)}
                  </span>
                  {page.position != null && (
                    <span className="text-[var(--brand-text-muted)]">pos #{Math.round(page.position)}</span>
                  )}
                  {page.impressions != null && page.impressions > 0 && (
                    <span className="text-blue-400">{page.impressions} impr</span>
                  )}
                  {page.clicks != null && page.clicks > 0 && (
                    <span className="text-teal-400">{page.clicks} clicks</span>
                  )}
                  {page.source && (
                    <span className={`px-1 rounded-[var(--radius-sm)] badge-span-ok ${page.source === 'gsc' ? 'bg-blue-500/10 text-blue-400' : 'bg-[var(--surface-3)]/50 text-[var(--brand-text)]'}`}>
                      {page.source === 'gsc' ? 'GSC' : 'map'}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* Remediation action + canonical path (detailed variant only) */}
            {variant === 'detailed' && act && (
              <div className={`flex items-center gap-1 mt-1.5 px-1.5 py-0.5 rounded-[var(--radius-sm)] t-caption-sm font-medium ${act.color} w-fit`}>
                <Icon as={act.Icon} size="sm" />
                {act.label}
                {entry.canonicalPath && (
                  <span className="font-mono ml-1 opacity-70">→ {entry.canonicalPath}</span>
                )}
              </div>
            )}

            {/* Recommendation text (detailed variant only) */}
            {variant === 'detailed' && entry.recommendation && (
              <div className="flex items-start gap-1 mt-1">
                <AlertTriangle className="w-3 h-3 text-accent-warning flex-shrink-0 mt-0.5" />
                <span className="t-caption-sm text-accent-warning">{entry.recommendation}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Public component ──────────────────────────────────────────────────────────
export function CannibalizationAlert({ entries, tier, variant = 'detailed' }: CannibalizationAlertProps) {
  if (!entries || entries.length === 0) return null;

  const highCount = entries.filter(e => e.severity === 'high').length;

  const titleExtra = highCount > 0
    ? <Badge tone="red" size="sm" label={`${highCount} critical`} />
    : undefined;

  const content = (
    <SectionCard
      title="Keyword Cannibalization Detected"
      titleIcon={<Copy className="w-4 h-4 text-accent-danger" />}
      titleExtra={titleExtra}
    >
      <p className="t-caption-sm text-[var(--brand-text-muted)] mb-3">
        Multiple pages competing for the same keyword dilute your ranking power. Consolidate to one canonical page.
      </p>
      <EntryList entries={entries} variant={variant} />
    </SectionCard>
  );

  // Apply TierGate only when `tier` is explicitly provided (preserves KeywordStrategy ungated posture)
  if (tier !== undefined) {
    return (
      <TierGate tier={tier} required="growth" feature="Keyword Cannibalization Alerts">
        {content}
      </TierGate>
    );
  }

  return content;
}
