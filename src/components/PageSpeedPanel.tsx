import { useState, useEffect, useRef } from 'react';
import {
  Loader2, Gauge, Smartphone, Monitor, ChevronDown, ChevronRight,
  Zap, AlertTriangle, Info,
} from 'lucide-react';
import SearchableSelect from './SearchableSelect';
import { MetricRing, EmptyState, Icon, Button, PageHeader, ClickableRow } from './ui';
import { pageWeight, webflow } from '../api/seo';

interface CoreWebVitals {
  LCP: number | null;
  FID: number | null;
  CLS: number | null;
  FCP: number | null;
  INP: number | null;
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
  fieldDataAvailable?: boolean;
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
  workspaceId?: string;
}

function scoreColor(score: number): string {
  if (score >= 90) return 'text-accent-success';
  if (score >= 50) return 'text-accent-warning';
  return 'text-accent-danger';
}

// scoreRing replaced by MetricRing from ./ui

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
    case 'INP': return val <= 200 ? 'good' : val <= 500 ? 'needs-improvement' : 'poor';
    case 'CLS': return val <= 0.1 ? 'good' : val <= 0.25 ? 'needs-improvement' : 'poor';
    case 'FCP': return val <= 1800 ? 'good' : val <= 3000 ? 'needs-improvement' : 'poor';
    case 'SI': return val <= 3400 ? 'good' : val <= 5800 ? 'needs-improvement' : 'poor';
    case 'TBT': return val <= 200 ? 'good' : val <= 600 ? 'needs-improvement' : 'poor';
    case 'TTI': return val <= 3800 ? 'good' : val <= 7300 ? 'needs-improvement' : 'poor';
    default: return 'needs-improvement';
  }
}

function ratingColor(r: 'good' | 'needs-improvement' | 'poor'): string {
  return r === 'good' ? 'text-accent-success' : r === 'needs-improvement' ? 'text-accent-warning' : 'text-accent-danger';
}

function ratingBg(r: 'good' | 'needs-improvement' | 'poor'): string {
  return r === 'good' ? 'bg-emerald-500/10 border-emerald-500/30' : r === 'needs-improvement' ? 'bg-amber-500/10 border-amber-500/30' : 'bg-red-500/10 border-red-500/30';
}

// ScoreRing replaced by unified <MetricRing /> from ./ui

function VitalCard({ label, value, formatted, vitalKey }: { label: string; value: number | null; formatted: string; vitalKey: string }) {
  const rating = vitalRating(vitalKey, value);
  return (
    <div className={`rounded-[var(--radius-lg)] border p-3 ${ratingBg(rating)}`}>
      <div className="t-caption-sm text-[var(--brand-text-muted)] uppercase tracking-wider mb-1">{label}</div>
      <div className={`t-stat-sm tabular-nums ${ratingColor(rating)}`}>{formatted}</div>
    </div>
  );
}

interface WebflowPage {
  id: string;
  title: string;
  slug: string;
  publishedPath?: string | null;
}

export function PageSpeedPanel({ siteId, workspaceId }: Props) {
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
  const bulkRunInFlightRef = useRef(false);
  const bulkRunVersionRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    webflow.pages(siteId, workspaceId)
      .then(d => {
        if (cancelled) return;
        const list = (Array.isArray(d) ? d as WebflowPage[] : []).filter((p: WebflowPage) => !p.title.toLowerCase().includes('password'));
        setPages(list);
        if (list.length > 0) setSelectedPage(list[0].id);
      })
      .catch((err) => { console.error('PageSpeedPanel operation failed:', err); });
    return () => { cancelled = true; };
  }, [siteId, workspaceId]);

  useEffect(() => {
    let cancelled = false;
    const snapshotVersion = bulkRunVersionRef.current;
    pageWeight.pagespeedSnapshot(siteId, workspaceId, strategy)
      .then(snap => {
        if (cancelled || bulkRunInFlightRef.current || snapshotVersion !== bulkRunVersionRef.current) return;
        const s = snap as { result?: SiteSpeedResult } | null;
        if (s?.result) {
          setData(s.result);
          setHasRun(true);
        } else {
          setData(null);
          setHasRun(false);
        }
      })
      .catch((err) => { console.error('PageSpeedPanel operation failed:', err); });
    return () => { cancelled = true; };
  }, [siteId, workspaceId, strategy]);

  const runBulkTest = (strat: 'mobile' | 'desktop') => {
    bulkRunInFlightRef.current = true;
    bulkRunVersionRef.current += 1;
    setLoading(true);
    setHasRun(true);
    setStrategy(strat);
    setData(null);
    setSingleResult(null);
    setError(null);
    pageWeight.pagespeedBulk(siteId, strat, 3, workspaceId)
      .then(d => {
        const result = d as SiteSpeedResult & { error?: string };
        if (result.error) { setError(result.error); return; }
        if ((result as { pages?: unknown[] }).pages?.length === 0) { setError('No pages could be tested. The Google PageSpeed API may be rate-limited. Add a GOOGLE_PSI_KEY env variable for higher limits.'); return; }
        setData(result);
        setHasRun(true);
      })
      .catch(e => setError(e instanceof Error ? e.message : 'PageSpeed analysis failed'))
      .finally(() => {
        bulkRunInFlightRef.current = false;
        setLoading(false);
      });
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

    pageWeight.pagespeedSingle(siteId, { pageId: page.id, pageSlug: page.publishedPath ?? page.slug, strategy: strat, pageTitle: page.title }, workspaceId)
      .then(d => {
        const result = d as PageSpeedResult & { error?: string };
        if (result.error) { setError(result.error); return; }
        setSingleResult(result);
      })
      .catch(e => setError(e instanceof Error ? e.message : 'PageSpeed analysis failed'))
      .finally(() => setLoading(false));
  };

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const pageHeader = (
    <PageHeader
      title="Page Speed"
      subtitle="Core Web Vitals and performance diagnostics."
      icon={<Icon as={Gauge} size="lg" className="text-accent-brand" />}
    />
  );

  // Single result view (re-uses same VitalCard / opportunity / diagnostic rendering)
  const renderSingleResult = (result: PageSpeedResult) => (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded t-caption-sm bg-teal-500/10 border border-teal-500/20 text-accent-brand">Single Page</span>
          <span className="t-caption-sm text-[var(--brand-text-muted)]">{result.page}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            onClick={() => runSingleTest(strategy === 'mobile' ? 'desktop' : 'mobile')}
            variant="ghost"
            size="sm"
            className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]"
          >
            {strategy === 'mobile' ? <Icon as={Monitor} size="sm" /> : <Icon as={Smartphone} size="sm" />}
            Test {strategy === 'mobile' ? 'Desktop' : 'Mobile'}
          </Button>
          <Button
            onClick={() => { setHasRun(false); setSingleResult(null); setData(null); }}
            variant="ghost"
            size="sm"
            className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]"
          >
            ← Back
          </Button>
        </div>
      </div>

      {/* pr-check-disable-next-line -- brand asymmetric signature on PageSpeed score panel; intentional non-SectionCard chrome */}
      <div className="grid grid-cols-[auto_1fr] gap-6 bg-[var(--surface-2)] p-6 border border-[var(--brand-border)] rounded-[var(--radius-signature-lg)]">
        <div className="flex flex-col items-center gap-2">
          <MetricRing score={result.score} size={100} />
          <div className="t-caption-sm text-[var(--brand-text-muted)]">{strategy === 'mobile' ? 'Mobile' : 'Desktop'}</div>
          {result.fieldDataAvailable && <div className="px-1.5 py-0.5 rounded-[var(--radius-sm)] t-micro bg-emerald-500/10 border border-emerald-500/20 text-accent-success">Real users</div>}
          {!result.fieldDataAvailable && <div className="px-1.5 py-0.5 rounded-[var(--radius-sm)] t-micro bg-amber-500/10 border border-amber-500/20 text-accent-warning">Lab test</div>}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <VitalCard label="LCP" value={result.vitals.LCP} formatted={formatMs(result.vitals.LCP)} vitalKey="LCP" />
          <VitalCard label="FCP" value={result.vitals.FCP} formatted={formatMs(result.vitals.FCP)} vitalKey="FCP" />
          <VitalCard label="CLS" value={result.vitals.CLS} formatted={formatCLS(result.vitals.CLS)} vitalKey="CLS" />
          <VitalCard label="INP" value={result.vitals.INP} formatted={formatMs(result.vitals.INP)} vitalKey="INP" />
          <VitalCard label="TBT" value={result.vitals.TBT} formatted={formatMs(result.vitals.TBT)} vitalKey="TBT" />
          <VitalCard label="Speed Index" value={result.vitals.SI} formatted={formatMs(result.vitals.SI)} vitalKey="SI" />
        </div>
      </div>

      {result.opportunities.length > 0 && (
        <div>
          <div className="flex items-center gap-2 t-caption-sm font-medium text-[var(--brand-text)] mb-2">
            <Icon as={Zap} size="sm" className="text-accent-warning" /> Opportunities ({result.opportunities.length})
          </div>
          <div className="space-y-1">
            {result.opportunities.map(opp => (
              <div key={opp.id} className="flex items-start gap-3 px-3 py-2 rounded-[var(--radius-lg)] bg-[var(--surface-2)] border border-[var(--brand-border)]">
                <Icon as={AlertTriangle} size="sm" className="mt-0.5 text-accent-warning flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="t-caption-sm text-[var(--brand-text-bright)]">{opp.title}</div>
                  <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5 line-clamp-2">{opp.description}</div>
                </div>
                {opp.savings && (
                  <span className="t-caption-sm px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-accent-warning flex-shrink-0">
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
          <div className="flex items-center gap-2 t-caption-sm font-medium text-[var(--brand-text)] mb-2">
            <Icon as={Info} size="sm" className="text-accent-info" /> Diagnostics ({result.diagnostics.length})
          </div>
          <div className="space-y-1">
            {result.diagnostics.map(diag => (
              <div key={diag.id} className="flex items-start gap-3 px-3 py-2 rounded-[var(--radius-lg)] bg-[var(--surface-2)] border border-[var(--brand-border)]">
                <Icon as={Info} size="sm" className="mt-0.5 text-accent-info flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="t-caption-sm text-[var(--brand-text-bright)]">{diag.title}</div>
                  <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5 line-clamp-2">{diag.description}</div>
                </div>
                {diag.displayValue && (
                  <span className="t-caption-sm text-[var(--brand-text-muted)] flex-shrink-0">{diag.displayValue}</span>
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
      <div className="space-y-6">
        {pageHeader}
        <div className="flex flex-col items-center justify-center py-12 gap-5">
          <div className="w-16 h-16 rounded-[var(--radius-xl)] bg-[var(--surface-2)] flex items-center justify-center">
            <Icon as={Gauge} size="2xl" className="text-[var(--brand-text-muted)]" />
          </div>
          <p className="text-[var(--brand-text)] t-caption-sm">Core Web Vitals &amp; Performance</p>

        {/* Mode toggle */}
        <div className="flex items-center gap-0.5 p-0.5 rounded-[var(--radius-lg)] bg-[var(--surface-2)] border border-[var(--brand-border)]">
          <Button
            onClick={() => setMode('single')}
            variant="ghost"
            size="sm"
            className={`${mode === 'single' ? 'bg-[var(--surface-3)] text-[var(--brand-text-bright)]' : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]'}`}
          >
            Single Page
          </Button>
          <Button
            onClick={() => setMode('bulk')}
            variant="ghost"
            size="sm"
            className={`${mode === 'bulk' ? 'bg-[var(--surface-3)] text-[var(--brand-text-bright)]' : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]'}`}
          >
            Bulk Test (Top 3)
          </Button>
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
              <Button
                variant="primary"
                onClick={() => runSingleTest('mobile')}
                disabled={!selectedPage}
                icon={Smartphone}
              >
                Test Mobile
              </Button>
              <Button
                variant="secondary"
                onClick={() => runSingleTest('desktop')}
                disabled={!selectedPage}
                icon={Monitor}
              >
                Test Desktop
              </Button>
            </div>
            </div>
          ) : (
            <div className="space-y-2 text-center">
            <p className="t-caption-sm text-[var(--brand-text-muted)] max-w-md">
              Tests the top 3 most important pages automatically (homepage + key pages).
            </p>
            <div className="flex gap-2 justify-center">
              <Button
                variant="primary"
                onClick={() => runBulkTest('mobile')}
                icon={Smartphone}
              >
                Test Mobile
              </Button>
              <Button
                variant="secondary"
                onClick={() => runBulkTest('desktop')}
                icon={Monitor}
              >
                Test Desktop
              </Button>
            </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        {pageHeader}
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-accent-brand" />
          <p className="t-caption-sm text-[var(--brand-text)]">Running PageSpeed analysis...</p>
          <p className="t-caption-sm text-[var(--brand-text-muted)]">Testing via Google PageSpeed Insights API</p>
          <p className="t-caption-sm text-[var(--brand-text-muted)]">This may take 30–60 seconds</p>
        </div>
      </div>
    );
  }

  // Single page result
  if (singleResult) {
    return (
      <div className="space-y-6">
        {pageHeader}
        {renderSingleResult(singleResult)}
      </div>
    );
  }

  if (error || !data || data.pages.length === 0) {
    return (
      <div className="space-y-6">
        {pageHeader}
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          {error ? (
            <div className="bg-red-500/10 border border-red-500/30 rounded-[var(--radius-lg)] px-4 py-3 max-w-md text-center">
              <p className="text-accent-danger t-ui mb-1">PageSpeed Analysis Failed</p>
              <p className="t-caption-sm text-accent-danger">{error}</p>
            </div>
          ) : (
            <EmptyState icon={Zap} title="No results available" description="Run a PageSpeed test to see performance metrics." className="py-4" />
          )}
          <Button variant="primary" onClick={() => { setHasRun(false); setError(null); }}>
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  const v = data.averageVitals;

  return (
    <div className="space-y-8">
      {pageHeader}
      {/* Strategy toggle + re-run */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 p-0.5 rounded-[var(--radius-lg)] bg-[var(--surface-2)] border border-[var(--brand-border)]">
          <Button
            onClick={() => { if (strategy !== 'mobile') runBulkTest('mobile'); }}
            variant="ghost"
            size="sm"
            className={`${
              strategy === 'mobile' ? 'bg-[var(--surface-3)] text-[var(--brand-text-bright)]' : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]'
            }`}
          >
            <Icon as={Smartphone} size="sm" /> Mobile
          </Button>
          <Button
            onClick={() => { if (strategy !== 'desktop') runBulkTest('desktop'); }}
            variant="ghost"
            size="sm"
            className={`${
              strategy === 'desktop' ? 'bg-[var(--surface-3)] text-[var(--brand-text-bright)]' : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]'
            }`}
          >
            <Icon as={Monitor} size="sm" /> Desktop
          </Button>
        </div>
        <div className="t-caption-sm text-[var(--brand-text-muted)]">
          {data.pages.length} pages tested · {new Date(data.testedAt).toLocaleTimeString()}
        </div>
      </div>

      {/* Average score + vitals */}
      {/* pr-check-disable-next-line -- brand asymmetric signature on PageSpeed score panel; intentional non-SectionCard chrome */}
      <div className="grid grid-cols-[auto_1fr] gap-6 bg-[var(--surface-2)] p-6 border border-[var(--brand-border)] rounded-[var(--radius-signature-lg)]">
        <div className="flex flex-col items-center gap-2">
          <MetricRing score={data.averageScore} size={100} />
          <div className="t-caption-sm text-[var(--brand-text-muted)]">Avg Score</div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <VitalCard label="LCP" value={v.LCP} formatted={formatMs(v.LCP)} vitalKey="LCP" />
          <VitalCard label="FCP" value={v.FCP} formatted={formatMs(v.FCP)} vitalKey="FCP" />
          <VitalCard label="CLS" value={v.CLS} formatted={formatCLS(v.CLS)} vitalKey="CLS" />
          <VitalCard label="INP" value={v.INP} formatted={formatMs(v.INP)} vitalKey="INP" />
          <VitalCard label="TBT" value={v.TBT} formatted={formatMs(v.TBT)} vitalKey="TBT" />
          <VitalCard label="Speed Index" value={v.SI} formatted={formatMs(v.SI)} vitalKey="SI" />
        </div>
      </div>

      {/* Per-page results */}
      <div className="space-y-1">
        {data.pages.map(page => {
          const isOpen = expandedPage === page.url;
          return (
            // pr-check-disable-next-line -- brand asymmetric signature on page-level result card; intentional non-SectionCard chrome
            <div key={page.url} className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden rounded-[var(--radius-signature-lg)]">
              <ClickableRow
                onClick={() => setExpandedPage(isOpen ? null : page.url)}
                className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface-2)]/50"
              >
                {isOpen ? <Icon as={ChevronDown} size="md" className="text-[var(--brand-text-muted)]" /> : <Icon as={ChevronRight} size="md" className="text-[var(--brand-text-muted)]" />}
                <div className={`t-stat-sm tabular-nums w-10 ${scoreColor(page.score)}`}>{page.score}</div>
                <div className="flex-1 min-w-0">
                  <div className="t-caption-sm text-[var(--brand-text-bright)] truncate">{page.page}</div>
                  <div className="t-caption-sm text-[var(--brand-text-muted)] truncate">{page.url}</div>
                </div>
                <div className="flex items-center gap-3 t-caption-sm text-[var(--brand-text-muted)]">
                  <span>LCP {formatMs(page.vitals.LCP)}</span>
                  <span>CLS {formatCLS(page.vitals.CLS)}</span>
                  <span>INP {formatMs(page.vitals.INP)}</span>
                </div>
              </ClickableRow>

              {isOpen && (
                <div className="border-t border-[var(--brand-border)] bg-[var(--surface-1)]/50">
                  {/* Page vitals */}
                  <div className="grid grid-cols-6 gap-2 p-4">
                    <VitalCard label="LCP" value={page.vitals.LCP} formatted={formatMs(page.vitals.LCP)} vitalKey="LCP" />
                    <VitalCard label="FCP" value={page.vitals.FCP} formatted={formatMs(page.vitals.FCP)} vitalKey="FCP" />
                    <VitalCard label="CLS" value={page.vitals.CLS} formatted={formatCLS(page.vitals.CLS)} vitalKey="CLS" />
                    <VitalCard label="INP" value={page.vitals.INP} formatted={formatMs(page.vitals.INP)} vitalKey="INP" />
                    <VitalCard label="TBT" value={page.vitals.TBT} formatted={formatMs(page.vitals.TBT)} vitalKey="TBT" />
                    <VitalCard label="SI" value={page.vitals.SI} formatted={formatMs(page.vitals.SI)} vitalKey="SI" />
                  </div>

                  {/* Opportunities */}
                  {page.opportunities.length > 0 && (
                    <div className="px-4 pb-3">
                      <Button
                        onClick={() => toggleExpand(`opp-${page.url}`)}
                        variant="ghost"
                        size="sm"
                        className="text-[var(--brand-text)] mb-2 !px-0"
                      >
                        <Icon as={Zap} size="sm" className="text-accent-warning" />
                        Opportunities ({page.opportunities.length})
                        {expanded.has(`opp-${page.url}`) ? <Icon as={ChevronDown} size="sm" /> : <Icon as={ChevronRight} size="sm" />}
                      </Button>
                      {expanded.has(`opp-${page.url}`) && (
                        <div className="space-y-1 ml-5">
                          {page.opportunities.map(opp => (
                            <div key={opp.id} className="flex items-start gap-3 px-3 py-2 rounded hover:bg-[var(--surface-2)]/30">
                              <Icon as={AlertTriangle} size="sm" className="mt-0.5 text-accent-warning flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="t-caption-sm text-[var(--brand-text-bright)]">{opp.title}</div>
                                <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5 line-clamp-2">{opp.description}</div>
                              </div>
                              {opp.savings && (
                                <span className="t-caption-sm px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-accent-warning flex-shrink-0">
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
                      <Button
                        onClick={() => toggleExpand(`diag-${page.url}`)}
                        variant="ghost"
                        size="sm"
                        className="text-[var(--brand-text)] mb-2 !px-0"
                      >
                        <Icon as={Info} size="sm" className="text-accent-info" />
                        Diagnostics ({page.diagnostics.length})
                        {expanded.has(`diag-${page.url}`) ? <Icon as={ChevronDown} size="sm" /> : <Icon as={ChevronRight} size="sm" />}
                      </Button>
                      {expanded.has(`diag-${page.url}`) && (
                        <div className="space-y-1 ml-5">
                          {page.diagnostics.map(diag => (
                            <div key={diag.id} className="flex items-start gap-3 px-3 py-2 rounded hover:bg-[var(--surface-2)]/30">
                              <Icon as={Info} size="sm" className="mt-0.5 text-accent-info flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="t-caption-sm text-[var(--brand-text-bright)]">{diag.title}</div>
                                <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5 line-clamp-2">{diag.description}</div>
                              </div>
                              {diag.displayValue && (
                                <span className="t-caption-sm text-[var(--brand-text-muted)] flex-shrink-0">{diag.displayValue}</span>
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
