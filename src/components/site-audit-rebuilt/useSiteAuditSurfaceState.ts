// @ds-rebuilt
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export const SITE_AUDIT_SUBS = [
  { id: 'audit', label: 'Audit' },
  { id: 'history', label: 'History' },
  { id: 'aeo-review', label: 'AI Search Ready' },
  { id: 'content-decay', label: 'Content Health' },
  { id: 'guide', label: 'Guide' },
] as const;

export type SiteAuditSub = typeof SITE_AUDIT_SUBS[number]['id'];

const SUB_PARAM = 'sub';
const DEFAULT_SUB: SiteAuditSub = 'audit';
const SUB_VALUES = new Set<string>(SITE_AUDIT_SUBS.map((item) => item.id));

function resolveSiteAuditSub(value: string | null | undefined): SiteAuditSub {
  return typeof value === 'string' && SUB_VALUES.has(value) ? value as SiteAuditSub : DEFAULT_SUB;
}

export function useSiteAuditSurfaceState() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawSub = searchParams.get(SUB_PARAM);
  const sub = resolveSiteAuditSub(rawSub);

  const setSub = useCallback((nextSub: SiteAuditSub) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set(SUB_PARAM, nextSub);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  return {
    sub,
    rawSub,
    setSub,
  };
}
