/**
 * Validates lean schema output against Google rich-result requirements.
 * Returns an array of ValidationFinding objects. Empty = pass.
 */

import type { ValidationFinding } from '../../shared/types/schema-validation.js';

interface RequiredFields {
  required: string[];
  /** Recommended fields surface as warnings (severity='warning') when missing. */
  recommended?: string[];
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
    // address + telephone are GOOGLE-RECOMMENDED but workspace-data-dependent. A workspace
    // whose BusinessProfile is null or partially populated would surface a permanent
    // validation error today even though the schema is otherwise valid. Keep them off the
    // required list until we add a "recommended" tier with admin-facing prompts to fix
    // workspace settings. Tracked: schema-yoast-parity-fields will introduce that tier.
    required: ['name', 'url', 'inLanguage'],
  },
  Organization: {
    // logo is GOOGLE-RECOMMENDED but tied to workspace.brandLogoUrl. Same rationale as
    // LocalBusiness above — a workspace without an uploaded logo would otherwise show a
    // permanent error. Defer to schema-yoast-parity-fields' recommended tier.
    required: ['name', 'url'],
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
  VideoObject: {
    required: ['name', 'description', 'thumbnailUrl', 'uploadDate'],
    recommended: ['duration', 'embedUrl', 'contentUrl'],
  },
};

function validateBreadcrumb(node: Record<string, unknown>): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const items = node.itemListElement as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(items)) {
    findings.push({
      severity: 'error',
      type: 'BreadcrumbList',
      field: 'itemListElement',
      ruleId: 'breadcrumb-itemlist-shape',
      message: 'BreadcrumbList missing itemListElement array',
    });
    return findings;
  }
  for (const item of items) {
    if (typeof item.position !== 'number') {
      findings.push({
        severity: 'error',
        type: 'BreadcrumbList',
        field: 'itemListElement.position',
        ruleId: 'breadcrumb-listitem-position-missing',
        message: 'BreadcrumbList ListItem missing position',
      });
    }
    if (typeof item.name !== 'string' || !item.name.trim()) {
      findings.push({
        severity: 'error',
        type: 'BreadcrumbList',
        field: 'itemListElement.name',
        ruleId: 'breadcrumb-listitem-name-missing',
        message: 'BreadcrumbList ListItem missing name',
      });
    }
    if (typeof item.item !== 'string' || !item.item.trim()) {
      findings.push({
        severity: 'error',
        type: 'BreadcrumbList',
        field: 'itemListElement.item',
        ruleId: 'breadcrumb-listitem-item-missing',
        message: 'BreadcrumbList ListItem missing item URL',
      });
    }
  }
  return findings;
}

function isIdRef(v: unknown): v is { '@id': string } {
  return typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>)['@id'] === 'string';
}

function validateCrossRefs(node: Record<string, unknown>, allNodes: Record<string, unknown>[]): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const t = node['@type'] as string;

  if (node.isPartOf !== undefined && !isIdRef(node.isPartOf)) {
    findings.push({
      severity: 'error',
      type: t,
      field: 'isPartOf',
      ruleId: 'cross-ref-ispartof-shape',
      message: `${t}.isPartOf must be an @id reference (e.g. {"@id": "...#website"})`,
    });
  }
  // Note: we deliberately do NOT verify that isPartOf's @id resolves to a WebSite node.
  // The lean output is per-page; the WebSite node is only emitted in the homepage's @graph,
  // not on every other page's @graph. A whole-snapshot validator would catch this; the
  // per-page validator here can't.

  if (node.breadcrumb !== undefined) {
    if (!isIdRef(node.breadcrumb)) {
      findings.push({
        severity: 'error',
        type: t,
        field: 'breadcrumb',
        ruleId: 'cross-ref-breadcrumb-shape',
        message: `${t}.breadcrumb must be an @id reference (e.g. {"@id": "...#breadcrumb"})`,
      });
    } else {
      const target = (node.breadcrumb as { '@id': string })['@id'];
      const found = allNodes.some(n => n['@type'] === 'BreadcrumbList' && n['@id'] === target);
      if (!found) {
        findings.push({
          severity: 'error',
          type: t,
          field: 'breadcrumb',
          ruleId: 'cross-ref-breadcrumb-dangling',
          message: `${t}.breadcrumb references @id "${target}" but no BreadcrumbList with that @id is in the @graph`,
        });
      }
    }
  }

  if (node.mainEntityOfPage !== undefined && !isIdRef(node.mainEntityOfPage) && typeof node.mainEntityOfPage !== 'string') {
    // mainEntityOfPage may be either a string URL or an @id-ref shape — both are accepted by Google.
    // Reject only objects that are neither.
    const v = node.mainEntityOfPage;
    if (typeof v === 'object' && v !== null && !('@id' in v) && !('@type' in v)) {
      findings.push({
        severity: 'error',
        type: t,
        field: 'mainEntityOfPage',
        ruleId: 'cross-ref-mainentityofpage-shape',
        message: `${t}.mainEntityOfPage must be a URL string or {"@id": "..."} reference`,
      });
    }
  }

  return findings;
}

const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function isImageObjectWithUrl(v: unknown): boolean {
  return typeof v === 'object' && v !== null
    && (v as Record<string, unknown>)['@type'] === 'ImageObject'
    && typeof (v as Record<string, unknown>).url === 'string'
    && ((v as Record<string, unknown>).url as string).trim().length > 0;
}

function validateArticleShape(node: Record<string, unknown>): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const t = node['@type'] as string;
  if (t !== 'Article' && t !== 'BlogPosting') return findings;

  // author: must be {@type: Person|Organization, name: string}. Split into discrete
  // error messages so the admin UI can point at the specific cause.
  const author = node.author;
  if (author !== undefined) {
    if (typeof author !== 'object' || author === null) {
      findings.push({
        severity: 'error',
        type: t,
        field: 'author',
        ruleId: 'article-author-shape',
        message: `${t}.author must be an object with @type ∈ {Person, Organization} and non-empty name`,
      });
    } else {
      const a = author as Record<string, unknown>;
      const validType = a['@type'] === 'Person' || a['@type'] === 'Organization';
      if (!validType) {
        findings.push({
          severity: 'error',
          type: t,
          field: 'author.@type',
          ruleId: 'article-author-type-invalid',
          message: `${t}.author.@type must be "Person" or "Organization"`,
        });
      }
      const name = a.name;
      if (typeof name !== 'string' || !name.trim()) {
        findings.push({
          severity: 'error',
          type: t,
          field: 'author.name',
          ruleId: 'article-author-name-missing',
          message: `${t}.author.name required (non-empty string)`,
        });
      }
    }
  }

  // publisher: must have @type AND name AND logo (ImageObject with url). Discrete errors.
  const publisher = node.publisher;
  if (publisher !== undefined) {
    if (typeof publisher !== 'object' || publisher === null) {
      findings.push({
        severity: 'error',
        type: t,
        field: 'publisher',
        ruleId: 'article-publisher-not-object',
        message: `${t}.publisher must be an object with @type, name, and logo`,
      });
    } else {
      const p = publisher as Record<string, unknown>;
      if (typeof p['@type'] !== 'string') {
        findings.push({
          severity: 'error',
          type: t,
          field: 'publisher.@type',
          ruleId: 'article-publisher-type-missing',
          message: `${t}.publisher.@type required (string)`,
        });
      }
      if (typeof p.name !== 'string' || !(p.name as string).trim()) {
        findings.push({
          severity: 'error',
          type: t,
          field: 'publisher.name',
          ruleId: 'article-publisher-name-missing',
          message: `${t}.publisher.name required (non-empty string)`,
        });
      }
      const logo = p.logo;
      if (logo === undefined) {
        findings.push({
          severity: 'error',
          type: t,
          field: 'publisher.logo',
          ruleId: 'article-publisher-logo-missing',
          message: `${t}.publisher.logo required — Google Article rich result requires an ImageObject with url`,
        });
      } else if (typeof logo !== 'object' || logo === null) {
        findings.push({
          severity: 'error',
          type: t,
          field: 'publisher.logo',
          ruleId: 'article-publisher-logo-not-imageobject',
          message: `${t}.publisher.logo must be an ImageObject (got ${typeof logo})`,
        });
      } else if (!isImageObjectWithUrl(logo)) {
        findings.push({
          severity: 'error',
          type: t,
          field: 'publisher.logo.url',
          ruleId: 'article-publisher-logo-url-missing',
          message: `${t}.publisher.logo must be {"@type": "ImageObject", "url": "..."} with non-empty url`,
        });
      }
    }
  }

  // image: string URL | array of strings/ImageObjects | ImageObject. Each ImageObject
  // (top-level OR inside an array) must have a url field — reviewer flagged that
  // {@type:'ImageObject'} without url is technically allowed by the type guard but
  // produces an unusable rich-result image.
  const image = node.image;
  if (image !== undefined) {
    let imageOk = false;
    if (typeof image === 'string') {
      imageOk = true;
    } else if (Array.isArray(image)) {
      imageOk = image.every(item =>
        typeof item === 'string' || isImageObjectWithUrl(item),
      );
      if (!imageOk) {
        findings.push({
          severity: 'error',
          type: t,
          field: 'image',
          ruleId: 'article-image-array-item-shape',
          message: `${t}.image array items must each be a string URL or ImageObject with url`,
        });
      } else {
        imageOk = true;
      }
    } else if (typeof image === 'object' && image !== null && (image as Record<string, unknown>)['@type'] === 'ImageObject') {
      imageOk = isImageObjectWithUrl(image);
      if (!imageOk) {
        findings.push({
          severity: 'error',
          type: t,
          field: 'image',
          ruleId: 'article-image-imageobject-url-missing',
          message: `${t}.image (ImageObject) requires a non-empty url`,
        });
      } else {
        imageOk = true;
      }
    }
    if (!imageOk && !findings.some(f => f.field === 'image')) {
      findings.push({
        severity: 'error',
        type: t,
        field: 'image',
        ruleId: 'article-image-shape-invalid',
        message: `${t}.image must be a string URL, an array of strings/ImageObjects, or an ImageObject`,
      });
    }
  }

  // datePublished / dateModified: ISO 8601.
  for (const field of ['datePublished', 'dateModified'] as const) {
    const v = node[field];
    if (v !== undefined && (typeof v !== 'string' || !ISO_8601_RE.test(v))) {
      findings.push({
        severity: 'error',
        type: t,
        field,
        ruleId: 'article-date-iso8601',
        message: `${t}.${field} must be ISO 8601 (e.g. "2026-01-15T00:00:00Z")`,
      });
    }
  }

  return findings;
}

/**
 * LocalBusiness.address shape check. address is not in the required list (workspace-data
 * dependent) but when it IS present it must be a PostalAddress with at least one of the
 * three locator fields — Google rejects bare-string addresses.
 */
function validateLocalBusinessShape(node: Record<string, unknown>): ValidationFinding[] {
  if (node['@type'] !== 'LocalBusiness') return [];
  const findings: ValidationFinding[] = [];
  const address = node.address;
  if (address !== undefined) {
    if (typeof address !== 'object' || address === null) {
      findings.push({
        severity: 'error',
        type: 'LocalBusiness',
        field: 'address',
        ruleId: 'localbusiness-address-not-object',
        message: `LocalBusiness.address must be a PostalAddress object (got ${typeof address})`,
      });
    } else {
      const a = address as Record<string, unknown>;
      if (a['@type'] !== 'PostalAddress') {
        findings.push({
          severity: 'error',
          type: 'LocalBusiness',
          field: 'address.@type',
          ruleId: 'localbusiness-address-type-invalid',
          message: `LocalBusiness.address.@type must be "PostalAddress"`,
        });
      }
      const hasLocator = typeof a.streetAddress === 'string' && (a.streetAddress as string).trim()
        || typeof a.addressLocality === 'string' && (a.addressLocality as string).trim()
        || typeof a.postalCode === 'string' && (a.postalCode as string).trim();
      if (!hasLocator) {
        findings.push({
          severity: 'error',
          type: 'LocalBusiness',
          field: 'address',
          ruleId: 'localbusiness-address-no-locator',
          message: `LocalBusiness.address must have at least one of streetAddress, addressLocality, postalCode`,
        });
      }
    }
  }
  return findings;
}

function validateBreadcrumbOrdering(node: Record<string, unknown>): ValidationFinding[] {
  if (node['@type'] !== 'BreadcrumbList') return [];
  const items = node.itemListElement as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(items)) return []; // existing validateBreadcrumb catches missing array
  // Skip ordering check if any position is non-numeric — validateBreadcrumb owns that
  // error class. Without this guard a missing position would produce two errors for
  // the same root cause (missing position + non-contiguous ordering).
  if (items.some(item => typeof item.position !== 'number')) return [];
  for (let i = 0; i < items.length; i++) {
    if (items[i].position !== i + 1) {
      return [{
        severity: 'error',
        type: 'BreadcrumbList',
        field: 'itemListElement.position',
        ruleId: 'breadcrumb-position-ordering',
        message: 'BreadcrumbList itemListElement positions must start at 1 and be contiguous-ascending',
      }];
    }
  }
  return [];
}

function validateAbsoluteUrls(node: Record<string, unknown>): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const t = node['@type'] as string;
  // Only check primary nodes — BreadcrumbList's `item` URLs are inside ListItems and are
  // already required by validateBreadcrumb to be non-empty strings; skip them here.
  if (t === 'BreadcrumbList' || t === 'ListItem') return findings;
  const url = node.url;
  if (typeof url === 'string' && !/^https?:\/\//.test(url)) {
    findings.push({
      severity: 'error',
      type: t,
      field: 'url',
      ruleId: 'url-must-be-absolute',
      message: `${t}.url must be an absolute URL (start with http:// or https://)`,
    });
  }
  return findings;
}

export function validateLeanSchema(schema: Record<string, unknown>, _primaryType: string): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  if (schema['@context'] !== 'https://schema.org') {
    findings.push({
      severity: 'error',
      type: '@graph',
      ruleId: 'context-missing',
      message: 'Schema missing @context',
    });
  }
  const graph = schema['@graph'] as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(graph)) {
    findings.push({
      severity: 'error',
      type: '@graph',
      ruleId: 'graph-missing',
      message: 'Schema missing @graph array',
    });
    return findings;
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
      findings.push({
        severity: 'error',
        type: t,
        ruleId: 'duplicate-type',
        message: `Duplicate @type in @graph: ${t} (lean output must emit exactly one primary node + optional BreadcrumbList)`,
      });
    }
  }

  for (const node of graph) {
    const t = node['@type'] as string;
    const rules = REQUIRED_BY_TYPE[t];
    if (rules) {
      for (const field of rules.required) {
        if (node[field] === undefined || node[field] === null) {
          findings.push({
            severity: 'error',
            type: t,
            field,
            ruleId: 'required-field-missing',
            message: `${t} missing required field: ${field}`,
          });
        }
      }
      for (const field of rules.recommended ?? []) {
        if (node[field] === undefined || node[field] === null) {
          findings.push({
            severity: 'warning',
            type: t,
            field,
            ruleId: 'recommended-field-missing',
            message: `${t} missing recommended field: ${field}`,
          });
        }
      }
    }
    if (t === 'BreadcrumbList') {
      findings.push(...validateBreadcrumb(node));
    }
    findings.push(...validateCrossRefs(node, graph));
    findings.push(...validateArticleShape(node));
    findings.push(...validateLocalBusinessShape(node));
    findings.push(...validateBreadcrumbOrdering(node));
    findings.push(...validateAbsoluteUrls(node));
  }

  return findings;
}
