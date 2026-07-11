#!/usr/bin/env tsx

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ICON_NAMES } from '../src/components/ui/iconNames';

const ROOT = path.join(import.meta.dirname, '..');

export const FONT_AWESOME_FULL_CSS_PATH = path.join(
  ROOT,
  'public/vendor/fontawesome/fontawesome.min.css',
);
export const FONT_AWESOME_SHARP_REGULAR_CSS_PATH = path.join(
  ROOT,
  'public/vendor/fontawesome/sharp-regular.min.css',
);
export const FONT_AWESOME_SUBSET_CSS_PATH = path.join(
  ROOT,
  'public/vendor/fontawesome/fontawesome-sharp-regular-subset.min.css',
);

const CHARSET = '@charset "utf-8";';
const FIRST_OPTIONAL_UTILITY = '.fa-1x{';
const LICENSE_PATTERN = /^\/\*![\s\S]*?\*\//;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readRequiredFile(filePath: string): string {
  if (!existsSync(filePath)) {
    throw new Error(`Missing Font Awesome source: ${path.relative(ROOT, filePath)}`);
  }
  return readFileSync(filePath, 'utf8');
}

export function registeredFontAwesomeGlyphs(): string[] {
  return [...new Set(Object.values(ICON_NAMES))].sort();
}

function extractLicenseHeader(sharpRegularCss: string): string {
  const match = sharpRegularCss.match(LICENSE_PATTERN);
  if (!match) {
    throw new Error('Font Awesome Sharp Regular source is missing its license header.');
  }
  return match[0];
}

function extractBaseRules(fullCss: string): string {
  if (!fullCss.startsWith(CHARSET)) {
    throw new Error(`Font Awesome source must start with ${CHARSET}`);
  }
  const utilityStart = fullCss.indexOf(FIRST_OPTIONAL_UTILITY);
  if (utilityStart < 0) {
    throw new Error(`Font Awesome source is missing the ${FIRST_OPTIONAL_UTILITY} boundary.`);
  }

  // Everything before the first optional sizing utility is Font Awesome's exact
  // family/style, rendering, pseudo-element, and fallback behavior. Keeping the
  // source segment verbatim avoids maintaining a hand-written approximation.
  return fullCss.slice(CHARSET.length, utilityStart);
}

function extractGlyphRule(fullCss: string, glyph: string): string {
  const pattern = new RegExp(`\\.fa-${escapeRegExp(glyph)}\\{--fa:"[^"]+"\\}`, 'gu');
  const matches = [...fullCss.matchAll(pattern)].map(match => match[0]);
  if (matches.length !== 1) {
    throw new Error(
      `Expected one Font Awesome rule for fa-${glyph}; found ${matches.length}.`,
    );
  }
  return matches[0];
}

export function buildFontAwesomeSubsetCss(
  fullCss = readRequiredFile(FONT_AWESOME_FULL_CSS_PATH),
  sharpRegularCss = readRequiredFile(FONT_AWESOME_SHARP_REGULAR_CSS_PATH),
): string {
  const license = extractLicenseHeader(sharpRegularCss);
  const baseRules = extractBaseRules(fullCss);
  const glyphRules = registeredFontAwesomeGlyphs()
    .map(glyph => extractGlyphRule(fullCss, glyph))
    .join('');

  // @charset must remain the first statement. The commercial-license banner is
  // copied verbatim from the still-linked Sharp Regular distribution asset.
  return `${CHARSET}${license}\n${baseRules}${glyphRules}\n`;
}

export function writeFontAwesomeSubsetCss(): 'updated' | 'unchanged' {
  const next = buildFontAwesomeSubsetCss();
  if (existsSync(FONT_AWESOME_SUBSET_CSS_PATH)) {
    const current = readFileSync(FONT_AWESOME_SUBSET_CSS_PATH, 'utf8');
    if (current === next) return 'unchanged';
  }
  writeFileSync(FONT_AWESOME_SUBSET_CSS_PATH, next, 'utf8');
  return 'updated';
}

function main(): void {
  const status = writeFontAwesomeSubsetCss();
  console.log(
    `${status === 'updated' ? 'Generated' : 'Verified'} ${path.relative(ROOT, FONT_AWESOME_SUBSET_CSS_PATH)} `
      + `(${registeredFontAwesomeGlyphs().length} registry glyphs).`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
