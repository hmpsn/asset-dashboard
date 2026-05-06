/**
 * Pure helpers for the client-dashboard auth + URL bootstrap flow.
 * Extracted from src/components/ClientDashboard.tsx so the side-effecting
 * URL parsing, session-storage handling, and Stripe-redirect cleanup can be
 * unit-tested without mounting the full dashboard.
 */

export type PaymentStatus = 'success' | 'cancelled' | null;

export interface AuthInitParams {
  /** Token from `?reset_token=...`, used to enter the password-reset flow. */
  resetToken: string | null;
  /** `?payment=success|cancelled` from a Stripe redirect. */
  paymentStatus: PaymentStatus;
}

/**
 * Parse the auth-related query parameters out of a URL search string.
 * Pure — does not touch `window.location` or storage.
 */
export function parseAuthInitParams(search: string): AuthInitParams {
  const params = new URLSearchParams(search);
  const reset = params.get('reset_token');
  const payment = params.get('payment');
  let paymentStatus: PaymentStatus = null;
  if (payment === 'success' || payment === 'cancelled') paymentStatus = payment;
  return { resetToken: reset, paymentStatus };
}

/**
 * Strip `reset_token` from a URL string and return the rebuilt URL.
 * Used after the dashboard reads the token so it doesn't linger in the
 * address bar and leak via `Referer` or screenshots.
 */
export function stripResetTokenFromUrl(href: string): string {
  const url = new URL(href);
  url.searchParams.delete('reset_token');
  return url.toString();
}

/**
 * Strip Stripe redirect params (`payment` and `session_id`) from a URL.
 * Use after handling a payment-success or payment-cancelled redirect so the
 * toast doesn't re-fire on subsequent renders / refreshes.
 */
export function stripStripeParamsFromUrl(href: string): string {
  const url = new URL(href);
  url.searchParams.delete('payment');
  url.searchParams.delete('session_id');
  return url.toString();
}

/** Storage key for the legacy "this browser session is authenticated" flag. */
export function sessionAuthKey(workspaceId: string): string {
  return `dash_auth_${workspaceId}`;
}

/**
 * Read the legacy session-auth flag — returns true when the user previously
 * passed the shared-password gate in this browser session.
 */
export function hasSessionAuth(
  storage: Pick<Storage, 'getItem'>,
  workspaceId: string,
): boolean {
  return storage.getItem(sessionAuthKey(workspaceId)) === 'true';
}

/** Persist the session-auth flag. */
export function setSessionAuth(
  storage: Pick<Storage, 'setItem'>,
  workspaceId: string,
): void {
  storage.setItem(sessionAuthKey(workspaceId), 'true');
}

/** Clear the session-auth flag (logout / session reset). */
export function clearSessionAuth(
  storage: Pick<Storage, 'removeItem'>,
  workspaceId: string,
): void {
  storage.removeItem(sessionAuthKey(workspaceId));
}

/** Storage key for the per-user welcome modal seen flag. */
export function welcomeSeenKey(workspaceId: string, userId: string | null | undefined): string {
  return userId ? `welcome_seen_${workspaceId}_${userId}` : `welcome_seen_${workspaceId}`;
}
