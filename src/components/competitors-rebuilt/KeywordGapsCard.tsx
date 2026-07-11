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
  SectionCard,
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
  competitorPosition: number;
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

function kdTone(value: number): BadgeTone {
  if (value < 30) return 'emerald';
  if (value < 60) return 'amber';
  return 'red';
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
    competitorPosition: gap.competitorPosition,
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
      className="flex min-w-[320px] flex-wrap items-center justify-end gap-1.5"
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
        onClick={() => navigate(`${adminPath(workspaceId, 'content-pipeline')}?tab=briefs`, {
          state: {
            fixContext: {
              targetRoute: 'content-pipeline',
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
      width: 'minmax(250px, 1fr)',
      render: (_value, record) => {
        const gap = (record as GapRecord).source;
        return (
          <span className="min-w-0">
            <span className="t-ui block truncate font-semibold text-[var(--brand-text-bright)]">{gap.keyword}</span>
            <span className="t-label mt-0.5 block truncate font-normal normal-case tracking-normal text-[var(--brand-text-muted)]">
              {gap.competitorDomain} ranks #{gap.competitorPosition} · you are not ranking
            </span>
          </span>
        );
      },
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
        return <Badge label={`KD ${difficulty}`} tone={kdTone(difficulty)} variant="soft" size="sm" />;
      },
      sortable: true,
    },
    {
      key: 'competitorPosition',
      label: 'Comp rank',
      width: '96px',
      align: 'right',
      render: (_value, record) => {
        const gap = (record as GapRecord).source;
        return <span className="font-mono text-[var(--orange)]">#{gap.competitorPosition}</span>;
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
    <section aria-labelledby="keyword-gaps-title">
      <h2 id="keyword-gaps-title" className="sr-only" aria-label="Keyword gaps" />
      <SectionCard
        title="Keyword gaps"
        subtitle="High-value terms competitors rank for and you do not"
        titleIcon={<Icon name="key" size="sm" className="text-[var(--teal)]" />}
        iconChip
        titleExtra={(
          <span className="flex items-center gap-1.5">
            <Badge label="Evidence only" tone="orange" variant="soft" size="sm" />
            {usingFallback && <Badge label="from strategy" tone="amber" variant="soft" size="sm" />}
          </span>
        )}
        action={<span className="eyebrow normal-case tracking-normal text-[var(--brand-text-muted)]">{rows.length} opportunities</span>}
        noPadding
        variant="subtle"
      >
        {liveError && usingFallback && (
          <div className="px-[18px] pt-4">
            <InlineBanner tone="warning" title="Showing the last strategy run">
              Keyword gaps are from the last stored strategy run.
            </InlineBanner>
          </div>
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
          className="rounded-none border-0 bg-transparent"
        />
      </SectionCard>
    </section>
  );
}
