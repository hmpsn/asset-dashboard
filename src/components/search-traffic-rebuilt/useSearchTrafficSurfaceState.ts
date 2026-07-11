// @ds-rebuilt
import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { SearchTrafficLens, SearchTrafficTableMode } from './types';

export const SEARCH_TRAFFIC_LENSES = [
  { id: 'search', label: 'Search performance' },
  { id: 'traffic', label: 'Site traffic' },
  { id: 'annotations', label: 'Annotations' },
] as const;

const LENS_PARAM = 'lens';
const DAYS_PARAM = 'days';
const TABLE_PARAM = 'view';
const DEFAULT_LENS: SearchTrafficLens = 'search';
const DEFAULT_DAYS = 28;
const VALID_DAYS = new Set([7, 14, 28, 90, 180, 365, 480]);
const LENS_VALUES = new Set<string>([
  ...SEARCH_TRAFFIC_LENSES.map((lens) => lens.id),
  'overview',
]);
const TABLE_VALUES = new Set<string>(['queries', 'pages']);

type ParamValue = string | number | null | undefined;

function readLens(params: URLSearchParams): SearchTrafficLens {
  const raw = params.get(LENS_PARAM);
  return typeof raw === 'string' && LENS_VALUES.has(raw) ? raw as SearchTrafficLens : DEFAULT_LENS;
}

function readDays(params: URLSearchParams): number {
  const raw = Number.parseInt(params.get(DAYS_PARAM) ?? '', 10);
  return VALID_DAYS.has(raw) ? raw : DEFAULT_DAYS;
}

function readTableMode(params: URLSearchParams): SearchTrafficTableMode {
  const raw = params.get(TABLE_PARAM);
  return typeof raw === 'string' && TABLE_VALUES.has(raw) ? raw as SearchTrafficTableMode : 'queries';
}

export function useSearchTrafficSurfaceState() {
  const [searchParams, setSearchParams] = useSearchParams();
  const lens = readLens(searchParams);
  const days = readDays(searchParams);
  const tableMode = readTableMode(searchParams);

  useEffect(() => {
    const rawLens = searchParams.get(LENS_PARAM);
    const shouldClearLens = rawLens === DEFAULT_LENS || (rawLens !== null && !LENS_VALUES.has(rawLens));
    if (!shouldClearLens) return;

    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete(LENS_PARAM);
      return next;
    }, { replace: true });
  }, [searchParams, setSearchParams]);

  const updateParams = useCallback((updates: Record<string, ParamValue>, replace = true) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === undefined || value === '') next.delete(key);
        else next.set(key, String(value));
      }
      return next;
    }, { replace });
  }, [setSearchParams]);

  const setLens = useCallback((nextLens: SearchTrafficLens) => {
    updateParams({ [LENS_PARAM]: nextLens === DEFAULT_LENS ? null : nextLens });
  }, [updateParams]);

  const setDays = useCallback((nextDays: number) => {
    updateParams({ [DAYS_PARAM]: nextDays });
  }, [updateParams]);

  const setTableMode = useCallback((nextMode: SearchTrafficTableMode) => {
    updateParams({ [TABLE_PARAM]: nextMode });
  }, [updateParams]);

  return {
    lens,
    days,
    tableMode,
    setLens,
    setDays,
    setTableMode,
  };
}
