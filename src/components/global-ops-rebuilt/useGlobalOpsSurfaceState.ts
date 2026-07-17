// @ds-rebuilt
import { useCallback, useMemo } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';

export type BusinessTab = 'revenue' | 'ai-usage' | 'features' | 'prospects';
export type WorkspaceSettingsTab = 'connections' | 'features' | 'flags' | 'publishing' | 'dashboard' | 'export' | 'llms-txt';
export type RequestsTab = 'deliverables' | 'signals' | 'requests' | 'actions';
export type RoadmapView = 'sprint' | 'backlog';

export const BUSINESS_TABS = ['revenue', 'ai-usage', 'features', 'prospects'] as const satisfies readonly BusinessTab[];
export const WORKSPACE_SETTINGS_TABS = ['connections', 'features', 'flags', 'publishing', 'dashboard', 'export', 'llms-txt'] as const satisfies readonly WorkspaceSettingsTab[];
export const REQUESTS_TABS = ['deliverables', 'signals', 'requests', 'actions'] as const satisfies readonly RequestsTab[];
export const ROADMAP_VIEWS = ['sprint', 'backlog'] as const satisfies readonly RoadmapView[];

function inList<T extends string>(value: string | null, options: readonly T[]): value is T {
  return value != null && options.includes(value as T);
}

function businessDefaultFromPath(pathname: string): BusinessTab {
  if (pathname.endsWith('/ai-usage') || pathname === '/ai-usage') return 'ai-usage';
  if (pathname.endsWith('/features') || pathname === '/features') return 'features';
  if (pathname.endsWith('/prospect') || pathname === '/prospect') return 'prospects';
  return 'revenue';
}

function useParamWriter() {
  const [, setSearchParams] = useSearchParams();
  return useCallback((key: string, value: string | null) => {
    setSearchParams((next) => {
      const copy = new URLSearchParams(next);
      if (!value) copy.delete(key);
      else copy.set(key, value);
      return copy;
    }, { replace: true });
  }, [setSearchParams]);
}

export function useBusinessTabState(defaultTab?: BusinessTab) {
  const location = useLocation();
  const [params] = useSearchParams();
  const writeParam = useParamWriter();
  const fallback = defaultTab ?? businessDefaultFromPath(location.pathname);
  const tabParam = params.get('tab');
  const tab = inList(tabParam, BUSINESS_TABS) ? tabParam : fallback;
  const setTab = useCallback((next: BusinessTab) => {
    writeParam('tab', next === fallback ? null : next);
  }, [fallback, writeParam]);
  return {
    tab,
    invalidTab: params.has('tab') && !inList(tabParam, BUSINESS_TABS),
    setTab,
  };
}

export function useWorkspaceSettingsTabState() {
  const [params] = useSearchParams();
  const writeParam = useParamWriter();
  const tabParam = params.get('tab');
  const tab = inList(tabParam, WORKSPACE_SETTINGS_TABS) ? tabParam : 'connections';
  const setTab = useCallback((next: WorkspaceSettingsTab) => {
    writeParam('tab', next === 'connections' ? null : next);
  }, [writeParam]);
  return {
    tab,
    invalidTab: params.has('tab') && !inList(tabParam, WORKSPACE_SETTINGS_TABS),
    setTab,
  };
}

export function useRequestsTabState(defaultTab: RequestsTab = 'deliverables') {
  const [params] = useSearchParams();
  const writeParam = useParamWriter();
  const tabParam = params.get('tab');
  const tab = inList(tabParam, REQUESTS_TABS) ? tabParam : defaultTab;
  const setTab = useCallback((next: RequestsTab) => {
    writeParam('tab', next === defaultTab ? null : next);
  }, [defaultTab, writeParam]);
  return {
    tab,
    invalidTab: params.has('tab') && !inList(tabParam, REQUESTS_TABS),
    setTab,
  };
}

export function useRoadmapViewState() {
  const [params] = useSearchParams();
  const writeParam = useParamWriter();
  const viewParam = params.get('view');
  const view = inList(viewParam, ROADMAP_VIEWS) ? viewParam : 'sprint';
  const setView = useCallback((next: RoadmapView) => {
    writeParam('view', next === 'sprint' ? null : next);
  }, [writeParam]);
  return {
    view,
    invalidView: params.has('view') && !inList(viewParam, ROADMAP_VIEWS),
    setView,
  };
}

export function useDiagnosticsReportState() {
  const [params] = useSearchParams();
  const reportId = params.get('report');
  return useMemo(() => ({ reportId: reportId && reportId.trim() ? reportId : null }), [reportId]);
}
