import { get, patch, post } from './client';
import type { ClientAction } from '../../shared/types/client-actions';

export const clientActions = {
  list: (wsId: string) =>
    get<ClientAction[]>(`/api/client-actions/${wsId}`),

  create: (wsId: string, body: {
    sourceType: ClientAction['sourceType'];
    sourceId?: string;
    title: string;
    summary: string;
    payload?: ClientAction['payload'];
    priority?: ClientAction['priority'];
  }) =>
    post<ClientAction>(`/api/client-actions/${wsId}`, body),

  update: (wsId: string, actionId: string, body: Partial<Pick<ClientAction, 'title' | 'summary' | 'payload' | 'priority' | 'status' | 'clientNote'>>) =>
    patch<ClientAction>(`/api/client-actions/${wsId}/${actionId}`, body),
};
