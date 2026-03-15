import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ChevronLeft, ChevronRight, FileText, Clipboard, MessageSquare,
  Sparkles, PenLine, Eye, CheckCircle2, Clock, Send, Globe,
  Calendar as CalendarIcon,
} from 'lucide-react';

// ── Types ──

interface CalendarBrief {
  id: string;
  targetKeyword: string;
  suggestedTitle: string;
  createdAt: string;
}

interface CalendarPost {
  id: string;
  briefId: string;
  targetKeyword: string;
  title: string;
  status: 'generating' | 'draft' | 'review' | 'approved';
  totalWordCount: number;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface CalendarRequest {
  id: string;
  topic: string;
  targetKeyword: string;
  status: string;
  serviceType?: string;
  requestedAt: string;
  updatedAt: string;
}

type ItemType = 'brief' | 'post' | 'request';

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
  brief:   { icon: Clipboard,      color: 'text-teal-400',  bg: 'bg-teal-500/10',  border: 'border-teal-500/20', label: 'Brief' },
  post:    { icon: FileText,       color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', label: 'Post' },
  request: { icon: MessageSquare,  color: 'text-blue-400',  bg: 'bg-blue-500/10',  border: 'border-blue-500/20', label: 'Request' },
};

const STATUS_ICONS: Record<string, { icon: typeof Clock; color: string }> = {
  generating:       { icon: Sparkles,     color: 'text-amber-400' },
  draft:            { icon: PenLine,      color: 'text-blue-400' },
  review:           { icon: Eye,          color: 'text-cyan-400' },
  approved:         { icon: CheckCircle2, color: 'text-green-400' },
  requested:        { icon: Send,         color: 'text-blue-400' },
  pending_payment:  { icon: Clock,        color: 'text-zinc-400' },
  brief_generated:  { icon: Clipboard,    color: 'text-teal-400' },
  client_review:    { icon: Eye,          color: 'text-cyan-400' },
  in_progress:      { icon: Sparkles,     color: 'text-amber-400' },
  delivered:        { icon: CheckCircle2, color: 'text-green-400' },
  published:        { icon: Globe,        color: 'text-green-400' },
  declined:         { icon: Clock,        color: 'text-red-400' },
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

function relativeDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Component ──

export function ContentCalendar({ workspaceId }: { workspaceId: string }) {
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<ItemType | 'all'>('all');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [briefsRes, postsRes, requestsRes] = await Promise.all([
        fetch(`/api/content-briefs/${workspaceId}`),
        fetch(`/api/content-posts/${workspaceId}`),
        fetch(`/api/content-requests/${workspaceId}`),
      ]);

      const allItems: CalendarItem[] = [];

      if (briefsRes.ok) {
        const briefs: CalendarBrief[] = await briefsRes.json();
        for (const b of briefs) {
          allItems.push({
            id: b.id,
            type: 'brief',
            label: b.suggestedTitle || b.targetKeyword,
            sublabel: b.targetKeyword,
            status: 'created',
            date: b.createdAt,
          });
        }
      }

      if (postsRes.ok) {
        const posts: CalendarPost[] = await postsRes.json();
        for (const p of posts) {
          allItems.push({
            id: p.id,
            type: 'post',
            label: p.title,
            sublabel: `${p.totalWordCount}w · ${p.targetKeyword}`,
            status: p.status,
            date: p.publishedAt || p.createdAt,
            publishedAt: p.publishedAt,
          });
        }
      }

      if (requestsRes.ok) {
        const requests: CalendarRequest[] = await requestsRes.json();
        for (const r of requests) {
          allItems.push({
            id: r.id,
            type: 'request',
            label: r.topic,
            sublabel: r.targetKeyword,
            status: r.status,
            date: r.requestedAt,
          });
        }
      }

      setItems(allItems);
    } catch { /* ignore */ }
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { void fetchData(); }, [fetchData]);

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
      published: inMonth.filter(i => i.publishedAt).length,
    };
  }, [items, currentMonth]);

  // ── Selected day items ──

  const selectedItems = useMemo(() => {
    if (!selectedDay) return [];
    return itemsByDay.get(selectedDay) || [];
  }, [selectedDay, itemsByDay]);

  const today = new Date();
  const isCurrentMonth = currentMonth.getMonth() === today.getMonth() && currentMonth.getFullYear() === today.getFullYear();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-6 h-6 border-2 rounded-full animate-spin border-zinc-800 border-t-teal-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CalendarIcon className="w-5 h-5 text-amber-400" />
          <h2 className="text-lg font-semibold text-zinc-100">Content Calendar</h2>
        </div>
        <div className="flex items-center gap-2">
          {/* Type filter pills */}
          {(['all', 'brief', 'post', 'request'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`text-[11px] px-2.5 py-1 rounded-full border font-medium transition-colors ${
                typeFilter === t
                  ? 'bg-zinc-700 border-zinc-600 text-zinc-200'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {t === 'all' ? 'All' : TYPE_CONFIG[t].label + 's'}
            </button>
          ))}
        </div>
      </div>

      {/* Month stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Briefs', value: stats.briefs, color: 'text-teal-400', bg: 'bg-teal-500/10', border: 'border-teal-500/20' },
          { label: 'Posts', value: stats.posts, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
          { label: 'Requests', value: stats.requests, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
          { label: 'Published', value: stats.published, color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/20' },
        ].map(s => (
          <div key={s.label} className={`rounded-xl border ${s.border} ${s.bg} px-4 py-3`}>
            <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-[11px] text-zinc-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Month navigation */}
      <div className="flex items-center justify-between bg-zinc-900 rounded-xl border border-zinc-800 px-4 py-2.5">
        <button
          onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}
          className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-zinc-200">{formatMonthYear(currentMonth)}</span>
          {!isCurrentMonth && (
            <button
              onClick={() => setCurrentMonth(startOfMonth(new Date()))}
              className="text-[11px] px-2 py-0.5 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
            >
              Today
            </button>
          )}
        </div>
        <button
          onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}
          className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Calendar grid */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-zinc-800">
          {DAYS.map(d => (
            <div key={d} className="text-center text-[11px] font-medium text-zinc-500 py-2">{d}</div>
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
              <button
                key={i}
                onClick={() => setSelectedDay(isSelected ? null : key)}
                className={`min-h-[80px] p-1.5 border-b border-r border-zinc-800/50 text-left transition-colors relative ${
                  isSelected ? 'bg-zinc-800/80' : 'hover:bg-zinc-800/30'
                } ${!isThisMonth ? 'opacity-40' : ''}`}
              >
                <div className={`text-[11px] font-medium mb-1 ${
                  isToday ? 'text-amber-400' : isThisMonth ? 'text-zinc-400' : 'text-zinc-600'
                }`}>
                  {isToday && <span className="inline-block w-5 h-5 leading-5 text-center rounded-full bg-amber-500/20">{day.getDate()}</span>}
                  {!isToday && day.getDate()}
                </div>

                {/* Item dots / mini cards */}
                <div className="space-y-0.5">
                  {dayItems.slice(0, 3).map(item => {
                    const cfg = TYPE_CONFIG[item.type];
                    return (
                      <div
                        key={item.id}
                        className={`text-[9px] px-1 py-0.5 rounded ${cfg.bg} ${cfg.color} truncate leading-tight`}
                        title={item.label}
                      >
                        {item.label}
                      </div>
                    );
                  })}
                  {dayItems.length > 3 && (
                    <div className="text-[9px] text-zinc-500 px-1">+{dayItems.length - 3} more</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected day detail panel */}
      {selectedDay && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800/50 flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-300">
              {new Date(selectedDay + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            </span>
            <span className="text-[11px] text-zinc-500">{selectedItems.length} item{selectedItems.length !== 1 ? 's' : ''}</span>
          </div>

          {selectedItems.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-zinc-500">No content items on this day</div>
          ) : (
            <div className="divide-y divide-zinc-800/50">
              {selectedItems.map(item => {
                const cfg = TYPE_CONFIG[item.type];
                const Icon = cfg.icon;
                const statusCfg = STATUS_ICONS[item.status];
                const StatusIcon = statusCfg?.icon || Clock;
                const statusColor = statusCfg?.color || 'text-zinc-500';

                return (
                  <div key={item.id} className="px-4 py-3 flex items-start gap-3 hover:bg-zinc-800/30 transition-colors">
                    <div className={`mt-0.5 p-1.5 rounded-lg ${cfg.bg} border ${cfg.border}`}>
                      <Icon className={`w-3.5 h-3.5 ${cfg.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-zinc-200 truncate">{item.label}</div>
                      <div className="text-[11px] text-zinc-500 truncate mt-0.5">{item.sublabel}</div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <StatusIcon className={`w-3 h-3 ${statusColor}`} />
                      <span className={`text-[11px] capitalize ${statusColor}`}>
                        {item.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="text-[11px] text-zinc-600 flex-shrink-0">
                      {relativeDate(item.date)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {items.length === 0 && !loading && (
        <div className="text-center py-16">
          <CalendarIcon className="w-10 h-10 text-zinc-700 mx-auto mb-3" />
          <div className="text-sm text-zinc-400 mb-1">No content items yet</div>
          <div className="text-[11px] text-zinc-600">Create a content brief to get started</div>
        </div>
      )}
    </div>
  );
}
