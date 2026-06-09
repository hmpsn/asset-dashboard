import type { Response } from 'express';

export type ProviderErrorSource = 'stripe' | 'google' | 'gsc' | 'ga4' | 'seo' | 'ai' | 'provider';

const DEFAULT_MESSAGES: Record<ProviderErrorSource, string> = {
  stripe: 'Payment provider request failed. Please try again or contact support.',
  google: 'Google provider request failed. Please reconnect Google or try again.',
  gsc: 'Search Console data is temporarily unavailable. Please try again.',
  ga4: 'Analytics data is temporarily unavailable. Please try again.',
  seo: 'SEO provider data is temporarily unavailable. Please try again.',
  ai: 'AI provider request failed. Please try again.',
  provider: 'Provider request failed. Please try again.',
};

export interface SanitizedProviderErrorOptions {
  source: ProviderErrorSource;
  fallback?: string;
}

export interface ProviderErrorResponseOptions extends SanitizedProviderErrorOptions {
  status?: number;
  degraded?: boolean;
  metadata?: Record<string, unknown>;
}

export function sanitizeProviderError(options: SanitizedProviderErrorOptions): string {
  return options.fallback ?? DEFAULT_MESSAGES[options.source];
}

export function sendSanitizedProviderError(
  res: Response,
  options: ProviderErrorResponseOptions,
): void {
  res.status(options.status ?? 500).json({
    error: sanitizeProviderError(options),
    ...(options.degraded !== undefined ? { degraded: options.degraded } : {}),
    ...options.metadata,
  });
}
