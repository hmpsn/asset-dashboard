/**
 * Validates lean schema output against Google rich-result requirements.
 * Returns an array of human-readable error strings. Empty = pass.
 */

interface RequiredFields {
  required: string[];
  /** Validators receive the @graph node and return error strings. */
  custom?: Array<(node: Record<string, unknown>, allNodes: Record<string, unknown>[]) => string[]>;
}

const REQUIRED_BY_TYPE: Record<string, RequiredFields> = {
  BlogPosting: {
    required: [
      'headline', 'description', 'image', 'datePublished', 'dateModified',
      'author', 'publisher', 'mainEntityOfPage',
      'isPartOf', 'breadcrumb', 'inLanguage', 'articleSection',
    ],
  },
  Article: {
    required: [
      'headline', 'description', 'image', 'datePublished', 'dateModified',
      'author', 'publisher', 'mainEntityOfPage',
      'isPartOf', 'breadcrumb', 'inLanguage',
    ],
  },
  Service: {
    required: ['name', 'description', 'provider', 'isPartOf', 'breadcrumb', 'inLanguage'],
  },
  Product: {
    required: ['name', 'description', 'isPartOf', 'breadcrumb', 'inLanguage'],
  },
  LocalBusiness: {
    required: ['name', 'url', 'address', 'telephone', 'inLanguage'],
  },
  Organization: {
    required: ['name', 'url', 'logo'],
  },
  WebSite: {
    // potentialAction (sitelinks SearchAction) used to be in this list, but Pillar 2.1
    // dropped the unconditional emission because the site may not have a search endpoint.
    // schema-yoast-parity-fields will re-introduce SearchAction behind a workspace flag
    // (Workspace.siteHasSearch); add potentialAction back here as a conditional required
    // field at that time.
    required: ['name', 'url', 'publisher', 'inLanguage'],
  },
  AboutPage: {
    required: ['name', 'url', 'description', 'isPartOf', 'breadcrumb', 'inLanguage', 'mainEntity'],
  },
  ContactPage: {
    required: ['name', 'url', 'description', 'isPartOf', 'breadcrumb', 'inLanguage'],
  },
  CollectionPage: {
    required: ['name', 'url', 'description', 'isPartOf', 'breadcrumb', 'inLanguage'],
  },
  WebPage: {
    required: ['name', 'url', 'description', 'isPartOf', 'breadcrumb', 'inLanguage'],
  },
};

function validateBreadcrumb(node: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const items = node.itemListElement as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(items)) {
    errors.push('BreadcrumbList missing itemListElement array');
    return errors;
  }
  for (const item of items) {
    if (typeof item.position !== 'number') {
      errors.push('BreadcrumbList ListItem missing position');
    }
    if (typeof item.name !== 'string' || !item.name.trim()) {
      errors.push('BreadcrumbList ListItem missing name');
    }
    if (typeof item.item !== 'string' || !item.item.trim()) {
      errors.push('BreadcrumbList ListItem missing item URL');
    }
  }
  return errors;
}

export function validateLeanSchema(schema: Record<string, unknown>, _primaryType: string): string[] {
  const errors: string[] = [];
  if (schema['@context'] !== 'https://schema.org') errors.push('Schema missing @context');
  const graph = schema['@graph'] as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(graph)) {
    errors.push('Schema missing @graph array');
    return errors;
  }

  // Duplicate @type detection — the lean rule: at most one node per @type, except
  // ListItem (legitimate breadcrumb children). Homepage may have BOTH Organization +
  // WebSite (different @types), so the rule is per-type, not "exactly one primary".
  const typeCounts = new Map<string, number>();
  for (const node of graph) {
    const t = node['@type'] as string;
    typeCounts.set(t, (typeCounts.get(t) || 0) + 1);
  }
  for (const [t, count] of typeCounts) {
    if (count > 1 && t !== 'ListItem') {
      errors.push(`Duplicate @type in @graph: ${t} (lean output must emit exactly one primary node + optional BreadcrumbList)`);
    }
  }

  for (const node of graph) {
    const t = node['@type'] as string;
    const rules = REQUIRED_BY_TYPE[t];
    if (rules) {
      for (const field of rules.required) {
        if (node[field] === undefined || node[field] === null) {
          errors.push(`${t} missing required field: ${field}`);
        }
      }
    }
    if (t === 'BreadcrumbList') {
      errors.push(...validateBreadcrumb(node));
    }
  }

  return errors;
}
