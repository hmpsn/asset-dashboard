import type { OperationalSlice, PromptVerbosity } from '../../shared/types/intelligence.js';
import { pct } from './formatter-shared.js';

export function formatOperationalSection(
  ops: OperationalSlice,
  verbosity: PromptVerbosity,
): string {
  const lines: string[] = ['## Operational'];

  const approvals = ops.approvalQueue?.pending ?? 0;
  const clientActions = ops.clientActionQueue?.pending ?? 0;
  const actions = ops.actionBacklog?.pendingMeasurement ?? 0;
  const recs = (ops.recommendationQueue?.fixNow ?? 0) + (ops.recommendationQueue?.fixSoon ?? 0) + (ops.recommendationQueue?.fixLater ?? 0);
  lines.push(`Pending: ${approvals} approvals, ${clientActions} client actions, ${actions} actions awaiting measurement, ${recs} recommendations`);

  if (verbosity !== 'compact') {
    if (ops.recommendationQueue) {
      lines.push(`Recommendations: ${ops.recommendationQueue.fixNow} fix now, ${ops.recommendationQueue.fixSoon} fix soon, ${ops.recommendationQueue.fixLater} fix later`);
    }
    if (ops.recentActivity.length > 0) {
      lines.push(`Recent: ${ops.recentActivity.slice(0, 3).map(a => a.description).join('; ')}`);
    }
    if (ops.timeSaved) {
      lines.push(`Time saved: ${ops.timeSaved.totalMinutes} minutes`);
    }
    if (ops.pendingJobs > 0) {
      lines.push(`Background jobs: ${ops.pendingJobs} pending`);
    }
    if (ops.workOrders) {
      lines.push(`Work orders: ${ops.workOrders.active} active, ${ops.workOrders.pending} pending`);
    }
    if (ops.clientActionQueue) {
      lines.push(`Client action queue: ${ops.clientActionQueue.pending} pending${ops.clientActionQueue.oldestAge !== null ? `, oldest ${ops.clientActionQueue.oldestAge}h` : ''}`);
    }
  }

  if (verbosity !== 'compact') {
    if (ops.effectiveTier) {
      lines.push(`Subscription tier: ${ops.effectiveTier}`);
    }
    if (ops.usageRemaining) {
      const usageParts = Object.entries(ops.usageRemaining)
        .filter(([, v]) => v != null && v !== Infinity)
        .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v} remaining`)
        .slice(0, 5);
      if (usageParts.length > 0) {
        lines.push(`Usage remaining: ${usageParts.join(', ')}`);
      }
    }
    if (ops.pageEditStateSummary && ops.pageEditStateSummary.total > 0) {
      const statusParts = Object.entries(ops.pageEditStateSummary.byStatus)
        .map(([s, n]) => `${n} ${s}`)
        .join(', ');
      lines.push(`Page states (${ops.pageEditStateSummary.total} total): ${statusParts}`);
    }
  }

  if (verbosity === 'detailed') {
    if (ops.detectedPlaybooks && ops.detectedPlaybooks.length > 0) {
      lines.push(`Detected playbooks: ${ops.detectedPlaybooks.slice(0, 3).join(', ')}`);
    }
    if (ops.timeSaved?.byFeature) {
      lines.push('Time saved by feature:');
      for (const [feature, minutes] of Object.entries(ops.timeSaved.byFeature).slice(0, 5)) {
        lines.push(`  ${feature}: ${minutes} min`);
      }
    }
    if (ops.annotations.length > 0) {
      lines.push('Timeline annotations:');
      for (const a of ops.annotations.slice(0, 5)) {
        lines.push(`  - ${a.date}: ${a.label}`);
      }
    }
    if (ops.insightAcceptanceRate) {
      lines.push(`Insight acceptance rate: ${pct(ops.insightAcceptanceRate.rate)} (${ops.insightAcceptanceRate.confirmed}/${ops.insightAcceptanceRate.totalShown})`);
    }
  }

  return lines.join('\n');
}
