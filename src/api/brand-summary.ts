import type { ClientBrandSummary } from '../../shared/types/brand-generation';
import { get } from './client';

export const brandSummaryApi = {
  get: (workspaceId: string) =>
    get<ClientBrandSummary>(`/api/public/brand-summary/${workspaceId}`),
};
