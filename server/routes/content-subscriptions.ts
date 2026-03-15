/**
 * Content Subscriptions API routes.
 *
 * Admin endpoints for managing recurring content packages per workspace.
 * Client endpoints for viewing subscription status and available plans.
 */
import { Router } from 'express';
import {
  createContentSubscription, listContentSubscriptions,
  getContentSubscription, updateContentSubscription,
  deleteContentSubscription, incrementDeliveredPosts,
} from '../content-subscriptions.js';
import { createCheckoutSession } from '../stripe.js';
import { CONTENT_SUB_PLANS, type ContentSubPlan } from '../../shared/types/content.js';
import { createLogger } from '../logger.js';

const log = createLogger('routes:content-subscriptions');
const router = Router();

// ── Admin endpoints ──

// List all subscriptions for a workspace
router.get('/api/content-subscriptions/:workspaceId', (req, res) => {
  try {
    const subs = listContentSubscriptions(req.params.workspaceId);
    res.json(subs);
  } catch (err) {
    log.error({ err }, 'Failed to list content subscriptions');
    res.status(500).json({ error: 'Failed to list subscriptions' });
  }
});

// Get a single subscription
router.get('/api/content-subscription/:id', (req, res) => {
  try {
    const sub = getContentSubscription(req.params.id);
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });
    res.json(sub);
  } catch (err) {
    log.error({ err }, 'Failed to get content subscription');
    res.status(500).json({ error: 'Failed to get subscription' });
  }
});

// Create a subscription manually (admin-initiated, no Stripe)
router.post('/api/content-subscriptions/:workspaceId', (req, res) => {
  try {
    const { plan, topicSource, preferredPageTypes, notes } = req.body;
    const planConfig = CONTENT_SUB_PLANS.find(p => p.plan === plan);
    if (!planConfig) return res.status(400).json({ error: `Invalid plan: ${plan}` });

    const sub = createContentSubscription(req.params.workspaceId, {
      plan: planConfig.plan,
      postsPerMonth: planConfig.postsPerMonth,
      priceUsd: planConfig.priceUsd,
      topicSource: topicSource || 'strategy_gaps',
      preferredPageTypes,
      notes,
      status: 'active',
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    res.json(sub);
  } catch (err) {
    log.error({ err }, 'Failed to create content subscription');
    res.status(500).json({ error: 'Failed to create subscription' });
  }
});

// Update a subscription (admin)
router.patch('/api/content-subscription/:id', (req, res) => {
  try {
    const { status, plan, topicSource, preferredPageTypes, notes } = req.body;
    const updates: Record<string, unknown> = {};
    if (status) updates.status = status;
    if (topicSource) updates.topicSource = topicSource;
    if (preferredPageTypes !== undefined) updates.preferredPageTypes = preferredPageTypes;
    if (notes !== undefined) updates.notes = notes;

    // If changing plan, update postsPerMonth and priceUsd
    if (plan) {
      const planConfig = CONTENT_SUB_PLANS.find(p => p.plan === plan);
      if (!planConfig) return res.status(400).json({ error: `Invalid plan: ${plan}` });
      updates.plan = planConfig.plan;
      updates.postsPerMonth = planConfig.postsPerMonth;
      updates.priceUsd = planConfig.priceUsd;
    }

    const sub = updateContentSubscription(req.params.id, updates);
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });
    res.json(sub);
  } catch (err) {
    log.error({ err }, 'Failed to update content subscription');
    res.status(500).json({ error: 'Failed to update subscription' });
  }
});

// Delete a subscription (admin)
router.delete('/api/content-subscription/:id', (req, res) => {
  try {
    const ok = deleteContentSubscription(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Subscription not found' });
    res.json({ ok: true });
  } catch (err) {
    log.error({ err }, 'Failed to delete content subscription');
    res.status(500).json({ error: 'Failed to delete subscription' });
  }
});

// Increment delivered posts count (admin — when a post is delivered)
router.post('/api/content-subscription/:id/delivered', (req, res) => {
  try {
    const count = req.body.count || 1;
    incrementDeliveredPosts(req.params.id, count);
    const sub = getContentSubscription(req.params.id);
    res.json(sub);
  } catch (err) {
    log.error({ err }, 'Failed to increment delivered posts');
    res.status(500).json({ error: 'Failed to update delivery count' });
  }
});

// ── Client endpoints (public) ──

// Get available content plans
router.get('/api/public/content-plans', (_req, res) => {
  res.json(CONTENT_SUB_PLANS);
});

// Get subscription status for a workspace (client-facing)
router.get('/api/public/content-subscription/:workspaceId', (req, res) => {
  try {
    const subs = listContentSubscriptions(req.params.workspaceId);
    // Return only the active/pending one (most recent)
    const active = subs.find(s => s.status === 'active' || s.status === 'pending' || s.status === 'past_due');
    res.json({ subscription: active || null, plans: CONTENT_SUB_PLANS });
  } catch (err) {
    log.error({ err }, 'Failed to get client content subscription');
    res.status(500).json({ error: 'Failed to get subscription' });
  }
});

// Client checkout for a content subscription
router.post('/api/public/content-subscribe/:workspaceId', async (req, res) => {
  try {
    const { plan } = req.body as { plan: ContentSubPlan };
    const planConfig = CONTENT_SUB_PLANS.find(p => p.plan === plan);
    if (!planConfig) return res.status(400).json({ error: `Invalid plan: ${plan}` });

    const origin = `${req.protocol}://${req.get('host')}`;
    const { sessionId, url } = await createCheckoutSession({
      workspaceId: req.params.workspaceId,
      productType: plan,
      successUrl: `${origin}/client/${req.params.workspaceId}/plans?subscribed=true`,
      cancelUrl: `${origin}/client/${req.params.workspaceId}/plans`,
    });

    res.json({ sessionId, url });
  } catch (err) {
    log.error({ err }, 'Failed to create content subscription checkout');
    const msg = err instanceof Error ? err.message : 'Failed to start checkout';
    res.status(500).json({ error: msg });
  }
});

export default router;
