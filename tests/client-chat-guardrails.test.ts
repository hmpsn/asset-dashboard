import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('Client chat scope guardrails', () => {
  const src = readFileSync('server/routes/public-analytics.ts', 'utf-8');

  it('blocks content generation requests', () => {
    expect(src).toMatch(/NEVER write, draft, or generate website content/);
  });

  it('blocks general writing assistant misuse', () => {
    expect(src).toMatch(/NEVER act as a general writing assistant/);
  });

  it('blocks competitor research', () => {
    expect(src).toMatch(/NEVER conduct competitor research/);
  });

  it('blocks prompt injection attempts', () => {
    expect(src).toMatch(/ignore previous instructions/i);
  });

  it('blocks pricing or contract discussion', () => {
    expect(src).toMatch(/NEVER discuss pricing, contracts/);
  });
});
