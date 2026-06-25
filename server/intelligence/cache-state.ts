import type { WorkspaceIntelligence } from '../../shared/types/intelligence.js';
import { LRUCache } from '../intelligence-cache.js';

export const intelligenceCache = new LRUCache<WorkspaceIntelligence>(200);
export const INTELLIGENCE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
