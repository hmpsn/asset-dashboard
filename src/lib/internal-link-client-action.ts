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
  const targetTitle = item.targetTitle?.trim() || null;
  const sourcePageUrl = item.sourcePageUrl?.trim() || item.sourcePage?.trim() || null;
  const sourcePageTitle = item.sourcePageTitle?.trim() || null;

  return {
    anchorText: item.anchorText,
    targetUrl: item.targetUrl,
    targetTitle,
    sourcePageUrl,
    sourcePageTitle,
    contextSnippet: item.contextSnippet?.trim() || null,
  };
}
