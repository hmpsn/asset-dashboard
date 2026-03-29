import { useState, useEffect } from 'react';
import {
  LineChart as LineChartIcon, ChevronDown, ChevronUp, Filter, Search, Loader2,
  Users, Clock, ArrowDownRight, UserPlus,
} from 'lucide-react';
import { StatCard, EmptyState } from '../ui';
import {
  ResponsiveContainer, AreaChart, Area,
  XAxis, YAxis, Tooltip, PieChart, Pie, Cell,
} from 'recharts';
import SearchableSelect from '../SearchableSelect';
import { OrganicInsight } from './DataSnapshots';
import { get, getSafe } from '../../api/client';
import type {
  GA4Overview, GA4DailyTrend, GA4TopPage, GA4TopSource,
  GA4DeviceBreakdown, GA4Event, GA4ConversionSummary,
  GA4EventTrend, GA4EventPageBreakdown,
  GA4Comparison, GA4NewVsReturning, GA4OrganicOverview, GA4LandingPage,
  WorkspaceInfo,
} from './types';

interface AnalyticsTabProps {
  ga4Overview: GA4Overview | null;
  ga4Comparison: GA4Comparison | null;
  ga4Trend: GA4DailyTrend[];
  ga4Devices: GA4DeviceBreakdown[];
  ga4Pages: GA4TopPage[];
  ga4Sources: GA4TopSource[];
  ga4Organic: GA4OrganicOverview | null;
  ga4LandingPages: GA4LandingPage[];
  ga4NewVsReturning: GA4NewVsReturning[] | null;
  ga4Conversions: GA4ConversionSummary[];
  ga4Events: GA4Event[];
  ws: WorkspaceInfo;
  days: number;
}

export function AnalyticsTab({
  ga4Overview, ga4Comparison, ga4Trend, ga4Devices, ga4Pages, ga4Sources,
  ga4Organic, ga4LandingPages, ga4NewVsReturning,
  ga4Conversions, ga4Events, ws, days,
}: AnalyticsTabProps) {
  // Analytics-internal state
  const [ga4SelectedEvent, setGa4SelectedEvent] = useState<string | null>(null);
  const [ga4EventTrend, setGa4EventTrend] = useState<GA4EventTrend[]>([]);
  const [explorerData, setExplorerData] = useState<GA4EventPageBreakdown[]>([]);
  const [explorerEvent, setExplorerEvent] = useState('');
  const [explorerPage, setExplorerPage] = useState('');
  const [explorerLoading, setExplorerLoading] = useState(false);
  const [showExplorer, setShowExplorer] = useState(false);
  const [modulePageFilters, setModulePageFilters] = useState<Record<string, string>>({});
  const [modulePageData, setModulePageData] = useState<Record<string, GA4ConversionSummary[]>>({});
  const [modulePageLoading, setModulePageLoading] = useState<Record<string, boolean>>({});

  // ── Helper functions ──

  const eventDisplayName = (eventName: string): string => {
    const cfg = ws?.eventConfig?.find(c => c.eventName === eventName);
    return cfg?.displayName && cfg.displayName !== eventName ? cfg.displayName : eventName.replace(/_/g, ' ');
  };

  const isEventPinned = (eventName: string): boolean => {
    return ws?.eventConfig?.find(c => c.eventName === eventName)?.pinned || false;
  };

  const sortedConversions = [...ga4Conversions].sort((a, b) => {
    const ap = isEventPinned(a.eventName) ? 1 : 0;
    const bp = isEventPinned(b.eventName) ? 1 : 0;
    return bp - ap;
  });

  const fetchEventsForModule = async (moduleId: string, pagePath: string) => {
    if (!ws) return;
    if (!pagePath) {
      setModulePageData(prev => { const n = { ...prev }; delete n[moduleId]; return n; });
      return;
    }
    setModulePageLoading(prev => ({ ...prev, [moduleId]: true }));
    try {
      const params = new URLSearchParams({ days: String(days), page: pagePath });
      const data = await getSafe<GA4EventPageBreakdown[]>(`/api/public/analytics-event-explorer/${ws.id}?${params}`, []);
      if (Array.isArray(data)) {
        const byEvent: Record<string, { conversions: number; users: number }> = {};
        for (const row of data) {
          if (!byEvent[row.eventName]) byEvent[row.eventName] = { conversions: 0, users: 0 };
          byEvent[row.eventName].conversions += row.eventCount;
          byEvent[row.eventName].users += row.users;
        }
        const totalUsers = Object.values(byEvent).reduce((s, v) => s + v.users, 0) || 1;
        setModulePageData(prev => ({
          ...prev,
          [moduleId]: Object.entries(byEvent).map(([eventName, v]) => ({
            eventName, conversions: v.conversions, users: v.users,
            rate: Math.round((v.conversions / totalUsers) * 100 * 10) / 10,
          })).sort((a, b) => b.conversions - a.conversions),
        }));
      }
    } catch (err) {
      console.error('AnalyticsTab operation failed:', err);
      setModulePageData(prev => { const n = { ...prev }; delete n[moduleId]; return n; });
    } finally {
      setModulePageLoading(prev => ({ ...prev, [moduleId]: false }));
    }
  };

  const runExplorer = async (event?: string, page?: string) => {
    if (!ws) return;
    setExplorerLoading(true);
    try {
      const params = new URLSearchParams({ days: String(days) });
      if (event) params.set('event', event);
      if (page) params.set('page', page);
      const data = await getSafe<GA4EventPageBreakdown[]>(`/api/public/analytics-event-explorer/${ws.id}?${params}`, []);
      if (Array.isArray(data)) setExplorerData(data);
    } catch { setExplorerData([]); }
    finally { setExplorerLoading(false); }
  };

  const loadEventTrend = async (eventName: string) => {
    if (!ws) return;
    setGa4SelectedEvent(eventName);
    try {
      const data = await getSafe<GA4EventTrend[]>(`/api/public/analytics-event-trend/${ws.id}?days=${days}&event=${encodeURIComponent(eventName)}`, []);
      if (Array.isArray(data)) setGa4EventTrend(data);
    } catch { setGa4EventTrend([]); }
  };

  // Initialize per-module page filters from group defaults
  useEffect(() => {
    if (!ws || ga4Pages.length === 0) return;
    const groups = ws.eventGroups || [];
    const defaults: Record<string, string> = {};
    for (const g of groups) {
      if (g.defaultPageFilter) defaults[g.id] = g.defaultPageFilter;
    }
    if (Object.keys(defaults).length > 0) {
      setModulePageFilters(prev => ({ ...defaults, ...prev }));
      for (const [moduleId, pagePath] of Object.entries(defaults)) {
        if (!modulePageData[moduleId]) fetchEventsForModule(moduleId, pagePath);
      }
    }
  }, [ws?.eventGroups, ga4Pages.length]);

  if (!ga4Overview) {
    return (
      <EmptyState
        icon={LineChartIcon}
        title="Analytics Coming Soon"
        description="We're connecting your Google Analytics — no action needed on your end. Once connected, you'll see visitor trends, traffic sources, top pages, and conversion events here."
      />
    );
  }

  return (<>
    <div className="mb-2">
      <h2 className="text-xl font-semibold text-zinc-100">Analytics</h2>
      <p className="text-sm text-zinc-500 mt-1">{ga4Overview.dateRange ? `${ga4Overview.dateRange.start} — ${ga4Overview.dateRange.end}` : 'Google Analytics overview'}</p>
    </div>

    {/* GA4 Overview Cards */}
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
      <StatCard size="hero" icon={Users} label="Users" value={ga4Overview.totalUsers.toLocaleString()} valueColor="text-teal-400" delta={ga4Comparison?.changePercent.users} deltaLabel="%" staggerIndex={0} />
      <StatCard size="hero" icon={LineChartIcon} label="Sessions" value={ga4Overview.totalSessions.toLocaleString()} valueColor="text-blue-400" delta={ga4Comparison?.changePercent.sessions} deltaLabel="%" staggerIndex={1} />
      <StatCard size="hero" label="Page Views" value={ga4Overview.totalPageviews.toLocaleString()} valueColor="text-teal-400" delta={ga4Comparison?.changePercent.pageviews} deltaLabel="%" staggerIndex={2} />
      <StatCard size="hero" icon={Clock} label="Avg Duration" value={`${Math.floor(ga4Overview.avgSessionDuration / 60)}m ${Math.floor(ga4Overview.avgSessionDuration % 60)}s`} valueColor="text-amber-400" staggerIndex={3} />
      <StatCard size="hero" icon={ArrowDownRight} label="Bounce Rate" value={`${ga4Overview.bounceRate}%`} valueColor={ga4Overview.bounceRate > 60 ? 'text-red-400' : 'text-emerald-400'} delta={ga4Comparison?.change.bounceRate ? -ga4Comparison.change.bounceRate : undefined} deltaLabel="pp" staggerIndex={4} />
      <StatCard size="hero" icon={UserPlus} label="New Users" value={`${ga4Overview.newUserPercentage}%`} valueColor="text-teal-400" staggerIndex={5} />
    </div>

    {/* Traffic Trend + Devices row */}
    {ga4Trend.length > 0 && (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Traffic Trend (2/3) */}
        <div className="lg:col-span-2 bg-zinc-900 rounded-xl border border-zinc-800 p-5">
          <h3 className="text-sm font-semibold text-zinc-200 mb-4">Traffic Trend</h3>
          <ResponsiveContainer width="100%" height={192}>
            <AreaChart data={ga4Trend} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="ga4grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2dd4bf" stopOpacity={0.15} />
                  <stop offset="100%" stopColor="#2dd4bf" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" hide />
              <YAxis yAxisId="users" hide domain={[0, 'dataMax']} />
              <YAxis yAxisId="sessions" hide domain={[0, 'dataMax']} orientation="right" />
              <YAxis yAxisId="pv" hide domain={[0, 'dataMax']} orientation="right" />
              <Tooltip content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0]?.payload as GA4DailyTrend | undefined;
                if (!row) return null;
                return (
                  <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl shadow-black/40 min-w-[140px] overflow-hidden">
                    <div className="px-3 py-1.5 border-b border-zinc-800 text-[11px] font-semibold text-zinc-200">{row.date}</div>
                    <div className="px-3 py-1.5 space-y-1">
                      <div className="flex justify-between text-[11px]"><span className="text-teal-400">Users</span><span className="text-zinc-200 font-medium">{row.users.toLocaleString()}</span></div>
                      <div className="flex justify-between text-[11px]"><span className="text-blue-400">Sessions</span><span className="text-zinc-200 font-medium">{row.sessions.toLocaleString()}</span></div>
                      <div className="flex justify-between text-[11px]"><span className="text-teal-400/40">Pageviews</span><span className="text-zinc-200 font-medium">{row.pageviews.toLocaleString()}</span></div>
                    </div>
                  </div>
                );
              }} />
              <Area yAxisId="pv" type="monotone" dataKey="pageviews" stroke="rgba(45,212,191,0.3)" strokeWidth={1.5} fill="none" dot={false} />
              <Area yAxisId="sessions" type="monotone" dataKey="sessions" stroke="rgba(96,165,250,0.5)" strokeWidth={1.5} fill="none" dot={false} />
              <Area yAxisId="users" type="monotone" dataKey="users" stroke="rgba(45,212,191,0.9)" strokeWidth={2} fill="url(#ga4grad)" dot={false} activeDot={{ r: 3, fill: '#2dd4bf', stroke: '#18181b', strokeWidth: 1.5 }} />
            </AreaChart>
          </ResponsiveContainer>
          <div className="flex items-center justify-center gap-6 mt-2">
            <span className="flex items-center gap-1.5 text-[11px] text-zinc-500"><span className="w-3 h-0.5 rounded bg-teal-400 inline-block" /> Users</span>
            <span className="flex items-center gap-1.5 text-[11px] text-zinc-500"><span className="w-3 h-0.5 rounded bg-blue-400 inline-block" /> Sessions</span>
            <span className="flex items-center gap-1.5 text-[11px] text-zinc-500"><span className="w-3 h-0.5 rounded bg-teal-400/40 inline-block" /> Pageviews</span>
          </div>
        </div>

        {/* Devices Pie Chart (1/3) */}
        {ga4Devices.length > 0 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5 flex flex-col">
            <h3 className="text-sm font-semibold text-zinc-200 mb-4">Devices</h3>
            <div className="flex-1 flex flex-col items-center justify-center">
              {(() => {
                const PIE_COLORS = ['#14b8a6', '#60a5fa', '#34d399', '#fbbf24'];
                return (
                  <>
                    <ResponsiveContainer width={128} height={128}>
                      <PieChart>
                        <Pie data={ga4Devices} dataKey="sessions" cx="50%" cy="50%" outerRadius={60} strokeWidth={0}>
                          {ga4Devices.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} opacity={0.85} />)}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-3">
                      {ga4Devices.map((d, i) => (
                        <span key={i} className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                          <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                          <span className="capitalize">{d.device}</span>
                          <span className="text-zinc-500">{d.percentage}%</span>
                        </span>
                      ))}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        )}
      </div>
    )}

    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
      {/* Top Pages */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
        <h3 className="text-sm font-semibold text-zinc-200 mb-3">Top Pages</h3>
        <div className="space-y-1 max-h-[350px] overflow-y-auto">
          {ga4Pages.slice(0, 15).map((p, i) => (
            <div key={i} className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-zinc-800/50">
              <span className="text-[11px] text-zinc-500 w-5 text-right">{i + 1}</span>
              <span className="text-xs text-zinc-300 flex-1 truncate font-mono">{p.path}</span>
              <span className="text-xs text-teal-400 font-medium tabular-nums">{p.pageviews.toLocaleString()}</span>
              <span className="text-[11px] text-zinc-500 w-14 text-right">{p.users.toLocaleString()} u</span>
            </div>
          ))}
        </div>
      </div>

      {/* Traffic Sources */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
        <h3 className="text-sm font-semibold text-zinc-200 mb-3">Traffic Sources</h3>
        <div className="space-y-2">
          {ga4Sources.slice(0, 10).map((s, i) => {
            const totalSessions = ga4Sources.reduce((sum, x) => sum + x.sessions, 0);
            const pct = totalSessions > 0 ? (s.sessions / totalSessions) * 100 : 0;
            return (
              <div key={i} className="relative">
                <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg relative z-10">
                  <span className="text-xs text-zinc-300 flex-1 truncate">{s.source}{s.medium !== '(none)' ? ` / ${s.medium}` : ''}</span>
                  <span className="text-xs text-blue-400 font-medium tabular-nums">{s.sessions.toLocaleString()}</span>
                  <span className="text-[11px] text-zinc-500 w-12 text-right">{pct.toFixed(1)}%</span>
                </div>
                <div className="absolute inset-0 rounded-lg bg-blue-500/5" style={{ width: `${pct}%` }} />
              </div>
            );
          })}
        </div>
      </div>
    </div>

    {/* Organic Search + New vs Returning + Landing Pages */}
    {ga4Organic && (
      <div className="mb-6">
        <OrganicInsight organic={ga4Organic} landingPages={ga4LandingPages} newVsReturning={ga4NewVsReturning || []} />
      </div>
    )}

    {/* ── Event Modules (Grouped) ── */}
    {(ga4Conversions.length > 0 || ga4Events.length > 0) && (() => {
      const groups = (ws.eventGroups || []).slice().sort((a, b) => a.order - b.order);
      const getEventsForModule = (moduleId: string) => {
        const source = modulePageData[moduleId] || sortedConversions;
        if (moduleId === '__ungrouped__') {
          return source.filter((c: GA4ConversionSummary) => {
            const cfg = ws.eventConfig?.find(ec => ec.eventName === c.eventName);
            return !cfg?.group || !groups.find(g => g.id === cfg.group);
          });
        }
        return source.filter((c: GA4ConversionSummary) => {
          const cfg = ws.eventConfig?.find(ec => ec.eventName === c.eventName);
          return cfg?.group === moduleId;
        });
      };
      const renderEventCard = (c: GA4ConversionSummary, i: number) => {
        const isSelected = ga4SelectedEvent === c.eventName;
        const pinned = isEventPinned(c.eventName);
        return (
          <button key={i} onClick={() => loadEventTrend(c.eventName)}
            className={`text-left rounded-xl border p-4 transition-colors ${isSelected ? 'bg-teal-500/10 border-teal-500/30' : pinned ? 'bg-teal-500/5 border-teal-500/15 hover:border-teal-500/30' : 'bg-zinc-800/30 border-zinc-800 hover:border-zinc-700'}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-zinc-400 truncate max-w-[140px]">{eventDisplayName(c.eventName)}</span>
              <div className="flex items-center gap-1.5">
                {pinned && <span className="w-1.5 h-1.5 rounded-full bg-teal-400" title="Pinned" />}
                {c.rate > 0 && <span className="text-[11px] font-medium text-emerald-400">{c.rate}%</span>}
              </div>
            </div>
            <div className="text-xl font-bold text-zinc-200">{c.conversions.toLocaleString()}</div>
            <div className="text-[11px] text-zinc-500 mt-0.5">{c.users.toLocaleString()} users</div>
          </button>
        );
      };
      const renderPageFilter = (moduleId: string, allowedPages?: string[]) => {
        const pages = allowedPages && allowedPages.length > 0
          ? ga4Pages.filter(p => allowedPages.some(ap => p.path.includes(ap)))
          : ga4Pages;
        const pageOptions = pages.map(p => ({ value: p.path, label: p.path }));
        return (
          <div className="flex items-center gap-2 mb-4">
            <SearchableSelect
              options={pageOptions}
              value={modulePageFilters[moduleId] || ''}
              onChange={(val: string) => {
                setModulePageFilters(prev => val ? { ...prev, [moduleId]: val } : (() => { const n = { ...prev }; delete n[moduleId]; return n; })());
                if (val) fetchEventsForModule(moduleId, val);
                else setModulePageData(prev => { const n = { ...prev }; delete n[moduleId]; return n; });
              }}
              placeholder="Search pages..."
              emptyLabel="All Pages"
              className="max-w-[240px]"
            />
            {modulePageLoading[moduleId] && <Loader2 className="w-3 h-3 animate-spin text-teal-400" />}
          </div>
        );
      };
      const ungroupedEvents = getEventsForModule('__ungrouped__');
      return (
        <div className="space-y-6 mt-6">
          {/* Render each group as a module */}
          {groups.map(group => {
            const groupEvents = getEventsForModule(group.id);
            const noResults = modulePageFilters[group.id] && groupEvents.length === 0 && !modulePageLoading[group.id];
            return (
              <div key={group.id} className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: group.color }} />
                  <h3 className="text-sm font-semibold text-zinc-300">{group.name}</h3>
                  <span className="text-[11px] text-zinc-500 ml-auto">{groupEvents.length} events</span>
                </div>
                {renderPageFilter(group.id, group.allowedPages)}
                {noResults ? (
                  <div className="text-center py-4 text-[11px] text-zinc-500">No events found for this page</div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {groupEvents.map(renderEventCard)}
                  </div>
                )}
              </div>
            );
          })}
          {/* Ungrouped events */}
          {(ungroupedEvents.length > 0 || modulePageFilters['__ungrouped__']) && (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
              <h3 className="text-sm font-semibold text-zinc-300 mb-1">{groups.length > 0 ? 'Other Events' : 'Key Events'}</h3>
              <p className="text-[11px] text-zinc-500 mb-2">{groups.length > 0 ? 'Events not assigned to a group' : 'Custom and conversion events tracked on your site'}</p>
              {renderPageFilter('__ungrouped__')}
              {modulePageFilters['__ungrouped__'] && ungroupedEvents.length === 0 && !modulePageLoading['__ungrouped__'] ? (
                <div className="text-center py-4 text-[11px] text-zinc-500">No events found for this page</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {ungroupedEvents.slice(0, 12).map(renderEventCard)}
                </div>
              )}
            </div>
          )}

          {/* Event Trend (shown when an event is selected) */}
          {ga4SelectedEvent && ga4EventTrend.length > 2 && (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-300">{eventDisplayName(ga4SelectedEvent)}</h3>
                  <p className="text-[11px] text-zinc-500">Daily event count over the selected period</p>
                </div>
                <button onClick={() => { setGa4SelectedEvent(null); setGa4EventTrend([]); }} className="text-[11px] text-zinc-500 hover:text-zinc-300">Clear</button>
              </div>
              <ResponsiveContainer width="100%" height={112}>
                <AreaChart data={ga4EventTrend} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="evtGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2dd4bf" stopOpacity={0.15} />
                      <stop offset="100%" stopColor="#2dd4bf" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" hide />
                  <YAxis hide domain={[0, 'dataMax']} />
                  <Tooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]?.payload as GA4EventTrend | undefined;
                    if (!row) return null;
                    return (
                      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl shadow-black/40 min-w-[100px] overflow-hidden">
                        <div className="px-3 py-1.5 border-b border-zinc-800 text-[11px] font-semibold text-zinc-200">{row.date}</div>
                        <div className="px-3 py-1.5">
                          <div className="flex justify-between text-[11px]"><span className="text-teal-400">Count</span><span className="text-zinc-200 font-medium">{row.eventCount.toLocaleString()}</span></div>
                        </div>
                      </div>
                    );
                  }} />
                  <Area type="monotone" dataKey="eventCount" stroke="#2dd4bf" strokeWidth={2} fill="url(#evtGrad)" dot={{ r: 2.5, fill: '#2dd4bf', opacity: 0.6, strokeWidth: 0 }} activeDot={{ r: 3, fill: '#2dd4bf', stroke: '#18181b', strokeWidth: 1.5 }} />
                </AreaChart>
              </ResponsiveContainer>
              <div className="flex items-center justify-between mt-2 text-[11px] text-zinc-500">
                <span>{ga4EventTrend[0]?.date}</span>
                <span>Total: {ga4EventTrend.reduce((s, d) => s + d.eventCount, 0).toLocaleString()}</span>
                <span>{ga4EventTrend[ga4EventTrend.length - 1]?.date}</span>
              </div>
            </div>
          )}
        </div>
      );
    })()}

    {/* ── Collapsible Event Explorer ── */}
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden mt-6">
      <button onClick={() => setShowExplorer(!showExplorer)} className="w-full flex items-center justify-between px-5 py-3 hover:bg-zinc-800/30 transition-colors">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-teal-400" />
          <span className="text-sm font-medium text-zinc-400">Event Explorer</span>
        </div>
        {showExplorer ? <ChevronUp className="w-4 h-4 text-zinc-500" /> : <ChevronDown className="w-4 h-4 text-zinc-500" />}
      </button>
      {showExplorer && (
        <div className="px-5 pb-5">
          <p className="text-[11px] text-zinc-500 mb-4">Break down events by page, or see which events fire on a specific page.</p>
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div className="flex-1 min-w-[180px]">
              <label className="text-[11px] text-zinc-500 mb-1 block">Event Name</label>
              <SearchableSelect
                options={ga4Events.map(ev => ({ value: ev.eventName, label: eventDisplayName(ev.eventName) }))}
                value={explorerEvent}
                onChange={setExplorerEvent}
                placeholder="Search events..."
                emptyLabel="All events"
                size="md"
              />
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="text-[11px] text-zinc-500 mb-1 block">Page Path (contains)</label>
              <input value={explorerPage} onChange={e => setExplorerPage(e.target.value)}
                placeholder="/contact, /blog, etc."
                onKeyDown={e => e.key === 'Enter' && runExplorer(explorerEvent || undefined, explorerPage || undefined)}
                className="w-full px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-teal-500 placeholder:text-zinc-500" />
            </div>
            <button onClick={() => runExplorer(explorerEvent || undefined, explorerPage || undefined)}
              className="px-4 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium transition-colors flex items-center gap-1.5">
              {explorerLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />} Explore
            </button>
            {explorerData.length > 0 && (
              <button onClick={() => { setExplorerData([]); setExplorerEvent(''); setExplorerPage(''); }}
                className="px-3 py-1.5 rounded-lg text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Clear</button>
            )}
          </div>
          {explorerData.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider py-2 pr-3">Event</th>
                    <th className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider py-2 pr-3">Page</th>
                    <th className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider py-2 pr-3 text-right">Count</th>
                    <th className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider py-2 text-right">Users</th>
                  </tr>
                </thead>
                <tbody>
                  {explorerData.map((row, i) => {
                    const maxCount = explorerData[0]?.eventCount || 1;
                    const pct = (row.eventCount / maxCount) * 100;
                    return (
                      <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                        <td className="py-2 pr-3">
                          <button onClick={() => { setExplorerEvent(row.eventName); runExplorer(row.eventName, explorerPage || undefined); }}
                            className="text-xs text-teal-400 hover:text-teal-300">{eventDisplayName(row.eventName)}</button>
                        </td>
                        <td className="py-2 pr-3">
                          <button onClick={() => { setExplorerPage(row.pagePath); runExplorer(explorerEvent || undefined, row.pagePath); }}
                            className="text-xs text-zinc-300 hover:text-zinc-100 font-mono truncate max-w-[250px] block">{row.pagePath}</button>
                        </td>
                        <td className="py-2 pr-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1 rounded-full bg-zinc-800 overflow-hidden">
                              <div className="h-full rounded-full bg-teal-500/40" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs text-zinc-200 tabular-nums font-medium">{row.eventCount.toLocaleString()}</span>
                          </div>
                        </td>
                        <td className="py-2 text-right text-xs text-zinc-500 tabular-nums">{row.users.toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="text-[11px] text-zinc-500 mt-2 text-right">{explorerData.length} results</div>
            </div>
          )}
        </div>
      )}
    </div>
  </>);
}
