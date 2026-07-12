import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const tokenSource = readFileSync('src/tokens.css', 'utf-8'); // readFile-ok - design-system contract guard: .t-* utility sizes must stay aligned to token authority.
const indexSource = readFileSync('src/index.css', 'utf-8'); // readFile-ok - design-system contract guard: .t-* utility sizes must stay aligned to token authority.

function tokenValue(name: string): string {
  const match = tokenSource.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`Missing token ${name}`);
  return match[1].trim();
}

function utilityFontSize(className: string): string {
  const match = indexSource.match(new RegExp(`\\.${className}\\s*\\{[\\s\\S]*?font-size:\\s*([^;]+);[\\s\\S]*?\\}`));
  if (!match) throw new Error(`Missing typography utility .${className}`);
  return match[1].trim();
}

describe('typography token parity', () => {
  const utilityToToken = {
    't-hero': '--type-hero-size',
    't-h1': '--type-h1-size',
    't-h2': '--type-h2-size',
    't-stat-lg': '--type-stat-lg-size',
    't-stat': '--type-stat-size',
    't-stat-sm': '--type-stat-sm-size',
    't-page': '--type-page-size',
    't-body': '--type-body-size',
    't-ui': '--type-ui-size',
    't-label': '--type-label-size',
    't-caption': '--type-caption-size',
    't-caption-sm': '--type-caption-size',
    't-mono': '--type-mono-size',
    't-micro': '--type-micro-size',
  } as const;

  for (const [className, tokenName] of Object.entries(utilityToToken)) {
    it(`keeps .${className} font-size aligned to ${tokenName}`, () => {
      expect(utilityFontSize(className)).toBe(tokenValue(tokenName));
    });
  }
});
