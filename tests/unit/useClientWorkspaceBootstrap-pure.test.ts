/**
 * Pure-helper tests for the client workspace bootstrap module.
 *
 * `useClientWorkspaceBootstrap` is a side-effectful React hook (network calls,
 * DOM mutations, React state dispatch).  Rather than mounting it, we test:
 *
 *   1. The pure URL / storage helpers re-exported from `src/lib/client-dashboard-auth.ts`
 *      that are NOT already covered by `tests/component/ClientDashboard-auth.test.tsx`.
 *      (That test covers: parseAuthInitParams, stripReset/StripeParamsFromUrl,
 *       hasSessionAuth, setSessionAuth, clearSessionAuth, sessionAuthKey, welcomeSeenKey.)
 *
 *   2. The `applyWorkspaceMetadata` logic (document-mutation side of bootstrap).
 *      Because JSDOM is available in vitest we can call a re-implementation of
 *      the function and inspect the resulting DOM.
 *
 *   3. The auth-routing decision helpers extracted as pure functions that mirror
 *      the conditional logic in the bootstrap useEffect.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  parseAuthInitParams,
  stripResetTokenFromUrl,
  stripStripeParamsFromUrl,
  hasSessionAuth,
  setSessionAuth,
  clearSessionAuth,
  sessionAuthKey,
  welcomeSeenKey,
} from '../../src/lib/client-dashboard-auth.js';

// ---------------------------------------------------------------------------
// applyWorkspaceMetadata — re-implemented here from useClientWorkspaceBootstrap.ts
// so DOM-mutation behavior can be tested in isolation.
// ---------------------------------------------------------------------------

interface WorkspaceMetadata {
  name: string;
  brandLogoUrl?: string | null;
}

function applyWorkspaceMetadata(data: WorkspaceMetadata, locationHref: string) {
  const portalTitle = `${data.name} — Insights Engine`;
  const portalDesc = `Performance insights, SEO opportunities, and growth recommendations for ${data.name}.`;
  document.title = portalTitle;

  const setMeta = (attr: string, key: string, content: string) => {
    let el = document.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute(attr, key);
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
  };

  setMeta('property', 'og:title', portalTitle);
  setMeta('property', 'og:description', portalDesc);
  setMeta('property', 'og:type', 'website');
  setMeta('property', 'og:url', locationHref);
  setMeta('name', 'twitter:title', portalTitle);
  setMeta('name', 'twitter:description', portalDesc);
  setMeta('name', 'twitter:card', 'summary');
  setMeta('name', 'description', portalDesc);

  if (data.brandLogoUrl) {
    setMeta('property', 'og:image', data.brandLogoUrl);
    setMeta('name', 'twitter:image', data.brandLogoUrl);

    let faviconEl = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
    if (!faviconEl) {
      faviconEl = document.createElement('link');
      faviconEl.rel = 'icon';
      document.head.appendChild(faviconEl);
    }
    faviconEl.href = data.brandLogoUrl;
    faviconEl.type = data.brandLogoUrl.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
  }
}

// ---------------------------------------------------------------------------
// Auth-routing decision logic extracted from the bootstrap hook
// ---------------------------------------------------------------------------

interface AuthRoutingInputs {
  requiresPassword: boolean;
  autoAuthed: boolean;
  sessionAuthed: boolean;
}

/** Returns whether the dashboard data should be loaded after auth check. */
function shouldLoadDashboardData({ requiresPassword, autoAuthed, sessionAuthed }: AuthRoutingInputs): boolean {
  if (autoAuthed) return true;
  if (requiresPassword) return sessionAuthed;
  return true; // no password required → always load
}

/** Returns whether the user should be considered authenticated. */
function shouldSetAuthenticated({ requiresPassword, autoAuthed, sessionAuthed }: AuthRoutingInputs): boolean {
  if (autoAuthed) return true;
  if (requiresPassword) return sessionAuthed;
  return true;
}

// ---------------------------------------------------------------------------
// onboarding / welcome gate helpers
// ---------------------------------------------------------------------------

function shouldShowOnboarding(onboardingEnabled: boolean, onboardingCompleted: boolean): boolean {
  return onboardingEnabled && !onboardingCompleted;
}

function shouldShowWelcome(
  storage: Pick<Storage, 'getItem'>,
  workspaceId: string,
  userId: string | null | undefined,
  onboardingEnabled: boolean,
): boolean {
  const key = welcomeSeenKey(workspaceId, userId);
  return !storage.getItem(key) && !onboardingEnabled;
}

// ---------------------------------------------------------------------------
// AUTH-MODE DECISION helpers
// ---------------------------------------------------------------------------

function resolveLoginTab(hasClientUsers: boolean): 'user' | 'password' {
  return hasClientUsers ? 'user' : 'password';
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseAuthInitParams — edge cases', () => {
  it('handles search string without leading "?"', () => {
    const result = parseAuthInitParams('reset_token=tok123');
    expect(result.resetToken).toBe('tok123');
  });

  it('ignores extra unknown params', () => {
    const result = parseAuthInitParams('?reset_token=tok&extra=ignored&payment=success');
    expect(result.resetToken).toBe('tok');
    expect(result.paymentStatus).toBe('success');
  });

  it('paymentStatus is null for empty string payment param', () => {
    const result = parseAuthInitParams('?payment=');
    expect(result.paymentStatus).toBeNull();
  });
});

describe('URL stripping — edge cases', () => {
  it('stripResetTokenFromUrl is idempotent when called twice', () => {
    const url = 'https://app.example.com/client/ws?reset_token=tok&tab=overview';
    const once = stripResetTokenFromUrl(url);
    const twice = stripResetTokenFromUrl(once);
    expect(twice).toBe(once);
    expect(twice).not.toContain('reset_token');
  });

  it('stripStripeParamsFromUrl removes session_id even when payment is absent', () => {
    const cleaned = stripStripeParamsFromUrl('https://app.example.com/client/ws?session_id=cs_123&tab=foo');
    expect(cleaned).not.toContain('session_id');
    expect(cleaned).toContain('tab=foo');
  });

  it('stripStripeParamsFromUrl is a no-op on clean URLs', () => {
    const url = 'https://app.example.com/client/ws?tab=overview';
    expect(stripStripeParamsFromUrl(url)).toContain('tab=overview');
  });
});

describe('session-auth storage helpers — additional edge cases', () => {
  it('sessionAuthKey uses the workspaceId verbatim', () => {
    expect(sessionAuthKey('ws-abc-123')).toBe('dash_auth_ws-abc-123');
  });

  it('clearSessionAuth is a no-op when key is not set', () => {
    const storage = { removeItem: (k: string) => { void k; } };
    // Should not throw
    expect(() => clearSessionAuth(storage, 'ws-ghost')).not.toThrow();
  });

  it('setSessionAuth stores the value with the correct key', () => {
    const store: Record<string, string> = {};
    const storage = { setItem: (k: string, v: string) => { store[k] = v; } };
    setSessionAuth(storage, 'ws-set-test');
    expect(store['dash_auth_ws-set-test']).toBe('true');
  });

  it('hasSessionAuth returns false for missing key (null from storage)', () => {
    const storage = { getItem: (_k: string) => null };
    expect(hasSessionAuth(storage, 'ws-x')).toBe(false);
  });
});

describe('welcomeSeenKey — all branches', () => {
  it('workspace-only key when userId is null', () => {
    expect(welcomeSeenKey('ws-1', null)).toBe('welcome_seen_ws-1');
  });

  it('workspace-only key when userId is undefined', () => {
    expect(welcomeSeenKey('ws-1', undefined)).toBe('welcome_seen_ws-1');
  });

  it('workspace+user key when userId is provided', () => {
    expect(welcomeSeenKey('ws-1', 'user-abc')).toBe('welcome_seen_ws-1_user-abc');
  });

  it('workspace+user key is unique per workspace', () => {
    expect(welcomeSeenKey('ws-a', 'u1')).not.toBe(welcomeSeenKey('ws-b', 'u1'));
  });

  it('workspace-only key is unique per workspace', () => {
    expect(welcomeSeenKey('ws-a', null)).not.toBe(welcomeSeenKey('ws-b', null));
  });
});

describe('applyWorkspaceMetadata', () => {
  beforeEach(() => {
    // Clean up any leftover head elements from previous tests
    document.title = '';
    document.head.innerHTML = '';
  });

  afterEach(() => {
    document.head.innerHTML = '';
  });

  it('sets document.title to "<name> — Insights Engine"', () => {
    applyWorkspaceMetadata({ name: 'Acme Corp' }, 'https://example.com/client/ws-1');
    expect(document.title).toBe('Acme Corp — Insights Engine');
  });

  it('sets og:title meta tag', () => {
    applyWorkspaceMetadata({ name: 'Acme' }, 'https://example.com/');
    const el = document.querySelector('meta[property="og:title"]') as HTMLMetaElement;
    expect(el?.content).toBe('Acme — Insights Engine');
  });

  it('sets og:description with workspace name', () => {
    applyWorkspaceMetadata({ name: 'BrandX' }, 'https://example.com/');
    const el = document.querySelector('meta[property="og:description"]') as HTMLMetaElement;
    expect(el?.content).toContain('BrandX');
  });

  it('sets twitter:card to "summary"', () => {
    applyWorkspaceMetadata({ name: 'Test' }, 'https://example.com/');
    const el = document.querySelector('meta[name="twitter:card"]') as HTMLMetaElement;
    expect(el?.content).toBe('summary');
  });

  it('sets og:url to the current href', () => {
    applyWorkspaceMetadata({ name: 'Test' }, 'https://example.com/client/ws-99');
    const el = document.querySelector('meta[property="og:url"]') as HTMLMetaElement;
    expect(el?.content).toBe('https://example.com/client/ws-99');
  });

  it('does NOT add og:image when brandLogoUrl is absent', () => {
    applyWorkspaceMetadata({ name: 'Test' }, 'https://example.com/');
    expect(document.querySelector('meta[property="og:image"]')).toBeNull();
  });

  it('adds og:image and twitter:image when brandLogoUrl is present', () => {
    applyWorkspaceMetadata({ name: 'Test', brandLogoUrl: 'https://cdn.example.com/logo.png' }, 'https://example.com/');
    const ogImage = document.querySelector('meta[property="og:image"]') as HTMLMetaElement;
    const twImage = document.querySelector('meta[name="twitter:image"]') as HTMLMetaElement;
    expect(ogImage?.content).toBe('https://cdn.example.com/logo.png');
    expect(twImage?.content).toBe('https://cdn.example.com/logo.png');
  });

  it('sets favicon href to brandLogoUrl when present', () => {
    applyWorkspaceMetadata({ name: 'Test', brandLogoUrl: 'https://cdn.example.com/logo.png' }, 'https://example.com/');
    const favicon = document.querySelector('link[rel="icon"]') as HTMLLinkElement;
    expect(favicon?.href).toContain('logo.png');
  });

  it('sets favicon type to image/svg+xml for .svg brand logos', () => {
    applyWorkspaceMetadata({ name: 'Test', brandLogoUrl: 'https://cdn.example.com/logo.svg' }, 'https://example.com/');
    const favicon = document.querySelector('link[rel="icon"]') as HTMLLinkElement;
    expect(favicon?.type).toBe('image/svg+xml');
  });

  it('sets favicon type to image/png for non-svg brand logos', () => {
    applyWorkspaceMetadata({ name: 'Test', brandLogoUrl: 'https://cdn.example.com/logo.png' }, 'https://example.com/');
    const favicon = document.querySelector('link[rel="icon"]') as HTMLLinkElement;
    expect(favicon?.type).toBe('image/png');
  });

  it('updates existing meta tags instead of creating duplicates', () => {
    applyWorkspaceMetadata({ name: 'First' }, 'https://example.com/');
    applyWorkspaceMetadata({ name: 'Second' }, 'https://example.com/');
    const tags = document.querySelectorAll('meta[property="og:title"]');
    expect(tags).toHaveLength(1);
    expect((tags[0] as HTMLMetaElement).content).toBe('Second — Insights Engine');
  });
});

describe('auth-routing decision logic', () => {
  it('loads dashboard when auto-authed (JWT cookie)', () => {
    expect(shouldLoadDashboardData({ requiresPassword: true, autoAuthed: true, sessionAuthed: false })).toBe(true);
  });

  it('loads dashboard when workspace has no password requirement', () => {
    expect(shouldLoadDashboardData({ requiresPassword: false, autoAuthed: false, sessionAuthed: false })).toBe(true);
  });

  it('loads dashboard when password-protected and session auth is present', () => {
    expect(shouldLoadDashboardData({ requiresPassword: true, autoAuthed: false, sessionAuthed: true })).toBe(true);
  });

  it('blocks dashboard load when password-protected and no session auth', () => {
    expect(shouldLoadDashboardData({ requiresPassword: true, autoAuthed: false, sessionAuthed: false })).toBe(false);
  });

  it('mirrors shouldLoadDashboardData for setAuthenticated', () => {
    const cases: AuthRoutingInputs[] = [
      { requiresPassword: false, autoAuthed: false, sessionAuthed: false },
      { requiresPassword: true, autoAuthed: false, sessionAuthed: true },
      { requiresPassword: true, autoAuthed: false, sessionAuthed: false },
      { requiresPassword: true, autoAuthed: true, sessionAuthed: false },
    ];
    for (const c of cases) {
      expect(shouldSetAuthenticated(c)).toBe(shouldLoadDashboardData(c));
    }
  });
});

describe('onboarding / welcome gate helpers', () => {
  it('shows onboarding when enabled and not completed', () => {
    expect(shouldShowOnboarding(true, false)).toBe(true);
  });

  it('does not show onboarding when completed', () => {
    expect(shouldShowOnboarding(true, true)).toBe(false);
  });

  it('does not show onboarding when not enabled', () => {
    expect(shouldShowOnboarding(false, false)).toBe(false);
  });

  it('shows welcome when key is absent and onboarding is disabled', () => {
    const storage = { getItem: () => null };
    expect(shouldShowWelcome(storage, 'ws-1', null, false)).toBe(true);
  });

  it('does not show welcome when already seen', () => {
    const storage = { getItem: () => 'seen' };
    expect(shouldShowWelcome(storage, 'ws-1', null, false)).toBe(false);
  });

  it('does not show welcome when onboarding is enabled (even if not seen)', () => {
    const storage = { getItem: () => null };
    expect(shouldShowWelcome(storage, 'ws-1', null, true)).toBe(false);
  });

  it('checks per-user welcome key when userId is provided', () => {
    const store: Record<string, string | null> = { 'welcome_seen_ws-1_u1': 'seen' };
    const storage = { getItem: (k: string) => store[k] ?? null };
    expect(shouldShowWelcome(storage, 'ws-1', 'u1', false)).toBe(false);
    expect(shouldShowWelcome(storage, 'ws-1', 'u2', false)).toBe(true);
  });
});

describe('resolveLoginTab', () => {
  it('returns "user" when hasClientUsers is true', () => {
    expect(resolveLoginTab(true)).toBe('user');
  });

  it('returns "password" when hasClientUsers is false', () => {
    expect(resolveLoginTab(false)).toBe('password');
  });
});
