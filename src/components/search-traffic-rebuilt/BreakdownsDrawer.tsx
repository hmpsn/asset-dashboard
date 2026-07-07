// @ds-rebuilt
import { BarChart3, Globe2, Monitor, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge, DataTable, Drawer, EmptyState, KeyValueRow, Meter } from '../ui';
import type { DataColumn } from '../ui';
import type { SearchTrafficGa4Data, SearchTrafficSearchData } from './types';
import { formatNumber, formatPercent, formatPosition, safeShare, SERIES } from './searchTrafficUtils';

interface BreakdownsDrawerProps {
  open: boolean;
  onClose: () => void;
  lens: 'search' | 'traffic';
  search: SearchTrafficSearchData;
  ga4: SearchTrafficGa4Data;
}

function EmptyIcon({ className }: { className?: string }) {
  return <BarChart3 className={className} />;
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-3">
      <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

const searchMetricColumns: DataColumn[] = [
  { key: 'label', label: 'Segment', width: '1.4fr' },
  { key: 'clicks', label: 'Clicks', align: 'right', sortable: true, render: (value) => formatNumber(value as number) },
  { key: 'impressions', label: 'Impr.', align: 'right', sortable: true, render: (value) => formatNumber(value as number) },
  { key: 'ctr', label: 'CTR', align: 'right', sortable: true, render: (value) => formatPercent(value as number) },
  { key: 'position', label: 'Pos.', align: 'right', sortable: true, render: (value) => formatPosition(value as number) },
];

const pageColumns: DataColumn[] = [
  { key: 'path', label: 'Page', width: '1.8fr' },
  { key: 'pageviews', label: 'Views', align: 'right', sortable: true, render: (value) => formatNumber(value as number) },
  { key: 'users', label: 'Users', align: 'right', sortable: true, render: (value) => formatNumber(value as number) },
  { key: 'sessions', label: 'Sessions', align: 'right', sortable: true, render: (value) => formatNumber(value as number) },
];

const countryColumns: DataColumn[] = [
  { key: 'country', label: 'Country', width: '1.4fr' },
  { key: 'users', label: 'Users', align: 'right', sortable: true, render: (value) => formatNumber(value as number) },
  { key: 'sessions', label: 'Sessions', align: 'right', sortable: true, render: (value) => formatNumber(value as number) },
];

function SearchBreakdowns({ data }: { data: SearchTrafficSearchData }) {
  const deviceRows = data.devices.map((row) => ({ ...row, label: row.device.toLowerCase() }));
  const countryRows = data.countries.map((row) => ({ ...row, label: row.country }));
  const typeRows = data.searchTypes.map((row) => ({ ...row, label: row.searchType }));

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Devices">
        <DataTable
          columns={searchMetricColumns}
          rows={deviceRows}
          getRowKey={(row) => String(row.label)}
          empty={<EmptyState icon={Monitor} title="No device breakdown" description="Search Console did not return device rows for this window." className="py-6" />}
        />
      </Panel>
      <Panel title="Countries">
        <DataTable
          columns={searchMetricColumns}
          rows={countryRows}
          getRowKey={(row) => String(row.label)}
          empty={<EmptyState icon={Globe2} title="No country breakdown" description="Search Console did not return country rows for this window." className="py-6" />}
        />
      </Panel>
      <Panel title="Search types">
        <DataTable
          columns={searchMetricColumns}
          rows={typeRows}
          getRowKey={(row) => String(row.label)}
          empty={<EmptyState icon={Search} title="No search type breakdown" description="Search Console did not return web/image/video rows for this window." className="py-6" />}
        />
      </Panel>
    </div>
  );
}

function TrafficBreakdowns({ data }: { data: SearchTrafficGa4Data }) {
  const totalSessions = data.sources.reduce((sum, row) => sum + row.sessions, 0);

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Top pages">
        <DataTable
          columns={pageColumns}
          rows={data.topPages.map((row) => ({ ...row, path: row.path }))}
          getRowKey={(row, index) => `${String(row.path)}-${index}`}
          empty={<EmptyState icon={BarChart3} title="No top pages" description="GA4 did not return page rows for this window." className="py-6" />}
        />
      </Panel>
      <Panel title="Traffic sources">
        <div className="flex flex-col gap-3">
          {data.sources.length > 0 ? data.sources.map((row) => {
            const label = `${row.source || '(direct)'}${row.medium && row.medium !== '(none)' ? ` / ${row.medium}` : ''}`;
            return (
              <div key={label} className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="t-caption font-semibold text-[var(--brand-text-bright)]">{label}</span>
                  <Badge label={`${formatPercent(safeShare(row.sessions, totalSessions))}`} tone="blue" variant="soft" size="sm" />
                </div>
                <Meter value={row.sessions} max={Math.max(totalSessions, 1)} color={SERIES.sessions} ariaLabel={`${label} share of sessions`} />
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <KeyValueRow label="Sessions" value={formatNumber(row.sessions)} />
                  <KeyValueRow label="Users" value={formatNumber(row.users)} />
                </div>
              </div>
            );
          }) : (
            <EmptyState icon={Globe2} title="No traffic sources" description="GA4 did not return source rows for this window." className="py-6" />
          )}
        </div>
      </Panel>
      <Panel title="Countries">
        <DataTable
          columns={countryColumns}
          rows={data.countries.map((row) => ({ ...row }))}
          getRowKey={(row) => String(row.country)}
          empty={<EmptyState icon={Globe2} title="No country breakdown" description="GA4 did not return country rows for this window." className="py-6" />}
        />
      </Panel>
    </div>
  );
}

export function BreakdownsDrawer({ open, onClose, lens, search, ga4 }: BreakdownsDrawerProps) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Analytics breakdowns"
      title={lens === 'search' ? 'Search breakdowns' : 'Traffic breakdowns'}
      subtitle={lens === 'search' ? 'Devices, countries, and search types from Search Console.' : 'Top pages, sources, and countries from GA4.'}
      width={720}
    >
      {lens === 'search' ? (
        <SearchBreakdowns data={search} />
      ) : ga4.overview ? (
        <TrafficBreakdowns data={ga4} />
      ) : (
        <EmptyState icon={EmptyIcon} title="No traffic breakdowns" description="Connect GA4 before reviewing traffic breakdowns." />
      )}
    </Drawer>
  );
}

