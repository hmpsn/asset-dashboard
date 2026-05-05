import { useState, useEffect, useCallback } from 'react';
import { MessageSquarePlus, X, Bug, Lightbulb, MessageCircle, Send, ChevronDown, CheckCircle2, Clock } from 'lucide-react';
import { get, post } from '../../api/client';
import { Button, ClickableRow, Icon, IconButton, cn } from '../ui';
import { useWorkspaceEvents } from '../../hooks/useWorkspaceEvents';
import { WS_EVENTS } from '../../lib/wsEvents';

type FeedbackType = 'bug' | 'feature' | 'general';
type FeedbackStatus = 'new' | 'acknowledged' | 'fixed' | 'wontfix';

interface FeedbackReply {
  id: string;
  author: 'team' | 'client';
  content: string;
  createdAt: string;
}

interface FeedbackItem {
  id: string;
  workspaceId: string;
  type: FeedbackType;
  title: string;
  description: string;
  status: FeedbackStatus;
  context?: { currentTab?: string; browser?: string; screenSize?: string; url?: string; userAgent?: string };
  submittedBy?: string;
  replies: FeedbackReply[];
  createdAt: string;
  updatedAt: string;
}

const TYPE_CONFIG: Record<FeedbackType, { label: string; icon: typeof Bug; color: string; bg: string; border: string }> = {
  bug: { label: 'Bug Report', icon: Bug, color: 'text-accent-danger', bg: 'bg-red-500/10', border: 'border-red-500/20' },
  feature: { label: 'Feature Request', icon: Lightbulb, color: 'text-accent-warning', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  general: { label: 'General Feedback', icon: MessageCircle, color: 'text-accent-brand', bg: 'bg-teal-500/10', border: 'border-teal-500/20' },
};

const STATUS_CONFIG: Record<FeedbackStatus, { label: string; color: string; bg: string }> = {
  new: { label: 'Submitted', color: 'text-accent-info', bg: 'bg-blue-500/10' },
  acknowledged: { label: 'Acknowledged', color: 'text-accent-warning', bg: 'bg-amber-500/10' },
  fixed: { label: 'Resolved', color: 'text-accent-success', bg: 'bg-emerald-500/10' },
  wontfix: { label: 'Noted', color: 'text-[var(--brand-text)]', bg: 'bg-[var(--surface-3)]/10' },
};

interface Props {
  workspaceId: string;
  currentTab: string;
  submittedBy?: string;
  chatExpanded?: boolean;
}

export function FeedbackWidget({ workspaceId, currentTab, submittedBy, chatExpanded }: Props) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'form' | 'list'>('form');
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);

  // Form state
  const [type, setType] = useState<FeedbackType>('general');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadFeedback = useCallback(async () => {
    try {
      const data = await get<FeedbackItem[]>(`/api/public/feedback/${workspaceId}`);
      setItems(data);
    } catch (err) { console.error('FeedbackWidget operation failed:', err); }
  }, [workspaceId]);

  useEffect(() => {
    if (open && view === 'list') loadFeedback();
  }, [open, view, loadFeedback]);

  useWorkspaceEvents(workspaceId, {
    // ws-invalidation-ok — FeedbackWidget uses local state, not React Query.
    [WS_EVENTS.FEEDBACK_NEW]: () => {
      if (open && view === 'list') void loadFeedback();
    },
    // ws-invalidation-ok — FeedbackWidget uses local state, not React Query.
    [WS_EVENTS.FEEDBACK_UPDATE]: () => {
      if (open && view === 'list') void loadFeedback();
    },
  });

  const handleSubmit = async () => {
    if (!title.trim() || !description.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const context = {
        currentTab,
        browser: navigator.userAgent.split(' ').pop() || navigator.userAgent.slice(0, 50),
        screenSize: `${window.innerWidth}x${window.innerHeight}`,
        url: window.location.href,
        userAgent: navigator.userAgent,
      };
      await post(`/api/public/feedback/${workspaceId}`, { type, title: title.trim(), description: description.trim(), context, submittedBy });
      setSubmitted(true);
      setTitle('');
      setDescription('');
      setTimeout(() => { setSubmitted(false); setView('list'); loadFeedback(); }, 1500);
    } catch { setSubmitError('Failed to submit feedback. Please try again.'); }
    finally { setSubmitting(false); }
  };

  const handleReply = async (itemId: string) => {
    if (!replyText.trim()) return;
    try {
      await post(`/api/public/feedback/${workspaceId}/${itemId}/reply`, { content: replyText.trim() });
      setReplyText('');
      setReplyingTo(null);
      loadFeedback();
    } catch { setSubmitError('Failed to send reply. Please try again.'); }
  };

  const unreadCount = items.filter(i => i.replies.some(r => r.author === 'team') && i.status !== 'fixed' && i.status !== 'wontfix').length;

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        icon={MessageSquarePlus}
        variant="secondary"
        className={cn('fixed bottom-6 left-6 rounded-[var(--radius-pill)] shadow-lg z-[var(--z-modal-backdrop)] backdrop-blur-sm', chatExpanded ? 'sm:flex hidden' : '')}
      >
        Feedback
        {unreadCount > 0 && (
          <span className="w-4 h-4 rounded-[var(--radius-pill)] bg-[var(--teal)] t-micro font-bold text-[var(--button-primary-text)] flex items-center justify-center">{unreadCount}</span>
        )}
      </Button>
    );
  }

  return (
    <div className={cn('fixed bottom-6 left-6 w-[360px] max-h-[520px] bg-[var(--surface-2)] rounded-[var(--radius-xl)] border border-[var(--brand-border)] shadow-2xl shadow-black/40 overflow-hidden z-[var(--z-modal-backdrop)] flex flex-col', chatExpanded ? 'sm:flex hidden' : '')}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--brand-border)] flex-shrink-0">
        <div className="flex items-center gap-2">
          <Icon as={MessageSquarePlus} size="md" className="text-accent-brand" />
          <span className="t-ui font-medium text-[var(--brand-text-bright)]">Beta Feedback</span>
          <span className="t-caption-sm text-accent-brand bg-teal-500/10 px-1.5 py-0.5 rounded-[var(--radius-sm)] border border-teal-500/20">beta</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            onClick={() => setView(view === 'form' ? 'list' : 'form')}
            variant={view === 'list' ? 'link' : 'ghost'}
            size="sm"
          >
            {view === 'form' ? `History${items.length > 0 ? ` (${items.length})` : ''}` : '+ New'}
          </Button>
          <IconButton icon={X} label="Close feedback" size="sm" onClick={() => setOpen(false)} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {view === 'form' ? (
          submitted ? (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <div className="w-12 h-12 rounded-[var(--radius-pill)] bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-3">
                <Icon as={CheckCircle2} size="xl" className="text-accent-success" />
              </div>
              <p className="t-ui font-medium text-[var(--brand-text-bright)]">Thank you!</p>
              <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1">Your feedback has been submitted.</p>
            </div>
          ) : (
            <div className="p-4 space-y-3">
              {/* Type selector */}
              <div className="grid grid-cols-3 gap-3">
                {(Object.entries(TYPE_CONFIG) as [FeedbackType, typeof TYPE_CONFIG['bug']][]).map(([key, cfg]) => {
                  const Icon = cfg.icon;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setType(key)}
                      className={cn('flex flex-col items-center gap-1.5 px-2 py-2.5 rounded-[var(--radius-xl)] border t-caption-sm font-medium transition-all', type === key ? `${cfg.bg} ${cfg.border} ${cfg.color}` : 'bg-[var(--surface-3)]/50 border-[var(--brand-border)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:border-[var(--brand-border-hover)]')}
                    >
                      <Icon className="w-4 h-4" />
                      {cfg.label.split(' ')[0]}
                    </button>
                  );
                })}
              </div>

              {/* Title */}
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder={type === 'bug' ? 'What went wrong?' : type === 'feature' ? 'What would you like?' : 'Quick summary'}
                className="w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] px-3 py-2 t-caption text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:border-teal-500 transition-colors"
              />

              {/* Description */}
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder={type === 'bug' ? 'Steps to reproduce, what you expected, what happened...' : type === 'feature' ? 'Describe the feature and how it would help you...' : 'Tell us what you think...'}
                rows={4}
                className="w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] px-3 py-2 t-caption text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:border-teal-500 transition-colors resize-none"
              />

              {/* Auto-context badge */}
              <div className="flex items-center gap-1.5 t-micro text-[var(--brand-text-muted)]">
                <div className="w-1.5 h-1.5 rounded-[var(--radius-pill)] bg-[var(--brand-text-muted)]" />
                Context auto-attached: current tab, browser, screen size
              </div>

              {/* Error */}
              {submitError && (
                <p className="t-caption-sm text-accent-danger">{submitError}</p>
              )}
              {/* Submit */}
              <Button
                onClick={handleSubmit}
                disabled={submitting || !title.trim() || !description.trim()}
                loading={submitting}
                icon={Send}
                className="w-full rounded-[var(--radius-lg)]"
              >
                {submitting ? 'Submitting...' : 'Submit Feedback'}
              </Button>

            </div>
          )
        ) : (
          /* History list */
          <div className="p-3 space-y-2">
            {items.length === 0 && (
              <div className="py-8 text-center">
                <Icon as={MessageSquarePlus} size="xl" className="text-[var(--brand-border)] mx-auto mb-2" />
                <p className="t-caption-sm text-[var(--brand-text-muted)]">No feedback submitted yet.</p>
                <Button onClick={() => setView('form')} variant="link" size="sm" className="mt-2">
                  Submit your first feedback
                </Button>
              </div>
            )}
            {items.map(item => {
              const cfg = TYPE_CONFIG[item.type];
              const Icon = cfg.icon;
              const statusCfg = STATUS_CONFIG[item.status];
              const isExpanded = expandedId === item.id;
              const hasTeamReply = item.replies.some(r => r.author === 'team');

              return (
                <div key={item.id} className="bg-[var(--surface-3)]/50 border border-[var(--brand-border)] overflow-hidden" style={{ borderRadius: 'var(--radius-signature)' }}>
                  <ClickableRow
                    onClick={() => setExpandedId(isExpanded ? null : item.id)}
                    active={isExpanded}
                    className="flex items-start gap-2.5 px-3 py-2.5"
                  >
                    <div className={`w-6 h-6 rounded-[var(--radius-lg)] ${cfg.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                      <Icon className={`w-3 h-3 ${cfg.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="t-ui font-medium text-[var(--brand-text-bright)] truncate">{item.title}</span>
                        {hasTeamReply && <span className="w-1.5 h-1.5 rounded-[var(--radius-pill)] bg-teal-400 flex-shrink-0" />}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={cn('t-micro px-1.5 py-0.5 rounded-[var(--radius-sm)] font-medium', statusCfg.bg, statusCfg.color)}>{statusCfg.label}</span>
                        <span className="t-micro text-[var(--brand-text-muted)]">{new Date(item.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <ChevronDown className={cn('w-3.5 h-3.5 text-[var(--brand-text-muted)] flex-shrink-0 mt-1 transition-transform', isExpanded ? 'rotate-180' : '')} />
                  </ClickableRow>

                  {isExpanded && (
                    <div className="px-3 pb-3 border-t border-[var(--brand-border)]">
                      <p className="t-caption-sm text-[var(--brand-text)] mt-2 leading-relaxed">{item.description}</p>

                      {/* Replies */}
                      {item.replies.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {item.replies.map(reply => (
                            <div key={reply.id} className={cn('rounded-[var(--radius-lg)] px-2.5 py-2', reply.author === 'team' ? 'bg-teal-500/5 border border-teal-500/10' : 'bg-[var(--surface-3)]/60 border border-[var(--brand-border)]/50')}>
                              <div className="flex items-center gap-1.5 mb-1">
                                <span className={cn('t-micro font-medium', reply.author === 'team' ? 'text-accent-brand' : 'text-[var(--brand-text)]')}>
                                  {reply.author === 'team' ? 'Team' : 'You'}
                                </span>
                                <span className="t-micro text-[var(--brand-text-muted)]">{new Date(reply.createdAt).toLocaleDateString()}</span>
                              </div>
                              <p className="t-caption-sm text-[var(--brand-text)] leading-relaxed">{reply.content}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Reply input */}
                      {item.status !== 'fixed' && item.status !== 'wontfix' && (
                        replyingTo === item.id ? (
                          <div className="mt-2 flex gap-1.5">
                            <input
                              type="text"
                              value={replyText}
                              onChange={e => setReplyText(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && handleReply(item.id)}
                              placeholder="Add a reply..."
                              className="flex-1 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] px-2.5 py-1.5 t-caption-sm text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:border-teal-500"
                              autoFocus
                            />
                            <IconButton icon={Send} label="Send reply" size="sm" variant="accent" onClick={() => handleReply(item.id)} disabled={!replyText.trim()} />
                            <IconButton icon={X} label="Cancel reply" size="sm" onClick={() => { setReplyingTo(null); setReplyText(''); }} />
                          </div>
                        ) : (
                          <Button
                            onClick={() => setReplyingTo(item.id)}
                            variant="link"
                            size="sm"
                            className="mt-2"
                          >
                            Reply
                          </Button>
                        )
                      )}

                      {/* Context info */}
                      {item.context?.currentTab && (
                        <div className="mt-2 flex items-center gap-1.5">
                          <Clock className="w-2.5 h-2.5 text-[var(--brand-text-muted)]" />
                          <span className="t-micro text-[var(--brand-text-muted)]">Submitted from: {item.context.currentTab} tab</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
