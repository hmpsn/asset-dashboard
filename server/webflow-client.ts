/**
 * Shared Webflow API client helpers.
 * Used by webflow-assets, webflow-pages, and webflow-cms sub-modules.
 */

const WEBFLOW_API = 'https://api.webflow.com/v2';

export function getToken(): string | null {
  return process.env.WEBFLOW_API_TOKEN || null;
}

export async function webflowFetch(endpoint: string, options: RequestInit = {}, tokenOverride?: string): Promise<Response> {
  const token = tokenOverride || getToken();
  if (!token) throw new Error('WEBFLOW_API_TOKEN not configured');

  return fetch(`${WEBFLOW_API}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}
