import type { GeneratedPost } from '../shared/types/content.ts';
import { STUDIO_NAME, STUDIO_URL } from './constants.js';
import { COMPACT_LOGO_SVG, escapeHtml as esc, LOGO_SVG } from './export-html-shared.js';


/**
 * Render a professional branded HTML page for a blog post, suitable for PDF export.
 * Matches the content brief export styling with print-ready layout, studio branding,
 * and @page rules for clean PDF output.
 */
export function renderPostHTML(post: GeneratedPost): string {
  const date = new Date(post.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const updatedDate = new Date(post.updatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const metaDesc = post.seoMetaDescription || post.metaDescription;
  const titleTag = post.seoTitle || post.title;
  const statusLabel = post.status === 'approved' ? 'Approved' : post.status === 'review' ? 'In Review' : post.status === 'error' ? 'Failed' : 'Draft';
  const statusColor = post.status === 'approved' ? '#16a34a' : post.status === 'review' ? '#b45309' : post.status === 'error' ? '#dc2626' : '#64748b';

  // Build table of contents from sections
  const toc: string[] = [];
  if (post.introduction) toc.push('Introduction');
  for (const section of post.sections) {
    if (section.heading) toc.push(section.heading);
  }
  if (post.conclusion) toc.push('Conclusion');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titleTag)} — ${esc(STUDIO_NAME)}</title>
<style>
  @page {
    size: letter;
    margin: 0.75in 0.75in 1in 0.75in;
    @bottom-center {
      content: "${esc(STUDIO_NAME)}  ·  Content Post  ·  ${esc(post.targetKeyword).replace(/'/g, "\\'")}";
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 9px; color: #64748b; letter-spacing: 0.5px;
    }
    @bottom-right {
      content: counter(page) " / " counter(pages);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 9px; color: #64748b;
    }
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #ffffff; color: #1e293b; line-height: 1.6; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { max-width: 820px; margin: 0 auto; padding: 48px 40px; }
  @media print { .no-print { display: none !important; } body { padding-top: 0; } .page { padding: 0; max-width: none; } }
  .print-bar { position: fixed; top: 0; left: 0; right: 0; background: #0f172a; border-bottom: 1px solid #1e293b; padding: 10px 24px; display: flex; align-items: center; justify-content: space-between; z-index: 100; }
  .print-bar button { background: #0d9488; color: #fff; border: none; padding: 8px 24px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .print-bar button:hover { background: #0f766e; }
  .print-bar .info { font-size: 12px; color: #94a3b8; }
  .print-bar .tip { font-size: 10px; color: #64748b; margin-left: 16px; }
  body { padding-top: 52px; }

  /* Page break management */
  .section { margin-bottom: 28px; break-inside: avoid; }
  .content-section { break-inside: auto; }
  .content-section h2 { break-after: avoid; }

  /* Header */
  .header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 32px; padding-bottom: 20px; border-bottom: 2px solid #0d9488; }
  .header-left { flex: 1; min-width: 0; }
  .header-left .kw { font-size: 14px; color: #0d9488; font-weight: 600; margin-bottom: 6px; }
  .header-left h1 { font-size: 24px; font-weight: 700; color: #0f172a; margin-bottom: 6px; line-height: 1.3; }
  .header-left .subtitle { font-size: 13px; color: #475569; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .status-badge { display: inline-block; padding: 3px 12px; border-radius: 6px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; }
  .logo { opacity: 0.9; filter: brightness(0) saturate(100%) invert(25%) sepia(10%) saturate(500%) hue-rotate(180deg); flex-shrink: 0; margin-left: 24px; }

  /* Metadata strip */
  .meta-strip { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 28px; }
  .meta-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; }
  .meta-card .mc-label { font-size: 11px; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .meta-card .mc-value { font-size: 16px; font-weight: 700; color: #1e293b; }

  /* SEO preview */
  .seo-preview { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px 24px; margin-bottom: 28px; break-inside: avoid; }
  .seo-preview .label { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #0d9488; font-weight: 600; margin-bottom: 12px; }
  .seo-title { font-size: 18px; color: #1a0dab; font-weight: 400; line-height: 1.3; margin-bottom: 4px; }
  .seo-url { font-size: 13px; color: #006621; margin-bottom: 4px; }
  .seo-desc { font-size: 13px; color: #545454; line-height: 1.5; }

  /* Table of contents */
  .toc { margin-bottom: 28px; padding: 20px 24px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; break-inside: avoid; }
  .toc-title { font-size: 12px; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; }
  .toc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; }
  .toc-item { font-size: 12px; color: #334155; padding: 2px 0; display: flex; align-items: center; gap: 6px; }
  .toc-dot { width: 4px; height: 4px; border-radius: 50%; background: #0d9488; flex-shrink: 0; }

  /* Section titles (structural) */
  .section-title { font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: #334155; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
  .section-title::after { content: ''; flex: 1; height: 1px; background: #e2e8f0; }

  /* Content body */
  .content-body { line-height: 1.8; font-size: 15px; color: #1e293b; }
  .content-body h1 { font-size: 26px; font-weight: 700; color: #0f172a; margin: 32px 0 16px; line-height: 1.3; }
  .content-body h2 { font-size: 22px; font-weight: 700; color: #0f172a; margin: 32px 0 14px; padding-top: 16px; border-top: 1px solid #e2e8f0; line-height: 1.3; }
  .content-body h3 { font-size: 18px; font-weight: 600; color: #1e293b; margin: 24px 0 10px; line-height: 1.4; }
  .content-body h4 { font-size: 15px; font-weight: 600; color: #334155; margin: 20px 0 8px; }
  .content-body p { margin-bottom: 16px; }
  .content-body ul, .content-body ol { padding-left: 24px; margin-bottom: 16px; }
  .content-body li { margin-bottom: 6px; line-height: 1.7; }
  .content-body strong { color: #0f172a; }
  .content-body a { color: #0d9488; text-decoration: underline; text-underline-offset: 2px; }
  .content-body blockquote { border-left: 3px solid #0d9488; padding: 12px 20px; margin: 20px 0; background: #f0fdfa; border-radius: 0 10px 10px 0; font-style: italic; color: #334155; }
  .content-body table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px; }
  .content-body th { background: #f1f5f9; padding: 10px 14px; text-align: left; font-weight: 600; color: #334155; border: 1px solid #e2e8f0; }
  .content-body td { padding: 10px 14px; border: 1px solid #e2e8f0; color: #475569; }
  .content-body code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 13px; color: #0f766e; }
  .content-body pre { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px 20px; margin: 20px 0; overflow-x: auto; font-size: 13px; line-height: 1.5; }
  .content-body pre code { background: none; padding: 0; }

  /* Review checklist */
  .checklist-wrap { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; break-inside: avoid; }
  .checklist-item { display: flex; align-items: flex-start; gap: 10px; padding: 10px 16px; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #334155; line-height: 1.5; }
  .checklist-item:last-child { border-bottom: none; }
  .checklist-check { width: 15px; height: 15px; border-radius: 3px; flex-shrink: 0; margin-top: 2px; display: flex; align-items: center; justify-content: center; font-size: 10px; }
  .checklist-check.done { background: #0d9488; border: 2px solid #0d9488; color: #fff; }
  .checklist-check.pending { border: 2px solid #64748b; }

  /* Footer */
  .footer { margin-top: 48px; padding-top: 20px; border-top: 2px solid #0d9488; text-align: center; font-size: 12px; color: #475569; break-inside: avoid; }
  .footer a { color: #0d9488; text-decoration: none; font-weight: 600; }
  .footer .disclaimer { font-size: 11px; color: #64748b; margin-top: 8px; max-width: 480px; margin-left: auto; margin-right: auto; line-height: 1.5; }
</style>
</head>
<body>
<div class="print-bar no-print">
  <div style="display:flex;align-items:center;gap:12px">
    <span class="info">${esc(STUDIO_NAME)} &mdash; Content Post</span>
    <span class="tip">Tip: Use &ldquo;Save as PDF&rdquo; in the print dialog for best results</span>
  </div>
  <button id="print-btn">Save as PDF</button>
</div>
<div class="page">
  <!-- Header -->
  <div class="header">
    <div class="header-left">
      <div class="kw">${esc(post.targetKeyword)}</div>
      <h1>${esc(post.title)}</h1>
      <div class="subtitle">
        <span class="status-badge" style="background:${statusColor}15;color:${statusColor};border:1px solid ${statusColor}40">${statusLabel}</span>
        <span>&mdash; ${esc(date)}</span>
        ${date !== updatedDate ? `<span style="color:#94a3b8">· Updated ${esc(updatedDate)}</span>` : ''}
      </div>
    </div>
    <div class="logo">${LOGO_SVG}</div>
  </div>

  <!-- Key Metrics -->
  <div class="meta-strip">
    <div class="meta-card"><div class="mc-label">Word Count</div><div class="mc-value" style="color:#2563eb">${post.totalWordCount.toLocaleString()}</div></div>
    <div class="meta-card"><div class="mc-label">Target</div><div class="mc-value" style="color:#64748b">${post.targetWordCount.toLocaleString()}</div></div>
    <div class="meta-card"><div class="mc-label">Sections</div><div class="mc-value" style="color:#0d9488">${post.sections.length}</div></div>
    <div class="meta-card"><div class="mc-label">Status</div><div class="mc-value" style="color:${statusColor};font-size:14px">${statusLabel}</div></div>
  </div>

  <!-- SEO Preview -->
  <div class="seo-preview">
    <div class="label">Search Engine Preview</div>
    <div class="seo-title">${esc(titleTag)}</div>
    <div class="seo-url">${post.publishedSlug ? esc(post.publishedSlug) : 'example.com/...'}</div>
    <div class="seo-desc">${esc(metaDesc)}</div>
  </div>

  <!-- Table of Contents -->
  ${toc.length > 2 ? `<div class="toc">
    <div class="toc-title">Table of Contents</div>
    <div class="toc-grid">
      ${toc.map(t => `<div class="toc-item"><span class="toc-dot"></span>${esc(t)}</div>`).join('')}
    </div>
  </div>` : ''}

  <!-- Content -->
  <div class="content-body">
    ${post.introduction ? `<div class="content-section">${post.introduction}</div>` : ''}
    ${post.sections.map(s => `<div class="content-section">${s.content}</div>`).join('\n    ')}
    ${post.conclusion ? `<div class="content-section">${post.conclusion}</div>` : ''}
  </div>

  <!-- Review Checklist -->
  ${post.reviewChecklist ? `<div class="section" style="margin-top:40px">
    <div class="section-title">Review Checklist</div>
    <div class="checklist-wrap">
      <div class="checklist-item"><div class="checklist-check ${post.reviewChecklist.factual_accuracy ? 'done' : 'pending'}">${post.reviewChecklist.factual_accuracy ? '&#10003;' : ''}</div><span>Factual accuracy verified</span></div>
      <div class="checklist-item"><div class="checklist-check ${post.reviewChecklist.brand_voice ? 'done' : 'pending'}">${post.reviewChecklist.brand_voice ? '&#10003;' : ''}</div><span>Brand voice match confirmed</span></div>
      <div class="checklist-item"><div class="checklist-check ${post.reviewChecklist.internal_links ? 'done' : 'pending'}">${post.reviewChecklist.internal_links ? '&#10003;' : ''}</div><span>Internal links verified and working</span></div>
      <div class="checklist-item"><div class="checklist-check ${post.reviewChecklist.no_hallucinations ? 'done' : 'pending'}">${post.reviewChecklist.no_hallucinations ? '&#10003;' : ''}</div><span>No AI hallucinations or fabricated statistics</span></div>
      <div class="checklist-item"><div class="checklist-check ${post.reviewChecklist.meta_optimized ? 'done' : 'pending'}">${post.reviewChecklist.meta_optimized ? '&#10003;' : ''}</div><span>Meta title/description optimized</span></div>
      <div class="checklist-item"><div class="checklist-check ${post.reviewChecklist.word_count_target ? 'done' : 'pending'}">${post.reviewChecklist.word_count_target ? '&#10003;' : ''}</div><span>Word count within brief target</span></div>
    </div>
  </div>` : ''}

  <!-- Footer -->
  <div class="footer">
    <div style="margin-bottom:8px;filter:brightness(0) saturate(100%) invert(25%) sepia(10%) saturate(500%) hue-rotate(180deg)">${COMPACT_LOGO_SVG}</div>
    Prepared by <a href="${esc(STUDIO_URL)}">${esc(STUDIO_NAME)}</a> &mdash; ${date}
    <div class="disclaimer">This content is proprietary and prepared exclusively for the intended recipient. It has been crafted with SEO best practices and optimized for search performance. Please review all content for accuracy before publishing.</div>
  </div>
</div>
<script>document.getElementById('print-btn').addEventListener('click',function(){window.print()});</script>
</body>
</html>`;
}
