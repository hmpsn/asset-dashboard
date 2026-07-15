// @ds-rebuilt
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { resolveTabSearchParam } from '../../lib/tab-search-param';
import type { FixContext } from '../../types/fix-context';

export const SCHEMA_SURFACE_TABS = [
  { id: 'generator', label: 'Generator' },
  { id: 'guide', label: 'Workflow Guide' },
] as const;

export type SchemaSurfaceTab = typeof SCHEMA_SURFACE_TABS[number]['id'];

const VALID_SCHEMA_TABS = SCHEMA_SURFACE_TABS.map((tab) => tab.id);

function readSchemaTab(value: string | null): SchemaSurfaceTab {
  return resolveTabSearchParam<SchemaSurfaceTab>(value, {
    validValues: VALID_SCHEMA_TABS,
    fallback: 'generator',
  });
}

function readFixContext(state: unknown): FixContext | null {
  if (!state || typeof state !== 'object') return null;
  const maybeContext = (state as { fixContext?: FixContext }).fixContext;
  if (maybeContext?.targetRoute === 'seo-schema') return maybeContext;
  return null;
}

type ParamValue = string | number | null | undefined;

export function useSchemaSurfaceState() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const [fixContext, setFixContext] = useState<FixContext | null>(() => readFixContext(location.state));

  const tab = readSchemaTab(searchParams.get('tab'));

  useEffect(() => {
    const nextFixContext = readFixContext(location.state);
    if (nextFixContext) setFixContext(nextFixContext);
  }, [location.state]);

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

  const setTab = useCallback((nextTab: SchemaSurfaceTab) => {
    updateParams({ tab: nextTab === 'generator' ? null : nextTab });
  }, [updateParams]);

  const tabOptions = useMemo(() => SCHEMA_SURFACE_TABS.map((option) => ({
    value: option.id,
    label: option.label,
  })), []);

  return {
    tab,
    setTab,
    tabOptions,
    fixContext,
  };
}
