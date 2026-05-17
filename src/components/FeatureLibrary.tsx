import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Layers, Eye } from 'lucide-react';
import { Button, PageHeader, EmptyState, FormInput, Icon, cn } from './ui';
import { features as featuresApi } from '../api/platform';
import { queryKeys } from '../lib/queryKeys';
import type { Feature, FeatureCategory, PainPoint, FeatureTier } from '../../shared/types/features';
import { CATEGORY_LABELS as catLabels, PAIN_POINT_LABELS as ppLabels } from '../../shared/types/features';

type ViewMode = 'painPoint' | 'category';

const TIER_STYLES: Record<FeatureTier, string> = {
  free: 'bg-[var(--brand-text-muted)]/15 text-[var(--brand-text)] border-[var(--brand-text-muted)]/20',
  growth: 'bg-teal-500/15 text-accent-brand border-teal-500/20',
  premium: 'bg-teal-500/15 text-accent-brand border-teal-500/20',
  admin: 'bg-accent-brand-soft text-accent-brand border-accent-brand-soft',
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
    <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] p-4 hover:border-[var(--brand-border-hover)] transition-colors" style={{ borderRadius: 'var(--radius-signature)' }}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold text-[var(--brand-text-bright)] leading-tight">{feature.title}</h3>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {feature.impact !== 'low' && (
            <span className={`w-2 h-2 rounded-[var(--radius-pill)] ${IMPACT_DOT[feature.impact]}`} title={`${feature.impact} impact`} />
          )}
          {feature.clientFacing && (
            <span title="Client-facing" className="inline-flex">
              <Icon as={Eye} size="sm" className="text-[var(--brand-text-muted)]" aria-label="Client-facing" />
            </span>
          )}
        </div>
      </div>
      <p className="text-xs text-[var(--brand-text)] leading-relaxed mb-3">{feature.oneLiner}</p>
      <span className={cn('inline-flex px-2 py-0.5 t-caption-sm font-medium rounded-[var(--radius-md)] border', TIER_STYLES[feature.tier])}>
        {TIER_LABELS[feature.tier]}
      </span>
    </div>
  );
}

export default function FeatureLibrary() {
  const [search, setSearch] = useState('');
  const [view, setView] = useState<ViewMode>('painPoint');

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.shared.features(),
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
        <PageHeader title="Feature Library" subtitle="Loading..." icon={<Icon as={Layers} size="lg" className="text-accent-brand" />} />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      <PageHeader
        title="Feature Library"
        subtitle={`${allFeatures.length} curated features — internal sales reference`}
        icon={<Icon as={Layers} size="lg" className="text-accent-brand" />}
      />

      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Icon as={Search} size="md" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--brand-text-muted)]" />
          <FormInput
            type="text"
            placeholder="Search features..."
            value={search}
            onChange={setSearch}
            className="w-full pl-9 pr-3 py-2 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-md)] text-sm text-[var(--brand-text-bright)] placeholder:text-[var(--brand-text-dim)] focus:outline-none focus:border-teal-500/50"
          />
        </div>
        <div className="flex rounded-[var(--radius-md)] border border-[var(--brand-border)] overflow-hidden">
          <Button
            onClick={() => setView('painPoint')}
            variant="secondary"
            size="sm"
            className={cn(
              'px-3 py-1.5 text-xs font-medium transition-colors',
              view === 'painPoint' ? 'bg-teal-500/15 text-accent-brand' : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]',
            )}
          >
            By Pain Point
          </Button>
          <Button
            onClick={() => setView('category')}
            variant="secondary"
            size="sm"
            className={cn(
              'px-3 py-1.5 text-xs font-medium transition-colors',
              view === 'category' ? 'bg-teal-500/15 text-accent-brand' : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]',
            )}
          >
            By Platform Area
          </Button>
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
              <h2 className="text-sm font-semibold text-[var(--brand-text)] mb-3 flex items-center gap-2">
                <span className="w-1 h-4 bg-teal-500 rounded-[var(--radius-pill)]" />
                {group.label}
                <span className="text-[var(--brand-text-dim)] font-normal">({group.features.length})</span>
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
