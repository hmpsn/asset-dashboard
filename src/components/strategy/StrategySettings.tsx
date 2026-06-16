import {
  Briefcase, ChevronDown, ChevronRight, BarChart3, Users, Search, FileText, Loader2,
} from 'lucide-react';
import { Icon, Button, ClickableRow } from '../ui';
import { FormInput, FormTextarea } from '../ui';
import type { StrategySettingsProps } from './types';

const PRIMARY_SEO_PROVIDER_LABEL = 'DataForSEO';

export function StrategySettings({
  settingsOpen,
  setSettingsOpen,
  seoDataMode,
  setSeoDataMode,
  maxPages,
  setMaxPages,
  competitors,
  setCompetitors,
  businessContext,
  setBusinessContext,
  contextOpen,
  setContextOpen,
  isAuxLoading,
  seoDataAvailable,
  discoveringCompetitors,
  discoverError,
  onDiscoverCompetitors,
}: StrategySettingsProps) {
  return (
    <>
      {/* Settings Panel */}
      {/* pr-check-disable-next-line -- brand asymmetric signature on KeywordStrategy settings panel; intentional non-SectionCard chrome (collapsible, button-as-first-child) */}
      <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden rounded-[var(--radius-signature-lg)]">
        <ClickableRow
          onClick={() => setSettingsOpen(!settingsOpen)}
          className="flex items-center justify-between px-4 py-2.5 hover:bg-[var(--surface-3)]/20 text-left"
        >
          <div className="flex items-center gap-2">
            <Icon as={Briefcase} size="md" className="text-accent-brand" />
            <span className="t-caption font-semibold text-[var(--brand-text-bright)]">Strategy Settings</span>
            {!settingsOpen && (
              <span className="t-caption-sm text-[var(--brand-text-muted)]">
                {seoDataMode !== 'none' ? `SEO data: ${seoDataMode}` : ''}
                {maxPages > 0 ? `${seoDataMode !== 'none' ? ' · ' : ''}${maxPages} pages max` : `${seoDataMode !== 'none' ? ' · ' : ''}All pages`}
                {businessContext ? ` · Context set` : ''}
                {competitors.trim() ? ` · ${competitors.split(/[,\n]+/).filter(Boolean).length} competitors` : ''}
              </span>
            )}
          </div>
          <Icon as={settingsOpen ? ChevronDown : ChevronRight} size="md" className="text-[var(--brand-text-muted)]" />
        </ClickableRow>
        {settingsOpen && (
          <div className="px-4 pb-4 space-y-6">
            {isAuxLoading && (
              <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-3)]/30 px-3 py-2">
                <p className="t-caption-sm text-[var(--brand-text-muted)]">
                  Loading provider and workspace strategy settings...
                </p>
              </div>
            )}
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Icon as={BarChart3} size="md" className="text-accent-brand" />
                <span className="t-caption-sm text-[var(--brand-text)] font-semibold uppercase tracking-wider">SEO Data Provider</span>
              </div>
              <div className="px-3 py-2 rounded-[var(--radius-lg)] border border-teal-500/40 bg-teal-500/10">
                <div className="t-caption font-semibold text-accent-brand">{PRIMARY_SEO_PROVIDER_LABEL}</div>
                <div className="t-caption-sm mt-0.5 text-[var(--brand-text-muted)]">
                  Primary runtime provider for keyword, competitor, and backlink intelligence.
                </div>
              </div>
              <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1.5">
                Strategy generation now uses DataForSEO whenever SEO provider data is enabled. Stored legacy provider preferences are treated as DataForSEO.
              </p>
            </div>

            {/* SEO Data Mode */}
            {seoDataAvailable && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Icon as={BarChart3} size="md" className="text-accent-orange" />
                  <span className="t-caption-sm text-[var(--brand-text)] font-semibold uppercase tracking-wider">SEO Data Mode</span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {(['none', 'quick', 'full'] as const).map(mode => (
                    <ClickableRow
                      key={mode}
                      onClick={() => setSeoDataMode(mode)}
                      className={`px-3 py-2 rounded-[var(--radius-lg)] border t-caption font-medium transition-all ${
                        seoDataMode === mode
                          ? 'border-orange-500/50 bg-orange-500/10 text-accent-orange'
                          : 'border-[var(--brand-border-hover)] bg-[var(--surface-3)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]'
                      }`}
                    >
                      <div className="font-semibold capitalize">{mode === 'none' ? 'Off' : mode}</div>
                      <div className="t-caption-sm mt-0.5 opacity-70">
                        {mode === 'none' && 'AI + GSC only'}
                        {mode === 'quick' && '~500 credits'}
                        {mode === 'full' && '~7,500 credits'}
                      </div>
                    </ClickableRow>
                  ))}
                </div>
                <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1.5">
                  {seoDataMode === 'quick' && 'Enriches keywords with real search volume and difficulty scores from DataForSEO.'}
                  {seoDataMode === 'full' && 'Full competitive analysis: domain keywords, competitor gaps, related keywords, volume + difficulty.'}
                  {seoDataMode === 'none' && 'Uses AI and Google Search Console data only. No DataForSEO credits used.'}
                </p>
              </div>
            )}

            {/* Competitor Domains */}
            {seoDataAvailable && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <Icon as={Users} size="md" className="text-accent-orange" />
                    <span className="t-caption-sm text-[var(--brand-text)] font-semibold uppercase tracking-wider">Competitor Domains</span>
                  </div>
                  <Button
                    onClick={onDiscoverCompetitors}
                    disabled={discoveringCompetitors}
                    variant="ghost"
                    size="sm"
                    className="px-2 py-0.5 rounded bg-orange-500/10 border border-orange-500/20 t-micro text-accent-orange font-medium hover:bg-orange-500/20"
                  >
                    {discoveringCompetitors ? <Icon as={Loader2} size="sm" className="animate-spin" /> : <Icon as={Search} size="sm" className="text-accent-orange" />}
                    {discoveringCompetitors ? 'Discovering...' : 'Auto-Discover'}
                  </Button>
                </div>
                <FormInput
                  type="text"
                  value={competitors}
                  onChange={setCompetitors}
                  placeholder="e.g. competitor1.com, competitor2.com"
                  className="w-full t-caption placeholder:text-[var(--brand-text-muted)]"
                />
                <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1">Comma-separated (max 5). Auto-discover uses DataForSEO to find organic competitors. These persist between strategy runs.</p>
                {discoverError && <p className="t-caption-sm text-accent-danger mt-1">{discoverError}</p>}
              </div>
            )}

            {/* Page Limit */}
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Icon as={FileText} size="md" className="text-accent-brand" />
                <span className="t-caption-sm text-[var(--brand-text)] font-semibold uppercase tracking-wider">Page Limit</span>
              </div>
              <div className="grid grid-cols-4 gap-3">
                {([200, 500, 1000, 0] as const).map(cap => (
                  <ClickableRow
                    key={cap}
                    onClick={() => setMaxPages(cap)}
                    className={`px-3 py-2 rounded-[var(--radius-lg)] border t-caption font-medium transition-all ${
                      maxPages === cap
                        ? 'border-teal-500/50 bg-teal-500/10 text-accent-brand'
                        : 'border-[var(--brand-border-hover)] bg-[var(--surface-3)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]'
                    }`}
                  >
                    <div className="font-semibold">{cap === 0 ? 'All' : cap}</div>
                    <div className="t-caption-sm mt-0.5 opacity-70">
                      {cap === 200 && '~2-3 min'}
                      {cap === 500 && '~5-7 min'}
                      {cap === 1000 && '~10-15 min'}
                      {cap === 0 && 'No limit'}
                    </div>
                  </ClickableRow>
                ))}
              </div>
              <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1.5">
                {maxPages === 0
                  ? 'Processes every page on the site. May be slow for 500+ page sites.'
                  : `Prioritizes the top ${maxPages} pages by importance (homepage, key service pages, pages with metadata). Skips utility pages.`}
              </p>
            </div>

            {/* Business Context */}
            <div>
              <Button
                onClick={() => setContextOpen(!contextOpen)}
                variant="ghost"
                size="sm"
                className="flex items-center gap-1.5 mb-1 px-0 py-0 h-auto min-h-0"
              >
                <Icon as={Briefcase} size="md" className="text-accent-brand" />
                <span className="t-caption-sm text-[var(--brand-text)] font-semibold uppercase tracking-wider">Business Context</span>
                <Icon as={contextOpen ? ChevronDown : ChevronRight} size="sm" className="text-[var(--brand-text-muted)]" />
              </Button>
              {contextOpen && (
                <div className="space-y-1.5">
                  <FormTextarea
                    value={businessContext}
                    onChange={setBusinessContext}
                    placeholder={`Example: We are a dental practice in Austin, TX. We offer general, cosmetic, and pediatric dentistry. Target audience: families 25-55. Competitors: Aspen Dental, local practices.`}
                    rows={3}
                    className="w-full t-caption placeholder:text-[var(--brand-text-muted)]"
                  />
                  <p className="t-caption-sm text-[var(--brand-text-muted)]">Saved with your strategy. Include: locations, services, audience, differentiators.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
