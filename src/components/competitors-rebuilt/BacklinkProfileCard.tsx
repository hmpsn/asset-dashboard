// @ds-rebuilt
import { useBacklinkProfile } from '../../hooks/admin/useBacklinkProfile';
import {
  DataTable,
  EmptyState,
  Icon,
  InlineBanner,
  MetricTile,
  Skeleton,
  type DataColumn,
} from '../ui';
import type { ReferringDomain } from '../../api/seo';

interface BacklinkProfileCardProps {
  workspaceId: string;
}

type RefDomainRecord = Record<string, unknown> & {
  source: ReferringDomain;
  domain: string;
  backlinks: number;
  firstSeen: string;
  lastSeen: string;
};

const NUMBER_FORMAT = new Intl.NumberFormat('en-US');
const DATE_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function EmptyIcon({ className }: { className?: string }) {
  return <Icon name="link" className={className} />;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '-';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '-' : DATE_FORMAT.format(parsed);
}

function toRecord(domain: ReferringDomain): RefDomainRecord {
  return {
    source: domain,
    domain: domain.domain,
    backlinks: domain.backlinksCount,
    firstSeen: domain.firstSeen,
    lastSeen: domain.lastSeen,
  };
}

const columns: DataColumn[] = [
  {
    key: 'domain',
    label: 'Domain',
    width: 'minmax(220px, 1.5fr)',
    render: (_value, record) => {
      const domain = (record as RefDomainRecord).source.domain;
      return (
        <a
          href={`https://${domain}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-w-0 items-center gap-1.5 text-[var(--teal)]"
        >
          <span className="truncate">{domain}</span>
          <Icon name="external" size="sm" />
        </a>
      );
    },
    sortable: true,
  },
  {
    key: 'backlinks',
    label: 'Backlinks',
    width: '110px',
    align: 'right',
    render: (_value, record) => NUMBER_FORMAT.format((record as RefDomainRecord).source.backlinksCount),
    sortable: true,
  },
  {
    key: 'firstSeen',
    label: 'First seen',
    width: '124px',
    align: 'right',
    render: (_value, record) => formatDate((record as RefDomainRecord).source.firstSeen),
    sortable: true,
  },
  {
    key: 'lastSeen',
    label: 'Last seen',
    width: '124px',
    align: 'right',
    render: (_value, record) => formatDate((record as RefDomainRecord).source.lastSeen),
    sortable: true,
  },
];

export function BacklinkProfileCard({ workspaceId }: BacklinkProfileCardProps) {
  const { data, isLoading, error } = useBacklinkProfile(workspaceId);
  const errorMessage = error instanceof Error ? error.message : error ? String(error) : '';

  return (
    <section className="flex flex-col gap-3" aria-labelledby="backlink-profile-title">
      <div>
        <h2 id="backlink-profile-title" className="t-ui font-semibold text-[var(--brand-text-bright)]">
          Backlink profile
        </h2>
        <p className="t-caption-sm text-[var(--brand-text-muted)]">
          Authority footprint and the top referring domains for this site.
        </p>
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-[92px] w-full" />)}
        </div>
      ) : errorMessage ? (
        <InlineBanner
          tone={errorMessage.includes('No SEO data provider configured') ? 'warning' : 'error'}
          title={errorMessage.includes('No SEO data provider configured') ? 'Backlink data needs SEO provider credentials' : 'Backlink profile did not load'}
        >
          {errorMessage.includes('No SEO data provider configured') ? (
            <span>
              Set <code className="font-mono text-[var(--brand-text-bright)]">DATAFORSEO_LOGIN</code> and{' '}
              <code className="font-mono text-[var(--brand-text-bright)]">DATAFORSEO_PASSWORD</code> in the environment to enable it.
            </span>
          ) : errorMessage}
        </InlineBanner>
      ) : !data?.overview ? (
        <EmptyState
          icon={EmptyIcon}
          title="No backlink data returned"
          description="This can happen for a new domain or a low-authority site."
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricTile label="Total backlinks" value={NUMBER_FORMAT.format(data.overview.totalBacklinks)} accent="var(--blue)" />
            <MetricTile label="Ref. domains" value={NUMBER_FORMAT.format(data.overview.referringDomains)} accent="var(--blue)" />
            <MetricTile
              label="Follow links"
              value={`${Math.round((data.overview.followLinks / Math.max(1, data.overview.totalBacklinks)) * 100)}%`}
              sub={`${NUMBER_FORMAT.format(data.overview.followLinks)} follow`}
              accent="var(--blue)"
            />
            <MetricTile
              label="Link types"
              value={`${NUMBER_FORMAT.format(data.overview.textLinks)} text`}
              sub={`${NUMBER_FORMAT.format(data.overview.imageLinks)} image`}
              accent="var(--blue)"
            />
          </div>

          {data.referringDomains.length === 0 ? (
            <InlineBanner tone="info" title="No referring domains returned">
              The backlink scan returned totals but no domain-level rows.
            </InlineBanner>
          ) : (
            <DataTable
              columns={columns}
              rows={data.referringDomains.map(toRecord)}
              getRowKey={(row) => (row as RefDomainRecord).source.domain}
            />
          )}
        </>
      )}
    </section>
  );
}
