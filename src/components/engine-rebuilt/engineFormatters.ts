// @ds-rebuilt
import type { OutcomeProvenance } from '../../../shared/types/outcome-tracking';
import type { WorkQueueSourceType } from '../../../shared/types/work-queue';
import type { ProvenanceBasis } from '../ui';

const DATE_TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const MONEY_FORMAT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const COMPACT_FORMAT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : DATE_TIME_FORMAT.format(parsed);
}

export function formatMoney(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? MONEY_FORMAT.format(value) : '—';
}

export function formatCompactNumber(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? COMPACT_FORMAT.format(value) : '—';
}

export function provenanceBasis(value: OutcomeProvenance | null | undefined): ProvenanceBasis | undefined {
  if (value === 'actual_reconciled') return 'actual';
  if (value === 'measured_action') return 'measured';
  if (value === 'estimate_ga4') return 'estimate';
  return undefined;
}

export function sourceTypeLabel(value: WorkQueueSourceType): string {
  switch (value) {
    case 'request':
      return 'Requests';
    case 'work_order':
      return 'Work orders';
    case 'content_request':
      return 'Briefs';
    case 'content_pipeline':
      return 'Pipeline';
    case 'rank_drop':
      return 'Ranks';
    case 'content_decay':
      return 'Decay';
    case 'audit_error':
      return 'Audit';
    case 'setup_gap':
      return 'Setup';
    case 'churn_signal':
      return 'Risk';
  }
}
