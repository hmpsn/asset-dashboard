const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);
const LOCAL_ALLOWED_NODE_ENVS = new Set(['', 'development']);

/**
 * Local fake-provider mode is for developer onboarding only.
 * It is intentionally disabled in production regardless of env var value.
 */
export function isLocalFakeProviderModeEnabled(): boolean {
  const nodeEnv = (process.env.NODE_ENV || '').trim().toLowerCase();
  if (!LOCAL_ALLOWED_NODE_ENVS.has(nodeEnv)) return false;
  const raw = process.env.LOCAL_FAKE_PROVIDERS;
  if (!raw) return false;
  return TRUTHY_VALUES.has(raw.trim().toLowerCase());
}

export function localProviderModeLabel(): string {
  return isLocalFakeProviderModeEnabled() ? 'local-fake-providers' : 'live-providers';
}
