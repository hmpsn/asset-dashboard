// @ds-rebuilt
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export const PERFORMANCE_LENSES = [
  { id: 'weight', label: 'Page Weight' },
  { id: 'speed', label: 'Page Speed' },
] as const;

export type PerformanceLens = typeof PERFORMANCE_LENSES[number]['id'];

const TAB_VALUES = new Set<string>(PERFORMANCE_LENSES.map((lens) => lens.id));
const DEFAULT_TAB: PerformanceLens = 'weight';

function readTab(params: URLSearchParams): PerformanceLens {
  const raw = params.get('tab');
  return typeof raw === 'string' && TAB_VALUES.has(raw) ? raw as PerformanceLens : DEFAULT_TAB;
}

export function usePerformanceSurfaceState() {
  const [searchParams, setSearchParams] = useSearchParams();
  const lens = readTab(searchParams);

  const setLens = useCallback((nextLens: PerformanceLens) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('tab', nextLens);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  return {
    lens,
    setLens,
  };
}
