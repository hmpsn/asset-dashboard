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
    required: ['headline', 'datePublished', 'author', 'publisher', 'mainEntityOfPage'],
  },
  Article: {
    required: ['headline', 'datePublished', 'author', 'publisher', 'mainEntityOfPage'],
  },
  Service: {
    required: ['name', 'provider'],
  },
  Product: {
    required: ['name'],
  },
  LocalBusiness: {
    required: ['name', 'url'],
  },
  Organization: {
    required: ['name', 'url'],
  },
  WebSite: {
    required: ['name', 'url'],
  },
  AboutPage: {
    required: ['name', 'url'],
  },
  ContactPage: {
    required: ['name', 'url'],
  },
  CollectionPage: {
    required: ['name', 'url'],
  },
  WebPage: {
    required: ['name', 'url'],
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

export function validateLeanSchema(schema: Record<string, unknown>, primaryType: string): string[] {
  const errors: string[] = [];
  if (schema['@context'] !== 'https://schema.org') errors.push('Schema missing @context');
  const graph = schema['@graph'] as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(graph)) {
    errors.push('Schema missing @graph array');
    return errors;
  }

  // Duplicate @type detection — the lean rule: at most ONE primary node + at most one BreadcrumbList.
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

  // Suppress unused-parameter warning — primaryType is reserved for future per-type rules.
  void primaryType;

  return errors;
}
