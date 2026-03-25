#!/usr/bin/env node

/**
 * API Endpoint Validation Script
 * 
 * This script performs comprehensive validation of all API endpoints
 * to ensure frontend calls match server routes exactly.
 * 
 * Usage: node scripts/validate-endpoints.js
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
  const endpoints = new Set();
  
  function processFile(filePath) {
    try {
      const content = readFileSync(filePath, 'utf8');
      
      // Extract all router.get/post/patch/del calls
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
  return Array.from(endpoints).sort();
}

// Extract all API calls from frontend
function extractFrontendCalls() {
  const srcDir = join(projectRoot, 'src');
  const calls = new Set();
  
  function processFile(filePath) {
    try {
      const content = readFileSync(filePath, 'utf8');
      
      // Extract fetch calls
      const fetchMatches = content.match(/fetch\s*\(\s*['"`]([^'"`]+)['"`]/g);
      if (fetchMatches) {
        fetchMatches.forEach(match => {
          const endpointMatch = match.match(/['"`]([^'"`]+)['"`]/);
          if (endpointMatch && endpointMatch[1].startsWith('/api/')) {
            calls.add(endpointMatch[1]);
          }
        });
      }
      
      // Extract API client calls (get, post, patch, del)
      const apiMatches = content.match(/\b(get|post|patch|del)\s*\(\s*['"`]([^'"`]+)['"`]/g);
      if (apiMatches) {
        apiMatches.forEach(match => {
          const endpointMatch = match.match(/['"`]([^'"`]+)['"`]/);
          if (endpointMatch && endpointMatch[1].startsWith('/api/')) {
            calls.add(endpointMatch[1]);
          }
        });
      }
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
  return Array.from(calls).sort();
}

// Normalize endpoints for comparison (handle path parameters)
function normalizeEndpoint(endpoint) {
  return endpoint.replace(/:[^\/]+/g, ':param');
}

// Validate endpoints
function validateEndpoints() {
  logInfo('Starting comprehensive API endpoint validation...', colors.bold);
  log('');
  
  logInfo('Extracting server endpoints...', colors.cyan);
  const serverEndpoints = extractServerEndpoints();
  logSuccess(`Found ${serverEndpoints.length} server endpoints`);
  
  logInfo('Extracting frontend API calls...', colors.cyan);
  const frontendCalls = extractFrontendCalls();
  logSuccess(`Found ${frontendCalls.length} frontend API calls`);
  
  log('');
  logInfo('Validating endpoint matches...', colors.cyan);
  
  // Normalize for comparison
  const normalizedServer = new Map();
  serverEndpoints.forEach(ep => {
    const normalized = normalizeEndpoint(ep);
    if (!normalizedServer.has(normalized)) {
      normalizedServer.set(normalized, []);
    }
    normalizedServer.get(normalized).push(ep);
  });
  
  const normalizedFrontend = new Map();
  frontendCalls.forEach(call => {
    const normalized = normalizeEndpoint(call);
    if (!normalizedFrontend.has(normalized)) {
      normalizedFrontend.set(normalized, []);
    }
    normalizedFrontend.get(normalized).push(call);
  });
  
  // Find mismatches
  const errors = [];
  const warnings = [];
  
  // Check frontend calls against server endpoints
  for (const [normalized, calls] of normalizedFrontend) {
    if (!normalizedServer.has(normalized)) {
      errors.push({
        type: 'FRONTEND_CALL_NO_SERVER_ROUTE',
        frontendCalls: calls,
        normalized
      });
    }
  }
  
  // Check for unused server endpoints
  for (const [normalized, endpoints] of normalizedServer) {
    if (!normalizedFrontend.has(normalized)) {
      warnings.push({
        type: 'SERVER_ROUTE_NO_FRONTEND_CALL',
        serverEndpoints: endpoints,
        normalized
      });
    }
  }
  
  // Report results
  log('');
  log('='.repeat(80), colors.bold);
  log('VALIDATION RESULTS', colors.bold);
  log('='.repeat(80), colors.bold);
  log('');
  
  if (errors.length === 0 && warnings.length === 0) {
    logSuccess('🎉 PERFECT! All endpoints are properly matched!');
    logSuccess(`✅ ${frontendCalls.length} frontend calls → ${serverEndpoints.length} server routes`);
    return true;
  }
  
  // Report errors
  if (errors.length > 0) {
    logError(`Found ${errors.length} CRITICAL errors:`);
    log('');
    
    errors.forEach((error, index) => {
      log(`${index + 1}. ${error.type}`, colors.red + colors.bold);
      log(`   Normalized: ${error.normalized}`);
      log(`   Frontend calls: ${error.frontendCalls.join(', ')}`);
      log('');
    });
  }
  
  // Report warnings
  if (warnings.length > 0) {
    logWarning(`Found ${warnings.length} warnings (unused server routes):`);
    log('');
    
    warnings.forEach((warning, index) => {
      log(`${index + 1}. ${warning.type}`, colors.yellow + colors.bold);
      log(`   Normalized: ${warning.normalized}`);
      log(`   Server routes: ${warning.serverEndpoints.join(', ')}`);
      log('');
    });
  }
  
  // Summary
  log('='.repeat(80), colors.bold);
  log('SUMMARY', colors.bold);
  log('='.repeat(80), colors.bold);
  log('');
  logInfo(`Server endpoints: ${serverEndpoints.length}`);
  logInfo(`Frontend calls: ${frontendCalls.length}`);
  logError(`Critical errors: ${errors.length}`);
  logWarning(`Warnings: ${warnings.length}`);
  
  return errors.length === 0;
}

// Run validation
if (import.meta.url === `file://${process.argv[1]}`) {
  const isValid = validateEndpoints();
  process.exit(isValid ? 0 : 1);
}

export { validateEndpoints, extractServerEndpoints, extractFrontendCalls };
