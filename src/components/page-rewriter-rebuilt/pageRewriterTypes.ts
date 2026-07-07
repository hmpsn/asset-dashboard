// @ds-rebuilt
import type { PageKeywordProjection } from '../../../shared/types/workspace';
import type {
  ChatMessage,
  PageData as LegacyPageData,
  SeoIssue,
  SitemapPage,
} from '../page-rewrite-chat/pageRewriteChatModel';

export type PageRewriterPageData = LegacyPageData & PageKeywordProjection;

export type PageRewriterMessage = ChatMessage;
export type PageRewriterIssue = SeoIssue;
export type PageRewriterSitemapPage = SitemapPage;

export type PageRewriterExportMode = 'copyMarkdown' | 'copyHtml' | 'downloadMarkdown' | 'docx' | 'pdf';
