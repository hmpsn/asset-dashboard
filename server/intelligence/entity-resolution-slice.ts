import type { EntityCandidate, EntityResolutionSlice, EntitySurface } from '../../shared/types/entity-resolution.js';
import type { IntelligenceOptions } from '../../shared/types/intelligence.js';
import { getWorkspace } from '../workspaces.js';

const MAX_ENTITY_CANDIDATES = 20;

function normalizeLabel(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function addCandidate(
  target: EntityCandidate[],
  seen: Set<string>,
  input: {
    label: string;
    type: EntityCandidate['type'];
    surface: EntitySurface;
    source: EntityCandidate['source'];
    pagePath?: string;
    confidence: number;
  },
): void {
  const label = normalizeLabel(input.label);
  if (!label) return;
  const dedupeKey = `${input.surface}:${input.type}:${label.toLowerCase()}`;
  if (seen.has(dedupeKey)) return;
  seen.add(dedupeKey);
  target.push({
    label,
    type: input.type,
    surface: input.surface,
    source: input.source,
    pagePath: input.pagePath,
    confidence: input.confidence,
  });
}

function placeLabel(address: { city?: string; state?: string }): string | null {
  const city = normalizeLabel(address.city ?? '');
  const state = normalizeLabel(address.state ?? '');
  if (city && state) return `${city}, ${state}`;
  if (city) return city;
  if (state) return state;
  return null;
}

export async function assembleEntityResolution(
  workspaceId: string,
  opts?: IntelligenceOptions,
): Promise<EntityResolutionSlice> {
  const ws = getWorkspace(workspaceId);
  if (!ws) {
    return {
      availability: 'no_data',
      entities: [],
      unresolved: [],
      generatedAt: new Date().toISOString(),
    };
  }

  const candidates: EntityCandidate[] = [];
  const seen = new Set<string>();

  for (const keyword of ws.keywordStrategy?.siteKeywords ?? []) {
    addCandidate(candidates, seen, {
      label: keyword,
      type: 'Thing',
      surface: 'organization_knows_about',
      source: 'workspace',
      confidence: 0.6,
    });
    if (candidates.length >= MAX_ENTITY_CANDIDATES) break;
  }

  if (opts?.pagePath && ws.keywordStrategy?.pageMap?.length) {
    const match = ws.keywordStrategy.pageMap.find(entry => entry.pagePath === opts.pagePath);
    if (match?.primaryKeyword) {
      addCandidate(candidates, seen, {
        label: match.primaryKeyword,
        type: 'Thing',
        surface: 'article_about',
        source: 'page',
        pagePath: opts.pagePath,
        confidence: 0.7,
      });
    }
    for (const keyword of match?.secondaryKeywords ?? []) {
      addCandidate(candidates, seen, {
        label: keyword,
        type: 'Thing',
        surface: 'article_mentions',
        source: 'page',
        pagePath: opts.pagePath,
        confidence: 0.55,
      });
      if (candidates.length >= MAX_ENTITY_CANDIDATES) break;
    }
  }

  const area = placeLabel(ws.businessProfile?.address ?? {});
  if (area) {
    addCandidate(candidates, seen, {
      label: area,
      type: 'Place',
      surface: 'area_served',
      source: 'workspace',
      confidence: 0.8,
    });
  }

  const unresolved = candidates.slice(0, MAX_ENTITY_CANDIDATES);
  const entities = unresolved.map(candidate => ({
    id: `entity:${slugify(candidate.label) || 'unknown'}`,
    label: candidate.label,
    type: candidate.type,
    surfaces: [candidate.surface],
    confidence: candidate.confidence,
    source: candidate.source,
    pagePath: candidate.pagePath,
  }));

  return {
    availability: entities.length > 0 ? 'ready' : 'no_data',
    entities,
    unresolved,
    generatedAt: new Date().toISOString(),
  };
}
