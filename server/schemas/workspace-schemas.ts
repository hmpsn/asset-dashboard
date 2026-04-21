/**
 * Zod schemas for workspace JSON columns.
 * Uses .passthrough() on all object schemas for forward compatibility.
 */
import { z } from 'zod';

// ── Event config ──

export const eventDisplayConfigSchema = z.object({
  eventName: z.string(),
  displayName: z.string(),
  pinned: z.boolean(),
  group: z.string().optional(),
}).passthrough();

export const eventDisplayConfigArraySchema = z.array(eventDisplayConfigSchema);

export const eventGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  order: z.number(),
  color: z.string(),
  defaultPageFilter: z.string().optional(),
  allowedPages: z.array(z.string()).optional(),
}).passthrough();

export const eventGroupArraySchema = z.array(eventGroupSchema);

// ── Keyword strategy ──

export const pageKeywordMapSchema = z.object({
  pagePath: z.string(),
  pageTitle: z.string(),
  primaryKeyword: z.string(),
  secondaryKeywords: z.array(z.string()),
}).passthrough();

// NOTE: pageMap is stored in a separate page_keywords table and stripped from this
// column before saving. It is reassembled at the route layer. Mark optional so
// parseJsonSafe does not reject the stored blob and silently return the empty fallback.
export const keywordStrategySchema = z.object({
  siteKeywords: z.array(z.string()),
  pageMap: z.array(pageKeywordMapSchema).optional(),
  opportunities: z.array(z.string()),
  siteKeywordMetrics: z.array(z.object({
    keyword: z.string(),
    volume: z.number(),
    difficulty: z.number(),
  })).optional(),
  generatedAt: z.string().optional(),
}).passthrough();

// ── Personas ──

export const audiencePersonaSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  painPoints: z.array(z.string()),
  goals: z.array(z.string()),
  objections: z.array(z.string()),
  preferredContentFormat: z.string().optional(),
  buyingStage: z.enum(['awareness', 'consideration', 'decision']).optional(),
}).passthrough();

export const personasArraySchema = z.array(audiencePersonaSchema);

// ── Content pricing ──

export const contentPricingSchema = z.object({
  briefPrice: z.number(),
  fullPostPrice: z.number(),
  currency: z.string(),
  briefLabel: z.string().optional(),
  fullPostLabel: z.string().optional(),
  briefDescription: z.string().optional(),
  fullPostDescription: z.string().optional(),
}).passthrough();

// ── Portal contacts ──

export const portalContactSchema = z.object({
  email: z.string(),
  name: z.string().optional(),
  capturedAt: z.string(),
}).passthrough();

export const portalContactsArraySchema = z.array(portalContactSchema);

// ── Audit suppressions ──

export const auditSuppressionSchema = z.object({
  check: z.string(),
  pageSlug: z.string(),
  pagePattern: z.string().optional(),
  reason: z.string().optional(),
  createdAt: z.string(),
}).passthrough();

export const auditSuppressionsArraySchema = z.array(auditSuppressionSchema);

// ── Publish target ──

export const publishTargetSchema = z.object({
  collectionId: z.string(),
  collectionName: z.string(),
  fieldMap: z.object({
    title: z.string(),
    slug: z.string(),
    body: z.string(),
    metaTitle: z.string().optional(),
    metaDescription: z.string().optional(),
    summary: z.string().optional(),
    author: z.string().optional(),
    category: z.string().optional(),
    featuredImage: z.string().optional(),
    publishDate: z.string().optional(),
  }).passthrough(),
}).passthrough();

// ── Business profile ──

export const businessProfileSchema = z.object({
  phone: z.string().optional(),
  email: z.string().optional(),
  address: z.object({
    street: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
    country: z.string().optional(),
  }).passthrough().optional(),
}).passthrough();

// ── Intelligence profile (strategy context: industry, goals, target audience) ──

export const intelligenceProfileSchema = z.object({
  industry: z.string().optional(),
  goals: z.array(z.string()).optional(),
  targetAudience: z.string().optional(),
}).passthrough();

// ── Competitor domains (simple string array) ──

export const competitorDomainsSchema = z.array(z.string());
