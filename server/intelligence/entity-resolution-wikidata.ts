import { STUDIO_URL } from '../constants.js';
import { createLogger } from '../logger.js';
import { getCachedEntityResolution, upsertEntityResolutionCache } from './entity-resolution-cache.js';
import type { EntityCandidate, EntityReference } from '../../shared/types/entity-resolution.js';

const log = createLogger('entity-resolution-wikidata');

const WIKIDATA_SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
const WIKIDATA_REQUEST_TIMEOUT_MS = 2500;
// Wikimedia User-Agent policy (https://meta.wikimedia.org/wiki/User-Agent_policy)
// requires a descriptive UA; default Node fetch UA may be rate-limited or blocked.
const WIKIDATA_USER_AGENT = `HmpsnStudioEntityResolver/1.0 (+${STUDIO_URL})`;
const CACHE_TTL_RESOLVED_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const CACHE_TTL_UNRESOLVED_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const CACHE_TTL_ERROR_MS = 1000 * 60 * 60 * 24; // 1 day
const MAX_LABEL_LENGTH = 120;

interface SparqlBindingValue {
  type: string;
  value: string;
}

interface SparqlBinding {
  item?: SparqlBindingValue;
  itemLabel?: SparqlBindingValue;
  itemDescription?: SparqlBindingValue;
}

interface SparqlResponse {
  results?: {
    bindings?: SparqlBinding[];
  };
}

export interface WikidataResolutionResult {
  status: 'resolved' | 'unresolved' | 'error';
  reference?: EntityReference;
  confidence: number;
  errorMessage?: string;
}

interface WikidataCandidate {
  qid: string;
  label: string;
  description?: string;
}

function normalizeEntityLabel(label: string): string {
  return label.replace(/\s+/g, ' ').trim();
}

function cacheKeyForCandidate(candidate: EntityCandidate): string {
  return `${candidate.type}:${normalizeEntityLabel(candidate.label).toLowerCase()}`;
}

function expiresAtFrom(nowMs: number, status: WikidataResolutionResult['status']): string {
  const ttlMs = status === 'resolved'
    ? CACHE_TTL_RESOLVED_MS
    : status === 'unresolved'
      ? CACHE_TTL_UNRESOLVED_MS
      : CACHE_TTL_ERROR_MS;
  return new Date(nowMs + ttlMs).toISOString();
}

function escapeSparqlLiteral(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\n\r\t]/g, ' ')
    .trim();
}

function qidFromEntityUri(value: string): string | null {
  const match = value.match(/\/(Q\d+)$/);
  return match ? match[1] : null;
}

function buildWikidataReference(candidate: WikidataCandidate): EntityReference {
  return {
    qid: candidate.qid,
    label: candidate.label,
    description: candidate.description,
    sameAs: `https://www.wikidata.org/wiki/${candidate.qid}`,
  };
}

function buildSparqlQuery(candidate: EntityCandidate): string {
  const cleaned = normalizeEntityLabel(candidate.label).slice(0, MAX_LABEL_LENGTH);
  const literal = escapeSparqlLiteral(cleaned);
  return `
SELECT ?item ?itemLabel ?itemDescription WHERE {
  {
    ?item rdfs:label "${literal}"@en.
  } UNION {
    ?item skos:altLabel "${literal}"@en.
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 8
  `.trim();
}

function scoreCandidateMatch(input: {
  candidate: EntityCandidate;
  wikidata: WikidataCandidate;
}): number {
  const label = normalizeEntityLabel(input.candidate.label).toLowerCase();
  const matchLabel = normalizeEntityLabel(input.wikidata.label).toLowerCase();
  const description = (input.wikidata.description ?? '').toLowerCase();

  let score = 0.2;
  if (matchLabel === label) score += 0.45;
  else if (matchLabel.startsWith(`${label} `) || matchLabel.endsWith(` ${label}`)) score += 0.25;
  else if (matchLabel.includes(label)) score += 0.1;

  if (input.candidate.type === 'Place') {
    if (/\b(city|town|village|municipality|county|state|region|district|country|province|metropolitan)\b/.test(description)) {
      score += 0.35;
    } else {
      score -= 0.15;
    }
  } else if (/\b(company|organization|software|service|concept|technology|industry|discipline)\b/.test(description)) {
    score += 0.2;
  }

  return Math.max(0, Math.min(1, score));
}

function chooseBestCandidate(
  candidate: EntityCandidate,
  options: WikidataCandidate[],
): { best: WikidataCandidate | null; confidence: number } {
  let best: WikidataCandidate | null = null;
  let confidence = 0;
  for (const option of options) {
    const score = scoreCandidateMatch({ candidate, wikidata: option });
    if (score > confidence) {
      confidence = score;
      best = option;
    }
  }
  return { best, confidence };
}

function parseSparqlCandidates(payload: SparqlResponse): WikidataCandidate[] {
  const rows = payload.results?.bindings ?? [];
  const out: WikidataCandidate[] = [];
  for (const row of rows) {
    const entityUri = row.item?.value;
    const label = row.itemLabel?.value?.trim();
    if (!entityUri || !label) continue;
    const qid = qidFromEntityUri(entityUri);
    if (!qid) continue;
    out.push({
      qid,
      label,
      description: row.itemDescription?.value?.trim() || undefined,
    });
  }
  return out;
}

function toCacheRecord(
  cacheKey: string,
  candidate: EntityCandidate,
  result: WikidataResolutionResult,
  nowIso: string,
  nowMs: number,
) {
  return {
    cacheKey,
    entityLabel: normalizeEntityLabel(candidate.label),
    entityType: candidate.type,
    wikidata: result.reference
      ? {
          qid: result.reference.qid,
          label: result.reference.label,
          description: result.reference.description,
          sameAs: result.reference.sameAs,
        }
      : null,
    confidence: result.confidence,
    status: result.status,
    errorMessage: result.errorMessage ?? null,
    fetchedAt: nowIso,
    expiresAt: expiresAtFrom(nowMs, result.status),
  } as const;
}

export async function resolveCandidateWithWikidata(
  candidate: EntityCandidate,
): Promise<WikidataResolutionResult> {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const cacheKey = cacheKeyForCandidate(candidate);

  const cached = getCachedEntityResolution(cacheKey, nowIso);
  if (cached) {
    if (cached.status === 'resolved' && cached.wikidata) {
      return {
        status: 'resolved',
        reference: {
          qid: cached.wikidata.qid,
          label: cached.wikidata.label,
          description: cached.wikidata.description,
          sameAs: cached.wikidata.sameAs,
        },
        confidence: cached.confidence,
      };
    }
    return {
      status: cached.status,
      confidence: cached.confidence,
      errorMessage: cached.errorMessage ?? undefined,
    };
  }

  const query = buildSparqlQuery(candidate);
  const url = `${WIKIDATA_SPARQL_ENDPOINT}?format=json&query=${encodeURIComponent(query)}`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/sparql-results+json',
        'User-Agent': WIKIDATA_USER_AGENT,
      },
      signal: AbortSignal.timeout(WIKIDATA_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      const failed: WikidataResolutionResult = {
        status: 'error',
        confidence: 0,
        errorMessage: `wikidata-status-${response.status}`,
      };
      upsertEntityResolutionCache(toCacheRecord(cacheKey, candidate, failed, nowIso, nowMs));
      return failed;
    }

    const payload = await response.json() as SparqlResponse;
    const parsed = parseSparqlCandidates(payload);
    const { best, confidence } = chooseBestCandidate(candidate, parsed);
    if (!best || confidence < 0.45) {
      const unresolved: WikidataResolutionResult = {
        status: 'unresolved',
        confidence,
      };
      upsertEntityResolutionCache(toCacheRecord(cacheKey, candidate, unresolved, nowIso, nowMs));
      return unresolved;
    }

    const resolved: WikidataResolutionResult = {
      status: 'resolved',
      reference: buildWikidataReference(best),
      confidence,
    };
    upsertEntityResolutionCache(toCacheRecord(cacheKey, candidate, resolved, nowIso, nowMs));
    return resolved;
  } catch (err) {
    // External fetch failures (TypeError from network, SyntaxError from malformed JSON,
    // AbortError from timeout) are expected degradation, not programming errors.
    // See server/errors.ts for the contract.
    log.debug({ err, candidate: candidate.label }, 'entity-resolution-wikidata: request failed (cached as error)');
    const failed: WikidataResolutionResult = {
      status: 'error',
      confidence: 0,
      errorMessage: 'wikidata-request-failed',
    };
    upsertEntityResolutionCache(toCacheRecord(cacheKey, candidate, failed, nowIso, nowMs));
    return failed;
  }
}
