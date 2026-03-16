/**
 * AuditIssueRow — renders a single audit issue with action buttons.
 * Extracted from SeoAudit.tsx per-issue rendering logic.
 */
import { useNavigate } from 'react-router-dom';
import { adminPath, type Page } from '../../routes';
import {
  Loader2, CheckCircle, Send, Wrench, X, Pencil,
  MoreVertical, EyeOff, ClipboardList,
} from 'lucide-react';
import type { SeoIssue, PageSeoResult } from './types';
import { SEVERITY_CONFIG, CATEGORY_CONFIG, FIX_TAB_LABELS, getFixTab } from './types';

export interface AuditIssueRowProps {
  page: PageSeoResult;
  issue: SeoIssue;
  idx: number;
  workspaceId?: string;
  siteId: string;
  // Fix state
  applyingFix: string | null;
  appliedFixes: Set<string>;
  editedSuggestions: Record<string, string>;
  editingKey: string | null;
  sentForReview: Set<string>;
  sendingReview: string | null;
  // Task / flag state
  createdTasks: Set<string>;
  creatingTask: string | null;
  flaggedIssues: Set<string>;
  flaggingKey: string | null;
  flagNote: string;
  flagSending: boolean;
  actionMenuKey: string | null;
  // Callbacks
  onAcceptSuggestion: (pageId: string, issue: SeoIssue) => void;
  onSendForReview: (page: PageSeoResult, issue: SeoIssue) => void;
  onSetEditingKey: (key: string | null) => void;
  onSetEditedSuggestion: (fixKey: string, text: string) => void;
  onSetActionMenuKey: (key: string | null) => void;
  onCreateTask: (page: PageSeoResult, issue: SeoIssue) => void;
  onFlagForClient: (page: PageSeoResult, issue: SeoIssue, note: string) => void;
  onSetFlaggingKey: (key: string | null) => void;
  onSetFlagNote: (note: string) => void;
  onSuppressIssue: (check: string, pageSlug: string) => void;
  issueToTaskKey: (page: PageSeoResult, issue: SeoIssue) => string;
}

export function AuditIssueRow({
  page, issue, idx, workspaceId, siteId,
  applyingFix, appliedFixes, editedSuggestions, editingKey,
  sentForReview, sendingReview,
  createdTasks, creatingTask, flaggedIssues, flaggingKey, flagNote, flagSending, actionMenuKey,
  onAcceptSuggestion, onSendForReview, onSetEditingKey, onSetEditedSuggestion,
  onSetActionMenuKey, onCreateTask, onFlagForClient, onSetFlaggingKey, onSetFlagNote,
  onSuppressIssue, issueToTaskKey,
}: AuditIssueRowProps) {
  const navigate = useNavigate();

  const cfg = SEVERITY_CONFIG[issue.severity];
  const catCfg = issue.category ? CATEGORY_CONFIG[issue.category] : null;
  const Icon = cfg.icon;
  const fixKey = `${page.pageId}-${issue.check}`;
  const taskKey = issueToTaskKey(page, issue);
  const isApplying = applyingFix === fixKey;
  const isApplied = appliedFixes.has(fixKey);
  const isEditing = editingKey === fixKey;
  const editedText = editedSuggestions[fixKey];
  const isFlagged = flaggedIssues.has(taskKey);
  const isCreated = createdTasks.has(taskKey);
  const isCreating = creatingTask === taskKey;
  const menuOpen = actionMenuKey === taskKey;

  return (
    <div key={idx} className="flex items-start gap-3 px-4 py-2 rounded-lg hover:bg-zinc-800/30 transition-colors group/issue">
      <Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${cfg.color}`} />
      <div className="flex-1 min-w-0">
        {/* Issue title + inline badges */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-zinc-300">{issue.message}</span>
          {catCfg && (
            <span className={`text-[10px] px-1 py-px rounded border border-zinc-800 ${catCfg.color} leading-tight`}>
              {catCfg.label}
            </span>
          )}
          <span className={`text-[10px] px-1 py-px rounded border leading-tight ${cfg.bg} ${cfg.color}`}>
            {issue.check}
          </span>
        </div>
        <div className="text-[11px] text-zinc-500 mt-0.5">{issue.recommendation}</div>
        {issue.value && <div className="text-[11px] text-zinc-500 mt-0.5 italic truncate">{issue.value}</div>}
        {/* Editable AI suggestion */}
        {issue.suggestedFix && (
          <div className="mt-1.5 px-2 py-1.5 rounded bg-emerald-950/40 border border-emerald-800/30">
            <div className="flex items-center justify-between mb-0.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-emerald-500 font-semibold uppercase tracking-wider">AI Suggestion</span>
                {!isApplied && !isEditing && (
                  <button
                    onClick={() => { onSetEditingKey(fixKey); if (!editedText) onSetEditedSuggestion(fixKey, issue.suggestedFix!); }}
                    className="text-[10px] text-emerald-500/60 hover:text-emerald-400 flex items-center gap-0.5 transition-colors"
                    title="Edit before sending"
                  >
                    <Pencil className="w-2.5 h-2.5" /> Edit
                  </button>
                )}
              </div>
              {isApplied ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 font-medium flex items-center gap-1">
                  <CheckCircle className="w-2.5 h-2.5" /> Applied
                </span>
              ) : sentForReview.has(fixKey) ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 font-medium flex items-center gap-1">
                  <Send className="w-2.5 h-2.5" /> Sent for Review
                </span>
              ) : (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onAcceptSuggestion(page.pageId, issue)}
                    disabled={isApplying || sendingReview === fixKey}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 font-medium transition-colors disabled:opacity-50 flex items-center gap-1"
                  >
                    {isApplying ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <CheckCircle className="w-2.5 h-2.5" />}
                    {isApplying ? 'Pushing...' : 'Apply Now'}
                  </button>
                  {workspaceId && (issue.check === 'title' || issue.check === 'meta-description') && (
                    <button
                      onClick={() => onSendForReview(page, issue)}
                      disabled={isApplying || sendingReview === fixKey}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-purple-600/30 hover:bg-purple-600/50 text-purple-300 font-medium transition-colors disabled:opacity-50 flex items-center gap-1"
                    >
                      {sendingReview === fixKey ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Send className="w-2.5 h-2.5" />}
                      Send for Review
                    </button>
                  )}
                </div>
              )}
            </div>
            {isEditing ? (
              <textarea
                value={editedText || issue.suggestedFix}
                onChange={e => onSetEditedSuggestion(fixKey, e.target.value)}
                onBlur={() => onSetEditingKey(null)}
                onKeyDown={e => { if (e.key === 'Escape') onSetEditingKey(null); }}
                className="w-full text-[11px] text-emerald-300 bg-emerald-950/60 border border-emerald-700/40 rounded px-1.5 py-1 focus:outline-none focus:border-emerald-500/50 resize-none"
                rows={2}
                autoFocus
              />
            ) : (
              <div
                className="text-[11px] text-emerald-300 cursor-text"
                onClick={() => { onSetEditingKey(fixKey); if (!editedText) onSetEditedSuggestion(fixKey, issue.suggestedFix!); }}
                title="Click to edit"
              >
                {editedText || issue.suggestedFix}
                {editedText && editedText !== issue.suggestedFix && (
                  <span className="ml-1 text-[9px] text-emerald-500/50 italic">(edited)</span>
                )}
              </div>
            )}
          </div>
        )}
        {/* Inline flag-for-client form */}
        {workspaceId && flaggingKey === taskKey && (
          <div className="mt-2 flex items-center gap-2">
            <input
              type="text"
              value={flagNote}
              onChange={e => onSetFlagNote(e.target.value)}
              placeholder="Note for client (optional)..."
              className="flex-1 px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-purple-500/50"
              onKeyDown={e => e.key === 'Enter' && onFlagForClient(page, issue, flagNote)}
              autoFocus
            />
            <button
              onClick={() => onFlagForClient(page, issue, flagNote)}
              disabled={flagSending}
              className="flex items-center gap-1 px-2 py-1.5 rounded bg-purple-600/80 hover:bg-purple-600 text-xs font-medium text-white transition-colors disabled:opacity-50"
            >
              {flagSending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              Send
            </button>
            <button onClick={() => { onSetFlaggingKey(null); onSetFlagNote(''); }} className="p-1 rounded hover:bg-zinc-800 text-zinc-500">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
      {/* Compact action bar: Fix + overflow menu */}
      <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
        {/* Fix -> (primary) */}
        {workspaceId && (() => {
          const fixTab = getFixTab(issue);
          if (!fixTab) return null;
          return (
            <button
              onClick={() => navigate(adminPath(workspaceId, fixTab as Page), { state: { fixContext: { pageId: page.pageId, pageSlug: page.slug, pageName: page.page, issueCheck: issue.check, issueMessage: issue.message } } })}
              className="text-[11px] px-1.5 py-0.5 rounded bg-teal-500/10 hover:bg-teal-500/20 text-teal-400 border border-teal-500/20 flex items-center gap-0.5 transition-colors"
              title={`Open ${FIX_TAB_LABELS[fixTab] || fixTab}`}
            >
              <Wrench className="w-2.5 h-2.5" /> Fix
            </button>
          );
        })()}
        {/* Status badges (show instead of actions when done) */}
        {isFlagged && (
          <span className="text-[10px] px-1 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20 flex items-center gap-0.5">
            <Send className="w-2.5 h-2.5" /> Sent
          </span>
        )}
        {isCreated && (
          <span className="text-[10px] px-1 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20 flex items-center gap-0.5">
            <CheckCircle className="w-2.5 h-2.5" /> Added
          </span>
        )}
        {/* Overflow menu for Flag + Task */}
        {workspaceId && !isFlagged && !isCreated && (
          <OverflowMenu
            menuOpen={menuOpen}
            taskKey={taskKey}
            isCreating={isCreating}
            onToggle={() => onSetActionMenuKey(menuOpen ? null : taskKey)}
            onFlagForClient={() => { onSetFlaggingKey(taskKey); onSetFlagNote(''); onSetActionMenuKey(null); }}
            onCreateTask={() => { onCreateTask(page, issue); onSetActionMenuKey(null); }}
            onSuppress={() => onSuppressIssue(issue.check, page.slug)}
          />
        )}
        {/* Show individual done states when only one is done */}
        {workspaceId && isFlagged && !isCreated && (
          <OverflowMenu
            menuOpen={menuOpen}
            taskKey={taskKey}
            isCreating={isCreating}
            onToggle={() => onSetActionMenuKey(menuOpen ? null : taskKey)}
            onCreateTask={() => { onCreateTask(page, issue); onSetActionMenuKey(null); }}
            onSuppress={() => onSuppressIssue(issue.check, page.slug)}
          />
        )}
        {workspaceId && !isFlagged && isCreated && (
          <OverflowMenu
            menuOpen={menuOpen}
            taskKey={taskKey}
            isCreating={isCreating}
            onToggle={() => onSetActionMenuKey(menuOpen ? null : taskKey)}
            onFlagForClient={() => { onSetFlaggingKey(taskKey); onSetFlagNote(''); onSetActionMenuKey(null); }}
            onSuppress={() => onSuppressIssue(issue.check, page.slug)}
          />
        )}
      </div>
    </div>
  );
}

// ── Overflow menu helper ────────────────────────────────────────

interface OverflowMenuProps {
  menuOpen: boolean;
  taskKey: string;
  isCreating: boolean;
  onToggle: () => void;
  onFlagForClient?: () => void;
  onCreateTask?: () => void;
  onSuppress: () => void;
}

function OverflowMenu({ menuOpen, isCreating, onToggle, onFlagForClient, onCreateTask, onSuppress }: OverflowMenuProps) {
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className={`p-1 rounded transition-colors ${menuOpen ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 opacity-0 group-hover/issue:opacity-100'}`}
        title="More actions"
      >
        <MoreVertical className="w-3 h-3" />
      </button>
      {menuOpen && (
        <div className="absolute right-0 top-full mt-1 w-44 rounded-lg shadow-xl z-50 py-1 bg-zinc-900 border border-zinc-700">
          {onFlagForClient && (
            <button
              onClick={onFlagForClient}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-purple-400 hover:bg-purple-500/10 transition-colors"
            >
              <Send className="w-3 h-3" /> Send to Client
            </button>
          )}
          {onCreateTask && (
            <button
              onClick={onCreateTask}
              disabled={isCreating}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-50"
            >
              {isCreating ? <Loader2 className="w-3 h-3 animate-spin" /> : <ClipboardList className="w-3 h-3" />} Add to Tasks
            </button>
          )}
          <button
            onClick={onSuppress}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-800 transition-colors"
          >
            <EyeOff className="w-3 h-3" /> Suppress Issue
          </button>
        </div>
      )}
    </div>
  );
}
