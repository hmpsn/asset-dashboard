import type { ContentTemplate, ContentMatrix, MatrixCell } from './types';

export const MOCK_TEMPLATE: ContentTemplate = {
  id: 'tpl_001',
  workspaceId: 'ws_test',
  name: 'Service \u00d7 Location Page',
  description: 'Standard service page for each city',
  pageType: 'service',
  variables: [
    { name: 'city', label: 'City', description: 'Target metro area' },
    { name: 'service', label: 'Service', description: 'Service offering' },
  ],
  sections: [
    { id: 's1', name: 'hero', headingTemplate: '{service} in {city}', guidance: 'Write an engaging intro...', wordCountTarget: 150, order: 0 },
    { id: 's2', name: 'what_is', headingTemplate: 'What Is {service}?', guidance: 'Explain the service...', wordCountTarget: 200, order: 1 },
    { id: 's3', name: 'why_us', headingTemplate: 'Why Choose Us for {service}', guidance: 'Differentiators...', wordCountTarget: 200, order: 2 },
    { id: 's4', name: 'process', headingTemplate: 'Our {service} Process', guidance: 'Step-by-step...', wordCountTarget: 200, order: 3 },
    { id: 's5', name: 'faq', headingTemplate: 'FAQ', guidance: '4-5 common questions...', wordCountTarget: 150, order: 4 },
    { id: 's6', name: 'cta', headingTemplate: 'Book Your {service} Appointment', guidance: 'Strong CTA...', wordCountTarget: 100, order: 5 },
  ],
  urlPattern: '/services/{city}/{service}',
  keywordPattern: '{service} in {city}',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const CITIES = ['Austin', 'Dallas', 'Houston'];
const SERVICES = ['Roofing', 'Plumbing', 'HVAC', 'Electrical', 'Painting', 'Landscaping'];

function makeCells(): MatrixCell[] {
  const cells: MatrixCell[] = [];
  const statuses: MatrixCell['status'][] = ['planned', 'keyword_validated', 'brief_generated', 'review', 'approved', 'draft', 'published'];
  let idx = 0;
  for (const service of SERVICES) {
    for (const city of CITIES) {
      const status = statuses[idx % statuses.length];
      const volume = 100 + Math.floor(Math.random() * 400);
      const difficulty = 15 + Math.floor(Math.random() * 50);
      const cpc = +(1 + Math.random() * 8).toFixed(2);
      cells.push({
        id: `cell_${idx}`,
        variableValues: { city, service },
        targetKeyword: `${service.toLowerCase()} ${city.toLowerCase()}`,
        plannedUrl: `/services/${city.toLowerCase()}/${service.toLowerCase()}`,
        status,
        keywordValidation: status !== 'planned' ? { volume, difficulty, cpc, validatedAt: new Date().toISOString() } : undefined,
        keywordCandidates: status !== 'planned' ? [
          { keyword: `${service.toLowerCase()} ${city.toLowerCase()}`, volume, difficulty, cpc, source: 'pattern', isRecommended: false },
          { keyword: `${service.toLowerCase()} services ${city.toLowerCase()} tx`, volume: volume + 60, difficulty: difficulty - 3, cpc: cpc + 0.5, source: 'semrush_related', isRecommended: true },
          { keyword: `best ${service.toLowerCase()} ${city.toLowerCase()}`, volume: volume - 30, difficulty: difficulty + 5, cpc: cpc + 1.2, source: 'ai_suggested', isRecommended: false },
        ] : undefined,
        recommendedKeyword: status !== 'planned' ? `${service.toLowerCase()} services ${city.toLowerCase()} tx` : undefined,
      });
      idx++;
    }
  }
  return cells;
}

const cells = makeCells();

export const MOCK_MATRIX: ContentMatrix = {
  id: 'mtx_001',
  workspaceId: 'ws_test',
  name: 'Houston Area Service Pages',
  templateId: 'tpl_001',
  dimensions: [
    { name: 'service', label: 'Service', values: SERVICES },
    { name: 'city', label: 'City', values: CITIES },
  ],
  urlPattern: '/services/{city}/{service}',
  keywordPattern: '{service} in {city}',
  cells,
  stats: {
    total: cells.length,
    planned: cells.filter(c => c.status === 'planned').length,
    briefGenerated: cells.filter(c => c.status === 'brief_generated').length,
    drafted: cells.filter(c => c.status === 'draft').length,
    reviewed: cells.filter(c => ['review', 'approved'].includes(c.status)).length,
    published: cells.filter(c => c.status === 'published').length,
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export const MOCK_TEMPLATES: ContentTemplate[] = [
  MOCK_TEMPLATE,
  {
    id: 'tpl_002',
    workspaceId: 'ws_test',
    name: 'Pillar \u00d7 Subtopic Hub',
    description: 'Content hub pages with pillar and subtopic structure',
    pageType: 'pillar',
    variables: [
      { name: 'pillar', label: 'Pillar', description: 'Main topic pillar' },
      { name: 'subtopic', label: 'Subtopic', description: 'Supporting subtopic' },
    ],
    sections: [
      { id: 'p1', name: 'overview', headingTemplate: '{subtopic} — A Complete Guide', guidance: 'Overview intro...', wordCountTarget: 200, order: 0 },
      { id: 'p2', name: 'key_concepts', headingTemplate: 'Key Concepts of {subtopic}', guidance: 'Explain fundamentals...', wordCountTarget: 250, order: 1 },
      { id: 'p3', name: 'how_to', headingTemplate: 'How to {subtopic}', guidance: 'Step-by-step guide...', wordCountTarget: 300, order: 2 },
      { id: 'p4', name: 'faq', headingTemplate: 'FAQ', guidance: '3-5 questions...', wordCountTarget: 150, order: 3 },
    ],
    urlPattern: '/resources/{pillar}/{subtopic}',
    keywordPattern: '{subtopic} guide',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];
