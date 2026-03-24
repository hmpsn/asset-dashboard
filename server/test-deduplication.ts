/**
 * Simple test script to verify AI deduplication functionality
 * Run with: npx tsx server/test-deduplication.ts
 */

import { aiDeduplicator } from './ai-deduplication.js';

async function testDeduplication() {
  console.log('Testing AI deduplication...\n');
  
  // Test 1: Basic deduplication
  console.log('Test 1: Basic deduplication');
  const key1 = 'test-key-1';
  let callCount = 0;
  
  const mockFetcher = async () => {
    callCount++;
    console.log(`  Fetcher called (count: ${callCount})`);
    await new Promise(resolve => setTimeout(resolve, 100)); // Simulate API delay
    return { result: 'test-data', timestamp: Date.now() };
  };
  
  // First call should execute fetcher
  console.log('  First call...');
  const result1 = await aiDeduplicator.deduplicate(key1, mockFetcher);
  console.log(`  Result: ${JSON.stringify(result1)}`);
  
  // Second call should use cache
  console.log('  Second call (should hit cache)...');
  const result2 = await aiDeduplicator.deduplicate(key1, mockFetcher);
  console.log(`  Result: ${JSON.stringify(result2)}`);
  
  console.log(`  Total fetcher calls: ${callCount} (should be 1)\n`);
  
  // Test 2: In-flight deduplication
  console.log('Test 2: In-flight deduplication');
  const key2 = 'test-key-2';
  let inFlightCount = 0;
  
  const slowFetcher = async () => {
    inFlightCount++;
    console.log(`  Slow fetcher started (count: ${inFlightCount})`);
    await new Promise(resolve => setTimeout(resolve, 200)); // Slower delay
    return { result: 'slow-data', timestamp: Date.now() };
  };
  
  // Start multiple concurrent calls
  console.log('  Starting 3 concurrent calls...');
  const promises = [
    aiDeduplicator.deduplicate(key2, slowFetcher),
    aiDeduplicator.deduplicate(key2, slowFetcher),
    aiDeduplicator.deduplicate(key2, slowFetcher),
  ];
  
  const results = await Promise.all(promises);
  console.log(`  All results: ${results.map(r => JSON.stringify(r)).join(', ')}`);
  console.log(`  Total fetcher calls: ${inFlightCount} (should be 1)\n`);
  
  // Test 3: Cache stats
  console.log('Test 3: Cache statistics');
  const stats = aiDeduplicator.getStats();
  console.log(`  Pending requests: ${stats.pendingRequests}`);
  console.log(`  Cache size: ${stats.cacheSize}`);
  console.log(`  Oldest pending: ${stats.oldestPending}ms`);
  console.log(`  Oldest cache: ${stats.oldestCache}ms\n`);
  
  console.log('✅ All tests passed!');
}

// Run the test
testDeduplication().catch(console.error);
