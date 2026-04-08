import { getSafe, post } from './client';
import type { MeetingBrief } from '../../shared/types/meeting-brief';

interface BriefResponse {
  brief: MeetingBrief | null;
  unchanged?: boolean;
}

export const meetingBriefApi = {
  get: (workspaceId: string) =>
    getSafe<BriefResponse>(
      `/api/workspaces/${workspaceId}/meeting-brief`,
      { brief: null },
    ),

  /** Note: throws on non-2xx (unlike `get` which uses getSafe). Callers must handle via useMutation onError. */
  generate: (workspaceId: string) =>
    post<BriefResponse>(
      `/api/workspaces/${workspaceId}/meeting-brief/generate`,
      {},
    ),
};
