export async function assembleSiteInventory(
  workspaceId: string,
  siteId: string,
  baseUrl: string,
  tokenOverride?: string,
) {
  const [{ buildSiteInventory }, { getWorkspacePages }, { getWorkspace }] = await Promise.all([
    import('../schema/site-inventory.js'),
    import('../workspace-data.js'),
    import('../workspaces.js'),
  ]);
  const pages = await getWorkspacePages(workspaceId, siteId);
  const workspace = getWorkspace(workspaceId);
  return buildSiteInventory({
    siteId,
    baseUrl,
    pages,
    tokenOverride,
    businessProfile: workspace?.businessProfile ?? null,
  });
}
