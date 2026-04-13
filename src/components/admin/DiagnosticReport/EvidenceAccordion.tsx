import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { SectionCard } from '../../ui/SectionCard.js';
import type { DiagnosticContext } from '../../../../shared/types/diagnostics.js';

interface Props {
  context: DiagnosticContext;
}

interface AccordionSectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function AccordionSection({ title, children, defaultOpen = false }: AccordionSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-zinc-800 last:border-b-0">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 w-full py-3 px-1 text-left text-sm font-medium text-zinc-300 hover:text-zinc-100">
        {open ? <ChevronDown className="w-4 h-4 text-zinc-500" /> : <ChevronRight className="w-4 h-4 text-zinc-500" />}
        {title}
      </button>
      {open && <div className="pb-4 px-1">{children}</div>}
    </div>
  );
}

export function EvidenceAccordion({ context }: Props) {
  return (
    <SectionCard>
      <h3 className="text-sm font-semibold text-zinc-200 mb-3">Raw Evidence</h3>

      {context.positionHistory.length > 0 && (
        <AccordionSection title={`Position History (${context.positionHistory.length} days)`}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-zinc-500 border-b border-zinc-800">
                <th className="text-left py-1 pr-4">Date</th>
                <th className="text-right py-1 pr-4">Position</th>
                <th className="text-right py-1 pr-4">Clicks</th>
                <th className="text-right py-1">Impressions</th>
              </tr></thead>
              <tbody>
                {context.positionHistory.slice(-30).map((p) => (
                  <tr key={p.date} className="text-zinc-400 border-b border-zinc-900">
                    <td className="py-1 pr-4 font-mono">{p.date}</td>
                    <td className="text-right py-1 pr-4 text-blue-400">{p.position.toFixed(1)}</td>
                    <td className="text-right py-1 pr-4 text-blue-400">{p.clicks}</td>
                    <td className="text-right py-1 text-blue-400">{p.impressions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AccordionSection>
      )}

      {context.queryBreakdown.length > 0 && (
        <AccordionSection title={`Query Breakdown (${context.queryBreakdown.length} queries)`}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-zinc-500 border-b border-zinc-800">
                <th className="text-left py-1 pr-4">Query</th>
                <th className="text-right py-1 pr-4">Clicks</th>
                <th className="text-right py-1">Position</th>
              </tr></thead>
              <tbody>
                {context.queryBreakdown.map((q) => (
                  <tr key={q.query} className="text-zinc-400 border-b border-zinc-900">
                    <td className="py-1 pr-4 font-mono truncate max-w-[200px]">{q.query}</td>
                    <td className="text-right py-1 pr-4 text-blue-400">{q.currentClicks}</td>
                    <td className="text-right py-1 text-blue-400">{q.currentPosition.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AccordionSection>
      )}

      {context.redirectProbe.chain.length > 0 && (
        <AccordionSection title={`Redirect Chain (${context.redirectProbe.chain.length} hops)`}>
          <div className="space-y-1">
            {context.redirectProbe.chain.map((hop, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className={`font-mono px-1.5 py-0.5 rounded ${hop.status === 301 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
                  {hop.status}
                </span>
                <span className="text-zinc-400 font-mono truncate">{hop.url}</span>
              </div>
            ))}
          </div>
        </AccordionSection>
      )}

      {context.internalLinks.count > 0 && (
        <AccordionSection title={`Internal Links (${context.internalLinks.count} found, median: ${context.internalLinks.siteMedian})`}>
          <div className="space-y-1">
            {context.internalLinks.topLinkingPages.map((page) => (
              <div key={page} className="text-xs text-blue-400 font-mono truncate">{page}</div>
            ))}
          </div>
        </AccordionSection>
      )}

      {context.backlinks.totalBacklinks > 0 && (
        <AccordionSection title={`Backlinks (${context.backlinks.totalBacklinks} total, ${context.backlinks.referringDomains} domains)`}>
          <div className="space-y-1">
            {context.backlinks.topDomains.map((d) => (
              <div key={d.domain} className="flex justify-between text-xs">
                <span className="text-zinc-400">{d.domain}</span>
                <span className="text-blue-400">{d.backlinksCount} links</span>
              </div>
            ))}
          </div>
        </AccordionSection>
      )}

      {context.unavailableSources.length > 0 && (
        <AccordionSection title={`Unavailable Sources (${context.unavailableSources.length})`}>
          <div className="space-y-1">
            {context.unavailableSources.map((s) => (
              <div key={s.source} className="text-xs text-zinc-500">
                <span className="font-medium">{s.source}</span>: {s.reason}
              </div>
            ))}
          </div>
        </AccordionSection>
      )}
    </SectionCard>
  );
}
