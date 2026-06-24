-- SEO Decision Engine P4: workspace-level SERP target geo, decoupled from the local
-- SEO primary-market table. Nullable JSON blob {locationCode:number, languageCode:string,
-- countryCode?:string, label?:string}. Absent = resolveWorkspaceTargetGeo() falls back to
-- the local primary market, then US/'en'. parseJsonSafe (targetGeoSchema) at the read boundary.
-- Threaded through the DataForSEO domain/keyword methods only when the geo-targeting flag is ON.
ALTER TABLE workspaces ADD COLUMN target_geo TEXT;
