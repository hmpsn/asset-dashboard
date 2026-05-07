import type { VoiceDNA, VoiceGuardrails, VoiceSampleContext } from '../../../../shared/types/brand-engine';
import { PROMPT_TYPE_TO_SECTION_TYPE } from '../../../../shared/types/brand-engine';

export const CONTEXT_TAG_OPTIONS: { value: VoiceSampleContext; label: string }[] = [
  { value: 'headline', label: 'Headline' },
  { value: 'body', label: 'Body' },
  { value: 'cta', label: 'CTA' },
  { value: 'about', label: 'About' },
  { value: 'service', label: 'Service' },
  { value: 'social', label: 'Social' },
  { value: 'seo', label: 'SEO' },
];

export const PROMPT_TYPE_OPTIONS = Object.keys(PROMPT_TYPE_TO_SECTION_TYPE);

export const PROMPT_TYPE_TO_CONTEXT: Record<string, VoiceSampleContext | undefined> = {
  hero_headline: 'headline',
  about_intro: 'about',
  service_body: 'service',
  cta_copy: 'cta',
  faq_answer: undefined,
  testimonial_copy: undefined,
  blog_intro: 'body',
  meta_description: 'seo',
};

export const CONTEXT_TAG_COLORS: Record<VoiceSampleContext, string> = {
  headline: 'bg-teal-500/10 text-teal-400',
  body: 'bg-blue-500/10 text-blue-400',
  cta: 'bg-emerald-500/10 text-emerald-400',
  about: 'bg-[var(--surface-3)] text-[var(--brand-text)]',
  service: 'bg-[var(--surface-3)] text-[var(--brand-text)]',
  social: 'bg-[var(--surface-3)] text-[var(--brand-text)]',
  seo: 'bg-[var(--surface-3)] text-[var(--brand-text)]',
};

export const defaultDNA: VoiceDNA = {
  personalityTraits: [],
  toneSpectrum: { formal_casual: 5, serious_playful: 5, technical_accessible: 5 },
  sentenceStyle: '',
  vocabularyLevel: '',
  humorStyle: '',
};

export const defaultGuardrails: VoiceGuardrails = {
  forbiddenWords: [],
  requiredTerminology: [],
  toneBoundaries: [],
  antiPatterns: [],
};

function normalizeValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizedKey(value: string): string {
  return normalizeValue(value).toLowerCase();
}

export function appendUniqueListValue(list: string[], rawValue: string): { next: string[]; added: boolean } {
  const normalized = normalizeValue(rawValue);
  if (!normalized) {
    return { next: list, added: false };
  }

  const exists = list.some(item => normalizedKey(item) === normalized.toLowerCase());
  if (exists) {
    return { next: list, added: false };
  }

  return {
    next: [...list, normalized],
    added: true,
  };
}

export function appendUniqueRequiredTerminology(
  list: VoiceGuardrails['requiredTerminology'],
  rawUse: string,
  rawInsteadOf: string
): { next: VoiceGuardrails['requiredTerminology']; added: boolean } {
  const use = normalizeValue(rawUse);
  const insteadOf = normalizeValue(rawInsteadOf);
  if (!use || !insteadOf) {
    return { next: list, added: false };
  }

  const useKey = use.toLowerCase();
  const insteadOfKey = insteadOf.toLowerCase();
  const exists = list.some(term => normalizedKey(term.use) === useKey && normalizedKey(term.insteadOf) === insteadOfKey);
  if (exists) {
    return { next: list, added: false };
  }

  return {
    next: [...list, { use, insteadOf }],
    added: true,
  };
}
