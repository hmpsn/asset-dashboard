// ── Schema Site Plan types ─────────────────────────────────────

export type SchemaPageRole =
  | 'homepage'
  | 'pillar'
  | 'service'
  | 'audience'
  | 'lead-gen'
  | 'blog'
  | 'about'
  | 'contact'
  | 'location'
  | 'product'
  | 'partnership'
  | 'faq'
  | 'case-study'
  | 'comparison'
  | 'howto'
  | 'video'
  | 'generic';

export const SCHEMA_ROLE_LABELS: Record<SchemaPageRole, string> = {
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
  howto: 'How-To / Tutorial',
  video: 'Video Page',
  generic: 'General Page',
};

/** Client-facing descriptions per role — plain English, no schema jargon */
export const SCHEMA_ROLE_CLIENT_DESC: Record<SchemaPageRole, string> = {
  homepage: 'Company info, logo, social links, and product details for Google knowledge panel',
  pillar: 'Full product listing eligible for software/service rich results in Google',
  service: 'Service listing with details, pricing, and area served — eligible for service rich results',
  audience: 'Page info with link to main product — breadcrumb navigation in search',
  'lead-gen': 'Basic page info only (conversion page) — breadcrumb navigation in search',
  blog: 'Article markup with author and dates — eligible for article rich results',
  about: 'Company and team info — breadcrumb navigation in search',
  contact: 'Basic page info with contact details if available',
  location: 'Local business listing with address, hours, and map eligibility',
  product: 'Product listing eligible for product rich results in Google',
  partnership: 'Partner page with product reference — breadcrumb in search',
  faq: 'FAQ answers eligible for Google FAQ rich results (expandable in search)',
  'case-study': 'Article markup with client details — breadcrumb in search',
  comparison: 'Page info with product reference — breadcrumb in search',
  howto: 'Step-by-step how-to markup eligible for How-To rich results in Google',
  video: 'Video markup eligible for video carousel and video rich results in Google',
  generic: 'Basic page info — breadcrumb navigation in search',
};

/** Page type index — describes what each role is for, with URL examples */
export const SCHEMA_ROLE_INDEX: Record<SchemaPageRole, { description: string; examples: string[] }> = {
  homepage: {
    description: 'The main landing page of the site. Gets full Organization, WebSite, and product entity markup for Google knowledge panel.',
    examples: ['/'],
  },
  pillar: {
    description: 'The canonical page for a SaaS product or platform. Owns the primary SoftwareApplication entity with full details.',
    examples: ['/platform', '/product', '/solutions'],
  },
  service: {
    description: 'A page describing a specific service offering. Owns a Service entity with serviceType, pricing, and area served.',
    examples: ['/services/web-design', '/services/seo-consulting', '/managed-services'],
  },
  audience: {
    description: 'Pages targeting a specific audience, persona, feature, or use case. References the pillar product — does not create its own entity.',
    examples: ['/for-developers', '/features/analytics', '/use-cases/healthcare', '/industries/fintech'],
  },
  'lead-gen': {
    description: 'Conversion-focused pages with CTAs. Gets minimal WebPage + BreadcrumbList only — no product or service entities.',
    examples: ['/demo', '/pricing', '/get-started', '/signup', '/book-a-call'],
  },
  blog: {
    description: 'Blog posts, articles, news, guides, and other editorial content. Gets Article schema with author and dates.',
    examples: ['/blog/post-title', '/news/announcement', '/resources/guide-name'],
  },
  about: {
    description: 'Company information, team bios, culture, and careers pages.',
    examples: ['/about', '/about/team', '/careers'],
  },
  contact: {
    description: 'Contact page with phone, email, or form. Gets ContactPage schema with contact details.',
    examples: ['/contact', '/contact-us', '/support'],
  },
  location: {
    description: 'Location-specific pages for physical businesses. Gets LocalBusiness schema with address, hours, and map.',
    examples: ['/locations/new-york', '/offices/london'],
  },
  product: {
    description: 'Individual product pages (e-commerce or distinct offerings). Gets Product schema with pricing, availability, and reviews.',
    examples: ['/shop/widget-pro', '/products/starter-kit'],
  },
  partnership: {
    description: 'Integration or partner pages. References the main product entity — focuses on the partnership context.',
    examples: ['/integrations/slack', '/partners/acme-corp'],
  },
  faq: {
    description: 'Dedicated FAQ pages with clearly labeled Q&A pairs. Gets FAQPage schema eligible for Google FAQ rich results.',
    examples: ['/faq', '/help/frequently-asked-questions'],
  },
  'case-study': {
    description: 'Customer stories and case studies. Gets Article schema with client details and measurable results.',
    examples: ['/customers/acme-corp', '/case-studies/50-percent-growth'],
  },
  comparison: {
    description: 'Competitor comparison pages. References the main product entity — mentions competitor products.',
    examples: ['/vs-competitor', '/compare/us-vs-them', '/alternatives/competitor-name'],
  },
  howto: {
    description: 'Step-by-step tutorial or guide pages. Gets HowTo schema with numbered steps — eligible for Google How-To rich results.',
    examples: ['/how-to/set-up-account', '/tutorials/getting-started', '/guides/seo-checklist'],
  },
  video: {
    description: 'Pages featuring a primary video. Gets VideoObject schema — eligible for Google video carousel and rich results.',
    examples: ['/videos/product-demo', '/watch/tutorial-overview', '/video-library/webinar-recap'],
  },
  generic: {
    description: 'Pages that don\'t fit another category. Gets basic WebPage + BreadcrumbList markup.',
    examples: ['/privacy-policy', '/terms', '/thank-you'],
  },
};

export interface CanonicalEntity {
  type: string;           // 'SoftwareApplication' | 'Service' | 'LocalBusiness' etc.
  name: string;           // 'Faros AI Platform'
  canonicalUrl: string;   // 'https://www.faros.ai/platform'
  id: string;             // 'https://www.faros.ai/platform/#software'
  description?: string;   // short description for the entity
}

export interface PageRoleAssignment {
  pagePath: string;
  pageTitle: string;
  role: SchemaPageRole;
  primaryType: string;    // main @type: 'WebPage', 'SoftwareApplication', 'Article', etc.
  entityRefs: string[];   // @ids this page should reference (not create)
  notes?: string;         // AI guidance for this specific page
}

export interface SchemaSitePlan {
  id: string;
  siteId: string;
  workspaceId: string;
  siteUrl: string;
  canonicalEntities: CanonicalEntity[];
  pageRoles: PageRoleAssignment[];
  status: 'draft' | 'sent_to_client' | 'client_approved' | 'client_changes_requested' | 'active';
  clientPreviewBatchId?: string;  // links to approval batch if sent to client
  generatedAt: string;
  updatedAt: string;
}
