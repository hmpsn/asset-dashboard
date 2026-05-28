import { z } from '../middleware/validate.js';
import {
  EEAT_ASSET_TYPE,
} from '../../shared/types/eeat-assets.js';

export const eeatAssetMetadataSchema = z.object({
  attributionName: z.string().max(160).optional(),
  attributionRole: z.string().max(160).optional(),
  sourceName: z.string().max(160).optional(),
  sourceUrl: z.string().url().max(400).optional(),
  credentialIssuer: z.string().max(160).optional(),
  credentialId: z.string().max(120).optional(),
  expertiseAreas: z.array(z.string().max(120)).max(20).optional(),
  serviceTypes: z.array(z.string().max(120)).max(20).optional(),
  locations: z.array(z.string().max(120)).max(20).optional(),
  metricLabel: z.string().max(120).optional(),
  metricValue: z.string().max(120).optional(),
  metricUnit: z.string().max(80).optional(),
  evidenceDate: z.string().max(40).optional(),
  associatedPagePaths: z.array(z.string().max(240)).max(50).optional(),
  tags: z.array(z.string().max(80)).max(25).optional(),
}).strict();

export const eeatAssetTypeSchema = z.enum([
  EEAT_ASSET_TYPE.TESTIMONIAL,
  EEAT_ASSET_TYPE.CASE_STUDY,
  EEAT_ASSET_TYPE.CREDENTIAL,
  EEAT_ASSET_TYPE.BEFORE_AFTER_GALLERY,
  EEAT_ASSET_TYPE.TEAM_BIO,
  EEAT_ASSET_TYPE.AWARD,
  EEAT_ASSET_TYPE.RESEARCH,
  EEAT_ASSET_TYPE.CLIENT_LOGO,
]);

export const createEeatAssetSchema = z.object({
  type: eeatAssetTypeSchema,
  title: z.string().trim().min(1).max(240),
  url: z.string().trim().url().max(400).optional().or(z.literal('')),
  content: z.string().trim().max(6000).optional().or(z.literal('')),
  metadata: eeatAssetMetadataSchema.optional(),
}).strict();

export const updateEeatAssetSchema = z.object({
  type: eeatAssetTypeSchema.optional(),
  title: z.string().trim().min(1).max(240).optional(),
  url: z.string().trim().url().max(400).optional().or(z.literal('')),
  content: z.string().trim().max(6000).optional().or(z.literal('')),
  metadata: eeatAssetMetadataSchema.optional(),
}).strict();

export type CreateEeatAssetInput = z.infer<typeof createEeatAssetSchema>;
export type UpdateEeatAssetInput = z.infer<typeof updateEeatAssetSchema>;
