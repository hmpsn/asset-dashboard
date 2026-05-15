import { afterEach, describe, expect, it } from 'vitest';
import { isLocalFakeProviderModeEnabled, localProviderModeLabel } from '../../server/local-provider-mode.js';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_LOCAL_FAKE_PROVIDERS = process.env.LOCAL_FAKE_PROVIDERS;

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  process.env.LOCAL_FAKE_PROVIDERS = ORIGINAL_LOCAL_FAKE_PROVIDERS;
});

describe('local provider mode', () => {
  it('enables fake mode in non-production when LOCAL_FAKE_PROVIDERS is truthy', () => {
    process.env.NODE_ENV = 'development';
    process.env.LOCAL_FAKE_PROVIDERS = 'true';
    expect(isLocalFakeProviderModeEnabled()).toBe(true);
    expect(localProviderModeLabel()).toBe('local-fake-providers');
  });

  it('keeps fake mode disabled in production regardless of env flag', () => {
    process.env.NODE_ENV = 'production';
    process.env.LOCAL_FAKE_PROVIDERS = 'true';
    expect(isLocalFakeProviderModeEnabled()).toBe(false);
    expect(localProviderModeLabel()).toBe('live-providers');
  });

  it('keeps fake mode disabled in non-local environments', () => {
    process.env.NODE_ENV = 'staging';
    process.env.LOCAL_FAKE_PROVIDERS = 'true';
    expect(isLocalFakeProviderModeEnabled()).toBe(false);
    expect(localProviderModeLabel()).toBe('live-providers');
  });
});
