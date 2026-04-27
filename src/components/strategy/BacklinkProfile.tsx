import { useState, useEffect } from 'react';
import { Icon } from '../ui';
import { Link2, Globe, ExternalLink, Loader2, Shield, AlertTriangle } from 'lucide-react';
import { SectionCard, StatCard, EmptyState } from '../ui';
import { backlinks } from '../../api';

interface BacklinksOverview {
  totalBacklinks: number;
  referringDomains: number;
  followLinks: number;
  nofollowLinks: number;
  textLinks: number;
  imageLinks: number;
  formLinks: number;
  frameLinks: number;
}

interface ReferringDomain {
  domain: string;
  backlinksCount: number;
  firstSeen: string;
  lastSeen: string;
}

interface BacklinkData {
  domain: string;
  overview: BacklinksOverview | null;
  referringDomains: ReferringDomain[];
}

interface Props {
  workspaceId: string;
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function BacklinkProfile({ workspaceId }: Props) {
  const [data, setData] = useState<BacklinkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    backlinks.get(workspaceId)
      .then((d) => { if (!cancelled) setData(d as BacklinkData); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [workspaceId]);

  if (loading) {
    return (
      <SectionCard noPadding>
        <div className="px-4 py-6 flex items-center justify-center gap-2 text-[var(--brand-text-muted)] t-ui">
          <Icon as={Loader2} size="md" className="animate-spin" /> Loading backlink profile…
        </div>
      </SectionCard>
    );
  }

  if (error) {
    if (error.includes('No SEO data provider configured')) {
      return (
        <SectionCard noPadding>
          <div className="px-4 py-4 flex items-center gap-2 text-[var(--brand-text-muted)] t-caption">
            <Icon as={AlertTriangle} size="md" className="text-amber-400" />
            <span>Backlink data requires an SEO provider. Set <code className="text-[var(--brand-text)]">SEMRUSH_API_KEY</code> or <code className="text-[var(--brand-text)]">DATAFORSEO_LOGIN</code> in environment to enable.</span>
          </div>
        </SectionCard>
      );
    }
    return (
      <SectionCard noPadding>
        <div className="px-4 py-4 flex items-center gap-2 text-red-400 t-caption">
          <Icon as={AlertTriangle} size="md" className="text-red-400" /> {error}
        </div>
      </SectionCard>
    );
  }

  if (!data?.overview) {
    return (
      <EmptyState icon={Link2} title="No Backlink Data" description="No backlink data found for this domain. This may be a new or low-traffic site." />
    );
  }

  const { overview, referringDomains, domain } = data;
  const followPct = overview.totalBacklinks > 0
    ? Math.round((overview.followLinks / overview.totalBacklinks) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-1">
        <Icon as={Link2} size="md" className="text-teal-400" />
        <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">Backlink Profile</h3>
        <span className="t-caption-sm text-[var(--brand-text-dim)] ml-1">{domain}</span>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Backlinks" value={fmtNum(overview.totalBacklinks)} icon={Link2} />
        <StatCard label="Referring Domains" value={fmtNum(overview.referringDomains)} icon={Globe} />
        <StatCard label="Follow Links" value={`${followPct}%`} sub={`${fmtNum(overview.followLinks)} follow`} icon={Shield} />
        {(overview.textLinks > 0 || overview.imageLinks > 0 || overview.formLinks > 0 || overview.frameLinks > 0) && (
          <StatCard label="Link Types" value={`${fmtNum(overview.textLinks)} text`} sub={`${fmtNum(overview.imageLinks)} image`} icon={ExternalLink} />
        )}
      </div>

      {/* Referring domains table */}
      {referringDomains.length > 0 && (
        <SectionCard noPadding>
          <div className="px-4 py-3">
            <div className="t-ui font-medium text-[var(--brand-text-bright)] mb-3">Top Referring Domains</div>
            <div className="overflow-x-auto">
              <table className="w-full t-caption">
                <thead>
                  <tr className="text-[var(--brand-text-muted)] text-left">
                    <th className="pb-2 font-medium">Domain</th>
                    <th className="pb-2 font-medium text-right">Backlinks</th>
                    <th className="pb-2 font-medium text-right">First Seen</th>
                    <th className="pb-2 font-medium text-right">Last Seen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--brand-border)]">
                  {referringDomains.map(rd => (
                    <tr key={rd.domain}>
                      <td className="py-2">
                        <a
                          href={`https://${rd.domain}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-teal-400 hover:text-teal-300 transition-colors flex items-center gap-1"
                        >
                          {rd.domain}
                          <Icon as={ExternalLink} size="sm" className="opacity-50" />
                        </a>
                      </td>
                      <td className="py-2 text-[var(--brand-text-bright)] text-right font-medium">{fmtNum(rd.backlinksCount)}</td>
                      <td className="py-2 text-[var(--brand-text-muted)] text-right">{rd.firstSeen ? new Date(rd.firstSeen).toLocaleDateString() : '—'}</td>
                      <td className="py-2 text-[var(--brand-text-muted)] text-right">{rd.lastSeen ? new Date(rd.lastSeen).toLocaleDateString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </SectionCard>
      )}
    </div>
  );
}
