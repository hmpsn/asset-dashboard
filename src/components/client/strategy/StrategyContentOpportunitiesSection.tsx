import type { RefObject } from 'react';
import { BarChart3, Ban, CheckCircle2, ChevronDown, Eye, FileText, Layers, Sparkles, Target, ThumbsDown, ThumbsUp, Undo2 } from 'lucide-react';
import { kdFraming, kdTooltip } from '../../../lib/kdFraming.js';
import { Button, Icon, SectionCard, TierGate, TrendBadge, type Tier } from '../../ui';
import type { ClientContentRequest, ClientKeywordStrategy } from '../types';
import { fmtNum, intentColor, kdColor } from './strategyKeywordDisplay';

type ContentGap = NonNullable<ClientKeywordStrategy['contentGaps']>[number];
type KeywordFeedbackStatus = 'approved' | 'declined' | 'requested';

interface PricingModalState {
  serviceType: 'brief_only' | 'full_post';
  topic: string;
  targetKeyword: string;
  intent?: string;
  priority?: string;
  rationale?: string;
  source: 'strategy';
  pageType?: 'blog' | 'landing' | 'service' | 'location' | 'product' | 'pillar' | 'resource';
}

interface StrategyContentOpportunitiesSectionProps {
  newContentRef: RefObject<HTMLDivElement | null>;
  effectiveTier: Tier;
  newContentTopicCount: number;
  contentGapsFound: number;
  keywordGapCount: number;
  strategyData: ClientKeywordStrategy;
  expandedSections: Set<string>;
  toggleSection: (section: string) => void;
  contentRequests?: ClientContentRequest[];
  requestedTopics: Set<string>;
  contentPlanKeywords?: Map<string, string>;
  workspaceId?: string;
  getFeedbackStatus: (keyword: string) => KeywordFeedbackStatus | undefined;
  isLoadingFeedback: (keyword: string) => boolean;
  undoFeedback: (keyword: string) => Promise<void>;
  submitFeedback: (keyword: string, status: 'approved' | 'declined', source: string) => Promise<void>;
  onDeclineKeyword: (keyword: string, source: string) => void;
  betaMode: boolean;
  setPricingModal: (modal: PricingModalState) => void;
  briefPrice: number | null;
  fullPostPrice: number | null;
  fmtPrice: (n: number) => string;
  hidePrices?: boolean;
  onTabChange?: (tab: string) => void;
}

const SERP_FEATURE_LABELS: Record<string, string> = {
  featured_snippet: 'Featured snippet',
  people_also_ask: 'People also ask',
  video: 'Video results',
  local_pack: 'Local results',
};

function requestStatusLabel(status?: ClientContentRequest['status']) {
  if (status === 'published') return { icon: CheckCircle2, text: 'Published', tone: 'success' as const };
  if (status === 'delivered') return { icon: CheckCircle2, text: 'In Production', tone: 'brand' as const };
  if (status === 'approved' || status === 'in_progress') return { icon: Sparkles, text: 'In Production', tone: 'brand' as const };
  if (status === 'brief_generated' || status === 'client_review') return { icon: FileText, text: 'Brief Requested', tone: 'warning' as const };
  return { icon: CheckCircle2, text: 'Brief Ordered', tone: 'warning' as const };
}

function requestStatusClass(tone: 'success' | 'brand' | 'warning') {
  if (tone === 'success') return 'text-accent-success bg-emerald-500/10 border-emerald-500/20';
  if (tone === 'brand') return 'text-accent-brand bg-teal-500/10 border-teal-500/20';
  return 'text-accent-warning bg-amber-500/10 border-amber-500/20';
}

function ContentGapCard({
  gap,
  contentRequests,
  requestedTopics,
  contentPlanKeywords,
  workspaceId,
  getFeedbackStatus,
  isLoadingFeedback,
  undoFeedback,
  submitFeedback,
  onDeclineKeyword,
  betaMode,
  setPricingModal,
  briefPrice,
  fullPostPrice,
  fmtPrice,
  hidePrices,
  onTabChange,
}: Omit<StrategyContentOpportunitiesSectionProps, 'newContentRef' | 'effectiveTier' | 'newContentTopicCount' | 'contentGapsFound' | 'keywordGapCount' | 'strategyData' | 'expandedSections' | 'toggleSection'> & { gap: ContentGap }) {
  const matchingReq = contentRequests?.find(r => r.targetKeyword === gap.targetKeyword && r.status !== 'declined');
  const alreadyRequested = matchingReq != null || requestedTopics.has(gap.targetKeyword);
  const planStatus = contentPlanKeywords?.get(gap.targetKeyword.toLowerCase());
  const pageType = gap.suggestedPageType || 'blog';
  const isDataValidated = (gap.volume != null && gap.volume > 0) || (gap.impressions != null && gap.impressions > 0);
  const hasTrendOrSerp = gap.trendDirection || (Array.isArray(gap.serpFeatures) && gap.serpFeatures.length > 0) || gap.competitorProof;

  return (
    <div className="px-3 py-2.5 bg-[var(--surface-3)]/40 rounded-[var(--radius-lg)] border border-[var(--brand-border)] hover:border-teal-500/20 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="t-ui font-semibold text-[var(--brand-text-bright)]">
          {gap.topic}
          {gap.opportunityScore != null && (
            <span className="ml-2 inline-flex items-center rounded-[var(--radius-pill)] bg-blue-500/10 px-2 py-0.5 t-caption font-medium text-accent-info">
              {gap.opportunityScore}/100
            </span>
          )}
        </span>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {gap.intent && (
            <span className={`t-caption-sm uppercase px-1.5 py-0.5 rounded-[var(--radius-pill)] border font-medium ${intentColor(gap.intent)}`}>{gap.intent}</span>
          )}
          {pageType !== 'blog' && (
            <span className="t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-teal-500/10 text-accent-brand border border-teal-500/20 font-medium capitalize">{pageType}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap mb-1.5">
        <span className="t-caption-sm text-accent-brand">&ldquo;{gap.targetKeyword}&rdquo;</span>
        {gap.volume != null && gap.volume > 0 && (
          <span className="t-caption-sm text-[var(--brand-text-muted)] flex items-center gap-0.5"><Icon as={BarChart3} size="sm" />{fmtNum(gap.volume)}/mo</span>
        )}
        {gap.difficulty != null && gap.difficulty > 0 && (
          <>
            <span className={`t-caption-sm font-medium ${kdColor(gap.difficulty)} cursor-help`} title={kdTooltip(gap.difficulty)}>Difficulty {gap.difficulty}</span>
            {kdFraming(gap.difficulty) && (
              <span className="t-caption-sm text-[var(--brand-text-muted)]">{kdFraming(gap.difficulty)}</span>
            )}
          </>
        )}
        {gap.impressions != null && gap.impressions > 0 && (
          <span className="t-caption-sm text-accent-info flex items-center gap-0.5"><Icon as={Eye} size="sm" />{fmtNum(gap.impressions)} impressions</span>
        )}
        {isDataValidated && (
          <span className="t-caption-sm text-accent-success">Data-backed</span>
        )}
      </div>

      {hasTrendOrSerp && (
        <div className="flex items-center gap-2 flex-wrap mb-1.5">
          {gap.trendDirection === 'rising' && (
            <span className="flex items-center gap-0.5 t-caption-sm text-accent-success font-medium"><TrendBadge value={1} suffix="" iconOnly />Rising</span>
          )}
          {gap.trendDirection === 'declining' && (
            <span className="flex items-center gap-0.5 t-caption-sm text-accent-danger font-medium"><TrendBadge value={-1} suffix="" iconOnly />Declining</span>
          )}
          {gap.trendDirection === 'stable' && gap.volume && gap.volume > 0 && (
            <span className="flex items-center gap-0.5 t-caption-sm text-[var(--brand-text-muted)] font-medium"><TrendBadge value={0} hideOnZero={false} suffix="" iconOnly />Stable</span>
          )}
          {Array.isArray(gap.serpFeatures) && gap.serpFeatures.length > 0 && gap.serpFeatures.map(feat => (
            <span key={feat} className="t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-blue-500/10 text-accent-info border border-blue-500/20">
              {SERP_FEATURE_LABELS[feat] ?? feat}
            </span>
          ))}
          {gap.competitorProof && (
            <span className="t-caption-sm text-accent-warning font-medium">{gap.competitorProof}</span>
          )}
        </div>
      )}

      <div className="t-caption-sm text-[var(--brand-text-muted)] leading-snug mb-2">{gap.rationale}</div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        {workspaceId && (() => {
          const fbStatus = getFeedbackStatus(gap.targetKeyword);
          const loading = isLoadingFeedback(gap.targetKeyword);
          if (fbStatus === 'declined') return (
            <div className="flex items-center gap-2 px-2 py-1 rounded-[var(--radius-lg)] bg-red-500/5 border border-red-500/20">
              <Icon as={Ban} size="sm" className="text-accent-danger flex-shrink-0" />
              <span className="t-caption-sm text-accent-danger">Not relevant</span>
              <button onClick={() => undoFeedback(gap.targetKeyword)} disabled={loading} className="t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] flex items-center gap-0.5 transition-colors disabled:opacity-50">
                <Icon as={Undo2} size="sm" /> Undo
              </button>
            </div>
          );
          if (fbStatus === 'approved') return (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-[var(--radius-lg)] bg-emerald-500/5 border border-emerald-500/20">
              <Icon as={ThumbsUp} size="sm" className="text-accent-success" />
              <span className="t-caption-sm text-accent-success">Relevant</span>
            </div>
          );
          return (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => submitFeedback(gap.targetKeyword, 'approved', 'content_gap')}
                disabled={loading}
                className="flex items-center gap-1 px-2 py-1 rounded-[var(--radius-sm)] t-caption-sm text-accent-brand bg-teal-500/10 border border-teal-500/20 hover:bg-teal-500/20 transition-colors disabled:opacity-50"
              >
                <Icon as={ThumbsUp} size="sm" /> Relevant
              </button>
              <button
                onClick={() => onDeclineKeyword(gap.targetKeyword, 'content_gap')}
                disabled={loading}
                className="flex items-center gap-1 px-2 py-1 rounded-[var(--radius-sm)] t-caption-sm text-accent-danger bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-50"
              >
                <Icon as={ThumbsDown} size="sm" /> Not relevant
              </button>
            </div>
          );
        })()}

        {!betaMode && (alreadyRequested ? (
          (() => {
            const status = requestStatusLabel(matchingReq?.status);
            return (
              <span className={`flex items-center gap-1 t-caption-sm px-2.5 py-1.5 rounded-[var(--radius-lg)] border flex-shrink-0 ${requestStatusClass(status.tone)}`}>
                <Icon as={status.icon} size="md" /> {status.text}
              </span>
            );
          })()
        ) : planStatus ? (
          <button
            onClick={() => onTabChange?.('content-plan')}
            className="flex items-center gap-1 t-caption-sm text-accent-brand bg-teal-500/10 px-2.5 py-1.5 rounded-[var(--radius-lg)] border border-teal-500/20 flex-shrink-0 hover:bg-teal-500/20 transition-colors"
            title="View in Content Plan"
          >
            <Icon as={Layers} size="md" />
            {planStatus === 'published' ? 'Published' : planStatus === 'approved' ? 'Approved' : planStatus === 'in_progress' || planStatus === 'brief_generated' ? 'In Progress' : 'Planned'}
          </button>
        ) : (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setPricingModal({ serviceType: 'brief_only', topic: gap.topic, targetKeyword: gap.targetKeyword, intent: gap.intent, priority: gap.priority, rationale: gap.rationale, source: 'strategy', pageType })}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] bg-teal-600/20 border border-teal-500/30 t-caption-sm text-accent-brand font-medium hover:bg-teal-600/40 transition-all"
            >
              <Icon as={FileText} size="sm" /> Get Brief
              {!hidePrices && briefPrice != null && <span className="opacity-70 ml-0.5">{fmtPrice(briefPrice)}</span>}
            </button>
            {(hidePrices || fullPostPrice != null) && (
              <Button
                variant="primary"
                size="sm"
                icon={Sparkles}
                onClick={() => setPricingModal({ serviceType: 'full_post', topic: gap.topic, targetKeyword: gap.targetKeyword, intent: gap.intent, priority: gap.priority, rationale: gap.rationale, source: 'strategy', pageType })}
              >
                Full Post
                {!hidePrices && fullPostPrice != null && <span className="opacity-70 ml-0.5">{fmtPrice(fullPostPrice)}</span>}
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function StrategyContentOpportunitiesSection({
  newContentRef,
  effectiveTier,
  newContentTopicCount,
  contentGapsFound,
  keywordGapCount,
  strategyData,
  expandedSections,
  toggleSection,
  contentRequests,
  requestedTopics,
  contentPlanKeywords,
  workspaceId,
  getFeedbackStatus,
  isLoadingFeedback,
  undoFeedback,
  submitFeedback,
  onDeclineKeyword,
  betaMode,
  setPricingModal,
  briefPrice,
  fullPostPrice,
  fmtPrice,
  hidePrices,
  onTabChange,
}: StrategyContentOpportunitiesSectionProps) {
  return (
    <div ref={newContentRef}>
      <TierGate tier={effectiveTier} required="growth" feature="Create Content" teaser={`${newContentTopicCount} content ideas identified - upgrade to unlock recommendations`}>
        <SectionCard noPadding>
          <button
            onClick={() => toggleSection('new-content')}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--surface-3)]/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-[var(--radius-lg)] bg-teal-500/20 flex items-center justify-center">
                <Icon as={FileText} size="md" className="text-accent-brand" />
              </div>
              <div className="text-left">
                <div className="t-ui font-medium text-[var(--brand-text-bright)]">Create Content</div>
                <div className="t-caption-sm text-[var(--brand-text-muted)]">{contentGapsFound} strong ideas · {keywordGapCount} review candidates</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="t-caption font-bold text-accent-brand bg-teal-500/10 px-2 py-0.5 rounded-[var(--radius-pill)] border border-teal-500/20">{newContentTopicCount}</span>
              <ChevronDown className={`w-4 h-4 text-[var(--brand-text-muted)] transition-transform ${expandedSections.has('new-content') ? '' : '-rotate-90'}`} />
            </div>
          </button>

          {expandedSections.has('new-content') && (
            <div className="px-4 pb-4 border-t border-[var(--brand-border)]/50">
              <p className="t-body text-[var(--brand-text-muted)] mt-3 mb-3 leading-relaxed">
                Clear new-page recommendations come first. Noisier keyword ideas are separated below so they can be reviewed without feeling like automatic recommendations.
              </p>

              {strategyData.contentGaps && strategyData.contentGaps.length > 0 && (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <Icon as={FileText} size="md" className="text-accent-brand" />
                    <span className="t-caption font-medium text-[var(--brand-text)]">Strong Recommendations</span>
                    <span className="t-caption-sm text-[var(--brand-text-muted)]">({strategyData.contentGaps.length})</span>
                  </div>
                  <div className="space-y-2">
                    {[...strategyData.contentGaps]
                      .sort((a, b) => (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0))
                      .slice(0, expandedSections.has('new-content-gaps-all') ? undefined : 6)
                      .map((gap, i) => (
                        <ContentGapCard
                          key={i}
                          gap={gap}
                          contentRequests={contentRequests}
                          requestedTopics={requestedTopics}
                          contentPlanKeywords={contentPlanKeywords}
                          workspaceId={workspaceId}
                          getFeedbackStatus={getFeedbackStatus}
                          isLoadingFeedback={isLoadingFeedback}
                          undoFeedback={undoFeedback}
                          submitFeedback={submitFeedback}
                          onDeclineKeyword={onDeclineKeyword}
                          betaMode={betaMode}
                          setPricingModal={setPricingModal}
                          briefPrice={briefPrice}
                          fullPostPrice={fullPostPrice}
                          fmtPrice={fmtPrice}
                          hidePrices={hidePrices}
                          onTabChange={onTabChange}
                        />
                      ))}
                  </div>
                  {strategyData.contentGaps.length > 6 && (
                    <button
                      onClick={() => toggleSection('new-content-gaps-all')}
                      className="w-full mt-3 text-center py-2 t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors border border-dashed border-[var(--brand-border)] rounded-[var(--radius-lg)] hover:border-[var(--brand-border-strong)]"
                    >
                      {expandedSections.has('new-content-gaps-all') ? 'Show fewer' : `View all ${strategyData.contentGaps.length} opportunities`}
                    </button>
                  )}
                </>
              )}

              {strategyData.keywordGaps && strategyData.keywordGaps.length > 0 && (
                <div className="mt-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon as={Target} size="md" className="text-accent-warning" />
                    <span className="t-caption font-medium text-[var(--brand-text)]">Review Keyword Ideas</span>
                    <span className="t-caption-sm text-[var(--brand-text-muted)]">({strategyData.keywordGaps.length})</span>
                  </div>
                  <p className="t-caption-sm text-[var(--brand-text-muted)] mb-2">
                    Search terms seen in competitor or market data. These are review candidates, not automatic recommendations.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {strategyData.keywordGaps.slice(0, expandedSections.has('competitor-gaps-all') ? undefined : 6).map((gap, i) => (
                      <div key={i} className="flex items-center justify-between px-3 py-2 rounded-[var(--radius-lg)] bg-[var(--surface-1)]/50 border border-[var(--brand-border)]/50">
                        <span className="t-caption-sm text-[var(--brand-text)] font-medium truncate mr-2">{gap.keyword}</span>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {gap.volume != null && gap.volume > 0 && <span className="t-caption-sm text-[var(--brand-text-muted)]">{gap.volume.toLocaleString()}</span>}
                          {gap.difficulty != null && gap.difficulty > 0 && (
                            <span className={`t-caption-sm font-medium ${kdColor(gap.difficulty)}`}>
                              Difficulty {gap.difficulty}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {strategyData.keywordGaps.length > 6 && (
                    <button
                      onClick={() => toggleSection('competitor-gaps-all')}
                      className="w-full mt-2 text-center py-2 t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
                    >
                      {expandedSections.has('competitor-gaps-all') ? 'Show fewer' : `View all ${strategyData.keywordGaps.length}`}
                    </button>
                  )}
                </div>
              )}

              {strategyData.opportunities.length > 0 && (
                <div className="mt-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon as={Sparkles} size="md" className="text-accent-brand" />
                    <span className="t-caption font-medium text-[var(--brand-text)]">Additional Page Ideas</span>
                    <span className="t-caption-sm text-[var(--brand-text-muted)]">({strategyData.opportunities.length})</span>
                  </div>
                  <p className="t-caption-sm text-[var(--brand-text-muted)] mb-2">Additional keywords your existing pages could target.</p>
                  <div className="flex flex-wrap gap-1.5">
                    {strategyData.opportunities.slice(0, 10).map((opp, i) => (
                      <span key={i} className="t-caption-sm text-[var(--brand-text-muted)] bg-[var(--surface-1)]/50 border border-[var(--brand-border)]/50 px-2 py-1 rounded-[var(--radius-sm)]">{opp}</span>
                    ))}
                    {strategyData.opportunities.length > 10 && (
                      <span className="t-caption-sm text-[var(--brand-text-muted)] px-1 py-1">+{strategyData.opportunities.length - 10} more</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </SectionCard>
      </TierGate>
    </div>
  );
}
