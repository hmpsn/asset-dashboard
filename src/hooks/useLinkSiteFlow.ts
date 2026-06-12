import { useState, useRef } from 'react';
import { webflow } from '../api';

export interface WebflowSiteOption {
  id: string;
  displayName: string;
  shortName: string;
}

export interface LinkSiteFlowState {
  token: string;
  setToken: (v: string) => void;
  showToken: boolean;
  setShowToken: (v: boolean) => void;
  sites: WebflowSiteOption[];
  loadingSites: boolean;
  tokenError: string;
  tokenInputRef: React.RefObject<HTMLInputElement | null>;
  fetchSites: (t: string) => Promise<void>;
  reset: () => void;
}

/**
 * Encapsulates the Webflow API-token → site-list fetch loop used by both
 * WorkspaceSelector (inline dropdown) and ConnectionsTab (settings page).
 */
export function useLinkSiteFlow(): LinkSiteFlowState {
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [sites, setSites] = useState<WebflowSiteOption[]>([]);
  const [loadingSites, setLoadingSites] = useState(false);
  const [tokenError, setTokenError] = useState('');
  const tokenInputRef = useRef<HTMLInputElement>(null);

  const fetchSites = async (t: string) => {
    if (!t.trim()) return;
    setLoadingSites(true);
    setTokenError('');
    setSites([]);
    try {
      const data = await webflow.sites(t.trim());
      if (Array.isArray(data) && data.length > 0) {
        setSites(data as WebflowSiteOption[]);
      } else {
        setTokenError('No sites found. Check token permissions.');
      }
    } catch {
      setTokenError('Failed to fetch sites.');
    } finally {
      setLoadingSites(false);
    }
  };

  const reset = () => {
    setToken('');
    setSites([]);
    setTokenError('');
    setShowToken(false);
  };

  return {
    token,
    setToken,
    showToken,
    setShowToken,
    sites,
    loadingSites,
    tokenError,
    tokenInputRef,
    fetchSites,
    reset,
  };
}
