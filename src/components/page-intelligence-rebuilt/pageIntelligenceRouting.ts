import type { UnifiedPage } from '../../../shared/types/page-join';
import { matchPageIdentity } from '../../lib/pathUtils';

export type IntelligenceTab = 'pages' | 'architecture' | 'guide';

const INTELLIGENCE_TABS: IntelligenceTab[] = ['pages', 'architecture', 'guide'];

export function resolvePageIntelligenceTab(value: string | null): IntelligenceTab {
  return INTELLIGENCE_TABS.includes(value as IntelligenceTab) ? value as IntelligenceTab : 'pages';
}

export function findPageByIdentity(pages: UnifiedPage[], identity: string | null): UnifiedPage | undefined {
  if (!identity) return undefined;
  let decoded = identity;
  try {
    decoded = decodeURIComponent(identity);
  } catch {
    // A malformed URL value is not a page identity; leave it unmatched.
    return undefined;
  }
  return pages.find(page => page.id === decoded || page.slug === decoded || page.path === decoded || matchPageIdentity(page.path, decoded));
}

export function resolveInitialPage(
  pages: UnifiedPage[],
  pageParam: string | null,
  fixContext?: { targetRoute: string; pageId?: string; pageSlug?: string } | null,
): UnifiedPage | undefined {
  const explicitPage = findPageByIdentity(pages, pageParam);
  if (explicitPage) return explicitPage;
  if (pageParam || fixContext?.targetRoute !== 'page-intelligence') return undefined;
  return findPageByIdentity(pages, fixContext.pageId ?? fixContext.pageSlug ?? null);
}
