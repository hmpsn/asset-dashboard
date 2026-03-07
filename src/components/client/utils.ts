/** Rewrite webflow.io URLs to live domain, or show just the path */
export function toLiveUrl(url: string, liveDomain?: string): string {
  if (!url) return url;
  if (liveDomain) {
    return url.replace(/https?:\/\/[^/]+\.webflow\.io/, liveDomain.replace(/\/$/, ''));
  }
  // No live domain — strip the staging domain and show just the path
  try {
    const path = new URL(url).pathname;
    return path || '/';
  } catch {
    return url.replace(/https?:\/\/[^/]+/, '') || '/';
  }
}
