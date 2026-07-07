// @ds-rebuilt
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export const CONTENT_PIPELINE_TABS = [
  { id: 'planner', label: 'Planner' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'intake', label: 'Intake' },
  { id: 'briefs', label: 'Briefs' },
  { id: 'posts', label: 'Drafts' },
  { id: 'publish', label: 'Publish' },
  { id: 'content-health', label: 'Content Health' },
  { id: 'published', label: 'Published' },
] as const;

export type ContentPipelineTab = typeof CONTENT_PIPELINE_TABS[number]['id'];
export type ContentPipelineLegacyTab = 'subscriptions';

const TAB_VALUES = new Set<string>(CONTENT_PIPELINE_TABS.map((tab) => tab.id));
const TAB_PARAM = 'tab';
const POST_PARAM = 'post';
const DEFAULT_TAB: ContentPipelineTab = 'briefs';

const LEGACY_TAB_ALIASES: Record<ContentPipelineLegacyTab, ContentPipelineTab> = {
  subscriptions: 'publish',
};

type ParamValue = string | null | undefined;

function isContentPipelineTab(value: string | null | undefined): value is ContentPipelineTab {
  return typeof value === 'string' && TAB_VALUES.has(value);
}

function isLegacyTab(value: string | null | undefined): value is ContentPipelineLegacyTab {
  return value === 'subscriptions';
}

export function resolveContentPipelineTab(value: string | null | undefined): ContentPipelineTab {
  if (isContentPipelineTab(value)) return value;
  if (isLegacyTab(value)) return LEGACY_TAB_ALIASES[value];
  return DEFAULT_TAB;
}

export interface UseContentPipelineSurfaceStateReturn {
  tab: ContentPipelineTab;
  rawTab: string | null;
  postId: string | null;
  setTab: (tab: ContentPipelineTab) => void;
  clearPost: () => void;
}

export function useContentPipelineSurfaceState(): UseContentPipelineSurfaceStateReturn {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get(TAB_PARAM);
  const tab = resolveContentPipelineTab(rawTab);
  const postId = searchParams.get(POST_PARAM);

  const updateParams = useCallback((updates: Record<string, ParamValue>, replace = true) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === undefined || value === '') next.delete(key);
        else next.set(key, value);
      }
      return next;
    }, { replace });
  }, [setSearchParams]);

  const setTab = useCallback((nextTab: ContentPipelineTab) => {
    updateParams({
      [TAB_PARAM]: nextTab,
      [POST_PARAM]: nextTab === 'posts' ? postId : null,
    });
  }, [postId, updateParams]);

  const clearPost = useCallback(() => {
    updateParams({ [POST_PARAM]: null });
  }, [updateParams]);

  return {
    tab,
    rawTab,
    postId,
    setTab,
    clearPost,
  };
}
