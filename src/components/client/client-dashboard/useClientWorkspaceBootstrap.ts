import { useEffect } from 'react';
import { ApiError, get, getOptional } from '../../../api/client';
import { STUDIO_NAME } from '../../../constants';
import {
  hasSessionAuth,
  parseAuthInitParams,
  stripResetTokenFromUrl,
  stripStripeParamsFromUrl,
  welcomeSeenKey,
} from '../../../lib/client-dashboard-auth';
import type { ClientAuthActions, ClientUser } from '../../../hooks/useClientAuth';
import type { WorkspaceInfo } from '../types';

interface UseClientWorkspaceBootstrapOptions {
  workspaceId: string;
  loadDashboardData: (data: WorkspaceInfo) => void;
  setWs: React.Dispatch<React.SetStateAction<WorkspaceInfo | null>>;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  setShowOnboarding: React.Dispatch<React.SetStateAction<boolean>>;
  setShowWelcome: React.Dispatch<React.SetStateAction<boolean>>;
  setResetToken: React.Dispatch<React.SetStateAction<string>>;
  setLoginView: React.Dispatch<React.SetStateAction<'login' | 'forgot' | 'reset'>>;
  setToast: (toast: { message: string; type: 'success' | 'error' } | null) => void;
  setAuthMode: ClientAuthActions['setAuthMode'];
  setLoginTab: ClientAuthActions['setLoginTab'];
  setClientUser: ClientAuthActions['setClientUser'];
  setAuthenticated: ClientAuthActions['setAuthenticated'];
}

function applyWorkspaceMetadata(data: WorkspaceInfo) {
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
  setMeta('property', 'og:url', window.location.href);
  setMeta('name', 'twitter:title', portalTitle);
  setMeta('name', 'twitter:description', portalDesc);
  setMeta('name', 'twitter:card', 'summary');
  setMeta('name', 'description', portalDesc);
  if (data.brandLogoUrl) {
    setMeta('property', 'og:image', data.brandLogoUrl);
    setMeta('name', 'twitter:image', data.brandLogoUrl);
  }

  if (data.brandLogoUrl) {
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

export function useClientWorkspaceBootstrap({
  workspaceId,
  loadDashboardData,
  setWs,
  setLoading,
  setError,
  setShowOnboarding,
  setShowWelcome,
  setResetToken,
  setLoginView,
  setToast,
  setAuthMode,
  setLoginTab,
  setClientUser,
  setAuthenticated,
}: UseClientWorkspaceBootstrapOptions) {
  useEffect(() => {
    setLoading(true);
    get<WorkspaceInfo>(`/api/public/workspace/${workspaceId}`)
      .then(async (data: WorkspaceInfo) => {
        if (!data.id) {
          setError('Workspace not found');
          setLoading(false);
          return;
        }
        setWs(data);
        applyWorkspaceMetadata(data);

        try {
          const authMode = await getOptional<{ hasSharedPassword?: boolean; hasClientUsers?: boolean }>(`/api/public/auth-mode/${workspaceId}`);
          if (authMode) {
            setAuthMode({
              hasSharedPassword: authMode.hasSharedPassword ?? !!data.requiresPassword,
              hasClientUsers: authMode.hasClientUsers ?? false,
            });
            setLoginTab(authMode.hasClientUsers ? 'user' : 'password');
          }
        } catch (err) {
          console.error('ClientDashboard operation failed:', err);
        }

        let autoAuthed = false;
        let resolvedUserId: string | undefined;
        try {
          const meData = await getOptional<{ user?: ClientUser }>(`/api/public/client-me/${workspaceId}`);
          if (meData?.user) {
            setClientUser({ ...meData.user, role: meData.user.role || 'client' });
            resolvedUserId = meData.user.id;
            setAuthenticated(true);
            autoAuthed = true;
            loadDashboardData(data);
          }
        } catch (err) {
          console.error('ClientDashboard operation failed:', err);
        }

        if (!autoAuthed) {
          if (data.requiresPassword) {
            if (hasSessionAuth(sessionStorage, workspaceId)) {
              setAuthenticated(true);
              loadDashboardData(data);
            }
          } else {
            setAuthenticated(true);
            loadDashboardData(data);
          }
        }
        setLoading(false);

        if (data.onboardingEnabled && !data.onboardingCompleted) {
          setShowOnboarding(true);
        }

        const welcomeKey = welcomeSeenKey(workspaceId, resolvedUserId);
        if (!localStorage.getItem(welcomeKey) && !data.onboardingEnabled) {
          setShowWelcome(true);
        }

        const { resetToken, paymentStatus } = parseAuthInitParams(window.location.search);
        if (resetToken) {
          setResetToken(resetToken);
          setLoginView('reset');
          window.history.replaceState({}, '', stripResetTokenFromUrl(window.location.href));
        }

        if (paymentStatus === 'success') {
          setToast({ message: 'Payment successful! Your content request is being processed.', type: 'success' });
          window.history.replaceState({}, '', stripStripeParamsFromUrl(window.location.href));
        } else if (paymentStatus === 'cancelled') {
          setToast({ message: 'Payment was cancelled. You can try again anytime.', type: 'error' });
          window.history.replaceState({}, '', stripStripeParamsFromUrl(window.location.href));
        }
      })
      .catch((err) => {
        setError(err instanceof ApiError && err.status === 403
          ? `This dashboard is currently unavailable. Please contact ${STUDIO_NAME} for access.`
          : 'Failed to load dashboard');
        setLoading(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);
}
