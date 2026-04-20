import React from 'react';
import { Lock, Sun, Moon, Calendar } from 'lucide-react';
import { SeoCartButton } from './SeoCart';
import { STUDIO_NAME } from '../../constants';
import type { WorkspaceInfo, ClientTab, ClientContentRequest } from './types';

// Module-level date defaults — computed once at import time (not during render)
const MODULE_DEFAULT_START = new Date(Date.now() - 28 * 86400000).toISOString().split('T')[0];
const MODULE_TODAY = new Date().toISOString().split('T')[0];

interface ClientHeaderProps {
  ws: WorkspaceInfo;
  betaMode: boolean;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  tab: ClientTab;
  setTab: (t: ClientTab) => void;
  NAV: Array<{ id: ClientTab; label: string; icon: React.ElementType; locked: boolean }>;
  days: number;
  customDateRange: { startDate: string; endDate: string } | null;
  showDatePicker: boolean;
  setShowDatePicker: React.Dispatch<React.SetStateAction<boolean>>;
  changeDays: (d: number, ws: WorkspaceInfo) => void;
  applyCustomRange: (s: string, e: string, ws: WorkspaceInfo) => void;
  customStartRef: React.RefObject<HTMLInputElement | null>;
  customEndRef: React.RefObject<HTMLInputElement | null>;
  clientUser: { id?: string; name: string; email?: string; role?: string } | null;
  handleClientLogout: () => void;
  setShowUpgradeModal: React.Dispatch<React.SetStateAction<boolean>>;
  pendingApprovals: number;
  unreadTeamNotes: number;
  contentPlanSummary: { reviewCells: number } | null;
  hasData: (tabId: ClientTab) => boolean;
  contentRequests: ClientContentRequest[];
  hasAnalytics: boolean;
  effectiveTier: 'free' | 'growth' | 'premium';
}

export function ClientHeader({
  ws,
  betaMode,
  theme,
  toggleTheme,
  tab,
  setTab,
  NAV,
  days,
  customDateRange,
  showDatePicker,
  setShowDatePicker,
  changeDays,
  applyCustomRange,
  customStartRef,
  customEndRef,
  clientUser,
  handleClientLogout,
  setShowUpgradeModal,
  pendingApprovals,
  unreadTeamNotes,
  contentPlanSummary,
  hasData,
  contentRequests,
  hasAnalytics,
  effectiveTier,
}: ClientHeaderProps) {
  return (
    <header className="border-b border-zinc-800">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <img src="/logo.svg" alt={STUDIO_NAME} className="h-8 opacity-80" style={theme === 'light' ? { filter: 'invert(1) brightness(0.3)' } : undefined} />
          <div className="w-px h-8 bg-zinc-800" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold">{ws.name}</h1>
              {!betaMode && ws.isTrial && (
                <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-amber-500/15 text-amber-400/80 border border-amber-500/20">
                  Growth Trial{ws.trialDaysRemaining ? ` · ${ws.trialDaysRemaining}d` : ''}
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-500 mt-0.5">Insights Engine{hasAnalytics && <span className="ml-2 text-zinc-500">· Updated {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Client user menu */}
          {clientUser && (
            <div className="flex items-center gap-2 pr-2 border-r border-zinc-800">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-teal-500 to-emerald-500 flex items-center justify-center text-white text-[10px] font-bold">
                {clientUser.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
              </div>
              <span className="text-xs text-zinc-400 hidden sm:block">{clientUser.name}</span>
              <button onClick={handleClientLogout} title="Sign out"
                className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              </button>
            </div>
          )}
          {!betaMode && <SeoCartButton />}
          <button onClick={toggleTheme} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="p-2 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors">
            {theme === 'dark' ? <Sun className="w-4 h-4 text-zinc-400" /> : <Moon className="w-4 h-4 text-zinc-400" />}
          </button>
          {hasAnalytics && (
            <div className="relative flex items-center gap-1 bg-zinc-900 rounded-lg border border-zinc-800 p-0.5">
              {[7, 28, 90, 180, 365].map(d => (
                <button key={d} onClick={() => changeDays(d, ws)}
                  className={`px-3 py-2 min-h-[44px] rounded-md text-xs font-medium transition-colors ${!customDateRange && days === d ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  {d >= 365 ? '1y' : d >= 180 ? '6mo' : `${d}d`}
                  {!customDateRange && days === d && <span className="block text-[9px] text-zinc-400 font-normal">vs prev {d >= 365 ? '1y' : d >= 180 ? '6mo' : `${d}d`}</span>}
                </button>
              ))}
              <button onClick={() => effectiveTier !== 'free' && setShowDatePicker(p => !p)}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${effectiveTier === 'free' ? 'text-zinc-600 cursor-not-allowed' : customDateRange ? 'bg-teal-600/20 text-teal-300 border border-teal-500/30' : 'text-zinc-500 hover:text-zinc-300'}`}
                title={effectiveTier === 'free' ? 'Upgrade to Growth for custom date ranges' : 'Custom date range'}
              >
                <Calendar className="w-3.5 h-3.5" />
                {customDateRange ? (
                  <span className="text-[10px]">
                    {new Date(customDateRange.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {' – '}
                    {new Date(customDateRange.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                ) : (
                  <span className="hidden sm:inline">Custom</span>
                )}
              </button>
              {showDatePicker && (<>
                <div className="fixed inset-0 z-40 sm:bg-transparent bg-black/50" onClick={() => setShowDatePicker(false)} />
                <div className="fixed sm:absolute inset-x-0 bottom-0 sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-2 z-50 bg-zinc-900 border-t sm:border border-zinc-700 rounded-t-2xl sm:rounded-xl shadow-2xl p-4 sm:w-72"
                  onClick={e => e.stopPropagation()}>
                  <div className="sm:hidden w-10 h-1 bg-zinc-700 rounded-full mx-auto mb-3" />
                  <p className="text-xs font-medium text-zinc-400 mb-3">Custom date range</p>
                  <div className="space-y-2">
                    <label className="block">
                      <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Start date</span>
                      <input type="date" ref={customStartRef}
                        defaultValue={customDateRange?.startDate || MODULE_DEFAULT_START}
                        max={MODULE_TODAY}
                        className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm sm:text-xs text-zinc-200 focus:outline-none focus:border-teal-500"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] text-zinc-500 uppercase tracking-wider">End date</span>
                      <input type="date" ref={customEndRef}
                        defaultValue={customDateRange?.endDate || MODULE_TODAY}
                        max={MODULE_TODAY}
                        className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm sm:text-xs text-zinc-200 focus:outline-none focus:border-teal-500"
                      />
                    </label>
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <button onClick={() => setShowDatePicker(false)}
                      className="flex-1 px-3 py-2.5 sm:py-1.5 text-sm sm:text-xs rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors">
                      Cancel
                    </button>
                    <button onClick={() => {
                      const s = customStartRef.current?.value;
                      const e = customEndRef.current?.value;
                      if (s && e && s <= e) applyCustomRange(s, e, ws);
                    }}
                      className="flex-1 px-3 py-2.5 sm:py-1.5 text-sm sm:text-xs rounded-lg bg-teal-600 hover:bg-teal-500 text-white font-medium transition-colors">
                      Apply
                    </button>
                  </div>
                </div>
              </>)}
            </div>
          )}
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-6">
        <nav role="tablist" className="flex items-center gap-1 -mb-px overflow-x-auto scrollbar-none"
          onKeyDown={(e) => {
            const unlocked = NAV.filter(n => !n.locked);
            const idx = unlocked.findIndex(n => n.id === tab);
            if (e.key === 'ArrowRight' && idx < unlocked.length - 1) { setTab(unlocked[idx + 1].id); e.preventDefault(); }
            if (e.key === 'ArrowLeft' && idx > 0) { setTab(unlocked[idx - 1].id); e.preventDefault(); }
          }}>
          {NAV.map(t => {
            const Icon = t.icon;
            const active = tab === t.id;
            const tabHasData = hasData(t.id);
            const pendingReviews = contentRequests.filter(r => r.status === 'client_review').length;
            return (
              <button key={t.id} role="tab" aria-selected={active} tabIndex={active ? 0 : -1}
                onClick={() => t.locked ? setShowUpgradeModal(true) : setTab(t.id)}
                className={`flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                  t.locked ? 'border-transparent text-zinc-500 cursor-default' :
                  active ? 'border-teal-500 text-teal-300' :
                  'border-transparent text-zinc-500 hover:text-zinc-300 hover:border-zinc-700'
                }`}>
                <Icon className="w-3.5 h-3.5" /> {t.label}
                {t.locked && <Lock className="w-3 h-3 ml-0.5 text-zinc-500" />}
                {t.id === 'inbox' && (pendingApprovals + pendingReviews + unreadTeamNotes) > 0 && <span className="ml-1 px-1.5 py-0.5 text-[11px] font-bold rounded-full bg-teal-500 text-white flex-shrink-0 min-w-[20px] text-center leading-tight">{pendingApprovals + pendingReviews + unreadTeamNotes}</span>}
                {t.id === 'content-plan' && contentPlanSummary && contentPlanSummary.reviewCells > 0 && <span className="ml-1 px-1.5 py-0.5 text-[11px] font-bold rounded-full bg-blue-500 text-white flex-shrink-0 min-w-[20px] text-center leading-tight">{contentPlanSummary.reviewCells}</span>}
                {!t.locked && tabHasData && !active && t.id !== 'inbox' && <span className="w-2 h-2 rounded-full bg-emerald-400/60" title="Data available" />}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
