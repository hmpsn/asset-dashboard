/**
 * Fetch the published HTML of a URL. Returns null on network failure or non-OK response.
 * Lives outside seo-audit.ts to avoid link-checker/seo-audit circular imports.
 */
export async function fetchPublishedHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
}
