import { useState, useEffect } from 'react';
import {
  Loader2, Gauge, Smartphone, Monitor, ChevronDown, ChevronRight,
  Zap, AlertTriangle, Info,
} from 'lucide-react';
import SearchableSelect from './SearchableSelect';

interface CoreWebVitals {
  LCP: number | null;
  FID: number | null;
  CLS: number | null;
  FCP: number | null;
  SI: number | null;
  TBT: number | null;
  TTI: number | null;
}

interface Opportunity {
  id: string;
  title: string;
  description: string;
  savings: string | null;
  score: number;
}

interface Diagnostic {
  id: string;
  title: string;
  description: string;
  displayValue?: string;
}

interface PageSpeedResult {
  url: string;
  page: string;
  strategy: 'mobile' | 'desktop';
  score: number;
  vitals: CoreWebVitals;
  opportunities: Opportunity[];
  diagnostics: Diagnostic[];
  fetchedAt: string;
}

interface SiteSpeedResult {
  siteId: string;
  strategy: 'mobile' | 'desktop';
  pages: PageSpeedResult[];
  averageScore: number;
  averageVitals: CoreWebVitals;
  testedAt: string;
}

interface Props {
  siteId: string;
}

function scoreColor(score: number): string {
  if (score >= 90) return 'text-green-400';
  if (score >= 50) return 'text-amber-400';
  return 'text-red-400';
}

function scoreRing(score: number): string {
  if (score >= 90) return '#22c55e';
  if (score >= 50) return '#eab308';
  return '#ef4444';
}

function formatMs(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function formatCLS(val: number | null): string {
  if (val === null) return '—';
  return val.toFixed(3);
}

function vitalRating(key: string, val: number | null): 'good' | 'needs-improvement' | 'poor' {
  if (val === null) return 'needs-improvement';
  switch (key) {
    case 'LCP': return val <= 2500 ? 'good' : val <= 4000 ? 'needs-improvement' : 'poor';
    case 'FID': return val <= 100 ? 'good' : val <= 300 ? 'needs-improvement' : 'poor';
    case 'CLS': return val <= 0.1 ? 'good' : val <= 0.25 ? 'needs-improvement' : 'poor';
    case 'FCP': return val <= 1800 ? 'good' : val <= 3000 ? 'needs-improvement' : 'poor';
    case 'SI': return val <= 3400 ? 'good' : val <= 5800 ? 'needs-improvement' : 'poor';
    case 'TBT': return val <= 200 ? 'good' : val <= 600 ? 'needs-improvement' : 'poor';
    case 'TTI': return val <= 3800 ? 'good' : val <= 7300 ? 'needs-improvement' : 'poor';
    default: return 'needs-improvement';
  }
}

function ratingColor(r: 'good' | 'needs-improvement' | 'poor'): string {
  return r === 'good' ? 'text-green-400' : r === 'needs-improvement' ? 'text-amber-400' : 'text-red-400';
}

function ratingBg(r: 'good' | 'needs-improvement' | 'poor'): string {
  return r === 'good' ? 'bg-green-500/10 border-green-500/30' : r === 'needs-improvement' ? 'bg-amber-500/10 border-amber-500/30' : 'bg-red-500/10 border-red-500/30';
}

function ScoreRing({ score, size = 80 }: { score: number; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - score / 100);
  const color = scoreRing(score);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
      </svg>
      <div className={`absolute inset-0 flex items-center justify-center text-xl font-bold ${scoreColor(score)}`}>
        {score}
      </div>
    </div>
  );
}

function VitalCard({ label, value, formatted, vitalKey }: { label: string; value: number | null; formatted: string; vitalKey: string }) {
  const rating = vitalRating(vitalKey, value);
  return (
    <div className={`rounded-lg border p-3 ${ratingBg(rating)}`}>
      <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${ratingColor(rating)}`}>{formatted}</div>
    </div>
  );
}

interface WebflowPage {
  id: string;
  title: string;
  slug: string;
}

export function PageSpeedPanel({ siteId }: Props) {
  const [data, setData] = useState<SiteSpeedResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [strategy, setStrategy] = useState<'mobile' | 'desktop'>('mobile');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandedPage, setExpandedPage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<WebflowPage[]>([]);
  const [selectedPage, setSelectedPage] = useState<string>('');
  const [singleResult, setSingleResult] = useState<PageSpeedResult | null>(null);
  const [mode, setMode] = useState<'single' | 'bulk'>('single');

  useEffect(() => {
    fetch(`/api/webflow/pages/${siteId}`)
      .then(r => r.json())
      .then(d => {
        const list = (Array.isArray(d) ? d : []).filter((p: WebflowPage) => !p.title.toLowerCase().includes('password'));
        setPages(list);
        if (list.length > 0) setSelectedPage(list[0].id);
      })
      .catch(() => {});
  }, [siteId]);

  const runBulkTest = (strat: 'mobile' | 'desktop') => {
    setLoading(true);
    setHasRun(true);
    setStrategy(strat);
    setData(null);
    setSingleResult(null);
    setError(null);
    fetch(`/api/webflow/pagespeed/${siteId}?strategy=${strat}&maxPages=3`)
      .then(r => {
        if (!r.ok) throw new Error(`Server error: ${r.status}`);
        return r.json();
      })
      .then(d => {
        if (d.error) { setError(d.error); return; }
        if (d.pages?.length === 0) { setError('No pages could be tested. The Google PageSpeed API may be rate-limited. Add a GOOGLE_PSI_KEY env variable for higher limits.'); return; }
        setData(d);
      })
      .catch(e => setError(e.message || 'PageSpeed analysis failed'))
      .finally(() => setLoading(false));
  };

  const runSingleTest = (strat: 'mobile' | 'desktop') => {
    if (!selectedPage) return;
    const page = pages.find(p => p.id === selectedPage);
    if (!page) return;

    setLoading(true);
    setHasRun(true);
    setStrategy(strat);
    setData(null);
    setSingleResult(null);
    setError(null);

    fetch(`/api/webflow/pagespeed-single/${siteId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageSlug: page.slug, strategy: strat, pageTitle: page.title }),
    })
      .then(async r => {
        const d = await r.json();
        if (!r.ok || d.error) { setError(d.error || 'Test failed'); return; }
        setSingleResult(d);
      })
      .catch(e => setError(e.message || 'PageSpeed analysis failed'))
      .finally(() => setLoading(false));
  };

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Single result view (re-uses same VitalCard / opportunity / diagnostic rendering)
  const renderSingleResult = (result: PageSpeedResult) => (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded text-xs bg-teal-500/10 border border-teal-500/20 text-teal-400">Single Page</span>
          <span className="text-xs text-zinc-500">{result.page}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => runSingleTest(strategy === 'mobile' ? 'desktop' : 'mobile')}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs text-zinc-500 hover:text-zinc-300"
          >
            {strategy === 'mobile' ? <Monitor className="w-3 h-3" /> : <Smartphone className="w-3 h-3" />}
            Test {strategy === 'mobile' ? 'Desktop' : 'Mobile'}
          </button>
          <button
            onClick={() => { setHasRun(false); setSingleResult(null); setData(null); }}
            className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1"
          >
            ← Back
          </button>
        </div>
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-6 bg-zinc-900 rounded-xl p-6 border border-zinc-800">
        <div className="flex flex-col items-center gap-2">
          <ScoreRing score={result.score} size={100} />
          <div className="text-xs text-zinc-500">{strategy === 'mobile' ? 'Mobile' : 'Desktop'}</div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <VitalCard label="LCP" value={result.vitals.LCP} formatted={formatMs(result.vitals.LCP)} vitalKey="LCP" />
          <VitalCard label="FCP" value={result.vitals.FCP} formatted={formatMs(result.vitals.FCP)} vitalKey="FCP" />
          <VitalCard label="CLS" value={result.vitals.CLS} formatted={formatCLS(result.vitals.CLS)} vitalKey="CLS" />
          <VitalCard label="TBT" value={result.vitals.TBT} formatted={formatMs(result.vitals.TBT)} vitalKey="TBT" />
          <VitalCard label="Speed Index" value={result.vitals.SI} formatted={formatMs(result.vitals.SI)} vitalKey="SI" />
          <VitalCard label="TTI" value={result.vitals.TTI} formatted={formatMs(result.vitals.TTI)} vitalKey="TTI" />
        </div>
      </div>

      {result.opportunities.length > 0 && (
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-zinc-400 mb-2">
            <Zap className="w-3 h-3 text-amber-400" /> Opportunities ({result.opportunities.length})
          </div>
          <div className="space-y-1">
            {result.opportunities.map(opp => (
              <div key={opp.id} className="flex items-start gap-3 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800">
                <AlertTriangle className="w-3 h-3 mt-0.5 text-amber-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-zinc-300">{opp.title}</div>
                  <div className="text-[11px] text-zinc-500 mt-0.5 line-clamp-2">{opp.description}</div>
                </div>
                {opp.savings && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 flex-shrink-0">
                    Save {opp.savings}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {result.diagnostics.length > 0 && (
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-zinc-400 mb-2">
            <Info className="w-3 h-3 text-blue-400" /> Diagnostics ({result.diagnostics.length})
          </div>
          <div className="space-y-1">
            {result.diagnostics.map(diag => (
              <div key={diag.id} className="flex items-start gap-3 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800">
                <Info className="w-3 h-3 mt-0.5 text-blue-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-zinc-300">{diag.title}</div>
                  <div className="text-[11px] text-zinc-500 mt-0.5 line-clamp-2">{diag.description}</div>
                </div>
                {diag.displayValue && (
                  <span className="text-[10px] text-zinc-500 flex-shrink-0">{diag.displayValue}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  if (!hasRun) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-5">
        <div className="w-16 h-16 rounded-2xl bg-zinc-900 flex items-center justify-center">
          <Gauge className="w-8 h-8 text-zinc-600" />
        </div>
        <p className="text-zinc-400 text-sm">Core Web Vitals & Performance</p>

        {/* Mode toggle */}
        <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-zinc-900 border border-zinc-800">
          <button
            onClick={() => setMode('single')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${mode === 'single' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            Single Page
          </button>
          <button
            onClick={() => setMode('bulk')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${mode === 'bulk' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            Bulk Test (Top 3)
          </button>
        </div>

        {mode === 'single' ? (
          <div className="w-full max-w-md space-y-3">
            <SearchableSelect
              options={pages.map(p => ({ value: p.id, label: `${p.title} ${p.slug ? `(/${p.slug})` : '(Home)'}` }))}
              value={selectedPage}
              onChange={setSelectedPage}
              placeholder="Search pages..."
              emptyLabel="Select a page to test..."
              size="md"
            />
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => runSingleTest('mobile')}
                disabled={!selectedPage}
                className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors disabled:opacity-40"
                style={{ background: 'var(--brand-mint)', color: '#0f1219' }}
              >
                <Smartphone className="w-4 h-4" /> Test Mobile
              </button>
              <button
                onClick={() => runSingleTest('desktop')}
                disabled={!selectedPage}
                className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors disabled:opacity-40"
              >
                <Monitor className="w-4 h-4" /> Test Desktop
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2 text-center">
            <p className="text-xs text-zinc-600 max-w-md">
              Tests the top 3 most important pages automatically (homepage + key pages).
            </p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => runBulkTest('mobile')}
                className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors"
                style={{ background: 'var(--brand-mint)', color: '#0f1219' }}
              >
                <Smartphone className="w-4 h-4" /> Test Mobile
              </button>
              <button
                onClick={() => runBulkTest('desktop')}
                className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
              >
                <Monitor className="w-4 h-4" /> Test Desktop
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--brand-mint)' }} />
        <p className="text-sm text-zinc-400">Running PageSpeed analysis...</p>
        <p className="text-xs text-zinc-600">{singleResult === null && !data ? 'Testing via Google PageSpeed Insights API' : ''}</p>
        <p className="text-xs text-zinc-700">This may take 30-60 seconds</p>
      </div>
    );
  }

  // Single page result
  if (singleResult) {
    return renderSingleResult(singleResult);
  }

  if (error || !data || data.pages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        {error ? (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 max-w-md text-center">
            <p className="text-red-400 text-sm font-medium mb-1">PageSpeed Analysis Failed</p>
            <p className="text-xs text-red-400/70">{error}</p>
          </div>
        ) : (
          <p className="text-zinc-400 text-sm">No results available</p>
        )}
        <button
          onClick={() => { setHasRun(false); setError(null); }}
          className="px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: 'var(--brand-mint)', color: '#0f1219' }}
        >
          Try Again
        </button>
      </div>
    );
  }

  const v = data.averageVitals;

  return (
    <div className="space-y-5">
      {/* Strategy toggle + re-run */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-zinc-900 border border-zinc-800">
          <button
            onClick={() => { if (strategy !== 'mobile') runBulkTest('mobile'); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              strategy === 'mobile' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Smartphone className="w-3 h-3" /> Mobile
          </button>
          <button
            onClick={() => { if (strategy !== 'desktop') runBulkTest('desktop'); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              strategy === 'desktop' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Monitor className="w-3 h-3" /> Desktop
          </button>
        </div>
        <div className="text-xs text-zinc-600">
          {data.pages.length} pages tested · {new Date(data.testedAt).toLocaleTimeString()}
        </div>
      </div>

      {/* Average score + vitals */}
      <div className="grid grid-cols-[auto_1fr] gap-6 bg-zinc-900 rounded-xl p-6 border border-zinc-800">
        <div className="flex flex-col items-center gap-2">
          <ScoreRing score={data.averageScore} size={100} />
          <div className="text-xs text-zinc-500">Avg Score</div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <VitalCard label="LCP" value={v.LCP} formatted={formatMs(v.LCP)} vitalKey="LCP" />
          <VitalCard label="FCP" value={v.FCP} formatted={formatMs(v.FCP)} vitalKey="FCP" />
          <VitalCard label="CLS" value={v.CLS} formatted={formatCLS(v.CLS)} vitalKey="CLS" />
          <VitalCard label="TBT" value={v.TBT} formatted={formatMs(v.TBT)} vitalKey="TBT" />
          <VitalCard label="Speed Index" value={v.SI} formatted={formatMs(v.SI)} vitalKey="SI" />
          <VitalCard label="TTI" value={v.TTI} formatted={formatMs(v.TTI)} vitalKey="TTI" />
        </div>
      </div>

      {/* Per-page results */}
      <div className="space-y-1">
        {data.pages.map(page => {
          const isOpen = expandedPage === page.url;
          return (
            <div key={page.url} className="rounded-lg border border-zinc-800 overflow-hidden">
              <button
                onClick={() => setExpandedPage(isOpen ? null : page.url)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-900/50 transition-colors text-left"
              >
                {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />}
                <div className={`text-lg font-bold tabular-nums w-10 ${scoreColor(page.score)}`}>{page.score}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-zinc-300 truncate">{page.page}</div>
                  <div className="text-xs text-zinc-600 truncate">{page.url}</div>
                </div>
                <div className="flex items-center gap-3 text-xs text-zinc-500">
                  <span>LCP {formatMs(page.vitals.LCP)}</span>
                  <span>CLS {formatCLS(page.vitals.CLS)}</span>
                  <span>TBT {formatMs(page.vitals.TBT)}</span>
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-zinc-800 bg-zinc-950/50">
                  {/* Page vitals */}
                  <div className="grid grid-cols-6 gap-2 p-4">
                    <VitalCard label="LCP" value={page.vitals.LCP} formatted={formatMs(page.vitals.LCP)} vitalKey="LCP" />
                    <VitalCard label="FCP" value={page.vitals.FCP} formatted={formatMs(page.vitals.FCP)} vitalKey="FCP" />
                    <VitalCard label="CLS" value={page.vitals.CLS} formatted={formatCLS(page.vitals.CLS)} vitalKey="CLS" />
                    <VitalCard label="TBT" value={page.vitals.TBT} formatted={formatMs(page.vitals.TBT)} vitalKey="TBT" />
                    <VitalCard label="SI" value={page.vitals.SI} formatted={formatMs(page.vitals.SI)} vitalKey="SI" />
                    <VitalCard label="TTI" value={page.vitals.TTI} formatted={formatMs(page.vitals.TTI)} vitalKey="TTI" />
                  </div>

                  {/* Opportunities */}
                  {page.opportunities.length > 0 && (
                    <div className="px-4 pb-3">
                      <button
                        onClick={() => toggleExpand(`opp-${page.url}`)}
                        className="flex items-center gap-2 text-xs font-medium text-zinc-400 mb-2"
                      >
                        <Zap className="w-3 h-3 text-amber-400" />
                        Opportunities ({page.opportunities.length})
                        {expanded.has(`opp-${page.url}`) ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      </button>
                      {expanded.has(`opp-${page.url}`) && (
                        <div className="space-y-1 ml-5">
                          {page.opportunities.map(opp => (
                            <div key={opp.id} className="flex items-start gap-3 px-3 py-2 rounded hover:bg-zinc-900/30">
                              <AlertTriangle className="w-3 h-3 mt-0.5 text-amber-400 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="text-xs text-zinc-300">{opp.title}</div>
                                <div className="text-[11px] text-zinc-500 mt-0.5 line-clamp-2">{opp.description}</div>
                              </div>
                              {opp.savings && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 flex-shrink-0">
                                  Save {opp.savings}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Diagnostics */}
                  {page.diagnostics.length > 0 && (
                    <div className="px-4 pb-4">
                      <button
                        onClick={() => toggleExpand(`diag-${page.url}`)}
                        className="flex items-center gap-2 text-xs font-medium text-zinc-400 mb-2"
                      >
                        <Info className="w-3 h-3 text-blue-400" />
                        Diagnostics ({page.diagnostics.length})
                        {expanded.has(`diag-${page.url}`) ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      </button>
                      {expanded.has(`diag-${page.url}`) && (
                        <div className="space-y-1 ml-5">
                          {page.diagnostics.map(diag => (
                            <div key={diag.id} className="flex items-start gap-3 px-3 py-2 rounded hover:bg-zinc-900/30">
                              <Info className="w-3 h-3 mt-0.5 text-blue-400 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="text-xs text-zinc-300">{diag.title}</div>
                                <div className="text-[11px] text-zinc-500 mt-0.5 line-clamp-2">{diag.description}</div>
                              </div>
                              {diag.displayValue && (
                                <span className="text-[10px] text-zinc-500 flex-shrink-0">{diag.displayValue}</span>
                              )}
                            </div>
                          ))}
                        </div>
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
  );
}

export default PageSpeedPanel;
