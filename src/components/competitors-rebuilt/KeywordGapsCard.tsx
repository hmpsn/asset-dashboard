// @ds-rebuilt
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { recommendations } from '../../api/misc';
import { useAdminRecommendationSet } from '../../hooks/admin/useAdminRecommendations';
import { buildHubDeepLinkQuery } from '../../lib/keywordHubDeepLink';
import { queryKeys } from '../../lib/queryKeys';
import { adminPath } from '../../routes';
import { useToast } from '../Toast';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  Icon,
  InlineBanner,
  type BadgeTone,
  type DataColumn,
} from '../ui';
import { mutationErrorMessage } from './competitorMutationFeedback';
import type { KeywordGap } from './types';
import type { Recommendation } from '../../../shared/types/recommendations';

interface KeywordGapsCardProps {
  workspaceId: string;
  liveGaps: KeywordGap[];
  cachedGaps: KeywordGap[];
  liveError: boolean;
  showSend: boolean;
}

type GapRecord = Record<string, unknown> & {
  source: KeywordGap;
  keyword: string;
  volume: number;
  difficulty: number;
  competitor: string;
};

const NUMBER_FORMAT = new Intl.NumberFormat('en-US');

const CLIENT_STATUS_DISPLAY: Record<string, { label: string; tone: BadgeTone }> = {
  approved: { label: 'Client approved', tone: 'emerald' },
  declined: { label: 'Client declined', tone: 'red' },
  discussing: { label: 'Discussing', tone: 'amber' },
  sent: { label: 'Sent', tone: 'teal' },
};

function EmptyIcon({ className }: { className?: string }) {
  return <Icon name="search" className={className} />;
}

function kdColor(value: number): string {
  if (value < 30) return 'var(--emerald)';
  if (value < 60) return 'var(--amber)';
  return 'var(--red)';
}

function gapKey(gap: KeywordGap): string {
  return `${gap.keyword}:${gap.competitorDomain}`;
}

function toRecord(gap: KeywordGap): GapRecord {
  return {
    source: gap,
    keyword: gap.keyword,
    volume: gap.volume,
    difficulty: gap.difficulty,
    competitor: gap.competitorDomain,
  };
}

function GapActions({
  workspaceId,
  gap,
  rec,
  showSend,
  alreadySent,
  onSent,
}: {
  workspaceId: string;
  gap: KeywordGap;
  rec?: Recommendation;
  showSend: boolean;
  alreadySent: boolean;
  onSent: (key: string) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const sendMutation = useMutation({
    mutationFn: async () => {
      const minted = rec ?? await recommendations.mintCompetitor(workspaceId, {
        keyword: gap.keyword,
        competitorDomain: gap.competitorDomain,
      });
      return recommendations.send(workspaceId, minted.id);
    },
    onSuccess: () => {
      onSent(gapKey(gap));
      toast('Competitor recommendation sent to client', 'success');
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.recommendations(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.shared.recommendations(workspaceId) });
    },
    onError: (error) => toast(mutationErrorMessage(error, 'Send to client failed'), 'error'),
  });

  const isSent = alreadySent || rec?.clientStatus === 'sent';
  const feedback = rec?.clientStatus ? CLIENT_STATUS_DISPLAY[rec.clientStatus] : undefined;

  return (
    <div
      className="flex min-w-[220px] flex-wrap items-center justify-end gap-1.5"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Button
        size="sm"
        variant="ghost"
        onClick={() => navigate(adminPath(workspaceId, 'seo-keywords') + buildHubDeepLinkQuery({ keyword: gap.keyword }))}
      >
        <Icon name="external" size="sm" />
        View in Hub
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => navigate(adminPath(workspaceId, 'seo-briefs'), {
          state: {
            fixContext: {
              targetRoute: 'seo-briefs',
              primaryKeyword: gap.keyword,
              pageName: gap.keyword,
            },
          },
        })}
      >
        <Icon name="doc" size="sm" />
        Create brief
      </Button>
      {showSend && (
        isSent ? (
          <Badge label="Sent" tone="teal" variant="outline" size="sm" />
        ) : (
          <Button
            size="sm"
            variant="primary"
            disabled={sendMutation.isPending || !gap.keyword}
            onClick={() => sendMutation.mutate()}
          >
            <Icon name="send" size="sm" />
            Send to client
          </Button>
        )
      )}
      {showSend && feedback && feedback.label !== 'Sent' && (
        <Badge label={feedback.label} tone={feedback.tone} variant="soft" size="sm" />
      )}
      {showSend && rec?.insight && (
        <span className="basis-full t-caption-sm text-[var(--brand-text-muted)]">{rec.insight}</span>
      )}
    </div>
  );
}

export function KeywordGapsCard({
  workspaceId,
  liveGaps,
  cachedGaps,
  liveError,
  showSend,
}: KeywordGapsCardProps) {
  const recSet = useAdminRecommendationSet(showSend ? workspaceId : undefined, { enabled: showSend });
  const [sentGaps, setSentGaps] = useState<Set<string>>(new Set());
  const effectiveGaps = liveGaps.length > 0 ? liveGaps : cachedGaps;
  const usingFallback = effectiveGaps.length > 0 && liveGaps.length === 0 && cachedGaps.length > 0;
  const rows = useMemo(() => effectiveGaps.map(toRecord), [effectiveGaps]);

  const findCompetitorRec = (keyword: string): Recommendation | undefined =>
    recSet.data?.recommendations.find((rec) => rec.type === 'competitor' && rec.targetKeyword === keyword);

  const columns = useMemo<DataColumn[]>(() => [
    {
      key: 'keyword',
      label: 'Keyword',
      width: 'minmax(210px, 1.4fr)',
      render: (_value, record) => <span className="truncate font-semibold text-[var(--brand-text-bright)]">{(record as GapRecord).source.keyword}</span>,
      sortable: true,
    },
    {
      key: 'volume',
      label: 'Vol/mo',
      width: '96px',
      align: 'right',
      render: (_value, record) => NUMBER_FORMAT.format((record as GapRecord).source.volume),
      sortable: true,
    },
    {
      key: 'difficulty',
      label: 'KD',
      width: '76px',
      align: 'right',
      render: (_value, record) => {
        const difficulty = (record as GapRecord).source.difficulty;
        return <span style={{ color: kdColor(difficulty) }}>{difficulty}%</span>;
      },
      sortable: true,
    },
    {
      key: 'competitor',
      label: 'Competitor',
      width: 'minmax(170px, 1fr)',
      render: (_value, record) => {
        const gap = (record as GapRecord).source;
        return (
          <span className="truncate">
            {gap.competitorDomain} <span className="t-mono text-[var(--blue)]">#{gap.competitorPosition}</span>
          </span>
        );
      },
      sortable: true,
    },
    {
      key: 'actions',
      label: 'Actions',
      width: 'minmax(360px, 1.8fr)',
      align: 'right',
      render: (_value, record) => {
        const gap = (record as GapRecord).source;
        return (
          <GapActions
            workspaceId={workspaceId}
            gap={gap}
            rec={findCompetitorRec(gap.keyword)}
            showSend={showSend}
            alreadySent={sentGaps.has(gapKey(gap))}
            onSent={(key) => setSentGaps((current) => new Set([...current, key]))}
          />
        );
      },
    },
  ], [recSet.data?.recommendations, sentGaps, showSend, workspaceId]);

  return (
    <section className="flex flex-col gap-3" aria-labelledby="keyword-gaps-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="keyword-gaps-title" className="t-ui font-semibold text-[var(--brand-text-bright)]">
              Keyword gaps
            </h2>
            <Badge label="Evidence only" tone="orange" variant="soft" size="sm" />
            {usingFallback && <Badge label="from strategy" tone="amber" variant="soft" size="sm" />}
          </div>
          <p className="t-caption-sm text-[var(--brand-text-muted)]">
            High-value terms competitors rank for and you do not. Use Hub or briefs to turn a gap into work.
          </p>
        </div>
        <Badge label={`${rows.length} opportunities`} tone="blue" variant="soft" size="sm" />
      </div>

      {liveError && usingFallback && (
        <InlineBanner tone="warning" title="Showing the last strategy run">
          Keyword gaps are from the last stored strategy run.
        </InlineBanner>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => gapKey((row as GapRecord).source)}
        empty={(
          <EmptyState
            icon={EmptyIcon}
            title="No competitor gaps returned"
            description="The latest scan did not return gap evidence for this competitor set."
          />
        )}
      />
    </section>
  );
}
