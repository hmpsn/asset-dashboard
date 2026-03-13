import { useState, useCallback } from 'react';
import { post, getOptional } from '../api/client';
import type { ClientContentRequest, ClientBriefPreview } from '../components/client/types';
import { STUDIO_NAME } from '../constants';

interface UseContentRequestsOptions {
  workspaceId: string;
  setContentRequests: React.Dispatch<React.SetStateAction<ClientContentRequest[]>>;
  setToast: (t: { message: string; type: 'success' | 'error' } | null) => void;
}

export function useContentRequests({ workspaceId, setContentRequests, setToast }: UseContentRequestsOptions) {
  // Expansion / interaction state
  const [expandedContentReq, setExpandedContentReq] = useState<string | null>(null);
  const [contentComment, setContentComment] = useState('');
  const [sendingContentComment, setSendingContentComment] = useState(false);
  const [declineReqId, setDeclineReqId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const [feedbackReqId, setFeedbackReqId] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [briefPreviews, setBriefPreviews] = useState<Record<string, ClientBriefPreview>>({});

  const declineTopic = useCallback(async (reqId: string) => {
    try {
      const updated = await post<ClientContentRequest>(`/api/public/content-request/${workspaceId}/${reqId}/decline`, { reason: declineReason.trim() || undefined });
      setContentRequests(prev => prev.map(r => r.id === reqId ? updated : r));
      setDeclineReqId(null); setDeclineReason('');
    } catch { setToast({ message: 'Failed to decline topic. Please try again.', type: 'error' }); }
  }, [workspaceId, declineReason, setContentRequests, setToast]);

  const approveBrief = useCallback(async (reqId: string) => {
    try {
      const updated = await post<ClientContentRequest>(`/api/public/content-request/${workspaceId}/${reqId}/approve`);
      setContentRequests(prev => prev.map(r => r.id === reqId ? updated : r));
      setToast({ message: `Brief approved! ${STUDIO_NAME} will begin content production.`, type: 'success' });
    } catch { setToast({ message: 'Failed to approve brief. Please try again.', type: 'error' }); }
  }, [workspaceId, setContentRequests, setToast]);

  const requestChanges = useCallback(async (reqId: string) => {
    try {
      const updated = await post<ClientContentRequest>(`/api/public/content-request/${workspaceId}/${reqId}/request-changes`, { feedback: feedbackText.trim() });
      setContentRequests(prev => prev.map(r => r.id === reqId ? updated : r));
      setFeedbackReqId(null); setFeedbackText('');
    } catch { setToast({ message: 'Failed to submit feedback. Please try again.', type: 'error' }); }
  }, [workspaceId, feedbackText, setContentRequests, setToast]);

  const addContentComment = useCallback(async (reqId: string) => {
    if (!contentComment.trim()) return;
    setSendingContentComment(true);
    try {
      const updated = await post<ClientContentRequest>(`/api/public/content-request/${workspaceId}/${reqId}/comment`, { content: contentComment.trim(), author: 'client' });
      setContentRequests(prev => prev.map(r => r.id === reqId ? updated : r));
      setContentComment('');
    } catch { setToast({ message: 'Failed to send comment. Please try again.', type: 'error' }); }
    setSendingContentComment(false);
  }, [workspaceId, contentComment, setContentRequests, setToast]);

  const loadBriefPreview = useCallback(async (briefId: string) => {
    if (briefPreviews[briefId]) return;
    try {
      const brief = await getOptional<ClientBriefPreview>(`/api/public/content-brief/${workspaceId}/${briefId}`);
      if (brief) setBriefPreviews(prev => ({ ...prev, [briefId]: brief }));
    } catch { setToast({ message: 'Failed to load brief preview.', type: 'error' }); }
  }, [workspaceId, briefPreviews, setToast]);

  return {
    // State
    expandedContentReq, setExpandedContentReq,
    contentComment, setContentComment,
    sendingContentComment,
    declineReqId, setDeclineReqId,
    declineReason, setDeclineReason,
    feedbackReqId, setFeedbackReqId,
    feedbackText, setFeedbackText,
    briefPreviews,
    // Actions
    declineTopic,
    approveBrief,
    requestChanges,
    addContentComment,
    loadBriefPreview,
  };
}
