#!/usr/bin/env node

/**
 * API Endpoint Validation Script - Precise Version
 * 
 * This script performs precise validation of API endpoints
 * with smart parameter matching and detailed reporting.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// Colors for output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logError(message) {
  log(`❌ ERROR: ${message}`, colors.red);
}

function logSuccess(message) {
  log(`✅ ${message}`, colors.green);
}

function logWarning(message) {
  log(`⚠️  WARNING: ${message}`, colors.yellow);
}

function logInfo(message) {
  log(`ℹ️  ${message}`, colors.blue);
}

// Extract all API endpoints from server routes
function extractServerEndpoints() {
  const routesDir = join(projectRoot, 'server/routes');
  const endpoints = new Map(); // Map<endpoint, details>
  
  function processFile(filePath) {
    try {
      const content = readFileSync(filePath, 'utf8');
      
      // Extract all router.get/post/patch/del calls with context
      const lines = content.split('\n');
      lines.forEach((line, index) => {
        const match = line.match(/router\.(get|post|patch|del)\s*\(\s*['"`]([^'"`]+)['"`]/);
        if (match) {
          const [full, method, endpoint] = match;
          endpoints.set(endpoint, {
            method,
            endpoint,
            file: filePath.replace(projectRoot, ''),
            line: index + 1,
            context: line.trim()
          });
        }
      });
    } catch (error) {
      logError(`Failed to process ${filePath}: ${error.message}`);
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
      logError(`Failed to read directory ${dirPath}: ${error.message}`);
    }
  }
  
  processDirectory(routesDir);
  return endpoints;
}

// Extract all API calls from frontend
function extractFrontendCalls() {
  const srcDir = join(projectRoot, 'src');
  const calls = new Map(); // Map<endpoint, details>
  
  function processFile(filePath) {
    try {
      const content = readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      
      lines.forEach((line, index) => {
        // Extract fetch calls
        const fetchMatch = line.match(/fetch\s*\(\s*['"`]([^'"`]+)['"`]/);
        if (fetchMatch) {
          const [full, endpoint] = fetchMatch;
          if (endpoint.startsWith('/api/')) {
            calls.set(endpoint, {
              type: 'fetch',
              endpoint,
              file: filePath.replace(projectRoot, ''),
              line: index + 1,
              context: line.trim()
            });
          }
        }
        
        // Extract API client calls (get, post, patch, del)
        const apiMatch = line.match(/\b(get|post|patch|del)\s*\(\s*['"`]([^'"`]+)['"`]/);
        if (apiMatch) {
          const [full, method, endpoint] = apiMatch;
          if (endpoint.startsWith('/api/')) {
            calls.set(endpoint, {
              type: 'api-client',
              method,
              endpoint,
              file: filePath.replace(projectRoot, ''),
              line: index + 1,
              context: line.trim()
            });
          }
        }
      });
    } catch (error) {
      logError(`Failed to process ${filePath}: ${error.message}`);
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
        } else if (item.endsWith('.ts') || item.endsWith('.tsx')) {
          processFile(itemPath);
        }
      }
    } catch (error) {
      logError(`Failed to read directory ${dirPath}: ${error.message}`);
    }
  }
  
  processDirectory(srcDir);
  return calls;
}

// Smart endpoint matching
function matchEndpoints(serverEndpoints, frontendCalls) {
  const errors = [];
  const warnings = [];
  const matches = [];
  
  // Create pattern-based server endpoint map
  const serverPatterns = new Map();
  for (const [endpoint, details] of serverEndpoints) {
    const pattern = endpoint.replace(/:[^\/]+/g, '*');
    if (!serverPatterns.has(pattern)) {
      serverPatterns.set(pattern, []);
    }
    serverPatterns.get(pattern).push({ endpoint, details });
  }
  
  // Check each frontend call
  for (const [call, details] of frontendCalls) {
    // Find matching server pattern
    let matched = false;
    for (const [pattern, serverMatches] of serverPatterns) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '[^/]+') + '$');
      if (regex.test(call)) {
        // Found a match, check if exact or pattern
        if (serverMatches.some(m => m.endpoint === call)) {
          matches.push({ type: 'exact', frontend: { call, details }, server: serverMatches.find(m => m.endpoint === call) });
        } else {
          matches.push({ type: 'pattern', frontend: { call, details }, server: serverMatches[0] });
        }
        matched = true;
        break;
      }
    }
    
    if (!matched) {
      errors.push({
        type: 'NO_SERVER_ROUTE',
        frontend: { call, details }
      });
    }
  }
  
  // Check for unused server endpoints
  const usedServerEndpoints = new Set();
  matches.forEach(match => {
    if (match.type === 'exact') {
      usedServerEndpoints.add(match.server.endpoint);
    }
  });
  
  for (const [endpoint, details] of serverEndpoints) {
    if (!usedServerEndpoints.has(endpoint)) {
      warnings.push({
        type: 'UNUSED_SERVER_ROUTE',
        server: { endpoint, details }
      });
    }
  }
  
  return { errors, warnings, matches };
}

// Validate endpoints
function validateEndpoints() {
  logInfo('Starting precise API endpoint validation...', colors.bold);
  log('');
  
  logInfo('Extracting server endpoints...', colors.cyan);
  const serverEndpoints = extractServerEndpoints();
  logSuccess(`Found ${serverEndpoints.size} server endpoints`);
  
  logInfo('Extracting frontend API calls...', colors.cyan);
  const frontendCalls = extractFrontendCalls();
  logSuccess(`Found ${frontendCalls.size} frontend API calls`);
  
  log('');
  logInfo('Matching endpoints...', colors.cyan);
  
  const { errors, warnings, matches } = matchEndpoints(serverEndpoints, frontendCalls);
  
  // Report results
  log('');
  log('='.repeat(80), colors.bold);
  log('VALIDATION RESULTS', colors.bold);
  log('='.repeat(80), colors.bold);
  log('');
  
  if (errors.length === 0) {
    logSuccess('🎉 NO CRITICAL ERRORS! All frontend calls have matching server routes.');
  } else {
    logError(`Found ${errors.length} CRITICAL errors:`);
    log('');
    
    errors.forEach((error, index) => {
      log(`${index + 1}. ${error.type}`, colors.red + colors.bold);
      log(`   Frontend: ${error.frontend.call}`);
      log(`   File: ${error.frontend.details.file}:${error.frontend.details.line}`);
      log(`   Context: ${error.frontend.details.context}`);
      log('');
    });
  }
  
  // Report warnings (only show first 10)
  if (warnings.length > 0) {
    logWarning(`Found ${warnings.length} warnings (unused server routes - showing first 10):`);
    log('');
    
    warnings.slice(0, 10).forEach((warning, index) => {
      log(`${index + 1}. ${warning.type}`, colors.yellow + colors.bold);
      log(`   Server: ${warning.server.endpoint}`);
      log(`   File: ${warning.server.details.file}:${warning.server.details.line}`);
      log('');
    });
    
    if (warnings.length > 10) {
      logInfo(`... and ${warnings.length - 10} more unused routes`);
    }
  }
  
  // Show match statistics
  const exactMatches = matches.filter(m => m.type === 'exact').length;
  const patternMatches = matches.filter(m => m.type === 'pattern').length;
  
  log('');
  log('='.repeat(80), colors.bold);
  log('MATCH STATISTICS', colors.bold);
  log('='.repeat(80), colors.bold);
  log('');
  logSuccess(`Exact matches: ${exactMatches}`);
  logWarning(`Pattern matches: ${patternMatches}`);
  logInfo(`Total matches: ${matches.length}`);
  logInfo(`Server endpoints: ${serverEndpoints.size}`);
  logInfo(`Frontend calls: ${frontendCalls.size}`);
  logError(`Critical errors: ${errors.length}`);
  logWarning(`Unused server routes: ${warnings.length}`);
  
  // Show pattern matches (potential issues)
  if (patternMatches > 0) {
    log('');
    logWarning('PATTERN MATCHES (may need attention):');
    log('');
    
    matches.filter(m => m.type === 'pattern').slice(0, 5).forEach((match, index) => {
      log(`${index + 1}. Pattern match`, colors.yellow);
      log(`   Frontend: ${match.frontend.call}`);
      log(`   Server pattern: ${match.server.endpoint.replace(/:[^\/]+/g, '*')}`);
      log('');
    });
    
    if (patternMatches > 5) {
      logInfo(`... and ${patternMatches - 5} more pattern matches`);
    }
  }
  
  return errors.length === 0;
}

// Run validation
if (import.meta.url === `file://${process.argv[1]}`) {
  const isValid = validateEndpoints();
  process.exit(isValid ? 0 : 1);
}

export { validateEndpoints };
