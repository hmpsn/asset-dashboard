import type { Express } from 'express';
import webflowRoutes from '../routes/webflow.js';
import webflowAuditRoutes from '../routes/webflow-audit.js';
import webflowKeywordsRoutes from '../routes/webflow-keywords.js';
import webflowAltTextRoutes from '../routes/webflow-alt-text.js';
import webflowOrganizeRoutes from '../routes/webflow-organize.js';
import webflowCmsRoutes from '../routes/webflow-cms.js';
import webflowCmsImagesRoutes from '../routes/webflow-cms-images.js';
import webflowSeoRoutes from '../routes/webflow-seo.js';
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
  app.use(webflowSeoRoutes);
  app.use(webflowSchemaRoutes);
  app.use(webflowPagespeedRoutes);
  app.use(webflowAnalysisRoutes);
}
