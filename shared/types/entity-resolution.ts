// shared/types/entity-resolution.ts
// Typed contracts for schema entity grounding + disambiguation workflows.

export const ENTITY_SURFACES = {
  organizationKnowsAbout: 'organization_knows_about',
  articleAbout: 'article_about',
  articleMentions: 'article_mentions',
  areaServed: 'area_served',
} as const;

export type EntitySurface = typeof ENTITY_SURFACES[keyof typeof ENTITY_SURFACES];

export const RESOLVED_ENTITY_TYPES = {
  thing: 'Thing',
  place: 'Place',
} as const;

export type ResolvedEntityType = typeof RESOLVED_ENTITY_TYPES[keyof typeof RESOLVED_ENTITY_TYPES];

export interface EntityCandidate {
  label: string;
  type: ResolvedEntityType;
  surface: EntitySurface;
  source: 'workspace' | 'page' | 'schema_hint';
  pagePath?: string;
  confidence: number;
}

export interface EntityReference {
  qid: string;
  label: string;
  description?: string;
  sameAs: string;
}

export interface ResolvedEntity {
  id: string;
  label: string;
  type: ResolvedEntityType;
  surfaces: EntitySurface[];
  confidence: number;
  source: 'workspace' | 'page' | 'schema_hint';
  pagePath?: string;
  wikidata?: EntityReference;
}

export interface EntityResolutionSlice {
  availability: 'ready' | 'disabled' | 'degraded' | 'no_data' | 'not_requested';
  entities: ResolvedEntity[];
  unresolved: EntityCandidate[];
  generatedAt: string | null;
}
