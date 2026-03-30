import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Layers, Eye } from 'lucide-react';
import { PageHeader, EmptyState } from './ui';
import { features as featuresApi } from '../api/misc';
import type { Feature, FeatureCategory, PainPoint, FeatureTier } from '../../shared/types/features';
import { CATEGORY_LABELS as catLabels, PAIN_POINT_LABELS as ppLabels } from '../../shared/types/features';

type ViewMode = 'painPoint' | 'category';

const TIER_STYLES: Record<FeatureTier, string> = {
  free: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/20',
  growth: 'bg-teal-500/15 text-teal-400 border-teal-500/20',
  premium: 'bg-violet-500/15 text-violet-400 border-violet-500/20',
  admin: 'bg-purple-500/15 text-purple-400 border-purple-500/20',
};

const TIER_LABELS: Record<FeatureTier, string> = {
  free: 'Free',
  growth: 'Growth',
  premium: 'Premium',
  admin: 'Admin',
};

const IMPACT_DOT: Record<string, string> = {
  high: 'bg-emerald-400',
  medium: 'bg-amber-400',
};

function FeatureCard({ feature }: { feature: Feature }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 p-4 hover:border-zinc-700 transition-colors" style={{ borderRadius: '6px 12px 6px 12px' }}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold text-zinc-100 leading-tight">{feature.title}</h3>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {feature.impact !== 'low' && (
            <span className={`w-2 h-2 rounded-full ${IMPACT_DOT[feature.impact]}`} title={`${feature.impact} impact`} />
          )}
          {feature.clientFacing && (
            <Eye className="w-3 h-3 text-zinc-500" title="Client-facing" />
          )}
        </div>
      </div>
      <p className="text-xs text-zinc-400 leading-relaxed mb-3">{feature.oneLiner}</p>
      <span className={`inline-flex px-2 py-0.5 text-[10px] font-medium rounded-md border ${TIER_STYLES[feature.tier]}`}>
        {TIER_LABELS[feature.tier]}
      </span>
    </div>
  );
}

export default function FeatureLibrary() {
  const [search, setSearch] = useState('');
  const [view, setView] = useState<ViewMode>('painPoint');

  const { data, isLoading } = useQuery({
    queryKey: ['features'],
    queryFn: featuresApi.get,
    staleTime: 5 * 60 * 1000,
  });

  const allFeatures = data?.features ?? [];

  const filtered = useMemo(() => {
    if (!search.trim()) return allFeatures;
    const q = search.toLowerCase();
    return allFeatures.filter(f =>
      f.title.toLowerCase().includes(q) ||
      f.oneLiner.toLowerCase().includes(q) ||
      f.painPoints.some(pp => ppLabels[pp]?.toLowerCase().includes(q)) ||
      catLabels[f.category]?.toLowerCase().includes(q)
    );
  }, [allFeatures, search]);

  const grouped = useMemo(() => {
    if (view === 'category') {
      const groups: Record<string, Feature[]> = {};
      for (const f of filtered) {
        const key = f.category;
        if (!groups[key]) groups[key] = [];
        groups[key].push(f);
      }
      return Object.entries(groups)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, items]) => ({
          label: catLabels[key as FeatureCategory],
          features: items,
        }));
    }
    const groups: Record<string, Feature[]> = {};
    for (const f of filtered) {
      for (const pp of f.painPoints) {
        if (!groups[pp]) groups[pp] = [];
        groups[pp].push(f);
      }
    }
    return Object.entries(groups)
      .sort(([, a], [, b]) => b.length - a.length)
      .map(([key, items]) => ({
        label: ppLabels[key as PainPoint],
        features: items,
      }));
  }, [filtered, view]);

  if (isLoading) {
    return (
      <div className="p-6">
        <PageHeader title="Feature Library" subtitle="Loading..." icon={<Layers className="w-5 h-5 text-teal-400" />} />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      <PageHeader
        title="Feature Library"
        subtitle={`${allFeatures.length} curated features — internal sales reference`}
        icon={<Layers className="w-5 h-5 text-teal-400" />}
      />

      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Search features..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-teal-500/50"
          />
        </div>
        <div className="flex rounded-lg border border-zinc-800 overflow-hidden">
          <button
            onClick={() => setView('painPoint')}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              view === 'painPoint' ? 'bg-teal-500/15 text-teal-400' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            By Pain Point
          </button>
          <button
            onClick={() => setView('category')}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              view === 'category' ? 'bg-teal-500/15 text-teal-400' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            By Platform Area
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No features match your search"
          description="Try a different search term"
        />
      ) : (
        <div className="space-y-8">
          {grouped.map(group => (
            <div key={group.label}>
              <h2 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
                <span className="w-1 h-4 bg-teal-500 rounded-full" />
                {group.label}
                <span className="text-zinc-600 font-normal">({group.features.length})</span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {group.features.map(f => (
                  <FeatureCard key={`${group.label}-${f.id}`} feature={f} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
