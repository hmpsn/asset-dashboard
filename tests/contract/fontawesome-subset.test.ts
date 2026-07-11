import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ICON_NAMES } from '../../src/components/ui/iconNames';
import {
  buildFontAwesomeSubsetCss,
  FONT_AWESOME_FULL_CSS_PATH,
  FONT_AWESOME_SHARP_REGULAR_CSS_PATH,
  FONT_AWESOME_SUBSET_CSS_PATH,
  registeredFontAwesomeGlyphs,
} from '../../scripts/generate-fontawesome-subset';

const ROOT = path.join(import.meta.dirname, '../..');
const INDEX_PATH = path.join(ROOT, 'index.html');

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('Font Awesome Sharp Regular generated subset', () => {
  it('is the linked glyph stylesheet while the full licensed source stays unlinked', () => {
    const index = readFileSync(INDEX_PATH, 'utf8');

    expect(index).toContain('/vendor/fontawesome/fontawesome-sharp-regular-subset.min.css');
    expect(index).toContain('/vendor/fontawesome/sharp-regular.min.css');
    expect(index).toContain('/fonts/fa-sharp-regular-400.woff2');
    expect(index).not.toMatch(/href=["']\/vendor\/fontawesome\/fontawesome\.min\.css["']/);
    expect(existsSync(FONT_AWESOME_FULL_CSS_PATH)).toBe(true);
  });

  it('contains every imported registry glyph exactly once with its licensed source codepoint', () => {
    const fullCss = readFileSync(FONT_AWESOME_FULL_CSS_PATH, 'utf8');
    const subset = readFileSync(FONT_AWESOME_SUBSET_CSS_PATH, 'utf8');
    const expectedGlyphs = [...new Set(Object.values(ICON_NAMES))].sort();

    expect(registeredFontAwesomeGlyphs()).toEqual(expectedGlyphs);
    for (const glyph of expectedGlyphs) {
      const pattern = new RegExp(`\\.fa-${escapeRegExp(glyph)}\\{--fa:"[^"]+"\\}`, 'gu');
      const sourceRules = [...fullCss.matchAll(pattern)].map(match => match[0]);
      const subsetRules = [...subset.matchAll(pattern)].map(match => match[0]);
      expect(sourceRules, `licensed source rule for fa-${glyph}`).toHaveLength(1);
      expect(subsetRules, `generated subset rule for fa-${glyph}`).toEqual(sourceRules);
    }
  });

  it('preserves exact base rendering and Sharp Regular family semantics', () => {
    const fullCss = readFileSync(FONT_AWESOME_FULL_CSS_PATH, 'utf8');
    const sharpCss = readFileSync(FONT_AWESOME_SHARP_REGULAR_CSS_PATH, 'utf8');
    const subset = readFileSync(FONT_AWESOME_SUBSET_CSS_PATH, 'utf8');
    const baseBoundary = fullCss.indexOf('.fa-1x{');
    const exactBase = fullCss.slice('@charset "utf-8";'.length, baseBoundary);
    const license = sharpCss.match(/^\/\*![\s\S]*?\*\//)?.[0];

    expect(baseBoundary).toBeGreaterThan(0);
    expect(license).toBeTruthy();
    expect(subset).toContain(license!);
    expect(subset).toContain(exactBase);
    expect(subset).toContain('font-family:var(--_fa-family)');
    expect(subset).toContain('content:var(--fa)/""');
    expect(sharpCss).toContain('.fa-sharp,.fasr{--fa-family:var(--fa-family-sharp)}');
    expect(sharpCss).toContain('.fa-regular{--fa-style:400}');
  });

  it('matches deterministic generator output byte for byte', () => {
    const generatedOnce = buildFontAwesomeSubsetCss();
    const generatedTwice = buildFontAwesomeSubsetCss();
    const artifact = readFileSync(FONT_AWESOME_SUBSET_CSS_PATH, 'utf8');

    expect(generatedTwice).toBe(generatedOnce);
    expect(artifact).toBe(generatedOnce);
  });
});
