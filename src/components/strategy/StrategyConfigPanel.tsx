import { useState } from 'react';
import { ChevronDown, ChevronRight, Settings2 } from 'lucide-react';
import { Button, ClickableRow, Icon } from '../ui';
import { StrategySettings } from './StrategySettings';
import type { StrategySettingsProps } from './types';

export interface StrategyConfigPanelProps extends StrategySettingsProps {
  /** Name of the active SEO provider (e.g. 'DataForSEO') shown in the collapsed summary. */
  providerName?: string;
  /** Primary local market label (e.g. 'Austin, TX') shown in the collapsed summary. */
  localMarketLabel?: string;
  /** Open the Local SEO market setup drawer. When provided, a button is shown in the expanded body. */
  onOpenLocalSeoSetup?: () => void;
}

/**
 * StrategyConfigPanel — collapsed disclosure that wraps StrategySettings + Local SEO
 * market/location config. Mounts at the BOTTOM of the Overview tab in the flag-ON
 * (strategy-command-center) path only. Flag-OFF: not rendered at all.
 *
 * Collapsed header shows a one-line state summary (provider name + local market when set).
 * Expanded body contains the full StrategySettings fields plus a "Configure local market"
 * button that triggers the LocalSeoMarketSetupDrawer via the onOpenLocalSeoSetup callback.
 */
export function StrategyConfigPanel({
  providerName,
  localMarketLabel,
  onOpenLocalSeoSetup,
  ...settingsProps
}: StrategyConfigPanelProps) {
  const [open, setOpen] = useState(false);

  // Build collapsed summary line: "DataForSEO · Austin, TX · 500 pages max · Context set"
  const summaryParts: string[] = [];
  if (providerName) summaryParts.push(providerName);
  if (localMarketLabel) summaryParts.push(localMarketLabel);
  if (settingsProps.maxPages > 0) {
    summaryParts.push(`${settingsProps.maxPages} pages max`);
  } else {
    summaryParts.push('All pages');
  }
  if (settingsProps.businessContext) summaryParts.push('Context set');
  if (settingsProps.competitors.trim()) {
    const count = settingsProps.competitors.split(/[,\n]+/).filter(Boolean).length;
    summaryParts.push(`${count} competitor${count === 1 ? '' : 's'}`);
  }
  const summary = summaryParts.join(' · ');

  return (
    // pr-check-disable-next-line -- asymmetric disclosure card, intentional non-SectionCard chrome (matches StrategySettings panel style)
    <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden rounded-[var(--radius-signature-lg)]">
      <ClickableRow
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between px-4 py-2.5 hover:bg-[var(--surface-3)]/20 text-left"
        aria-expanded={open}
        aria-controls="strategy-config-panel-body"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Icon as={Settings2} size="md" className="text-accent-brand shrink-0" />
          <span className="t-caption font-semibold text-[var(--brand-text-bright)] shrink-0">Strategy Configuration</span>
          {!open && summary && (
            <span className="t-caption-sm text-[var(--brand-text-muted)] truncate">{summary}</span>
          )}
        </div>
        <Icon as={open ? ChevronDown : ChevronRight} size="md" className="text-[var(--brand-text-muted)] shrink-0" />
      </ClickableRow>

      {open && (
        <div id="strategy-config-panel-body" className="px-4 pb-4 space-y-6 pt-2">
          {/* Strategy Settings — the existing disclosure renders its own inner header + body.
              We pass settingsOpen=true (forced open inside our outer disclosure) and no-op
              the setSettingsOpen so the inner toggle doesn't collapse our outer panel.
              The inner StrategySettings toggle is hidden when nested here. */}
          <StrategySettings
            {...settingsProps}
            settingsOpen={true}
            setSettingsOpen={() => {/* inner toggle suppressed — outer disclosure owns open state */}}
          />

          {/* Local SEO market/location config */}
          {onOpenLocalSeoSetup && (
            <div className="border-t border-[var(--brand-border)] pt-4">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="t-caption font-semibold text-[var(--brand-text-bright)]">Local SEO Market</p>
                  <p className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">
                    {localMarketLabel
                      ? `Primary market: ${localMarketLabel}`
                      : 'Configure a local market to enable local visibility tracking and keyword matching.'}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Settings2}
                  onClick={onOpenLocalSeoSetup}
                  className="shrink-0"
                >
                  {localMarketLabel ? 'Edit market' : 'Configure market'}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
