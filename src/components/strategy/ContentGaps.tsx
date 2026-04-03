import { useNavigate } from 'react-router-dom';
import { FileText, Sparkles, BarChart3, Eye, Swords, TrendingUp, TrendingDown, Minus, Award, MessageCircleQuestion } from 'lucide-react';
import { adminPath } from '../../routes';

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
}

const kdColor = (kd?: number) => !kd ? 'text-zinc-500' : kd <= 30 ? 'text-green-400' : kd <= 60 ? 'text-amber-400' : 'text-red-400';
const fmtNum = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString();

export interface ContentGapsProps {
  contentGaps: ContentGap[];
  workspaceId?: string;
  intentColor: (intent?: string) => string;
}

export function ContentGaps({ contentGaps, workspaceId, intentColor }: ContentGapsProps) {
  const navigate = useNavigate();

  // Sort by impact: volume descending, then priority
  const sorted = [...contentGaps].sort((a, b) => {
    const volDiff = (b.volume || 0) - (a.volume || 0);
    if (volDiff !== 0) return volDiff;
    const prioW = (p: string) => p === 'high' ? 3 : p === 'medium' ? 2 : 1;
    return prioW(b.priority) - prioW(a.priority);
  });

  if (sorted.length === 0) return null;

  return (
    <div className="bg-zinc-900 border border-blue-500/20 p-5" style={{ borderRadius: '6px 12px 6px 12px' }}>
      <h4 className="text-xs font-semibold text-blue-300 mb-1 flex items-center gap-1.5">
        <FileText className="w-3.5 h-3.5" /> Content Gaps
      </h4>
      <p className="text-[11px] text-zinc-500 mb-3">New content to create — topics with search demand but no page on the site.</p>
      <div className="space-y-2">
        {sorted.map((gap, i) => {
          const prioColor = gap.priority === 'high' ? 'text-red-400 bg-red-500/10 border-red-500/20' : gap.priority === 'medium' ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' : 'text-zinc-400 bg-zinc-700/30 border-zinc-600/20';
          return (
            <div key={i} className="px-3 py-2.5 bg-zinc-800/40 rounded-lg border border-zinc-800">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-200">{gap.topic}</span>
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] uppercase px-1.5 py-0.5 rounded-full border font-medium ${intentColor(gap.intent)}`}>{gap.intent}</span>
                  <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded border ${prioColor}`}>{gap.priority}</span>
                  {gap.suggestedPageType && gap.suggestedPageType !== 'blog' && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/20 font-medium capitalize">{gap.suggestedPageType}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between mt-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-teal-400">Target keyword: &ldquo;{gap.targetKeyword}&rdquo;</span>
                  {gap.volume != null && <span className="text-[10px] text-zinc-400 flex items-center gap-0.5"><BarChart3 className="w-3 h-3" />{fmtNum(gap.volume)}/mo</span>}
                  {gap.difficulty != null && gap.difficulty > 0 && <span className={`text-[10px] font-medium ${kdColor(gap.difficulty)}`}>KD {gap.difficulty}</span>}
                  {gap.impressions != null && gap.impressions > 0 && <span className="text-[10px] text-blue-400 flex items-center gap-0.5"><Eye className="w-3 h-3" />{fmtNum(gap.impressions)} impr</span>}
                </div>
                {workspaceId && (
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => navigate(adminPath(workspaceId, 'content-pipeline'), { state: { fixContext: { targetRoute: 'content-pipeline', primaryKeyword: gap.targetKeyword } } })}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-teal-600/20 border border-teal-500/30 text-[11px] text-teal-300 font-medium hover:bg-teal-600/40 transition-all"
                    >
                      <FileText className="w-3 h-3" /> Draft Brief
                    </button>
                    <button
                      onClick={() => navigate(adminPath(workspaceId, 'seo-briefs'), { state: { fixContext: { targetRoute: 'seo-briefs', pageName: gap.targetKeyword } } })}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-teal-600/20 border border-teal-500/30 text-[11px] text-teal-300 font-medium hover:bg-teal-600/40 transition-all"
                    >
                      <Sparkles className="w-3 h-3" /> Generate Brief
                    </button>
                  </div>
                )}
              </div>
              {/* Trend + SERP + Competitor badges */}
              <div className="flex items-center gap-2 flex-wrap mt-1">
                {gap.trendDirection === 'rising' && (
                  <span className="flex items-center gap-0.5 text-[10px] text-green-400 font-medium"><TrendingUp className="w-3 h-3" />Rising</span>
                )}
                {gap.trendDirection === 'declining' && (
                  <span className="flex items-center gap-0.5 text-[10px] text-red-400 font-medium"><TrendingDown className="w-3 h-3" />Declining</span>
                )}
                {gap.trendDirection === 'stable' && gap.volume && gap.volume > 0 && (
                  <span className="flex items-center gap-0.5 text-[10px] text-zinc-400 font-medium"><Minus className="w-3 h-3" />Stable</span>
                )}
                {gap.serpFeatures?.includes('featured_snippet') && (
                  <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 font-medium"><Award className="w-3 h-3" />Featured Snippet</span>
                )}
                {gap.serpFeatures?.includes('people_also_ask') && (
                  <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-medium"><MessageCircleQuestion className="w-3 h-3" />PAA</span>
                )}
                {gap.competitorProof && (
                  <span className="flex items-center gap-0.5 text-[10px] text-orange-400 font-medium"><Swords className="w-3 h-3" />{gap.competitorProof}</span>
                )}
              </div>
              {gap.serpTargeting && gap.serpTargeting.length > 0 && (
                <div className="mt-1.5 pl-2 border-l-2 border-yellow-500/20">
                  {gap.serpTargeting.map((rec, ri) => (
                    <div key={ri} className="text-[10px] text-yellow-400/80 leading-relaxed">→ {rec}</div>
                  ))}
                </div>
              )}
              {gap.questionKeywords && gap.questionKeywords.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap mt-1">
                  <MessageCircleQuestion className="w-3 h-3 text-cyan-400 flex-shrink-0" />
                  {gap.questionKeywords.map((q, qi) => (
                    <span key={qi} className="text-[10px] text-cyan-400/80 italic">&ldquo;{q}&rdquo;</span>
                  ))}
                </div>
              )}
              <div className="text-[11px] text-zinc-500 mt-0.5">{gap.rationale}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
