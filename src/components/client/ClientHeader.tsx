import React from 'react';
import { Lock, Sun, Moon, Calendar, LogOut } from 'lucide-react';
import { SeoCartButton } from './SeoCart';
import { STUDIO_NAME } from '../../constants';
import { Button, Icon, IconButton } from '../ui';
import { Modal } from '../ui/overlay/Modal';
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
  hasAnyData: boolean;
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
  hasAnyData,
  effectiveTier,
}: ClientHeaderProps) {
  return (
    <header className="border-b border-[var(--brand-border)]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <img src="/logo.svg" alt={STUDIO_NAME} className="h-8 opacity-80" style={theme === 'light' ? { filter: 'invert(1) brightness(0.3)' } : undefined} />
          <div className="w-px h-8 bg-[var(--brand-border)]" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="t-h2 text-[var(--brand-text-bright)] truncate">{ws.name}</h1>
              {!betaMode && ws.isTrial && (
                <span className="px-2 py-0.5 t-label rounded-[var(--radius-pill)] bg-amber-500/15 text-accent-warning border border-amber-500/20">
                  Growth Trial{ws.trialDaysRemaining ? ` · ${ws.trialDaysRemaining}d` : ''}
                </span>
              )}
            </div>
            <p className="t-caption text-[var(--brand-text-muted)] mt-0.5">Insights Engine{hasAnyData && <span className="ml-2 text-[var(--brand-text-muted)]">· Updated {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}</p>
          </div>
        </div>
        <div className="w-full sm:w-auto flex items-center gap-2 sm:gap-3 flex-wrap sm:flex-nowrap sm:justify-end">
          {/* Client user menu */}
          {clientUser && (
            <div className="flex items-center gap-2 pr-2 border-r border-[var(--brand-border)]">
              <div className="w-7 h-7 rounded-[var(--radius-pill)] bg-gradient-to-br from-[var(--teal)] to-[var(--emerald)] flex items-center justify-center text-[var(--button-primary-text)] t-caption-sm font-bold">
                {clientUser.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
              </div>
              <span className="t-caption text-[var(--brand-text-muted)] hidden sm:block">{clientUser.name}</span>
              <IconButton icon={LogOut} label="Sign out" size="sm" onClick={handleClientLogout} />
            </div>
          )}
          {!betaMode && <SeoCartButton />}
          <IconButton
            icon={theme === 'dark' ? Sun : Moon}
            label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            variant="solid"
            onClick={toggleTheme}
          />
          {hasAnalytics && (
            // pr-check-disable-next-line -- Date-range segmented control toolbar; interactive control, not a content card
            <div className="relative flex items-center gap-1 max-w-full overflow-x-auto bg-[var(--surface-2)] rounded-[var(--radius-lg)] border border-[var(--brand-border)] p-0.5">
              {[7, 28, 90, 180, 365].map(d => (
                <button key={d} onClick={() => changeDays(d, ws)}
                  className={`px-3 py-2 min-h-[44px] rounded-[var(--radius-md)] t-ui font-medium transition-colors ${!customDateRange && days === d ? 'bg-[var(--surface-3)] text-[var(--brand-text-bright)]' : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]'}`}
                >
                  {d >= 365 ? '1y' : d >= 180 ? '6mo' : `${d}d`}
                  {!customDateRange && days === d && <span className="block t-micro text-[var(--brand-text-muted)] font-normal">vs prev {d >= 365 ? '1y' : d >= 180 ? '6mo' : `${d}d`}</span>}
                </button>
              ))}
              <button onClick={() => effectiveTier !== 'free' && setShowDatePicker(p => !p)}
                className={`px-2.5 py-1.5 rounded-[var(--radius-md)] t-ui font-medium transition-colors flex items-center gap-1.5 ${effectiveTier === 'free' ? 'text-[var(--brand-text-faint)] cursor-not-allowed' : customDateRange ? 'bg-teal-600/20 text-accent-brand border border-teal-500/30' : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]'}`}
                title={effectiveTier === 'free' ? 'Upgrade to Growth for custom date ranges' : 'Custom date range'}
              >
                <Icon as={Calendar} size="md" />
                {customDateRange ? (
                  <span className="t-caption-sm">
                    {new Date(customDateRange.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {' – '}
                    {new Date(customDateRange.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                ) : (
                  <span className="hidden sm:inline">Custom</span>
                )}
              </button>
              <Modal open={showDatePicker} onClose={() => setShowDatePicker(false)} size="sm">
                <Modal.Header title="Custom date range" onClose={() => setShowDatePicker(false)} />
                <Modal.Body>
                  <div className="space-y-2">
                    <label className="block">
                      <span className="t-label text-[var(--brand-text-muted)]">Start date</span>
                      <input type="date" ref={customStartRef}
                        defaultValue={customDateRange?.startDate || MODULE_DEFAULT_START}
                        max={MODULE_TODAY}
                        className="mt-1 w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] px-3 py-2.5 t-caption text-[var(--brand-text)] focus:outline-none focus:border-teal-500"
                      />
                    </label>
                    <label className="block">
                      <span className="t-label text-[var(--brand-text-muted)]">End date</span>
                      <input type="date" ref={customEndRef}
                        defaultValue={customDateRange?.endDate || MODULE_TODAY}
                        max={MODULE_TODAY}
                        className="mt-1 w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] px-3 py-2.5 t-caption text-[var(--brand-text)] focus:outline-none focus:border-teal-500"
                      />
                    </label>
                  </div>
                </Modal.Body>
                <Modal.Footer>
                  <div className="flex items-center gap-2 w-full">
                    <Button onClick={() => setShowDatePicker(false)} variant="secondary" size="sm" className="flex-1">
                      Cancel
                    </Button>
                    <Button onClick={() => {
                      const s = customStartRef.current?.value;
                      const e = customEndRef.current?.value;
                      if (s && e && s <= e) applyCustomRange(s, e, ws);
                    }} size="sm" className="flex-1">
                      Apply
                    </Button>
                  </div>
                </Modal.Footer>
              </Modal>
            </div>
          )}
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <nav role="tablist" className="flex items-center gap-1 -mb-px overflow-x-auto scrollbar-none"
          onKeyDown={(e) => {
            const unlocked = NAV.filter(n => !n.locked);
            const idx = unlocked.findIndex(n => n.id === tab);
            if (e.key === 'ArrowRight' && idx < unlocked.length - 1) { setTab(unlocked[idx + 1].id); e.preventDefault(); }
            if (e.key === 'ArrowLeft' && idx > 0) { setTab(unlocked[idx - 1].id); e.preventDefault(); }
          }}>
          {NAV.map(t => {
            const TabIcon = t.icon as import('lucide-react').LucideIcon;
            const active = tab === t.id;
            const tabHasData = hasData(t.id);
            const pendingReviews = contentRequests.filter(
              r => r.status === 'client_review' || r.status === 'post_review',
            ).length;
            return (
              <button key={t.id} role="tab" aria-selected={active} tabIndex={active ? 0 : -1}
                onClick={() => t.locked ? setShowUpgradeModal(true) : setTab(t.id)}
                className={`flex items-center gap-1.5 px-4 py-3 t-ui font-medium border-b-2 transition-colors whitespace-nowrap ${
                  t.locked ? 'border-transparent text-[var(--brand-text-muted)] cursor-default' :
                  active ? 'border-teal-500 text-accent-brand' :
                  'border-transparent text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:border-[var(--brand-border-strong)]'
                }`}>
                <Icon as={TabIcon} size="md" /> {t.label}
                {t.locked && <Icon as={Lock} size="sm" className="ml-0.5 text-[var(--brand-text-muted)]" />}
                {t.id === 'inbox' && (pendingApprovals + pendingReviews + unreadTeamNotes) > 0 && <span className="ml-1 px-1.5 py-0.5 t-caption-sm font-bold rounded-[var(--radius-pill)] bg-[var(--teal)] text-[var(--button-primary-text)] flex-shrink-0 min-w-[20px] text-center leading-tight">{pendingApprovals + pendingReviews + unreadTeamNotes}</span>}
                {t.id === 'content-plan' && contentPlanSummary && contentPlanSummary.reviewCells > 0 && <span className="ml-1 px-1.5 py-0.5 t-caption-sm font-bold rounded-[var(--radius-pill)] bg-blue-500 text-white flex-shrink-0 min-w-[20px] text-center leading-tight">{contentPlanSummary.reviewCells}</span>}
                {!t.locked && tabHasData && !active && t.id !== 'inbox' && <span className="w-2 h-2 rounded-[var(--radius-pill)] bg-emerald-400/60" title="Data available" />}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
