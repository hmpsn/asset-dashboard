/**
 * AuditIssueRow — renders a single audit issue with action buttons.
 * Extracted from SeoAudit.tsx per-issue rendering logic.
 */
import { useNavigate } from 'react-router-dom';
import { adminPath, type Page } from '../../routes';
import {
  CheckCircle, Send, Wrench, X, Pencil,
  MoreVertical, EyeOff, ClipboardList, Layers, FileSearch,
} from 'lucide-react';
import { Button, Icon, IconButton, cn } from '../ui';
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
  onSetEditingKey: (key: string | null) => void;
  onSetEditedSuggestion: (fixKey: string, text: string) => void;
  onSetActionMenuKey: (key: string | null) => void;
  onCreateTask: (page: PageSeoResult, issue: SeoIssue) => void;
  onFlagForClient: (page: PageSeoResult, issue: SeoIssue, note: string) => void;
  onSetFlaggingKey: (key: string | null) => void;
  onSetFlagNote: (note: string) => void;
  onSuppressIssue: (check: string, pageSlug: string) => void;
  onSuppressPattern?: (check: string, pageSlug: string) => void;
  issueToTaskKey: (page: PageSeoResult, issue: SeoIssue) => string;
}

export function AuditIssueRow({
  page, issue, idx, workspaceId, siteId: _siteId,
  applyingFix, appliedFixes, editedSuggestions, editingKey,
  createdTasks, creatingTask, flaggedIssues, flaggingKey, flagNote, flagSending, actionMenuKey,
  onAcceptSuggestion, onSetEditingKey, onSetEditedSuggestion,
  onSetActionMenuKey, onCreateTask, onFlagForClient, onSetFlaggingKey, onSetFlagNote,
  onSuppressIssue, onSuppressPattern, issueToTaskKey,
}: AuditIssueRowProps) {
  const navigate = useNavigate();

  const cfg = SEVERITY_CONFIG[issue.severity];
  const catCfg = issue.category ? CATEGORY_CONFIG[issue.category] : null;
  const SeverityIcon = cfg.icon;
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
    <div key={idx} className="flex items-start gap-3 px-4 py-2 rounded-[var(--radius-lg)] hover:bg-[var(--surface-2)]/30 transition-colors group/issue">
      <Icon as={SeverityIcon} size="md" className={cn('mt-0.5 flex-shrink-0', cfg.color)} />
      <div className="flex-1 min-w-0">
        {/* Issue title + inline badges */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="t-caption text-[var(--brand-text-bright)]">{issue.message}</span>
          {catCfg && (
            <span className={cn('t-micro px-1 py-px rounded border border-[var(--brand-border)] leading-tight', catCfg.color)}>
              {catCfg.label}
            </span>
          )}
          <span className={cn('t-micro px-1 py-px rounded border leading-tight', cfg.bg, cfg.color)}>
            {issue.check}
          </span>
        </div>
        <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">{issue.recommendation}</div>
        {issue.value && <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5 italic truncate">{issue.value}</div>}
        {/* Editable AI suggestion */}
        {issue.suggestedFix && (
          <div className="mt-1.5 px-2 py-1.5 rounded bg-emerald-950/40 border border-emerald-800/30">
            <div className="flex items-center justify-between mb-0.5">
              <div className="flex items-center gap-1.5">
                <span className="t-micro text-emerald-500 font-semibold uppercase tracking-wider">AI Suggestion</span>
                {!isApplied && !isEditing && (
                  <Button
                    onClick={() => { onSetEditingKey(fixKey); if (!editedText) onSetEditedSuggestion(fixKey, issue.suggestedFix!); }}
                    variant="ghost"
                    className="t-micro text-emerald-500/60 hover:text-emerald-400 px-0 py-0 h-auto"
                    title="Edit before sending"
                  >
                    <Pencil className="w-2.5 h-2.5" /> Edit
                  </Button>
                )}
              </div>
              {isApplied ? (
                <span className="t-micro px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-medium flex items-center gap-1">
                  <CheckCircle className="w-2.5 h-2.5" /> Applied
                </span>
              ) : (
                <div className="flex items-center gap-1">
                  <Button
                    onClick={() => onAcceptSuggestion(page.pageId, issue)}
                    disabled={isApplying}
                    loading={isApplying}
                    icon={CheckCircle}
                    variant="ghost"
                    className="t-micro px-1.5 py-0.5 h-auto rounded bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 font-medium transition-colors disabled:opacity-50"
                  >
                    {isApplying ? 'Pushing...' : 'Apply Now'}
                  </Button>
                </div>
              )}
            </div>
            {isEditing ? (
              <textarea
                value={editedText || issue.suggestedFix}
                onChange={e => onSetEditedSuggestion(fixKey, e.target.value)}
                onBlur={() => onSetEditingKey(null)}
                onKeyDown={e => { if (e.key === 'Escape') onSetEditingKey(null); }}
                className="w-full t-caption-sm text-emerald-300 bg-emerald-950/60 border border-emerald-700/40 rounded px-1.5 py-1 focus:outline-none focus:border-emerald-500/50 resize-none"
                rows={2}
                autoFocus
              />
            ) : (
              <div
                className="t-caption-sm text-emerald-300 cursor-text"
                onClick={() => { onSetEditingKey(fixKey); if (!editedText) onSetEditedSuggestion(fixKey, issue.suggestedFix!); }}
                title="Click to edit"
              >
                {editedText || issue.suggestedFix}
                {editedText && editedText !== issue.suggestedFix && (
                  <span className="ml-1 t-micro text-emerald-500/50 italic">(edited)</span>
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
              className="flex-1 px-2 py-1.5 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded t-caption text-[var(--brand-text-bright)] placeholder-zinc-500 focus:outline-none focus:border-purple-500/50"
              onKeyDown={e => e.key === 'Enter' && onFlagForClient(page, issue, flagNote)}
              autoFocus
            />
            <Button
              onClick={() => onFlagForClient(page, issue, flagNote)}
              disabled={flagSending}
              loading={flagSending}
              icon={Send}
              size="sm"
              className="px-2 py-1.5 rounded bg-purple-600/80 hover:bg-purple-600 t-caption font-medium text-white transition-colors disabled:opacity-50"
            >
              Send
            </Button>
            <IconButton
              onClick={() => { onSetFlaggingKey(null); onSetFlagNote(''); }}
              icon={X}
              label="Cancel flag note"
              variant="ghost"
              size="sm"
              className="rounded hover:bg-[var(--surface-2)] text-[var(--brand-text-muted)]"
            />
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
            <Button
              onClick={() => navigate(adminPath(workspaceId, fixTab as Page), { state: { fixContext: { targetRoute: fixTab, pageId: page.pageId, pageSlug: page.slug, pageName: page.page, issueCheck: issue.check, issueMessage: issue.message } } })}
              variant="ghost"
              className="t-caption-sm px-1.5 py-0.5 h-auto rounded bg-teal-500/10 hover:bg-teal-500/20 text-teal-400 border border-teal-500/20 transition-colors"
              title={`Open ${FIX_TAB_LABELS[fixTab] || fixTab}`}
            >
              <Wrench className="w-2.5 h-2.5" /> Fix
            </Button>
          );
        })()}
        {/* View Page → Page Intelligence (deep-dive into all page signals) */}
        {workspaceId && page.pageId && (
          <Button
            onClick={() => navigate(adminPath(workspaceId, 'page-intelligence'), { state: { fixContext: { targetRoute: 'page-intelligence', pageId: page.pageId, pageSlug: page.slug, pageName: page.page } } })}
            variant="ghost"
            className="t-caption-sm px-1.5 py-0.5 h-auto rounded bg-[var(--surface-2)]/60 hover:bg-[var(--surface-3)]/60 text-[var(--brand-text)] border border-[var(--brand-border)]/40 transition-colors"
            title="View in Page Intelligence"
          >
            <FileSearch className="w-2.5 h-2.5" /> Page
          </Button>
        )}
        {/* Status badges (show instead of actions when done) */}
        {isFlagged && (
          <span className="t-micro px-1 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20 flex items-center gap-0.5">
            <Send className="w-2.5 h-2.5" /> Sent
          </span>
        )}
        {isCreated && (
          <span className="t-micro px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-0.5">
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
            onSuppress={() => { onSetActionMenuKey(null); onSuppressIssue(issue.check, page.slug); }}
            onSuppressPattern={onSuppressPattern ? () => { onSetActionMenuKey(null); onSuppressPattern(issue.check, page.slug); } : undefined}
            pageSlug={page.slug}
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
            onSuppress={() => { onSetActionMenuKey(null); onSuppressIssue(issue.check, page.slug); }}
            onSuppressPattern={onSuppressPattern ? () => { onSetActionMenuKey(null); onSuppressPattern(issue.check, page.slug); } : undefined}
            pageSlug={page.slug}
          />
        )}
        {workspaceId && !isFlagged && isCreated && (
          <OverflowMenu
            menuOpen={menuOpen}
            taskKey={taskKey}
            isCreating={isCreating}
            onToggle={() => onSetActionMenuKey(menuOpen ? null : taskKey)}
            onFlagForClient={() => { onSetFlaggingKey(taskKey); onSetFlagNote(''); onSetActionMenuKey(null); }}
            onSuppress={() => { onSetActionMenuKey(null); onSuppressIssue(issue.check, page.slug); }}
            onSuppressPattern={onSuppressPattern ? () => { onSetActionMenuKey(null); onSuppressPattern(issue.check, page.slug); } : undefined}
            pageSlug={page.slug}
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
  onSuppressPattern?: () => void;
  pageSlug?: string;
}

function OverflowMenu({ menuOpen, isCreating, onToggle, onFlagForClient, onCreateTask, onSuppress, onSuppressPattern, pageSlug }: OverflowMenuProps) {
  const slugPrefix = pageSlug?.includes('/') ? pageSlug.split('/')[0] : null;
  return (
    <div className="relative">
      <IconButton
        onClick={onToggle}
        icon={MoreVertical}
        label="More actions"
        title="More actions"
        variant="ghost"
        size="sm"
        className={cn(
          'rounded transition-colors',
          menuOpen
            ? 'bg-[var(--surface-3)] text-[var(--brand-text-bright)]'
            : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--surface-2)] opacity-0 group-hover/issue:opacity-100',
        )}
      />
      {menuOpen && (
        <div className="absolute right-0 top-full mt-1 w-44 rounded-[var(--radius-lg)] shadow-xl z-[var(--z-modal)] py-1 bg-[var(--surface-2)] border border-[var(--brand-border)]">
          {onFlagForClient && (
            <Button
              onMouseDown={e => { e.stopPropagation(); onFlagForClient(); }}
              variant="ghost"
              className="w-full justify-start px-3 py-1.5 h-auto t-caption text-purple-400 hover:bg-purple-500/10 transition-colors"
            >
              <Send className="w-3 h-3" /> Send to Client
            </Button>
          )}
          {onCreateTask && (
            <Button
              onMouseDown={e => { e.stopPropagation(); onCreateTask(); }}
              disabled={isCreating}
              loading={isCreating}
              icon={ClipboardList}
              variant="ghost"
              className="w-full justify-start px-3 py-1.5 h-auto t-caption text-[var(--brand-text-bright)] hover:bg-[var(--surface-3)] transition-colors disabled:opacity-50"
            >
              Add to Tasks
            </Button>
          )}
          <Button
            onMouseDown={e => { e.stopPropagation(); onSuppress(); }}
            variant="ghost"
            className="w-full justify-start px-3 py-1.5 h-auto t-caption text-[var(--brand-text-muted)] hover:bg-[var(--surface-3)] transition-colors"
          >
            <EyeOff className="w-3 h-3" /> Suppress Issue
          </Button>
          {onSuppressPattern && slugPrefix && (
            <Button
              onMouseDown={e => { e.stopPropagation(); onSuppressPattern(); }}
              variant="ghost"
              className="w-full justify-start px-3 py-1.5 h-auto t-caption text-[var(--brand-text-muted)] hover:bg-[var(--surface-3)] transition-colors"
            >
              <Layers className="w-3 h-3" /> Suppress for {slugPrefix}/*
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
