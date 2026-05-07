import type { Express } from 'express';
import webflowRoutes from '../routes/webflow.js';
import webflowAuditRoutes from '../routes/webflow-audit.js';
import webflowKeywordsRoutes from '../routes/webflow-keywords.js';
import webflowAltTextRoutes from '../routes/webflow-alt-text.js';
import webflowOrganizeRoutes from '../routes/webflow-organize.js';
import webflowCmsRoutes from '../routes/webflow-cms.js';
import webflowCmsImagesRoutes from '../routes/webflow-cms-images.js';
import webflowSeoAuditRoutes from '../routes/webflow-seo-audit.js';
import webflowSeoApplyRoutes from '../routes/webflow-seo-apply.js';
import webflowSeoBulkRewriteRoutes from '../routes/webflow-seo-bulk-rewrite.js';
import webflowSeoJobRoutes from '../routes/webflow-seo-jobs.js';
import webflowSeoPageToolsRoutes from '../routes/webflow-seo-page-tools.js';
import webflowSeoRewriteRoutes from '../routes/webflow-seo-rewrite.js';
import webflowSeoSuggestionsRoutes from '../routes/webflow-seo-suggestions.js';
import webflowSchemaRoutes from '../routes/webflow-schema.js';
import webflowPagespeedRoutes from '../routes/webflow-pagespeed.js';
import webflowAnalysisRoutes from '../routes/webflow-analysis.js';

export function registerWebflowRoutes(app: Express): void {
  app.use(webflowRoutes);
  app.use(webflowAuditRoutes);
  app.use(webflowKeywordsRoutes);
  app.use(webflowAltTextRoutes);
  app.use(webflowOrganizeRoutes);
  app.use(webflowCmsRoutes);
  app.use(webflowCmsImagesRoutes);
  app.use(webflowSeoAuditRoutes);
  app.use(webflowSeoPageToolsRoutes);
  app.use(webflowSeoRewriteRoutes);
  app.use(webflowSeoBulkRewriteRoutes);
  app.use(webflowSeoApplyRoutes);
  app.use(webflowSeoSuggestionsRoutes);
  app.use(webflowSeoJobRoutes);
  app.use(webflowSchemaRoutes);
  app.use(webflowPagespeedRoutes);
  app.use(webflowAnalysisRoutes);
}
