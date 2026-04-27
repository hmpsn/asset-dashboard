import { useState } from 'react';
import {
  Loader2, Trash2, Download, Copy, Search,
  Target, MessageSquare, BarChart3, BookOpen, Users, TrendingUp,
  Pencil, Check, PenLine, RefreshCw, Send,
} from 'lucide-react';
import { Icon } from '../ui';

interface ContentBrief {
  id: string;
  workspaceId: string;
  targetKeyword: string;
  secondaryKeywords: string[];
  suggestedTitle: string;
  suggestedMetaDesc: string;
  outline: { heading: string; notes: string; wordCount?: number; keywords?: string[] }[];
  wordCountTarget: number;
  intent: string;
  audience: string;
  competitorInsights: string;
  internalLinkSuggestions: string[];
  createdAt: string;
  executiveSummary?: string;
  contentFormat?: string;
  toneAndStyle?: string;
  peopleAlsoAsk?: string[];
  topicalEntities?: string[];
  serpAnalysis?: { contentType: string; avgWordCount: number; commonElements: string[]; gaps: string[] };
  difficultyScore?: number;
  trafficPotential?: string;
  ctaRecommendations?: string[];
  eeatGuidance?: { experience: string; expertise: string; authority: string; trust: string };
  contentChecklist?: string[];
  schemaRecommendations?: { type: string; notes: string }[];
  pageType?: string;
  referenceUrls?: string[];
  realPeopleAlsoAsk?: string[];
  realTopResults?: { position: number; title: string; url: string }[];
  titleVariants?: string[];
  metaDescVariants?: string[];
}

interface BriefDetailProps {
  brief: ContentBrief;
  editingBrief: string | null;
  generatingPostFor: string | null;
  regeneratingBrief: string | null;
  sendingToClient: string | null;
  onSaveBriefField: (briefId: string, updates: Partial<ContentBrief>) => void;
  onSetEditingBrief: (id: string | null) => void;
  onGeneratePost: (briefId: string) => void;
  onRegenerate: (briefId: string, feedback: string) => void;
  onRegenerateOutline?: (briefId: string, feedback?: string) => void;
  regeneratingOutline?: string | null;
  onCopyAsMarkdown: (brief: ContentBrief) => void;
  onExportClientHTML: (brief: ContentBrief) => void;
  onSendToClient: (brief: ContentBrief) => void;
  onConfirmDelete: (brief: ContentBrief) => void;
}

export function BriefDetail({
  brief, editingBrief, generatingPostFor, regeneratingBrief, sendingToClient,
  onSaveBriefField, onSetEditingBrief, onGeneratePost, onRegenerate,
  onRegenerateOutline, regeneratingOutline,
  onCopyAsMarkdown, onExportClientHTML, onSendToClient, onConfirmDelete,
}: BriefDetailProps) {
  const [showRegenerate, setShowRegenerate] = useState(false);
  const [regenFeedback, setRegenFeedback] = useState('');
  const [showOutlineRegen, setShowOutlineRegen] = useState(false);
  const [outlineRegenFeedback, setOutlineRegenFeedback] = useState('');

  return (
    <div className="px-4 pb-4 space-y-4 border-t border-[var(--brand-border)]">
      {/* Action buttons */}
      <div className="pt-3 flex items-center gap-2 flex-wrap">
        <button onClick={() => onGeneratePost(brief.id)} disabled={generatingPostFor === brief.id} className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium bg-blue-600/20 border border-blue-500/30 text-blue-300 hover:bg-blue-600/30 transition-colors disabled:opacity-50">
          <Icon as={generatingPostFor === brief.id ? Loader2 : PenLine} size="sm" className={generatingPostFor === brief.id ? 'animate-spin' : ''} />
          {generatingPostFor === brief.id ? 'Starting...' : 'Generate Full Post'}
        </button>
        <button onClick={() => onSetEditingBrief(editingBrief === brief.id ? null : brief.id)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium transition-colors ${editingBrief === brief.id ? 'bg-amber-600/20 border border-amber-500/30 text-amber-300 hover:bg-amber-600/30' : 'bg-[var(--surface-3)] text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] border border-[var(--brand-border)]'}`}>
          {editingBrief === brief.id ? <><Icon as={Check} size="sm" /> Done Editing</> : <><Icon as={Pencil} size="sm" /> Edit Brief</>}
        </button>
        <button onClick={() => onCopyAsMarkdown(brief)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors">
          <Icon as={Copy} size="sm" /> Copy for AI Tool
        </button>
        <button onClick={() => onExportClientHTML(brief)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors">
          <Icon as={Download} size="sm" /> Export PDF
        </button>
        <button onClick={() => onSendToClient(brief)} disabled={sendingToClient === brief.id} className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium bg-cyan-600/20 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-600/30 transition-colors disabled:opacity-50">
          <Icon as={sendingToClient === brief.id ? Loader2 : Send} size="sm" className={sendingToClient === brief.id ? 'animate-spin' : ''} />
          {sendingToClient === brief.id ? 'Sending...' : 'Send to Client'}
        </button>
        <button onClick={() => { navigator.clipboard.writeText(JSON.stringify(brief, null, 2)); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium bg-[var(--surface-3)] text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] transition-colors">
          <Icon as={Copy} size="sm" /> Copy JSON
        </button>
        <button onClick={() => setShowRegenerate(!showRegenerate)} disabled={regeneratingBrief === brief.id} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium transition-colors disabled:opacity-50 ${
          showRegenerate ? 'bg-teal-600/20 border border-teal-500/30 text-teal-300' : 'bg-[var(--surface-3)] text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] border border-[var(--brand-border)]'
        }`}>
          <Icon as={RefreshCw} size="sm" className={regeneratingBrief === brief.id ? 'animate-spin' : ''} />
          {regeneratingBrief === brief.id ? 'Regenerating...' : 'Regenerate'}
        </button>
      </div>

      {/* Regenerate with feedback */}
      {showRegenerate && regeneratingBrief !== brief.id && (
        <div className="bg-teal-500/5 border border-teal-500/20 rounded-[var(--radius-lg)] px-4 py-3 space-y-2">
          <div className="t-caption-sm text-teal-400 font-medium uppercase tracking-wider">Regenerate with Instructions</div>
          <textarea
            value={regenFeedback}
            onChange={e => setRegenFeedback(e.target.value)}
            placeholder="e.g. 'Make it more commercial', 'Add a comparison table section', 'Target a different audience'..."
            className="w-full text-xs text-[var(--brand-text-bright)] bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] px-3 py-2 focus:border-teal-500/50 focus:outline-none resize-y min-h-[60px]"
            rows={2}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => { if (regenFeedback.trim()) { onRegenerate(brief.id, regenFeedback.trim()); setShowRegenerate(false); setRegenFeedback(''); } }}
              disabled={!regenFeedback.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors disabled:opacity-40"
            >
              <Icon as={Send} size="sm" /> Regenerate Brief
            </button>
            <span className="t-caption-sm text-[var(--brand-text-muted)]">Creates a new brief — original is preserved</span>
          </div>
        </div>
      )}

      {/* Executive Summary */}
      {brief.executiveSummary && (
        <div className="bg-teal-500/5 border border-teal-500/20 rounded-[var(--radius-lg)] px-4 py-3">
          <div className="flex items-center gap-1.5 mb-1.5"><Icon as={BookOpen} size="md" className="text-teal-400" /><span className="t-caption-sm uppercase tracking-wider text-teal-400 font-medium">Executive Summary</span></div>
          {editingBrief === brief.id ? (
            <textarea defaultValue={brief.executiveSummary} onBlur={e => { if (e.target.value !== brief.executiveSummary) onSaveBriefField(brief.id, { executiveSummary: e.target.value }); }} className="w-full text-xs text-[var(--brand-text-bright)] leading-relaxed bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] px-3 py-2 focus:border-teal-500/50 focus:outline-none resize-y min-h-[60px]" rows={3} />
          ) : (
            <div className="text-xs text-[var(--brand-text-bright)] leading-relaxed">{brief.executiveSummary}</div>
          )}
        </div>
      )}

      {/* Title & Meta — with A/B variant picker */}
      <div className="space-y-2">
        <div>
          <div className="t-caption-sm uppercase tracking-wider text-[var(--brand-text-muted)] font-medium mb-1">Suggested Title</div>
          {editingBrief === brief.id ? (
            <input type="text" defaultValue={brief.suggestedTitle} onBlur={e => { if (e.target.value !== brief.suggestedTitle) onSaveBriefField(brief.id, { suggestedTitle: e.target.value }); }} className="w-full text-xs text-teal-400 bg-[var(--surface-1)] rounded-[var(--radius-lg)] px-3 py-2 border border-[var(--brand-border)] focus:border-teal-500/50 focus:outline-none" />
          ) : (
            <div className="text-xs text-teal-400 bg-[var(--surface-1)] rounded-[var(--radius-lg)] px-3 py-2 border border-[var(--brand-border)]">{brief.suggestedTitle}</div>
          )}
          {brief.titleVariants && brief.titleVariants.length > 0 && (
            <div className="mt-1.5 space-y-1">
              <div className="t-caption-sm uppercase tracking-wider text-[var(--brand-text-muted)] font-medium">Alternatives</div>
              {brief.titleVariants.map((variant, i) => (
                <button
                  key={i}
                  onClick={() => onSaveBriefField(brief.id, {
                    suggestedTitle: variant,
                    titleVariants: [brief.suggestedTitle, ...brief.titleVariants!.filter((_, j) => j !== i)],
                  })}
                  className="w-full text-left text-xs text-[var(--brand-text)] hover:text-teal-400 bg-[var(--surface-1)]/50 hover:bg-[var(--surface-2)] rounded-[var(--radius-lg)] px-3 py-1.5 border border-[var(--brand-border)]/50 hover:border-teal-500/30 transition-colors group"
                >
                  <span className="group-hover:text-teal-400">{variant}</span>
                  <span className="t-caption-sm text-[var(--brand-text-muted)] ml-2 group-hover:text-teal-500">click to use</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <div className="t-caption-sm uppercase tracking-wider text-[var(--brand-text-muted)] font-medium mb-1">Meta Description</div>
          {editingBrief === brief.id ? (
            <textarea defaultValue={brief.suggestedMetaDesc} onBlur={e => { if (e.target.value !== brief.suggestedMetaDesc) onSaveBriefField(brief.id, { suggestedMetaDesc: e.target.value }); }} className="w-full text-xs text-[var(--brand-text-bright)] bg-[var(--surface-1)] rounded-[var(--radius-lg)] px-3 py-2 border border-[var(--brand-border)] focus:border-teal-500/50 focus:outline-none resize-y" rows={2} />
          ) : (
            <div className="text-xs text-[var(--brand-text-bright)] bg-[var(--surface-1)] rounded-[var(--radius-lg)] px-3 py-2 border border-[var(--brand-border)]">{brief.suggestedMetaDesc}</div>
          )}
          {brief.metaDescVariants && brief.metaDescVariants.length > 0 && (
            <div className="mt-1.5 space-y-1">
              <div className="t-caption-sm uppercase tracking-wider text-[var(--brand-text-muted)] font-medium">Alternatives</div>
              {brief.metaDescVariants.map((variant, i) => (
                <button
                  key={i}
                  onClick={() => onSaveBriefField(brief.id, {
                    suggestedMetaDesc: variant,
                    metaDescVariants: [brief.suggestedMetaDesc, ...brief.metaDescVariants!.filter((_, j) => j !== i)],
                  })}
                  className="w-full text-left text-xs text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] bg-[var(--surface-1)]/50 hover:bg-[var(--surface-2)] rounded-[var(--radius-lg)] px-3 py-1.5 border border-[var(--brand-border)]/50 hover:border-teal-500/30 transition-colors group"
                >
                  <span className="group-hover:text-[var(--brand-text-bright)]">{variant}</span>
                  <span className="t-caption-sm text-[var(--brand-text-muted)] ml-2 group-hover:text-teal-500">click to use</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Key Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-[var(--surface-1)] rounded-[var(--radius-lg)] px-3 py-2 border border-[var(--brand-border)]">
          <div className="t-caption-sm uppercase tracking-wider text-[var(--brand-text-muted)] font-medium mb-0.5">Word Count</div>
          {editingBrief === brief.id ? (
            <input type="number" defaultValue={brief.wordCountTarget} onBlur={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v !== brief.wordCountTarget) onSaveBriefField(brief.id, { wordCountTarget: v }); }} className="w-full text-sm font-bold text-blue-400 bg-transparent border-b border-[var(--brand-border)] focus:border-blue-400 focus:outline-none py-0.5" />
          ) : (
            <div className="text-sm font-bold text-blue-400">{brief.wordCountTarget.toLocaleString()}</div>
          )}
        </div>
        <div className="bg-[var(--surface-1)] rounded-[var(--radius-lg)] px-3 py-2 border border-[var(--brand-border)]">
          <div className="t-caption-sm uppercase tracking-wider text-[var(--brand-text-muted)] font-medium mb-0.5">Intent</div>
          {editingBrief === brief.id ? (
            <input type="text" defaultValue={brief.intent} onBlur={e => { if (e.target.value !== brief.intent) onSaveBriefField(brief.id, { intent: e.target.value }); }} className="w-full text-xs text-[var(--brand-text-bright)] capitalize font-medium bg-transparent border-b border-[var(--brand-border)] focus:border-teal-500/50 focus:outline-none py-0.5" />
          ) : (
            <div className="text-xs text-[var(--brand-text-bright)] capitalize font-medium">{brief.intent}</div>
          )}
        </div>
        {brief.contentFormat && (
          <div className="bg-[var(--surface-1)] rounded-[var(--radius-lg)] px-3 py-2 border border-[var(--brand-border)]">
            <div className="t-caption-sm uppercase tracking-wider text-[var(--brand-text-muted)] font-medium mb-0.5">Format</div>
            {editingBrief === brief.id ? (
              <select defaultValue={brief.contentFormat} onChange={e => onSaveBriefField(brief.id, { contentFormat: e.target.value })} className="w-full text-xs text-amber-400 capitalize font-medium bg-transparent border-b border-[var(--brand-border)] focus:border-teal-500/50 focus:outline-none py-0.5 cursor-pointer">
                {['guide', 'listicle', 'how-to', 'comparison', 'FAQ', 'case-study', 'pillar-page', 'landing-page', 'blog-post'].map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            ) : (
              <div className="text-xs text-amber-400 capitalize font-medium">{brief.contentFormat}</div>
            )}
          </div>
        )}
        {brief.difficultyScore != null && (
          <div className="bg-[var(--surface-1)] rounded-[var(--radius-lg)] px-3 py-2 border border-[var(--brand-border)]">
            <div className="t-caption-sm uppercase tracking-wider text-[var(--brand-text-muted)] font-medium mb-0.5">Difficulty</div>
            <div className={`text-sm font-bold ${brief.difficultyScore <= 30 ? 'text-emerald-400' : brief.difficultyScore <= 60 ? 'text-amber-400' : 'text-red-400'}`}>{brief.difficultyScore}/100</div>
          </div>
        )}
      </div>

      {/* Traffic Potential */}
      {brief.trafficPotential && (
        <div className="flex items-start gap-2 bg-[var(--surface-1)] rounded-[var(--radius-lg)] px-3 py-2 border border-[var(--brand-border)]">
          <Icon as={TrendingUp} size="md" className="text-emerald-400 mt-0.5 flex-shrink-0" />
          <div><div className="t-caption-sm uppercase tracking-wider text-[var(--brand-text-muted)] font-medium mb-0.5">Traffic Potential</div><div className="text-xs text-[var(--brand-text-bright)]">{brief.trafficPotential}</div></div>
        </div>
      )}

      {/* Audience & Tone */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <div className="flex items-center gap-1.5 mb-1"><Icon as={Users} size="sm" className="text-[var(--brand-text-muted)]" /><span className="t-caption-sm uppercase tracking-wider text-[var(--brand-text-muted)] font-medium">Audience</span></div>
          {editingBrief === brief.id ? (
            <textarea defaultValue={brief.audience} onBlur={e => { if (e.target.value !== brief.audience) onSaveBriefField(brief.id, { audience: e.target.value }); }} className="w-full text-xs text-[var(--brand-text)] bg-[var(--surface-1)] rounded-[var(--radius-lg)] px-3 py-2 border border-[var(--brand-border)] focus:border-teal-500/50 focus:outline-none resize-y" rows={2} />
          ) : (
            <div className="text-xs text-[var(--brand-text)] bg-[var(--surface-1)] rounded-[var(--radius-lg)] px-3 py-2 border border-[var(--brand-border)]">{brief.audience}</div>
          )}
        </div>
        {brief.toneAndStyle && (
          <div>
            <div className="flex items-center gap-1.5 mb-1"><Icon as={MessageSquare} size="sm" className="text-[var(--brand-text-muted)]" /><span className="t-caption-sm uppercase tracking-wider text-[var(--brand-text-muted)] font-medium">Tone & Style</span></div>
            {editingBrief === brief.id ? (
              <textarea defaultValue={brief.toneAndStyle} onBlur={e => { if (e.target.value !== brief.toneAndStyle) onSaveBriefField(brief.id, { toneAndStyle: e.target.value }); }} className="w-full text-xs text-[var(--brand-text)] bg-[var(--surface-1)] rounded-[var(--radius-lg)] px-3 py-2 border border-[var(--brand-border)] focus:border-teal-500/50 focus:outline-none resize-y" rows={2} />
            ) : (
              <div className="text-xs text-[var(--brand-text)] bg-[var(--surface-1)] rounded-[var(--radius-lg)] px-3 py-2 border border-[var(--brand-border)]">{brief.toneAndStyle}</div>
            )}
          </div>
        )}
      </div>

      {/* Secondary Keywords */}
      {brief.secondaryKeywords.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5"><Icon as={Search} size="sm" className="text-[var(--brand-text-muted)]" /><span className="t-caption-sm uppercase tracking-wider text-[var(--brand-text-muted)] font-medium">Secondary Keywords</span></div>
          <div className="flex flex-wrap gap-1.5">
            {brief.secondaryKeywords.map((kw, i) => (
              <span key={i} className="t-caption-sm px-2 py-0.5 rounded-full bg-[var(--surface-3)] text-[var(--brand-text)]">{kw}</span>
            ))}
          </div>
        </div>
      )}

      {/* Topical Entities */}
      {brief.topicalEntities && brief.topicalEntities.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5"><Icon as={Target} size="sm" className="text-[var(--brand-text-muted)]" /><span className="t-caption-sm uppercase tracking-wider text-[var(--brand-text-muted)] font-medium">Topical Entities to Cover</span></div>
          <div className="flex flex-wrap gap-1.5">
            {brief.topicalEntities.map((entity, i) => (
              <span key={i} className="t-caption-sm px-2 py-0.5 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-300">{entity}</span>
            ))}
          </div>
        </div>
      )}

      {/* People Also Ask */}
      {brief.peopleAlsoAsk && brief.peopleAlsoAsk.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5"><Icon as={MessageSquare} size="sm" className="text-[var(--brand-text-muted)]" /><span className="t-caption-sm uppercase tracking-wider text-[var(--brand-text-muted)] font-medium">Questions to Answer</span></div>
          <div className="space-y-1">
            {brief.peopleAlsoAsk.map((q, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-[var(--brand-text-bright)] bg-[var(--surface-1)] rounded-[var(--radius-lg)] px-3 py-2 border border-[var(--brand-border)]">
                <span className="text-amber-400 flex-shrink-0 font-medium">Q{i + 1}.</span> {q}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SERP Analysis */}
      {brief.serpAnalysis && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5"><Icon as={BarChart3} size="sm" className="text-[var(--brand-text-muted)]" /><span className="t-caption-sm uppercase tracking-wider text-[var(--brand-text-muted)] font-medium">SERP Analysis</span></div>
          <div className="bg-[var(--surface-1)] rounded-[var(--radius-lg)] px-3 py-3 border border-[var(--brand-border)] space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <div><span className="t-caption-sm text-[var(--brand-text-muted)]">Content Type:</span><span className="text-xs text-[var(--brand-text-bright)] ml-1">{brief.serpAnalysis.contentType}</span></div>
              <div><span className="t-caption-sm text-[var(--brand-text-muted)]">Avg Word Count:</span><span className="text-xs text-[var(--brand-text-bright)] ml-1">{brief.serpAnalysis.avgWordCount.toLocaleString()}</span></div>
            </div>
            {brief.serpAnalysis.commonElements.length > 0 && (
              <div><span className="t-caption-sm text-[var(--brand-text-muted)] block mb-1">Common Elements:</span><div className="flex flex-wrap gap-1">{brief.serpAnalysis.commonElements.map((el, i) => <span key={i} className="t-caption-sm px-2 py-0.5 rounded bg-[var(--surface-3)] text-[var(--brand-text)]">{el}</span>)}</div></div>
            )}
            {brief.serpAnalysis.gaps.length > 0 && (
              <div><span className="t-caption-sm text-emerald-400/80 block mb-1">Opportunities (gaps in existing content):</span><div className="space-y-1">{brief.serpAnalysis.gaps.map((g, i) => <div key={i} className="t-caption-sm text-emerald-300/80 flex items-start gap-1.5"><span className="text-emerald-400 mt-0.5">&rarr;</span>{g}</div>)}</div></div>
            )}
          </div>
        </div>
      )}

      {/* Content Outline */}
      {brief.outline.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="t-caption-sm uppercase tracking-wider text-[var(--brand-text-muted)] font-medium">Content Outline</div>
            {onRegenerateOutline && (
              <button
                onClick={() => setShowOutlineRegen(!showOutlineRegen)}
                disabled={regeneratingOutline === brief.id}
                className="flex items-center gap-1 t-caption-sm px-2 py-1 rounded bg-teal-500/10 hover:bg-teal-500/20 text-teal-400 border border-teal-500/20 transition-colors disabled:opacity-50"
              >
                <Icon as={regeneratingOutline === brief.id ? Loader2 : RefreshCw} size="sm" className={regeneratingOutline === brief.id ? 'animate-spin' : ''} />
                {regeneratingOutline === brief.id ? 'Regenerating...' : 'Regenerate Outline'}
              </button>
            )}
          </div>
          {showOutlineRegen && onRegenerateOutline && (
            <div className="mb-3 p-3 rounded-[var(--radius-lg)] bg-[var(--surface-1)] border border-[var(--brand-border)] space-y-2">
              <textarea
                value={outlineRegenFeedback}
                onChange={e => setOutlineRegenFeedback(e.target.value)}
                placeholder="Optional: describe what you'd like changed (e.g., 'Add a comparison section', 'Make it more practical')..."
                className="w-full text-xs text-[var(--brand-text-bright)] bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] px-3 py-2 focus:border-teal-500/50 focus:outline-none resize-y"
                rows={2}
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { onRegenerateOutline(brief.id, outlineRegenFeedback.trim() || undefined); setShowOutlineRegen(false); setOutlineRegenFeedback(''); }}
                  disabled={regeneratingOutline === brief.id}
                  className="px-3 py-1.5 rounded-[var(--radius-lg)] text-xs font-medium bg-teal-600 hover:bg-teal-500 disabled:opacity-50 transition-colors text-white"
                >
                  Regenerate
                </button>
                <button
                  onClick={() => { setShowOutlineRegen(false); setOutlineRegenFeedback(''); }}
                  className="px-3 py-1.5 rounded-[var(--radius-lg)] text-xs font-medium bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)] text-[var(--brand-text)] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          <div className="space-y-2">
            {brief.outline.map((section, i) => (
              <div key={i} className="bg-[var(--surface-1)] rounded-[var(--radius-lg)] px-3 py-2.5 border border-[var(--brand-border)]">
                {editingBrief === brief.id ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="t-caption-sm text-[var(--brand-text-muted)] flex-shrink-0">H2:</span>
                      <input type="text" defaultValue={section.heading} onBlur={e => { if (e.target.value !== section.heading) { const newOutline = [...brief.outline]; newOutline[i] = { ...newOutline[i], heading: e.target.value }; onSaveBriefField(brief.id, { outline: newOutline }); } }} className="flex-1 text-xs font-medium text-[var(--brand-text-bright)] bg-transparent border-b border-[var(--brand-border)] focus:border-teal-500/50 focus:outline-none py-0.5" />
                      <input type="number" defaultValue={section.wordCount || ''} placeholder="words" onBlur={e => { const v = parseInt(e.target.value, 10); const newOutline = [...brief.outline]; newOutline[i] = { ...newOutline[i], wordCount: isNaN(v) ? undefined : v }; onSaveBriefField(brief.id, { outline: newOutline }); }} className="w-20 t-caption-sm text-[var(--brand-text-muted)] bg-transparent border-b border-[var(--brand-border)] focus:border-teal-500/50 focus:outline-none py-0.5 text-right" />
                    </div>
                    <textarea defaultValue={section.notes} onBlur={e => { if (e.target.value !== section.notes) { const newOutline = [...brief.outline]; newOutline[i] = { ...newOutline[i], notes: e.target.value }; onSaveBriefField(brief.id, { outline: newOutline }); } }} className="w-full t-caption-sm text-[var(--brand-text-muted)] leading-relaxed bg-[var(--surface-2)]/50 border border-[var(--brand-border)] rounded px-2 py-1.5 focus:border-teal-500/50 focus:outline-none resize-y" rows={2} />
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-medium text-[var(--brand-text-bright)]">H2: {section.heading}</div>
                      {section.wordCount && <span className="t-caption-sm px-1.5 py-0.5 rounded bg-[var(--surface-3)] text-[var(--brand-text-muted)]">{section.wordCount} words</span>}
                    </div>
                    <div className="t-caption-sm text-[var(--brand-text-muted)] mt-1 leading-relaxed">{section.notes}</div>
                  </>
                )}
                {section.keywords && section.keywords.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">{section.keywords.map((kw, j) => <span key={j} className="t-caption-sm px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400/80">{kw}</span>)}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CTA Recommendations */}
      {brief.ctaRecommendations && brief.ctaRecommendations.length > 0 && (
        <div>
          <div className="t-caption-sm uppercase tracking-wider text-[var(--brand-text-muted)] font-medium mb-1.5">CTA Recommendations</div>
          <div className="space-y-1">{brief.ctaRecommendations.map((cta, i) => (
            <div key={i} className="text-xs text-[var(--brand-text-bright)] bg-[var(--surface-1)] rounded-[var(--radius-lg)] px-3 py-2 border border-[var(--brand-border)] flex items-start gap-2">
              <span className={`t-caption-sm px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${i === 0 ? 'bg-teal-500/20 text-teal-400' : 'bg-[var(--surface-3)] text-[var(--brand-text-muted)]'}`}>{i === 0 ? 'Primary' : 'Secondary'}</span>
              {editingBrief === brief.id ? (
                <input type="text" defaultValue={cta} onBlur={e => { if (e.target.value !== cta) { const newCtas = [...(brief.ctaRecommendations || [])]; newCtas[i] = e.target.value; onSaveBriefField(brief.id, { ctaRecommendations: newCtas }); } }} className="flex-1 text-xs text-[var(--brand-text-bright)] bg-transparent border-b border-[var(--brand-border)] focus:border-teal-500/50 focus:outline-none" />
              ) : cta}
            </div>
          ))}</div>
        </div>
      )}

      {/* Competitor Insights */}
      {brief.competitorInsights && (
        <div>
          <div className="t-caption-sm uppercase tracking-wider text-[var(--brand-text-muted)] font-medium mb-1">Competitor Insights</div>
          {editingBrief === brief.id ? (
            <textarea defaultValue={brief.competitorInsights} onBlur={e => { if (e.target.value !== brief.competitorInsights) onSaveBriefField(brief.id, { competitorInsights: e.target.value }); }} className="w-full text-xs text-[var(--brand-text)] bg-[var(--surface-1)] rounded-[var(--radius-lg)] px-3 py-2 border border-[var(--brand-border)] focus:border-teal-500/50 focus:outline-none resize-y leading-relaxed" rows={3} />
          ) : (
            <div className="text-xs text-[var(--brand-text)] bg-[var(--surface-1)] rounded-[var(--radius-lg)] px-3 py-2 border border-[var(--brand-border)] leading-relaxed">{brief.competitorInsights}</div>
          )}
        </div>
      )}

      {/* Internal Links */}
      {brief.internalLinkSuggestions.length > 0 && (
        <div>
          <div className="t-caption-sm uppercase tracking-wider text-[var(--brand-text-muted)] font-medium mb-1">Internal Link Suggestions</div>
          <div className="flex flex-wrap gap-1.5">
            {brief.internalLinkSuggestions.map((link, i) => (
              <span key={i} className="t-caption-sm px-2 py-0.5 rounded bg-[var(--surface-3)] text-blue-400">/{link}</span>
            ))}
          </div>
        </div>
      )}

      {/* E-E-A-T Guidance */}
      {brief.eeatGuidance && (
        <div>
          <div className="t-caption-sm uppercase tracking-wider text-[var(--brand-text-muted)] font-medium mb-2">E-E-A-T Signals</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              { label: 'Experience', value: brief.eeatGuidance.experience, color: 'text-blue-400' },
              { label: 'Expertise', value: brief.eeatGuidance.expertise, color: 'text-teal-400' },
              { label: 'Authority', value: brief.eeatGuidance.authority, color: 'text-teal-400' },
              { label: 'Trust', value: brief.eeatGuidance.trust, color: 'text-amber-400' },
            ].filter(e => e.value).map((e, i) => (
              <div key={i} className="bg-[var(--surface-1)] rounded-[var(--radius-lg)] px-3 py-2.5 border border-[var(--brand-border)]">
                <div className={`t-caption-sm uppercase tracking-wider ${e.color} font-medium mb-1`}>{e.label}</div>
                <div className="t-caption-sm text-[var(--brand-text)] leading-relaxed">{e.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Content Checklist */}
      {brief.contentChecklist && brief.contentChecklist.length > 0 && (
        <div>
          <div className="t-caption-sm uppercase tracking-wider text-[var(--brand-text-muted)] font-medium mb-2">Content Checklist</div>
          <div className="bg-[var(--surface-1)] rounded-[var(--radius-lg)] border border-[var(--brand-border)] divide-y divide-[var(--brand-border)]/50">
            {brief.contentChecklist.map((item, i) => (
              <div key={i} className="flex items-start gap-2.5 px-4 py-2.5">
                <div className="w-4 h-4 mt-0.5 rounded border border-[var(--brand-border)] flex-shrink-0" />
                <span className="t-caption-sm text-[var(--brand-text)] leading-relaxed">{item}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Schema Recommendations */}
      {brief.schemaRecommendations && brief.schemaRecommendations.length > 0 && (
        <div>
          <div className="t-caption-sm uppercase tracking-wider text-[var(--brand-text-muted)] font-medium mb-2">Schema Markup</div>
          <div className="space-y-2">
            {brief.schemaRecommendations.map((schema, i) => (
              <div key={i} className="bg-[var(--surface-1)] rounded-[var(--radius-lg)] px-4 py-3 border border-[var(--brand-border)]">
                <div className="flex items-center gap-2 mb-1">
                  <span className="t-caption-sm px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 font-medium">{schema.type}</span>
                </div>
                <div className="t-caption-sm text-[var(--brand-text)] leading-relaxed">{schema.notes}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Delete */}
      <div className="pt-3 border-t border-[var(--brand-border)] flex items-center justify-between">
        <button
          onClick={() => onConfirmDelete(brief)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium text-red-400/70 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-all"
        >
          <Icon as={Trash2} size="md" /> Delete Brief
        </button>
        <span className="t-caption-sm text-[var(--brand-text-muted)]/50">Created {new Date(brief.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
      </div>
    </div>
  );
}
