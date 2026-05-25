import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Eye,
  FileText,
  Gauge,
  MapPin,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  TrendingUp,
  XCircle,
} from 'lucide-react';

import {
  KEYWORD_COMMAND_CENTER_ACTIONS,
  KEYWORD_COMMAND_CENTER_FILTERS,
  KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY,
  type KeywordCommandCenterActionType,
  type KeywordCommandCenterFilter,
  type KeywordCommandCenterNextAction,
  type KeywordCommandCenterRow,
} from '../../../shared/types/keyword-command-center';

export const FILTER_ICONS: Record<KeywordCommandCenterFilter, LucideIcon> = {
  [KEYWORD_COMMAND_CENTER_FILTERS.ALL]: SlidersHorizontal,
  [KEYWORD_COMMAND_CENTER_FILTERS.IN_STRATEGY]: Target,
  [KEYWORD_COMMAND_CENTER_FILTERS.TRACKED]: TrendingUp,
  [KEYWORD_COMMAND_CENTER_FILTERS.NEEDS_REVIEW]: Eye,
  [KEYWORD_COMMAND_CENTER_FILTERS.CONTENT]: FileText,
  [KEYWORD_COMMAND_CENTER_FILTERS.PAGE_ASSIGNED]: Gauge,
  [KEYWORD_COMMAND_CENTER_FILTERS.RAW_EVIDENCE]: Sparkles,
  [KEYWORD_COMMAND_CENTER_FILTERS.LOCAL]: MapPin,
  [KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES]: MapPin,
  [KEYWORD_COMMAND_CENTER_FILTERS.VISIBLE_LOCALLY]: CheckCircle2,
  [KEYWORD_COMMAND_CENTER_FILTERS.POSSIBLE_MATCH]: Eye,
  [KEYWORD_COMMAND_CENTER_FILTERS.NOT_VISIBLE]: XCircle,
  [KEYWORD_COMMAND_CENTER_FILTERS.NOT_CHECKED]: RefreshCw,
  [KEYWORD_COMMAND_CENTER_FILTERS.PROVIDER_DEGRADED]: AlertTriangle,
  [KEYWORD_COMMAND_CENTER_FILTERS.REQUESTED]: ShieldCheck,
  [KEYWORD_COMMAND_CENTER_FILTERS.DECLINED]: XCircle,
  [KEYWORD_COMMAND_CENTER_FILTERS.RETIRED]: Archive,
  [KEYWORD_COMMAND_CENTER_FILTERS.LOST_VISIBILITY]: AlertTriangle,
};

export function filterCountLabel(filterId: KeywordCommandCenterFilter, count: number): string {
  if (filterId === KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES && count === 0) return '...';
  return compactNumber(count);
}

export function compactNumber(value: number | undefined): string {
  if (value == null) return '-';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

export function percent(value: number | undefined): string {
  if (value == null) return '-';
  return `${(value * 100).toFixed(1)}%`;
}

export function localPriorityTone(priority: NonNullable<KeywordCommandCenterRow['localSeoState']>['priority']): 'teal' | 'blue' | 'emerald' | 'amber' | 'red' | 'zinc' {
  if (priority === KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.HIGH_OPPORTUNITY) return 'teal';
  if (priority === KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.DEFEND) return 'emerald';
  if (priority === KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.INVESTIGATE || priority === KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.NEEDS_SETUP) return 'amber';
  return 'zinc';
}

export function actionVariant(action: KeywordCommandCenterNextAction): 'primary' | 'secondary' | 'ghost' | 'danger' | 'link' {
  if (action.tone === 'red') return 'danger';
  if (action.tone === 'teal') return 'primary';
  if (action.tone === 'blue') return 'secondary';
  return 'ghost';
}

export function isServerAction(type: KeywordCommandCenterNextAction['type']): type is KeywordCommandCenterActionType {
  return Object.values(KEYWORD_COMMAND_CENTER_ACTIONS).includes(type as KeywordCommandCenterActionType);
}

export function requiresProtectedConfirmation(row: KeywordCommandCenterRow, action: KeywordCommandCenterNextAction): boolean {
  return row.isProtected && (
    action.type === KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING
    || action.type === KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE
    || action.type === KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE
  );
}
