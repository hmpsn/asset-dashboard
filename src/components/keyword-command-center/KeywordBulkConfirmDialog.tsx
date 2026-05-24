import { KEYWORD_COMMAND_CENTER_ACTIONS } from '../../../shared/types/keyword-command-center';
import { ConfirmDialog } from '../ui';
import type { KeywordBulkActionSummary } from './kccActionHelpers';

interface KeywordBulkConfirmDialogProps {
  summary: KeywordBulkActionSummary | null;
  isPending: boolean;
  onConfirm: (force: boolean) => void;
  onCancel: () => void;
}

function actionLabel(action: KeywordBulkActionSummary['action']): string {
  if (action === KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY) return 'Add to strategy';
  if (action === KEYWORD_COMMAND_CENTER_ACTIONS.TRACK) return 'Track';
  if (action === KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING) return 'Pause';
  if (action === KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE) return 'Retire';
  if (action === KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE) return 'Decline';
  return action;
}

function messageFor(summary: KeywordBulkActionSummary): string {
  const details = [
    `${summary.total} keyword${summary.total === 1 ? '' : 's'} selected`,
    summary.protectedCount > 0 ? `${summary.protectedCount} protected keyword${summary.protectedCount === 1 ? '' : 's'} will require confirmation` : null,
    summary.notTrackedCount > 0 ? `${summary.notTrackedCount} keyword${summary.notTrackedCount === 1 ? '' : 's'} are not tracked and may be skipped` : null,
  ].filter(Boolean);
  return `${actionLabel(summary.action)} selected keywords? ${details.join('. ')}.`;
}

export function KeywordBulkConfirmDialog({ summary, isPending, onConfirm, onCancel }: KeywordBulkConfirmDialogProps) {
  return (
    <ConfirmDialog
      open={!!summary}
      title={summary ? `${actionLabel(summary.action)} keywords` : 'Confirm bulk action'}
      message={summary ? messageFor(summary) : ''}
      confirmLabel={isPending ? 'Working...' : summary ? actionLabel(summary.action) : 'Confirm'}
      variant={summary?.action === KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE || summary?.action === KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE ? 'destructive' : 'default'}
      onConfirm={() => summary && onConfirm(summary.protectedCount > 0)}
      onCancel={onCancel}
    />
  );
}
