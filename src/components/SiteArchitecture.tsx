import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Loader2, ChevronRight, ChevronDown, Globe, FileText, Target,
  AlertTriangle, Map, RefreshCw, ArrowUpRight, Layers, Code2, CheckCircle2, XCircle,
  Zap, Link2,
} from 'lucide-react';
import { SectionCard, StatCard, Badge, EmptyState, PageHeader } from './ui';
import { themeColor } from './ui/constants';
import { siteArchitecture } from '../api/content';

// ── Schema coverage types ──

type SchemaPriority = 'critical' | 'high' | 'medium' | 'low' | 'done';

interface SchemaCoveragePage {
  path: string;
  name: string;
  hasSchema: boolean;
  schemaTypes: string[];
  role: string | null;
  depth: number;
  pageType: string | null;
  inboundLinks: number | null;
  outboundLinks: number | null;
  isOrphan: boolean | null;
  linkScore: number | null;
  priority: SchemaPriority;
}

interface PriorityQueueItem {
  path: string;
  name: string;
  hasSchema: boolean;
  schemaTypes: string[];
  priority: SchemaPriority;
  inboundLinks: number | null;
  isOrphan: boolean | null;
  linkScore: number | null;
}

interface SchemaCoverageData {
  totalExisting: number;
  withSchema: number;
  withoutSchema: number;
  coveragePct: number;
  snapshotDate: string | null;
  hasPlan: boolean;
  hasLinkData: boolean;
  pages: SchemaCoveragePage[];
  priorityQueue: PriorityQueueItem[];
}

const PRIORITY_BADGE: Record<SchemaPriority, { label: string; color: 'red' | 'amber' | 'blue' | 'zinc' | 'emerald' }> = {
  critical: { label: 'Critical', color: 'red' },
  high: { label: 'High', color: 'amber' },
  medium: { label: 'Medium', color: 'blue' },
  low: { label: 'Low', color: 'zinc' },
  done: { label: 'Done', color: 'emerald' },
};

// ── Types (mirrors server/site-architecture.ts) ──

interface SiteNode {
  path: string;
  name: string;
  pageType?: string;
  source: 'existing' | 'planned' | 'strategy' | 'gap';
  keyword?: string;
  seoTitle?: string;
  seoDescription?: string;
  matrixId?: string;
  cellId?: string;
  children: SiteNode[];
  depth: number;
  hasContent: boolean;
}

interface ArchitectureGap {
  parentPath: string;
  suggestedPath: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
}

interface SiteArchitectureResult {
  tree: SiteNode;
  totalPages: number;
  existingPages: number;
  plannedPages: number;
  strategyPages: number;
  gaps: ArchitectureGap[];
  depthDistribution: Record<number, number>;
  orphanPaths: string[];
  analyzedAt: string;
}

// ── Source badge helpers ──

const SOURCE_BADGE: Record<string, { label: string; color: 'emerald' | 'blue' | 'zinc' }> = {
  existing: { label: 'Live', color: 'emerald' },
  planned: { label: 'Planned', color: 'blue' },
  strategy: { label: 'Strategy', color: 'blue' },
  gap: { label: 'Gap', color: 'zinc' },
};

const PRIORITY_COLOR: Record<string, 'red' | 'amber' | 'zinc'> = {
  high: 'red',
  medium: 'amber',
  low: 'zinc',
};

// ── Tree node component ──

function TreeNode({ node, defaultExpanded, coverageMap }: { node: SiteNode; defaultExpanded?: boolean; coverageMap?: Record<string, SchemaCoveragePage> }) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? node.depth < 2);
  const hasChildren = node.children.length > 0;
  const badge = SOURCE_BADGE[node.source] || SOURCE_BADGE.gap;
  const cov = coverageMap?.[node.path];

  return (
    <div>
      <button
        onClick={() => hasChildren && setExpanded(!expanded)}
        className={`w-full flex items-center gap-2 px-3 py-2 text-left rounded-lg transition-colors group ${
          hasChildren ? 'hover:bg-zinc-800/50 cursor-pointer' : 'cursor-default'
        } ${!node.hasContent ? 'opacity-60' : ''}`}
        style={{ paddingLeft: `${node.depth * 20 + 12}px` }}
      >
        {hasChildren ? (
          expanded ? <ChevronDown className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
        ) : (
          <FileText className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" />
        )}

        <span className="text-xs font-medium text-zinc-200 truncate flex-1">{node.name}</span>

        {node.keyword && (
          <span className="text-[10px] text-zinc-500 truncate max-w-[150px] hidden sm:block" title={node.keyword}>
            <Target className="w-2.5 h-2.5 inline mr-0.5 -mt-px" />{node.keyword}
          </span>
        )}

        <Badge label={badge.label} color={badge.color} />

        {cov && (
          cov.hasSchema ? (
            <span className="flex items-center gap-0.5 text-[10px] text-emerald-400" title={`Schema: ${cov.schemaTypes.join(', ')}`}>
              <CheckCircle2 className="w-3 h-3" />
              <span className="hidden lg:inline">{cov.schemaTypes.length}</span>
            </span>
          ) : (
            <span className="flex items-center gap-0.5 text-[10px] text-zinc-600" title="No schema">
              <XCircle className="w-3 h-3" />
            </span>
          )
        )}

        <span className="text-[10px] text-zinc-600 font-mono min-w-0 truncate hidden md:block max-w-[160px]" title={node.path}>
          {node.path}
        </span>

        {hasChildren && (
          <span className="text-[10px] text-zinc-600 flex-shrink-0">
            {node.children.length}
          </span>
        )}
      </button>

      {expanded && hasChildren && (
        <div>
          {node.children.map(child => (
            <TreeNode key={child.path} node={child} coverageMap={coverageMap} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Depth distribution bar chart ──

function DepthChart({ distribution }: { distribution: Record<number, number> }) {
  const entries = Object.entries(distribution).map(([k, v]) => ({ depth: Number(k), count: v })).sort((a, b) => a.depth - b.depth);
  const maxCount = Math.max(...entries.map(e => e.count), 1);

  return (
    <div className="space-y-1.5">
      {entries.map(e => (
        <div key={e.depth} className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-500 w-16 text-right flex-shrink-0">Depth {e.depth}</span>
          <div className="flex-1 h-4 bg-zinc-800 rounded overflow-hidden">
            <div
              className="h-full bg-teal-500/30 rounded"
              style={{ width: `${(e.count / maxCount) * 100}%` }}
            />
          </div>
          <span className="text-[10px] text-zinc-400 w-8 text-right tabular-nums">{e.count}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main component ──

interface SiteArchitectureProps {
  workspaceId: string;
}

export function SiteArchitecture({ workspaceId }: SiteArchitectureProps) {
  const [data, setData] = useState<SiteArchitectureResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'existing' | 'planned' | 'strategy' | 'gap'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [coverage, setCoverage] = useState<SchemaCoverageData | null>(null);

  const loadCoverage = useCallback(async () => {
    try {
      const result = await siteArchitecture.schemaCoverage(workspaceId);
      setCoverage(result);
    } catch (err) { console.error('SiteArchitecture operation failed:', err); }
  }, [workspaceId]);

  const coverageMap = useMemo((): Record<string, SchemaCoveragePage> | undefined => {
    if (!coverage) return undefined;
    const m: Record<string, SchemaCoveragePage> = {};
    for (const p of coverage.pages) m[p.path] = p;
    return m;
  }, [coverage]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await siteArchitecture.get(workspaceId) as SiteArchitectureResult;
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load site architecture');
    }
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { load(); loadCoverage(); }, [workspaceId, load, loadCoverage]);

  // Filter tree nodes recursively
  const filteredTree = useMemo(() => {
    if (!data) return null;
    function walk(node: SiteNode): SiteNode | null {
      const matchesFilter = filter === 'all' || node.source === filter;
      const q = searchQuery.toLowerCase();
      const matchesSearch = !q ||
        node.name.toLowerCase().includes(q) ||
        node.path.toLowerCase().includes(q) ||
        (node.keyword?.toLowerCase().includes(q));

      const filteredChildren = node.children.map(walk).filter((c): c is SiteNode => c !== null);

      if ((matchesFilter && matchesSearch) || filteredChildren.length > 0) {
        return { ...node, children: filteredChildren };
      }
      return null;
    }
    return walk(data.tree);
  }, [data, filter, searchQuery]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-24 gap-3">
        <Loader2 className="w-5 h-5 animate-spin text-teal-400" />
        <span className="text-sm text-zinc-400">Building site architecture…</span>
      </div>
    );
  }

  if (error && !data) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Failed to load architecture"
        description={error}
        action={
          <button onClick={load} className="text-xs px-3 py-1.5 rounded-lg bg-teal-500/10 text-teal-400 hover:bg-teal-500/15 transition-colors">
            Retry
          </button>
        }
      />
    );
  }

  if (!data) {
    return (
      <EmptyState
        icon={Map}
        title="No architecture data"
        description="Click 'Analyze' to build a visual URL tree from your Webflow pages, planned content, and keyword strategy."
        action={
          <button onClick={load} className="text-xs px-3 py-1.5 rounded-lg bg-teal-500/10 text-teal-400 hover:bg-teal-500/15 transition-colors">
            Analyze Site Architecture
          </button>
        }
      />
    );
  }


  return (
    <div className="space-y-8">
      <PageHeader
        title="Site Architecture"
        subtitle={`${data.totalPages} pages · Analyzed ${new Date(data.analyzedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}
        icon={<Map className="w-5 h-5 text-teal-400" />}
        actions={
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-teal-500/10 text-teal-400 hover:bg-teal-500/15 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Analyzing…' : 'Re-analyze'}
          </button>
        }
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard label="Total Pages" value={data.totalPages} icon={Layers} iconColor="#2dd4bf" size="hero" staggerIndex={0} />
        <StatCard label="Live Pages" value={data.existingPages} icon={Globe} iconColor="#4ade80" sub={`${Math.round((data.existingPages / (data.totalPages || 1)) * 100)}% of total`} size="hero" staggerIndex={1} />
        <StatCard label="Planned" value={data.plannedPages} icon={FileText} iconColor="#60a5fa" sub="From content matrices" size="hero" staggerIndex={2} />
        <StatCard label="Strategy" value={data.strategyPages} icon={Target} iconColor="#a78bfa" sub="From keyword map" size="hero" staggerIndex={3} />
        <StatCard
          label="Gaps Found"
          value={data.gaps.length}
          icon={AlertTriangle}
          iconColor={data.gaps.length > 0 ? '#fbbf24' : themeColor('#71717a', '#94a3b8')}
          sub={data.orphanPaths.length > 0 ? `${data.orphanPaths.length} orphan${data.orphanPaths.length !== 1 ? 's' : ''}` : 'No orphans'}
          size="hero"
          staggerIndex={4}
        />
        {coverage && (
          <StatCard
            label="Schema Coverage"
            value={`${coverage.coveragePct}%`}
            icon={Code2}
            iconColor={coverage.coveragePct >= 80 ? '#4ade80' : coverage.coveragePct >= 50 ? '#fbbf24' : '#ef4444'}
            sub={`${coverage.withSchema}/${coverage.totalExisting} pages`}
            size="hero"
            staggerIndex={5}
          />
        )}
      </div>

      {/* Gaps alert */}
      {data.gaps.length > 0 && (
        <SectionCard
          title="Architecture Gaps"
          titleIcon={<AlertTriangle className="w-4 h-4 text-amber-400" />}
          titleExtra={<Badge label={`${data.gaps.length}`} color="amber" />}
          noPadding
        >
          <div className="divide-y divide-zinc-800/50">
            {data.gaps.map((gap, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-3">
                <Badge label={gap.priority} color={PRIORITY_COLOR[gap.priority] || 'zinc'} className="mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-zinc-200 font-mono">{gap.suggestedPath}</div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">{gap.reason}</div>
                </div>
                <ArrowUpRight className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0 mt-0.5" />
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Orphan pages */}
      {data.orphanPaths.length > 0 && (
        <SectionCard
          title="Orphan Pages"
          titleIcon={<AlertTriangle className="w-4 h-4 text-red-400" />}
          titleExtra={<Badge label={`${data.orphanPaths.length}`} color="red" />}
        >
          <div className="space-y-1">
            {data.orphanPaths.map(p => (
              <div key={p} className="text-xs font-mono text-zinc-400 px-2 py-1 rounded bg-zinc-800/50">{p}</div>
            ))}
          </div>
          <p className="text-[11px] text-zinc-500 mt-3">
            Orphan pages have content but their parent directory has no hub/landing page, making them harder for search engines to discover.
          </p>
        </SectionCard>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
        {/* URL Tree */}
        <SectionCard
          title="URL Tree"
          titleIcon={<Globe className="w-4 h-4 text-teal-400" />}
          className="lg:col-span-3"
          noPadding
        >
          {/* Filters */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
            <input
              type="text"
              placeholder="Search pages…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-500/50"
            />
            <div className="flex items-center gap-1">
              {(['all', 'existing', 'planned', 'strategy', 'gap'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`text-[11px] px-2 py-1 rounded-md font-medium transition-colors ${
                    filter === f
                      ? 'bg-teal-500/15 text-teal-300 border border-teal-500/30'
                      : 'text-zinc-500 hover:text-zinc-300 border border-transparent'
                  }`}
                >
                  {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Tree */}
          <div className="max-h-[600px] overflow-y-auto">
            {filteredTree ? (
              filteredTree.children.length > 0 ? (
                <div className="py-1">
                  {filteredTree.children.map((child: SiteNode) => (
                    <TreeNode key={child.path} node={child} defaultExpanded={child.depth < 2} coverageMap={coverageMap} />
                  ))}
                </div>
              ) : (
                <div className="py-12 text-center text-xs text-zinc-500">No pages match the current filter.</div>
              )
            ) : (
              <div className="py-12 text-center text-xs text-zinc-500">No pages match the current filter.</div>
            )}
          </div>
        </SectionCard>

        {/* Sidebar: Coverage + Depth */}
        <div className="space-y-6">
        {coverage && coverage.priorityQueue.length > 0 && (
          <SectionCard
            title="Schema Priority Queue"
            titleIcon={<Zap className="w-4 h-4 text-amber-400" />}
            titleExtra={<Badge label={`${coverage.priorityQueue.length}`} color="amber" />}
            noPadding
          >
            <div className="max-h-[280px] overflow-y-auto divide-y divide-zinc-800/50">
              {coverage.priorityQueue.map(p => {
                const pb = PRIORITY_BADGE[p.priority];
                return (
                  <div key={p.path} className="flex items-center gap-2 px-4 py-2">
                    {p.hasSchema ? (
                      <Link2 className="w-3 h-3 text-zinc-600 flex-shrink-0" />
                    ) : (
                      <XCircle className="w-3 h-3 text-zinc-600 flex-shrink-0" />
                    )}
                    <span className="text-xs text-zinc-300 truncate flex-1" title={p.path}>{p.name}</span>
                    <Badge label={pb.label} color={pb.color} />
                    {p.isOrphan && (
                      <span className="text-[10px] text-red-400" title="Orphan page — no inbound links">orphan</span>
                    )}
                    {p.inboundLinks !== null && !p.isOrphan && (
                      <span className="text-[10px] text-zinc-600" title={`${p.inboundLinks} inbound links`}>
                        {p.inboundLinks} in
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            {coverage.hasLinkData && (
              <div className="px-4 py-2 border-t border-zinc-800 text-[11px] text-zinc-500">
                Priority based on schema coverage + internal link health. Critical = orphan + no schema.
              </div>
            )}
          </SectionCard>
        )}

        <SectionCard
          title="Depth Distribution"
          titleIcon={<Layers className="w-4 h-4 text-teal-400" />}
        >
          <DepthChart distribution={data.depthDistribution} />
          <p className="text-[11px] text-zinc-500 mt-4">
            Ideal site architecture keeps most pages within 3 clicks of the homepage (depth ≤ 3).
          </p>
          {Object.keys(data.depthDistribution).some(d => Number(d) > 3) && (
            <div className="mt-3 flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/15">
              <AlertTriangle className="w-3 h-3 text-amber-400 flex-shrink-0 mt-0.5" />
              <span className="text-[11px] text-amber-300">
                Some pages are deeper than 3 levels. Consider adding hub pages to flatten the hierarchy.
              </span>
            </div>
          )}
        </SectionCard>
        </div>
      </div>
    </div>
  );
}
