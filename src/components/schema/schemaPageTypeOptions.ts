import { SCHEMA_ROLE_LABELS, type SchemaPageRole } from '../../../shared/types/schema-plan';

export const SCHEMA_PAGE_ROLE_VALUES: SchemaPageRole[] = [
  'homepage',
  'pillar',
  'service',
  'audience',
  'lead-gen',
  'blog',
  'about',
  'contact',
  'location',
  'product',
  'partnership',
  'faq',
  'case-study',
  'comparison',
  'author',
  'howto',
  'video',
  'job-posting',
  'course',
  'event',
  'review',
  'pricing',
  'recipe',
  'generic',
];

const LEGACY_PAGE_TYPE_LABELS: Partial<Record<SchemaPageRole, string>> = {
  author: 'Author Profile',
};

export const SCHEMA_PAGE_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'auto', label: 'Auto-detect' },
  ...SCHEMA_PAGE_ROLE_VALUES.map(value => ({
    value,
    label: LEGACY_PAGE_TYPE_LABELS[value] ?? SCHEMA_ROLE_LABELS[value],
  })),
];
