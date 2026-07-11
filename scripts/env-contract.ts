import path from 'node:path';
export const PROVIDER_ENV_PROFILES = ['local-fake', 'local-live', 'staging'] as const;
export type ProviderEnvProfile = typeof PROVIDER_ENV_PROFILES[number];
export type ProviderEnvironment = Record<string, string | undefined>;
export type ProviderEnvIssueCode =
  | 'missing'
  | 'invalid_path'
  | 'invalid_url'
  | 'origin_mismatch'
  | 'profile_mismatch'
  | 'retired'
  | 'too_short';
export interface ProviderEnvIssue {
  key: string;
  code: ProviderEnvIssueCode;
  message: string;
}
export interface ProviderEnvValidationResult {
  ok: boolean;
  profile: ProviderEnvProfile;
  issues: ProviderEnvIssue[];
}
const PROFILE_SET = new Set<string>(PROVIDER_ENV_PROFILES);
const BASE_REQUIRED_KEYS = [
  'PROVIDER_ENV_PROFILE',
  'NODE_ENV',
  'LOCAL_FAKE_PROVIDERS',
  'DATA_DIR',
] as const;
const LIVE_PROVIDER_REQUIRED_KEYS = [
  'DATAFORSEO_LOGIN',
  'DATAFORSEO_PASSWORD',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  'GOOGLE_BUSINESS_PROFILE_REDIRECT_URI',
  'GOOGLE_OAUTH_ENCRYPTION_KEY',
  'GOOGLE_OAUTH_STATE_SECRET',
  'GOOGLE_PSI_KEY',
] as const;
const STAGING_REQUIRED_KEYS = ['APP_URL', 'ALLOWED_ORIGINS'] as const;
const SECRET_MINIMUM_LENGTH_KEYS = ['GOOGLE_OAUTH_ENCRYPTION_KEY', 'GOOGLE_OAUTH_STATE_SECRET'] as const;
const CALLBACK_PATHS = {
  GOOGLE_REDIRECT_URI: '/api/google/callback',
  GOOGLE_BUSINESS_PROFILE_REDIRECT_URI: '/api/google-business-profile/callback',
} as const;

function valueFor(env: ProviderEnvironment, key: string): string | undefined {
  const raw = env[key];
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

function addIssue(
  issues: ProviderEnvIssue[],
  key: string,
  code: ProviderEnvIssueCode,
  message: string,
): void {
  issues.push({ key, code, message });
}

function requireKeys(
  env: ProviderEnvironment,
  keys: readonly string[],
  issues: ProviderEnvIssue[],
): void {
  for (const key of keys) {
    if (!valueFor(env, key)) {
      addIssue(issues, key, 'missing', 'is required for this provider environment profile');
    }
  }
}

function parseAbsoluteUrl(
  env: ProviderEnvironment,
  key: string,
  issues: ProviderEnvIssue[],
): URL | null {
  const raw = valueFor(env, key);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.username || parsed.password) {
      addIssue(issues, key, 'invalid_url', 'must not include URL credentials');
      return null;
    }
    return parsed;
  } catch {
    addIssue(issues, key, 'invalid_url', 'must be an absolute URL');
    return null;
  }
}

function validateLocalCallback(
  env: ProviderEnvironment,
  key: keyof typeof CALLBACK_PATHS,
  issues: ProviderEnvIssue[],
): void {
  const parsed = parseAbsoluteUrl(env, key, issues);
  if (!parsed) return;
  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (
    parsed.protocol !== 'http:'
    || !localHosts.has(parsed.hostname)
    || parsed.pathname !== CALLBACK_PATHS[key]
    || parsed.search
    || parsed.hash
  ) {
    addIssue(
      issues,
      key,
      'invalid_url',
      `must be a local HTTP URL with path ${CALLBACK_PATHS[key]} and no query or fragment`,
    );
  }
}

function validateStagingCallback(
  env: ProviderEnvironment,
  key: keyof typeof CALLBACK_PATHS,
  stagingOrigin: string | null,
  issues: ProviderEnvIssue[],
): void {
  const parsed = parseAbsoluteUrl(env, key, issues);
  if (!parsed) return;
  if (
    parsed.protocol !== 'https:'
    || parsed.pathname !== CALLBACK_PATHS[key]
    || parsed.search
    || parsed.hash
  ) {
    addIssue(
      issues,
      key,
      'invalid_url',
      `must be an HTTPS URL with path ${CALLBACK_PATHS[key]} and no query or fragment`,
    );
    return;
  }
  if (stagingOrigin && parsed.origin !== stagingOrigin) {
    addIssue(issues, key, 'origin_mismatch', 'must use the same origin as APP_URL');
  }
}

function validateProfileMode(
  profile: ProviderEnvProfile,
  env: ProviderEnvironment,
  issues: ProviderEnvIssue[],
): void {
  const expectedNodeEnv = profile === 'staging' ? 'production' : 'development';
  const expectedFakeProviders = profile === 'local-fake' ? 'true' : 'false';

  if (valueFor(env, 'PROVIDER_ENV_PROFILE') && valueFor(env, 'PROVIDER_ENV_PROFILE') !== profile) {
    addIssue(issues, 'PROVIDER_ENV_PROFILE', 'profile_mismatch', `must equal ${profile}`);
  }
  if (valueFor(env, 'NODE_ENV') && valueFor(env, 'NODE_ENV') !== expectedNodeEnv) {
    addIssue(issues, 'NODE_ENV', 'profile_mismatch', `must equal ${expectedNodeEnv} for ${profile}`);
  }
  if (valueFor(env, 'LOCAL_FAKE_PROVIDERS') && valueFor(env, 'LOCAL_FAKE_PROVIDERS') !== expectedFakeProviders) {
    addIssue(
      issues,
      'LOCAL_FAKE_PROVIDERS',
      'profile_mismatch',
      `must equal ${expectedFakeProviders} for ${profile}`,
    );
  }
}

function validateDataDir(env: ProviderEnvironment, issues: ProviderEnvIssue[]): void {
  const dataDir = valueFor(env, 'DATA_DIR');
  if (dataDir && !path.isAbsolute(dataDir)) {
    addIssue(issues, 'DATA_DIR', 'invalid_path', 'must be an absolute, environment-isolated path');
  }
}

function validateSecretLengths(env: ProviderEnvironment, issues: ProviderEnvIssue[]): void {
  for (const key of SECRET_MINIMUM_LENGTH_KEYS) {
    const secret = valueFor(env, key);
    if (secret && secret.length < 32) {
      addIssue(issues, key, 'too_short', 'must contain at least 32 characters');
    }
  }
}

function validateStagingUrls(env: ProviderEnvironment, issues: ProviderEnvIssue[]): void {
  const appUrl = parseAbsoluteUrl(env, 'APP_URL', issues);
  let stagingOrigin: string | null = null;
  if (appUrl) {
    if (appUrl.protocol !== 'https:' || appUrl.pathname !== '/' || appUrl.search || appUrl.hash) {
      addIssue(issues, 'APP_URL', 'invalid_url', 'must be an HTTPS origin with no path, query, or fragment');
    } else {
      stagingOrigin = appUrl.origin;
    }
  }

  const origins = valueFor(env, 'ALLOWED_ORIGINS')
    ?.split(',')
    .map(origin => origin.trim())
    .filter(Boolean) ?? [];
  const parsedOrigins: string[] = [];
  for (const rawOrigin of origins) {
    try {
      const parsed = new URL(rawOrigin);
      if (
        parsed.protocol !== 'https:'
        || parsed.pathname !== '/'
        || parsed.search
        || parsed.hash
        || parsed.username
        || parsed.password
      ) {
        throw new Error('not an HTTPS origin');
      }
      parsedOrigins.push(parsed.origin);
    } catch {
      addIssue(issues, 'ALLOWED_ORIGINS', 'invalid_url', 'must contain comma-separated HTTPS origins only');
      break;
    }
  }
  if (stagingOrigin && !parsedOrigins.includes(stagingOrigin)) {
    addIssue(issues, 'ALLOWED_ORIGINS', 'origin_mismatch', 'must include the APP_URL origin');
  }

  validateStagingCallback(env, 'GOOGLE_REDIRECT_URI', stagingOrigin, issues);
  validateStagingCallback(env, 'GOOGLE_BUSINESS_PROFILE_REDIRECT_URI', stagingOrigin, issues);
}

export function validateProviderEnvironment(
  profile: ProviderEnvProfile,
  env: ProviderEnvironment,
): ProviderEnvValidationResult {
  const issues: ProviderEnvIssue[] = [];
  requireKeys(env, BASE_REQUIRED_KEYS, issues);
  validateProfileMode(profile, env, issues);
  validateDataDir(env, issues);

  if (profile !== 'local-fake') {
    requireKeys(env, LIVE_PROVIDER_REQUIRED_KEYS, issues);
    validateSecretLengths(env, issues);
  }

  if (profile === 'local-live') {
    validateLocalCallback(env, 'GOOGLE_REDIRECT_URI', issues);
    validateLocalCallback(env, 'GOOGLE_BUSINESS_PROFILE_REDIRECT_URI', issues);
  }

  if (profile === 'staging') {
    requireKeys(env, STAGING_REQUIRED_KEYS, issues);
    validateStagingUrls(env, issues);
  }

  if (valueFor(env, 'SEMRUSH_API_KEY')) {
    addIssue(
      issues,
      'SEMRUSH_API_KEY',
      'retired',
      'is retired; DataForSEO is the canonical runtime SEO provider',
    );
  }

  return { ok: issues.length === 0, profile, issues };
}

function profileFromArgs(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--profile') return args[index + 1];
    if (arg.startsWith('--profile=')) return arg.slice('--profile='.length);
  }
  return undefined;
}

export function resolveProviderEnvProfile(
  args: readonly string[],
  env: ProviderEnvironment,
): ProviderEnvProfile {
  const candidate = profileFromArgs(args) ?? valueFor(env, 'PROVIDER_ENV_PROFILE');
  if (!candidate) {
    throw new Error(
      `PROVIDER_ENV_PROFILE is required (${PROVIDER_ENV_PROFILES.join(', ')}) or pass --profile`,
    );
  }
  if (!PROFILE_SET.has(candidate)) {
    throw new Error(
      `Unknown provider environment profile; expected ${PROVIDER_ENV_PROFILES.join(', ')}`,
    );
  }
  return candidate as ProviderEnvProfile;
}
