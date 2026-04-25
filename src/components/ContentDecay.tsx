import { useState, useEffect } from 'react';
import { TrendingDown, RefreshCw, AlertTriangle, AlertCircle, Eye, Sparkles, ArrowDown, ArrowUp } from 'lucide-react';
import { contentDecay } from '../api/content';
import { EmptyState, Icon, Button } from './ui';

interface DecayingPage {
  page: string;
  currentClicks: number;
  previousClicks: number;
  clickDeclinePct: number;
  currentImpressions: number;
  previousImpressions: number;
  impressionChangePct: number;
  currentPosition: number;
  previousPosition: number;
  positionChange: number;
  severity: 'critical' | 'warning' | 'watch';
  refreshRecommendation?: string;
}

interface DecayAnalysis {
  workspaceId: string;
  analyzedAt: string;
  totalPages: number;
  decayingPages: DecayingPage[];
  summary: {
    critical: number;
    warning: number;
    watch: number;
    totalDecaying: number;
    avgDeclinePct: number;
  };
}

interface Props {
  workspaceId: string;
}

const SEV_CONFIG = {
  critical: { label: 'Critical', bg: 'bg-red-500/10', border: 'border-red-500/20', text: 'text-red-400', icon: AlertTriangle },
  warning: { label: 'Warning', bg: 'bg-amber-500/10', border: 'border-amber-500/20', text: 'text-amber-400', icon: AlertCircle },
  watch: { label: 'Watch', bg: 'bg-blue-500/10', border: 'border-blue-500/20', text: 'text-blue-400', icon: Eye },
};

export default function ContentDecay({ workspaceId }: Props) {
  const [analysis, setAnalysis] = useState<DecayAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [generatingRecs, setGeneratingRecs] = useState(false);
  const [expandedPages, setExpandedPages] = useState<Set<string>>(new Set());
  const [severityFilter, setSeverityFilter] = useState<'all' | 'critical' | 'warning' | 'watch'>('all');

  useEffect(() => {
    setLoading(true);
    contentDecay.get(workspaceId)
      .then(d => setAnalysis(d as DecayAnalysis | null))
      .catch((err) => { console.error('ContentDecay operation failed:', err); })
      .finally(() => setLoading(false));
  }, [workspaceId]);

  const runAnalysis = async () => {
    setAnalyzing(true);
    try {
      const result = await contentDecay.analyze(workspaceId);
      setAnalysis(result as DecayAnalysis);
    } catch (err) { console.error('ContentDecay operation failed:', err); }
    finally { setAnalyzing(false); }
  };

  const generateRecommendations = async () => {
    setGeneratingRecs(true);
    try {
      const result = await contentDecay.recommendations(workspaceId, { maxPages: 5 });
      setAnalysis(result as DecayAnalysis);
    } catch (err) { console.error('ContentDecay operation failed:', err); }
    finally { setGeneratingRecs(false); }
  };

  const togglePage = (page: string) => {
    setExpandedPages(prev => {
      const n = new Set(prev);
      if (n.has(page)) n.delete(page); else n.add(page);
      return n;
    });
  };

  const filtered = analysis?.decayingPages.filter(p => severityFilter === 'all' || p.severity === severityFilter) || [];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-5 h-5 border-2 rounded-full animate-spin border-[var(--brand-border)] border-t-teal-400" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[var(--brand-text-bright)] flex items-center gap-2">
            <Icon as={TrendingDown} size="md" className="text-amber-400" />
            Content Decay Monitor
          </h3>
          <p className="text-xs text-[var(--brand-text-muted)] mt-0.5">
            {analysis ? `Last analyzed ${new Date(analysis.analyzedAt).toLocaleDateString()} · ${analysis.totalPages} pages tracked` : 'Detect declining content and get AI refresh recommendations'}
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          icon={RefreshCw}
          onClick={runAnalysis}
          disabled={analyzing}
          loading={analyzing}
        >
          {analyzing ? 'Analyzing...' : analysis ? 'Re-analyze' : 'Run Analysis'}
        </Button>
      </div>

      {!analysis && !analyzing && (
        // pr-check-disable-next-line -- brand asymmetric signature on decay analytics summary; intentional non-SectionCard chrome
        <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-signature-lg)]">
          <EmptyState icon={TrendingDown} title="No decay analysis yet" description="Run an analysis to detect content losing search traffic" className="py-12" />
        </div>
      )}

      {analysis && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] p-4 text-center rounded-[var(--radius-signature)]">
              <div className="text-2xl font-bold text-[var(--brand-text-bright)]">{analysis.summary.totalDecaying}</div>
              <div className="text-[11px] text-[var(--brand-text-muted)] mt-1">Declining Pages</div>
            </div>
            {(['critical', 'warning', 'watch'] as const).map(sev => {
              const cfg = SEV_CONFIG[sev];
              const count = analysis.summary[sev];
              return (
                <button key={sev} onClick={() => setSeverityFilter(severityFilter === sev ? 'all' : sev)}
                  className={`border p-4 text-center transition-colors rounded-[var(--radius-signature)] ${severityFilter === sev ? `${cfg.bg} ${cfg.border}` : 'bg-[var(--surface-2)] border-[var(--brand-border)] hover:border-[var(--brand-border-hover)]'}`}>
                  <div className={`text-2xl font-bold ${cfg.text}`}>{count}</div>
                  <div className="text-[11px] text-[var(--brand-text-muted)] mt-1">{cfg.label}</div>
                </button>
              );
            })}
          </div>

          {/* AI recommendations button - purple is valid: admin AI surface */}
          {analysis.summary.totalDecaying > 0 && !analysis.decayingPages.some(p => p.refreshRecommendation) && (
            <button onClick={generateRecommendations} disabled={generatingRecs}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-[var(--radius-lg)] bg-purple-600/10 border border-purple-500/20 text-purple-300 hover:bg-purple-600/20 transition-colors text-xs font-medium disabled:opacity-50">
              <Icon as={Sparkles} size="md" className={generatingRecs ? 'animate-pulse' : ''} />
              {generatingRecs ? 'Generating AI refresh recommendations...' : 'Generate AI Refresh Recommendations'}
            </button>
          )}

          {/* Decaying pages list */}
          {filtered.length > 0 && (
            // pr-check-disable-next-line -- brand asymmetric signature on decaying-pages list outer card; intentional non-SectionCard chrome
            <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden rounded-[var(--radius-signature-lg)]">
              <div className="px-4 py-3 border-b border-[var(--brand-border)] flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--brand-text-bright)]">
                  {severityFilter === 'all' ? 'All Declining Pages' : `${SEV_CONFIG[severityFilter].label} Pages`}
                </span>
                <span className="text-[11px] text-[var(--brand-text-muted)]">{filtered.length} pages</span>
              </div>
              <div className="divide-y divide-[var(--brand-border)]/50 max-h-[500px] overflow-y-auto">
                {filtered.map(page => {
                  const cfg = SEV_CONFIG[page.severity];
                  const isExpanded = expandedPages.has(page.page);
                  return (
                    <div key={page.page}>
                      <button onClick={() => togglePage(page.page)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface-3)]/30 transition-colors text-left">
                        <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${cfg.bg}`}>
                          <cfg.icon className={`w-3.5 h-3.5 ${cfg.text}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-[var(--brand-text-bright)] truncate">{page.page}</div>
                          <div className="flex items-center gap-3 mt-0.5">
                            <span className="text-[11px] text-red-400 flex items-center gap-0.5">
                              <Icon as={ArrowDown} size="sm" /> {page.clickDeclinePct}% clicks
                            </span>
                            <span className="text-[11px] text-[var(--brand-text-muted)]">
                              {page.previousClicks} → {page.currentClicks}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 flex-shrink-0 text-right">
                          <div>
                            <div className={`text-xs font-mono ${page.positionChange > 0 ? 'text-red-400' : page.positionChange < 0 ? 'text-emerald-400' : 'text-[var(--brand-text-muted)]'}`}>
                              {page.positionChange > 0 ? <Icon as={ArrowDown} size="sm" /> : page.positionChange < 0 ? <Icon as={ArrowUp} size="sm" /> : null}
                              {' '}{Math.abs(page.positionChange)} pos
                            </div>
                            <div className="text-[10px] text-[var(--brand-text-muted)]">now #{page.currentPosition}</div>
                          </div>
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${cfg.bg} ${cfg.text}`}>{cfg.label}</span>
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="px-4 pb-3 pl-13 space-y-2">
                          <div className="grid grid-cols-3 gap-2 text-center">
                            <div className="bg-[var(--surface-3)]/50 rounded-[var(--radius-lg)] p-2">
                              <div className="text-[10px] text-[var(--brand-text-muted)]">Clicks</div>
                              <div className="text-xs font-medium text-red-400">{page.previousClicks} → {page.currentClicks}</div>
                              <div className="text-[10px] text-red-400/70">{page.clickDeclinePct}%</div>
                            </div>
                            <div className="bg-[var(--surface-3)]/50 rounded-[var(--radius-lg)] p-2">
                              <div className="text-[10px] text-[var(--brand-text-muted)]">Impressions</div>
                              <div className={`text-xs font-medium ${page.impressionChangePct < 0 ? 'text-amber-400' : 'text-emerald-400'}`}>{page.previousImpressions} → {page.currentImpressions}</div>
                              <div className={`text-[10px] ${page.impressionChangePct < 0 ? 'text-amber-400/70' : 'text-emerald-400/70'}`}>{page.impressionChangePct > 0 ? '+' : ''}{page.impressionChangePct}%</div>
                            </div>
                            <div className="bg-[var(--surface-3)]/50 rounded-[var(--radius-lg)] p-2">
                              <div className="text-[10px] text-[var(--brand-text-muted)]">Position</div>
                              <div className={`text-xs font-medium ${page.positionChange > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{page.previousPosition} → {page.currentPosition}</div>
                              <div className={`text-[10px] ${page.positionChange > 0 ? 'text-red-400/70' : 'text-emerald-400/70'}`}>{page.positionChange > 0 ? '+' : ''}{page.positionChange}</div>
                            </div>
                          </div>
                          {page.refreshRecommendation && (
                            <div className="bg-purple-500/5 border border-purple-500/15 rounded-[var(--radius-lg)] p-3 mt-2">
                              <div className="flex items-center gap-1.5 text-[11px] font-medium text-purple-300 mb-2">
                                <Icon as={Sparkles} size="sm" /> AI Refresh Recommendation
                              </div>
                              <div className="text-[11px] text-[var(--brand-text-bright)] leading-relaxed whitespace-pre-wrap">{page.refreshRecommendation}</div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {filtered.length === 0 && analysis.summary.totalDecaying === 0 && (
            // pr-check-disable-next-line -- brand asymmetric signature on no-decay empty state; intentional non-SectionCard chrome
            <div className="text-center py-8 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-signature-lg)]">
              <div className="text-emerald-400 text-sm font-medium">All content performing well</div>
              <p className="text-xs text-[var(--brand-text-muted)] mt-1">No pages showing significant traffic decline</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
