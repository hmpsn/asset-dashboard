import {
  ChevronDown, ChevronUp, FileText, Copy, Download, Trash2, Search,
} from 'lucide-react';
import { BriefDetail } from './BriefDetail';
import { EmptyState, Button, IconButton } from '../ui';
import type { ContentBrief } from '../../../shared/types/content';

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
          <Button variant="link" size="sm" onClick={() => onSetBriefSearch('')} className="!text-xs text-teal-400 hover:underline">
            Clear search
          </Button>
        } />
      ) : (
        <div className="space-y-2">
          {standaloneBriefs.map(brief => (
            <div key={brief.id} className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden group/brief" style={{ borderRadius: 'var(--radius-signature)' }}>
              {/* Brief header row */}
              <div className="flex items-center gap-3 px-4 py-3">
                <Button
                  onClick={() => onSetExpanded(expanded === brief.id ? null : brief.id)}
                  variant="ghost"
                  size="sm"
                  className="flex-1 min-w-0 !px-0 !py-0 !justify-start text-left bg-transparent hover:bg-transparent"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-[var(--brand-text-bright)] truncate">{brief.targetKeyword}</span>
                    {brief.difficultyScore != null && (
                      <span className={`t-caption-sm px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${brief.difficultyScore <= 30 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : brief.difficultyScore <= 60 ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>{brief.difficultyScore}/100</span>
                    )}
                  </div>
                  <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5 truncate">{brief.suggestedTitle}</div>
                </Button>
                {/* At-a-glance metrics */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="t-caption-sm px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium">{brief.wordCountTarget.toLocaleString()} words</span>
                  <span className="t-caption-sm px-1.5 py-0.5 rounded bg-[var(--surface-3)] text-[var(--brand-text-muted)] capitalize">{brief.intent}</span>
                  {brief.contentFormat && <span className="t-caption-sm px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400/80 border border-amber-500/20 capitalize hidden sm:inline-block">{brief.contentFormat}</span>}
                </div>
                {/* Quick actions */}
                <div className="flex items-center gap-0.5 flex-shrink-0 opacity-40 group-hover/brief:opacity-100 transition-opacity">
                  <IconButton
                    icon={Copy}
                    label="Copy for AI tool"
                    title="Copy for AI tool"
                    size="sm"
                    variant="ghost"
                    onClick={(e) => { e.stopPropagation(); onCopyAsMarkdown(brief); }}
                    className="rounded hover:bg-teal-500/10 text-[var(--brand-text-muted)] hover:text-teal-400"
                  />
                  <IconButton
                    icon={Download}
                    label="Export PDF"
                    title="Export PDF"
                    size="sm"
                    variant="ghost"
                    onClick={(e) => { e.stopPropagation(); onExportClientHTML(brief); }}
                    className="rounded hover:bg-teal-500/10 text-[var(--brand-text-muted)] hover:text-teal-400"
                  />
                  <IconButton
                    icon={Trash2}
                    label="Delete brief"
                    title="Delete brief"
                    size="sm"
                    variant="ghost"
                    onClick={(e) => { e.stopPropagation(); onConfirmDeleteBrief(brief); }}
                    className="rounded hover:bg-red-500/10 text-[var(--brand-text-muted)] hover:text-red-400"
                  />
                </div>
                {/* Date + expand */}
                <span className="t-caption-sm text-[var(--brand-text-muted)] flex-shrink-0">{new Date(brief.createdAt).toLocaleDateString()}</span>
                <IconButton
                  icon={expanded === brief.id ? ChevronUp : ChevronDown}
                  label={expanded === brief.id ? 'Collapse brief' : 'Expand brief'}
                  size="sm"
                  variant="ghost"
                  onClick={() => onSetExpanded(expanded === brief.id ? null : brief.id)}
                  className="flex-shrink-0 rounded hover:bg-[var(--surface-3)] text-[var(--brand-text-muted)]"
                />
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
