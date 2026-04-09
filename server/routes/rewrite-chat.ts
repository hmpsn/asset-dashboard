/**
 * rewrite-chat routes — full-page AI rewrite assistant
 * POST /api/rewrite-chat/:workspaceId — send a message, get AI response
 * POST /api/rewrite-chat/:workspaceId/load-page — fetch + parse a page for the content pane
 */
import { Router } from 'express';
import { getWorkspace } from '../workspaces.js';
import { callOpenAI } from '../openai-helpers.js';
import { buildWorkspaceIntelligence, formatKeywordsForPrompt, formatPersonasForPrompt, formatForPrompt, formatBrandVoiceForPrompt, formatKnowledgeBaseForPrompt } from '../workspace-intelligence.js';
import { getLatestSnapshot } from '../reports.js';
import {
  addMessage,
  buildConversationContext,
  getSession as getChatSession,
  generateSessionSummary,
} from '../chat-memory.js';
import { addActivity } from '../activity-log.js';
import { createLogger } from '../logger.js';
import type { SeoIssue, PageSeoResult } from '../seo-audit.js';
import { buildSystemPrompt } from '../prompt-assembly.js';

import { requireWorkspaceAccess } from '../auth.js';
const router = Router();
const log = createLogger('rewrite-chat');

// ── Helper: strip HTML to readable text sections ──
interface PageSection {
  level: number;    // 1=H1, 2=H2, 3=H3, etc.
  heading: string;  // heading text
  body: string;     // paragraph text immediately following this heading (up to 800 chars)
}

function extractPageSections(html: string): { title: string; sections: PageSection[]; bodyText: string } {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || '';

  // Extract main content area (prefer <main>, <article>, then <body>)
  let contentHtml = html;
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (mainMatch) contentHtml = mainMatch[1];
  else if (articleMatch) contentHtml = articleMatch[1];
  else {
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) contentHtml = bodyMatch[1];
  }

  // Strip noisy elements
  contentHtml = contentHtml
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '');

  // Two-pass tokeniser: heading tokens and paragraph tokens
  type Token = { type: 'h'; level: number; text: string } | { type: 'p'; text: string };
  const tokens: Token[] = [];
  const tokenRegex = /<(h[1-6])[^>]*>([\s\S]*?)<\/h[1-6]>|<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = tokenRegex.exec(contentHtml)) !== null) {
    if (m[1]) {
      const text = m[2].replace(/<[^>]+>/g, '').trim();
      if (text) tokens.push({ type: 'h', level: parseInt(m[1][1]), text });
    } else if (m[3] !== undefined) {
      const text = m[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (text) tokens.push({ type: 'p', text });
    }
  }

  // Build sections: each heading accumulates following paragraph tokens
  const sections: PageSection[] = [];
  let i = 0;

  // Collect orphan paragraphs before the first heading into the title section body
  const preambleParts: string[] = [];
  while (i < tokens.length && tokens[i].type === 'p') {
    preambleParts.push((tokens[i] as { type: 'p'; text: string }).text);
    i++;
  }
  const preambleBody = preambleParts.join(' ').slice(0, 800);

  for (; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'h') {
      const bodyParts: string[] = [];
      while (i + 1 < tokens.length && tokens[i + 1].type === 'p') {
        i++;
        bodyParts.push((tokens[i] as { type: 'p'; text: string }).text);
      }
      sections.push({ level: token.level, heading: token.text, body: bodyParts.join(' ').slice(0, 800) });
    }
  }

  // bodyText for AI context — unchanged usage
  const bodyText = contentHtml
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000);

  return { title, sections, bodyText, preamble: preambleBody };
}

// ── List sitemap pages from latest snapshot ──
router.get('/api/rewrite-chat/:workspaceId/pages', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { workspaceId } = req.params;
  const ws = getWorkspace(workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  if (!ws.webflowSiteId) return res.json([]);

  const snapshot = getLatestSnapshot(ws.webflowSiteId);
  if (!snapshot) return res.json([]);

  const pages = (snapshot.audit.pages as PageSeoResult[])
    .map(p => ({ slug: p.slug || '/', title: p.page || p.slug || '/', url: p.url }))
    .sort((a, b) => a.slug.localeCompare(b.slug));

  res.json(pages);
});

// ── Load page for content pane ──
router.post('/api/rewrite-chat/:workspaceId/load-page', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const { workspaceId } = req.params;
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  const ws = getWorkspace(workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  try {
    const htmlRes = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
    if (!htmlRes.ok) return res.status(502).json({ error: `Failed to fetch page: ${htmlRes.status}` });

    const html = await htmlRes.text();
    const { title, sections, bodyText } = extractPageSections(html);

    // Get audit issues for this page
    const slug = new URL(url).pathname.replace(/^\//, '').replace(/\/$/, '');
    let issues: SeoIssue[] = [];
    if (ws.webflowSiteId) {
      const snapshot = getLatestSnapshot(ws.webflowSiteId);
      if (snapshot) {
        const page = snapshot.audit.pages.find((p: { slug: string }) => p.slug === slug);
        if (page) issues = page.issues;
      }
    }

    res.json({ title, sections, bodyText, html: html.slice(0, 50000), issues, slug });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ detail: msg }, 'Failed to load page for rewrite chat');
    res.status(500).json({ error: msg });
  }
});

// ── Chat endpoint ──
router.post('/api/rewrite-chat/:workspaceId', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  const { workspaceId } = req.params;
  const { question, sessionId, pageUrl, pageContent, pageTitle, pageIssues } = req.body;

  if (!question) return res.status(400).json({ error: 'question required' });

  const ws = getWorkspace(workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.status(400).json({ error: 'OPENAI_API_KEY not configured' });

  try {
    // Build conversation history
    let historyMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    let priorContext = '';
    if (sessionId) {
      const ctx = buildConversationContext(ws.id, sessionId, 'admin');
      historyMessages = ctx.historyMessages;
      priorContext = ctx.priorContext;
      addMessage(ws.id, sessionId, 'admin', 'user', question);
    }

    // Build workspace intelligence (seoContext + pageProfile combined call)
    const pagePath = pageUrl ? new URL(pageUrl).pathname : undefined;
    const intel = await buildWorkspaceIntelligence(workspaceId, { slices: ['seoContext', 'pageProfile'],
      pagePath });
    const seo = intel.seoContext;
    const knowledgeBase = formatKnowledgeBaseForPrompt(seo?.knowledgeBase);

    // Build rewriting playbook block
    let playbookBlock = '';
    if (ws.rewritePlaybook?.trim()) {
      playbookBlock = `\n\nREWRITING PLAYBOOK (follow these instructions when suggesting rewrites):\n${ws.rewritePlaybook.trim()}`;
    }

    // Build page context block
    let pageContextBlock = '';
    if (pageContent || pageTitle) {
      pageContextBlock = `\n\nPAGE BEING REWRITTEN:`;
      if (pageTitle) pageContextBlock += `\nTitle: ${pageTitle}`;
      if (pageUrl) pageContextBlock += `\nURL: ${pageUrl}`;
      if (pageContent) pageContextBlock += `\nContent (first 6000 chars):\n${pageContent.slice(0, 6000)}`;
    }

    // Build issues block
    let issuesBlock = '';
    const issues = pageIssues || [];
    if (issues.length > 0) {
      const issueLines = issues.slice(0, 20).map((i: SeoIssue) =>
        `- [${i.severity}] ${i.check}: ${i.message}`
      );
      issuesBlock = `\n\nAUDIT ISSUES ON THIS PAGE:\n${issueLines.join('\n')}`;
    }

    const baseInstructions = `You are an expert SEO content strategist and copywriter. You are helping rewrite and optimize a specific web page.

Your role:
- Analyze the current page content and suggest specific rewrites
- When asked to rewrite a section, provide the COMPLETE rewritten text — not summaries or bullet points
- Match the brand voice exactly
- Incorporate target keywords naturally
- Optimize for both search engines AND answer engines (AI systems like ChatGPT, Perplexity)
- Format analysis, explanations, and rationale in Markdown so they're easy to read
- When showing rewritten content, use clear before/after formatting
- Be specific about WHERE on the page each change should go (which section, heading, paragraph)
- When writing a rewrite suggestion, ALWAYS start your response with this label on its own first line: **Rewriting: [Heading Name]** — use the exact heading text from the page. Example: **Rewriting: Why SaaS SEO Is Different**
- After the label, write the rewrite as plain prose only — no Markdown syntax (no ## headings, no **bold**, no bullet lists, no backticks). The content is inserted directly into a live document editor, so raw Markdown characters would appear as literal symbols.
- Explain your rationale briefly after the rewrite block

Answer Engine Optimization (AEO) principles:
- Lead with a direct, concise answer to the page's implied question
- Use clear heading hierarchy (H1 → H2 → H3)
- Add FAQ sections with schema-ready Q&A pairs
- Include citations and data points
- Use definition-style sentences that AI systems can extract
- Avoid hidden content, dark patterns, and clickbait
${formatKeywordsForPrompt(seo)}${formatBrandVoiceForPrompt(seo?.brandVoice)}${formatPersonasForPrompt(seo?.personas ?? [])}${knowledgeBase}${formatForPrompt(intel, { verbosity: 'detailed', sections: ['pageProfile'] })}${playbookBlock}${pageContextBlock}${issuesBlock}${priorContext ? `\n\nPREVIOUS CONVERSATION SUMMARY:\n${priorContext}` : ''}`; // bip-ok: intel used for raw seo field access above

    const systemPrompt = buildSystemPrompt(workspaceId, baseInstructions);

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...historyMessages.slice(-12),
      { role: 'user', content: question },
    ];

    const aiResult = await callOpenAI({
      model: 'gpt-4.1',
      messages,
      temperature: 0.6,
      maxTokens: 4000,
      feature: 'rewrite-chat',
      workspaceId: ws.id,
    });

    const answer = aiResult.text || 'No response generated.';

    // Persist response + auto-summarize
    if (sessionId) {
      addMessage(ws.id, sessionId, 'admin', 'assistant', answer);
      const session = getChatSession(ws.id, sessionId);
      if (session && session.messages.length === 2) {
        addActivity(ws.id, 'chat_session', `Rewrite chat: ${pageTitle || pageUrl || 'page'}`, 'Started AI rewrite conversation');
      }
      if (session && session.messages.length >= 6 && !session.summary) {
        generateSessionSummary(ws.id, sessionId).catch(() => {});
      }
    }

    res.json({ answer, sessionId: sessionId || undefined });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ detail: msg }, 'Rewrite chat error');
    res.status(500).json({ error: msg });
  }
});

export default router;
