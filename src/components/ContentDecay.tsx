import { useState, useEffect } from 'react';
import { TrendingDown, RefreshCw, AlertTriangle, AlertCircle, Eye, Sparkles, ArrowDown, ArrowUp } from 'lucide-react';
import { contentDecay } from '../api/content';
import { EmptyState } from './ui';

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
        <div className="w-5 h-5 border-2 rounded-full animate-spin border-zinc-800 border-t-teal-400" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-amber-400" />
            Content Decay Monitor
          </h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            {analysis ? `Last analyzed ${new Date(analysis.analyzedAt).toLocaleDateString()} · ${analysis.totalPages} pages tracked` : 'Detect declining content and get AI refresh recommendations'}
          </p>
        </div>
        <button onClick={runAnalysis} disabled={analyzing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-50 transition-colors">
          <RefreshCw className={`w-3.5 h-3.5 ${analyzing ? 'animate-spin' : ''}`} />
          {analyzing ? 'Analyzing...' : analysis ? 'Re-analyze' : 'Run Analysis'}
        </button>
      </div>

      {!analysis && !analyzing && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800">
          <EmptyState icon={TrendingDown} title="No decay analysis yet" description="Run an analysis to detect content losing search traffic" className="py-12" />
        </div>
      )}

      {analysis && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 text-center">
              <div className="text-2xl font-bold text-zinc-100">{analysis.summary.totalDecaying}</div>
              <div className="text-[11px] text-zinc-500 mt-1">Declining Pages</div>
            </div>
            {(['critical', 'warning', 'watch'] as const).map(sev => {
              const cfg = SEV_CONFIG[sev];
              const count = analysis.summary[sev];
              return (
                <button key={sev} onClick={() => setSeverityFilter(severityFilter === sev ? 'all' : sev)}
                  className={`rounded-xl border p-4 text-center transition-colors ${severityFilter === sev ? `${cfg.bg} ${cfg.border}` : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700'}`}>
                  <div className={`text-2xl font-bold ${cfg.text}`}>{count}</div>
                  <div className="text-[11px] text-zinc-500 mt-1">{cfg.label}</div>
                </button>
              );
            })}
          </div>

          {/* AI recommendations button */}
          {analysis.summary.totalDecaying > 0 && !analysis.decayingPages.some(p => p.refreshRecommendation) && (
            <button onClick={generateRecommendations} disabled={generatingRecs}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-purple-600/10 border border-purple-500/20 text-purple-300 hover:bg-purple-600/20 transition-colors text-xs font-medium disabled:opacity-50">
              <Sparkles className={`w-4 h-4 ${generatingRecs ? 'animate-pulse' : ''}`} />
              {generatingRecs ? 'Generating AI refresh recommendations...' : 'Generate AI Refresh Recommendations'}
            </button>
          )}

          {/* Decaying pages list */}
          {filtered.length > 0 && (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-300">
                  {severityFilter === 'all' ? 'All Declining Pages' : `${SEV_CONFIG[severityFilter].label} Pages`}
                </span>
                <span className="text-[11px] text-zinc-500">{filtered.length} pages</span>
              </div>
              <div className="divide-y divide-zinc-800/50 max-h-[500px] overflow-y-auto">
                {filtered.map(page => {
                  const cfg = SEV_CONFIG[page.severity];
                  const isExpanded = expandedPages.has(page.page);
                  return (
                    <div key={page.page}>
                      <button onClick={() => togglePage(page.page)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/30 transition-colors text-left">
                        <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${cfg.bg}`}>
                          <cfg.icon className={`w-3.5 h-3.5 ${cfg.text}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-zinc-300 truncate">{page.page}</div>
                          <div className="flex items-center gap-3 mt-0.5">
                            <span className="text-[11px] text-red-400 flex items-center gap-0.5">
                              <ArrowDown className="w-3 h-3" /> {page.clickDeclinePct}% clicks
                            </span>
                            <span className="text-[11px] text-zinc-500">
                              {page.previousClicks} → {page.currentClicks}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 flex-shrink-0 text-right">
                          <div>
                            <div className={`text-xs font-mono ${page.positionChange > 0 ? 'text-red-400' : page.positionChange < 0 ? 'text-green-400' : 'text-zinc-500'}`}>
                              {page.positionChange > 0 ? <ArrowDown className="w-3 h-3 inline" /> : page.positionChange < 0 ? <ArrowUp className="w-3 h-3 inline" /> : null}
                              {' '}{Math.abs(page.positionChange)} pos
                            </div>
                            <div className="text-[10px] text-zinc-500">now #{page.currentPosition}</div>
                          </div>
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${cfg.bg} ${cfg.text}`}>{cfg.label}</span>
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="px-4 pb-3 pl-13 space-y-2">
                          <div className="grid grid-cols-3 gap-2 text-center">
                            <div className="bg-zinc-800/50 rounded-lg p-2">
                              <div className="text-[10px] text-zinc-500">Clicks</div>
                              <div className="text-xs font-medium text-red-400">{page.previousClicks} → {page.currentClicks}</div>
                              <div className="text-[10px] text-red-400/70">{page.clickDeclinePct}%</div>
                            </div>
                            <div className="bg-zinc-800/50 rounded-lg p-2">
                              <div className="text-[10px] text-zinc-500">Impressions</div>
                              <div className={`text-xs font-medium ${page.impressionChangePct < 0 ? 'text-amber-400' : 'text-green-400'}`}>{page.previousImpressions} → {page.currentImpressions}</div>
                              <div className={`text-[10px] ${page.impressionChangePct < 0 ? 'text-amber-400/70' : 'text-green-400/70'}`}>{page.impressionChangePct > 0 ? '+' : ''}{page.impressionChangePct}%</div>
                            </div>
                            <div className="bg-zinc-800/50 rounded-lg p-2">
                              <div className="text-[10px] text-zinc-500">Position</div>
                              <div className={`text-xs font-medium ${page.positionChange > 0 ? 'text-red-400' : 'text-green-400'}`}>{page.previousPosition} → {page.currentPosition}</div>
                              <div className={`text-[10px] ${page.positionChange > 0 ? 'text-red-400/70' : 'text-green-400/70'}`}>{page.positionChange > 0 ? '+' : ''}{page.positionChange}</div>
                            </div>
                          </div>
                          {page.refreshRecommendation && (
                            <div className="bg-purple-500/5 border border-purple-500/15 rounded-lg p-3 mt-2">
                              <div className="flex items-center gap-1.5 text-[11px] font-medium text-purple-300 mb-2">
                                <Sparkles className="w-3.5 h-3.5" /> AI Refresh Recommendation
                              </div>
                              <div className="text-[11px] text-zinc-300 leading-relaxed whitespace-pre-wrap">{page.refreshRecommendation}</div>
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
            <div className="text-center py-8 bg-zinc-900 rounded-xl border border-zinc-800">
              <div className="text-green-400 text-sm font-medium">All content performing well</div>
              <p className="text-xs text-zinc-500 mt-1">No pages showing significant traffic decline</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
