// @ds-rebuilt
import { Activity, ArrowRight, BarChart3, Users, Zap } from 'lucide-react';
import { useState } from 'react';
import { AnnotatedTrendChart, type TrendLine } from '../charts/AnnotatedTrendChart';
import { InsightFeed } from '../insights';
import { AnomalyAlerts } from '../AnomalyAlerts';
import {
  Badge,
  Button,
  ChartCard,
  DataTable,
  Disclosure,
  EmptyState,
  GroupBlock,
  Icon,
  InlineBanner,
  KeyValueRow,
  Meter,
  Skeleton,
} from '../ui';
import type { DataColumn } from '../ui';
import { useAnalyticsOverviewFromData } from '../../hooks/admin/useAnalyticsOverview';
import { useInsightFeed } from '../../hooks/admin/useInsightFeed';
import { useToggleSet } from '../../hooks/useToggleSet';
import { SparkMetricTile } from './SparkMetricTile';
import { ReportSectionHeader } from './ReportSectionHeader';
import type { SearchTrafficGa4Data } from './types';
import {
  SERIES,
  buildSparkline,
  deltaLabel,
  formatDuration,
  formatNumber,
  formatPercent,
} from './searchTrafficUtils';

interface TrafficLensProps {
  workspaceId: string;
  ga4PropertyId?: string;
  days: number;
  data: SearchTrafficGa4Data;
  onOpenBreakdowns: () => void;
}

const TRAFFIC_LINES: TrendLine[] = [
  { key: 'users', color: SERIES.users, yAxisId: 'left', label: 'Users' },
  { key: 'sessions', color: SERIES.sessions, yAxisId: 'left', label: 'Sessions' },
  { key: 'pageviews', color: SERIES.pageviews, yAxisId: 'left', label: 'Pageviews' },
];

const landingColumns: DataColumn[] = [
  { key: 'landingPage', label: 'Landing page', width: 'minmax(260px,2fr)', render: (value) => <span className="truncate font-mono text-[var(--brand-text-bright)]">{String(value)}</span>, sortable: true },
  { key: 'sessions', label: 'Sessions', align: 'right', sortable: true, render: (value) => formatNumber(value as number) },
  { key: 'users', label: 'Users', align: 'right', sortable: true, render: (value) => formatNumber(value as number) },
  { key: 'bounceRate', label: 'Bounce', align: 'right', sortable: true, render: (value) => formatPercent(value as number) },
  { key: 'conversions', label: 'Conv.', align: 'right', sortable: true, render: (value) => formatNumber(value as number) },
];

const conversionColumns: DataColumn[] = [
  { key: 'eventName', label: 'Event', width: 'minmax(220px,1.5fr)', render: (value) => String(value).replace(/_/g, ' '), sortable: true },
  { key: 'conversions', label: 'Conversions', align: 'right', sortable: true, render: (value) => formatNumber(value as number) },
  { key: 'users', label: 'Users', align: 'right', sortable: true, render: (value) => formatNumber(value as number) },
  { key: 'rate', label: 'Rate', align: 'right', sortable: true, render: (value) => formatPercent(value as number) },
];

export function TrafficLens({ workspaceId, ga4PropertyId, days, data, onOpenBreakdowns }: TrafficLensProps) {
  const [activeLines, toggleLine] = useToggleSet(['users', 'sessions']);
  const [eventsOpen, setEventsOpen] = useState(true);
  const overviewData = useAnalyticsOverviewFromData(workspaceId, null, data, {
    gsc: false,
    ga4: !!ga4PropertyId,
  });
  const { feed, isLoading: feedLoading } = useInsightFeed(workspaceId);

  if (!ga4PropertyId) {
    return (
      <EmptyState
        icon={BarChart3}
        title="GA4 not configured"
        description="Connect Google Analytics in Workspace Settings before reviewing site traffic."
      />
    );
  }

  if (data.isLoading && !data.overview) {
    return (
      <div className="flex flex-col gap-4" aria-label="Loading site traffic">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-[92px] w-full" />)}
        </div>
        <Skeleton className="h-[320px] w-full" />
      </div>
    );
  }

  if (!data.overview) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No GA4 data"
        description="GA4 did not return overview rows for this workspace and window."
      />
    );
  }

  const chartLines = TRAFFIC_LINES.map((line) => ({ ...line, active: activeLines.has(line.key) }));
  const totalSourceSessions = data.sources.reduce((sum, source) => sum + source.sessions, 0);
  const trafficFeed = feed.filter((item) => item.domain === 'traffic' || item.domain === 'cross');

  return (
    <div className="flex flex-col gap-4">
      {data.error && (
        <InlineBanner tone="warning" title="Traffic data may be stale">
          {data.error}. The last loaded GA4 rows are still shown when available.
        </InlineBanner>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SparkMetricTile
          label="Users"
          value={formatNumber(data.overview.totalUsers)}
          sparkline={buildSparkline(data.trend, (row) => row.users)}
          sparklineLabel="GA4 users daily trend"
          delta={data.comparison?.changePercent.users}
          deltaLabel="vs prior"
          accent={SERIES.users}
          icon={Users}
          onClick={() => toggleLine('users')}
          className={activeLines.has('users') ? 'border-[var(--teal)]' : undefined}
        />
        <SparkMetricTile
          label="Sessions"
          value={formatNumber(data.overview.totalSessions)}
          sparkline={buildSparkline(data.trend, (row) => row.sessions)}
          sparklineLabel="GA4 sessions daily trend"
          delta={data.comparison?.changePercent.sessions}
          deltaLabel="vs prior"
          accent={SERIES.sessions}
          onClick={() => toggleLine('sessions')}
          className={activeLines.has('sessions') ? 'border-[var(--teal)]' : undefined}
        />
        <SparkMetricTile
          label="Bounce rate"
          value={formatPercent(data.overview.bounceRate)}
          sparkline={[]}
          sparklineLabel="GA4 bounce rate daily trend unavailable"
          delta={data.comparison?.change.bounceRate}
          deltaLabel="pt"
          invertDelta
          accent={SERIES.ctr}
        />
        <SparkMetricTile
          label="Avg duration"
          value={formatDuration(data.overview.avgSessionDuration)}
          sparkline={[]}
          sparklineLabel="GA4 average duration daily trend unavailable"
          delta={data.comparison?.change.avgSessionDuration}
          deltaLabel="sec"
          accent={SERIES.duration}
        />
      </div>

      <ChartCard
        title="Traffic trend"
        action={(
          <div className="flex items-center gap-2">
            <Badge label={`${days}d`} tone="zinc" variant="soft" size="sm" />
            <Button size="sm" variant="secondary" onClick={onOpenBreakdowns}>
              <Icon name="layers" size="sm" aria-hidden="true" />
              Breakdowns
            </Button>
          </div>
        )}
      >
        {overviewData.trendData.length > 0 ? (
          <AnnotatedTrendChart
            data={overviewData.trendData}
            lines={chartLines}
            annotations={overviewData.annotations}
            onCreateAnnotation={(date, label, category) => overviewData.createAnnotation.mutate({ date, label, category })}
            onToggleLine={toggleLine}
            height={300}
          />
        ) : (
          <EmptyState icon={Activity} title="No daily traffic rows" description="GA4 did not return a dated trend series for this window." />
        )}
      </ChartCard>

      <ReportSectionHeader
        number="01"
        title="Acquisition"
        description="Where sessions originated and which devices visitors used."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Traffic sources">
          <div className="flex flex-col gap-3">
            {data.sources.slice(0, 8).map((source) => {
              const label = `${source.source || '(direct)'}${source.medium && source.medium !== '(none)' ? ` / ${source.medium}` : ''}`;
              return (
                <Meter
                  key={label}
                  label={`${label} · ${formatNumber(source.sessions)} sessions`}
                  value={source.sessions}
                  max={Math.max(totalSourceSessions, 1)}
                  color={SERIES.sessions}
                  ariaLabel={`${label} session share`}
                />
              );
            })}
            {data.sources.length === 0 && <EmptyState icon={Activity} title="No sources" description="GA4 did not return source rows." className="py-4" />}
          </div>
        </ChartCard>

        <ChartCard title="Devices">
          <div className="flex flex-col gap-3">
            {data.devices.slice(0, 8).map((device) => (
              <Meter
                key={device.device}
                label={`${device.device || 'Unknown'} · ${formatNumber(device.users)} users`}
                value={device.percentage}
                max={100}
                color={SERIES.users}
                showValue
                ariaLabel={`${device.device || 'Unknown'} user share`}
              />
            ))}
            {data.devices.length === 0 && <EmptyState icon={Users} title="No device split" description="GA4 did not return device rows." className="py-4" />}
          </div>
        </ChartCard>
      </div>

      {data.organic && (
        <ChartCard title="Organic vs all traffic" titleIcon={<Icon name="globe" size="md" className="text-[var(--emerald)]" aria-hidden="true" />}>
          <div className="grid gap-4 md:grid-cols-3">
            <Meter label="Organic user share" value={data.organic.shareOfTotalUsers} color={SERIES.pageviews} showValue />
            <KeyValueRow label="Organic users" value={`${formatNumber(data.organic.organicUsers)} of ${formatNumber(data.overview.totalUsers)}`} valueColor="var(--emerald)" divider={false} />
            <KeyValueRow label="Organic engagement" value={formatPercent(data.organic.engagementRate)} valueColor="var(--emerald)" divider={false} />
          </div>
        </ChartCard>
      )}

      <ReportSectionHeader
        number="02"
        title="Engagement"
        description="How audience quality and behavior changed after arrival."
      />

      <div className="grid gap-4 xl:grid-cols-2">
        {data.comparison && (
          <GroupBlock
            icon={Activity}
            iconColor={SERIES.pageviews}
            title="Growth signals"
            meta="Current period compared with the previous period."
            stats={[
              { label: 'users', value: deltaLabel(data.comparison.changePercent.users), color: data.comparison.changePercent.users >= 0 ? 'var(--emerald)' : 'var(--red)' },
              { label: 'sessions', value: deltaLabel(data.comparison.changePercent.sessions), color: data.comparison.changePercent.sessions >= 0 ? 'var(--emerald)' : 'var(--red)' },
            ]}
          >
            <div className="px-2 pb-2">
              <KeyValueRow label="Pageview growth" value={deltaLabel(data.comparison.changePercent.pageviews)} valueColor={data.comparison.changePercent.pageviews >= 0 ? 'var(--emerald)' : 'var(--red)'} divider={false} />
              <KeyValueRow label="Bounce change" value={deltaLabel(data.comparison.change.bounceRate, 'pt')} valueColor={data.comparison.change.bounceRate <= 0 ? 'var(--emerald)' : 'var(--red)'} />
              <KeyValueRow label="Duration change" value={formatDuration(Math.abs(data.comparison.change.avgSessionDuration))} />
            </div>
          </GroupBlock>
        )}

        <GroupBlock icon={Users} iconColor={SERIES.users} title="Engagement analysis" meta="New/returning segments and page engagement.">
          <div className="px-2 pb-2">
            {data.newVsReturning.length > 0 ? data.newVsReturning.map((segment, index) => (
              <KeyValueRow
                key={segment.segment}
                label={`${segment.segment} users`}
                value={`${formatNumber(segment.users)} · ${formatPercent(segment.engagementRate)} engaged`}
                valueColor={index === 0 ? 'var(--blue)' : 'var(--emerald)'}
                divider={index !== 0}
              />
            )) : (
              <p className="t-body text-[var(--brand-text-muted)]">GA4 did not return new/returning rows.</p>
            )}
          </div>
        </GroupBlock>
      </div>

      <ReportSectionHeader
        number="03"
        title="Conversion"
        description="Landing pages and the key events they produced."
      />

      <div className="flex flex-col gap-4">
        <ChartCard title="Landing pages" action={<Badge label={`${data.landingPages.length} rows`} tone="blue" variant="soft" size="sm" />}>
          <DataTable
            columns={landingColumns}
            rows={data.landingPages as unknown as Record<string, unknown>[]}
            getRowKey={(row, index) => `${String(row.landingPage)}-${index}`}
            empty={<EmptyState icon={ArrowRight} title="No landing pages" description="GA4 did not return landing page rows for this window." />}
          />
        </ChartCard>
        <ChartCard
          title="Events & conversions"
          titleIcon={<Icon name="zap" size="md" className="text-[var(--amber)]" aria-hidden="true" />}
          action={<Button size="sm" variant="ghost" onClick={() => setEventsOpen((open) => !open)}>{eventsOpen ? 'Hide' : 'Show'}</Button>}
        >
          {eventsOpen ? (
            <DataTable
              columns={conversionColumns}
              rows={data.conversions as unknown as Record<string, unknown>[]}
              getRowKey={(row, index) => `${String(row.eventName)}-${index}`}
              empty={<EmptyState icon={Zap} title="No conversions" description="GA4 did not return key event rows for this window." />}
            />
          ) : (
            <div className="t-body text-[var(--brand-text-muted)]">
              {data.conversions.length} tracked conversion event{data.conversions.length === 1 ? '' : 's'} available.
            </div>
          )}
        </ChartCard>
      </div>

      <Disclosure summary="Monitoring & insights" badges={[{ label: `${trafficFeed.length} signals`, tone: 'blue' }]}>
        <div className="flex flex-col gap-4 pt-2">
          <AnomalyAlerts workspaceId={workspaceId} isAdmin />
          <ChartCard title="Traffic insights">
            <InsightFeed
              feed={feed}
              loading={feedLoading}
              domain="traffic"
              showFilterChips
              workspaceId={workspaceId}
              limit={5}
            />
          </ChartCard>
        </div>
      </Disclosure>
    </div>
  );
}
