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
  | 'generic';

export const SCHEMA_ROLE_LABELS: Record<SchemaPageRole, string> = {
  homepage: 'Homepage',
  pillar: 'Pillar / Product Page',
  service: 'Service Page',
  audience: 'Audience / Persona Page',
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
  generic: 'Basic page info — breadcrumb navigation in search',
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
