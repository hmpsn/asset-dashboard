import { useNavigate } from 'react-router-dom';
import { Icon } from '../ui';
import { FileText, Sparkles, BarChart3, Eye, Swords, TrendingUp, TrendingDown, Minus, MessageCircleQuestion } from 'lucide-react';
import { adminPath } from '../../routes';
import { kdFraming, kdTooltip } from '../../lib/kdFraming.js';

interface ContentGap {
  topic: string;
  targetKeyword: string;
  intent: string;
  priority: string;
  rationale: string;
  suggestedPageType?: 'blog' | 'landing' | 'service' | 'location' | 'product' | 'pillar' | 'resource';
  volume?: number;
  difficulty?: number;
  impressions?: number;
  competitorProof?: string;
  trendDirection?: 'rising' | 'declining' | 'stable';
  serpFeatures?: string[];
  serpTargeting?: string[];
  questionKeywords?: string[];
  opportunityScore?: number;
}

const kdColor = (kd?: number) => !kd ? 'text-[var(--brand-text-muted)]' : kd <= 30 ? 'text-emerald-400' : kd <= 60 ? 'text-amber-400' : kd <= 80 ? 'text-orange-400' : 'text-red-400';
const fmtNum = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString();


export interface ContentGapsProps {
  contentGaps: ContentGap[];
  workspaceId?: string;
  intentColor: (intent?: string) => string;
}

export function ContentGaps({ contentGaps, workspaceId, intentColor }: ContentGapsProps) {
  const navigate = useNavigate();

  // Sort by opportunity score (server-computed), falling back to volume then priority
  const sorted = [...contentGaps].sort((a, b) => {
    const scoreDiff = (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    const volDiff = (b.volume || 0) - (a.volume || 0);
    if (volDiff !== 0) return volDiff;
    const prioW = (p: string) => p === 'high' ? 3 : p === 'medium' ? 2 : 1;
    return prioW(b.priority) - prioW(a.priority);
  });

  if (sorted.length === 0) return null;

  return (
    <div className="bg-[var(--surface-2)] border border-blue-500/20 p-5 rounded-[var(--radius-signature)]">
      <h4 className="t-caption-sm font-semibold text-blue-300 mb-1 flex items-center gap-1.5">
        <Icon as={FileText} size="sm" className="text-blue-300" /> Content Gaps
      </h4>
      <p className="t-caption-sm text-[var(--brand-text-muted)] mb-3">New content to create — topics with search demand but no page on the site.</p>
      <div className="space-y-2">
        {sorted.map((gap, i) => {
          const prioColor = gap.priority === 'high' ? 'text-red-400 bg-red-500/10 border-red-500/20' : gap.priority === 'medium' ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' : 'text-[var(--brand-text)] bg-zinc-700/30 border-zinc-600/20';
          return (
            <div key={i} className="px-3 py-2.5 bg-[var(--surface-3)]/40 rounded-[var(--radius-lg)] border border-[var(--brand-border)]">
              <div className="flex items-center justify-between">
                <span className="t-ui font-medium text-[var(--brand-text-bright)]">{gap.topic}{gap.opportunityScore != null && (
                  <span className="ml-2 inline-flex items-center rounded-full bg-blue-500/10 px-2 py-0.5 t-caption font-medium text-blue-400">
                    {gap.opportunityScore}/100
                  </span>
                )}</span>
                <div className="flex items-center gap-2">
                  <span className={`t-caption-sm uppercase px-1.5 py-0.5 rounded-full border font-medium ${intentColor(gap.intent)}`}>{gap.intent}</span>
                  <span className={`t-caption-sm font-medium px-1.5 py-0.5 rounded border ${prioColor}`}>{gap.priority}</span>
                  {gap.suggestedPageType && gap.suggestedPageType !== 'blog' && (
                    <span className="t-caption-sm px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/20 font-medium capitalize">{gap.suggestedPageType}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between mt-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="t-caption-sm text-teal-400">Target keyword: &ldquo;{gap.targetKeyword}&rdquo;</span>
                  {gap.volume != null && <span className="t-caption-sm text-[var(--brand-text)] flex items-center gap-0.5"><Icon as={BarChart3} size="sm" />{fmtNum(gap.volume)}/mo</span>}
                  {gap.difficulty != null && gap.difficulty > 0 && (
                    <span
                      className={`t-caption-sm font-medium ${kdColor(gap.difficulty)} cursor-help`}
                      title={kdTooltip(gap.difficulty)}
                    >
                      KD {gap.difficulty}
                    </span>
                  )}
                  {gap.difficulty != null && gap.difficulty > 0 && kdFraming(gap.difficulty) && (
                    <span className="t-caption-sm text-[var(--brand-text-muted)] leading-none">
                      {kdFraming(gap.difficulty)}
                    </span>
                  )}
                  {gap.impressions != null && gap.impressions > 0 && <span className="t-caption-sm text-blue-400 flex items-center gap-0.5"><Icon as={Eye} size="sm" className="text-blue-400" />{fmtNum(gap.impressions)} impr</span>}
                  {gap.volume && gap.volume > 0 && (() => {
                    const impact = Math.round(gap.volume * 0.103); // position-3 CTR floor (10.3%)
                    if (impact < 10) return null;
                    return (
                      <span className="t-caption-sm text-blue-400/70 flex items-center gap-0.5">
                        <Icon as={TrendingUp} size="xs" className="text-blue-400/70" />
                        ~{fmtNum(impact)}/mo est. clicks at rank #3
                      </span>
                    );
                  })()}
                </div>
                {workspaceId && (
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => navigate(adminPath(workspaceId, 'content-pipeline'), { state: { fixContext: { targetRoute: 'content-pipeline', primaryKeyword: gap.targetKeyword, pageType: gap.suggestedPageType || undefined, autoGenerate: true } } })}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-[var(--radius-lg)] bg-teal-600/20 border border-teal-500/30 t-caption-sm text-teal-300 font-medium hover:bg-teal-600/40 transition-all"
                    >
                      <Icon as={FileText} size="sm" className="text-teal-300" /> Draft Brief
                    </button>
                    <button
                      onClick={() => navigate(adminPath(workspaceId, 'seo-briefs'), { state: { fixContext: { targetRoute: 'seo-briefs', pageName: gap.targetKeyword, pageType: gap.suggestedPageType || undefined } } })}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-[var(--radius-lg)] bg-teal-600/20 border border-teal-500/30 t-caption-sm text-teal-300 font-medium hover:bg-teal-600/40 transition-all"
                    >
                      <Icon as={Sparkles} size="sm" className="text-teal-300" /> Generate Brief
                    </button>
                  </div>
                )}
              </div>
              {/* Trend + SERP + Competitor badges */}
              <div className="flex items-center gap-2 flex-wrap mt-1">
                {gap.trendDirection === 'rising' && (
                  <span className="flex items-center gap-0.5 t-caption-sm text-emerald-400 font-medium"><Icon as={TrendingUp} size="sm" className="text-emerald-400" />Rising</span>
                )}
                {gap.trendDirection === 'declining' && (
                  <span className="flex items-center gap-0.5 t-caption-sm text-red-400 font-medium"><Icon as={TrendingDown} size="sm" className="text-red-400" />Declining</span>
                )}
                {gap.trendDirection === 'stable' && gap.volume && gap.volume > 0 && (
                  <span className="flex items-center gap-0.5 t-caption-sm text-[var(--brand-text)] font-medium"><Icon as={Minus} size="sm" />Stable</span>
                )}
                {Array.isArray(gap.serpFeatures) && gap.serpFeatures.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {gap.serpFeatures.includes('featured_snippet') && (
                      <span className="t-micro px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        ⬜ Snippet
                      </span>
                    )}
                    {gap.serpFeatures.includes('people_also_ask') && (
                      <span className="t-micro px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        ❓ PAA
                      </span>
                    )}
                    {gap.serpFeatures.includes('video') && (
                      <span className="t-micro px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        ▶ Video
                      </span>
                    )}
                    {gap.serpFeatures.includes('local_pack') && (
                      <span className="t-micro px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        📍 Local
                      </span>
                    )}
                  </div>
                )}
                {gap.competitorProof && (
                  <span className="flex items-center gap-0.5 t-caption-sm text-orange-400 font-medium"><Icon as={Swords} size="sm" className="text-orange-400" />{gap.competitorProof}</span>
                )}
              </div>
              {gap.serpTargeting && gap.serpTargeting.length > 0 && (
                <div className="mt-1.5 pl-2 border-l-2 border-yellow-500/20">
                  {gap.serpTargeting.map((rec, ri) => (
                    <div key={ri} className="t-caption-sm text-yellow-400/80 leading-relaxed">→ {rec}</div>
                  ))}
                </div>
              )}
              {gap.questionKeywords && gap.questionKeywords.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap mt-1">
                  <Icon as={MessageCircleQuestion} size="sm" className="text-cyan-400 flex-shrink-0" />
                  {gap.questionKeywords.map((q, qi) => (
                    <span key={qi} className="t-caption-sm text-cyan-400/80 italic">&ldquo;{q}&rdquo;</span>
                  ))}
                </div>
              )}
              <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">{gap.rationale}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
