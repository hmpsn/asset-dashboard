import { get, post } from './client';
import type {
  KeywordCommandCenterActionRequest,
  KeywordCommandCenterActionResult,
  KeywordCommandCenterResponse,
} from '../../shared/types/keyword-command-center';

export const keywordCommandCenter = {
  get: (wsId: string) =>
    get<KeywordCommandCenterResponse>(`/api/webflow/keyword-command-center/${wsId}`),

  action: (wsId: string, body: KeywordCommandCenterActionRequest) =>
    post<KeywordCommandCenterActionResult>(`/api/webflow/keyword-command-center/${wsId}/actions`, body),
};
