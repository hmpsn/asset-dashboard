import { useState, useEffect } from 'react';
import {
  Loader2, BarChart3, ChevronDown, ChevronRight, Search, Images, ArrowRight, Layers,
} from 'lucide-react';
import { pageWeight as pageWeightApi } from '../api/seo';
import { EmptyState, Icon, Button } from './ui';

interface PageAsset {
  id: string;
  name: string;
  size: number;
  contentType: string;
}

interface PageData {
  page: string;
  totalSize: number;
  assetCount: number;
  assets: PageAsset[];
}

interface PageWeightResult {
  totalPages: number;
  totalAssetSize: number;
  pages: PageData[];
}

interface Props {
  siteId: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getSizeColor(bytes: number): string {
  if (bytes > 5 * 1024 * 1024) return 'text-red-400';
  if (bytes > 2 * 1024 * 1024) return 'text-orange-400';
  if (bytes > 1 * 1024 * 1024) return 'text-amber-400';
  return 'text-emerald-400';
}

function getBarWidth(size: number, max: number): number {
  if (max === 0) return 0;
  return Math.max(2, Math.round((size / max) * 100));
}

function getBarColor(bytes: number): string {
  if (bytes > 5 * 1024 * 1024) return 'bg-red-500';
  if (bytes > 2 * 1024 * 1024) return 'bg-orange-500';
  if (bytes > 1 * 1024 * 1024) return 'bg-amber-500';
  return 'bg-emerald-500';
}

function PageWeight({ siteId }: Props) {
  const [data, setData] = useState<PageWeightResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'page' | 'cms' | 'css'>('all');
  const [error, setError] = useState<string | null>(null);

  const runAnalysis = () => {
    setLoading(true);
    setHasRun(true);
    setError(null);
    pageWeightApi.webflowPageWeight(siteId)
      .then(d => setData(d as PageWeightResult))
      .catch(e => setError(e instanceof Error ? e.message : 'Page weight analysis failed'))
      .finally(() => setLoading(false));
  };

  // Load last saved snapshot on site change
  useEffect(() => {
    let cancelled = false;
    setData(null); setHasRun(false); setError(null);
    pageWeightApi.webflowPageWeightSnapshot(siteId)
      .then(snap => {
        const s = snap as { result?: PageWeightResult } | null;
        if (!cancelled && s?.result) { setData(s.result); setHasRun(true); }
      })
      .catch((err) => { console.error('PageWeight operation failed:', err); });
    return () => { cancelled = true; };
  }, [siteId]);

  const toggleExpand = (page: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(page)) next.delete(page); else next.add(page);
      return next;
    });
  };

  if (!hasRun) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="w-16 h-16 rounded-2xl bg-[var(--surface-2)] flex items-center justify-center">
          <Icon as={BarChart3} size="2xl" className="text-[var(--brand-text-muted)]" />
        </div>
        <p className="text-[var(--brand-text)] text-sm">Analyze image weight per page</p>
        <p className="text-xs text-[var(--brand-text-muted)]">See which pages load the most image data</p>
        <Button variant="primary" onClick={runAnalysis}>
          Analyze Page Weight
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-[var(--brand-text-muted)]">
        <Loader2 className="w-6 h-6 animate-spin text-teal-400" />
        <p className="text-sm">Scanning published pages for image weight...</p>
        <p className="text-xs text-[var(--brand-text-muted)]">This may take 30–60 seconds</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        {error ? (
          <div className="bg-red-500/10 border border-red-500/30 rounded-[var(--radius-lg)] px-4 py-3 max-w-md text-center">
            <p className="text-red-400 text-sm font-medium mb-1">Page Weight Analysis Failed</p>
            <p className="text-xs text-red-400/70">{error}</p>
          </div>
        ) : (
          <EmptyState icon={Layers} title="No results available" description="Run a page weight analysis to see resource metrics." className="py-4" />
        )}
        <Button variant="primary" onClick={() => { setHasRun(false); setError(null); }}>
          Try Again
        </Button>
      </div>
    );
  }

  const maxSize = data.pages.length > 0 ? data.pages[0].totalSize : 0;

  const filteredPages = data.pages
    .filter(p => {
      if (filter === 'page') return p.page.startsWith('page:');
      if (filter === 'cms') return p.page.startsWith('cms:');
      if (filter === 'css') return p.page.startsWith('css:');
      return true;
    })
    .filter(p => {
      if (!search) return true;
      const q = search.toLowerCase();
      return p.page.toLowerCase().includes(q) || p.assets.some(a => a.name.toLowerCase().includes(q));
    });

  const heavyPages = data.pages.filter(p => p.totalSize > 2 * 1024 * 1024).length;

  return (
    <div className="space-y-8">
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-[var(--surface-2)] p-5 border border-[var(--brand-border)] rounded-[var(--radius-signature)]">
          <div className="text-3xl font-bold text-[var(--brand-text-bright)]">{data.totalPages}</div>
          <div className="text-xs text-[var(--brand-text-muted)] mt-1">Pages with Assets</div>
        </div>
        <div className="bg-[var(--surface-2)] p-5 border border-[var(--brand-border)] rounded-[var(--radius-signature)]">
          <div className="text-3xl font-bold text-[var(--brand-text-bright)]">{formatSize(data.totalAssetSize)}</div>
          <div className="text-xs text-[var(--brand-text-muted)] mt-1">Total Asset Size</div>
        </div>
        <div className="bg-[var(--surface-2)] p-5 border border-[var(--brand-border)] rounded-[var(--radius-signature)]">
          <div className={`text-3xl font-bold ${heavyPages > 0 ? 'text-orange-400' : 'text-emerald-400'}`}>{heavyPages}</div>
          <div className="text-xs text-[var(--brand-text-muted)] mt-1">Heavy Pages (&gt;2MB)</div>
        </div>
        <div className="bg-[var(--surface-2)] p-5 border border-[var(--brand-border)] rounded-[var(--radius-signature)]">
          <div className="text-3xl font-bold text-[var(--brand-text-bright)]">
            {data.pages.length > 0 ? formatSize(Math.round(data.pages.reduce((s, p) => s + p.totalSize, 0) / data.pages.length)) : '0'}
          </div>
          <div className="text-xs text-[var(--brand-text-muted)] mt-1">Avg Page Weight</div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="sticky top-0 z-10 bg-[var(--surface-1)]/95 backdrop-blur-sm py-2">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Icon as={Search} size="md" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--brand-text-muted)]" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search pages or assets..."
              className="w-full pl-10 pr-4 py-2 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] text-sm focus:outline-none focus:border-[var(--brand-border-hover)]"
            />
          </div>
          <div className="relative">
            <select
              value={filter}
              onChange={e => setFilter(e.target.value as typeof filter)}
              className="appearance-none pl-3 pr-8 py-2 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] text-sm focus:outline-none cursor-pointer"
            >
              <option value="all">All Sources</option>
              <option value="page">Pages Only</option>
              <option value="cms">CMS Only</option>
              <option value="css">CSS Only</option>
            </select>
            <Icon as={ChevronDown} size="sm" className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--brand-text-muted)] pointer-events-none" />
          </div>
          <Button variant="secondary" size="sm" onClick={runAnalysis}>
            Re-scan
          </Button>
        </div>
      </div>

      {/* Page list */}
      <div className="space-y-2">
        {filteredPages.map(page => (
          // pr-check-disable-next-line -- brand asymmetric signature on page-weight result card; intentional non-SectionCard chrome
          <div key={page.page} className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden rounded-[var(--radius-signature-lg)]">
            <button
              onClick={() => toggleExpand(page.page)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface-3)]/50 transition-colors text-left"
            >
              {expanded.has(page.page) ? (
                <Icon as={ChevronDown} size="sm" className="text-[var(--brand-text-muted)] flex-shrink-0" />
              ) : (
                <Icon as={ChevronRight} size="sm" className="text-[var(--brand-text-muted)] flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[var(--brand-text-bright)] truncate">{page.page}</div>
                <div className="mt-1.5 h-1.5 bg-[var(--surface-3)] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${getBarColor(page.totalSize)}`}
                    style={{ width: `${getBarWidth(page.totalSize, maxSize)}%` }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-4 flex-shrink-0">
                <span className="text-xs text-[var(--brand-text-muted)]">{page.assetCount} asset{page.assetCount !== 1 ? 's' : ''}</span>
                <span className={`text-sm font-medium tabular-nums ${getSizeColor(page.totalSize)}`}>
                  {formatSize(page.totalSize)}
                </span>
              </div>
            </button>

            {expanded.has(page.page) && (
              <div className="ml-8 mb-2 space-y-0.5">
                {page.assets.map(asset => (
                  <div key={asset.id} className="flex items-center gap-3 px-4 py-1.5 text-xs">
                    <div className="flex-1 min-w-0 text-[var(--brand-text-muted)] truncate">{asset.name}</div>
                    <span className="text-[var(--brand-text-muted)] flex-shrink-0">{asset.contentType.split('/')[1] || ''}</span>
                    <span className={`tabular-nums flex-shrink-0 ${asset.size > 500 * 1024 ? 'text-orange-400' : 'text-[var(--brand-text-muted)]'}`}>
                      {formatSize(asset.size)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {/* Cross-link tip: Asset Manager */}
      {heavyPages > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-lg)] bg-teal-500/5 border border-teal-500/20 text-xs text-teal-300">
          <Icon as={Images} size="sm" className="flex-shrink-0" />
          <span className="flex-1"><strong>{heavyPages} heavy page{heavyPages !== 1 ? 's' : ''}</strong> found. Use the <strong>Asset Manager</strong> tab to compress images and reduce page weight.</span>
          <Icon as={ArrowRight} size="sm" className="flex-shrink-0 text-teal-400" />
        </div>
      )}
    </div>
  );
}

export { PageWeight };
