// @ds-rebuilt
import type { ReactNode } from 'react';
import { ContentBriefs } from '../ContentBriefs';
import { ContentCalendar } from '../ContentCalendar';
import { ContentManager } from '../ContentManager';
import { ContentPlanner } from '../ContentPlanner';
import { ContentSubscriptions } from '../ContentSubscriptions';
import { AiSuggested } from '../pipeline/AiSuggested';
import type { FixContext } from '../../types/fix-context';
import type { ContentPipelineSlice, CannibalizationWarning, DecayAlert } from '../../../shared/types/intelligence';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  GroupBlock,
  Icon,
  InlineBanner,
  MetricTile,
  type DataColumn,
  type Tier,
} from '../ui';
import { PublishedContentLens } from './PublishedContentLens';
import type { ContentPipelineTab } from './useContentPipelineSurfaceState';
import { formatContentDate, formatInteger, formatPercentValue } from './contentPipelineFormatters';

interface PipelineSummary {
  briefs: number;
  posts: number;
  matrices: number;
  cells: number;
  published: number;
}

interface PipelineDecaySummary {
  critical: number;
  warning: number;
  totalDecaying: number;
  avgDeclinePct: number;
}

export interface ContentPipelineData {
  summary: PipelineSummary | null;
  decay: PipelineDecaySummary | null;
}

interface ContentPipelineLensesProps {
  workspaceId: string;
  tab: ContentPipelineTab;
  pipelineData?: ContentPipelineData;
  contentPipeline?: ContentPipelineSlice;
  workspaceTier: Tier;
  siteLabel?: string | null;
  briefFixContext: FixContext | null;
  prefillNonce: number;
  clearBriefFixContext: () => void;
  onCreateBrief: (keyword: string, pageUrl?: string, suggestedBriefId?: string) => void;
  onOpenTab: (tab: ContentPipelineTab) => void;
}

type HealthRecord = Record<string, unknown> & {
  id: string;
  kind: 'decay' | 'cannibalization';
  title: string;
  severity: string;
  detail: string;
  detectedAt: string;
  source: DecayAlert | CannibalizationWarning | PipelineDecaySummary;
};

function CarryOverPanel({
  tab,
  children,
}: {
  tab: ContentPipelineTab;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4" aria-label={`Content pipeline ${tab} lens`}>
      {children}
    </section>
  );
}

function HealthEmptyIcon({ className }: { className?: string }) {
  return <Icon name="gauge" className={className} />;
}

function healthTone(severity: string): 'red' | 'amber' | 'zinc' {
  if (severity === 'critical' || severity === 'high') return 'red';
  if (severity === 'warning' || severity === 'medium') return 'amber';
  return 'zinc';
}

function healthRows(
  decay: PipelineDecaySummary | null | undefined,
  slice: ContentPipelineSlice | undefined,
): HealthRecord[] {
  const rows: HealthRecord[] = [];
  if (decay && decay.totalDecaying > 0) {
    rows.push({
      id: 'decay-summary',
      kind: 'decay',
      title: `${decay.totalDecaying} decaying page${decay.totalDecaying === 1 ? '' : 's'}`,
      severity: decay.critical > 0 ? 'critical' : 'warning',
      detail: `${decay.critical} critical, ${decay.warning} warning, avg ${formatPercentValue(Math.abs(decay.avgDeclinePct))} decline`,
      detectedAt: 'Current summary',
      source: decay,
    });
  }
  for (const alert of slice?.decayAlerts ?? []) {
    rows.push({
      id: `decay-${alert.pageUrl}`,
      kind: 'decay',
      title: alert.pageUrl,
      severity: alert.isRepeatDecay ? 'critical' : 'warning',
      detail: `${formatInteger(alert.clickDrop)} click drop${alert.hasRefreshBrief ? ' · refresh brief exists' : ''}`,
      detectedAt: formatContentDate(alert.detectedAt),
      source: alert,
    });
  }
  for (const warning of slice?.cannibalizationWarnings ?? []) {
    rows.push({
      id: `cannibalization-${warning.keyword}`,
      kind: 'cannibalization',
      title: warning.keyword,
      severity: warning.severity,
      detail: `${warning.pages.length} competing page${warning.pages.length === 1 ? '' : 's'}`,
      detectedAt: 'Workspace intelligence',
      source: warning,
    });
  }
  return rows;
}

function ContentHealthLens({
  workspaceId,
  pipelineData,
  contentPipeline,
  workspaceTier,
  onOpenTab,
}: {
  workspaceId: string;
  pipelineData?: ContentPipelineData;
  contentPipeline?: ContentPipelineSlice;
  workspaceTier: Tier;
  onOpenTab: (tab: ContentPipelineTab) => void;
}) {
  const decay = pipelineData?.decay;
  const rows = healthRows(decay, contentPipeline);
  const columns: DataColumn[] = [
    {
      key: 'title',
      label: 'Signal',
      width: 'minmax(260px, 1.5fr)',
      render: (_value, record) => {
        const row = record as HealthRecord;
        return (
          <div className="min-w-0">
            <span className="block truncate font-semibold text-[var(--brand-text-bright)]">{row.title}</span>
            <span className="mt-1 block truncate t-caption-sm text-[var(--brand-text-muted)]">{row.detail}</span>
          </div>
        );
      },
    },
    {
      key: 'kind',
      label: 'Type',
      width: '140px',
      render: (_value, record) => (
        <Badge
          label={(record as HealthRecord).kind === 'decay' ? 'Decay' : 'Cannibalization'}
          tone={(record as HealthRecord).kind === 'decay' ? 'amber' : 'blue'}
          variant="soft"
          size="sm"
        />
      ),
    },
    {
      key: 'severity',
      label: 'Severity',
      width: '120px',
      render: (_value, record) => (
        <Badge label={(record as HealthRecord).severity} tone={healthTone((record as HealthRecord).severity)} variant="outline" size="sm" />
      ),
    },
    {
      key: 'detectedAt',
      label: 'Detected',
      width: '160px',
      render: (_value, record) => (
        <span className="t-caption-sm text-[var(--brand-text-muted)]">{(record as HealthRecord).detectedAt}</span>
      ),
    },
  ];
  const advancedUnlocked = workspaceTier === 'growth' || workspaceTier === 'premium';

  return (
    <CarryOverPanel tab="content-health">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricTile label="Decaying Pages" value={decay?.totalDecaying ?? 0} sub="Content decay" accent={(decay?.critical ?? 0) > 0 ? 'var(--red)' : 'var(--amber)'} />
        <MetricTile label="Critical" value={decay?.critical ?? 0} accent="var(--red)" />
        <MetricTile label="Warnings" value={decay?.warning ?? 0} accent="var(--amber)" />
        <MetricTile label="Cannibalization" value={contentPipeline?.cannibalizationWarnings?.length ?? 0} accent="var(--blue)" />
        <MetricTile label="Suggested Briefs" value={contentPipeline?.suggestedBriefs ?? 0} accent="var(--teal)" />
      </div>

      {!advancedUnlocked && (
        <InlineBanner tone="info" title="Advanced repair stays tier-aware">
          Crawl-backed repair and deeper cannibalization workflows remain gated. This acting home shows the signals and routes operators to intake or briefs without adding duplicate repair controls.
        </InlineBanner>
      )}

      <GroupBlock
        title="Acting queue"
        meta="Decay and cannibalization signals route into intake and brief creation from this page."
        stats={[
          { label: 'Signals', value: rows.length, color: rows.length > 0 ? 'var(--amber)' : 'var(--emerald)' },
          { label: 'Workspace', value: workspaceId, color: 'var(--blue)' },
        ]}
        defaultOpen
      >
        <div className="flex flex-col gap-3">
          <DataTable
            columns={columns}
            rows={rows}
            getRowKey={(record) => (record as HealthRecord).id}
            onRowClick={() => onOpenTab('intake')}
            empty={(
              <EmptyState
                icon={HealthEmptyIcon}
                title="No content health signals"
                description="Decay and cannibalization signals will appear here when workspace intelligence flags pages that need action."
              />
            )}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => onOpenTab('intake')}>
              <Icon name="sparkle" size="sm" />
              Review intake
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onOpenTab('briefs')}>
              <Icon name="clipboard" size="sm" />
              Draft brief
            </Button>
          </div>
        </div>
      </GroupBlock>
    </CarryOverPanel>
  );
}

export function ContentPipelineLenses({
  workspaceId,
  tab,
  pipelineData,
  contentPipeline,
  workspaceTier,
  siteLabel,
  briefFixContext,
  prefillNonce,
  clearBriefFixContext,
  onCreateBrief,
  onOpenTab,
}: ContentPipelineLensesProps) {
  if (tab === 'planner') {
    return (
      <CarryOverPanel tab="planner">
        <ContentPlanner workspaceId={workspaceId} embedded />
      </CarryOverPanel>
    );
  }

  if (tab === 'calendar') {
    return (
      <CarryOverPanel tab="calendar">
        <ContentCalendar workspaceId={workspaceId} embedded />
      </CarryOverPanel>
    );
  }

  if (tab === 'intake') {
    return (
      <CarryOverPanel tab="intake">
        <AiSuggested workspaceId={workspaceId} onCreateBrief={onCreateBrief} />
      </CarryOverPanel>
    );
  }

  if (tab === 'briefs') {
    return (
      <CarryOverPanel tab="briefs">
        <ContentBriefs
          key={briefFixContext ? `briefs-${workspaceId}-${prefillNonce}` : `briefs-${workspaceId}`}
          workspaceId={workspaceId}
          fixContext={briefFixContext}
          clearFixContext={clearBriefFixContext}
          embedded
        />
      </CarryOverPanel>
    );
  }

  if (tab === 'posts') {
    return (
      <CarryOverPanel tab="posts">
        <ContentManager workspaceId={workspaceId} embedded />
      </CarryOverPanel>
    );
  }

  if (tab === 'publish') {
    return (
      <CarryOverPanel tab="publish">
        <InlineBanner tone="info" title="Production actions stay with drafts">
          Send-to-client, status progression, Webflow publish, exports, voice scoring, and editor actions remain in the Draft/Post workspace so action bars do not scatter across tabs.
        </InlineBanner>
        <ContentSubscriptions workspaceId={workspaceId} embedded />
      </CarryOverPanel>
    );
  }

  if (tab === 'content-health') {
    return (
      <ContentHealthLens
        workspaceId={workspaceId}
        pipelineData={pipelineData}
        contentPipeline={contentPipeline}
        workspaceTier={workspaceTier}
        onOpenTab={onOpenTab}
      />
    );
  }

  return (
    <CarryOverPanel tab="published">
      <PublishedContentLens workspaceId={workspaceId} siteLabel={siteLabel} />
    </CarryOverPanel>
  );
}
