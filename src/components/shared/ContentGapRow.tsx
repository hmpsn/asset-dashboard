// SHARED PRIMITIVE — Wave 2 T4 (#5, FLAG-SENSITIVE)
//
// ONE audience-parameterized content-gap / recommendation row, subsuming the
// metric-and-badge body previously hand-rolled three times:
//   - admin       → src/components/strategy/ContentGaps.tsx
//   - strategy-tab → src/components/client/strategy/StrategyContentOpportunitiesSection.tsx (ContentGapCard)
//   - briefing     → src/components/client/Briefing/RecommendedForYou.tsx  (FLAG-SENSITIVE)
//
// The component is parameterized by SIX axes (audit §ContentGapRow):
//   (a) KD prefix          — 'KD' | 'Difficulty'
//   (b) SERP label set     — 'plain' | 'descriptive' | 'emoji'
//   (c) intentTone map     — supplied per surface (admin and client diverge)
//   (d) est-clicks mode    — 'always' | 'flag-gated' | 'never'
//   (e) ovGainActive       — briefing-only; DEFAULT false (triple OFF-default contract)
//   (f) backfilled slot    — field-presence-driven 'Expanded pick' affordance
//
// Each surface keeps its own card chrome (SectionCard / signature card) and its own
// header-right widgets + action footer via the `headerRight` / `footer` render slots —
// the shared part is strictly the metric-and-badge body.
//
// FLAG-OFF BYTE-IDENTITY (HARD — gen-quality Contract 3, audit §flag-OFF):
//   Δ1 opportunity badge: ovGainActive ? `Opportunity ${score}` : `${score}/100`
//                         (Badge tone="blue", shape="pill", className="ml-2").
//   Δ2 est-clicks line  : !ovGainActive && volume>0 → `~{fmtNum(round(volume*0.103))}/mo
//                         est. clicks at rank #3`, suppressed when impact<10.
//   The 0.103 constant and the <10 floor are part of the OFF byte contract — verbatim.
//   ovGainActive defaults false; absent/undefined/explicit-false all render the OFF surface.
//   No client useFeatureFlag read — the server-resolved prop is threaded as-is.

import type { ReactNode } from 'react';
import { BarChart3, Eye, ArrowUpRight, Swords, MessageCircleQuestion } from 'lucide-react';
import { Badge, Icon, TrendBadge, type BadgeTone } from '../ui';
import { fmtNum } from '../../utils/formatNumbers';
import { kdColor } from '../page-intelligence/pageIntelligenceDisplay';
import { kdFraming, kdTooltip } from '../../lib/kdFraming';

export type ContentGapAudience = 'admin' | 'strategy-tab' | 'briefing';

/** Minimal data shape shared by the 3 surfaces' gap/recommendation rows. */
export interface ContentGapRowData {
  topic: string;
  targetKeyword: string;
  intent?: string;
  rationale?: string;
  suggestedPageType?: string;
  volume?: number;
  difficulty?: number;
  impressions?: number;
  competitorProof?: string;
  trendDirection?: 'rising' | 'declining' | 'stable';
  serpFeatures?: string[];
  serpTargeting?: string[];
  questionKeywords?: string[];
  opportunityScore?: number;
  /** SEO Gen-Quality P2 — deterministic-floor backfill flag (strategy-tab only). */
  backfilled?: boolean;
}

export interface ContentGapRowProps {
  data: ContentGapRowData;
  audience: ContentGapAudience;
  /**
   * intentTone map (axis c). Supplied per surface because admin and client diverge
   * (admin: commercial→blue; client: commercial→teal). No default — each call site
   * passes its existing map so the intent badge tone is byte-identical. The shared row
   * renders the leading intent badge; per-surface header-right widgets (priority,
   * page-type) come via `headerRight`.
   */
  intentTone: (intent?: string) => BadgeTone;
  /**
   * SEO Gen-Quality P4 (Contract 3) flag gate (axis e). BRIEFING ONLY.
   * Resolved server-side and threaded via the briefing response. DEFAULT false.
   * Absent / undefined / explicit false all render the pre-P4 (OFF) surface.
   * Ignored unless `audience === 'briefing'` (admin/strategy-tab never receive it).
   */
  ovGainActive?: boolean;
  /** Header-right cluster (intent/priority/page-type badges) — per-surface chrome. */
  headerRight?: ReactNode;
  /** Action footer rendered after the metric rows — per-surface CTA/feedback chrome. */
  footer?: ReactNode;
}

// ─── Per-audience presentation (axis-resolution tables) ──────────────────────
// Each audience hard-codes its exact label text + class strings so the shared row
// reproduces each surface byte-for-byte. KD color is the ONE canonical authority
// (T2 kdColor, 30/50/70) across all three — see the band-change note in the PR report.

interface AudienceChrome {
  topicClass: string;
  targetKeyword: (kw: string) => string;
  targetKeywordClass: string;
  volumeClass: string;
  kdPrefix: 'KD' | 'Difficulty';
  impressionsClass: string;
  impressionsSuffix: string;
  competitorClass: string;
  trendRisingClass: string;
  trendDecliningClass: string;
  trendStableClass: string;
  serpLabels: 'plain' | 'descriptive' | 'emoji';
  estClicks: 'always' | 'flag-gated' | 'never';
  estClicksClass: string;
  serpTargetingBorder: string;
  serpTargetingText: string;
  questionIconClass: string;
  questionTextClass: string;
  rationaleClass: string;
}

const CHROME: Record<ContentGapAudience, AudienceChrome> = {
  admin: {
    topicClass: 't-body font-medium text-[var(--brand-text-bright)]',
    targetKeyword: (kw) => `Target keyword: “${kw}”`,
    targetKeywordClass: 't-caption-sm text-teal-400',
    volumeClass: 't-caption-sm text-[var(--brand-text)] flex items-center gap-0.5',
    kdPrefix: 'KD',
    impressionsClass: 't-caption-sm text-blue-400 flex items-center gap-0.5',
    impressionsSuffix: 'impr',
    competitorClass: 'flex items-center gap-0.5 t-caption-sm text-orange-400 font-medium',
    trendRisingClass: 'flex items-center gap-0.5 t-caption-sm text-emerald-400 font-medium',
    trendDecliningClass: 'flex items-center gap-0.5 t-caption-sm text-red-400 font-medium',
    trendStableClass: 'flex items-center gap-0.5 t-caption-sm text-[var(--brand-text)] font-medium',
    serpLabels: 'plain',
    estClicks: 'always',
    estClicksClass: 't-caption-sm text-blue-400/70 flex items-center gap-0.5',
    serpTargetingBorder: 'mt-1.5 pl-2 border-l-2 border-yellow-500/20',
    serpTargetingText: 't-caption-sm text-yellow-400/80 leading-relaxed',
    questionIconClass: 'text-cyan-400 flex-shrink-0',
    questionTextClass: 't-caption-sm text-cyan-400/80 italic',
    rationaleClass: 't-caption-sm text-[var(--brand-text-muted)] mt-0.5',
  },
  briefing: {
    topicClass: 't-ui font-medium text-[var(--brand-text-bright)]',
    targetKeyword: (kw) => `Target keyword: “${kw}”`,
    targetKeywordClass: 't-caption-sm text-accent-brand',
    volumeClass: 't-caption-sm text-[var(--brand-text)] flex items-center gap-0.5',
    kdPrefix: 'KD',
    impressionsClass: 't-caption-sm text-accent-info flex items-center gap-0.5',
    impressionsSuffix: 'impr',
    competitorClass: 'flex items-center gap-0.5 t-caption-sm text-accent-warning font-medium',
    trendRisingClass: 'flex items-center gap-0.5 t-caption-sm text-accent-success font-medium',
    trendDecliningClass: 'flex items-center gap-0.5 t-caption-sm text-accent-danger font-medium',
    trendStableClass: 'flex items-center gap-0.5 t-caption-sm text-[var(--brand-text)] font-medium',
    serpLabels: 'emoji',
    estClicks: 'flag-gated',
    estClicksClass: 't-caption-sm text-accent-info flex items-center gap-0.5',
    serpTargetingBorder: 'mt-1.5 pl-2 border-l-2 border-amber-500/20',
    serpTargetingText: 't-caption-sm text-accent-warning leading-relaxed',
    questionIconClass: 'text-[var(--brand-text-muted)] flex-shrink-0',
    questionTextClass: 't-caption-sm text-[var(--brand-text-muted)] italic',
    rationaleClass: 't-caption-sm text-[var(--brand-text-muted)] mt-0.5',
  },
  'strategy-tab': {
    topicClass: 't-body font-semibold text-[var(--brand-text-bright)]',
    targetKeyword: (kw) => `“${kw}”`,
    targetKeywordClass: 't-caption-sm text-accent-brand',
    volumeClass: 't-caption-sm text-[var(--brand-text-muted)] flex items-center gap-0.5',
    kdPrefix: 'Difficulty',
    impressionsClass: 't-caption-sm text-accent-info flex items-center gap-0.5',
    impressionsSuffix: 'impressions',
    competitorClass: 't-caption-sm text-accent-warning font-medium',
    trendRisingClass: 'flex items-center gap-0.5 t-caption-sm text-accent-success font-medium',
    trendDecliningClass: 'flex items-center gap-0.5 t-caption-sm text-accent-danger font-medium',
    trendStableClass: 'flex items-center gap-0.5 t-caption-sm text-[var(--brand-text-muted)] font-medium',
    serpLabels: 'descriptive',
    estClicks: 'never',
    estClicksClass: '',
    serpTargetingBorder: '',
    serpTargetingText: '',
    questionIconClass: '',
    questionTextClass: '',
    rationaleClass: 't-caption-sm text-[var(--brand-text-muted)] leading-snug mb-2',
  },
};

const SERP_DESCRIPTIVE: Record<string, string> = {
  featured_snippet: 'Featured snippet',
  people_also_ask: 'People also ask',
  video: 'Video results',
  local_pack: 'Local results',
};

const SERP_EMOJI: Record<string, string> = {
  featured_snippet: '⬜ Snippet',
  people_also_ask: '❓ PAA',
  video: '▶ Video',
  local_pack: '📍 Local',
};

const SERP_PLAIN: Record<string, string> = {
  featured_snippet: 'Snippet',
  people_also_ask: 'PAA',
  video: 'Video',
  local_pack: 'Local',
};

/** Render the SERP-feature badges for the active label set, preserving order. */
function serpBadges(serpFeatures: string[] | undefined, set: 'plain' | 'descriptive' | 'emoji'): ReactNode {
  if (!Array.isArray(serpFeatures) || serpFeatures.length === 0) return null;
  if (set === 'descriptive') {
    // Strategy-tab: maps every feature key (unknown keys fall through to the raw key).
    return (
      <>
        {serpFeatures.map((feat) => (
          <Badge key={feat} label={SERP_DESCRIPTIVE[feat] ?? feat} tone="blue" variant="outline" />
        ))}
      </>
    );
  }
  // admin (plain) + briefing (emoji): fixed ordered set, only the four known keys.
  const labels = set === 'emoji' ? SERP_EMOJI : SERP_PLAIN;
  const order = ['featured_snippet', 'people_also_ask', 'video', 'local_pack'];
  return (
    <div className="flex flex-wrap gap-1">
      {order.map((key) =>
        serpFeatures.includes(key) ? (
          <Badge key={key} label={labels[key]} tone="blue" variant="outline" />
        ) : null,
      )}
    </div>
  );
}

export function ContentGapRow({
  data,
  audience,
  intentTone,
  ovGainActive = false,
  headerRight,
  footer,
}: ContentGapRowProps) {
  const chrome = CHROME[audience];
  const { difficulty, volume, impressions } = data;
  // ovGainActive only gates the briefing surface; admin/strategy-tab never receive it.
  const flagActive = audience === 'briefing' ? ovGainActive : false;
  const wrapperClass =
    audience === 'strategy-tab'
      ? 'px-3 py-2.5 bg-[var(--surface-3)]/40 rounded-[var(--radius-lg)] border border-[var(--brand-border)] hover:border-teal-500/20 transition-colors'
      : 'px-3 py-2.5 bg-[var(--surface-3)]/40 rounded-[var(--radius-lg)] border border-[var(--brand-border)]';

  // Header row: topic + opportunity-score badge (+ Expanded pick) on the left,
  // per-surface header-right cluster on the right.
  const header = (
    <div
      className={
        audience === 'strategy-tab'
          ? 'flex items-start justify-between gap-2 mb-1'
          : 'flex items-center justify-between'
      }
    >
      <span className={chrome.topicClass}>
        {data.topic}
        {/* Δ1 (briefing flag-gated; admin/strategy-tab always `NN/100`). */}
        {data.opportunityScore != null && (
          <Badge
            label={flagActive ? `Opportunity ${data.opportunityScore}` : `${data.opportunityScore}/100`}
            tone="blue"
            shape="pill"
            className="ml-2"
          />
        )}
        {/* (f) backfilled 'Expanded pick' slot — field-presence-driven (strategy-tab only). */}
        {data.backfilled && (
          <Badge label="Expanded pick" tone="zinc" variant="outline" shape="pill" className="ml-2" />
        )}
      </span>
      <div className={audience === 'strategy-tab' ? 'flex items-center gap-1.5 flex-shrink-0' : 'flex items-center gap-2'}>
        {/* (c) intentTone — leading intent badge (per-surface tone map). */}
        {data.intent != null && (
          <Badge label={data.intent} tone={intentTone(data.intent)} variant="outline" shape="pill" className="uppercase" />
        )}
        {headerRight}
      </div>
    </div>
  );

  // Metric row: target keyword + volume + KD + impressions + (est-clicks | Data-backed).
  const isDataValidated = (volume != null && volume > 0) || (impressions != null && impressions > 0);
  const metrics = (
    <div className={`flex items-center gap-${audience === 'strategy-tab' ? '3' : '2'} flex-wrap${audience === 'strategy-tab' ? ' mb-1.5' : ''}`}>
      <span className={chrome.targetKeywordClass}>{chrome.targetKeyword(data.targetKeyword)}</span>
      {volume != null && (audience === 'strategy-tab' ? volume > 0 : true) && (
        <span className={chrome.volumeClass}>
          <Icon as={BarChart3} size="sm" />
          {fmtNum(volume)}/mo
        </span>
      )}
      {difficulty != null && difficulty > 0 && (
        <>
          <span className={`t-caption-sm font-medium ${kdColor(difficulty)} cursor-help`} title={kdTooltip(difficulty)}>
            {chrome.kdPrefix} {difficulty}
          </span>
          {kdFraming(difficulty) && (
            <span
              className={
                audience === 'briefing'
                  ? 't-caption-sm text-[var(--brand-text-muted)] leading-none'
                  : 't-caption-sm text-[var(--brand-text-muted)]'
              }
            >
              {kdFraming(difficulty)}
            </span>
          )}
        </>
      )}
      {impressions != null && impressions > 0 && (
        <span className={chrome.impressionsClass}>
          <Icon as={Eye} size="sm" className={audience === 'strategy-tab' ? undefined : (audience === 'admin' ? 'text-blue-400' : 'text-accent-info')} />
          {fmtNum(impressions)} {chrome.impressionsSuffix}
        </span>
      )}
      {/* (d) est-clicks mode. */}
      {chrome.estClicks === 'never'
        ? isDataValidated && <span className="t-caption-sm text-accent-success">Data-backed</span>
        : (chrome.estClicks === 'always' || !flagActive) &&
          volume != null &&
          volume > 0 &&
          (() => {
            // Δ2 — position-3 CTR floor (10.3%). The 0.103 constant and <10 floor are
            // part of the flag-OFF byte contract; do not "clean up".
            const impact = Math.round(volume * 0.103);
            if (impact < 10) return null;
            return (
              <span className={chrome.estClicksClass}>
                <Icon as={ArrowUpRight} size="sm" className={audience === 'admin' ? 'text-blue-400/70' : 'text-accent-info'} />
                ~{fmtNum(impact)}/mo est. clicks at rank #3
              </span>
            );
          })()}
    </div>
  );

  // Trend + SERP + competitor row.
  const hasTrendOrSerp =
    data.trendDirection || (Array.isArray(data.serpFeatures) && data.serpFeatures.length > 0) || data.competitorProof;
  const trendRow = (
    <div
      className={
        audience === 'strategy-tab'
          ? 'flex items-center gap-2 flex-wrap mb-1.5'
          : 'flex items-center gap-2 flex-wrap mt-1'
      }
    >
      {data.trendDirection === 'rising' && (
        <span className={chrome.trendRisingClass}>
          <TrendBadge value={1} suffix="" iconOnly /> Rising
        </span>
      )}
      {data.trendDirection === 'declining' && (
        <span className={chrome.trendDecliningClass}>
          <TrendBadge value={-1} suffix="" iconOnly /> Declining
        </span>
      )}
      {data.trendDirection === 'stable' && volume != null && volume > 0 && (
        <span className={chrome.trendStableClass}>
          <TrendBadge value={0} hideOnZero={false} suffix="" iconOnly /> Stable
        </span>
      )}
      {serpBadges(data.serpFeatures, chrome.serpLabels)}
      {data.competitorProof &&
        (audience === 'strategy-tab' ? (
          <span className={chrome.competitorClass}>{data.competitorProof}</span>
        ) : (
          <span className={chrome.competitorClass}>
            <Icon as={Swords} size="sm" className={audience === 'admin' ? 'text-orange-400' : 'text-accent-warning'} />
            {data.competitorProof}
          </span>
        ))}
    </div>
  );

  // ── Strategy-tab layout (header → metrics → trend → rationale → footer) ──
  if (audience === 'strategy-tab') {
    return (
      <div className={wrapperClass}>
        {header}
        {metrics}
        {hasTrendOrSerp && trendRow}
        {data.rationale && <div className={chrome.rationaleClass}>{data.rationale}</div>}
        {footer}
      </div>
    );
  }

  // ── admin + briefing layout (header → [metrics + footer row] → trend → tips → questions → rationale) ──
  return (
    <div className={wrapperClass}>
      {header}
      <div className="flex items-center justify-between mt-1">
        {metrics}
        {footer}
      </div>
      {trendRow}
      {data.serpTargeting && data.serpTargeting.length > 0 && (
        <div className={chrome.serpTargetingBorder}>
          {data.serpTargeting.map((tip) => (
            <div key={tip} className={chrome.serpTargetingText}>
              → {tip}
            </div>
          ))}
        </div>
      )}
      {data.questionKeywords && data.questionKeywords.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mt-1">
          <Icon as={MessageCircleQuestion} size="sm" className={chrome.questionIconClass} />
          {data.questionKeywords.map((q) => (
            <span key={q} className={chrome.questionTextClass}>
              &ldquo;{q}&rdquo;
            </span>
          ))}
        </div>
      )}
      {data.rationale && <div className={chrome.rationaleClass}>{data.rationale}</div>}
    </div>
  );
}
