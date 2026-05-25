import { randomUUID } from 'crypto';

import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { CLIENT_LOCATION_STATUS } from '../shared/types/local-seo.js';
import type { ClientLocation } from '../shared/types/local-seo.js';

interface LocationRow {
  id: string;
  workspace_id: string;
  name: string;
  domain: string | null;
  phone: string | null;
  street_address: string | null;
  city: string | null;
  state_or_region: string | null;
  country: string | null;
  is_primary: number;
  status: string;
  gbp_place_id: string | null;
  primary_market_id: string | null;
  page_target_path: string | null;
  page_target_keyword_id: string | null;
  created_at: string;
  updated_at: string;
}

const stmts = createStmtCache(() => ({
  list: db.prepare(`
    SELECT * FROM client_locations
    WHERE workspace_id = ?
    ORDER BY is_primary DESC, created_at ASC
  `),
  getById: db.prepare(`
    SELECT * FROM client_locations
    WHERE id = ? AND workspace_id = ?
  `),
  insert: db.prepare(`
    INSERT INTO client_locations (
      id, workspace_id, name, domain, phone, street_address, city,
      state_or_region, country, is_primary, status, gbp_place_id,
      primary_market_id, page_target_path, page_target_keyword_id,
      created_at, updated_at
    ) VALUES (
      @id, @workspace_id, @name, @domain, @phone, @street_address, @city,
      @state_or_region, @country, @is_primary, @status, @gbp_place_id,
      @primary_market_id, @page_target_path, @page_target_keyword_id,
      @created_at, @updated_at
    )
  `),
  update: db.prepare(`
    UPDATE client_locations
    SET name = @name,
      domain = @domain,
      phone = @phone,
      street_address = @street_address,
      city = @city,
      state_or_region = @state_or_region,
      country = @country,
      is_primary = @is_primary,
      status = @status,
      gbp_place_id = @gbp_place_id,
      primary_market_id = @primary_market_id,
      page_target_path = @page_target_path,
      page_target_keyword_id = @page_target_keyword_id,
      updated_at = @updated_at
    WHERE id = @id AND workspace_id = @workspace_id
  `),
  deleteById: db.prepare(`
    DELETE FROM client_locations
    WHERE id = ? AND workspace_id = ?
  `),
  count: db.prepare(`
    SELECT COUNT(*) AS count FROM client_locations
    WHERE workspace_id = ?
  `),
}));

function rowToLocation(row: LocationRow): ClientLocation {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    domain: row.domain ?? undefined,
    phone: row.phone ?? undefined,
    streetAddress: row.street_address ?? undefined,
    city: row.city ?? undefined,
    stateOrRegion: row.state_or_region ?? undefined,
    country: row.country ?? undefined,
    isPrimary: row.is_primary === 1,
    status: (Object.values(CLIENT_LOCATION_STATUS) as string[]).includes(row.status)
      ? row.status as ClientLocation['status']
      : CLIENT_LOCATION_STATUS.NEEDS_REVIEW,
    gbpPlaceId: row.gbp_place_id ?? undefined,
    primaryMarketId: row.primary_market_id ?? undefined,
    pageTargetPath: row.page_target_path ?? undefined,
    pageTargetKeywordId: row.page_target_keyword_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getClientLocations(workspaceId: string): ClientLocation[] {
  return (stmts().list.all(workspaceId) as LocationRow[]).map(rowToLocation);
}

export function getClientLocationById(id: string, workspaceId: string): ClientLocation | undefined {
  const row = stmts().getById.get(id, workspaceId) as LocationRow | undefined;
  return row ? rowToLocation(row) : undefined;
}

export interface CreateClientLocationInput {
  name: string;
  domain?: string;
  phone?: string;
  streetAddress?: string;
  city?: string;
  stateOrRegion?: string;
  country?: string;
  isPrimary?: boolean;
  status?: ClientLocation['status'];
  gbpPlaceId?: string;
}

export function createClientLocation(workspaceId: string, input: CreateClientLocationInput): ClientLocation {
  const now = new Date().toISOString();
  const id = randomUUID();
  stmts().insert.run({
    id,
    workspace_id: workspaceId,
    name: input.name,
    domain: input.domain || null,
    phone: input.phone || null,
    street_address: input.streetAddress || null,
    city: input.city || null,
    state_or_region: input.stateOrRegion || null,
    country: input.country || null,
    is_primary: input.isPrimary ? 1 : 0,
    status: input.status ?? 'needs_review',
    gbp_place_id: input.gbpPlaceId || null,
    primary_market_id: null,
    page_target_path: null,
    page_target_keyword_id: null,
    created_at: now,
    updated_at: now,
  });
  const location = getClientLocationById(id, workspaceId);
  if (!location) throw new Error('Client location insert failed');
  return location;
}

export interface UpdateClientLocationInput {
  name?: string;
  domain?: string;
  phone?: string;
  streetAddress?: string;
  city?: string;
  stateOrRegion?: string;
  country?: string;
  isPrimary?: boolean;
  status?: ClientLocation['status'];
  gbpPlaceId?: string;
}

function nullableString(value: string | undefined, fallback: string | undefined): string | null {
  if (value !== undefined) return value || null;
  return fallback ?? null;
}

export function updateClientLocation(
  id: string,
  workspaceId: string,
  input: UpdateClientLocationInput,
): ClientLocation | null {
  const existing = getClientLocationById(id, workspaceId);
  if (!existing) return null;
  stmts().update.run({
    id,
    workspace_id: workspaceId,
    name: input.name ?? existing.name,
    domain: nullableString(input.domain, existing.domain),
    phone: nullableString(input.phone, existing.phone),
    street_address: nullableString(input.streetAddress, existing.streetAddress),
    city: nullableString(input.city, existing.city),
    state_or_region: nullableString(input.stateOrRegion, existing.stateOrRegion),
    country: nullableString(input.country, existing.country),
    is_primary: (input.isPrimary ?? existing.isPrimary) ? 1 : 0,
    status: input.status ?? existing.status,
    gbp_place_id: nullableString(input.gbpPlaceId, existing.gbpPlaceId),
    primary_market_id: existing.primaryMarketId ?? null,
    page_target_path: existing.pageTargetPath ?? null,
    page_target_keyword_id: existing.pageTargetKeywordId ?? null,
    updated_at: new Date().toISOString(),
  });
  return getClientLocationById(id, workspaceId) ?? null;
}

export function deleteClientLocation(id: string, workspaceId: string): boolean {
  const info = stmts().deleteById.run(id, workspaceId);
  return info.changes > 0;
}

export function countClientLocations(workspaceId: string): number {
  const row = stmts().count.get(workspaceId) as { count: number };
  return row.count;
}
