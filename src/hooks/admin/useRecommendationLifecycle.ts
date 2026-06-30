/**
 * Strategy v3 — wires the cockpit's five lifecycle actions to the admin routes,
 * invalidating the admin + shared rec caches on each success. Returns the
 * CockpitActions shape StrategyCockpit consumes (no prop drilling of mutations).
 *
 * Cache invalidation strategy: on each mutation success we invalidate both
 * queryKeys.admin.recommendations (the full set the cockpit reads) and
 * queryKeys.shared.recommendations (the client-facing shared cache). The WS
 * broadcast RECOMMENDATIONS_UPDATED also covers cross-client fan-out via
 * useWsInvalidation, so this is belt-and-suspenders for the local admin session.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { recommendations } from '../../api/misc';
import { queryKeys } from '../../lib/queryKeys';
import type { CockpitActions } from '../../components/strategy/StrategyCockpit';
import type { Recommendation } from '../../../shared/types/recommendations';

/** Strategy v3 — returns the CockpitActions shape StrategyCockpit consumes. */
export function useRecommendationLifecycle(workspaceId: string): CockpitActions {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: queryKeys.admin.recommendations(workspaceId) });
    qc.invalidateQueries({ queryKey: queryKeys.shared.recommendations(workspaceId) });
  };

  const send = useMutation<Recommendation, Error, { recId: string; note?: string }>({
    mutationFn: ({ recId, note }) => recommendations.send(workspaceId, recId, note),
    onSuccess: invalidate,
  });
  const strike = useMutation<Recommendation, Error, string>({
    mutationFn: (recId) => recommendations.strike(workspaceId, recId),
    onSuccess: invalidate,
  });
  const unstrike = useMutation<Recommendation, Error, string>({
    mutationFn: (recId) => recommendations.unstrike(workspaceId, recId),
    onSuccess: invalidate,
  });
  const throttle = useMutation<Recommendation, Error, { recId: string; days: 7 | 30 | 90 }>({
    mutationFn: ({ recId, days }) => recommendations.throttle(workspaceId, recId, days),
    onSuccess: invalidate,
  });
  const fix = useMutation<Recommendation, Error, string>({
    mutationFn: (recId) => recommendations.fix(workspaceId, recId),
    onSuccess: invalidate,
  });

  return {
    send: (recId, note) => send.mutate({ recId, note }),
    strike: (recId) => strike.mutate(recId),
    unstrike: (recId) => unstrike.mutate(recId),
    throttle: (recId, days) => throttle.mutate({ recId, days }),
    fix: (recId) => fix.mutate(recId),
    isPending:
      send.isPending ||
      strike.isPending ||
      unstrike.isPending ||
      throttle.isPending ||
      fix.isPending,
  };
}
