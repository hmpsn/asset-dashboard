import { getClientLocations } from '../../client-locations.js';
import { normalizeDomainValue } from '../../domain-normalization.js';
import { createLogger } from '../../logger.js';
import {
  LOCAL_BUSINESS_MATCH_CONFIDENCE,
  type ClientLocation,
  type LocalBusinessMatchConfidence,
  type LocalVisibilityBusinessResult,
} from '../../../shared/types/local-seo.js';
import type { Workspace } from '../../../shared/types/workspace.js';
import { normalizeText } from './keyword-intent.js';

const log = createLogger('local-seo/business-match');

export const LOCAL_SEO_MAX_RESULTS = 10;

export function cleanDomain(value: string | undefined): string | undefined {
  const normalized = normalizeDomainValue(value, {
    stripWww: true,
    lowercase: true,
    stripPort: true,
    allowMalformedFallback: true,
  });
  if (!normalized && value) {
    log.debug({ value }, 'local-seo cleanDomain: malformed domain value');
  }
  return normalized;
}

export function normalizePhone(value: string | undefined): string | undefined {
  const digits = value?.replace(/\D/g, '') ?? '';
  return digits.length >= 7 ? digits.slice(-10) : undefined;
}

export function normalizeProviderIdentity(value: string | undefined): string | undefined {
  const normalized = value?.toLowerCase().replace(/[^a-z0-9]+/g, '') ?? '';
  return normalized || undefined;
}

export interface LocalBusinessMatchResult {
  confidence: LocalBusinessMatchConfidence;
  found: boolean;
  rank?: number;
  reason?: string;
  matchedLocationId?: string;
  matchedLocationName?: string;
}

export function confidencePriority(confidence: LocalBusinessMatchConfidence): number {
  switch (confidence) {
    case LOCAL_BUSINESS_MATCH_CONFIDENCE.VERIFIED:
      return 3;
    case LOCAL_BUSINESS_MATCH_CONFIDENCE.STRONG_MATCH:
      return 2;
    case LOCAL_BUSINESS_MATCH_CONFIDENCE.POSSIBLE_MATCH:
      return 1;
    default:
      return 0;
  }
}

export function getEffectiveLocations(workspace: Workspace): ClientLocation[] {
  const configured = getClientLocations(workspace.id).filter(location => location.status === 'confirmed');
  if (configured.length > 0) return configured;
  const address = workspace.businessProfile?.address;
  // Use a fixed sentinel timestamp so two calls at different wall-clock times return
  // structurally identical objects — avoids false cache misses from unstable timestamps.
  const syntheticTimestamp = '1970-01-01T00:00:00.000Z';
  return [{
    id: `synthetic-${workspace.id}`,
    workspaceId: workspace.id,
    name: workspace.name,
    domain: workspace.liveDomain ?? workspace.gscPropertyUrl ?? undefined,
    phone: workspace.businessProfile?.phone,
    streetAddress: address?.street,
    city: address?.city,
    stateOrRegion: address?.state,
    country: address?.country,
    isPrimary: true,
    status: 'confirmed',
    createdAt: syntheticTimestamp,
    updatedAt: syntheticTimestamp,
  }];
}

export function isOwnedLocalResult(result: LocalVisibilityBusinessResult, locations: ClientLocation[]): boolean {
  const resultDomain = cleanDomain(result.domain ?? result.url);
  const resultPhone = normalizePhone(result.phone);
  const resultAddress = normalizeText(result.address);
  const resultProviderIdentity = normalizeProviderIdentity(result.cid);

  return locations.some(location => {
    const locationDomain = cleanDomain(location.domain);
    if (locationDomain && resultDomain && locationDomain === resultDomain) return true;
    const locationProviderIdentity = normalizeProviderIdentity(location.gbpPlaceId);
    if (locationProviderIdentity && resultProviderIdentity && locationProviderIdentity === resultProviderIdentity) return true;
    const locationPhone = normalizePhone(location.phone);
    if (locationPhone && resultPhone && locationPhone === resultPhone) return true;
    const locationStreet = normalizeText(location.streetAddress);
    if (locationStreet && resultAddress.includes(locationStreet)) return true;
    // Name alone is NOT enough to claim ownership — domain, GBP identity, phone, or
    // street address must corroborate. All four signals were already checked above
    // via early-return; if we reach here, all four were false, so name-only can't
    // produce a match. Returning false explicitly prevents a future reader from
    // "simplifying" the early-returns and inadvertently enabling name-only scrubbing.
    return false;
  });
}

export function scrubOwnedLocalResults(
  results: LocalVisibilityBusinessResult[],
  locations: ClientLocation[],
): LocalVisibilityBusinessResult[] {
  return results
    .filter(result => !isOwnedLocalResult(result, locations))
    .slice(0, LOCAL_SEO_MAX_RESULTS);
}

function isBetterLocalBusinessMatch(
  candidate: LocalBusinessMatchResult,
  current: LocalBusinessMatchResult | null,
): boolean {
  if (!current) return true;
  const candidatePriority = confidencePriority(candidate.confidence);
  const currentPriority = confidencePriority(current.confidence);
  if (candidatePriority !== currentPriority) return candidatePriority > currentPriority;
  const candidateRank = candidate.rank ?? Number.POSITIVE_INFINITY;
  const currentRank = current.rank ?? Number.POSITIVE_INFINITY;
  return candidateRank < currentRank;
}

export function evaluateLocalBusinessMatch(
  locations: ClientLocation[],
  results: LocalVisibilityBusinessResult[],
): LocalBusinessMatchResult {
  if (results.length === 0 || locations.length === 0) {
    return {
      confidence: LOCAL_BUSINESS_MATCH_CONFIDENCE.NOT_FOUND,
      found: false,
      reason: 'No local pack results returned',
    };
  }

  let best: LocalBusinessMatchResult | null = null;

  for (const location of locations) {
    const locationDomain = cleanDomain(location.domain);
    const locationName = normalizeText(location.name);
    const locationPhone = normalizePhone(location.phone);
    const locationStreet = normalizeText(location.streetAddress);

    for (const result of results) {
      const resultDomain = cleanDomain(result.domain ?? result.url);
      const title = normalizeText(result.title);
      const address = normalizeText(result.address);
      const phone = normalizePhone(result.phone);
      const providerIdentity = normalizeProviderIdentity(result.cid);
      const domainMatch = Boolean(locationDomain && resultDomain && resultDomain === locationDomain);
      const phoneMatch = Boolean(locationPhone && phone && locationPhone === phone);
      const nameMatch = Boolean(locationName && title && (title.includes(locationName) || locationName.includes(title)));
      const streetAddressMatch = Boolean(locationStreet && address.includes(locationStreet));
      const locationProviderIdentity = normalizeProviderIdentity(location.gbpPlaceId);
      const providerIdentityMatch = Boolean(
        locationProviderIdentity && providerIdentity && locationProviderIdentity === providerIdentity,
      );

      let candidate: LocalBusinessMatchResult | null = null;
      if (providerIdentityMatch || (domainMatch && (nameMatch || phoneMatch || streetAddressMatch))) {
        candidate = {
          confidence: LOCAL_BUSINESS_MATCH_CONFIDENCE.VERIFIED,
          found: true,
          rank: result.rank,
          reason: 'Domain plus name, phone, address, or provider identity matched',
          matchedLocationId: location.id,
          matchedLocationName: location.name,
        };
      } else if (domainMatch || (nameMatch && (phoneMatch || streetAddressMatch))) {
        candidate = {
          confidence: LOCAL_BUSINESS_MATCH_CONFIDENCE.STRONG_MATCH,
          found: true,
          rank: result.rank,
          reason: 'Strong business identity match in local result',
          matchedLocationId: location.id,
          matchedLocationName: location.name,
        };
      } else if (nameMatch || phoneMatch || streetAddressMatch) {
        candidate = {
          confidence: LOCAL_BUSINESS_MATCH_CONFIDENCE.POSSIBLE_MATCH,
          found: true,
          rank: result.rank,
          reason: 'Possible business match; review before treating as verified',
          matchedLocationId: location.id,
          matchedLocationName: location.name,
        };
      }

      if (candidate && isBetterLocalBusinessMatch(candidate, best)) {
        best = candidate;
      }
    }
  }

  return best ?? {
    confidence: LOCAL_BUSINESS_MATCH_CONFIDENCE.NOT_FOUND,
    found: false,
    reason: 'No likely business match found in local results',
  };
}
