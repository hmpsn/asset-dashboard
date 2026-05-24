import type { InternalLinkItem } from '../../shared/types/client-actions';

export interface InternalLinkSuggestionInput {
  fromPage: string;
  fromTitle: string;
  toPage: string;
  toTitle: string;
  anchorText: string;
  reason: string;
}

export interface InternalLinkDisplaySuggestion {
  anchorText: string;
  targetUrl: string;
  targetTitle: string | null;
  sourcePageUrl: string | null;
  sourcePageTitle: string | null;
  contextSnippet: string | null;
}

function normalizeTitle(value: string | undefined, url: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (url && trimmed === url) return null;
  if (trimmed.startsWith('/') || /^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

export function toInternalLinkClientActionItem(suggestion: InternalLinkSuggestionInput): InternalLinkItem {
  return {
    anchorText: suggestion.anchorText,
    targetUrl: suggestion.toPage,
    targetTitle: suggestion.toTitle,
    sourcePageUrl: suggestion.fromPage,
    sourcePageTitle: suggestion.fromTitle,
    contextSnippet: suggestion.reason,
  };
}

export function normalizeInternalLinkSuggestion(item: InternalLinkItem): InternalLinkDisplaySuggestion {
  const targetUrl = item.targetUrl.trim();
  const sourcePageUrl = item.sourcePageUrl?.trim() || item.sourcePage?.trim() || null;
  const targetTitle = normalizeTitle(item.targetTitle, targetUrl);
  const sourcePageTitle = normalizeTitle(item.sourcePageTitle, sourcePageUrl);

  return {
    anchorText: item.anchorText,
    targetUrl,
    targetTitle,
    sourcePageUrl,
    sourcePageTitle,
    contextSnippet: item.contextSnippet?.trim() || null,
  };
}
