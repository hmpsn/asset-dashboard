export interface ServiceDefinition {
  id: string;            // slug, e.g. 'general-dentistry'
  label: string;         // display label, e.g. 'General Dentistry'
  starterKeywords: string[]; // 3-5 starter tracking keywords
  matchTerms: string[];  // lowercase terms for coverage check (any tracked keyword containing one = covered)
}

export const DENTAL_SERVICES: ServiceDefinition[] = [
  {
    id: 'general-dentistry',
    label: 'General Dentistry',
    starterKeywords: ['dentist near me', 'family dentist', 'general dentist'],
    matchTerms: ['general dentist', 'family dentist', 'routine dental', 'dental checkup', 'teeth cleaning'],
  },
  {
    id: 'teeth-whitening',
    label: 'Teeth Whitening',
    starterKeywords: ['teeth whitening near me', 'professional teeth whitening', 'zoom whitening'],
    matchTerms: ['whitening', 'teeth bleaching'],
  },
  {
    id: 'dental-implants',
    label: 'Dental Implants',
    starterKeywords: ['dental implants near me', 'tooth implant cost', 'all on 4 implants'],
    matchTerms: ['implant', 'implants'],
  },
  {
    id: 'invisalign',
    label: 'Invisalign / Braces',
    starterKeywords: ['invisalign near me', 'clear braces', 'orthodontist near me'],
    matchTerms: ['invisalign', 'braces', 'orthodontic', 'aligner'],
  },
  {
    id: 'emergency-dental',
    label: 'Emergency Dental Care',
    starterKeywords: ['emergency dentist near me', 'same day dental appointment', 'toothache emergency'],
    matchTerms: ['emergency dent', 'same day dent', 'urgent dent', 'toothache'],
  },
  {
    id: 'cosmetic-dentistry',
    label: 'Cosmetic Dentistry',
    starterKeywords: ['cosmetic dentist near me', 'smile makeover', 'dental veneers'],
    matchTerms: ['cosmetic dent', 'smile makeover', 'veneer', 'smile design'],
  },
  {
    id: 'pediatric-dentistry',
    label: 'Pediatric Dentistry',
    starterKeywords: ['pediatric dentist near me', 'kids dentist', 'children dentist near me'],
    matchTerms: ['pediatric', 'kids dent', 'children dent', 'child dent'],
  },
  {
    id: 'root-canal',
    label: 'Root Canal Treatment',
    starterKeywords: ['root canal near me', 'root canal specialist', 'endodontist near me'],
    matchTerms: ['root canal', 'endodont'],
  },
  {
    id: 'dental-crowns',
    label: 'Crowns & Bridges',
    starterKeywords: ['dental crown near me', 'tooth crown cost', 'dental bridge near me'],
    matchTerms: ['crown', 'bridge', 'dental cap'],
  },
  {
    id: 'dentures',
    label: 'Dentures',
    starterKeywords: ['dentures near me', 'full dentures cost', 'partial dentures'],
    matchTerms: ['denture', 'false teeth', 'full mouth restoration'],
  },
  {
    id: 'gum-disease',
    label: 'Gum Disease Treatment',
    starterKeywords: ['gum disease treatment', 'periodontist near me', 'deep cleaning teeth'],
    matchTerms: ['gum disease', 'periodontal', 'deep cleaning', 'scaling root planing'],
  },
  {
    id: 'sleep-apnea',
    label: 'Sleep Apnea / Night Guards',
    starterKeywords: ['sleep apnea dentist', 'night guard for teeth grinding', 'TMJ treatment near me'],
    matchTerms: ['sleep apnea', 'night guard', 'tmj', 'teeth grinding', 'bruxism'],
  },
];

// Map industry → taxonomy. Extend as new industries are added.
const INDUSTRY_TAXONOMY: Record<string, ServiceDefinition[]> = {
  dental: DENTAL_SERVICES,
  dentistry: DENTAL_SERVICES,
};

/**
 * Returns the service taxonomy for a workspace industry string.
 * Returns null if no taxonomy is defined for this industry.
 */
export function getTaxonomyForIndustry(industry: string | undefined | null): ServiceDefinition[] | null {
  if (!industry) return null;
  const key = industry.toLowerCase().trim();
  for (const [pattern, taxonomy] of Object.entries(INDUSTRY_TAXONOMY)) {
    if (key.includes(pattern)) return taxonomy;
  }
  return null;
}
