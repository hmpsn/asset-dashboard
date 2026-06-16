import { Icon } from '../ui';
import { Link2, Globe, ExternalLink, Loader2, Shield, AlertTriangle } from 'lucide-react';
import { SectionCard, StatCard, EmptyState } from '../ui';
import { useBacklinkProfile } from '../../hooks/admin/useBacklinkProfile';
import { fmtNum } from '../../utils/formatNumbers';
import { formatDate } from '../../utils/formatDates';

interface Props {
  workspaceId: string;
}

export function BacklinkProfile({ workspaceId }: Props) {
  // React Query (useBacklinkProfile) so the profile refetches on strategy:updated — the previous raw
  // useEffect never re-fetched, leaving backlink data stale until remount.
  const { data, isLoading: loading, error } = useBacklinkProfile(workspaceId);
  const errorMsg = error instanceof Error ? error.message : error ? String(error) : null;

  if (loading) {
    return (
      <SectionCard noPadding>
        <div className="px-4 py-6 flex items-center justify-center gap-2 text-[var(--brand-text-muted)] t-body">
          <Icon as={Loader2} size="md" className="animate-spin" /> Loading backlink profile…
        </div>
      </SectionCard>
    );
  }

  if (errorMsg) {
    if (errorMsg.includes('No SEO data provider configured')) {
      return (
        <SectionCard noPadding>
          <div className="px-4 py-4 flex items-center gap-2 text-[var(--brand-text-muted)] t-caption">
            <Icon as={AlertTriangle} size="md" className="text-amber-400" />
            <span>Backlink data requires DataForSEO. Set <code className="text-[var(--brand-text)]">DATAFORSEO_LOGIN</code> and <code className="text-[var(--brand-text)]">DATAFORSEO_PASSWORD</code> in the environment to enable it.</span>
          </div>
        </SectionCard>
      );
    }
    return (
      <SectionCard noPadding>
        <div className="px-4 py-4 flex items-center gap-2 text-red-400 t-caption">
          <Icon as={AlertTriangle} size="md" className="text-red-400" /> {errorMsg}
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
        <h3 className="t-body font-semibold text-[var(--brand-text-bright)]">Backlink Profile</h3>
        <span className="t-caption-sm text-[var(--brand-text-muted)] ml-1">{domain}</span>
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
            <div className="t-body font-medium text-[var(--brand-text-bright)] mb-3">Top Referring Domains</div>
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
                      <td className="py-2 text-[var(--brand-text-muted)] text-right">{rd.firstSeen ? formatDate(rd.firstSeen) : '—'}</td>
                      <td className="py-2 text-[var(--brand-text-muted)] text-right">{rd.lastSeen ? formatDate(rd.lastSeen) : '—'}</td>
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
