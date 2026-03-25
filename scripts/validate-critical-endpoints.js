#!/usr/bin/env node

/**
 * Build-time API Endpoint Validation
 * 
 * This script runs during build to validate critical endpoints
 * that are actually used in production.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// Critical endpoints that must work
const CRITICAL_ENDPOINTS = [
  '/api/workspaces',
  '/api/workspaces/:id',
  '/api/webflow/pages/:siteId',
  '/api/webflow/keyword-strategy/:workspaceId',
  '/api/content-briefs/:workspaceId',
  '/api/content-posts/:workspaceId',
  '/api/public/audit-summary/:workspaceId',
  '/api/public/search-overview/:workspaceId',
  '/api/public/analytics-overview/:workspaceId',
  '/api/public/roi/:workspaceId',
  '/api/workspace-home/:id',
  '/api/workspace-overview',
  '/api/audit-traffic/:siteId',
  '/api/audit-schedules/:workspaceId',
  '/api/semrush/status',
  '/api/stripe/config',
  '/api/webflow/sites',
  '/api/webflow/seo-rewrite',
  '/api/public/requests/:workspaceId',
  '/api/public/approvals/:workspaceId',
  '/api/public/content-requests/:workspaceId',
  '/api/public/seo-strategy/:workspaceId',
  '/api/public/keyword-feedback/:workspaceId',
  '/api/public/tracked-keywords/:workspaceId',
  '/api/public/content-performance/:workspaceId',
  '/api/public/workspace/:id',
  '/api/rank-tracking/:workspaceId/keywords',
  '/api/rank-tracking/:workspaceId/latest',
  '/api/annotations/:workspaceId',
  '/api/annotations/:workspaceId/:id',
  '/api/revenue/payments/:id',
  '/api/revenue/payments',
  '/api/webflow/schema-retract/:siteId/:pageId',
  '/api/webflow/schema-plan/:siteId',
  '/api/webflow/schema-suggestions/:siteId',
  '/api/webflow/seo-audit/:siteId',
  '/api/webflow/bulk-generate-alt',
  '/api/anomalies/scan',
  '/api/audit-schedules/:workspaceId',
  '/api/content-matrices/:workspaceId',
  '/api/content-decay/:workspaceId',
  '/api/content-posts/:workspaceId/:postId',
  '/api/content-briefs/:workspaceId/:briefId',
  '/api/content-requests/:workspaceId/:requestId',
  '/api/workspaces/:id/audit-suppressions',
  '/api/workspaces/:id/page-states/:pageId',
  '/api/workspaces/:id/client-users',
];

// Extract server endpoints
function extractServerEndpoints() {
  const routesDir = join(projectRoot, 'server/routes');
  const endpoints = new Set();
  
  function processFile(filePath) {
    try {
      const content = readFileSync(filePath, 'utf8');
      const matches = content.match(/router\.(get|post|patch|del)\s*\(\s*['"`]([^'"`]+)['"`]/g);
      if (matches) {
        matches.forEach(match => {
          const endpointMatch = match.match(/['"`]([^'"`]+)['"`]/);
          if (endpointMatch) {
            endpoints.add(endpointMatch[1]);
          }
        });
      }
    } catch (error) {
      console.error(`Failed to process ${filePath}: ${error.message}`);
    }
  }
  
  function processDirectory(dirPath) {
    try {
      const items = readdirSync(dirPath);
      for (const item of items) {
        const itemPath = join(dirPath, item);
        const stat = statSync(itemPath);
        
        if (stat.isDirectory()) {
          processDirectory(itemPath);
        } else if (item.endsWith('.ts')) {
          processFile(itemPath);
        }
      }
    } catch (error) {
      console.error(`Failed to read directory ${dirPath}: ${error.message}`);
    }
  }
  
  processDirectory(routesDir);
  return Array.from(endpoints);
}

// Check if endpoint pattern exists
function endpointExists(pattern, serverEndpoints) {
  // Convert pattern to regex, handle multiple parameters correctly
  const regex = new RegExp('^' + pattern.replace(/:[^\/]+/g, '[^/]+').replace(/\?/g, '\\?') + '$');
  return serverEndpoints.some(endpoint => regex.test(endpoint));
}

// Validate critical endpoints
function validateCriticalEndpoints() {
  console.log('🔍 Validating critical API endpoints...');
  
  const serverEndpoints = extractServerEndpoints();
  const errors = [];
  const warnings = [];
  
  CRITICAL_ENDPOINTS.forEach(pattern => {
    if (endpointExists(pattern, serverEndpoints)) {
      console.log(`✅ ${pattern}`);
    } else {
      // Check if there's a close match
      const closeMatches = serverEndpoints.filter(ep => 
        ep.startsWith(pattern.split(':')[0]) || 
        pattern.split(':')[0].startsWith(ep.split(':')[0])
      );
      
      if (closeMatches.length > 0) {
        console.log(`⚠️  ${pattern} (possible matches: ${closeMatches.slice(0, 3).join(', ')})`);
        warnings.push({ pattern, matches: closeMatches });
      } else {
        console.log(`❌ ${pattern}`);
        errors.push({ pattern });
      }
    }
  });
  
  console.log(`\n📊 Summary:`);
  console.log(`   Critical endpoints: ${CRITICAL_ENDPOINTS.length}`);
  console.log(`   Server endpoints: ${serverEndpoints.length}`);
  console.log(`   ✅ Found: ${CRITICAL_ENDPOINTS.length - errors.length - warnings.length}`);
  console.log(`   ⚠️  Warnings: ${warnings.length}`);
  console.log(`   ❌ Errors: ${errors.length}`);
  
  if (errors.length > 0) {
    console.log(`\n❌ Missing endpoints:`);
    errors.forEach(error => {
      console.log(`   - ${error.pattern}`);
    });
    return false;
  }
  
  if (warnings.length > 0) {
    console.log(`\n⚠️  Endpoints with warnings:`);
    warnings.forEach(warning => {
      console.log(`   - ${warning.pattern} (matches: ${warning.matches.slice(0, 2).join(', ')})`);
    });
  }
  
  console.log(`\n🎉 Critical endpoint validation passed!`);
  return true;
}

// Run validation
if (import.meta.url === `file://${process.argv[1]}`) {
  const isValid = validateCriticalEndpoints();
  process.exit(isValid ? 0 : 1);
}

export { validateCriticalEndpoints };
