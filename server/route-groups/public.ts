import type { Express } from 'express';
import publicPortalRoutes from '../routes/public-portal.js';
import publicAuthRoutes from '../routes/public-auth.js';
import publicContentRoutes from '../routes/public-content.js';
import publicAnalyticsRoutes from '../routes/public-analytics.js';
import publicChatRoutes from '../routes/public-chat.js';
import publicRequestsRoutes from '../routes/public-requests.js';
import clientIntelligenceRoutes from '../routes/client-intelligence.js';
import publicFeedbackRoutes from '../routes/public-feedback.js';

export function registerPublicRoutes(app: Express): void {
  app.use(publicPortalRoutes);
  app.use(publicAuthRoutes);
  app.use(publicContentRoutes);
  app.use(publicAnalyticsRoutes);
  app.use(publicChatRoutes);
  app.use(publicRequestsRoutes);
  app.use(clientIntelligenceRoutes);
  app.use(publicFeedbackRoutes);
}
