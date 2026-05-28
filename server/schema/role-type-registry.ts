import type { PageKind } from './classifier.js';
import type { SchemaPageRole } from '../../shared/types/schema-plan.js';

export type SchemaPageType = 'auto' | SchemaPageRole;

export const PAGE_TYPE_LABELS: Record<SchemaPageType, string> = {
  auto: 'Auto-detect',
  homepage: 'Homepage',
  pillar: 'Pillar / Product Page',
  service: 'Service Page',
  audience: 'Audience / Use Case',
  'lead-gen': 'Lead-Gen / Conversion',
  blog: 'Blog Post',
  about: 'About / Team',
  contact: 'Contact',
  location: 'Location',
  product: 'Product',
  partnership: 'Partnership',
  faq: 'FAQ',
  'case-study': 'Case Study',
  comparison: 'Comparison',
  author: 'Author Profile',
  howto: 'How-To / Tutorial',
  video: 'Video Page',
  'job-posting': 'Job Posting',
  course: 'Course / Training',
  event: 'Event',
  review: 'Review',
  pricing: 'Pricing Page',
  recipe: 'Recipe',
  generic: 'General Page',
};

const ROLE_SCHEMA_TYPE_MAP: Record<SchemaPageRole, { primary: string[]; secondary: string[] }> = {
  homepage: { primary: ['Organization', 'WebSite'], secondary: [] },
  pillar: { primary: ['Article', 'CollectionPage'], secondary: ['Person', 'BreadcrumbList'] },
  service: { primary: ['Service'], secondary: ['Offer', 'BreadcrumbList'] },
  audience: { primary: ['WebPage'], secondary: ['BreadcrumbList'] },
  'lead-gen': { primary: ['WebPage'], secondary: ['BreadcrumbList'] },
  blog: { primary: ['BlogPosting'], secondary: ['Person', 'BreadcrumbList', 'speakable'] },
  about: { primary: ['AboutPage', 'Organization'], secondary: ['Person', 'BreadcrumbList'] },
  contact: { primary: ['ContactPage'], secondary: ['Organization', 'BreadcrumbList'] },
  location: { primary: ['LocalBusiness'], secondary: ['Place', 'GeoCoordinates', 'BreadcrumbList'] },
  product: { primary: ['Product'], secondary: ['Offer', 'AggregateRating', 'BreadcrumbList'] },
  partnership: { primary: ['WebPage'], secondary: ['Organization', 'BreadcrumbList'] },
  faq: { primary: ['FAQPage'], secondary: ['BreadcrumbList'] },
  'case-study': { primary: ['Article'], secondary: ['Person', 'CreativeWork', 'BreadcrumbList'] },
  comparison: { primary: ['WebPage'], secondary: ['ItemList', 'BreadcrumbList'] },
  author: { primary: ['Person', 'ProfilePage'], secondary: ['BreadcrumbList'] },
  howto: { primary: ['HowTo'], secondary: ['Article', 'BreadcrumbList'] },
  video: { primary: ['VideoObject'], secondary: ['Article', 'BreadcrumbList'] },
  'job-posting': { primary: ['JobPosting'], secondary: ['BreadcrumbList'] },
  course: { primary: ['Course'], secondary: ['CourseInstance', 'BreadcrumbList'] },
  event: { primary: ['Event'], secondary: ['Offer', 'Place', 'BreadcrumbList'] },
  review: { primary: ['Review'], secondary: ['AggregateRating', 'BreadcrumbList'] },
  pricing: { primary: ['WebPage'], secondary: ['Offer', 'BreadcrumbList'] },
  recipe: { primary: ['Recipe'], secondary: ['HowToStep', 'NutritionInformation', 'BreadcrumbList'] },
  generic: { primary: ['WebPage'], secondary: ['BreadcrumbList'] },
};

export const PAGE_TYPE_SCHEMA_MAP: Record<SchemaPageType, { primary: string[]; secondary: string[] }> = {
  auto: { primary: [], secondary: [] },
  ...ROLE_SCHEMA_TYPE_MAP,
};

export const SCHEMA_ROLE_TO_PAGE_KIND: Partial<Record<SchemaPageRole, PageKind>> = {
  homepage: 'Homepage',
  pillar: 'WebPage',
  audience: 'WebPage',
  'lead-gen': 'WebPage',
  blog: 'BlogPosting',
  service: 'Service',
  about: 'AboutPage',
  contact: 'ContactPage',
  location: 'Location',
  partnership: 'WebPage',
  'case-study': 'CaseStudy',
  comparison: 'WebPage',
  generic: 'WebPage',
};

const SCHEMA_ROLE_DIAGNOSTICS_TYPE: Partial<Record<SchemaPageRole, string>> = {
  product: 'Product',
  faq: 'FAQPage',
  howto: 'HowTo',
  video: 'VideoObject',
  pricing: 'Offer',
  author: 'ProfilePage',
  'job-posting': 'JobPosting',
  course: 'Course',
  event: 'Event',
  review: 'Review',
  recipe: 'Recipe',
};

export function schemaDiagnosticsTypeForRole(role: SchemaPageRole): string | null {
  return SCHEMA_ROLE_DIAGNOSTICS_TYPE[role] ?? null;
}
