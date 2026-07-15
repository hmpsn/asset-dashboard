// @ds-rebuilt
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { ApiError, get, post } from '../../api/client';
import { queryKeys } from '../../lib/queryKeys';
import { parseRewriteSectionTarget } from '../../lib/rewriteResponse';
import {
  createRewriteSessionId,
  isUrlQuery,
} from '../page-rewrite-chat/pageRewriteChatModel';
import {
  buildDocHtml,
} from '../page-rewrite-chat/pageRewriteChatDocument';
import {
  applyRewriteToSection,
  clearFormattingSelection,
  execFormatCommand,
  wrapSelectionHeading,
} from '../page-rewrite-chat/pageRewriteChatActions';
import { exportPageRewriterDocument } from './pageRewriterExport';
import { mutationErrorMessage } from './pageRewriterMutationFeedback';
import type {
  PageRewriterExportMode,
  PageRewriterMessage,
  PageRewriterPageData,
  PageRewriterSitemapPage,
} from './pageRewriterTypes';

type ToastFn = (message: string, type?: 'success' | 'error' | 'info') => void;
type ParamValue = string | number | null | undefined;

export const PAGE_REWRITER_DEEP_LINK_PARAM = 'pageUrl';

const SEARCH_PARAM_DEFAULTS = {
  comboQuery: '',
  comboIdx: 0,
};

function validatedPageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function pageUrlFromParams(params: URLSearchParams): string | null {
  return validatedPageUrl(params.get(PAGE_REWRITER_DEEP_LINK_PARAM));
}

async function writeClipboard(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
  await navigator.clipboard.writeText(text);
}

interface UsePageRewriterSurfaceStateParams {
  workspaceId: string;
  toast: ToastFn;
}

interface PageLoadRequest {
  url: string;
  requestId: number;
}

export function usePageRewriterSurfaceState({ workspaceId, toast }: UsePageRewriterSurfaceStateParams) {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialPageUrl = pageUrlFromParams(searchParams);
  const invalidPageUrlParam = searchParams.has(PAGE_REWRITER_DEEP_LINK_PARAM) && !initialPageUrl;

  const [pageUrl, setPageUrl] = useState(initialPageUrl ?? '');
  const [lastAttemptedPageUrl, setLastAttemptedPageUrl] = useState(initialPageUrl ?? '');
  const [pageData, setPageData] = useState<PageRewriterPageData | null>(null);
  const [pageError, setPageError] = useState<unknown>(null);
  const [messages, setMessages] = useState<PageRewriterMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [sessionId] = useState(() => createRewriteSessionId());
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [msgEdits, setMsgEdits] = useState<Record<number, string>>({});
  const [comboOpen, setComboOpen] = useState(false);
  const [comboQuery, setComboQuery] = useState(SEARCH_PARAM_DEFAULTS.comboQuery);
  const [comboIdx, setComboIdx] = useState(SEARCH_PARAM_DEFAULTS.comboIdx);
  const [quotaHit, setQuotaHit] = useState(false);
  const [quotaBannerDismissed, setQuotaBannerDismissed] = useState(false);
  const [quotaPartialMessage, setQuotaPartialMessage] = useState<string | null>(null);

  const chatTranscriptRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const comboInputRef = useRef<HTMLInputElement>(null);
  const docBodyRef = useRef<HTMLDivElement | null>(null);
  const autoLoadedUrlRef = useRef<string | null>(null);
  const observedUrlStateRef = useRef<{ workspaceId: string; pageUrl: string | null } | null>(null);
  const pageLoadRequestSequenceRef = useRef(0);
  const activePageLoadRequestRef = useRef<number | null>(null);
  const chatContextEpochRef = useRef(0);
  const chatRequestSequenceRef = useRef(0);
  const activeChatRequestRef = useRef<{ requestId: number; contextEpoch: number } | null>(null);

  const invalidateChatContext = useCallback(() => {
    chatContextEpochRef.current += 1;
    activeChatRequestRef.current = null;
    sendingRef.current = false;
    setSending(false);
  }, []);

  const updateParams = useCallback((updates: Record<string, ParamValue>, replace = true) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === undefined || value === '') next.delete(key);
        else next.set(key, String(value));
      }
      return next;
    }, { replace });
  }, [setSearchParams]);

  const pagesQuery = useQuery<PageRewriterSitemapPage[], Error>({
    queryKey: queryKeys.admin.rewritePages(workspaceId),
    queryFn: () => get<PageRewriterSitemapPage[]>(`/api/rewrite-chat/${workspaceId}/pages`),
    staleTime: 5 * 60 * 1000,
  });

  const loadPageMutation = useMutation<PageRewriterPageData, Error, PageLoadRequest>({
    mutationFn: ({ url }) => post<PageRewriterPageData>(`/api/rewrite-chat/${workspaceId}/load-page`, { url }),
    onMutate: ({ url, requestId }) => {
      if (activePageLoadRequestRef.current !== requestId) return;
      // A page load changes the chat's grounding immediately, before the URL is
      // updated after a successful response. Retire any answer still in flight
      // so it cannot land in the next page's transcript.
      invalidateChatContext();
      autoLoadedUrlRef.current = url;
      setPageError(null);
      setPageData(null);
      setLastAttemptedPageUrl(url);
      if (docBodyRef.current) docBodyRef.current.dataset.pageKey = '';
    },
    onSuccess: (data, { url, requestId }) => {
      if (activePageLoadRequestRef.current !== requestId || autoLoadedUrlRef.current !== url) return;
      activePageLoadRequestRef.current = null;
      setPageData(data);
      setPageUrl(url);
      updateParams({ [PAGE_REWRITER_DEEP_LINK_PARAM]: url }, false);
    },
    onError: (error, { url, requestId }) => {
      if (activePageLoadRequestRef.current !== requestId || autoLoadedUrlRef.current !== url) return;
      activePageLoadRequestRef.current = null;
      setPageData(null);
      setPageError(error);
    },
  });

  const sitemapPages = pagesQuery.data ?? [];
  const comboQueryIsUrl = isUrlQuery(comboQuery);
  const filteredPages = useMemo(() => {
    if (comboQueryIsUrl) return [];
    const query = comboQuery.trim().toLowerCase();
    return sitemapPages.filter((page) => (
      !query
      || page.slug.toLowerCase().includes(query)
      || page.title.toLowerCase().includes(query)
    ));
  }, [comboQuery, comboQueryIsUrl, sitemapPages]);

  const loadPage = useCallback((rawUrl: string) => {
    const url = validatedPageUrl(rawUrl);
    if (!url) {
      setPageError(new Error('Enter a full http or https URL.'));
      return;
    }
    // A picker selection writes pageUrl after the request succeeds. Mark the URL
    // before mutating so the receiving search-param effect does not load the same
    // selection a second time when that URL update arrives.
    const requestId = pageLoadRequestSequenceRef.current + 1;
    pageLoadRequestSequenceRef.current = requestId;
    activePageLoadRequestRef.current = requestId;
    autoLoadedUrlRef.current = url;
    loadPageMutation.mutate({ url, requestId });
  }, [loadPageMutation]);

  useEffect(() => {
    const transcript = chatTranscriptRef.current;
    if (!transcript) return;
    transcript.scrollTop = transcript.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const observed = observedUrlStateRef.current;
    if (observed?.workspaceId === workspaceId && observed.pageUrl === initialPageUrl) return;
    observedUrlStateRef.current = { workspaceId, pageUrl: initialPageUrl };
    invalidateChatContext();

    if (!initialPageUrl) {
      activePageLoadRequestRef.current = null;
      autoLoadedUrlRef.current = null;
      setPageUrl('');
      setLastAttemptedPageUrl('');
      setPageData(null);
      setPageError(null);
      setMessages([]);
      setInput('');
      setCopiedIdx(null);
      setMsgEdits({});
      if (docBodyRef.current) {
        docBodyRef.current.dataset.pageKey = '';
        docBodyRef.current.innerHTML = '';
      }
      return;
    }

    if (observed && observed.workspaceId !== workspaceId) {
      autoLoadedUrlRef.current = null;
    }
    if (autoLoadedUrlRef.current === initialPageUrl) return;
    autoLoadedUrlRef.current = initialPageUrl;
    loadPage(initialPageUrl);
  }, [initialPageUrl, invalidateChatContext, loadPage, workspaceId]);

  const selectPage = useCallback((page: PageRewriterSitemapPage) => {
    setComboQuery('');
    setComboOpen(false);
    setComboIdx(0);
    loadPage(page.url);
  }, [loadPage]);

  const openCombo = useCallback(() => {
    setComboOpen(true);
    setComboQuery('');
    setComboIdx(0);
    window.setTimeout(() => comboInputRef.current?.focus(), 0);
  }, []);

  const loadTypedUrl = useCallback(() => {
    loadPage(comboQuery.trim());
    setComboOpen(false);
  }, [comboQuery, loadPage]);

  const handleComboKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (filteredPages.length > 0) setComboIdx((index) => Math.min(index + 1, filteredPages.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setComboIdx((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (comboQueryIsUrl) loadTypedUrl();
      else if (filteredPages[comboIdx]) selectPage(filteredPages[comboIdx]);
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      setComboOpen(false);
    }
  }, [comboIdx, comboQueryIsUrl, filteredPages, loadTypedUrl, selectPage]);

  const sendMessage = useCallback(async (text?: string) => {
    const question = (text ?? input).trim();
    if (!question || sendingRef.current || quotaHit) return;

    const requestId = chatRequestSequenceRef.current + 1;
    chatRequestSequenceRef.current = requestId;
    const contextEpoch = chatContextEpochRef.current;
    activeChatRequestRef.current = { requestId, contextEpoch };
    const isCurrentRequest = () => {
      const active = activeChatRequestRef.current;
      return active?.requestId === requestId
        && active.contextEpoch === contextEpoch
        && chatContextEpochRef.current === contextEpoch;
    };

    sendingRef.current = true;
    setInput('');
    setSending(true);
    setMessages((prev) => [...prev, { role: 'user', content: question, timestamp: Date.now() }]);

    try {
      const response = await post<{ answer: string }>(`/api/rewrite-chat/${workspaceId}`, {
        question,
        sessionId,
        pageUrl: pageData ? pageUrl : undefined,
        pageContent: pageData?.bodyText,
        pageTitle: pageData?.title,
        pageIssues: pageData?.issues,
      });
      if (!isCurrentRequest()) return;
      const sectionTarget = parseRewriteSectionTarget(response.answer);
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: response.answer,
        timestamp: Date.now(),
        sectionTarget,
      }]);
    } catch (error) {
      if (!isCurrentRequest()) return;
      if (error instanceof ApiError && error.status === 429) {
        setQuotaHit(true);
        setQuotaBannerDismissed(false);
        setQuotaPartialMessage('0 of 1 responses completed before the quota was hit.');
      }
      const message = mutationErrorMessage(error, 'The rewrite assistant did not respond.');
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: `**Error:** ${message}`,
        timestamp: Date.now(),
      }]);
    } finally {
      if (isCurrentRequest()) {
        activeChatRequestRef.current = null;
        sendingRef.current = false;
        setSending(false);
        inputRef.current?.focus();
      }
    }
  }, [input, pageData, pageUrl, quotaHit, sessionId, workspaceId]);

  const handleInputKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }, [sendMessage]);

  const copyToClipboard = useCallback((text: string, idx: number) => {
    void writeClipboard(text).then(() => {
      setCopiedIdx(idx);
      window.setTimeout(() => setCopiedIdx(null), 2000);
      toast('Copied to clipboard', 'success');
    }).catch(() => toast('Could not copy to clipboard', 'error'));
  }, [toast]);

  const applyToSection = useCallback((content: string, sectionTarget: string) => {
    const { foundSection } = applyRewriteToSection(docBodyRef.current, content, sectionTarget);
    toast(foundSection ? `Applied rewrite to ${sectionTarget}` : 'Section not found; content inserted at end', foundSection ? 'success' : 'info');
  }, [toast]);

  const handleExport = useCallback((mode: PageRewriterExportMode) => {
    // Clipboard and print APIs must be entered during the click's user-activation
    // window. The exporter keeps only the heavyweight DOCX library behind an
    // async boundary; cheap modes start synchronously from this handler.
    void exportPageRewriterDocument({
      mode,
      docBody: docBodyRef.current,
      pageData,
      toast,
    });
  }, [pageData, toast]);

  const docBodyRefCallback = useCallback((el: HTMLDivElement | null) => {
    docBodyRef.current = el;
    if (!el || !pageData) return;
    const pageKey = pageData.slug || pageData.title || pageData.url || '__loaded__';
    if (el.dataset.pageKey === pageKey) return;
    el.dataset.pageKey = pageKey;
    el.innerHTML = buildDocHtml(pageData);
  }, [pageData]);

  const retryPageLoad = useCallback(() => {
    const retryUrl = lastAttemptedPageUrl || pageUrl || initialPageUrl;
    if (retryUrl) loadPage(retryUrl);
  }, [initialPageUrl, lastAttemptedPageUrl, loadPage, pageUrl]);
  const loadingPage = loadPageMutation.isPending && autoLoadedUrlRef.current !== null && !pageData && !pageError;

  return {
    pageUrl,
    pageData,
    pageError,
    pageErrorMessage: pageError ? mutationErrorMessage(pageError, 'Failed to load page') : '',
    pageErrorStatus: pageError instanceof ApiError ? pageError.status : null,
    loadingPage,
    invalidPageUrlParam,
    messages,
    input,
    sending,
    copiedIdx,
    msgEdits,
    comboOpen,
    comboQuery,
    comboIdx,
    comboQueryIsUrl,
    filteredPages,
    sitemapPages,
    pagesQuery,
    quotaHit,
    quotaBannerVisible: quotaHit && !quotaBannerDismissed,
    quotaPartialMessage,
    aiDisabledReason: quotaHit ? 'AI quota reached for this workspace. Try again after quota resets.' : null,
    chatTranscriptRef,
    inputRef,
    comboInputRef,
    sendMessage,
    setInput,
    setComboQuery,
    setComboIdx,
    setMsgEdits,
    setComboOpen,
    dismissQuotaBanner: () => setQuotaBannerDismissed(true),
    openCombo,
    selectPage,
    handleComboKeyDown,
    applyToSection,
    copyToClipboard,
    handleInputKeyDown,
    docBodyRefCallback,
    handleExport,
    handleFormatBold: () => execFormatCommand('bold', docBodyRef.current),
    handleFormatItalic: () => execFormatCommand('italic', docBodyRef.current),
    handleHeading2: () => wrapSelectionHeading('h2', docBodyRef.current),
    handleHeading3: () => wrapSelectionHeading('h3', docBodyRef.current),
    handleClearFormatting: clearFormattingSelection,
    loadTypedUrl,
    retryPageLoad,
    loadPage,
  };
}
