/**
 * Quick diagnostic: fetch a page and inspect H1 context + hidden element patterns.
 * Usage: npx tsx scripts/diagnose-h1.ts <url>
 *   e.g. npx tsx scripts/diagnose-h1.ts https://swishdental.webflow.io/blog/some-post
 *
 * If no URL given, reads latest audit snapshot from DB to find a page with multiple H1s.
 */
import { extractTag, stripHiddenElements } from '../server/seo-audit-html.js';

const url = process.argv[2];

if (!url) {
  // Try to find a page with multiple H1s from the DB
  const { default: db } = await import('../server/db/index.js');
  const row = db.prepare(`SELECT audit FROM audit_snapshots ORDER BY created_at DESC LIMIT 1`).get() as { audit: string } | undefined;
  if (!row) { console.log('No audit snapshot found and no URL provided.'); process.exit(1); }
  const audit = JSON.parse(row.audit);
  const multiH1Pages = audit.pages?.filter((p: any) => p.issues?.some((i: any) => i.check === 'h1' && i.message?.includes('Multiple')));
  if (!multiH1Pages?.length) { console.log('No pages with multiple H1s found in latest audit.'); process.exit(0); }
  console.log(`Found ${multiH1Pages.length} pages with multiple H1s in latest audit:`);
  for (const p of multiH1Pages.slice(0, 5)) {
    console.log(`  - ${p.slug} (${p.url})`);
  }
  console.log('\nRe-run with a URL: npx tsx scripts/diagnose-h1.ts <url>');
  process.exit(0);
}

console.log(`Fetching: ${url}\n`);
const res = await fetch(url, { redirect: 'follow' });
if (!res.ok) { console.error(`HTTP ${res.status}`); process.exit(1); }
const html = await res.text();
console.log(`HTML length: ${html.length} chars\n`);

// Find all H1 tags
const h1s = extractTag(html, 'h1');
console.log(`H1 tags found: ${h1s.length}`);
h1s.forEach((h, i) => console.log(`  H1 #${i + 1}: "${h.slice(0, 80)}"`));

// Check for known hidden patterns
console.log('\n--- Hidden element patterns ---');
console.log(`w-condition-invisible: ${/w-condition-invisible/i.test(html)}`);
console.log(`inline display:none:   ${/style\s*=\s*["'][^"']*display\s*:\s*none/i.test(html)}`);
console.log(`inline visibility:hidden: ${/style\s*=\s*["'][^"']*visibility\s*:\s*hidden/i.test(html)}`);

// Check for display:none in <style> blocks
const styleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]);
const displayNoneRules: string[] = [];
for (const css of styleBlocks) {
  const ruleMatches = [...css.matchAll(/([^{}]+)\{[^}]*display\s*:\s*none[^}]*\}/gi)];
  for (const rm of ruleMatches) {
    displayNoneRules.push(rm[0].trim().slice(0, 200));
  }
}
console.log(`\ndisplay:none rules in <style> blocks: ${displayNoneRules.length}`);
displayNoneRules.forEach(r => console.log(`  ${r}`));

// Show context around each H1
console.log('\n--- H1 context (200 chars before each <h1>) ---');
const h1Matches = [...html.matchAll(/<h1[^>]*>/gi)];
for (let i = 0; i < h1Matches.length; i++) {
  const m = h1Matches[i];
  const start = Math.max(0, m.index! - 300);
  const end = Math.min(html.length, m.index! + 300);
  const context = html.slice(start, end);
  console.log(`\n=== H1 #${i + 1} at offset ${m.index} ===`);
  console.log(context);
  console.log('=== END ===');
}

// Test stripHiddenElements
console.log('\n--- stripHiddenElements test ---');
const stripped = stripHiddenElements(html);
const strippedH1s = extractTag(stripped, 'h1');
console.log(`Raw HTML: ${html.length} chars, ${h1s.length} H1s`);
console.log(`Stripped HTML: ${stripped.length} chars, ${strippedH1s.length} H1s`);
console.log(`Removed: ${html.length - stripped.length} chars`);
for (let i = 0; i < strippedH1s.length; i++) {
  console.log(`  Remaining H1 #${i + 1}: "${strippedH1s[i].slice(0, 80)}"`);
}
