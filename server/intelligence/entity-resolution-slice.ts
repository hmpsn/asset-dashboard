import type { EntityCandidate, EntityResolutionSlice, EntitySurface } from '../../shared/types/entity-resolution.js';
import type { IntelligenceOptions } from '../../shared/types/intelligence.js';
import { getWorkspace } from '../workspaces.js';
import { listPageKeywords } from '../page-keywords.js';
import { slugify } from '../helpers.js';
import { resolveCandidateWithWikidata } from './entity-resolution-wikidata.js';

const MAX_ENTITY_CANDIDATES = 20;
const MAX_WIKIDATA_LOOKUPS = 8;

function normalizeLabel(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
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

function entityIdFromCandidate(candidate: EntityCandidate): string {
  return `entity:${slugify(candidate.label) || 'unknown'}:${candidate.type.toLowerCase()}`;
}

function mergeResolvedEntity(
  target: Map<string, EntityResolutionSlice['entities'][number]>,
  input: EntityResolutionSlice['entities'][number],
): void {
  const existing = target.get(input.id);
  if (!existing) {
    target.set(input.id, input);
    return;
  }
  const mergedSurfaces = new Set([...existing.surfaces, ...input.surfaces]);
  existing.surfaces = Array.from(mergedSurfaces);
  existing.confidence = Math.max(existing.confidence, input.confidence);
  if (!existing.wikidata && input.wikidata) existing.wikidata = input.wikidata;
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

  // pageMap is table-only (stripped from the blob before persistence — ws.keywordStrategy?.pageMap
  // is always undefined at read time). Read from the page_keywords table, matching
  // seo-context-slice.ts:42 (listPageKeywords) and keyword-strategy-assembler.ts (table-only
  // pageMap). Without this the page-level entity candidates block was permanently dead code.
  if (opts?.pagePath) {
    const tablePageMap = listPageKeywords(workspaceId);
    const match = tablePageMap.find(entry => entry.pagePath === opts.pagePath);
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
  const resolvedMap = new Map<string, EntityResolutionSlice['entities'][number]>();
  let degraded = false;

  for (const [index, candidate] of unresolved.entries()) {
    const shouldResolve = opts?.resolveEntityReferences === true && index < MAX_WIKIDATA_LOOKUPS;
    const resolvedBase = {
      id: entityIdFromCandidate(candidate),
      label: candidate.label,
      type: candidate.type,
      surfaces: [candidate.surface] as EntitySurface[],
      confidence: candidate.confidence,
      source: candidate.source,
      pagePath: candidate.pagePath,
    };
    if (!shouldResolve) {
      mergeResolvedEntity(resolvedMap, resolvedBase);
      continue;
    }

    const lookup = await resolveCandidateWithWikidata(candidate);
    if (lookup.status === 'error') degraded = true;
    if (lookup.status === 'resolved' && lookup.reference) {
      // Include type in the merge key so a Thing-typed and Place-typed candidate that
      // resolve to the same QID stay separate (e.g. areaServed must filter on type === 'Place').
      mergeResolvedEntity(resolvedMap, {
        ...resolvedBase,
        id: `wikidata:${candidate.type.toLowerCase()}:${lookup.reference.qid}`,
        label: lookup.reference.label || candidate.label,
        confidence: Math.max(candidate.confidence, lookup.confidence),
        wikidata: lookup.reference,
      });
      continue;
    }

    mergeResolvedEntity(resolvedMap, {
      ...resolvedBase,
      confidence: Math.max(candidate.confidence, lookup.confidence),
    });
  }

  const entities = Array.from(resolvedMap.values());

  return {
    availability: entities.length > 0 ? (degraded ? 'degraded' : 'ready') : 'no_data',
    entities,
    unresolved,
    generatedAt: new Date().toISOString(),
  };
}
