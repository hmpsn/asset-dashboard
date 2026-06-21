import type { LucideIcon } from 'lucide-react';
import { Building2, CreditCard, Layers, LineChart, Shield, Sparkles, Target, Trophy, Zap } from 'lucide-react';
import type { Tier } from '../../ui';
import type { ClientTab, WorkspaceInfo } from '../types';

export interface ClientNavItem {
  id: ClientTab;
  label: string;
  icon: LucideIcon;
  locked: boolean;
}

interface BuildClientDashboardNavOptions {
  ws: WorkspaceInfo;
  effectiveTier: Tier;
  betaMode: boolean;
  contentPlanSummary: { totalCells: number } | null;
  strategyData: unknown;
  clientIaV2: boolean;
}

export function buildClientDashboardNav({
  ws,
  effectiveTier,
  betaMode,
  contentPlanSummary,
  strategyData,
  clientIaV2,
}: BuildClientDashboardNavOptions): ClientNavItem[] {
  const isPaid = effectiveTier !== 'free';
  const isExternalBilling = ws.billingMode === 'external';
  // seoClientView=false means the admin has hidden SEO strategy from this client entirely —
  // no lock, no upgrade modal, just absent. Only effectiveTier === 'free' shows the tier lock.
  // NOTE: the client-safe serializer (toPublicWorkspaceView) coerces NULL → false via !!ws.seoClientView,
  // so ws.seoClientView is always a boolean in real client mounts. The `!== false` check (which
  // treats undefined as visible) is only reachable in unit tests / admin preview where the
  // workspace object skips the serializer.
  const strategyVisible = ws.seoClientView !== false;
  const strategyLocked = effectiveTier === 'free';

  // Client IA v2 — collapse to the 4-tab two-speed shell (+ Settings home).
  // Flag-ON only; the flag-OFF return below stays byte-identical to today's nav.
  if (clientIaV2) {
    return [
      { id: 'overview', label: 'Overview', icon: Sparkles, locked: false },
      ...(isPaid ? [{ id: 'inbox' as const, label: 'Inbox', icon: Zap, locked: false }] : []),
      ...(isPaid && !betaMode && strategyData ? [{ id: 'results' as const, label: 'Results', icon: Trophy, locked: false }] : []),
      { id: 'deep-dive' as const, label: 'Deep Dive', icon: LineChart, locked: false },
      { id: 'settings' as const, label: 'Settings', icon: Building2, locked: false },
    ];
  }

  return [
    { id: 'overview', label: 'Insights', icon: Sparkles, locked: false },
    ...(ws.analyticsClientView !== false ? [
      { id: 'performance' as const, label: 'Performance', icon: LineChart, locked: false },
    ] : []),
    { id: 'health', label: 'Site Health', icon: Shield, locked: false },
    ...(strategyVisible ? [{ id: 'strategy' as const, label: 'SEO Strategy', icon: Target, locked: strategyLocked }] : []),
    ...(isPaid && contentPlanSummary && contentPlanSummary.totalCells > 0
      ? [{ id: 'content-plan' as const, label: 'Content Plan', icon: Layers, locked: false }]
      : []),
    ...(isPaid ? [{ id: 'inbox' as const, label: 'Inbox', icon: Zap, locked: false }] : []),
    ...(!betaMode && !isExternalBilling ? [{ id: 'plans' as const, label: 'Plans', icon: CreditCard, locked: false }] : []),
    ...(isPaid && !betaMode && strategyData ? [{ id: 'roi' as const, label: 'ROI', icon: Trophy, locked: false }] : []),
    { id: 'brand' as const, label: 'Brand', icon: Building2, locked: false },
  ];
}

interface HasClientTabDataOptions {
  tabId: ClientTab;
  overview: unknown;
  ga4Overview: unknown;
  audit: unknown;
  contentPlanSummary: { totalCells: number } | null;
}

export function hasClientTabData({
  tabId,
  overview,
  ga4Overview,
  audit,
  contentPlanSummary,
}: HasClientTabDataOptions): boolean {
  return tabId === 'overview'
    || (tabId === 'performance' && !!(overview || ga4Overview))
    || (tabId === 'health' && !!audit)
    || tabId === 'inbox'
    // Client IA v2 shell tabs are composition surfaces — always renderable.
    || tabId === 'deep-dive'
    || tabId === 'results'
    || tabId === 'settings'
    || (tabId === 'content-plan' && !!contentPlanSummary && contentPlanSummary.totalCells > 0);
}
