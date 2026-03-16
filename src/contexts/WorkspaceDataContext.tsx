import { createContext, useContext, useCallback, useRef, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { gsc, ga4 } from '../api/analytics';
import { rankTracking, activity as activityApi, annotations as annotationsApi } from '../api/misc';
import { getSafe } from '../api/client';
import { useWorkspaceEvents } from '../hooks/useWorkspaceEvents';
import type { SearchOverview } from '../../shared/types/analytics';

// ── Cache key types ──
export type CacheKey =
  | 'gsc-overview'
  | 'ga4-overview'
  | 'audit-summary'
  | 'ranks'
  | 'activity'
  | 'annotations';

interface CacheEntry<T = unknown> {
  data: T;
  fetchedAt: number;
}

interface WorkspaceDataState<T = unknown> {
  data: T | null;
  loading: boolean;
  refetch: () => Promise<void>;
}

const TTL_MS = 60_000; // 60 seconds

interface ContextValue {
  workspaceId: string;
  get: <T>(key: CacheKey) => CacheEntry<T> | undefined;
  set: <T>(key: CacheKey, data: T) => void;
  invalidate: (key: CacheKey) => void;
  invalidateAll: () => void;
}

const WorkspaceDataContext = createContext<ContextValue | null>(null);

// ── Fetcher registry ──
function buildFetcher(key: CacheKey, workspaceId: string): (() => Promise<unknown>) | null {
  const days = 28;
  switch (key) {
    case 'gsc-overview':
      return () => gsc.overview(workspaceId, days);
    case 'ga4-overview':
      return () => getSafe<unknown>(`/api/public/analytics-overview/${workspaceId}?days=${days}`, null);
    case 'ranks':
      return () => rankTracking.latest(workspaceId);
    case 'activity':
      return () => activityApi.list(workspaceId);
    case 'annotations':
      return () => annotationsApi.list(workspaceId);
    case 'audit-summary':
      return () => getSafe<unknown>(`/api/audit-summary/${workspaceId}`, null);
    default:
      return null;
  }
}

// ── Provider ──
interface ProviderProps {
  workspaceId: string;
  children: ReactNode;
}

export function WorkspaceDataProvider({ workspaceId, children }: ProviderProps) {
  const cacheRef = useRef<Map<CacheKey, CacheEntry>>(new Map());
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick(t => t + 1), []);

  // Reset cache when workspace changes
  useEffect(() => {
    cacheRef.current.clear();
    bump();
  }, [workspaceId, bump]);

  const getEntry = useCallback(<T,>(key: CacheKey): CacheEntry<T> | undefined => {
    const entry = cacheRef.current.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.fetchedAt > TTL_MS) {
      cacheRef.current.delete(key);
      return undefined;
    }
    return entry as CacheEntry<T>;
  }, []);

  const setEntry = useCallback(<T,>(key: CacheKey, data: T) => {
    cacheRef.current.set(key, { data, fetchedAt: Date.now() });
    bump();
  }, [bump]);

  const invalidate = useCallback((key: CacheKey) => {
    cacheRef.current.delete(key);
    bump();
  }, [bump]);

  const invalidateAll = useCallback(() => {
    cacheRef.current.clear();
    bump();
  }, [bump]);

  // Invalidate cache on real-time WebSocket events
  useWorkspaceEvents(workspaceId, {
    'activity:new': () => invalidate('activity'),
    'approval:update': () => invalidate('activity'),
    'approval:applied': () => invalidate('activity'),
    'audit:complete': () => { invalidate('audit-summary'); invalidate('activity'); },
    'ranks:updated': () => invalidate('ranks'),
  });

  const value: ContextValue = {
    workspaceId,
    get: getEntry,
    set: setEntry,
    invalidate,
    invalidateAll,
  };

  return (
    <WorkspaceDataContext.Provider value={value}>
      {children}
    </WorkspaceDataContext.Provider>
  );
}

// ── Hook ──
export function useWorkspaceData<T = unknown>(key: CacheKey): WorkspaceDataState<T> {
  const ctx = useContext(WorkspaceDataContext);
  if (!ctx) {
    throw new Error('useWorkspaceData must be used within a WorkspaceDataProvider');
  }

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<T | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchData = useCallback(async () => {
    const fetcher = buildFetcher(key, ctx.workspaceId);
    if (!fetcher) return;
    setLoading(true);
    try {
      const result = await fetcher();
      if (mountedRef.current) {
        ctx.set(key, result);
        setData(result as T);
      }
    } catch {
      // ignore fetch errors
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [key, ctx]);

  // On mount or when cache is invalidated, check cache first then fetch
  useEffect(() => {
    const cached = ctx.get<T>(key);
    if (cached) {
      setData(cached.data);
      setLoading(false);
    } else {
      fetchData();
    }
  }, [key, ctx, fetchData]);

  return { data, loading, refetch: fetchData };
}
