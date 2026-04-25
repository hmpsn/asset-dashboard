import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Send, Loader2, ArrowLeft, ExternalLink, AlertTriangle,
  Copy, Check, FileText, Sparkles, Maximize2,
} from 'lucide-react';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { post, get } from '../api/client';
import { RenderMarkdown } from './client/helpers';
import { queryKeys } from '../lib/queryKeys';
import { Icon, Button } from './ui';

interface SeoIssue {
  check: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

interface PageSection {
  level: number;
  heading: string;
  body: string;
}

interface PageData {
  title: string;
  sections: PageSection[];
  bodyText: string;
  html: string;
  issues: SeoIssue[];
  slug: string;
  url?: string;
  preamble?: string;
}

interface SitemapPage {
  slug: string;
  title: string;
  url: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  /** Heading name parsed from **Rewriting: X** prefix; present on AI rewrite messages only */
  sectionTarget?: string;
}

interface Props {
  workspaceId: string;
  initialPageUrl?: string;
  focusMode?: boolean;
  onFocusModeToggle?: () => void;
  onBack: () => void;
}

// Document-body rendering classes — applied to contenteditable DOM nodes via
// className assignment, not to React UI chrome. Exempt from Phase 5
// arbitrary-px rule (kickoff §6.4 document-content exception).
const HEADING_CLASSES: Record<string, string> = {
  h1: 'text-[20px] font-bold text-slate-100 mb-2 mt-5',
  h2: 'text-[15px] font-semibold text-slate-300 mb-2 mt-5',
  h3: 'text-[12px] font-medium text-slate-400 mb-1.5 mt-4 ml-3 pl-2 border-l-2 border-slate-700',
};

const QUICK_PROMPTS = [
  'Rewrite the intro paragraph to lead with a direct answer',
  'Suggest an FAQ section with schema-ready Q&A pairs',
  'Optimize all headings for search intent and AEO',
  'Add citation-ready data points and statistics',
  'Rewrite this page in our brand voice with AEO best practices',
  'Identify sections that need better keyword integration',
];

export function PageRewriteChat({ workspaceId, initialPageUrl, focusMode, onFocusModeToggle, onBack }: Props) {
  // Page state
  const [pageUrl, setPageUrl] = useState(initialPageUrl || '');
  const [pageData, setPageData] = useState<PageData | null>(null);
  const [loadingPage, setLoadingPage] = useState(false);
  const [pageError, setPageError] = useState('');

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionId] = useState(() => `rewrite-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  // Content pane state
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  // Refs
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Sitemap combobox
  const { data: sitemapPages = [] } = useQuery<SitemapPage[]>({
    queryKey: queryKeys.admin.rewritePages(workspaceId),
    queryFn: () => get<SitemapPage[]>(`/api/rewrite-chat/${workspaceId}/pages`),
    staleTime: 5 * 60 * 1000,
  });
  const [comboOpen, setComboOpen] = useState(false);
  const [comboQuery, setComboQuery] = useState('');
  const [comboIdx, setComboIdx] = useState(0);
  const comboRef = useRef<HTMLDivElement>(null);
  const comboInputRef = useRef<HTMLInputElement>(null);

  // Editable AI message content (keyed by message array index)
  const [msgEdits, setMsgEdits] = useState<Record<number, string>>({});

  const docBodyRef = useRef<HTMLDivElement | null>(null);
  const docPanelRef = useRef<HTMLDivElement>(null);

  // Floating formatting toolbar
  const [toolbarPos, setToolbarPos] = useState<{ top: number; left: number } | null>(null);

  // Export popover
  const [exportOpen, setExportOpen] = useState(false);
  const exportBtnRef = useRef<HTMLButtonElement>(null);
  const exportPopoverRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-load page if initial URL provided
  useEffect(() => {
    if (initialPageUrl) loadPage(initialPageUrl);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!comboOpen) return;
    const handler = (e: MouseEvent) => {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setComboOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [comboOpen]);

  // Show floating toolbar when text is selected inside the document panel
  useEffect(() => {
    const handleSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) { setToolbarPos(null); return; }
      if (!docBodyRef.current) return;
      try {
        const range = sel.getRangeAt(0);
        if (!docBodyRef.current.contains(range.commonAncestorContainer)) { setToolbarPos(null); return; }
        const selRect = range.getBoundingClientRect();
        const panelRect = docPanelRef.current?.getBoundingClientRect();
        if (!panelRect) return;
        const left = Math.min(Math.max(selRect.left - panelRect.left, 0), panelRect.width - 148);
        setToolbarPos({ top: selRect.top - panelRect.top - 38, left });
      } catch { setToolbarPos(null); }
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, []);

  // Close export popover on outside click
  useEffect(() => {
    if (!exportOpen) return;
    const handler = (e: MouseEvent) => {
      if (exportPopoverRef.current && !exportPopoverRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [exportOpen]);

  const loadPage = useCallback(async (url: string) => {
    if (!url.trim()) return;
    setLoadingPage(true);
    setPageError('');
    // Clear the pageKey guard so the ref callback re-initializes even for the same page
    if (docBodyRef.current) docBodyRef.current.dataset.pageKey = '';
    try {
      const data = await post<PageData>(`/api/rewrite-chat/${workspaceId}/load-page`, { url: url.trim() });
      setPageData(data);
      setPageUrl(url.trim());
    } catch (err) {
      setPageData(null);
      setPageError(err instanceof Error ? err.message : 'Failed to load page');
    } finally {
      setLoadingPage(false);
    }
  }, [workspaceId]);

  const sendMessage = async (text?: string) => {
    const question = (text || input).trim();
    if (!question || sending) return;

    const userMsg: ChatMessage = { role: 'user', content: question, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      const resp = await post<{ answer: string }>(`/api/rewrite-chat/${workspaceId}`, {
        question,
        sessionId,
        pageUrl: pageData ? pageUrl : undefined,
        pageContent: pageData?.bodyText,
        pageTitle: pageData?.title,
        pageIssues: pageData?.issues,
      });

      const sectionMatch = resp.answer.match(/^\*{0,2}Rewriting:\s*([^*\n]+?)\*{0,2}\s*$/im);
      const sectionTarget = sectionMatch ? sectionMatch[1].trim() : undefined;
      const assistantMsg: ChatMessage = { role: 'assistant', content: resp.answer, timestamp: Date.now(), sectionTarget };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      const errMsg: ChatMessage = {
        role: 'assistant',
        content: `**Error:** ${err instanceof Error ? err.message : 'Failed to get response'}`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const copyToClipboard = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const toSectionSlug = (text: string) =>
    text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const getIndentLevel = (slug: string) => {
    const segs = slug.replace(/^\/|\/$/g, '').split('/');
    return Math.max(0, segs.length - 1);
  };

  const isUrlQuery = comboQuery.startsWith('https://') || comboQuery.startsWith('http://');

  const filteredPages = isUrlQuery
    ? []
    : sitemapPages.filter(p =>
        !comboQuery ||
        p.slug.toLowerCase().includes(comboQuery.toLowerCase()) ||
        p.title.toLowerCase().includes(comboQuery.toLowerCase())
      );

  const stripRewritingPrefix = (content: string): string =>
    content.replace(/^\*{0,2}Rewriting:\s*[^*\n]+\*{0,2}\s*\n?/im, '');

  /** Strip prefix AND rationale — returns only the rewrite prose for Apply/editable */
  const extractRewriteOnly = (content: string): string => {
    const stripped = stripRewritingPrefix(content);
    // Remove "Rationale:" or "**Rationale:**" section and everything after
    const rationaleIdx = stripped.search(/\n\s*\*{0,2}Rationale:?\*{0,2}/i);
    return (rationaleIdx > 0 ? stripped.slice(0, rationaleIdx) : stripped).trim();
  };

  const handleComboKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (filteredPages.length > 0) setComboIdx(i => Math.min(i + 1, filteredPages.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setComboIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (isUrlQuery) { loadPage(comboQuery); setComboOpen(false); }
      else if (filteredPages[comboIdx]) { selectPage(filteredPages[comboIdx]); }
    } else if (e.key === 'Escape') { e.stopPropagation(); setComboOpen(false); }
  };

  const selectPage = (page: SitemapPage) => {
    setComboQuery('');
    setComboOpen(false);
    setComboIdx(0);
    if (page.url) loadPage(page.url);
  };

  const openCombo = () => {
    setComboOpen(true);
    setComboQuery('');
    setComboIdx(0);
    setTimeout(() => comboInputRef.current?.focus(), 0);
  };

  const buildDocHtml = (data: PageData): string => {
    // Server text may contain raw HTML entities (&#x27;, &amp;) — decode first, then re-escape for safe innerHTML
    const decodeEntities = (s: string) => { const el = document.createElement('span'); el.innerHTML = s; return el.textContent || s; };
    const escHtml = (s: string) => decodeEntities(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const bodyP = (body: string, extraClass = '') =>
      body ? `<p class="text-[13px] text-slate-500 leading-[1.7] mb-3${extraClass ? ' ' + extraClass : ''}">${escHtml(body)}</p>` : '';

    const parts: string[] = [
      `<h1 data-section="${escHtml(toSectionSlug(data.title))}" class="text-[20px] font-bold text-slate-100 mb-3">${escHtml(data.title)}</h1>`,
    ];

    // Render preamble paragraphs (text before the first heading on the page)
    if (data.preamble) parts.push(bodyP(data.preamble));

    for (const section of data.sections) {
      const slug = toSectionSlug(section.heading);
      if (section.level === 1) {
        parts.push(`<h1 data-section="${escHtml(slug)}" class="text-[20px] font-bold text-slate-100 mb-2 mt-5">${escHtml(section.heading)}</h1>${bodyP(section.body)}`);
      } else if (section.level === 2) {
        parts.push(`<h2 data-section="${escHtml(slug)}" class="text-[15px] font-semibold text-slate-300 mb-2 mt-5">${escHtml(section.heading)}</h2>${bodyP(section.body)}`);
      } else if (section.level === 3) {
        parts.push(`<h3 data-section="${escHtml(slug)}" class="text-[12px] font-medium text-slate-400 mb-1.5 mt-4 ml-3 pl-2 border-l-2 border-slate-700">${escHtml(section.heading)}</h3>${bodyP(section.body, 'ml-3')}`);
      } else {
        const extraIndent = (section.level - 3) * 12;
        parts.push(`<h4 data-section="${escHtml(slug)}" class="text-[12px] font-medium text-slate-400 mb-1.5 mt-3 pl-2 border-l-2 border-slate-700" style="margin-left:${12 + extraIndent}px">${escHtml(section.heading)}</h4>${bodyP(section.body, `ml-[${12 + extraIndent}px]`)}`);
      }
    }

    return parts.join('');
  };

  // execCommand-ok: no replacement for contenteditable bold/italic in 2026
  const execFormat = (command: string) => {
    docBodyRef.current?.focus();
    document.execCommand(command, false);
  };

  const wrapHeading = (tag: 'h2' | 'h3') => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    docBodyRef.current?.focus();
    const range = sel.getRangeAt(0);
    const block = (range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : range.startContainer as Element);
    const existingHeading = block?.closest('h1,h2,h3,h4,h5,h6');
    if (existingHeading) {
      const newEl = document.createElement(tag);
      newEl.innerHTML = existingHeading.innerHTML;
      // Preserve data-section so applyToSection can still find this heading after a level change
      const sectionAttr = existingHeading.getAttribute('data-section');
      if (sectionAttr) newEl.setAttribute('data-section', sectionAttr);
      newEl.className = HEADING_CLASSES[tag] ?? '';
      existingHeading.replaceWith(newEl);
    } else {
      // execCommand-ok: no replacement for contenteditable formatBlock in 2026
      document.execCommand('formatBlock', false, tag);
      // formatBlock creates a bare heading — apply classes and data-section so Apply can target it
      const afterSel = window.getSelection();
      if (afterSel && afterSel.rangeCount > 0) {
        const anchor = afterSel.anchorNode;
        const newHeading = (anchor?.nodeType === Node.TEXT_NODE
          ? anchor.parentElement
          : anchor as Element)?.closest('h1,h2,h3,h4,h5,h6');
        if (newHeading) {
          newHeading.className = HEADING_CLASSES[tag] ?? '';
          const slug = toSectionSlug(newHeading.textContent || '');
          if (slug) newHeading.setAttribute('data-section', slug);
        }
      }
    }
  };

  // execCommand-ok: no replacement for contenteditable removeFormat in 2026
  const clearFormatting = () => { document.execCommand('removeFormat'); document.execCommand('formatBlock', false, 'p'); };

  const applyToSection = (content: string, sectionTarget: string) => {
    const docBody = docBodyRef.current;
    if (!docBody) return;

    const targetSlug = toSectionSlug(sectionTarget);
    const heading = docBody.querySelector(`[data-section="${targetSlug}"]`);
    // Remove paragraphs between the target heading and the next heading sibling
    if (heading) {
      let sibling = heading.nextElementSibling;
      while (sibling && !/^H[1-6]$/i.test(sibling.tagName)) {
        const next = sibling.nextElementSibling;
        sibling.remove();
        sibling = next;
      }
    }

    // Insert the new content as a paragraph
    const p = document.createElement('p');
    p.textContent = content;
    p.className = 'text-[13px] text-slate-500 leading-[1.7] mb-3';
    p.style.cssText = 'background-color:rgba(13,148,136,0.2);border-left:2px solid #0d9488;padding-left:10px;transition:background-color 2s ease,border-left 2s ease,padding-left 2s ease';

    if (heading ?? docBody.lastElementChild) {
      (heading ?? docBody.lastElementChild!).insertAdjacentElement('afterend', p);
    } else {
      docBody.appendChild(p);
    }

    // Fade out the highlight
    setTimeout(() => {
      p.style.backgroundColor = '';
      p.style.borderLeft = '';
      p.style.paddingLeft = '';
    }, 2000);
  };

  const serializeDocToMarkdown = (): string => {
    const docBody = docBodyRef.current;
    if (!docBody) return '';
    const lines: string[] = [];

    if (pageData && pageData.issues.length > 0) {
      lines.push('## Issues\n');
      pageData.issues.forEach(issue => lines.push(`- [${issue.severity}] ${issue.message}`));
      lines.push('');
    }

    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = (node.textContent || '').trim();
        if (text) lines.push(`${text}\n`);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node as Element;
      const tag = el.tagName.toLowerCase();
      if (tag === 'h1') { lines.push(`# ${el.textContent?.trim()}\n`); return; }
      if (tag === 'h2') { lines.push(`\n## ${el.textContent?.trim()}\n`); return; }
      if (tag === 'h3') { lines.push(`\n### ${el.textContent?.trim()}\n`); return; }
      if (tag === 'h4') { lines.push(`\n#### ${el.textContent?.trim()}\n`); return; }
      if (tag === 'p') {
        const parts: string[] = [];
        el.childNodes.forEach(child => {
          if (child.nodeType === Node.TEXT_NODE) { parts.push(child.textContent || ''); }
          else if (child.nodeType === Node.ELEMENT_NODE) {
            const c = child as Element;
            if (c.tagName === 'STRONG' || c.tagName === 'B') parts.push(`**${c.textContent}**`);
            else if (c.tagName === 'EM' || c.tagName === 'I') parts.push(`*${c.textContent}*`);
            else parts.push(c.textContent || '');
          }
        });
        const text = parts.join('').trim();
        if (text) lines.push(`${text}\n`);
        return;
      }
      el.childNodes.forEach(walk);
    };

    docBody.childNodes.forEach(walk);
    return lines.join('\n');
  };

  const serializeDocToDocx = (): Paragraph[] => {
    const docBody = docBodyRef.current;
    const paragraphs: Paragraph[] = [];

    // Severity label colors for the Issues section
    const severityColor: Record<string, string> = { error: 'DC2626', warning: 'D97706', info: '2563EB' };

    if (pageData && pageData.issues.length > 0) {
      paragraphs.push(new Paragraph({ text: 'SEO Issues', heading: HeadingLevel.HEADING_2 }));
      pageData.issues.forEach(issue => {
        const color = severityColor[issue.severity] ?? '6B7280';
        paragraphs.push(new Paragraph({
          bullet: { level: 0 },
          children: [
            new TextRun({ text: issue.severity.toUpperCase(), bold: true, color, size: 20 }),
            new TextRun({ text: `  ${issue.message}`, size: 22 }),
          ],
        }));
      });
      // Spacer after issues section
      paragraphs.push(new Paragraph({ text: '' }));
    }

    if (!docBody) return paragraphs;

    const headingLevel = (tag: string): typeof HeadingLevel[keyof typeof HeadingLevel] | null => {
      if (tag === 'h1') return HeadingLevel.HEADING_1;
      if (tag === 'h2') return HeadingLevel.HEADING_2;
      if (tag === 'h3') return HeadingLevel.HEADING_3;
      if (tag === 'h4') return HeadingLevel.HEADING_4;
      return null;
    };

    const walk = (node: Node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node as Element;
      const tag = el.tagName.toLowerCase();
      const level = headingLevel(tag);
      if (level) {
        paragraphs.push(new Paragraph({ text: el.textContent?.trim() || '', heading: level }));
        return;
      }
      if (tag === 'p') {
        const runs: TextRun[] = [];
        el.childNodes.forEach(child => {
          if (child.nodeType === Node.TEXT_NODE) {
            runs.push(new TextRun({ text: child.textContent || '', size: 24 }));
          } else if (child.nodeType === Node.ELEMENT_NODE) {
            const c = child as Element;
            const ctag = c.tagName;
            runs.push(new TextRun({
              text: c.textContent || '',
              size: 24,
              bold: ctag === 'STRONG' || ctag === 'B',
              italics: ctag === 'EM' || ctag === 'I',
            }));
          }
        });
        if (runs.length) {
          paragraphs.push(new Paragraph({
            children: runs,
            spacing: { after: 160 },
          }));
        }
        return;
      }
      el.childNodes.forEach(walk);
    };

    docBody.childNodes.forEach(walk);
    return paragraphs;
  };

  const handleExport = (mode: 'copy' | 'download' | 'docx') => {
    const slug = (pageData?.slug || 'page').replace(/\//g, '-').replace(/^-/, '');
    if (mode === 'docx') {
      const doc = new Document({
        styles: {
          default: {
            document: { run: { font: 'Calibri', size: 24, color: '1a1a1a' } },
          },
          paragraphStyles: [
            {
              id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
              run: { font: 'Calibri', size: 56, bold: true, color: '111111' },
              paragraph: { spacing: { before: 480, after: 160 }, outlineLevel: 0 },
            },
            {
              id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
              run: { font: 'Calibri', size: 40, bold: true, color: '111111' },
              paragraph: { spacing: { before: 400, after: 120 }, outlineLevel: 1 },
            },
            {
              id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
              run: { font: 'Calibri', size: 32, bold: true, color: '222222' },
              paragraph: { spacing: { before: 320, after: 80 }, outlineLevel: 2 },
            },
            {
              id: 'Heading4', name: 'Heading 4', basedOn: 'Normal', next: 'Normal', quickFormat: true,
              run: { font: 'Calibri', size: 26, bold: true, italics: true, color: '444444' },
              paragraph: { spacing: { before: 240, after: 60 }, outlineLevel: 3 },
            },
          ],
        },
        sections: [{
          properties: {
            page: {
              size: { width: 12240, height: 15840 },
              margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
            },
          },
          children: serializeDocToDocx(),
        }],
      });
      Packer.toBlob(doc).then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${slug}-brief.docx`;
        a.click();
        URL.revokeObjectURL(url);
        setExportOpen(false);
      }).catch(err => {
        console.error('DOCX export failed:', err);
        setExportOpen(false);
        alert('Export failed. Please try again.');
      });
      return;
    }
    const md = serializeDocToMarkdown();
    if (mode === 'copy') {
      navigator.clipboard.writeText(md);
    } else {
      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${slug}-brief.md`;
      a.click();
      URL.revokeObjectURL(url);
    }
    setExportOpen(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--brand-border)] bg-[var(--surface-2)]/80 backdrop-blur-sm flex-shrink-0">
        <button
          onClick={onBack}
          className="p-1.5 rounded-[var(--radius-lg)] text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] hover:bg-[var(--surface-3)] transition-colors"
          title="Back"
        >
          <Icon as={ArrowLeft} size="md" />
        </button>
        <div className="flex items-center gap-2">
          <Icon as={Sparkles} size="md" className="text-teal-400" />
          <h1 className="text-sm font-semibold text-[var(--brand-text-bright)]">AI Page Rewriter</h1>
        </div>

        {/* Sitemap combobox */}
        <div className="flex-1 ml-4 relative" ref={comboRef}>

          {/* Collapsed: page loaded */}
          {pageData && !comboOpen && (
            <div className="flex items-center gap-2 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] px-3 py-1.5">
              <Icon as={FileText} size="sm" className="text-[var(--brand-text-muted)] flex-shrink-0" />
              <span className="text-xs text-[var(--brand-text-bright)] flex-1 truncate">{pageData.slug ? `/${pageData.slug}` : pageUrl}</span>
              <button onClick={openCombo} className="text-[10px] text-teal-400 hover:text-teal-300 font-medium flex-shrink-0">Change</button>
            </div>
          )}

          {/* Closed: no page */}
          {!pageData && !comboOpen && (
            <button
              onClick={openCombo}
              className="w-full flex items-center gap-2 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] px-3 py-1.5 text-xs text-[var(--brand-text-muted)] hover:border-teal-500/50 hover:text-[var(--brand-text-bright)] transition-colors"
            >
              <Icon as={FileText} size="sm" />
              Search pages or paste a URL…
            </button>
          )}

          {/* Open */}
          {comboOpen && (
            <div className="flex flex-col bg-[var(--surface-3)] border border-teal-500/50 rounded-[var(--radius-lg)] overflow-hidden shadow-xl">
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--brand-border)]">
                <Icon as={FileText} size="sm" className="text-[var(--brand-text-muted)] flex-shrink-0" />
                <input
                  ref={comboInputRef}
                  role="combobox"
                  aria-expanded={filteredPages.length > 0}
                  aria-activedescendant={filteredPages[comboIdx] ? `combo-opt-${comboIdx}` : undefined}
                  aria-label="Search pages or paste a URL"
                  autoFocus
                  value={comboQuery}
                  onChange={e => { setComboQuery(e.target.value); setComboIdx(0); }}
                  onKeyDown={handleComboKeyDown}
                  placeholder="Search pages or paste a URL…"
                  className="flex-1 bg-transparent text-xs text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:outline-none"
                />
                {loadingPage && <Loader2 className="w-3 h-3 animate-spin text-teal-400 flex-shrink-0" />}
              </div>

              {isUrlQuery && (
                <div className="px-3 py-2">
                  <button
                    onClick={() => { loadPage(comboQuery); setComboOpen(false); }}
                    className="text-xs text-teal-400 hover:text-teal-300"
                  >
                    Load {comboQuery.length > 60 ? `${comboQuery.slice(0, 60)}…` : comboQuery}
                  </button>
                </div>
              )}

              {!isUrlQuery && filteredPages.length > 0 && (
                <div className="max-h-[240px] overflow-y-auto">
                  {filteredPages.map((page, i) => (
                    <button
                      key={page.slug}
                      id={`combo-opt-${i}`}
                      role="option"
                      aria-selected={i === comboIdx}
                      onClick={() => selectPage(page)}
                      onMouseEnter={() => setComboIdx(i)}
                      className={`w-full flex items-center gap-2 py-1.5 text-xs text-left transition-colors border-l-2 ${
                        i === comboIdx
                          ? 'bg-teal-500/10 text-[var(--brand-text-bright)] border-teal-500'
                          : 'text-[var(--brand-text)] hover:bg-[var(--surface-1)]/50 hover:text-[var(--brand-text-bright)] border-transparent'
                      }`}
                      style={{ paddingLeft: `${12 + getIndentLevel(page.slug) * 12}px` }}
                    >
                      <FileText className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">{page.slug || '/'}</span>
                    </button>
                  ))}
                </div>
              )}

              {!isUrlQuery && filteredPages.length === 0 && (
                <div className="px-3 py-2 text-[11px] text-[var(--brand-text-muted)]">
                  {sitemapPages.length > 0 ? `No pages match "${comboQuery}"` : 'No sitemap — paste a full URL above'}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Focus mode toggle */}
        {onFocusModeToggle && (
          <button
            onClick={onFocusModeToggle}
            title={focusMode ? 'Exit focus mode (Esc)' : 'Enter focus mode'}
            className={`p-1.5 rounded-[var(--radius-lg)] transition-colors flex-shrink-0 ${
              focusMode
                ? 'text-teal-400 bg-teal-500/10 hover:bg-teal-500/20'
                : 'text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] hover:bg-[var(--surface-3)]'
            }`}
          >
            <Icon as={Maximize2} size="sm" className={`transition-transform ${focusMode ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>

      {/* Main two-pane layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* ═══ LEFT PANE: Chat ═══ */}
        <div className="flex flex-col w-1/2 border-r border-[var(--brand-border)]">
          {/* Chat messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-teal-500/10 flex items-center justify-center">
                  <Sparkles className="w-6 h-6 text-teal-400" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-[var(--brand-text-bright)] mb-1">AI Page Rewriter</h2>
                  <p className="text-xs text-[var(--brand-text-muted)] max-w-sm">
                    {pageData
                      ? `"${pageData.title}" is loaded. Ask me to rewrite sections, optimize headings, add FAQ blocks, or improve AEO.`
                      : 'Load a page above, then ask me to rewrite sections, optimize for AEO, or suggest improvements.'}
                  </p>
                </div>

                {/* Quick prompts */}
                {pageData && (
                  <div className="grid grid-cols-2 gap-2 max-w-md mt-2">
                    {QUICK_PROMPTS.map((prompt, i) => (
                      <button
                        key={i}
                        onClick={() => sendMessage(prompt)}
                        className="text-left px-3 py-2 rounded-[var(--radius-lg)] bg-[var(--surface-3)]/50 border border-[var(--brand-border)]/50 hover:border-teal-500/30 hover:bg-[var(--surface-3)] text-[11px] text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] transition-colors"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-[var(--radius-xl)] px-4 py-3 ${
                  msg.role === 'user'
                    ? 'bg-teal-600/20 border border-teal-500/20 text-[var(--brand-text-bright)]'
                    : 'bg-[var(--surface-3)]/80 border border-[var(--brand-border)]/50 text-[var(--brand-text-bright)]'
                }`}>
                  {msg.role === 'assistant' ? (
                    msg.sectionTarget ? (
                      // Rewrite message: editable contenteditable block + Apply button
                      <>
                        <div
                          contentEditable
                          suppressContentEditableWarning
                          className="text-xs leading-relaxed focus:outline-none border border-transparent focus:border-[var(--brand-border-hover)] rounded p-1 -m-1 transition-colors"
                          onInput={e => setMsgEdits(prev => ({ ...prev, [i]: (e.currentTarget as HTMLDivElement).innerText }))}
                          ref={(el) => {
                            // Initialize content once; do NOT use dangerouslySetInnerHTML (React would overwrite on re-render)
                            if (el && !el.dataset.initialized) {
                              el.dataset.initialized = 'true';
                              el.innerText = extractRewriteOnly(msg.content);
                            }
                          }}
                        />
                        <div className="flex items-center gap-1 mt-2 pt-2 border-t border-[var(--brand-border)]/30">
                          <button
                            onClick={() => applyToSection(msgEdits[i] ?? extractRewriteOnly(msg.content), msg.sectionTarget!)}
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-teal-500/10 text-teal-400 border border-teal-500/30 hover:bg-teal-500/20 transition-colors"
                          >
                            <Icon as={Check} size="sm" />
                            Apply to {msg.sectionTarget}
                          </button>
                          <button
                            onClick={() => copyToClipboard(msgEdits[i] ?? extractRewriteOnly(msg.content), i)}
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] hover:bg-[var(--surface-1)]/50 transition-colors"
                          >
                            {copiedIdx === i ? <Icon as={Check} size="sm" className="text-teal-400" /> : <Icon as={Copy} size="sm" />}
                            {copiedIdx === i ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                      </>
                    ) : (
                      // Regular assistant message: rendered markdown + copy button
                      <>
                        <div className="text-xs leading-relaxed">
                          <RenderMarkdown text={msg.content} />
                        </div>
                        <div className="flex items-center gap-1 mt-2 pt-2 border-t border-[var(--brand-border)]/30">
                          <button
                            onClick={() => copyToClipboard(msg.content, i)}
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] hover:bg-[var(--surface-1)]/50 transition-colors"
                          >
                            {copiedIdx === i ? <Icon as={Check} size="sm" className="text-teal-400" /> : <Icon as={Copy} size="sm" />}
                            {copiedIdx === i ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                      </>
                    )
                  ) : (
                    <p className="text-xs leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>
              </div>
            ))}

            {sending && (
              <div className="flex justify-start">
                <div className="bg-[var(--surface-3)]/80 border border-[var(--brand-border)]/50 rounded-[var(--radius-lg)] px-4 py-3 flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-400" />
                  <span className="text-xs text-[var(--brand-text)]">Analyzing and writing...</span>
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Input area */}
          <div className="flex-shrink-0 border-t border-[var(--brand-border)] px-4 py-3 bg-[var(--surface-2)]/50">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={pageData ? 'Ask me to rewrite a section, optimize headings, add FAQs...' : 'Load a page first, or ask a general rewriting question...'}
                className="flex-1 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] px-3 py-2 text-xs text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:border-teal-500 resize-none min-h-[40px] max-h-[120px]"
                rows={2}
              />
              <Button
                variant="primary"
                size="sm"
                icon={Send}
                onClick={() => sendMessage()}
                disabled={sending || !input.trim()}
                className="flex-shrink-0"
              />
            </div>
          </div>
        </div>

        {/* ═══ RIGHT PANE: Editable Document ═══ */}
        <div ref={docPanelRef} className="flex flex-col w-1/2 overflow-hidden bg-[var(--surface-1)]/50 relative">

          {/* Empty state */}
          {!pageData && !loadingPage && !pageError && (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-3 px-8">
              <Icon as={FileText} size="2xl" className="text-[var(--brand-text-dim)]" />
              <div>
                <h3 className="text-sm font-medium text-[var(--brand-text)]">No page loaded</h3>
                <p className="text-xs text-[var(--brand-text-dim)] mt-1">Search for a page above or paste a URL to see the content here.</p>
              </div>
            </div>
          )}

          {loadingPage && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-teal-400" />
              <span className="text-xs text-[var(--brand-text)]">Loading page content...</span>
            </div>
          )}

          {pageError && (
            <div className="flex flex-col items-center justify-center h-full gap-3 px-8">
              <AlertTriangle className="w-6 h-6 text-amber-400/80" />
              <p className="text-xs text-[var(--brand-text)] text-center">{pageError}</p>
            </div>
          )}

          {pageData && !loadingPage && (
            <>
              {/* Panel header */}
              <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 border-b border-[var(--brand-border)] bg-[var(--surface-2)]/60">
                <a
                  href={pageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[11px] text-[var(--brand-text)] hover:text-teal-400 transition-colors flex-1 min-w-0"
                >
                  <span className="truncate">{pageData.slug ? `/${pageData.slug}` : pageUrl}</span>
                  <Icon as={ExternalLink} size="sm" className="flex-shrink-0" />
                </a>
                {/* Export popover */}
                <div className="relative flex-shrink-0" ref={exportPopoverRef}>
                  <button
                    ref={exportBtnRef}
                    onClick={() => setExportOpen(o => !o)}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] hover:bg-[var(--surface-3)] transition-colors"
                  >
                    Export brief
                  </button>
                  {exportOpen && (
                    <div className="absolute right-0 top-7 z-50 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] shadow-xl p-1 flex flex-col gap-0.5 min-w-[170px]">
                      <button
                        onClick={() => handleExport('copy')}
                        className="flex items-center gap-2 px-3 py-1.5 rounded text-[11px] text-[var(--brand-text-bright)] hover:bg-[var(--surface-1)] transition-colors text-left"
                      >
                        <Icon as={Copy} size="sm" /> Copy as Markdown
                      </button>
                      <button
                        onClick={() => handleExport('download')}
                        className="flex items-center gap-2 px-3 py-1.5 rounded text-[11px] text-[var(--brand-text-bright)] hover:bg-[var(--surface-1)] transition-colors text-left"
                      >
                        <Icon as={FileText} size="sm" /> Download .md
                      </button>
                      <button
                        onClick={() => handleExport('docx')}
                        className="flex items-center gap-2 px-3 py-1.5 rounded text-[11px] text-[var(--brand-text-bright)] hover:bg-[var(--surface-1)] transition-colors text-left"
                      >
                        <Icon as={FileText} size="sm" /> Download .docx
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Audit issue chips — always visible, non-collapsible */}
              {pageData.issues.length > 0 && (
                <div className="flex-shrink-0 flex flex-wrap gap-1.5 px-4 py-2 border-b border-[var(--brand-border)] bg-[var(--surface-2)]/30">
                  {pageData.issues.slice(0, 20).map((issue, i) => (
                    <span
                      key={i}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border ${
                        issue.severity === 'error'
                          ? 'bg-red-950/40 border-red-500/40 text-red-400'
                          : issue.severity === 'warning'
                          ? 'bg-amber-950/40 border-amber-500/40 text-amber-400'
                          : 'bg-blue-950/40 border-blue-500/40 text-blue-400'
                      }`}
                    >
                      {issue.severity === 'error' ? '✕' : '⚠'} {issue.message}
                    </span>
                  ))}
                </div>
              )}

              {/* Contenteditable document body — initialized via ref callback, not JSX children, to prevent React from overwriting user edits on re-render */}
              <div
                ref={(el) => {
                  docBodyRef.current = el;
                  if (!el) return;
                  // Use slug, then title, then URL as fallback — never '' (empty string matches cleared state)
                  const pageKey = pageData.slug || pageData.title || pageData.url || '__loaded__';
                  if (el.dataset.pageKey === pageKey) return; // already initialized for this page
                  el.dataset.pageKey = pageKey;
                  el.innerHTML = buildDocHtml(pageData);
                }}
                role="textbox"
                aria-multiline="true"
                aria-label="Page content editor"
                contentEditable
                suppressContentEditableWarning
                spellCheck
                className="flex-1 overflow-y-auto px-6 py-5 focus:outline-none"
              />

              {/* Floating formatting toolbar — appears above text selection */}
              {toolbarPos && (
                <div
                  className="absolute z-50 flex items-center gap-0.5 bg-[var(--surface-3)] border border-[var(--brand-border-hover)] rounded-md shadow-xl px-1 py-0.5 pointer-events-auto"
                  style={{ top: toolbarPos.top, left: toolbarPos.left }}
                  onMouseDown={e => e.preventDefault()}
                >
                  <button onClick={() => execFormat('bold')} className="px-2 py-1 text-[11px] font-bold text-[var(--brand-text-bright)] hover:bg-[var(--surface-1)] rounded transition-colors">B</button>
                  <button onClick={() => execFormat('italic')} className="px-2 py-1 text-[11px] italic text-[var(--brand-text-bright)] hover:bg-[var(--surface-1)] rounded transition-colors">I</button>
                  <div className="w-px h-3 bg-[var(--brand-border-hover)] mx-0.5" />
                  <button onClick={() => wrapHeading('h2')} className="px-2 py-1 text-[10px] text-[var(--brand-text-bright)] hover:bg-[var(--surface-1)] rounded transition-colors">H2</button>
                  <button onClick={() => wrapHeading('h3')} className="px-2 py-1 text-[10px] text-[var(--brand-text-bright)] hover:bg-[var(--surface-1)] rounded transition-colors">H3</button>
                  <div className="w-px h-3 bg-[var(--brand-border-hover)] mx-0.5" />
                  <button onClick={clearFormatting} className="px-2 py-1 text-[11px] text-[var(--brand-text-muted)] hover:bg-[var(--surface-1)] rounded transition-colors">&times;</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
