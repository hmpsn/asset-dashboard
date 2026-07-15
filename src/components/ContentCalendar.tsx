import { useState, useMemo } from 'react';
import {
  ChevronLeft, ChevronRight, FileText, Clipboard, MessageSquare,
  Sparkles, PenLine, Eye, CheckCircle2, Clock, Send, Globe,
  Calendar as CalendarIcon, Layers, CalendarClock, Wand2, Plus, ArrowUpRight, X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useContentCalendar, useAdminPostsList } from '../hooks/admin';
import type { CalendarItem } from '../hooks/admin/useContentCalendar';
import { Badge, Button, EmptyState, ErrorState, Icon, IconButton } from './ui';
import { adminPath } from '../routes';
import { contentPosts } from '../api/content';
import { queryKeys } from '../lib/queryKeys';
import { useToast } from './Toast';
import type { ContentCalendarDateSuggestion, GeneratedPost } from '../../shared/types/content';

// ── Types ──

type ItemType = 'brief' | 'post' | 'request' | 'matrix';

// ── Config ──

const TYPE_CONFIG: Record<ItemType, { icon: typeof FileText; color: string; bg: string; border: string; label: string }> = {
  brief:   { icon: Clipboard,      color: 'text-accent-brand',  bg: 'bg-teal-500/10',  border: 'border-teal-500/20', label: 'Brief' },
  post:    { icon: FileText,       color: 'text-accent-warning', bg: 'bg-amber-500/10', border: 'border-amber-500/20', label: 'Post' },
  request: { icon: MessageSquare,  color: 'text-accent-info',  bg: 'bg-blue-500/10',  border: 'border-blue-500/20', label: 'Request' },
  matrix:  { icon: Layers,         color: 'text-accent-brand', bg: 'bg-teal-500/10', border: 'border-teal-500/20', label: 'Matrix Cell' },
};

// W6.6: planned items get a distinct teal "intent" treatment (teal = action/intent
// per the Four Laws — these are forward-looking commitments the admin sets), vs the
// per-type colors used for created/published items.
const PLANNED_DOT = 'bg-teal-500/15 text-accent-brand border border-teal-500/30 border-dashed';

// status-semantic-ok: CalendarItem spans multiple domain statuses (briefs, posts, requests,
// matrices). StatusBadge domain mappings are per-entity; a unified icon map is intentional here.
const STATUS_ICONS: Record<string, { icon: typeof Clock; color: string }> = {
  generating:       { icon: Sparkles,     color: 'text-accent-warning' },
  draft:            { icon: PenLine,      color: 'text-accent-info' },
  review:           { icon: Eye,          color: 'text-accent-cyan' },
  approved:         { icon: CheckCircle2, color: 'text-accent-success' },
  requested:        { icon: Send,         color: 'text-accent-info' },
  pending_payment:  { icon: Clock,        color: 'text-[var(--brand-text)]' },
  brief_generated:  { icon: Clipboard,    color: 'text-accent-brand' },
  client_review:    { icon: Eye,          color: 'text-accent-cyan' },
  in_progress:      { icon: Sparkles,     color: 'text-accent-warning' },
  delivered:        { icon: CheckCircle2, color: 'text-accent-success' },
  published:        { icon: Globe,        color: 'text-accent-success' },
  declined:         { icon: Clock,        color: 'text-accent-danger' },
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── Helpers ──

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatMonthYear(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Component ──

interface ContentCalendarProps {
  workspaceId: string;
  embedded?: boolean;
}

export function ContentCalendar({ workspaceId, embedded = false }: ContentCalendarProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // React Query hook replaces manual useEffect fetching
  const { data: rawItems, isLoading, isError, refetch } = useContentCalendar(workspaceId);
  const items = rawItems ?? [];
  const [typeFilter, setTypeFilter] = useState<ItemType | 'all'>('all');

  // Posts list — used by the schedule-a-draft picker (unscheduled drafts only).
  const { data: postsData } = useAdminPostsList(workspaceId);

  // ── Interaction state (W6.6) ──
  const [scheduleDayKey, setScheduleDayKey] = useState<string | null>(null); // future day awaiting a draft pick
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<ContentCalendarDateSuggestion[] | null>(null);

  const invalidateCalendar = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.contentCalendar(workspaceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.posts(workspaceId) });
  };

  const observedPostRevision = (postId: string): number =>
    ((postsData ?? []) as GeneratedPost[]).find(post => post.id === postId)?.generationRevision ?? 0;

  // Drafts with no planned date and not yet published — schedulable onto a future day.
  const unscheduledDrafts = useMemo(() => {
    const list = (postsData ?? []) as Array<{ id: string; title: string; status: string; publishedAt?: string; plannedPublishAt?: string }>;
    return list.filter(p => !p.plannedPublishAt && !p.publishedAt && p.status !== 'generating');
  }, [postsData]);

  // Open a calendar item's underlying artifact.
  //  - post    → Posts tab + ?post=<id> deep-link (ContentManager opens the editor)
  //  - brief   → Briefs tab
  //  - request → pipeline (Posts tab is the closest landing; requests live in the inbox/pipeline)
  //  - matrix  → Planner tab
  const openItem = (item: CalendarItem) => {
    const base = adminPath(workspaceId, 'content-pipeline');
    if (item.type === 'post') {
      navigate(`${base}?tab=posts&post=${encodeURIComponent(item.id)}`);
    } else if (item.type === 'brief') {
      navigate(`${base}?tab=briefs`);
    } else if (item.type === 'matrix') {
      navigate(`${base}?tab=planner`);
    } else {
      navigate(`${base}?tab=posts`);
    }
  };

  // Assign a planned publish date to a draft (schedule-a-draft + suggest-confirm).
  const schedule = async (
    postId: string,
    isoDate: string,
    expectedRevision: number,
  ) => {
    setBusy(true);
    try {
      await contentPosts.setPlannedDate(workspaceId, postId, expectedRevision, isoDate);
      invalidateCalendar();
      setScheduleDayKey(null);
      toast('Draft scheduled', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to schedule draft', 'error');
    } finally {
      setBusy(false);
    }
  };

  // Clear a post's planned date (unschedule).
  const unschedule = async (postId: string) => {
    setBusy(true);
    try {
      await contentPosts.setPlannedDate(workspaceId, postId, observedPostRevision(postId), null);
      invalidateCalendar();
      toast('Draft unscheduled', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to unschedule draft', 'error');
    } finally {
      setBusy(false);
    }
  };

  // Fetch AI-proposed publish dates for unscheduled drafts (wires suggestPublishDates).
  const loadSuggestions = async () => {
    setBusy(true);
    try {
      const res = await contentPosts.suggestDates(workspaceId);
      // The proposal carries the exact server-observed source authority. Store
      // it unchanged; the posts-list cache may already be behind this response.
      setSuggestions(res.suggestions);
      if (res.suggestions.length === 0) {
        toast('No unscheduled drafts to suggest dates for', 'info');
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to load suggestions', 'error');
    } finally {
      setBusy(false);
    }
  };

  // Apply all proposed dates at once.
  const applyAllSuggestions = async () => {
    if (!suggestions || suggestions.length === 0) return;
    setBusy(true);
    try {
      for (const s of suggestions) {
        await contentPosts.setPlannedDate(
          workspaceId,
          s.draftId,
          s.generationRevision,
          s.suggestedDate,
        );
      }
      invalidateCalendar();
      setSuggestions(null);
      toast(`Scheduled ${suggestions.length} draft${suggestions.length !== 1 ? 's' : ''}`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to apply suggestions', 'error');
    } finally {
      setBusy(false);
    }
  };

  // Day-key in local time for a future-day comparison.
  const todayKey = dayKey(new Date());

  // ── Calendar grid ──

  const calendarDays = useMemo(() => {
    const first = startOfMonth(currentMonth);
    const last = endOfMonth(currentMonth);
    const startDay = first.getDay(); // 0=Sun
    const days: Date[] = [];

    // Fill leading blanks from previous month
    for (let i = startDay - 1; i >= 0; i--) {
      const d = new Date(first);
      d.setDate(d.getDate() - i - 1);
      days.push(d);
    }

    // Current month days
    for (let d = 1; d <= last.getDate(); d++) {
      days.push(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), d));
    }

    // Fill trailing days to complete the grid (always 6 rows × 7 = 42)
    while (days.length < 42) {
      const d = new Date(last);
      d.setDate(d.getDate() + (days.length - startDay - last.getDate() + 1));
      days.push(d);
    }

    return days;
  }, [currentMonth]);

  // ── Items grouped by day ──

  const filteredItems = useMemo(
    () => typeFilter === 'all' ? items : items.filter(i => i.type === typeFilter),
    [items, typeFilter],
  );

  const itemsByDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of filteredItems) {
      const d = new Date(item.date);
      const key = dayKey(d);
      const arr = map.get(key) || [];
      arr.push(item);
      map.set(key, arr);
    }
    return map;
  }, [filteredItems]);

  // ── Stats ──

  const stats = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const inMonth = items.filter(i => {
      const d = new Date(i.date);
      return d >= monthStart && d <= monthEnd;
    });
    return {
      briefs: inMonth.filter(i => i.type === 'brief').length,
      posts: inMonth.filter(i => i.type === 'post').length,
      requests: inMonth.filter(i => i.type === 'request').length,
      matrixCells: inMonth.filter(i => i.type === 'matrix').length,
      published: inMonth.filter(i => i.publishedAt || (i.type === 'matrix' && i.status === 'published')).length,
    };
  }, [items, currentMonth]);

  // ── Selected day items ──

  const selectedItems = useMemo(() => {
    if (!selectedDay) return [];
    return itemsByDay.get(selectedDay) || [];
  }, [selectedDay, itemsByDay]);

  const today = new Date();
  const isCurrentMonth = currentMonth.getMonth() === today.getMonth() && currentMonth.getFullYear() === today.getFullYear();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-6 h-6 border-2 rounded-[var(--radius-pill)] animate-spin border-[var(--surface-3)] border-t-teal-400" />
      </div>
    );
  }

  // Only surface the full-screen error when there is no cached data to fall back on.
  // A background refetch failure with stale data present should keep the calendar visible.
  if (isError && !rawItems) {
    return (
      <ErrorState
        title="Couldn't load calendar data"
        message="Content calendar data failed to load. Try reloading."
        actions={[
          { label: 'Retry', onClick: () => { void refetch(); } },
          { label: 'Refresh page', onClick: () => window.location.reload(), variant: 'secondary' },
        ]}
        type="data"
      />
    );
  }

  const calendarControls = (
    <>
      {/* Suggest dates — proposes publish dates for unscheduled drafts (teal=action) */}
      <Button
        onClick={() => { void loadSuggestions(); }}
        disabled={busy || unscheduledDrafts.length === 0}
        variant="ghost"
        size="sm"
        className="t-caption-sm gap-1.5 px-2.5 py-1 rounded-[var(--radius-pill)] border border-teal-500/30 bg-teal-500/10 text-accent-brand hover:bg-teal-500/20 font-medium transition-colors disabled:opacity-40"
        title="Suggest publish dates for unscheduled drafts"
      >
        <Icon as={Wand2} size="sm" />
        Suggest dates
      </Button>
      {/* Type filter pills */}
      {(['all', 'brief', 'post', 'request', 'matrix'] as const).map(t => (
        <Button
          key={t}
          onClick={() => setTypeFilter(t)}
          variant="ghost"
          size="sm"
          className={`t-caption-sm px-2.5 py-1 rounded-[var(--radius-pill)] border font-medium transition-colors ${
            typeFilter === t
              ? 'bg-[var(--surface-3)] border-[var(--brand-border-hover)] text-[var(--brand-text-bright)]'
              : 'bg-[var(--surface-2)] border-[var(--brand-border)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]'
          }`}
        >
          {t === 'all' ? 'All' : TYPE_CONFIG[t].label + 's'}
        </Button>
      ))}
    </>
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      {!embedded ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Icon as={CalendarIcon} size="lg" className="text-accent-warning" />
            <h2 className="t-h2 text-[var(--brand-text-bright)]">Content Calendar</h2>
          </div>
          <div className="flex items-center gap-2">
            {calendarControls}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-2" aria-label="Content calendar controls">
          {calendarControls}
        </div>
      )}

      {/* Month stats */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: 'Briefs', value: stats.briefs, color: 'text-accent-brand', bg: 'bg-teal-500/10', border: 'border-teal-500/20' },
          { label: 'Posts', value: stats.posts, color: 'text-accent-warning', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
          { label: 'Requests', value: stats.requests, color: 'text-accent-info', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
          { label: 'Matrix Cells', value: stats.matrixCells, color: 'text-accent-brand', bg: 'bg-teal-500/10', border: 'border-teal-500/20' },
          { label: 'Published', value: stats.published, color: 'text-accent-success', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
        ].map(s => (
          <div key={s.label} className={`border ${s.border} ${s.bg} px-4 py-3`} style={{ borderRadius: 'var(--radius-signature)' }}>
            <div className={`t-h2 ${s.color}`}>{s.value}</div>
            <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Suggested dates panel (W6.6) — proposals the admin can apply in one click */}
      {suggestions && suggestions.length > 0 && (
        // pr-check-disable-next-line -- Suggestion panel chrome paired with the calendar, shares its signature shell.
        <div className="bg-[var(--surface-2)] border border-teal-500/30 overflow-hidden" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
          <div className="px-4 py-3 border-b border-[var(--brand-border)]/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icon as={Wand2} size="sm" className="text-accent-brand" />
              <span className="t-caption-sm font-medium text-[var(--brand-text-bright)]">
                {suggestions.length} suggested publish date{suggestions.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => { void applyAllSuggestions(); }}
                disabled={busy}
                variant="ghost"
                size="sm"
                className="t-caption-sm px-2.5 py-1 rounded-[var(--radius-pill)] bg-teal-500/10 border border-teal-500/30 text-accent-brand hover:bg-teal-500/20 font-medium transition-colors disabled:opacity-40"
              >
                Apply all
              </Button>
              <IconButton
                onClick={() => setSuggestions(null)}
                icon={X}
                label="Dismiss suggestions"
                size="sm"
                variant="ghost"
              />
            </div>
          </div>
          <div className="divide-y divide-[var(--brand-border)]/50">
            {suggestions.map(s => (
              <div key={s.draftId} className="px-4 py-2.5 flex items-center gap-3">
                <Icon as={FileText} size="sm" className="text-accent-warning flex-shrink-0" />
                <span className="t-caption-sm text-[var(--brand-text-bright)] truncate flex-1">{s.title || 'Untitled draft'}</span>
                <span className="t-caption-sm text-[var(--brand-text-muted)] flex-shrink-0">
                  {new Date(s.suggestedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
                <Button
                  onClick={() => { void schedule(s.draftId, s.suggestedDate, s.generationRevision); }}
                  disabled={busy}
                  variant="ghost"
                  size="sm"
                  className="t-caption-sm px-2 py-0.5 rounded border border-teal-500/30 text-accent-brand hover:bg-teal-500/10 transition-colors disabled:opacity-40"
                >
                  Schedule
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Month navigation */}
      {/* pr-check-disable-next-line -- Calendar navigation toolbar uses brand signature radius as control chrome, not a content card. */}
      <div className="flex items-center justify-between bg-[var(--surface-2)] border border-[var(--brand-border)] px-4 py-2.5" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
        <IconButton
          onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}
          icon={ChevronLeft}
          label="Previous month"
          title="Previous month"
          variant="ghost"
          size="sm"
          className="p-1.5 rounded-[var(--radius-lg)] hover:bg-[var(--surface-3)] text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] transition-colors"
        />
        <div className="flex items-center gap-3">
          <span className="t-ui text-[var(--brand-text-bright)]">{formatMonthYear(currentMonth)}</span>
          {!isCurrentMonth && (
            <Button
              onClick={() => setCurrentMonth(startOfMonth(new Date()))}
              variant="ghost"
              size="sm"
              className="t-caption-sm px-2 py-0.5 rounded border border-[var(--brand-border)] text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] hover:border-[var(--brand-border-hover)] transition-colors"
            >
              Today
            </Button>
          )}
        </div>
        <IconButton
          onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}
          icon={ChevronRight}
          label="Next month"
          title="Next month"
          variant="ghost"
          size="sm"
          className="p-1.5 rounded-[var(--radius-lg)] hover:bg-[var(--surface-3)] text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] transition-colors"
        />
      </div>

      {/* Calendar grid */}
      {/* pr-check-disable-next-line -- Calendar grid needs overflow clipping on the brand signature shell. */}
      <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-[var(--brand-border)]">
          {DAYS.map(d => (
            <div key={d} className="text-center t-caption-sm font-medium text-[var(--brand-text-muted)] py-2">{d}</div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7">
          {calendarDays.map((day, i) => {
            const key = dayKey(day);
            const dayItems = itemsByDay.get(key) || [];
            const isToday = isSameDay(day, today);
            const isThisMonth = day.getMonth() === currentMonth.getMonth();
            const isSelected = selectedDay === key;

            return (
              <Button
                key={i}
                onClick={() => setSelectedDay(isSelected ? null : key)}
                variant="ghost"
                size="sm"
                className={`min-h-[80px] p-1.5 border-b border-r border-[var(--brand-border)]/50 text-left transition-colors relative ${
                  isSelected ? 'bg-[var(--surface-3)]/80' : 'hover:bg-[var(--surface-3)]/30'
                } ${!isThisMonth ? 'opacity-40' : ''} block w-full h-full`}
              >
                <div className={`t-caption-sm font-medium mb-1 ${
                  isToday ? 'text-accent-warning' : isThisMonth ? 'text-[var(--brand-text)]' : 'text-[var(--brand-text-muted)]'
                }`}>
                  {isToday && <span className="inline-block w-5 h-5 leading-5 text-center rounded-[var(--radius-pill)] bg-amber-500/20">{day.getDate()}</span>}
                  {!isToday && day.getDate()}
                </div>

                {/* Item dots / mini cards — planned items get the dashed teal intent treatment */}
                <div className="space-y-0.5">
                  {dayItems.slice(0, 3).map(item => {
                    const cfg = TYPE_CONFIG[item.type];
                    const isPlanned = item.kind === 'planned';
                    return (
                      <div
                        key={item.id}
                        className={`t-micro px-1 py-0.5 rounded-[var(--radius-sm)] truncate leading-tight ${
                          isPlanned ? PLANNED_DOT : `${cfg.bg} ${cfg.color}`
                        }`}
                        title={isPlanned ? `Planned: ${item.label}` : item.label}
                      >
                        {item.label}
                      </div>
                    );
                  })}
                  {dayItems.length > 3 && (
                    <div className="t-micro text-[var(--brand-text-muted)] px-1">+{dayItems.length - 3} more</div>
                  )}
                </div>
              </Button>
            );
          })}
        </div>
      </div>

      {/* Selected day detail panel */}
      {selectedDay && (() => {
        // Future (or today) days can have a draft scheduled onto them.
        const canSchedule = selectedDay >= todayKey;
        const selectedDateIso = new Date(selectedDay + 'T12:00:00').toISOString();
        return (
          // pr-check-disable-next-line -- Selected-day detail is paired with the calendar grid and shares its signature shell.
          <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
            <div className="px-4 py-3 border-b border-[var(--brand-border)]/50 flex items-center justify-between">
              <span className="t-caption-sm font-medium text-[var(--brand-text-bright)]">
                {new Date(selectedDay + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </span>
              <div className="flex items-center gap-2">
                {canSchedule && unscheduledDrafts.length > 0 && (
                  <Button
                    onClick={() => setScheduleDayKey(scheduleDayKey === selectedDay ? null : selectedDay)}
                    variant="ghost"
                    size="sm"
                    className="t-caption-sm gap-1 px-2 py-0.5 rounded-[var(--radius-pill)] border border-teal-500/30 bg-teal-500/10 text-accent-brand hover:bg-teal-500/20 font-medium transition-colors"
                  >
                    <Icon as={Plus} size="sm" />
                    Schedule a draft
                  </Button>
                )}
                <span className="t-caption-sm text-[var(--brand-text-muted)]">{selectedItems.length} item{selectedItems.length !== 1 ? 's' : ''}</span>
              </div>
            </div>

            {/* Schedule-a-draft picker (inline, no drag-and-drop in v1) */}
            {scheduleDayKey === selectedDay && (
              <div className="px-4 py-3 border-b border-[var(--brand-border)]/50 bg-[var(--surface-3)]/40">
                <div className="t-caption-sm text-[var(--brand-text-muted)] mb-2">Pick a draft to schedule on this day:</div>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {unscheduledDrafts.map(d => (
                    <Button
                      key={d.id}
                      onClick={() => { void schedule(d.id, selectedDateIso, observedPostRevision(d.id)); }}
                      disabled={busy}
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start t-caption-sm px-2 py-1.5 rounded-[var(--radius-md)] bg-[var(--surface-2)] border border-[var(--brand-border)] text-[var(--brand-text-bright)] hover:border-teal-500/40 hover:bg-teal-500/5 transition-colors disabled:opacity-40"
                    >
                      <Icon as={FileText} size="sm" className="text-accent-warning flex-shrink-0" />
                      <span className="truncate">{d.title || 'Untitled draft'}</span>
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {selectedItems.length === 0 ? (
              <div className="px-4 py-8 text-center t-caption-sm text-[var(--brand-text-muted)]">
                {canSchedule ? 'No content scheduled for this day' : 'No content items on this day'}
              </div>
            ) : (
              <div className="divide-y divide-[var(--brand-border)]/50">
                {selectedItems.map(item => {
                  const cfg = TYPE_CONFIG[item.type];
                  const ItemIcon = cfg.icon;
                  const statusCfg = STATUS_ICONS[item.status];
                  const StatusIcon = statusCfg?.icon || Clock;
                  const statusColor = statusCfg?.color || 'text-[var(--brand-text-muted)]'; // status-semantic-ok: unified calendar icon color map spans multiple domains
                  const isPlanned = item.kind === 'planned';

                  // Day-panel rows are now clickable — open the underlying artifact.
                  return (
                    <div key={item.id} className="flex items-start gap-1 hover:bg-[var(--surface-3)]/30 transition-colors">
                      <Button
                        onClick={() => openItem(item)}
                        variant="ghost"
                        size="sm"
                        className="flex-1 min-w-0 px-4 py-3 flex items-start gap-3 text-left rounded-none"
                        title="Open"
                      >
                        <span className={`mt-0.5 p-1.5 rounded-[var(--radius-lg)] flex-shrink-0 ${isPlanned ? PLANNED_DOT : `${cfg.bg} border ${cfg.border}`}`}>
                          <Icon as={isPlanned ? CalendarClock : ItemIcon} size="md" className={isPlanned ? 'text-accent-brand' : cfg.color} />
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center gap-1.5">
                            <span className="t-ui text-[var(--brand-text-bright)] truncate">{item.label}</span>
                            {isPlanned && (
                              <Badge label="Planned" tone="teal" />
                            )}
                          </span>
                          <span className="block t-caption-sm text-[var(--brand-text-muted)] truncate mt-0.5">{item.sublabel}</span>
                        </span>
                        <span className="flex items-center gap-1.5 flex-shrink-0">
                          <Icon as={StatusIcon} size="sm" className={statusColor} />
                          <span className={`t-caption-sm capitalize ${statusColor}`}>
                            {item.status.replace(/_/g, ' ')}
                          </span>
                        </span>
                        <Icon as={ArrowUpRight} size="sm" className="text-[var(--brand-text-muted)] flex-shrink-0 mt-0.5" />
                      </Button>
                      {isPlanned && (
                        <IconButton
                          onClick={() => { void unschedule(item.id); }}
                          disabled={busy}
                          icon={X}
                          label="Unschedule draft"
                          title="Clear planned date"
                          size="sm"
                          variant="ghost"
                          className="mt-3 mr-2 flex-shrink-0"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* Empty state */}
      {items.length === 0 && !isLoading && (
        <EmptyState
          icon={CalendarIcon}
          title="No content items yet"
          description="Create a content brief to get started"
          action={
            <Button
              onClick={() => navigate(`${adminPath(workspaceId, 'content-pipeline')}?tab=briefs`)}
              variant="ghost"
              size="sm"
              className="t-caption-sm px-3 py-1.5 rounded-[var(--radius-lg)] bg-teal-500/10 text-accent-brand hover:bg-teal-500/20 transition-colors"
            >
              <Icon as={PenLine} size="sm" />
              Create a Brief
            </Button>
          }
        />
      )}
    </div>
  );
}
