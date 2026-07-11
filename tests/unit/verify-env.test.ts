import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  PROVIDER_ENV_PROFILES,
  resolveProviderEnvProfile,
  validateProviderEnvironment,
  type ProviderEnvironment,
} from '../../scripts/env-contract.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

const LIVE_SECRETS = {
  DATAFORSEO_LOGIN: 'staging-dataforseo-login',
  DATAFORSEO_PASSWORD: 'staging-dataforseo-password',
  GOOGLE_CLIENT_ID: 'staging-google-client-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'staging-google-client-secret',
  GOOGLE_OAUTH_ENCRYPTION_KEY: 'staging-encryption-key-with-at-least-32-characters',
  GOOGLE_OAUTH_STATE_SECRET: 'staging-oauth-state-secret-with-at-least-32-characters',
  GOOGLE_PSI_KEY: 'staging-pagespeed-key',
} satisfies ProviderEnvironment;

function localFakeEnvironment(): ProviderEnvironment {
  return {
    PROVIDER_ENV_PROFILE: 'local-fake',
    NODE_ENV: 'development',
    LOCAL_FAKE_PROVIDERS: 'true',
    DATA_DIR: '/tmp/asset-dashboard-env-contract-local-fake',
  };
}

function localLiveEnvironment(): ProviderEnvironment {
  return {
    ...LIVE_SECRETS,
    PROVIDER_ENV_PROFILE: 'local-live',
    NODE_ENV: 'development',
    LOCAL_FAKE_PROVIDERS: 'false',
    DATA_DIR: '/tmp/asset-dashboard-env-contract-local-live',
    GOOGLE_REDIRECT_URI: 'http://localhost:3001/api/google/callback',
    GOOGLE_BUSINESS_PROFILE_REDIRECT_URI: 'http://localhost:3001/api/google-business-profile/callback',
  };
}

function stagingEnvironment(): ProviderEnvironment {
  return {
    ...LIVE_SECRETS,
    PROVIDER_ENV_PROFILE: 'staging',
    NODE_ENV: 'production',
    LOCAL_FAKE_PROVIDERS: 'false',
    DATA_DIR: '/var/data/asset-dashboard',
    APP_URL: 'https://asset-dashboard-staging.example.com',
    ALLOWED_ORIGINS: 'https://asset-dashboard-staging.example.com',
    GOOGLE_REDIRECT_URI: 'https://asset-dashboard-staging.example.com/api/google/callback',
    GOOGLE_BUSINESS_PROFILE_REDIRECT_URI: 'https://asset-dashboard-staging.example.com/api/google-business-profile/callback',
  };
}

describe('provider environment contract', () => {
  it('exposes the three canonical readiness profiles', () => {
    expect(PROVIDER_ENV_PROFILES).toEqual(['local-fake', 'local-live', 'staging']);
  });

  it('accepts a local-fake profile without live provider credentials', () => {
    expect(validateProviderEnvironment('local-fake', localFakeEnvironment())).toEqual({
      ok: true,
      profile: 'local-fake',
      issues: [],
    });
  });

  it('accepts complete local-live and staging profiles', () => {
    expect(validateProviderEnvironment('local-live', localLiveEnvironment()).ok).toBe(true);
    expect(validateProviderEnvironment('staging', stagingEnvironment()).ok).toBe(true);
  });

  it('reports every missing live-provider variable by key without exposing secret values', () => {
    const env = localLiveEnvironment();
    const secretSentinel = env.DATAFORSEO_PASSWORD!;
    delete env.DATAFORSEO_PASSWORD;
    delete env.GOOGLE_OAUTH_ENCRYPTION_KEY;
    delete env.GOOGLE_OAUTH_STATE_SECRET;
    delete env.GOOGLE_PSI_KEY;

    const result = validateProviderEnvironment('local-live', env);
    const serialized = JSON.stringify(result);

    expect(result.ok).toBe(false);
    expect(result.issues.map(issue => issue.key)).toEqual(expect.arrayContaining([
      'DATAFORSEO_PASSWORD',
      'GOOGLE_OAUTH_ENCRYPTION_KEY',
      'GOOGLE_OAUTH_STATE_SECRET',
      'GOOGLE_PSI_KEY',
    ]));
    expect(serialized).not.toContain(secretSentinel);
    expect(serialized).not.toContain(LIVE_SECRETS.GOOGLE_CLIENT_SECRET!);
  });

  it('requires staging callbacks to use HTTPS, the canonical paths, and the staging origin', () => {
    const env = stagingEnvironment();
    env.GOOGLE_REDIRECT_URI = 'http://production.example.com/wrong';
    env.GOOGLE_BUSINESS_PROFILE_REDIRECT_URI = 'https://production.example.com/api/google-business-profile/callback';

    const result = validateProviderEnvironment('staging', env);

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'GOOGLE_REDIRECT_URI', code: 'invalid_url' }),
      expect.objectContaining({ key: 'GOOGLE_BUSINESS_PROFILE_REDIRECT_URI', code: 'origin_mismatch' }),
    ]));
  });

  it('enforces profile mode, an absolute isolated DATA_DIR, and retired SEMrush cleanup', () => {
    const env = stagingEnvironment();
    env.LOCAL_FAKE_PROVIDERS = 'true';
    env.DATA_DIR = 'relative/shared-data';
    env.SEMRUSH_API_KEY = 'retired-secret-that-must-not-be-active';

    const result = validateProviderEnvironment('staging', env);

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'LOCAL_FAKE_PROVIDERS', code: 'profile_mismatch' }),
      expect.objectContaining({ key: 'DATA_DIR', code: 'invalid_path' }),
      expect.objectContaining({ key: 'SEMRUSH_API_KEY', code: 'retired' }),
    ]));
    expect(JSON.stringify(result)).not.toContain(env.SEMRUSH_API_KEY);
  });

  it('resolves an explicit CLI profile before the environment and rejects unknown profiles', () => {
    expect(resolveProviderEnvProfile(['--profile=local-live'], { PROVIDER_ENV_PROFILE: 'local-fake' })).toBe('local-live');
    expect(resolveProviderEnvProfile(['--profile', 'local-live'], { PROVIDER_ENV_PROFILE: 'local-fake' })).toBe('local-live');
    expect(resolveProviderEnvProfile([], { PROVIDER_ENV_PROFILE: 'staging' })).toBe('staging');
    expect(() => resolveProviderEnvProfile(['--profile=production'], {})).toThrow(/Unknown provider environment profile/);
    expect(() => resolveProviderEnvProfile([], {})).toThrow(/PROVIDER_ENV_PROFILE/);
  });

  it('keeps the example and Render blueprint on DataForSEO with isolated provider groups', () => {
    const envExample = readFileSync(`${REPO_ROOT}.env.example`, 'utf8');
    const renderBlueprint = readFileSync(`${REPO_ROOT}render.yaml`, 'utf8');
    const requiredExampleKeys = [
      'DATAFORSEO_LOGIN',
      'DATAFORSEO_PASSWORD',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_REDIRECT_URI',
      'GOOGLE_BUSINESS_PROFILE_REDIRECT_URI',
      'GOOGLE_OAUTH_ENCRYPTION_KEY',
      'GOOGLE_OAUTH_STATE_SECRET',
      'GOOGLE_PSI_KEY',
    ];

    for (const key of requiredExampleKeys) {
      expect(envExample).toMatch(new RegExp(`^${key}=`, 'm'));
    }
    expect(envExample).not.toMatch(/^SEMRUSH_API_KEY=/m);
    expect(renderBlueprint).not.toContain('SEMRUSH_API_KEY');
    expect(renderBlueprint).toContain('fromGroup: production-provider-credentials');
    expect(renderBlueprint).toContain('fromGroup: staging-provider-credentials');
    expect(renderBlueprint).not.toContain('fromGroup: shared-google');
    for (const key of [
      'DATAFORSEO_LOGIN',
      'DATAFORSEO_PASSWORD',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_PSI_KEY',
      'GOOGLE_BUSINESS_PROFILE_REDIRECT_URI',
      'GOOGLE_OAUTH_ENCRYPTION_KEY',
      'GOOGLE_OAUTH_STATE_SECRET',
    ]) {
      expect(renderBlueprint.match(new RegExp(`key: ${key}$`, 'gm'))).toHaveLength(2);
    }
  });
});
