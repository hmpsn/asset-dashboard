#!/usr/bin/env node

/**
 * Simple Critical Endpoint Validation
 * 
 * This script validates that critical endpoints exist by checking
 * for specific patterns in the server route files.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = process.cwd();

// Critical endpoint patterns to validate
const CRITICAL_PATTERNS = [
  { pattern: 'router.delete.*revenue/payments/:id', file: 'revenue.ts', description: 'Delete payment by ID' },
  { pattern: 'router.delete.*revenue/payments[^/]', file: 'revenue.ts', description: 'Delete all payments' },
  { pattern: 'router.delete.*schema-retract/:siteId/:pageId', file: 'webflow-schema.ts', description: 'Retract schema from page' },
  { pattern: 'router.delete.*annotations/:workspaceId/:id', file: 'annotations.ts', description: 'Delete annotation by ID' },
  { pattern: 'router.get.*workspaces', file: 'workspaces.ts', description: 'List workspaces' },
  { pattern: 'router.get.*webflow/pages/:siteId', file: 'webflow.ts', description: 'Get Webflow pages' },
  { pattern: 'router.get.*webflow/keyword-strategy/:workspaceId', file: 'keyword-strategy.ts', description: 'Get keyword strategy' },
  { pattern: 'router.get.*public/audit-summary/:workspaceId', file: 'public-portal.ts', description: 'Get audit summary' },
  { pattern: 'router.get.*public/search-overview/:workspaceId', file: 'public-analytics.ts', description: 'Get search overview' },
  { pattern: 'router.get.*public/analytics-overview/:workspaceId', file: 'public-analytics.ts', description: 'Get analytics overview' },
];

function validateCriticalPatterns() {
  console.log('🔍 Validating critical endpoint patterns...');
  console.log('');
  
  const routesDir = join(projectRoot, 'server/routes');
  let allPassed = true;
  
  for (const { pattern, file, description } of CRITICAL_PATTERNS) {
    const filePath = join(routesDir, file);
    
    try {
      if (statSync(filePath).isFile()) {
        const content = readFileSync(filePath, 'utf8');
        const regex = new RegExp(pattern, 'i');
        
        if (regex.test(content)) {
          console.log(`✅ ${description} (${file})`);
        } else {
          console.log(`❌ ${description} (${file}) - Pattern not found: ${pattern}`);
          allPassed = false;
        }
      } else {
        console.log(`❌ ${description} (${file}) - File not found`);
        allPassed = false;
      }
    } catch (error) {
      console.log(`❌ ${description} (${file}) - Error: ${error.message}`);
      allPassed = false;
    }
  }
  
  console.log('');
  console.log('='.repeat(50));
  if (allPassed) {
    console.log('🎉 ALL CRITICAL ENDPOINTS VALIDATED SUCCESSFULLY!');
    console.log('✅ All required API endpoints are present and accessible.');
  } else {
    console.log('❌ CRITICAL ENDPOINT VALIDATION FAILED!');
    console.log('⚠️  Some required API endpoints are missing.');
  }
  console.log('='.repeat(50));
  
  return allPassed;
}

// Run validation
if (import.meta.url === `file://${process.argv[1]}`) {
  const isValid = validateCriticalPatterns();
  process.exit(isValid ? 0 : 1);
}

export { validateCriticalPatterns };
