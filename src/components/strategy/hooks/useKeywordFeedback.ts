import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminKeywordFeedbackListRow } from '../../../../shared/types/keyword-feedback';
import { keywords } from '../../../api/seo';
import { keywordCommandCenter } from '../../../api/keywordCommandCenter';
import { KEYWORD_COMMAND_CENTER_ACTIONS } from '../../../../shared/types/keyword-command-center';
import { queryKeys } from '../../../lib/queryKeys';

export function useKeywordFeedback(workspaceId: string) {
  const queryClient = useQueryClient();
  const [addKeywordError, setAddKeywordError] = useState<string | null>(null);

  const { data: keywordFeedbackRows = [] } = useQuery<AdminKeywordFeedbackListRow[]>({
    queryKey: queryKeys.admin.keywordFeedback(workspaceId),
    queryFn: () => keywords.feedback(workspaceId),
    enabled: !!workspaceId,
    staleTime: 60 * 1000,
  });

  // One-click "Add to Strategy" for client-requested keywords (admin side).
  // Calls the shared KCC add_to_strategy action which — post B2 fix — writes both
  // the feedback/tracking rows AND the page_keywords strategy artifact.
  const addRequestedKeywordMutation = useMutation({
    mutationFn: (keyword: string) =>
      keywordCommandCenter.action(workspaceId, {
        action: KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY,
        keyword,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordFeedback(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordStrategy(workspaceId) });
    },
    // M5: surface failures to the admin rather than silently swallowing them.
    // Use separate addKeywordError so this never pollutes the generation ErrorState.
    onError: () => {
      setAddKeywordError('Failed to add keyword to strategy. Please try again.');
    },
  });

  return {
    rows: keywordFeedbackRows,
    addError: addKeywordError,
    setAddError: setAddKeywordError,
    addRequestedKeyword: addRequestedKeywordMutation.mutate,
    addPending: addRequestedKeywordMutation.isPending,
  };
}
