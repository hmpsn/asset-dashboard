import { useState, useEffect } from 'react';
import { RefreshCw, AlertTriangle, AlertCircle, Eye, Sparkles, ArrowDown, ArrowUp, Send, Check, Loader2 } from 'lucide-react';
import { contentDecay } from '../api/content';
import { clientActions } from '../api/clientActions';
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
  critical: { label: 'Critical', bg: 'bg-red-500/10', border: 'border-red-500/20', text: 'text-accent-danger', icon: AlertTriangle },
  warning: { label: 'Warning', bg: 'bg-amber-500/10', border: 'border-amber-500/20', text: 'text-accent-warning', icon: AlertCircle },
  watch: { label: 'Watch', bg: 'bg-blue-500/10', border: 'border-blue-500/20', text: 'text-accent-info', icon: Eye },
};

export default function ContentDecay({ workspaceId }: Props) {
  const [analysis, setAnalysis] = useState<DecayAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [generatingRecs, setGeneratingRecs] = useState(false);
  const [expandedPages, setExpandedPages] = useState<Set<string>>(new Set());
  const [severityFilter, setSeverityFilter] = useState<'all' | 'critical' | 'warning' | 'watch'>('all');
  const [sendingPage, setSendingPage] = useState<string | null>(null);
  const [sentPages, setSentPages] = useState<Set<string>>(new Set());
  const [pageNotes, setPageNotes] = useState<Record<string, string>>({});

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

  const sendPageToClient = async (page: DecayingPage) => {
    setSendingPage(page.page);
    try {
      await clientActions.create(workspaceId, {
        sourceType: 'content_decay',
        sourceId: `content-decay:${page.page}`,
        title: `Refresh recommendation for ${page.page}`,
        summary: page.refreshRecommendation || `${page.page} has lost ${page.clickDeclinePct}% of clicks and should be reviewed for a content refresh.`,
        priority: page.severity === 'critical' ? 'high' : page.severity === 'warning' ? 'medium' : 'low',
        clientNote: (pageNotes[page.page] ?? '').trim() || undefined,
        payload: { page, analyzedAt: analysis?.analyzedAt },
      });
      setSentPages(prev => new Set(prev).add(page.page));
    } catch (err) {
      console.error('ContentDecay operation failed:', err);
    } finally {
      setSendingPage(null);
    }
  };

  const filtered = analysis?.decayingPages.filter(p => severityFilter === 'all' || p.severity === severityFilter) || [];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-5 h-5 border-2 rounded-[var(--radius-pill)] animate-spin border-[var(--brand-border)] border-t-teal-400" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="t-caption text-[var(--brand-text-bright)] flex items-center gap-2">
            <Icon as={ArrowDown} size="md" className="text-accent-warning" />
            Content Decay Monitor
          </h3>
          <p className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">
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
          <EmptyState icon={ArrowDown} title="No decay analysis yet" description="Run an analysis to detect content losing search traffic" className="py-12" />
        </div>
      )}

      {analysis && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] p-4 text-center rounded-[var(--radius-signature)]">
              <div className="t-stat text-[var(--brand-text-bright)]">{analysis.summary.totalDecaying}</div>
              <div className="t-caption-sm text-[var(--brand-text-muted)] mt-1">Declining Pages</div>
            </div>
            {(['critical', 'warning', 'watch'] as const).map(sev => {
              const cfg = SEV_CONFIG[sev];
              const count = analysis.summary[sev];
              return (
                <button key={sev} onClick={() => setSeverityFilter(severityFilter === sev ? 'all' : sev)}
                  className={`border p-4 text-center transition-colors rounded-[var(--radius-signature)] ${severityFilter === sev ? `${cfg.bg} ${cfg.border}` : 'bg-[var(--surface-2)] border-[var(--brand-border)] hover:border-[var(--brand-border-hover)]'}`}>
                  <div className={`t-stat ${cfg.text}`}>{count}</div>
                  <div className="t-caption-sm text-[var(--brand-text-muted)] mt-1">{cfg.label}</div>
                </button>
              );
            })}
          </div>

          {/* AI recommendations button - styleguide brand accent */}
          {analysis.summary.totalDecaying > 0 && !analysis.decayingPages.some(p => p.refreshRecommendation) && (
            <button onClick={generateRecommendations} disabled={generatingRecs}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-[var(--radius-lg)] bg-accent-brand-soft border border-accent-brand-soft text-accent-brand hover:bg-accent-brand-soft transition-colors t-caption-sm font-medium disabled:opacity-50">
              <Icon as={Sparkles} size="md" className={generatingRecs ? 'animate-pulse' : ''} />
              {generatingRecs ? 'Generating AI refresh recommendations...' : 'Generate AI Refresh Recommendations'}
            </button>
          )}

          {/* Decaying pages list */}
          {filtered.length > 0 && (
            // pr-check-disable-next-line -- brand asymmetric signature on decaying-pages list outer card; intentional non-SectionCard chrome
            <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden rounded-[var(--radius-signature-lg)]">
              <div className="px-4 py-3 border-b border-[var(--brand-border)] flex items-center justify-between">
                <span className="t-caption-sm font-medium text-[var(--brand-text-bright)]">
                  {severityFilter === 'all' ? 'All Declining Pages' : `${SEV_CONFIG[severityFilter].label} Pages`}
                </span>
                <span className="t-caption-sm text-[var(--brand-text-muted)]">{filtered.length} pages</span>
              </div>
              <div className="divide-y divide-[var(--brand-border)]/50 max-h-[500px] overflow-y-auto">
                {filtered.map(page => {
                  const cfg = SEV_CONFIG[page.severity];
                  const isExpanded = expandedPages.has(page.page);
                  return (
                    <div key={page.page}>
                      <button onClick={() => togglePage(page.page)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface-3)]/30 transition-colors text-left">
                        <div className={`w-6 h-6 rounded-[var(--radius-md)] flex items-center justify-center flex-shrink-0 ${cfg.bg}`}>
                          <cfg.icon className={`w-3.5 h-3.5 ${cfg.text}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="t-caption-sm font-medium text-[var(--brand-text-bright)] truncate">{page.page}</div>
                          <div className="flex items-center gap-3 mt-0.5">
                            <span className="t-caption-sm text-accent-danger flex items-center gap-0.5">
                              <Icon as={ArrowDown} size="sm" /> {page.clickDeclinePct}% clicks
                            </span>
                            <span className="t-caption-sm text-[var(--brand-text-muted)]">
                              {page.previousClicks} → {page.currentClicks}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 flex-shrink-0 text-right">
                          <div>
                            <div className={`t-caption-sm font-mono ${page.positionChange > 0 ? 'text-accent-danger' : page.positionChange < 0 ? 'text-accent-success' : 'text-[var(--brand-text-muted)]'}`}>
                              {page.positionChange > 0 ? <Icon as={ArrowDown} size="sm" /> : page.positionChange < 0 ? <Icon as={ArrowUp} size="sm" /> : null}
                              {' '}{Math.abs(page.positionChange)} pos
                            </div>
                            <div className="t-micro text-[var(--brand-text-muted)]">now #{page.currentPosition}</div>
                          </div>
                          <span className={`t-micro font-medium px-2 py-0.5 rounded-[var(--radius-sm)] ${cfg.bg} ${cfg.text}`}>{cfg.label}</span>
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="px-4 pb-3 pl-13 space-y-2">
                          <div className="grid grid-cols-3 gap-2 text-center">
                            <div className="bg-[var(--surface-3)]/50 rounded-[var(--radius-lg)] p-2">
                              <div className="t-micro text-[var(--brand-text-muted)]">Clicks</div>
                              <div className="t-caption-sm font-medium text-accent-danger">{page.previousClicks} → {page.currentClicks}</div>
                              <div className="t-micro text-accent-danger">{page.clickDeclinePct}%</div>
                            </div>
                            <div className="bg-[var(--surface-3)]/50 rounded-[var(--radius-lg)] p-2">
                              <div className="t-micro text-[var(--brand-text-muted)]">Impressions</div>
                              <div className={`t-caption-sm font-medium ${page.impressionChangePct < 0 ? 'text-accent-warning' : 'text-accent-success'}`}>{page.previousImpressions} → {page.currentImpressions}</div>
                              <div className={`t-micro ${page.impressionChangePct < 0 ? 'text-accent-warning' : 'text-accent-success'}`}>{page.impressionChangePct > 0 ? '+' : ''}{page.impressionChangePct}%</div>
                            </div>
                            <div className="bg-[var(--surface-3)]/50 rounded-[var(--radius-lg)] p-2">
                              <div className="t-micro text-[var(--brand-text-muted)]">Position</div>
                              <div className={`t-caption-sm font-medium ${page.positionChange > 0 ? 'text-accent-danger' : 'text-accent-success'}`}>{page.previousPosition} → {page.currentPosition}</div>
                              <div className={`t-micro ${page.positionChange > 0 ? 'text-accent-danger' : 'text-accent-success'}`}>{page.positionChange > 0 ? '+' : ''}{page.positionChange}</div>
                            </div>
                          </div>
                          {page.refreshRecommendation && (
                            <div className="bg-accent-brand-soft border border-accent-brand-soft rounded-[var(--radius-lg)] p-3 mt-2">
                              <div className="flex items-center justify-between gap-2 mb-2">
                                <div className="flex items-center gap-1.5 t-caption-sm font-medium text-accent-brand">
                                  <Icon as={Sparkles} size="md" /> AI Refresh Recommendation
                                </div>
                                <button
                                  onClick={() => sendPageToClient(page)}
                                  disabled={sendingPage === page.page || sentPages.has(page.page)}
                                  className="flex items-center gap-1 px-2 py-1 rounded-[var(--radius-md)] bg-teal-600/15 border border-teal-500/20 text-teal-300 hover:bg-teal-600/25 t-caption-sm font-medium transition-colors disabled:opacity-60"
                                >
                                  {sendingPage === page.page
                                    ? <Loader2 className="w-3 h-3 animate-spin" />
                                    : sentPages.has(page.page)
                                      ? <Icon as={Check} size="sm" className="text-emerald-400" />
                                      : <Icon as={Send} size="sm" />}
                                  {sentPages.has(page.page) ? 'Sent' : 'Send to Client'}
                                </button>
                              </div>
                              <div className="t-caption-sm text-[var(--brand-text-bright)] leading-relaxed whitespace-pre-wrap">{page.refreshRecommendation}</div>
                              {!sentPages.has(page.page) && (
                                <textarea
                                  rows={2}
                                  placeholder="Add a note for your client (optional)"
                                  value={pageNotes[page.page] ?? ''}
                                  onChange={e => setPageNotes(prev => ({ ...prev, [page.page]: e.target.value }))}
                                  className="mt-2 w-full rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-3 py-2 t-caption text-[var(--brand-text)] placeholder:text-[var(--brand-text-muted)] resize-none focus:outline-none focus:border-[var(--brand-border-hover)]"
                                />
                              )}
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
              <div className="text-accent-success t-ui">All content performing well</div>
              <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1">No pages showing significant traffic decline</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
