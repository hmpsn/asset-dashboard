import { renderSalesReportHTML } from './server/sales-report-html.js';
import fs from 'fs';

const mockReport = {
  url: 'https://www.swishsmiles.com',
  siteName: 'Swish Dental',
  siteScore: 73,
  totalPages: 10,
  errors: 2,
  warnings: 37,
  infos: 4,
  generatedAt: new Date().toISOString(),
  topRisks: [{ check: 'dup-title', severity: 'error' as const, message: 'Duplicate title across 2 pages', recommendation: 'Each page needs a unique title.', category: 'content' }],
  quickWins: [{ check: 'meta-desc', severity: 'warning' as const, message: 'Meta description too long', recommendation: 'Shorten to 160 chars.', category: 'content' }],
  siteWideIssues: [],
  pages: [{
    url: 'https://www.swishsmiles.com/', page: 'Home', score: 85,
    issues: [{ check: 'og-image', severity: 'warning' as const, message: 'Missing OG image', recommendation: 'Add og:image', category: 'social' }],
  }],
  id: 'test_123',
};

const html = renderSalesReportHTML(mockReport);
fs.writeFileSync('/tmp/test-sales-report.html', html);
console.log(`Wrote ${html.length} bytes to /tmp/test-sales-report.html`);
console.log(`Contains hmpsn logo SVG: ${html.includes('M47.235,5.654')}`);
console.log(`Contains 'Prepared by hmpsn.studio': ${html.includes('Prepared by hmpsn.studio')}`);
console.log(`Contains old 'Asset Dashboard': ${html.includes('Asset Dashboard')}`);
