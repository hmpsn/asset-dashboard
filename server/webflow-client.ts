/**
 * Shared Webflow API client helpers.
 * Used by webflow-assets, webflow-pages, and webflow-cms sub-modules.
 */

const WEBFLOW_API = 'https://api.webflow.com/v2';

export type WebflowResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; errorText: string };

export type WebflowMutationResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; errorText: string };

interface PaginateWebflowOptions<TPage, TItem> {
  buildEndpoint: (offset: number, limit: number) => string;
  extractItems: (page: TPage) => TItem[] | undefined;
  getTotal?: (page: TPage) => number | undefined;
  tokenOverride?: string;
  limit?: number;
  advanceBy?: 'items-length' | 'page-size';
}

export function getToken(): string | null {
  return process.env.WEBFLOW_API_TOKEN || null;
}

export async function webflowFetch(endpoint: string, options: RequestInit = {}, tokenOverride?: string): Promise<Response> {
  const token = tokenOverride || getToken();
  if (!token) throw new Error('WEBFLOW_API_TOKEN not configured');

  const mergedHeaders = new Headers({
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  });
  const incomingHeaders = new Headers(options.headers);
  incomingHeaders.forEach((value, key) => {
    mergedHeaders.set(key, value);
  });

  return fetch(`${WEBFLOW_API}${endpoint}`, {
    ...options,
    headers: mergedHeaders,
  });
}

export async function webflowJson<T>(
  endpoint: string,
  options: RequestInit = {},
  tokenOverride?: string,
): Promise<WebflowResult<T>> {
  const res = await webflowFetch(endpoint, options, tokenOverride);
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      errorText: await res.text(),
    };
  }
  return { ok: true, data: await res.json() as T };
}

export async function webflowMutation<T = undefined>(
  endpoint: string,
  options: RequestInit,
  tokenOverride?: string,
  parse: 'json' | 'none' = 'none',
): Promise<WebflowMutationResult<T>> {
  const res = await webflowFetch(endpoint, options, tokenOverride);
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      errorText: await res.text(),
    };
  }

  if (parse === 'none') {
    return { ok: true, data: undefined as T };
  }

  return { ok: true, data: await res.json() as T };
}

export async function paginateWebflow<TPage, TItem>({
  buildEndpoint,
  extractItems,
  getTotal,
  tokenOverride,
  limit = 100,
  advanceBy = 'page-size',
}: PaginateWebflowOptions<TPage, TItem>): Promise<TItem[]> {
  const allItems: TItem[] = [];
  let offset = 0;

  while (true) {
    const result = await webflowJson<TPage>(buildEndpoint(offset, limit), {}, tokenOverride);
    if (!result.ok) break;

    const items = extractItems(result.data) || [];
    allItems.push(...items);

    if (items.length === 0) break;

    offset += advanceBy === 'items-length' ? items.length : limit;

    const total = getTotal?.(result.data);
    if (typeof total === 'number') {
      if (offset >= total) break;
      continue;
    }

    if (items.length < limit) break;
  }

  return allItems;
}
