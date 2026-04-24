import {
  ChevronDown, ChevronUp, FileText, Copy, Download, Trash2, Search,
} from 'lucide-react';
import { BriefDetail } from './BriefDetail';
import { EmptyState } from '../ui';

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

interface ContentTopicRequest {
  id: string;
  briefId?: string;
  [key: string]: unknown;
}

export interface BriefListProps {
  briefs: ContentBrief[];
  clientRequests: ContentTopicRequest[];
  expanded: string | null;
  briefSearch: string;
  briefSort: 'date' | 'keyword' | 'difficulty';
  editingBrief: string | null;
  generatingPostFor: string | null;
  regeneratingBrief: string | null;
  sendingToClient: string | null;
  onSetExpanded: (id: string | null) => void;
  onSetBriefSearch: (value: string) => void;
  onSetBriefSort: (value: 'date' | 'keyword' | 'difficulty') => void;
  onCopyAsMarkdown: (brief: ContentBrief) => void;
  onExportClientHTML: (brief: ContentBrief) => void;
  onSendToClient: (brief: ContentBrief) => void;
  onConfirmDeleteBrief: (brief: ContentBrief) => void;
  onSaveBriefField: (briefId: string, updates: Partial<ContentBrief>) => void;
  onSetEditingBrief: (id: string | null) => void;
  onGeneratePost: (briefId: string) => void;
  onRegenerateBrief: (briefId: string, feedback: string) => void;
  onRegenerateOutline?: (briefId: string, feedback?: string) => void;
  regeneratingOutline?: string | null;
}

export function BriefList({
  briefs,
  clientRequests,
  expanded,
  briefSearch,
  briefSort,
  editingBrief,
  generatingPostFor,
  regeneratingBrief,
  sendingToClient,
  onSetExpanded,
  onSetBriefSearch,
  onSetBriefSort: _onSetBriefSort,
  onCopyAsMarkdown,
  onExportClientHTML,
  onSendToClient,
  onConfirmDeleteBrief,
  onSaveBriefField,
  onSetEditingBrief,
  onGeneratePost,
  onRegenerateBrief,
  onRegenerateOutline,
  regeneratingOutline,
}: BriefListProps) {
  const linkedBriefIds = new Set(clientRequests.filter(r => r.briefId).map(r => r.briefId!));
  let standaloneBriefs = briefs.filter(b => !linkedBriefIds.has(b.id));

  // Apply search filter
  if (briefSearch.trim()) {
    const q = briefSearch.toLowerCase();
    standaloneBriefs = standaloneBriefs.filter(b =>
      b.targetKeyword.toLowerCase().includes(q) ||
      b.suggestedTitle.toLowerCase().includes(q) ||
      b.intent.toLowerCase().includes(q) ||
      b.secondaryKeywords.some(k => k.toLowerCase().includes(q))
    );
  }

  // Apply sort
  standaloneBriefs = [...standaloneBriefs].sort((a, b) => {
    if (briefSort === 'keyword') return a.targetKeyword.localeCompare(b.targetKeyword);
    if (briefSort === 'difficulty') return (b.difficultyScore ?? 0) - (a.difficultyScore ?? 0);
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <>
      {/* Briefs list */}
      {standaloneBriefs.length === 0 && !briefSearch.trim() ? (
        <EmptyState icon={FileText} title="No standalone briefs yet" description="Generate a brief above, or briefs linked to requests will appear in the request cards" className="py-12" />
      ) : standaloneBriefs.length === 0 && briefSearch.trim() ? (
        <EmptyState icon={Search} title={`No briefs match \u201c${briefSearch}\u201d`} className="py-8" action={
          <button onClick={() => onSetBriefSearch('')} className="text-xs text-teal-400 hover:underline">Clear search</button>
        } />
      ) : (
        <div className="space-y-2">
          {standaloneBriefs.map(brief => (
            <div key={brief.id} className="bg-zinc-900 border border-zinc-800 overflow-hidden group/brief" style={{ borderRadius: '10px 24px 10px 24px' }}>
              {/* Brief header row */}
              <div className="flex items-center gap-3 px-4 py-3">
                <button
                  onClick={() => onSetExpanded(expanded === brief.id ? null : brief.id)}
                  className="flex-1 min-w-0 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-zinc-200 truncate">{brief.targetKeyword}</span>
                    {brief.difficultyScore != null && (
                      <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${brief.difficultyScore <= 30 ? 'bg-green-500/10 text-emerald-400 border border-green-500/20' : brief.difficultyScore <= 60 ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>{brief.difficultyScore}/100</span>
                    )}
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-0.5 truncate">{brief.suggestedTitle}</div>
                </button>
                {/* At-a-glance metrics */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium">{brief.wordCountTarget.toLocaleString()} words</span>
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 capitalize">{brief.intent}</span>
                  {brief.contentFormat && <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400/80 border border-amber-500/20 capitalize hidden sm:inline-block">{brief.contentFormat}</span>}
                </div>
                {/* Quick actions */}
                <div className="flex items-center gap-0.5 flex-shrink-0 opacity-40 group-hover/brief:opacity-100 transition-opacity">
                  <button onClick={(e) => { e.stopPropagation(); onCopyAsMarkdown(brief); }} title="Copy for AI tool" className="p-1.5 rounded hover:bg-teal-500/10 text-zinc-500 hover:text-teal-400 transition-colors">
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); onExportClientHTML(brief); }} title="Export PDF" className="p-1.5 rounded hover:bg-teal-500/10 text-zinc-500 hover:text-teal-400 transition-colors">
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); onConfirmDeleteBrief(brief); }} title="Delete brief" className="p-1.5 rounded hover:bg-red-500/10 text-zinc-500 hover:text-red-400 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {/* Date + expand */}
                <span className="text-[11px] text-zinc-500 flex-shrink-0">{new Date(brief.createdAt).toLocaleDateString()}</span>
                <button onClick={() => onSetExpanded(expanded === brief.id ? null : brief.id)} className="flex-shrink-0 p-1 rounded hover:bg-zinc-800 transition-colors">
                  {expanded === brief.id ? <ChevronUp className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />}
                </button>
              </div>

              {/* Brief details */}
              {expanded === brief.id && (
                <BriefDetail
                  brief={brief}
                  editingBrief={editingBrief}
                  generatingPostFor={generatingPostFor}
                  regeneratingBrief={regeneratingBrief}
                  sendingToClient={sendingToClient}
                  onSaveBriefField={onSaveBriefField}
                  onSetEditingBrief={onSetEditingBrief}
                  onGeneratePost={onGeneratePost}
                  onRegenerate={onRegenerateBrief}
                  onRegenerateOutline={onRegenerateOutline}
                  regeneratingOutline={regeneratingOutline}
                  onCopyAsMarkdown={onCopyAsMarkdown}
                  onExportClientHTML={onExportClientHTML}
                  onSendToClient={onSendToClient}
                  onConfirmDelete={onConfirmDeleteBrief}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
