import { useQuery } from '@tanstack/react-query';
import { get, getSafe, getOptional } from '../../api/client';
import { queryKeys } from '../../lib/queryKeys';
import { STALE_TIMES } from '../../lib/queryClient';

// ── Audit traffic map ────────────────────────────────────────────
type TrafficMap = Record<string, { clicks: number; impressions: number; sessions: number; pageviews: number }>;

export function useAuditTrafficMap(siteId: string | undefined, workspaceId?: string) {
  return useQuery<TrafficMap>({
    queryKey: queryKeys.admin.auditTraffic(`${workspaceId ?? ''}:${siteId ?? ''}`),
    queryFn: async () => {
      const m = await getOptional<TrafficMap>(`/api/audit-traffic/${siteId}?workspaceId=${encodeURIComponent(workspaceId ?? '')}`);
      return (m && typeof m === 'object') ? m : {};
    },
    enabled: !!siteId && !!workspaceId,
    staleTime: STALE_TIMES.STABLE,
  });
}

// ── Audit suppressions ──────────────────────────────────────────
type Suppression = { check: string; pageSlug: string; pagePattern?: string };

export function useAuditSuppressions(workspaceId: string | undefined) {
  return useQuery<Suppression[]>({
    queryKey: queryKeys.admin.auditSuppressions(workspaceId ?? ''),
    queryFn: async () => {
      const s = await getSafe<Suppression[]>(`/api/workspaces/${workspaceId}/audit-suppressions`, []);
      return Array.isArray(s) ? s : [];
    },
    enabled: !!workspaceId,
    staleTime: 60_000,
  });
}

// ── Audit schedule ──────────────────────────────────────────────
export interface AuditSchedule {
  enabled: boolean;
  intervalDays: number;
  scoreDropThreshold: number;
  lastRunAt?: string;
  lastScore?: number;
}

export function useAuditSchedule(workspaceId: string | undefined) {
  return useQuery<AuditSchedule | null>({
    queryKey: queryKeys.admin.auditSchedule(workspaceId ?? ''),
    queryFn: async () => {
      const s = await getOptional<AuditSchedule>(`/api/audit-schedules/${workspaceId}`);
      return s ?? null;
    },
    enabled: !!workspaceId,
    staleTime: STALE_TIMES.STABLE,
  });
}

// ── Schema snapshot ─────────────────────────────────────────────
interface SchemaPageSuggestion {
  pageId: string;
  pageTitle: string;
  slug: string;
  url: string;
  existingSchemas: string[];
  existingSchemaJson?: Record<string, unknown>[];
  suggestedSchemas: Array<{ type: string; reason: string; priority: 'high' | 'medium' | 'low'; template: Record<string, unknown> }>;
  validationErrors?: string[];
}

export interface SchemaSnapshot {
  results: SchemaPageSuggestion[];
  createdAt: string | null;
}

export function useSchemaSnapshot(siteId: string, workspaceId?: string) {
  return useQuery<SchemaSnapshot | null>({
    queryKey: queryKeys.admin.schemaSnapshot(siteId, workspaceId),
    queryFn: async () => {
      try {
        const snapshot = await get<{ results?: SchemaPageSuggestion[]; createdAt?: string }>(`/api/webflow/schema-snapshot/${siteId}${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`);
        if (snapshot?.results?.length) {
          return { results: snapshot.results, createdAt: snapshot.createdAt ?? null };
        }
        return null;
      } catch { return null; }
    },
    enabled: !!siteId,
    staleTime: STALE_TIMES.STABLE,
  });
}

// ── Webflow pages list ──────────────────────────────────────────
interface WebflowPage { id: string; title: string; slug: string }

export function useWebflowPages(siteId: string, workspaceId?: string) {
  return useQuery<WebflowPage[]>({
    queryKey: queryKeys.admin.webflowPages(siteId, workspaceId),
    queryFn: async () => {
      const pages = await getSafe<Array<{ _id?: string; id?: string; title?: string; slug?: string }>>(`/api/webflow/pages/${siteId}${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`, []);
      if (!Array.isArray(pages)) return [];
      return pages.map((p) => ({
        id: p._id || p.id || '',
        title: p.title || p.slug || 'Untitled',
        slug: p.slug || '',
      }));
    },
    enabled: !!siteId,
    staleTime: STALE_TIMES.STABLE,
  });
}
