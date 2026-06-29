import {
  type GoogleProviderError,
  isGoogleProviderError,
} from './google-provider-client.js';

const GENERIC_GBP_SYNC_ERROR = 'Google Business Profile sync failed. Check Google Cloud API access and GBP permissions.';

function googleBody(error: GoogleProviderError): string {
  return error.body ?? '';
}

export function googleBusinessProfileProviderErrorMessage(error: unknown): string {
  if (!isGoogleProviderError(error)) return GENERIC_GBP_SYNC_ERROR;

  if (error.kind === 'timeout') {
    return 'Google Business Profile did not respond before the sync timed out. Try again in a minute.';
  }
  if (error.kind === 'network') {
    return 'Google Business Profile could not be reached from the server. Try again, then check outbound network access if it repeats.';
  }
  if (error.kind === 'invalid-json') {
    return 'Google Business Profile returned an unreadable response. Try again, then check Google API status if it repeats.';
  }

  const body = googleBody(error);
  if (/SERVICE_DISABLED|has not been used|disabled/i.test(body)) {
    return 'Google says a required My Business API is disabled for this OAuth project. Enable My Business Account Management and My Business Business Information, then sync again.';
  }
  if (/ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient authentication scopes|insufficient.*scope/i.test(body)) {
    return 'Google says the OAuth grant is missing the business.manage scope. Reconnect Google Business Profile and approve the requested access.';
  }
  if (/quota|RESOURCE_EXHAUSTED|rateLimitExceeded|quotaExceeded/i.test(body)) {
    return 'Google rejected the request because Business Profile API quota is unavailable or exhausted. Check Google Cloud quota and GBP API approval.';
  }
  if (/PERMISSION_DENIED|caller does not have permission|permission/i.test(body)) {
    return 'Google denied access to Business Profile data. Confirm the signed-in Google account can manage the target GBP locations and that the Cloud project has GBP API access.';
  }
  if (error.status === 401) {
    return 'Google returned an authentication error. Reconnect Google Business Profile, then sync locations again.';
  }
  if (error.status === 404) {
    return 'Google Business Profile API endpoint was not found. Check that the correct My Business APIs are enabled for this project.';
  }
  if (error.status === 429) {
    return 'Google Business Profile rate limit was reached. Wait a minute, then sync locations again.';
  }
  if ((error.status ?? 0) >= 500) {
    return 'Google Business Profile is temporarily unavailable. Try syncing locations again shortly.';
  }

  return error.status
    ? `Google Business Profile sync failed at Google (${error.status}). Check Google Cloud API access and GBP permissions.`
    : GENERIC_GBP_SYNC_ERROR;
}

export function googleBusinessProfileProviderResponseStatus(error: unknown): number {
  if (!isGoogleProviderError(error)) return 500;
  if (error.kind === 'network' || error.kind === 'timeout') return 503;
  if (error.status === 401) return 401;
  return 502;
}
