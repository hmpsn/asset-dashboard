// @ds-rebuilt
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { DiagnosticContext } from '../../../../../shared/types/diagnostics';
import { Badge, Button, Icon, SectionCard, cn } from '../../../ui';
import { formatDiagnosticNumber, formatDiagnosticPercent } from './diagnosticPresentation';

interface DiagnosticsEvidenceProps {
  context: DiagnosticContext;
}

interface EvidenceSectionProps {
  title: string;
  icon: 'chart' | 'clock' | 'search' | 'link' | 'globe' | 'alert' | 'info';
  children: ReactNode;
  defaultOpen?: boolean;
}

function EvidenceSection({ title, icon, children, defaultOpen = false }: EvidenceSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-t border-[var(--brand-border)] first:border-t-0">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="!flex w-full items-center justify-start gap-[11px] !rounded-none !px-[18px] !py-[13px] text-left hover:bg-[var(--surface-3)]"
        style={{ transitionDuration: 'var(--dur-fast)' }}
      >
        <span className="inline-flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[var(--radius-md)] bg-[var(--surface-3)] text-[var(--blue)]">
          <Icon name={icon} size="sm" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1 t-caption font-semibold text-[var(--brand-text-bright)]">{title}</span>
        <Icon
          name="chevronDown"
          size="sm"
          className={cn('text-[var(--brand-text-dim)] transition-transform', open && 'rotate-180')}
          style={{ transitionDuration: 'var(--dur-fast)' }}
          aria-hidden="true"
        />
      </Button>
      {open && <div className="px-[18px] pb-[15px]">{children}</div>}
    </div>
  );
}

function EvidenceValueRow({ label, value, tone = 'default' }: { label: string; value: ReactNode; tone?: 'default' | 'danger' | 'warning' }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-[var(--brand-border)] py-2 first:border-t-0">
      <span className="t-caption-sm text-[var(--brand-text-muted)]">{label}</span>
      <span className={cn(
        'text-right t-caption font-semibold tabular-nums',
        tone === 'danger' ? 'text-[var(--red)]' : tone === 'warning' ? 'text-[var(--amber)]' : 'text-[var(--brand-text-bright)]',
      )}>
        {value}
      </span>
    </div>
  );
}

function EvidenceTable({ children }: { children: ReactNode }) {
  return <div className="max-h-[280px] overflow-auto rounded-[var(--radius-md)] border border-[var(--brand-border)]">{children}</div>;
}

export function DiagnosticsEvidence({ context }: DiagnosticsEvidenceProps) {
  const period = context.periodComparison;
  const relatedSignalCount = context.concurrentAnomalies.length + context.existingInsights.length;

  return (
    <SectionCard noPadding className="overflow-hidden !rounded-[var(--radius-lg)]">
      <EvidenceSection title="Period comparison" icon="chart" defaultOpen>
        <EvidenceValueRow
          label="Clicks"
          value={`${formatDiagnosticNumber(period.previous.clicks)} → ${formatDiagnosticNumber(period.current.clicks)} (${formatDiagnosticPercent(period.changePercent.clicks)})`}
          tone={period.changePercent.clicks < 0 ? 'danger' : 'default'}
        />
        <EvidenceValueRow
          label="Impressions"
          value={`${formatDiagnosticNumber(period.previous.impressions)} → ${formatDiagnosticNumber(period.current.impressions)} (${formatDiagnosticPercent(period.changePercent.impressions)})`}
          tone={period.changePercent.impressions < 0 ? 'danger' : 'default'}
        />
        <EvidenceValueRow
          label="Average position"
          value={`${period.previous.position.toFixed(1)} → ${period.current.position.toFixed(1)}`}
          tone={period.current.position > period.previous.position ? 'danger' : 'default'}
        />
        <EvidenceValueRow
          label="CTR"
          value={`${period.previous.ctr.toFixed(1)}% → ${period.current.ctr.toFixed(1)}%`}
          tone={period.current.ctr < period.previous.ctr ? 'warning' : 'default'}
        />
      </EvidenceSection>

      {context.positionHistory.length > 0 && (
        <EvidenceSection title={`Position history · ${context.positionHistory.length} days`} icon="clock">
          <EvidenceTable>
            <table className="w-full min-w-[520px] t-caption-sm">
              <thead className="sticky top-0 bg-[var(--surface-1)] text-[var(--brand-text-dim)]">
                <tr><th className="px-3 py-2 text-left font-medium">Date</th><th className="px-3 py-2 text-right font-medium">Position</th><th className="px-3 py-2 text-right font-medium">Clicks</th><th className="px-3 py-2 text-right font-medium">Impressions</th></tr>
              </thead>
              <tbody>
                {context.positionHistory.slice(-30).map((point) => (
                  <tr key={point.date} className="border-t border-[var(--brand-border)] text-[var(--brand-text)]">
                    <td className="px-3 py-2 font-mono">{point.date}</td><td className="px-3 py-2 text-right tabular-nums text-[var(--blue)]">{point.position.toFixed(1)}</td><td className="px-3 py-2 text-right tabular-nums">{formatDiagnosticNumber(point.clicks)}</td><td className="px-3 py-2 text-right tabular-nums">{formatDiagnosticNumber(point.impressions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </EvidenceTable>
        </EvidenceSection>
      )}

      {context.queryBreakdown.length > 0 && (
        <EvidenceSection title={`Query breakdown · ${context.queryBreakdown.length} queries`} icon="search">
          <EvidenceTable>
            <table className="w-full min-w-[560px] t-caption-sm">
              <thead className="sticky top-0 bg-[var(--surface-1)] text-[var(--brand-text-dim)]">
                <tr><th className="px-3 py-2 text-left font-medium">Query</th><th className="px-3 py-2 text-right font-medium">Clicks</th><th className="px-3 py-2 text-right font-medium">Position</th></tr>
              </thead>
              <tbody>
                {context.queryBreakdown.map((query) => (
                  <tr key={query.query} className="border-t border-[var(--brand-border)] text-[var(--brand-text)]">
                    <td className="max-w-[340px] truncate px-3 py-2 font-mono">{query.query}</td><td className="px-3 py-2 text-right tabular-nums">{formatDiagnosticNumber(query.previousClicks)} → {formatDiagnosticNumber(query.currentClicks)}</td><td className="px-3 py-2 text-right tabular-nums text-[var(--blue)]">{query.previousPosition.toFixed(1)} → {query.currentPosition.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </EvidenceTable>
        </EvidenceSection>
      )}

      {context.redirectProbe.chain.length > 0 && (
        <EvidenceSection title={`Redirect chain · ${context.redirectProbe.chain.length} hops`} icon="link">
          <div className="space-y-1.5">
            {context.redirectProbe.chain.map((hop, index) => (
              <div key={`${hop.url}-${index}`} className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--surface-1)] px-3 py-2 t-caption-sm">
                <Badge label={String(hop.status)} tone={hop.status >= 400 ? 'red' : 'emerald'} className="font-mono" />
                <span className="min-w-0 truncate font-mono text-[var(--brand-text)]">{hop.url}</span>
              </div>
            ))}
          </div>
        </EvidenceSection>
      )}

      <EvidenceSection title="Internal links" icon="link">
        <EvidenceValueRow label="Current internal links" value={formatDiagnosticNumber(context.internalLinks.count)} tone={context.internalLinks.deficit > 0 ? 'warning' : 'default'} />
        <EvidenceValueRow label="Site median" value={formatDiagnosticNumber(context.internalLinks.siteMedian)} />
        <EvidenceValueRow label="Link deficit" value={formatDiagnosticNumber(context.internalLinks.deficit)} tone={context.internalLinks.deficit > 0 ? 'danger' : 'default'} />
        {context.internalLinks.topLinkingPages.length > 0 && <div className="mt-2 space-y-1">{context.internalLinks.topLinkingPages.map((page) => <div key={page} className="truncate t-caption-sm font-mono text-[var(--blue)]">{page}</div>)}</div>}
      </EvidenceSection>

      <EvidenceSection title="Backlinks" icon="globe">
        <EvidenceValueRow label="Total backlinks" value={formatDiagnosticNumber(context.backlinks.totalBacklinks)} />
        <EvidenceValueRow label="Referring domains" value={formatDiagnosticNumber(context.backlinks.referringDomains)} />
        <EvidenceValueRow label="Recently lost" value={formatDiagnosticNumber(context.backlinks.recentlyLost)} tone={context.backlinks.recentlyLost > 0 ? 'warning' : 'default'} />
        {context.backlinks.topDomains.length > 0 && <div className="mt-2 space-y-1">{context.backlinks.topDomains.map((domain) => <div key={domain.domain} className="flex justify-between gap-3 t-caption-sm"><span className="truncate text-[var(--brand-text)]">{domain.domain}</span><span className="flex-none tabular-nums text-[var(--blue)]">{formatDiagnosticNumber(domain.backlinksCount)} links</span></div>)}</div>}
      </EvidenceSection>

      {context.recentActivity.length > 0 && (
        <EvidenceSection title={`Recent activity · ${context.recentActivity.length}`} icon="clock">
          <div className="space-y-2">{context.recentActivity.map((activity, index) => <div key={`${activity.date}-${index}`} className="rounded-[var(--radius-md)] bg-[var(--surface-1)] px-3 py-2"><div className="flex items-center justify-between gap-3 t-caption"><span className="font-semibold text-[var(--brand-text-bright)]">{activity.action}</span><span className="flex-none t-caption-sm text-[var(--brand-text-muted)]">{activity.date}</span></div><p className="mt-1 t-caption-sm text-[var(--brand-text-muted)]">{activity.details}</p></div>)}</div>
        </EvidenceSection>
      )}

      {relatedSignalCount > 0 && (
        <EvidenceSection title={`Related signals · ${relatedSignalCount}`} icon="alert">
          <div className="space-y-2">
            {context.concurrentAnomalies.map((anomaly, index) => <div key={`${anomaly.type}-${anomaly.page}-${index}`} className="flex items-start justify-between gap-3 rounded-[var(--radius-md)] bg-[var(--surface-1)] px-3 py-2 t-caption-sm"><span className="text-[var(--brand-text)]">{anomaly.type.replace(/_/g, ' ')} · {anomaly.page}</span><span className="flex-none text-[var(--amber)]">{anomaly.severity}</span></div>)}
            {context.existingInsights.map((insight, index) => <div key={`${insight.type}-${index}`} className="rounded-[var(--radius-md)] bg-[var(--surface-1)] px-3 py-2"><div className="t-caption font-semibold text-[var(--brand-text-bright)]">{insight.type.replace(/_/g, ' ')}</div><p className="mt-1 t-caption-sm text-[var(--brand-text-muted)]">{insight.summary}</p></div>)}
          </div>
        </EvidenceSection>
      )}

      {context.unavailableSources.length > 0 && (
        <EvidenceSection title={`Unavailable sources · ${context.unavailableSources.length}`} icon="info">
          <div className="space-y-2">{context.unavailableSources.map((source) => <div key={source.source} className="t-caption-sm text-[var(--brand-text-muted)]"><span className="font-semibold text-[var(--brand-text)]">{source.source}:</span> {source.reason}</div>)}</div>
        </EvidenceSection>
      )}
    </SectionCard>
  );
}
