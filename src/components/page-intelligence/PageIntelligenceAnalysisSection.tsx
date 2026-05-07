import {
  AlertCircle,
  BarChart3,
  BookOpen,
  CheckCircle,
  Loader2,
  Sparkles,
  Tag,
  Target,
  TrendingUp,
  Zap,
} from 'lucide-react';
import type { UnifiedPage } from '../../../shared/types/page-join';
import { scoreBgBarClass, scoreColorClass, Icon, MetricRing } from '../ui';
import {
  difficultyTextColor,
  intentIcon,
} from './pageIntelligenceDisplay';
import type { ContentScore, KeywordData } from './pageIntelligenceTypes';
import { PageIntelligenceTrackKeywordButton } from './PageIntelligenceTrackKeywordButton';

interface Props {
  page: UnifiedPage;
  isAnalyzing: boolean;
  analysis?: KeywordData;
  contentScore?: ContentScore;
  trackedKeywords: Set<string>;
  onTrackKeyword: (keyword: string) => void;
  onAnalyzePage: (page: UnifiedPage) => void;
}

export function PageIntelligenceAnalysisSection({
  page,
  isAnalyzing,
  analysis,
  contentScore,
  trackedKeywords,
  onTrackKeyword,
  onAnalyzePage,
}: Props) {
  if (!analysis) return null;

  return (
    <div className="space-y-3 pt-2 border-t border-[var(--brand-border)]">
      <div className="flex items-center justify-between">
        <span className="t-label text-[var(--brand-text-muted)]">AI Analysis</span>
        <button onClick={() => onAnalyzePage(page)} disabled={isAnalyzing}
          className="t-caption-sm text-[var(--brand-text-muted)] hover:text-accent-brand flex items-center gap-1 transition-colors disabled:opacity-50">
          {isAnalyzing ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Sparkles className="w-2.5 h-2.5" />} Re-analyze
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-[var(--surface-2)] p-3 border border-[var(--brand-border)] rounded-[var(--radius-signature)]">
          <div className="t-label text-[var(--brand-text-muted)] mb-1">Optimization</div>
          <div className={`t-stat ${scoreColorClass(analysis.optimizationScore)}`}>
            {analysis.optimizationScore}<span className="t-caption font-normal text-[var(--brand-text-muted)]">/100</span>
          </div>
          <div className="mt-1 h-1 bg-[var(--surface-3)] rounded-[var(--radius-pill)] overflow-hidden">
            <div className={`h-full rounded-[var(--radius-pill)] ${scoreBgBarClass(analysis.optimizationScore)}`} style={{ width: `${analysis.optimizationScore}%` }} />
          </div>
        </div>
        <div className="bg-[var(--surface-2)] p-3 border border-[var(--brand-border)] rounded-[var(--radius-signature)]">
          <div className="t-label text-[var(--brand-text-muted)] mb-1">Search Intent</div>
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-[var(--radius-pill)] bg-teal-500/20 text-accent-brand flex items-center justify-center t-caption font-bold">{intentIcon(analysis.searchIntent)}</span>
            <div>
              <div className="t-body font-medium text-[var(--brand-text-bright)] capitalize">{analysis.searchIntent}</div>
              <div className="t-caption-sm text-[var(--brand-text-muted)]">{Math.round(analysis.searchIntentConfidence * 100)}% confidence</div>
            </div>
          </div>
        </div>
        <div className="bg-[var(--surface-2)] p-3 border border-[var(--brand-border)] rounded-[var(--radius-signature)]">
          <div className="t-label text-[var(--brand-text-muted)] mb-1">Difficulty</div>
          <div className={`t-body font-semibold capitalize ${difficultyTextColor(analysis.estimatedDifficulty)}`}>{analysis.estimatedDifficulty}</div>
          <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">Cluster: {analysis.topicCluster}</div>
        </div>
      </div>

      <div className="bg-[var(--surface-2)] p-3 border border-[var(--brand-border)] rounded-[var(--radius-signature)]">
        <div className="flex items-center gap-2 mb-2">
          <Icon as={Target} size="md" className="text-accent-brand" />
          <span className="t-caption font-medium text-[var(--brand-text-bright)]">Primary Keyword: <span className="text-white">{analysis.primaryKeyword}</span></span>
          <PageIntelligenceTrackKeywordButton
            keyword={analysis.primaryKeyword}
            trackedKeywords={trackedKeywords}
            onTrackKeyword={onTrackKeyword}
          />
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {(['inTitle', 'inMeta', 'inContent', 'inSlug'] as const).map(key => {
            const labels = { inTitle: 'Title', inMeta: 'Meta', inContent: 'Content', inSlug: 'URL' };
            const present = analysis.primaryKeywordPresence[key];
            return (
              <div key={key} className="flex items-center gap-1">
                {present ? <Icon as={CheckCircle} size="sm" className="text-accent-success" /> : <Icon as={AlertCircle} size="sm" className="text-accent-danger" />}
                <span className={`t-caption-sm ${present ? 'text-accent-success' : 'text-accent-danger'}`}>{labels[key]}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-[var(--surface-2)] p-3 border border-[var(--brand-border)] rounded-[var(--radius-signature)]">
          <div className="flex items-center gap-2 mb-2">
            <Icon as={Tag} size="md" className="text-accent-info" />
            <span className="t-caption font-medium text-[var(--brand-text-bright)]">Secondary Keywords</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {analysis.secondaryKeywords.map((keyword, index) => (
              <span key={index} className="t-caption-sm px-1.5 py-0.5 rounded bg-blue-500/10 border border-blue-500/20 text-accent-info">{keyword}</span>
            ))}
          </div>
        </div>
        <div className="bg-[var(--surface-2)] p-3 border border-[var(--brand-border)] rounded-[var(--radius-signature)]">
          <div className="flex items-center gap-2 mb-2">
            <Icon as={TrendingUp} size="md" className="text-accent-success" />
            <span className="t-caption font-medium text-[var(--brand-text-bright)]">Long-Tail Keywords</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {analysis.longTailKeywords.map((keyword, index) => (
              <span key={index} className="t-caption-sm px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-accent-success">{keyword}</span>
            ))}
          </div>
        </div>
      </div>

      {analysis.competitorKeywords.length > 0 && (
        <div className="bg-[var(--surface-2)] p-3 border border-[var(--brand-border)] rounded-[var(--radius-signature)]">
          <div className="flex items-center gap-2 mb-2">
            <Icon as={Zap} size="md" className="text-accent-warning" />
            <span className="t-caption font-medium text-[var(--brand-text-bright)]">Competitor Keywords</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {analysis.competitorKeywords.map((keyword, index) => (
              <span key={index} className="t-caption-sm px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-accent-warning">{keyword}</span>
            ))}
          </div>
        </div>
      )}

      {(analysis.contentGaps.length > 0 || analysis.optimizationIssues.length > 0 || analysis.recommendations.length > 0) && (
        <div className="space-y-3 pt-2 border-t border-[var(--brand-border)]">
          <span className="t-label text-[var(--brand-text-muted)]">Issues & Recommendations</span>

          {analysis.contentGaps.length > 0 && (
            <div className="bg-[var(--surface-2)] p-3 border border-[var(--brand-border)] rounded-[var(--radius-signature)]">
              <div className="flex items-center gap-2 mb-2">
                <Icon as={AlertCircle} size="md" className="text-accent-orange" />
                <span className="t-caption font-medium text-[var(--brand-text-bright)]">Content Gaps</span>
              </div>
              <ul className="space-y-1">
                {analysis.contentGaps.map((gap, index) => (
                  <li key={index} className="t-caption text-[var(--brand-text)] flex items-start gap-1.5">
                    <span className="text-accent-orange mt-0.5">-</span> {gap}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {analysis.optimizationIssues.length > 0 && (
              <div className="bg-[var(--surface-2)] p-3 border border-red-500/20 rounded-[var(--radius-signature)]">
                <div className="flex items-center gap-2 mb-2">
                  <Icon as={AlertCircle} size="md" className="text-accent-danger" />
                  <span className="t-caption font-medium text-[var(--brand-text-bright)]">Issues</span>
                </div>
                <ul className="space-y-1">
                  {analysis.optimizationIssues.map((issue, index) => (
                    <li key={index} className="t-caption-sm text-[var(--brand-text)]">{issue}</li>
                  ))}
                </ul>
              </div>
            )}
            {analysis.recommendations.length > 0 && (
              <div className="bg-[var(--surface-2)] p-3 border border-emerald-500/20 rounded-[var(--radius-signature)]">
                <div className="flex items-center gap-2 mb-2">
                  <Icon as={Sparkles} size="md" className="text-accent-success" />
                  <span className="t-caption font-medium text-[var(--brand-text-bright)]">Recommendations</span>
                </div>
                <ul className="space-y-1">
                  {analysis.recommendations.map((recommendation, index) => (
                    <li key={index} className="t-caption-sm text-[var(--brand-text)]">{recommendation}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {contentScore && (
        <div className="bg-[var(--surface-2)] p-3 border border-[var(--brand-border)] rounded-[var(--radius-signature)]">
          <div className="flex items-center gap-2 mb-3">
            <Icon as={BarChart3} size="md" className="text-accent-cyan" />
            <span className="t-caption font-medium text-[var(--brand-text-bright)]">Content Metrics</span>
          </div>
          <div className="grid grid-cols-4 gap-3 mb-3">
            <div>
              <div className="t-stat-sm text-[var(--brand-text-bright)]">{contentScore.wordCount}</div>
              <div className="t-label text-[var(--brand-text-muted)]">Words</div>
            </div>
            <div>
              <div className="flex items-center gap-3">
                <MetricRing score={contentScore.readabilityScore} size={64} noAnimation />
                <div>
                  <div className={`t-stat-sm ${contentScore.readabilityScore >= 60 ? 'text-accent-success' : contentScore.readabilityScore >= 30 ? 'text-accent-warning' : 'text-accent-danger'}`}>
                    {contentScore.readabilityScore}
                  </div>
                  <div className="t-label text-[var(--brand-text-muted)]">Readability</div>
                </div>
              </div>
            </div>
            <div>
              <div className="t-stat-sm text-[var(--brand-text-bright)]">{contentScore.headings.total}</div>
              <div className="t-label text-[var(--brand-text-muted)]">Headings</div>
            </div>
            <div>
              <div className="t-stat-sm text-[var(--brand-text-bright)]">{contentScore.avgWordsPerSentence}</div>
              <div className="t-label text-[var(--brand-text-muted)]">Words/Sent</div>
            </div>
          </div>
          {contentScore.topKeywords.length > 0 && (
            <div>
              <div className="t-label text-[var(--brand-text-muted)] mb-1.5">Top Words in Content</div>
              <div className="flex flex-wrap gap-1">
                {contentScore.topKeywords.slice(0, 10).map((topKeyword, index) => (
                  <span key={index} className="t-caption-sm px-1.5 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20 text-accent-cyan">
                    {topKeyword.word} <span className="text-accent-cyan">({topKeyword.density}%)</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-4 mt-3">
            <div className="flex items-center gap-1.5">
              {contentScore.titleOk ? <Icon as={CheckCircle} size="sm" className="text-accent-success" /> : <Icon as={AlertCircle} size="sm" className="text-accent-warning" />}
              <span className="t-caption-sm text-[var(--brand-text)]">Title: {contentScore.titleLength} chars</span>
            </div>
            <div className="flex items-center gap-1.5">
              {contentScore.descOk ? <Icon as={CheckCircle} size="sm" className="text-accent-success" /> : <Icon as={AlertCircle} size="sm" className="text-accent-warning" />}
              <span className="t-caption-sm text-[var(--brand-text)]">Desc: {contentScore.descLength} chars</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Icon as={BookOpen} size="sm" className="text-[var(--brand-text-muted)]" />
              <span className="t-caption-sm text-[var(--brand-text)]">{contentScore.readabilityGrade} ({contentScore.readabilityScore})</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
