import type { SchemaPageSuggestion } from '../schema-suggester.js';
import type { SchemaSiteTemplate } from '../schema-store.js';
import type { SchemaSitePlan } from '../../shared/types/schema-plan.js';
import type {
  WholeSiteSchemaGraphFinding,
  WholeSiteSchemaGraphNode,
  WholeSiteSchemaGraphValidationResult,
} from '../../shared/types/schema-validation.js';

export interface WholeSiteSchemaGraphInput {
  pages: SchemaPageSuggestion[];
  siteTemplate?: SchemaSiteTemplate | null;
  activePlan?: SchemaSitePlan | null;
}

interface InternalNode extends WholeSiteSchemaGraphNode {
  node: Record<string, unknown>;
}

interface IdReference {
  sourceId?: string;
  targetId: string;
  pageId: string;
  pagePath: string;
  propertyPath: string;
}

const SITEWIDE_ORG_TYPES = new Set(['Organization', 'LocalBusiness', 'MedicalOrganization', 'FinancialService']);
const COMPATIBLE_TYPES: Record<string, Set<string>> = {
  Article: new Set(['Article', 'BlogPosting', 'NewsArticle']),
  BlogPosting: new Set(['Article', 'BlogPosting', 'NewsArticle']),
  WebPage: new Set(['WebPage', 'AboutPage', 'ContactPage', 'CollectionPage', 'ProfilePage']),
  CollectionPage: new Set(['CollectionPage', 'Blog', 'ItemList']),
  LocalBusiness: new Set(['LocalBusiness', 'MedicalOrganization', 'FinancialService']),
};

function normalizePath(path: string | undefined): string {
  if (!path) return '/';
  const trimmed = path.trim();
  if (!trimmed || trimmed === '/') return '/';
  try {
    const parsed = new URL(trimmed);
    return normalizePath(parsed.pathname);
  } catch { // catch-ok: relative or malformed page paths fall through to path-only normalization
    const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    return withSlash.replace(/\/+$/, '') || '/';
  }
}

function suggestionPath(page: SchemaPageSuggestion): string {
  if (page.url) return normalizePath(page.url);
  return normalizePath(page.slug);
}

function nodeTypes(node: Record<string, unknown>): string[] {
  const type = node['@type'];
  if (typeof type === 'string' && type.trim()) return [type.trim()];
  if (Array.isArray(type)) return type.filter((v): v is string => typeof v === 'string' && !!v.trim());
  return [];
}

function graphNodes(schema: Record<string, unknown> | undefined): Record<string, unknown>[] {
  if (!schema) return [];
  const graph = schema['@graph'];
  if (Array.isArray(graph)) {
    return graph.filter((node): node is Record<string, unknown> =>
      !!node && typeof node === 'object' && !Array.isArray(node),
    );
  }
  return nodeTypes(schema).length > 0 ? [schema] : [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isReferenceObject(value: Record<string, unknown>): boolean {
  return typeof value['@id'] === 'string' && !value['@type'];
}

function collectReferences(
  value: unknown,
  refs: IdReference[],
  context: { pageId: string; pagePath: string; sourceId?: string; propertyPath: string },
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectReferences(item, refs, {
      ...context,
      propertyPath: `${context.propertyPath}[${index}]`,
    }));
    return;
  }
  if (!isObject(value)) return;

  if (isReferenceObject(value)) {
    refs.push({
      sourceId: context.sourceId,
      targetId: value['@id'] as string,
      pageId: context.pageId,
      pagePath: context.pagePath,
      propertyPath: context.propertyPath,
    });
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (key === '@id') continue;
    collectReferences(nested, refs, {
      ...context,
      propertyPath: context.propertyPath ? `${context.propertyPath}.${key}` : key,
    });
  }
}

function primarySchema(page: SchemaPageSuggestion): Record<string, unknown> | undefined {
  return page.suggestedSchemas?.[0]?.template;
}

function comparableValue(node: Record<string, unknown>, field: string): string | undefined {
  const value = node[field];
  if (value === undefined || value === null || value === '') return undefined;
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function isCompatibleType(expected: string, emittedTypes: Set<string>): boolean {
  if (emittedTypes.has(expected)) return true;
  const compatible = COMPATIBLE_TYPES[expected];
  return compatible ? [...emittedTypes].some(type => compatible.has(type)) : false;
}

function siteIdentityGroup(node: InternalNode): string | null {
  let idPath = '';
  try {
    idPath = new URL(node.id).pathname.replace(/\/+$/, '') || '/';
  } catch { // catch-ok: non-URL @ids cannot be confidently grouped as site identity
    return null;
  }
  if (idPath !== '/') return null;
  if (node.type === 'Organization') return 'Organization';
  if (
    node.type === 'LocalBusiness' || node.type === 'MedicalOrganization' || node.type === 'FinancialService'
  ) return 'LocalBusiness';
  return null;
}

function isHubChildReference(ref: IdReference): boolean {
  return ref.propertyPath.includes('blogPost')
    || ref.propertyPath.includes('itemListElement')
    || ref.propertyPath.includes('hasOfferCatalog');
}

function isNestedChildPath(parentPath: string, childPath: string): boolean {
  if (parentPath === '/') return childPath !== '/';
  return childPath.startsWith(`${parentPath.replace(/\/+$/, '')}/`);
}

function addFinding(
  findings: WholeSiteSchemaGraphFinding[],
  finding: WholeSiteSchemaGraphFinding,
): void {
  findings.push(finding);
}

export function validateWholeSiteSchemaGraph(
  input: WholeSiteSchemaGraphInput,
): WholeSiteSchemaGraphValidationResult {
  const findings: WholeSiteSchemaGraphFinding[] = [];
  const nodes: InternalNode[] = [];
  const references: IdReference[] = [];

  if (input.siteTemplate?.organizationNode) {
    const id = input.siteTemplate.organizationNode['@id'];
    const type = nodeTypes(input.siteTemplate.organizationNode)[0] ?? 'Organization';
    if (typeof id === 'string' && id.trim()) {
      nodes.push({
        id,
        type,
        pageId: 'site-template',
        pagePath: '/',
        source: 'site-template',
        node: input.siteTemplate.organizationNode,
      });
      collectReferences(input.siteTemplate.organizationNode, references, {
        pageId: 'site-template',
        pagePath: '/',
        sourceId: id,
        propertyPath: '',
      });
    }
  }
  if (input.siteTemplate?.websiteNode) {
    const id = input.siteTemplate.websiteNode['@id'];
    const type = nodeTypes(input.siteTemplate.websiteNode)[0] ?? 'WebSite';
    if (typeof id === 'string' && id.trim()) {
      nodes.push({
        id,
        type,
        pageId: 'site-template',
        pagePath: '/',
        source: 'site-template',
        node: input.siteTemplate.websiteNode,
      });
      collectReferences(input.siteTemplate.websiteNode, references, {
        pageId: 'site-template',
        pagePath: '/',
        sourceId: id,
        propertyPath: '',
      });
    }
  }

  for (const page of input.pages) {
    const pagePath = suggestionPath(page);
    for (const node of graphNodes(primarySchema(page))) {
      const id = node['@id'];
      const types = nodeTypes(node);
      if (typeof id === 'string' && id.trim()) {
        nodes.push({
          id,
          type: types[0] ?? 'Thing',
          pageId: page.pageId,
          pagePath,
          source: 'page-schema',
          node,
        });
      }
      collectReferences(node, references, {
        pageId: page.pageId,
        pagePath,
        sourceId: typeof id === 'string' ? id : undefined,
        propertyPath: '',
      });
    }
  }

  const ids = new Set(nodes.map(node => node.id));
  for (const ref of references) {
    if (!ids.has(ref.targetId)) {
      addFinding(findings, {
        severity: 'error',
        type: 'GraphReference',
        field: ref.propertyPath,
        ruleId: 'schema-graph-dangling-reference',
        message: `Schema reference "${ref.targetId}" does not resolve to any node in the site graph.`,
        pageId: ref.pageId,
        pagePath: ref.pagePath,
        sourceId: ref.sourceId,
        targetId: ref.targetId,
      });
    }
  }

  const byId = new Map<string, InternalNode[]>();
  for (const node of nodes) {
    const existing = byId.get(node.id) ?? [];
    existing.push(node);
    byId.set(node.id, existing);
  }

  const identityFields = ['@type', 'name', 'url', 'telephone', 'email', 'address', 'sameAs'];
  for (const [id, matches] of byId.entries()) {
    if (matches.length < 2) continue;
    const [canonical] = matches;
    for (const candidate of matches.slice(1)) {
      for (const field of identityFields) {
        const expected = comparableValue(canonical.node, field);
        const found = comparableValue(candidate.node, field);
        if (expected !== undefined && found !== undefined && expected !== found) {
          addFinding(findings, {
            severity: 'error',
            type: candidate.type,
            field,
            ruleId: 'schema-graph-conflicting-node',
            message: `Node "${id}" has conflicting ${field} values across the site graph.`,
            pageId: candidate.pageId,
            pagePath: candidate.pagePath,
            sourceId: id,
          });
        }
      }
    }
  }

  const siteIdentityIdsByGroup = new Map<string, Set<string>>();
  for (const node of nodes) {
    const group = siteIdentityGroup(node);
    if (!group) continue;
    const idsForGroup = siteIdentityIdsByGroup.get(group) ?? new Set<string>();
    idsForGroup.add(node.id);
    siteIdentityIdsByGroup.set(group, idsForGroup);
  }
  for (const [group, groupIds] of siteIdentityIdsByGroup.entries()) {
    if (groupIds.size < 2) continue;
    addFinding(findings, {
      severity: 'error',
      type: group,
      ruleId: 'schema-graph-duplicate-site-identity',
      message: `The site graph emits multiple ${group} identity node ids (${[...groupIds].join(', ')}).`,
    });
  }

  for (const ref of references) {
    if (!ref.sourceId || !isHubChildReference(ref)) continue;
    const source = byId.get(ref.sourceId)?.[0];
    const target = byId.get(ref.targetId)?.[0];
    if (!source || !target) continue;
    if (source.pagePath === target.pagePath) continue;
    if (!isNestedChildPath(source.pagePath, target.pagePath)) {
      addFinding(findings, {
        severity: 'error',
        type: source.type,
        field: ref.propertyPath,
        ruleId: 'schema-graph-broken-hub-child',
        message: `Hub page "${source.pagePath}" references "${target.pagePath}", but that page is not a child URL of the hub.`,
        pageId: source.pageId,
        pagePath: source.pagePath,
        sourceId: ref.sourceId,
        targetId: ref.targetId,
      });
    }
  }

  const hasWebsite = nodes.some(node => node.type === 'WebSite');
  const hasSitewideOrg = nodes.some(node => SITEWIDE_ORG_TYPES.has(node.type));
  if (!hasWebsite) {
    addFinding(findings, {
      severity: 'warning',
      type: 'WebSite',
      ruleId: 'schema-graph-website-missing',
      message: 'The site graph does not include a WebSite node.',
    });
  }
  if (!hasSitewideOrg) {
    addFinding(findings, {
      severity: 'warning',
      type: 'Organization',
      ruleId: 'schema-graph-organization-missing',
      message: 'The site graph does not include an Organization or LocalBusiness identity node.',
    });
  }

  const activePlan = input.activePlan?.status === 'active' ? input.activePlan : null;
  if (activePlan) {
    for (const entity of activePlan.canonicalEntities) {
      if (entity.id && !ids.has(entity.id)) {
        addFinding(findings, {
          severity: 'error',
          type: entity.type || 'Thing',
          ruleId: 'schema-graph-planned-entity-missing',
          message: `Active schema plan canonical entity "${entity.name}" is not emitted in the site graph.`,
          targetId: entity.id,
        });
      }
    }

    const pagesByPath = new Map(input.pages.map(page => [suggestionPath(page), page]));
    for (const role of activePlan.pageRoles) {
      const pagePath = normalizePath(role.pagePath);
      const page = pagesByPath.get(pagePath);
      if (!page) continue;
      const emittedTypes = new Set(graphNodes(primarySchema(page)).flatMap(node => nodeTypes(node)));
      const diagnosticRole = page.generationDiagnostics?.effectiveRole ?? page.generationDiagnostics?.plannedRole;
      if (diagnosticRole && diagnosticRole !== role.role) {
        addFinding(findings, {
          severity: 'warning',
          type: role.primaryType || 'WebPage',
          ruleId: 'schema-graph-plan-role-mismatch',
          message: `Generated schema role "${diagnosticRole}" does not match active schema plan role "${role.role}".`,
          pageId: page.pageId,
          pagePath,
        });
      }
      if (role.primaryType && emittedTypes.size > 0 && !isCompatibleType(role.primaryType, emittedTypes)) {
        addFinding(findings, {
          severity: 'warning',
          type: role.primaryType,
          ruleId: 'schema-graph-plan-primary-type-mismatch',
          message: `Generated schema types (${[...emittedTypes].join(', ')}) do not include planned primary type "${role.primaryType}".`,
          pageId: page.pageId,
          pagePath,
        });
      }
    }
  }

  const status = findings.some(f => f.severity === 'error')
    ? 'errors'
    : findings.some(f => f.severity === 'warning')
      ? 'warnings'
      : 'valid';

  return {
    status,
    checkedPageCount: input.pages.length,
    nodeCount: nodes.length,
    referenceCount: references.length,
    findings,
    nodes: nodes.map(({ node: _node, ...publicNode }) => publicNode),
  };
}
