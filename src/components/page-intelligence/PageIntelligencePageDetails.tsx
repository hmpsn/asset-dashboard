import {
  AlertCircle,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Check,
  CheckCircle,
  Code2,
  DollarSign,
  Loader2,
  Pencil,
  Plus,
  Shield,
  Sparkles,
  Tag,
  Target,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';
import type { UnifiedPage } from '../../../shared/types/page-join';
import { scoreBgBarClass, scoreColorClass, Button, Icon, MetricRing } from '../ui';
import { SeoCopyPanel } from '../strategy/SeoCopyPanel';
import {
  difficultyTextColor,
  intentIcon,
  kdColor,
  kdLabel,
  positionColor,
} from './pageIntelligenceDisplay';
import type { ContentScore, KeywordData, KeywordEditDraft, SeoCopy } from './pageIntelligenceTypes';

interface Props {
  page: UnifiedPage;
  isAnalyzing: boolean;
  analysis?: KeywordData;
  contentScore?: ContentScore;
  isEditing: boolean;
  editDraft: KeywordEditDraft;
  saving: boolean;
  seoCopyResults: Map<string, SeoCopy>;
  generatingCopy: string | null;
  copiedField: string | null;
  trackedKeywords: Set<string>;
  onTrackKeyword: (keyword: string) => void;
  onStartEdit: (page: UnifiedPage) => void;
  onEditDraftChange: (draft: KeywordEditDraft) => void;
  onSaveEdit: (page: UnifiedPage) => void;
  onCancelEdit: () => void;
  onAnalyzePage: (page: UnifiedPage) => void;
  onGenerateSeoCopy: (page: UnifiedPage) => void;
  onCopyText: (text: string, label: string) => void;
  onOpenSeoEditor: (page: UnifiedPage) => void;
  onCreateBrief: (page: UnifiedPage, analysis?: KeywordData) => void;
  onAddSchema: (page: UnifiedPage) => void;
  onViewFullAnalysis: () => void;
}

export function PageIntelligencePageDetails({
  page,
  isAnalyzing,
  analysis,
  contentScore,
  isEditing,
  editDraft,
  saving,
  seoCopyResults,
  generatingCopy,
  copiedField,
  trackedKeywords,
  onTrackKeyword,
  onStartEdit,
  onEditDraftChange,
  onSaveEdit,
  onCancelEdit,
  onAnalyzePage,
  onGenerateSeoCopy,
  onCopyText,
  onOpenSeoEditor,
  onCreateBrief,
  onAddSchema,
  onViewFullAnalysis,
}: Props) {
  const sp = page.strategy;
  const hasPersistedAnalysis = !!sp?.analysisGeneratedAt;
  const hasSchemaIssue =
    analysis?.optimizationIssues?.some(issue => /schema|structured data/i.test(issue)) ||
    sp?.optimizationIssues?.some(issue => /schema|structured data/i.test(issue));

  return (
    <div className="px-4 pb-4 pl-10 space-y-4">
      {sp && !isEditing && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <span className="t-label text-[var(--brand-text-muted)]">Primary Keyword</span>
              <div className="flex items-center gap-2 mt-0.5">
                <p className="t-caption text-[var(--brand-text-bright)]">{sp.primaryKeyword}</p>
                <button
                  onClick={() => onTrackKeyword(sp.primaryKeyword)}
                  title={trackedKeywords.has(sp.primaryKeyword) ? 'Tracking' : 'Track in Rank Tracker'}
                  className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${ // arbitrary-text-ok
                    trackedKeywords.has(sp.primaryKeyword) ? 'border-emerald-500/30 bg-emerald-500/10 text-accent-success' : 'border-teal-500/30 bg-teal-500/10 text-accent-brand hover:bg-teal-500/20'}`}
                >
                  {trackedKeywords.has(sp.primaryKeyword) ? <><Check className="w-2.5 h-2.5" /> Tracking</> : <><Plus className="w-2.5 h-2.5" /> Track</>}
                </button>
              </div>
            </div>
            <button onClick={() => onStartEdit(page)} className="p-1 text-[var(--brand-text-muted)] hover:text-accent-brand transition-colors" title="Edit keywords">
              <Pencil className="w-3 h-3" />
            </button>
          </div>
          <div>
            <span className="t-label text-[var(--brand-text-muted)]">Secondary Keywords</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {sp.secondaryKeywords.map((keyword, index) => (
                <span key={index} className="px-1.5 py-0.5 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded t-caption-sm text-[var(--brand-text)]">{keyword}</span>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-3 mt-1">
            {sp.volume != null && sp.volume > 0 && (
              <div className="t-caption-sm text-[var(--brand-text-muted)] flex items-center gap-1">
                <Icon as={BarChart3} size="sm" className="text-accent-orange" />
                <span className="text-[var(--brand-text-bright)] font-medium">{sp.volume.toLocaleString()}</span>/mo
              </div>
            )}
            {sp.difficulty != null && sp.difficulty > 0 && (
              <div className="t-caption-sm text-[var(--brand-text-muted)] flex items-center gap-1">
                <Icon as={Shield} size="sm" />
                KD: <span className={`font-medium ${kdColor(sp.difficulty)}`}>{sp.difficulty}%</span>
                <span className={kdColor(sp.difficulty)}>({kdLabel(sp.difficulty)})</span>
              </div>
            )}
            {sp.cpc !== undefined && sp.cpc > 0 && (
              <div className="t-caption-sm text-[var(--brand-text-muted)] flex items-center gap-1">
                <Icon as={DollarSign} size="sm" className="text-accent-success" />
                CPC: <span className="text-accent-success font-medium">${sp.cpc.toFixed(2)}</span>
              </div>
            )}
            {sp.impressions !== undefined && (
              <span className="t-caption-sm text-[var(--brand-text-muted)]"><span className="text-[var(--brand-text)] font-medium">{sp.impressions.toLocaleString()}</span> impressions</span>
            )}
            {sp.clicks !== undefined && (
              <span className="t-caption-sm text-[var(--brand-text-muted)]"><span className="text-[var(--brand-text)] font-medium">{sp.clicks.toLocaleString()}</span> clicks</span>
            )}
            {sp.currentPosition && (
              <span className="t-caption-sm text-[var(--brand-text-muted)]">Avg position: <span className={`font-medium ${positionColor(sp.currentPosition)}`}>#{sp.currentPosition.toFixed(1)}</span></span>
            )}
          </div>
          {sp.secondaryMetrics && sp.secondaryMetrics.length > 0 && (
            <div className="mt-1">
              <span className="t-label text-[var(--brand-text-muted)]">Secondary keyword data</span>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {sp.secondaryMetrics.filter(metric => metric.volume > 0 || metric.difficulty > 0).map((metric, index) => (
                  <span key={index} className="t-caption-sm px-1.5 py-0.5 bg-[var(--surface-3)]/80 border border-[var(--brand-border)]/50 rounded text-[var(--brand-text-muted)]">
                    {metric.keyword} {metric.volume > 0 && <span className="text-[var(--brand-text)]">{metric.volume}/mo</span>} {metric.difficulty > 0 && <span className={kdColor(metric.difficulty)}>KD {metric.difficulty}%</span>}
                  </span>
                ))}
              </div>
            </div>
          )}
          <SeoCopyPanel
            page={sp}
            seoCopyResults={seoCopyResults}
            generatingCopy={generatingCopy}
            copiedField={copiedField}
            onGenerateSeoCopy={() => onGenerateSeoCopy(page)}
            onCopyText={onCopyText}
          />
        </div>
      )}

      {sp && isEditing && (
        <div className="space-y-2">
          <div>
            <label className="t-label text-[var(--brand-text-muted)] block mb-1">Primary Keyword</label>
            <input
              type="text"
              value={editDraft.primary}
              onChange={event => onEditDraftChange({ ...editDraft, primary: event.target.value })}
              className="w-full px-2.5 py-1.5 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] t-caption text-[var(--brand-text-bright)] focus:outline-none focus:border-teal-500"
            />
          </div>
          <div>
            <label className="t-label text-[var(--brand-text-muted)] block mb-1">Secondary Keywords (comma-separated)</label>
            <input
              type="text"
              value={editDraft.secondary}
              onChange={event => onEditDraftChange({ ...editDraft, secondary: event.target.value })}
              className="w-full px-2.5 py-1.5 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] t-caption text-[var(--brand-text-bright)] focus:outline-none focus:border-teal-500"
            />
          </div>
          <div className="flex gap-2">
            <Button variant="primary" size="sm" icon={Check} loading={saving} disabled={saving} onClick={() => onSaveEdit(page)}>
              Save
            </Button>
            <Button variant="secondary" size="sm" icon={X} onClick={onCancelEdit}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {!sp && !analysis && !isAnalyzing && (
        <div className="text-center py-4">
          <p className="t-caption text-[var(--brand-text-muted)] mb-2">This page isn't in your keyword strategy yet.</p>
          <Button variant="primary" size="sm" icon={Sparkles} onClick={() => onAnalyzePage(page)} className="mx-auto">
            Run AI Analysis
          </Button>
        </div>
      )}

      {isAnalyzing && !analysis && (
        <div className="flex items-center gap-2 py-6 justify-center text-[var(--brand-text-muted)]">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="t-body">Running AI keyword analysis...</span>
        </div>
      )}

      {analysis && (
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
              <button
                onClick={() => onTrackKeyword(analysis.primaryKeyword)}
                title={trackedKeywords.has(analysis.primaryKeyword) ? 'Tracking' : 'Track in Rank Tracker'}
                className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${ // arbitrary-text-ok
                  trackedKeywords.has(analysis.primaryKeyword) ? 'border-emerald-500/30 bg-emerald-500/10 text-accent-success' : 'border-teal-500/30 bg-teal-500/10 text-accent-brand hover:bg-teal-500/20'}`}
              >
                {trackedKeywords.has(analysis.primaryKeyword) ? <><Check className="w-2.5 h-2.5" /> Tracking</> : <><Plus className="w-2.5 h-2.5" /> Track</>}
              </button>
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
      )}

      {!analysis && hasPersistedAnalysis && !isAnalyzing && (
        <div className="pt-2 border-t border-[var(--brand-border)]">
          <div className="flex items-center justify-between">
            <span className="t-caption-sm text-accent-success">Analysis on file (run {new Date(sp!.analysisGeneratedAt!).toLocaleDateString()})</span>
            <button onClick={() => onAnalyzePage(page)}
              className="t-caption-sm text-[var(--brand-text-muted)] hover:text-accent-brand flex items-center gap-1 transition-colors">
              <Sparkles className="w-2.5 h-2.5" /> Run fresh analysis
            </button>
          </div>
          {(sp!.optimizationIssues?.length || sp!.recommendations?.length || sp!.contentGaps?.length) ? (
            <div className="mt-2 space-y-2">
              {sp!.optimizationScore !== undefined && (
                <div className="flex items-center gap-2">
                  <span className="t-caption-sm text-[var(--brand-text-muted)]">Score:</span>
                  <span className={`t-body font-bold ${scoreColorClass(sp!.optimizationScore!)}`}>{sp!.optimizationScore}</span>
                </div>
              )}
              {sp!.optimizationIssues && sp!.optimizationIssues.length > 0 && (
                <div className="t-caption-sm text-[var(--brand-text)]">
                  <span className="text-accent-danger font-medium">{sp!.optimizationIssues.length} issues</span> · {sp!.optimizationIssues.slice(0, 2).join(' · ')}
                  {sp!.optimizationIssues.length > 2 && ` +${sp!.optimizationIssues.length - 2} more`}
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}

      <div className="flex items-center gap-2 pt-3 mt-1 border-t border-[var(--brand-border)]/60 flex-wrap">
        <button
          onClick={() => onOpenSeoEditor(page)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium text-accent-brand bg-teal-500/10 hover:bg-teal-500/15 border border-teal-500/20 transition-all"
        >
          <Icon as={Pencil} size="sm" /> Fix in SEO Editor
        </button>
        <button
          onClick={() => onCreateBrief(page, analysis)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium text-accent-brand bg-teal-500/10 hover:bg-teal-500/15 border border-teal-500/20 transition-all"
        >
          <Icon as={BookOpen} size="sm" /> Create Brief
        </button>
        {hasSchemaIssue && (
          <button
            onClick={() => onAddSchema(page)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium text-accent-brand bg-teal-500/10 hover:bg-teal-500/15 border border-teal-500/20 transition-all"
          >
            <Icon as={Code2} size="sm" /> Add Schema
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={onViewFullAnalysis}
          className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-dim)] hover:text-[var(--brand-text)] transition-colors"
        >
          View full analysis <Icon as={ArrowUpRight} size="sm" />
        </button>
      </div>
    </div>
  );
}
