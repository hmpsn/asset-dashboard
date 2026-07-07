// @ds-rebuilt
import { useCallback, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { UNBOUNDED_TOGGLE_SET_OPTIONS, useToggleSet } from '../../hooks/useToggleSet';
import { adminPath } from '../../routes';
import type { WorkQueueSourceType, WorkQueueStream } from '../../../shared/types/work-queue';

export const ENGINE_LENSES = [
  { id: 'spine', label: 'Spine' },
  { id: 'changes', label: 'Changes' },
  { id: 'signals', label: 'Signals' },
  { id: 'pov', label: 'POV' },
  { id: 'moves', label: 'Moves' },
  { id: 'operations', label: 'Operations' },
] as const;

export type EngineLens = typeof ENGINE_LENSES[number]['id'];
export type EngineStreamFilter = WorkQueueStream | 'all';

const LENS_PARAM = 'lens';
const DEFAULT_LENS: EngineLens = 'spine';
const LENS_VALUES = new Set<string>(ENGINE_LENSES.map((lens) => lens.id));
const STREAM_VALUES = new Set<string>(['all', 'opt', 'send', 'money', 'unclassified']);

const LEGACY_TABS = ['overview', 'content', 'rankings', 'competitive'] as const;
type LegacyStrategyTab = typeof LEGACY_TABS[number];
const LEGACY_TAB_VALUES = new Set<string>(LEGACY_TABS);

function isEngineLens(value: string | null | undefined): value is EngineLens {
  return typeof value === 'string' && LENS_VALUES.has(value);
}

function isStreamFilter(value: string | null | undefined): value is EngineStreamFilter {
  return typeof value === 'string' && STREAM_VALUES.has(value);
}

function isLegacyStrategyTab(value: string | null | undefined): value is LegacyStrategyTab {
  return typeof value === 'string' && LEGACY_TAB_VALUES.has(value);
}

export function useEngineSurfaceState(workspaceId: string) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawLens = searchParams.get(LENS_PARAM);
  const lens = isEngineLens(rawLens) ? rawLens : DEFAULT_LENS;
  const invalidLens = rawLens !== null && !isEngineLens(rawLens);
  const rawStream = searchParams.get('stream');
  const stream: EngineStreamFilter = isStreamFilter(rawStream) ? rawStream : 'all';
  const rawTab = searchParams.get('tab');
  const legacyTab = isLegacyStrategyTab(rawTab) ? rawTab : null;
  const invalidTab = rawTab !== null && legacyTab === null;
  const [activeSourceTypes, toggleSourceType, setActiveSourceTypes] = useToggleSet<WorkQueueSourceType>(
    [],
    UNBOUNDED_TOGGLE_SET_OPTIONS,
  );

  const updateParams = useCallback((updates: Record<string, string | null>, replace = true) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(updates)) {
        if (!value) next.delete(key);
        else next.set(key, value);
      }
      return next;
    }, { replace });
  }, [setSearchParams]);

  useEffect(() => {
    if (!legacyTab) return;
    if (legacyTab === 'overview') {
      updateParams({ tab: null, [LENS_PARAM]: 'spine' });
      return;
    }
    if (legacyTab === 'content') {
      navigate(`${adminPath(workspaceId, 'content-pipeline')}?tab=content-health`, { replace: true });
      return;
    }
    if (legacyTab === 'rankings') {
      navigate(`${adminPath(workspaceId, 'seo-keywords')}?lens=rankings`, { replace: true });
      return;
    }
    navigate(adminPath(workspaceId, 'competitors'), { replace: true });
  }, [legacyTab, navigate, updateParams, workspaceId]);

  return {
    lens,
    rawLens,
    invalidLens,
    setLens: (nextLens: EngineLens) => updateParams({ [LENS_PARAM]: nextLens }),
    stream,
    setStream: (nextStream: EngineStreamFilter) => updateParams({ stream: nextStream === 'all' ? null : nextStream }),
    activeSourceTypes,
    toggleSourceType,
    clearSourceTypes: () => setActiveSourceTypes(new Set()),
    legacyTab,
    invalidTab,
  };
}
