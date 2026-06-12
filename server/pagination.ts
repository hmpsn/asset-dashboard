/**
 * Shared pagination helpers for public list endpoints.
 *
 * Usage in a route handler:
 *
 *   const pagination = parsePaginationParams(req.query);
 *   if (!pagination) {
 *     // No params — return the original unpaginated shape (back-compat).
 *     return res.json(fullList);
 *   }
 *   const paged = listFooPaged(wsId, pagination.limit, pagination.offset);
 *   return res.json({ items: paged.items, pageInfo: { ... } });
 *
 * Back-compat contract:
 * - When neither `limit` nor `offset` is present in the query, returns null (caller
 *   uses the original full-response path, existing clients see no change).
 * - When either param is present, validates and returns { limit, offset }.
 *   Invalid values (non-integer, negative, limit > MAX_PAGE_LIMIT) return null,
 *   which callers treat as "ignore params, fall through to full response".
 */

/** Hard safety ceiling for the `limit` query param. */
export const MAX_PAGE_LIMIT = 200;

export interface PaginationParams {
  limit: number;
  offset: number;
}

/**
 * Parse optional `limit` and `offset` from an Express query object.
 *
 * Returns null when:
 * - Neither param is present (unpaginated call — use the original code path).
 * - Either param is present but invalid (non-integer, negative, or limit > MAX_PAGE_LIMIT).
 *
 * Returns PaginationParams when both params are valid (or only limit is provided,
 * in which case offset defaults to 0).
 */
export function parsePaginationParams(
  query: Record<string, unknown>,
): PaginationParams | null {
  const rawLimit = query['limit'];
  const rawOffset = query['offset'];

  // Neither param → unpaginated code path.
  if (rawLimit === undefined && rawOffset === undefined) return null;

  const limit = rawLimit !== undefined ? parseNonNegativeInt(rawLimit) : MAX_PAGE_LIMIT;
  const offset = rawOffset !== undefined ? parseNonNegativeInt(rawOffset) : 0;

  if (limit === null || offset === null) return null;
  if (limit === 0) return null; // limit=0 has no useful meaning — treat as absent.
  if (limit > MAX_PAGE_LIMIT) return null; // clamp violation → treat as absent.

  return { limit, offset };
}

function parseNonNegativeInt(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  if (!/^\d+$/.test(value)) return null;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}
