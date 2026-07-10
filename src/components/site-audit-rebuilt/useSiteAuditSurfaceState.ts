// @ds-rebuilt
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export const SITE_AUDIT_VISIBLE_SUBS = [
  { id: 'audit', label: 'Site Audit' },
  { id: 'history', label: 'History' },
] as const;

const SITE_AUDIT_COMPATIBILITY_SUBS = [
  { id: 'aeo-review', label: 'AI Search Ready' },
  { id: 'content-decay', label: 'Content Health' },
  { id: 'guide', label: 'Guide' },
] as const;

export const SITE_AUDIT_SUBS = [...SITE_AUDIT_VISIBLE_SUBS, ...SITE_AUDIT_COMPATIBILITY_SUBS] as const;

export type SiteAuditSub = typeof SITE_AUDIT_SUBS[number]['id'];
export type SiteAuditVisibleSub = typeof SITE_AUDIT_VISIBLE_SUBS[number]['id'];
export type SiteAuditEvidenceSub = typeof SITE_AUDIT_COMPATIBILITY_SUBS[number]['id'];

const SUB_PARAM = 'sub';
const DEFAULT_SUB: SiteAuditVisibleSub = 'audit';
const SUB_VALUES = new Set<string>(SITE_AUDIT_SUBS.map((item) => item.id));
const VISIBLE_SUB_VALUES = new Set<string>(SITE_AUDIT_VISIBLE_SUBS.map((item) => item.id));
const EVIDENCE_SUB_VALUES = new Set<string>(SITE_AUDIT_COMPATIBILITY_SUBS.map((item) => item.id));

function resolveSiteAuditSub(value: string | null | undefined): SiteAuditSub {
  return typeof value === 'string' && SUB_VALUES.has(value) ? value as SiteAuditSub : DEFAULT_SUB;
}

function isVisibleSub(value: SiteAuditSub): value is SiteAuditVisibleSub {
  return VISIBLE_SUB_VALUES.has(value);
}

function isEvidenceSub(value: SiteAuditSub): value is SiteAuditEvidenceSub {
  return EVIDENCE_SUB_VALUES.has(value);
}

export function useSiteAuditSurfaceState() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawSub = searchParams.get(SUB_PARAM);
  const sub = resolveSiteAuditSub(rawSub);
  const visibleSub = isVisibleSub(sub) ? sub : DEFAULT_SUB;
  const evidenceSub = isEvidenceSub(sub) ? sub : null;

  const setSub = useCallback((nextSub: SiteAuditSub) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (nextSub === DEFAULT_SUB) {
        next.delete(SUB_PARAM);
      } else {
        next.set(SUB_PARAM, nextSub);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  return {
    sub,
    rawSub,
    visibleSub,
    evidenceSub,
    setSub,
  };
}
