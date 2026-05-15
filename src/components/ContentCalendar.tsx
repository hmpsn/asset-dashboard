import { useState, useMemo } from 'react';
import {
  ChevronLeft, ChevronRight, FileText, Clipboard, MessageSquare,
  Sparkles, PenLine, Eye, CheckCircle2, Clock, Send, Globe,
  Calendar as CalendarIcon, Layers,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useContentCalendar } from '../hooks/admin';
import { Button, EmptyState, Icon, IconButton } from './ui';
import { adminPath } from '../routes';
import { timeAgo } from '../lib/timeAgo';

// ── Types ──

type ItemType = 'brief' | 'post' | 'request' | 'matrix';

interface CalendarItem {
  id: string;
  type: ItemType;
  label: string;
  sublabel: string;
  status: string;
  date: string; // ISO date string
  publishedAt?: string;
}

// ── Config ──

const TYPE_CONFIG: Record<ItemType, { icon: typeof FileText; color: string; bg: string; border: string; label: string }> = {
  brief:   { icon: Clipboard,      color: 'text-accent-brand',  bg: 'bg-teal-500/10',  border: 'border-teal-500/20', label: 'Brief' },
  post:    { icon: FileText,       color: 'text-accent-warning', bg: 'bg-amber-500/10', border: 'border-amber-500/20', label: 'Post' },
  request: { icon: MessageSquare,  color: 'text-accent-info',  bg: 'bg-blue-500/10',  border: 'border-blue-500/20', label: 'Request' },
  matrix:  { icon: Layers,         color: 'text-accent-brand', bg: 'bg-teal-500/10', border: 'border-teal-500/20', label: 'Matrix Cell' },
};

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

export function ContentCalendar({ workspaceId }: { workspaceId: string }) {
  const navigate = useNavigate();
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // React Query hook replaces manual useEffect fetching
  const { data: items = [], isLoading } = useContentCalendar(workspaceId);
  const [typeFilter, setTypeFilter] = useState<ItemType | 'all'>('all');

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

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Icon as={CalendarIcon} size="lg" className="text-accent-warning" />
          <h2 className="t-h2 text-[var(--brand-text-bright)]">Content Calendar</h2>
        </div>
        <div className="flex items-center gap-2">
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
        </div>
      </div>

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
            <div className={`t-stat ${s.color}`}>{s.value}</div>
            <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

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

                {/* Item dots / mini cards */}
                <div className="space-y-0.5">
                  {dayItems.slice(0, 3).map(item => {
                    const cfg = TYPE_CONFIG[item.type];
                    return (
                      <div
                        key={item.id}
                        className={`t-micro px-1 py-0.5 rounded-[var(--radius-sm)] ${cfg.bg} ${cfg.color} truncate leading-tight`}
                        title={item.label}
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
      {selectedDay && (
        // pr-check-disable-next-line -- Selected-day detail is paired with the calendar grid and shares its signature shell.
        <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
          <div className="px-4 py-3 border-b border-[var(--brand-border)]/50 flex items-center justify-between">
            <span className="t-caption-sm font-medium text-[var(--brand-text-bright)]">
              {new Date(selectedDay + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            </span>
            <span className="t-caption-sm text-[var(--brand-text-muted)]">{selectedItems.length} item{selectedItems.length !== 1 ? 's' : ''}</span>
          </div>

          {selectedItems.length === 0 ? (
            <div className="px-4 py-8 text-center t-caption-sm text-[var(--brand-text-muted)]">No content items on this day</div>
          ) : (
            <div className="divide-y divide-[var(--brand-border)]/50">
              {selectedItems.map(item => {
                const cfg = TYPE_CONFIG[item.type];
                const ItemIcon = cfg.icon;
                const statusCfg = STATUS_ICONS[item.status];
                const StatusIcon = statusCfg?.icon || Clock;
                const statusColor = statusCfg?.color || 'text-[var(--brand-text-muted)]';

                return (
                  <div key={item.id} className="px-4 py-3 flex items-start gap-3 hover:bg-[var(--surface-3)]/30 transition-colors">
                    <div className={`mt-0.5 p-1.5 rounded-[var(--radius-lg)] ${cfg.bg} border ${cfg.border}`}>
                      <Icon as={ItemIcon} size="md" className={cfg.color} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="t-ui text-[var(--brand-text-bright)] truncate">{item.label}</div>
                      <div className="t-caption-sm text-[var(--brand-text-muted)] truncate mt-0.5">{item.sublabel}</div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <Icon as={StatusIcon} size="sm" className={statusColor} />
                      <span className={`t-caption-sm capitalize ${statusColor}`}>
                        {item.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="t-caption-sm text-[var(--brand-text-muted)] flex-shrink-0">
                      {timeAgo(item.date)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {items.length === 0 && !isLoading && (
        <EmptyState
          icon={CalendarIcon}
          title="No content items yet"
          description="Create a content brief to get started"
          action={
            <Button
              onClick={() => navigate(adminPath(workspaceId, 'seo-briefs'))}
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
