import { useClientMonthlyDigestView } from './useClientInsightViewModel';

export function useMonthlyDigest(workspaceId: string) {
  return useClientMonthlyDigestView(workspaceId);
}
