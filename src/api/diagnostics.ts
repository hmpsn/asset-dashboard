import { get, post } from './client.js';
import type { DiagnosticReport } from '../../shared/types/diagnostics.js';

export const diagnostics = {
  list: (workspaceId: string) =>
    get<{ reports: DiagnosticReport[] }>(`/api/workspaces/${workspaceId}/diagnostics`),

  get: (workspaceId: string, reportId: string) =>
    get<{ report: DiagnosticReport }>(`/api/workspaces/${workspaceId}/diagnostics/${reportId}`),

  getForInsight: (workspaceId: string, insightId: string) =>
    get<{ report: DiagnosticReport | null }>(`/api/workspaces/${workspaceId}/diagnostics/by-insight/${insightId}`),

  run: (workspaceId: string, insightId: string) =>
    post<{ jobId: string; reportId: string }>('/api/jobs', { type: 'deep-diagnostic', params: { workspaceId, insightId } }),
};
