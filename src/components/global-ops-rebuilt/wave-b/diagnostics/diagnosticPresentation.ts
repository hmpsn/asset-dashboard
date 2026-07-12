// @ds-rebuilt
import type { DiagnosticReport, DiagnosticStatus } from '../../../../../shared/types/diagnostics';
import { pathToTitle } from '../../../../../shared/slug-title';

export const DIAGNOSTIC_STATUS_TONE = {
  pending: 'amber',
  running: 'blue',
  completed: 'emerald',
  failed: 'red',
} as const satisfies Record<DiagnosticStatus, 'amber' | 'blue' | 'emerald' | 'red'>;

const ANOMALY_LABELS: Record<string, string> = {
  traffic_drop: 'Traffic drop',
  ranking_loss: 'Ranking loss',
  ctr_drop: 'CTR drop',
  conversion_drop: 'Conversion drop',
};

const NUMBER_FORMAT = new Intl.NumberFormat('en-US');

export function diagnosticPageLabel(report: Pick<DiagnosticReport, 'affectedPages' | 'anomalyType'>): string {
  return pathToTitle(report.affectedPages[0], anomalyTypeLabel(report.anomalyType));
}

export function anomalyTypeLabel(value: string): string {
  return ANOMALY_LABELS[value]
    ?? value.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

export function statusLabel(status: DiagnosticStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function formatDiagnosticNumber(value: number): string {
  return NUMBER_FORMAT.format(value);
}

export function formatDiagnosticPercent(value: number, digits = 0): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

export function affectedPagePath(report: Pick<DiagnosticReport, 'affectedPages'>): string {
  return report.affectedPages[0] ?? 'Workspace-wide';
}
