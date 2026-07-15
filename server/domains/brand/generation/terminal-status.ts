import type {
  BrandGenerationItem,
  BrandGenerationRunStatus,
} from '../../../../shared/types/brand-generation.js';

/** One terminal derivation shared by live workers and restart reconciliation. */
export function deriveBrandGenerationTerminalStatus(
  items: readonly BrandGenerationItem[],
): BrandGenerationRunStatus {
  if (items.length === 1
    && items[0].target === 'voice_foundation'
    && (items[0].status === 'ready_for_human_review'
      || items[0].status === 'needs_attention')) {
    return 'awaiting_review';
  }
  const successful = items.filter(item => (
    item.status === 'ready_for_human_review' || item.status === 'approved'
  )).length;
  if (items.length > 0 && successful === items.length) return 'completed';
  if (successful > 0
    || items.some(item => item.status === 'needs_attention' || item.status === 'changes_requested')) {
    return 'completed_with_errors';
  }
  if (items.length > 0 && items.every(item => item.status === 'blocked_missing_evidence')) {
    return 'blocked';
  }
  if (items.length > 0 && items.every(item => item.status === 'conflict')) return 'conflict';
  if (items.length > 0 && items.every(item => item.status === 'cancelled')) return 'cancelled';
  return 'failed';
}
