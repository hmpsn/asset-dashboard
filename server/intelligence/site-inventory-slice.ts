export async function assembleSiteInventory(
  workspaceId: string,
  siteId: string,
  baseUrl: string,
  tokenOverride?: string,
) {
  const [{ buildSiteInventory }, { getWorkspaceAllPages }, { getWorkspace }, { discoverSitemapUrls, resolveStaticPagePathsFromSitemap }] = await Promise.all([
    import('../schema/site-inventory.js'),
    import('../workspace-data.js'),
    import('../workspaces.js'),
    import('../webflow.js'),
  ]);
  const rawPages = await getWorkspaceAllPages(workspaceId, siteId);
  const sitemapUrls = rawPages.length > 0 ? await discoverSitemapUrls(baseUrl) : [];
  const pages = resolveStaticPagePathsFromSitemap(rawPages, sitemapUrls, baseUrl);
  const workspace = getWorkspace(workspaceId);
  return buildSiteInventory({
    siteId,
    baseUrl,
    pages,
    tokenOverride,
    businessProfile: workspace?.businessProfile ?? null,
  });
}
