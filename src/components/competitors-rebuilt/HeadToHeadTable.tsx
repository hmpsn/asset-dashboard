// @ds-rebuilt
import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  Icon,
  InlineBanner,
  Skeleton,
  type DataColumn,
} from '../ui';
import { CompetitorDetailDrawer } from './CompetitorDetailDrawer';
import type { CompetitiveDomain, CompetitiveIntelResponse } from './types';

interface HeadToHeadTableProps {
  data?: CompetitiveIntelResponse;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
}

type DomainRecord = Record<string, unknown> & {
  source: CompetitiveDomain;
  domain: string;
  traffic: number | null;
  keywords: number | null;
  refDomains: number | null;
  trafficValue: number | null;
  authorityRank: number | null;
  top3Keywords: number | null;
  leader: boolean;
};

const NUMBER_FORMAT = new Intl.NumberFormat('en-US');
const MONEY_FORMAT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function EmptyIcon({ className }: { className?: string }) {
  return <Icon name="target" className={className} />;
}

function num(value: number | null | undefined): string {
  return typeof value === 'number' ? NUMBER_FORMAT.format(value) : '-';
}

function money(value: number | null | undefined): string {
  return typeof value === 'number' ? MONEY_FORMAT.format(value) : '-';
}

function toRecords(domains: CompetitiveDomain[]): DomainRecord[] {
  return domains
    .map((domain) => ({
      source: domain,
      domain: domain.domain,
      traffic: domain.overview?.organicTraffic ?? null,
      keywords: domain.overview?.organicKeywords ?? null,
      refDomains: domain.backlinks?.referringDomains ?? null,
      trafficValue: domain.overview?.organicCost ?? null,
      authorityRank: domain.authorityRank ?? null,
      top3Keywords: domain.top3Keywords ?? null,
      leader: false,
    }))
    .sort((a, b) => (b.traffic ?? 0) - (a.traffic ?? 0))
    .map((record, index) => ({ ...record, leader: index === 0 }));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'SEO data is temporarily unavailable.';
}

export function HeadToHeadTable({
  data,
  isLoading,
  isFetching,
  isError,
  error,
  onRetry,
}: HeadToHeadTableProps) {
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const rows = useMemo(() => toRecords(data?.domains ?? []), [data?.domains]);
  const hasAuthority = rows.some((row) => row.authorityRank != null);
  const hasTop3 = rows.some((row) => row.top3Keywords != null);

  const columns = useMemo<DataColumn[]>(() => {
    const base: DataColumn[] = [
      {
        key: 'domain',
        label: 'Domain',
        width: 'minmax(220px, 1.7fr)',
        render: (_value, record) => {
          const row = record as DomainRecord;
          return (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="truncate font-semibold text-[var(--brand-text-bright)]">{row.domain}</span>
              {row.source.isOwn && <Badge label="YOU" tone="blue" variant="soft" size="sm" />}
              {row.leader && <Badge label="Leader" tone="emerald" variant="soft" size="sm" />}
            </div>
          );
        },
        sortable: true,
      },
      {
        key: 'traffic',
        label: 'Traffic',
        width: '104px',
        align: 'right',
        render: (_value, record) => num((record as DomainRecord).traffic),
        sortable: true,
      },
      {
        key: 'keywords',
        label: 'Keywords',
        width: '108px',
        align: 'right',
        render: (_value, record) => num((record as DomainRecord).keywords),
        sortable: true,
      },
      {
        key: 'refDomains',
        label: 'Ref domains',
        width: '118px',
        align: 'right',
        render: (_value, record) => num((record as DomainRecord).refDomains),
        sortable: true,
      },
    ];

    if (hasAuthority) {
      base.push({
        key: 'authorityRank',
        label: 'Authority',
        width: '104px',
        align: 'right',
        render: (_value, record) => {
          const value = (record as DomainRecord).authorityRank;
          return value == null ? '-' : `${value}/100`;
        },
        sortable: true,
      });
    }

    if (hasTop3) {
      base.push({
        key: 'top3Keywords',
        label: 'Top 3',
        width: '92px',
        align: 'right',
        render: (_value, record) => num((record as DomainRecord).top3Keywords),
        sortable: true,
      });
    }

    base.push({
      key: 'trafficValue',
      label: 'Value',
      width: '116px',
      align: 'right',
      render: (_value, record) => money((record as DomainRecord).trafficValue),
      sortable: true,
    });

    return base;
  }, [hasAuthority, hasTop3]);

  return (
    <section className="flex flex-col gap-3" aria-labelledby="head-to-head-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="head-to-head-title" className="t-ui font-semibold text-[var(--brand-text-bright)]">
            Head-to-head
          </h2>
          <p className="t-caption-sm text-[var(--brand-text-muted)]">
            One sortable comparison including your domain. Select a competitor for detail.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data?.fetchedAt && (
            <span className="t-caption text-[var(--brand-text-muted)]">
              Last scanned {new Date(data.fetchedAt).toLocaleString()}
            </span>
          )}
          {isFetching && <Badge label="Refreshing" tone="blue" variant="soft" size="sm" />}
        </div>
      </div>

      {data?.degraded && (
        <InlineBanner tone="warning" title="Some live competitor data is unavailable">
          Showing the metrics that loaded. {data.providerFailures?.length ? `${data.providerFailures.length} competitor data read(s) degraded.` : null}
        </InlineBanner>
      )}

      {isError && data && (
        <InlineBanner tone="warning" title="Showing the last loaded competitor data">
          <div className="flex flex-wrap items-center gap-2">
            <span>{errorMessage(error)}</span>
            <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button>
          </div>
        </InlineBanner>
      )}

      {isError && !data && (
        <InlineBanner tone="error" title="Competitive intelligence did not load">
          <div className="flex flex-wrap items-center gap-2">
            <span>{errorMessage(error)}</span>
            <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button>
          </div>
        </InlineBanner>
      )}

      {isLoading && !data ? (
        <Skeleton className="h-[260px] w-full" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={EmptyIcon}
          title="No competitive metrics returned"
          description="The latest scan did not return usable domain comparison data for this set."
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={(row) => (row as DomainRecord).source.domain}
          onRowClick={(row) => {
            const record = row as DomainRecord;
            if (!record.source.isOwn) setSelectedDomain(record.source.domain);
          }}
        />
      )}

      <CompetitorDetailDrawer
        domains={data?.domains ?? []}
        selectedDomain={selectedDomain}
        onClose={() => setSelectedDomain(null)}
      />
    </section>
  );
}
