import type { Express } from 'express';
import contentRequestsRoutes from '../routes/content-requests.js';
import contentBriefsRoutes from '../routes/content-briefs.js';
import contentPostsRoutes from '../routes/content-posts.js';
import contentDecayRoutes from '../routes/content-decay.js';
import contentPublishRoutes from '../routes/content-publish.js';
import contentSubscriptionRoutes from '../routes/content-subscriptions.js';
import contentTemplatesRoutes from '../routes/content-templates.js';
import contentMatricesRoutes from '../routes/content-matrices.js';
import contentPlanReviewRoutes from '../routes/content-plan-review.js';

export function registerContentRoutes(app: Express): void {
  app.use(contentRequestsRoutes);
  app.use(contentBriefsRoutes);
  app.use(contentPostsRoutes);
  app.use(contentDecayRoutes);
  app.use(contentPublishRoutes);
  app.use(contentSubscriptionRoutes);
  app.use(contentTemplatesRoutes);
  app.use(contentMatricesRoutes);
  app.use(contentPlanReviewRoutes);
}
