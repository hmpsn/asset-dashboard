import { useQuery } from '@tanstack/react-query';
import { get } from '../../api/client';
import { queryKeys } from '../../lib/queryKeys';
import { SectionCard } from '../ui';

/**
 * Minimal structural subset of the `/api/seo/competitive-intel` response needed for share-of-voice.
 * ShareBar reuses the SAME query key as {@link CompetitiveIntel}, so when both mount in the Competitive
 * tab the data is fetched once and shared via the React Query cache — ShareBar adds no extra request.
 */
interface SovDomain {
  domain: string;
  isOwn: boolean;
  overview: { organicTraffic: number } | null;
}
interface SovResponse {
  domains: SovDomain[];
}

interface ShareBarProps {
  workspaceId: string;
  competitors: string[];
  seoDataAvailable: boolean;
}

/**
 * Strategy v2 Competitive-tab share-of-voice chart. Renders one horizontal bar per domain sized to its
 * share of total organic traffic across you + the competitor set. "You" is highlighted in blue (data
 * law); competitors are orange (the codebase's competitor hue). Degrades gracefully: when fewer than two
 * domains carry organic-traffic data there is nothing meaningful to compare, so it renders nothing and
 * lets the CompetitiveIntel card below own the "configure DataForSEO / add competitors" messaging.
 */
export function ShareBar({ workspaceId, competitors, seoDataAvailable }: ShareBarProps) {
  const competitorKey = competitors.join(',');
  const { data } = useQuery<SovResponse>({
    queryKey: queryKeys.admin.competitorIntel(workspaceId, competitorKey),
    queryFn: () => get<SovResponse>(`/api/seo/competitive-intel/${workspaceId}?competitors=${encodeURIComponent(competitorKey)}`),
    enabled: competitors.length > 0 && seoDataAvailable,
    staleTime: 168 * 60 * 60 * 1000,
    retry: 1,
  });

  const rows = (data?.domains ?? [])
    .filter((d) => d.overview && d.overview.organicTraffic > 0)
    .map((d) => ({ domain: d.domain, isOwn: d.isOwn, traffic: d.overview!.organicTraffic }));
  const total = rows.reduce((sum, r) => sum + r.traffic, 0);
  // Require the OWN domain to carry measurable traffic. A "share of voice" that silently omits the
  // viewer (own traffic null/0 while competitors rank) reads as a misleading competitor-only chart —
  // degrade to nothing and let the CompetitiveIntel card below own the "not ranking / configure" story.
  const hasOwn = rows.some((r) => r.isOwn);
  if (!hasOwn || rows.length < 2 || total <= 0) return null;

  // Leader reads first; "You" keeps its position in the ranking regardless.
  const sov = rows
    .map((r) => ({ ...r, pct: Math.round((r.traffic / total) * 100) }))
    .sort((a, b) => b.traffic - a.traffic);

  return (
    <SectionCard
      title="Share of voice"
      titleExtra={<span className="t-caption-sm text-[var(--brand-text-muted)] ml-2">organic traffic vs your competitor set</span>}
    >
      <div className="space-y-3">
        {sov.map((r) => (
          <div key={r.domain} className="space-y-1">
            <div className="flex justify-between t-caption-sm">
              <span className={r.isOwn ? 'text-blue-400 font-medium' : 'text-[var(--brand-text)]'}>
                {r.isOwn ? `${r.domain} (you)` : r.domain}
              </span>
              <span className={`t-mono ${r.isOwn ? 'text-blue-400' : 'text-[var(--brand-text-muted)]'}`}>{r.pct}%</span>
            </div>
            <div className="h-2 bg-[var(--surface-3)] rounded-[var(--radius-pill)] overflow-hidden">
              <div
                className={`h-full rounded-[var(--radius-pill)] transition-all ${r.isOwn ? 'bg-blue-500/70' : 'bg-orange-500/60'}`}
                style={{ width: `${r.pct}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
