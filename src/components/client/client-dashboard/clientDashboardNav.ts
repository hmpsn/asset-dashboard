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
  brandTabEnabled: boolean;
  contentPlanSummary: { totalCells: number } | null;
  strategyData: unknown;
}

export function buildClientDashboardNav({
  ws,
  effectiveTier,
  betaMode,
  brandTabEnabled,
  contentPlanSummary,
  strategyData,
}: BuildClientDashboardNavOptions): ClientNavItem[] {
  const strategyLocked = effectiveTier === 'free' || !ws.seoClientView;
  const isPaid = effectiveTier !== 'free';
  const isExternalBilling = ws.billingMode === 'external';

  return [
    { id: 'overview', label: 'Insights', icon: Sparkles, locked: false },
    ...(ws.analyticsClientView !== false ? [
      { id: 'performance' as const, label: 'Performance', icon: LineChart, locked: false },
    ] : []),
    { id: 'health', label: 'Site Health', icon: Shield, locked: false },
    ...(isPaid ? [{ id: 'strategy' as const, label: 'SEO Strategy', icon: Target, locked: strategyLocked }] : []),
    ...(isPaid && contentPlanSummary && contentPlanSummary.totalCells > 0
      ? [{ id: 'content-plan' as const, label: 'Content Plan', icon: Layers, locked: false }]
      : []),
    ...(isPaid ? [{ id: 'inbox' as const, label: 'Inbox', icon: Zap, locked: false }] : []),
    ...(!betaMode && !isExternalBilling ? [{ id: 'plans' as const, label: 'Plans', icon: CreditCard, locked: false }] : []),
    ...(isPaid && !betaMode && strategyData ? [{ id: 'roi' as const, label: 'ROI', icon: Trophy, locked: false }] : []),
    ...(brandTabEnabled ? [{ id: 'brand' as const, label: 'Brand', icon: Building2, locked: false }] : []),
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
    || (tabId === 'content-plan' && !!contentPlanSummary && contentPlanSummary.totalCells > 0);
}
