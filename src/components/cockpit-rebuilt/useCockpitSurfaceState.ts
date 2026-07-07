// @ds-rebuilt
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { UNBOUNDED_TOGGLE_SET_OPTIONS, useToggleSet } from '../../hooks/useToggleSet';
import type { WorkQueueSourceType, WorkQueueStream } from '../../../shared/types/work-queue';

export type CockpitStreamFilter = WorkQueueStream | 'all';
export type CockpitEvidenceView = 'rankings' | 'technicals';

const STREAM_FILTERS = ['all', 'opt', 'send', 'money', 'unclassified'] as const satisfies readonly CockpitStreamFilter[];
const EVIDENCE_VIEWS = ['rankings', 'technicals'] as const satisfies readonly CockpitEvidenceView[];
const VALID_TABS = ['meeting-brief'] as const;

function isStreamFilter(value: string | null): value is CockpitStreamFilter {
  return STREAM_FILTERS.includes(value as CockpitStreamFilter);
}

function isEvidenceView(value: string | null): value is CockpitEvidenceView {
  return EVIDENCE_VIEWS.includes(value as CockpitEvidenceView);
}

function isRetiredTab(value: string | null): value is typeof VALID_TABS[number] {
  return VALID_TABS.includes(value as typeof VALID_TABS[number]);
}

export function useCockpitSurfaceState() {
  const [params, setParams] = useSearchParams();
  const streamParam = params.get('stream');
  const stream: CockpitStreamFilter = isStreamFilter(streamParam) ? streamParam : 'all';
  const viewParam = params.get('view');
  const view: CockpitEvidenceView = isEvidenceView(viewParam) ? viewParam : 'rankings';
  const tabParam = params.get('tab');
  const retiredTab = isRetiredTab(tabParam) ? tabParam : null;
  const invalidTab = params.has('tab') && !retiredTab;
  const [activeSourceTypes, toggleSourceType, setActiveSourceTypes] = useToggleSet<WorkQueueSourceType>(
    [],
    UNBOUNDED_TOGGLE_SET_OPTIONS,
  );

  const updateParam = useCallback((key: string, value: string | null) => {
    setParams((next) => {
      const copy = new URLSearchParams(next);
      if (!value) copy.delete(key);
      else copy.set(key, value);
      return copy;
    }, { replace: true });
  }, [setParams]);

  return {
    stream,
    setStream: (next: CockpitStreamFilter) => updateParam('stream', next === 'all' ? null : next),
    view,
    setView: (next: CockpitEvidenceView) => updateParam('view', next === 'rankings' ? null : next),
    retiredTab,
    invalidTab,
    activeSourceTypes,
    toggleSourceType,
    clearSourceTypes: () => setActiveSourceTypes(new Set()),
  };
}
