import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertDemoSeedEnvironmentSafe, DEMO_WORKSPACES } from '../../scripts/seed-demo-workspaces.ts';
import type { ClientActionSourceType } from '../../shared/types/client-actions.ts';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_OVERRIDE = process.env.ALLOW_NON_LOCAL_DEMO_SEED;

// R5-PR2 (B9) phantom-entry cleanup: scripts/seed-demo-workspaces.ts seeded a
// client_actions row with source_type='content_post', which is NOT a member of
// ClientActionSourceType (shared/types/client-actions.ts). server/client-actions.ts
// silently coerces any out-of-union source_type to 'aeo_change' at read time, so the
// bug was invisible at runtime — this is a static source-scan guard against
// regressing it. See docs/rules/action-catalog.md "Historical / additive-only
// vocabulary" section.
const VALID_CLIENT_ACTION_SOURCE_TYPES: ClientActionSourceType[] = [
  'aeo_change',
  'internal_link',
  'redirect_proposal',
  'content_decay',
  'cannibalization',
];

function readSeedScriptSource(): string {
  const filePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/seed-demo-workspaces.ts');
  return readFileSync(filePath, 'utf-8');
}

describe('seed demo workspaces — client_actions.source_type is in-union', () => {
  it('the seeded client_actions INSERT never uses an out-of-union source_type literal', () => {
    const source = readSeedScriptSource();
    const insertMatch = source.match(
      /INSERT INTO client_actions[\s\S]*?\.run\(([\s\S]*?)\);/,
    );
    expect(insertMatch, 'client_actions INSERT block found in seed script').toBeTruthy();

    const runArgsBlock = insertMatch![1];
    // Positional args are (id, seed.id, source_type, source_id, ...). `seed.id` is not a
    // string literal, so the source_type literal is the SECOND quoted string in the block
    // (the first is the row id, e.g. 'client_action_demo_premium_1').
    const stringLiterals = [...runArgsBlock.matchAll(/'([^']*)'/g)].map(m => m[1]);
    const sourceTypeLiteral = stringLiterals[1];
    expect(sourceTypeLiteral).toBeDefined();
    expect(
      VALID_CLIENT_ACTION_SOURCE_TYPES,
      `seeded client_actions.source_type "${sourceTypeLiteral}" must be a member of ClientActionSourceType`,
    ).toContain(sourceTypeLiteral);
  });

  it('never reintroduces the historical out-of-union "content_post" literal as a client_actions source_type', () => {
    const source = readSeedScriptSource();
    expect(source).not.toMatch(/'content_post',\s*\n\s*'post_demo_premium_1'/);
  });
});

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  process.env.ALLOW_NON_LOCAL_DEMO_SEED = ORIGINAL_OVERRIDE;
});

describe('seed demo workspaces safety', () => {
  it('throws in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_NON_LOCAL_DEMO_SEED = 'true';
    expect(() => assertDemoSeedEnvironmentSafe()).toThrow('blocked in production');
  });

  it('allows local development by default', () => {
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_NON_LOCAL_DEMO_SEED = '';
    expect(() => assertDemoSeedEnvironmentSafe()).not.toThrow();
  });

  it('requires explicit override in non-local environments', () => {
    process.env.NODE_ENV = 'staging';
    process.env.ALLOW_NON_LOCAL_DEMO_SEED = '';
    expect(() => assertDemoSeedEnvironmentSafe()).toThrow('restricted to local/test');

    process.env.ALLOW_NON_LOCAL_DEMO_SEED = 'true';
    expect(() => assertDemoSeedEnvironmentSafe()).not.toThrow();
  });

  it('defines deterministic scenario coverage for QA/demo workspaces', () => {
    const ids = DEMO_WORKSPACES.map(workspace => workspace.id);
    const scenarios = DEMO_WORKSPACES.map(workspace => workspace.scenario);
    const uniqueIds = new Set(ids);
    const uniqueScenarios = new Set(scenarios);

    expect(DEMO_WORKSPACES).toHaveLength(6);
    expect(uniqueIds.size).toBe(ids.length);
    expect(uniqueScenarios).toEqual(new Set([
      'empty-new',
      'free-client',
      'growth-active',
      'premium-history',
      'broken-integrations',
      'rich-cms',
    ]));
  });

  it('keeps broken-integration fixture deterministic and intentionally disconnected', () => {
    const broken = DEMO_WORKSPACES.find(workspace => workspace.scenario === 'broken-integrations');
    expect(broken).toBeDefined();
    expect(broken?.webflowSiteId).toBeNull();
    expect(broken?.webflowToken).toBeNull();
    expect(broken?.gscPropertyUrl).toBeNull();
    expect(broken?.ga4PropertyId).toBeNull();
    expect(broken?.seoDataProvider).toBe('dataforseo');
  });
});
