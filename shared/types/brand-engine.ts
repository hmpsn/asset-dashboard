// shared/types/brand-engine.ts

// ═══ BRANDSCRIPT ═══

export interface BrandscriptTemplate {
  id: string;
  name: string;
  description?: string;
  sections: { title: string; purpose: string }[];
  createdAt: string;
}

export interface BrandscriptSection {
  id: string;
  brandscriptId: string;
  title: string;
  purpose?: string;
  content?: string;
  sortOrder: number;
  createdAt: string;
}

export interface Brandscript {
  id: string;
  workspaceId: string;
  name: string;
  frameworkType: string;
  sections: BrandscriptSection[];
  createdAt: string;
  updatedAt: string;
}

// ═══ DISCOVERY INGESTION ═══

export type SourceType = 'transcript' | 'brand_doc' | 'competitor' | 'existing_copy' | 'website_crawl';
export type ExtractionType = 'voice_pattern' | 'story_element';
export type ExtractionCategory =
  | 'signature_phrase' | 'vocabulary' | 'tone_marker' | 'metaphor' | 'sentence_pattern'
  | 'origin_story' | 'customer_problem' | 'solution_framing' | 'authority_marker'
  | 'empathy_signal' | 'success_story' | 'values_in_action';
export type Confidence = 'high' | 'medium' | 'low';
export type ExtractionStatus = 'pending' | 'accepted' | 'dismissed';
export type ExtractionDestination = 'voice_profile' | 'brandscript' | 'identity';

export interface DiscoverySource {
  id: string;
  workspaceId: string;
  filename: string;
  sourceType: SourceType;
  rawContent: string;
  processedAt?: string;
  createdAt: string;
}

export interface DiscoveryExtraction {
  id: string;
  sourceId: string;
  workspaceId: string;
  extractionType: ExtractionType;
  category: ExtractionCategory;
  content: string;
  sourceQuote?: string;
  confidence: Confidence;
  status: ExtractionStatus;
  routedTo?: ExtractionDestination;
  createdAt: string;
}

// ═══ VOICE CALIBRATION ═══

export type VoiceProfileStatus = 'draft' | 'calibrating' | 'calibrated';
export type VoiceSampleContext = 'headline' | 'body' | 'cta' | 'about' | 'service' | 'social' | 'seo';

/**
 * Voice sample source enum — includes forward-compatible values for Phase 3.
 * Phase 1 produces: manual, transcript_extraction, calibration_loop, identity_approved
 * Phase 3 produces: copy_approved (approved copy sections become training samples)
 */
export type VoiceSampleSource =
  | 'manual'
  | 'transcript_extraction'
  | 'calibration_loop'
  | 'identity_approved'    // Phase 1: approved taglines/pitches become samples
  | 'copy_approved';       // Phase 3: approved copy sections become samples

// ═══ CONTEXT EMPHASIS (for seo-context.ts builders) ═══
/**
 * Controls verbosity of brand context injected into AI prompts.
 * Phase 1 callers default to 'full'. Phase 3 uses 'summary'/'minimal' for smart context selection.
 */
export type ContextEmphasis = 'full' | 'summary' | 'minimal';

// ═══ PROMPT TYPE → SECTION TYPE MAPPING ═══
/**
 * Maps Phase 1 calibration prompt types to Phase 2 section types.
 * Phase 3 uses this to find the best-rated calibration output per section type.
 */
export const PROMPT_TYPE_TO_SECTION_TYPE: Record<string, string> = {
  'hero_headline': 'hero',
  'about_intro': 'about-team',
  'service_body': 'features-benefits',
  'cta_copy': 'cta',
  'faq_answer': 'faq',
  'testimonial_copy': 'testimonials',
  'blog_intro': 'content-body',
  'meta_description': 'seo-meta',
};

export interface ToneSpectrum {
  formal_casual: number;       // 1-10 scale, 10 = most casual
  serious_playful: number;
  technical_accessible: number;
}

export interface VoiceDNA {
  personalityTraits: string[];   // e.g., "Witty but never sarcastic"
  toneSpectrum: ToneSpectrum;
  sentenceStyle: string;         // e.g., "Short punchy lines with occasional longer payoff"
  vocabularyLevel: string;       // e.g., "Conversational, 8th grade reading level"
  humorStyle: string;            // e.g., "Self-deprecating, observational"
}

export interface VoiceGuardrails {
  forbiddenWords: string[];
  requiredTerminology: { use: string; insteadOf: string }[];
  toneBoundaries: string[];
  antiPatterns: string[];
}

export interface ContextModifier {
  context: string;       // e.g., "Headlines & CTAs"
  description: string;   // e.g., "Maximum personality. Punchy. Humor welcome."
}

export interface VoiceProfile {
  id: string;
  workspaceId: string;
  status: VoiceProfileStatus;
  voiceDNA?: VoiceDNA;
  guardrails?: VoiceGuardrails;
  contextModifiers?: ContextModifier[];
  /** Samples are loaded alongside the profile — add samples: VoiceSample[] if getVoiceProfile joins them */
  samples?: VoiceSample[];
  createdAt: string;
  updatedAt: string;
}

export interface VoiceSample {
  id: string;
  voiceProfileId: string;
  content: string;
  contextTag?: VoiceSampleContext;
  source?: VoiceSampleSource;
  sortOrder?: number;
  createdAt: string;
}

export type CalibrationRating = 'on_brand' | 'close' | 'wrong';

export interface CalibrationVariation {
  text: string;
  rating?: CalibrationRating;
  feedback?: string;
}

export interface CalibrationSession {
  id: string;
  voiceProfileId: string;
  promptType: string;
  variations: CalibrationVariation[];
  steeringNotes?: string;
  createdAt: string;
}

// ═══ BRAND IDENTITY ═══

export type DeliverableType =
  | 'mission' | 'vision' | 'values' | 'tagline' | 'elevator_pitch'
  | 'archetypes' | 'personality_traits' | 'voice_guidelines' | 'tone_examples'
  | 'messaging_pillars' | 'differentiators' | 'positioning_matrix' | 'brand_story'
  | 'personas' | 'customer_journey' | 'objection_handling' | 'emotional_triggers';

export type DeliverableTier = 'essentials' | 'professional' | 'premium';
export type DeliverableStatus = 'draft' | 'approved';

export interface BrandDeliverable {
  id: string;
  workspaceId: string;
  deliverableType: DeliverableType;
  content: string;
  status: DeliverableStatus;
  version: number;
  tier: DeliverableTier;
  createdAt: string;
  updatedAt: string;
}

export interface DeliverableVersion {
  id: string;
  deliverableId: string;
  content: string;
  steeringNotes?: string;
  version: number;
  createdAt: string;
}

// ═══ DELIVERABLE TIER CONFIG ═══

export const DEFAULT_TIER_MAP: Record<DeliverableType, DeliverableTier> = {
  mission: 'essentials',
  vision: 'essentials',
  values: 'essentials',
  tagline: 'essentials',
  voice_guidelines: 'essentials',
  elevator_pitch: 'professional',
  archetypes: 'professional',
  personality_traits: 'professional',
  messaging_pillars: 'professional',
  differentiators: 'professional',
  tone_examples: 'professional',
  positioning_matrix: 'premium',
  brand_story: 'premium',
  personas: 'premium',
  customer_journey: 'premium',
  objection_handling: 'premium',
  emotional_triggers: 'premium',
};
