import type { GeneratedPost } from '../shared/types/content.ts';
import { STUDIO_NAME, STUDIO_URL } from './constants.js';

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="51" viewBox="0 0 1000 320">
  <g>
    <path d="M47.235,5.654V89.544c13.786-17.858,30.704-23.185,48.25-23.185,43.865,0,63.29,29.765,63.29,75.196v79.502c0,1.082-.877,1.959-1.959,1.959h-34.306c-1.082,0-1.959-.877-1.959-1.959v-79.189c0-28.2-14.726-40.104-35.091-40.104-22.56,0-38.224,19.111-38.224,42.297v76.997c0,1.082-.877,1.959-1.959,1.959H10.97c-1.082,0-1.959-.877-1.959-1.959V5.654c0-1.082,.877-1.959,1.959-1.959H45.276c1.082,0,1.959,.877,1.959,1.959Z" fill="#2ed9c3"/>
    <path d="M303.05,223.016c-1.082,0-1.959-.877-1.959-1.959v-80.755c0-20.366-10.653-38.852-31.645-38.852-20.679,0-32.898,18.486-32.898,38.852v80.755c0,1.082-.877,1.959-1.959,1.959h-34.306c-1.082,0-1.959-.877-1.959-1.959V70.198c0-1.082,.877-1.959,1.959-1.959h31.757c.97,0,1.794,.709,1.938,1.669l2.571,17.129c8.146-15.665,26.004-21.305,40.73-21.305,18.486,0,36.971,7.52,45.745,28.825,13.786-21.932,31.645-28.198,51.697-28.198,43.865,0,65.483,26.945,65.483,73.316v81.382c0,1.082-.877,1.959-1.959,1.959h-34.306c-1.082,0-1.959-.877-1.959-1.959v-81.382c0-20.366-8.46-37.599-29.139-37.599s-33.525,17.86-33.525,38.226v80.755c0,1.082-.877,1.959-1.959,1.959h-34.306Z" fill="#2ed9c3"/>
    <path d="M480.221,310.401V70.51c0-1.082,.877-1.959,1.959-1.959h32.015c.994,0,1.83,.744,1.946,1.73l2.304,19.577c11.906-17.233,32.584-24.754,50.13-24.754,47.623,0,79.268,35.405,79.268,80.836,0,45.117-28.512,80.836-78.015,80.836-16.292,0-40.418-5.013-51.383-21.933v105.558c0,1.082-.877,1.959-1.959,1.959h-34.306c-1.082,0-1.959-.877-1.959-1.959Zm129.398-164.461c0-24.124-16.292-43.865-43.865-43.865s-43.863,19.74-43.863,43.865,17.858,43.865,43.863,43.865,43.865-19.739,43.865-43.865Z" fill="#2ed9c3"/>
    <path d="M781.403,108.059c-.718,.845-1.968,.908-2.802,.177-10.606-9.285-22.666-12.427-36.728-12.427-18.172,0-28.198,5.64-28.198,15.353,0,10.026,9.087,15.666,28.825,16.919,29.139,1.88,66.109,8.46,66.109,49.503,0,27.259-22.244,50.758-66.423,50.758-24.026,0-48.053-3.938-70.293-26.4-.663-.67-.755-1.735-.22-2.51l16.543-23.985c.694-1.007,2.113-1.119,2.994-.27,14.636,14.119,35.008,19.652,51.604,19.954,14.412,.312,27.885-5.64,27.885-16.919,0-10.653-8.773-16.606-30.706-17.858-29.137-2.194-63.915-12.847-63.915-47.938,0-35.717,36.971-48.25,65.17-48.25,23.453,0,41.281,4.442,58.666,19.084,.827,.697,.923,1.95,.223,2.774l-18.732,22.037Z" fill="#2ed9c3"/>
    <path d="M958.735,223.016c-1.082,0-1.959-.877-1.959-1.959v-78.877c0-23.356-12.69-41.14-36.841-41.355-21.958-.196-39.922,18.489-39.922,40.448v79.784c0,1.082-.877,1.959-1.959,1.959h-33.992c-1.082,0-1.959-.877-1.959-1.959V70.198c0-1.082,.877-1.959,1.959-1.959h30.452c.992,0,1.828,.742,1.946,1.727l2.301,19.264c15.665-15.353,31.331-23.185,50.756-23.185,36.346,0,65.483,27.259,65.483,75.823v79.189c0,1.082-.877,1.959-1.959,1.959h-34.306Z" fill="#2ed9c3"/>
  </g>
  <g>
    <path d="M46.137,267.39c-.706,.619-1.753,.656-2.484,.067-3.444-2.774-8.564-4.008-12.792-4.008-5.949,0-10.777,2.501-10.777,6.64,0,5.518,5.259,6.553,13.019,7.242,11.9,1.035,23.194,5.604,23.194,19.572,0,13.451-12.416,19.314-25.436,19.4-9.88,.082-20.147-3.547-25.527-11.109-.53-.745-.408-1.775,.225-2.435l5.464-5.699c.76-.792,2.03-.812,2.791-.021,4.697,4.877,11.559,7.022,17.133,7.022,7.157,0,12.072-2.845,12.072-7.158,.086-5.086-3.967-7.414-12.158-8.105-12.761-1.205-24.143-4.397-23.97-18.623,.087-11.986,11.468-18.365,23.884-18.365,8.61,0,15.229,1.768,21.085,7.758,.794,.813,.767,2.125-.087,2.875l-5.636,4.947Z" fill="#2ed9c3"/>
    <path d="M100.176,265.95h-16.407c-1.082,0-1.959-.877-1.959-1.959v-8.067c0-1.082,.877-1.959,1.959-1.959h46.178c1.082,0,1.959,.877,1.959,1.959v8.067c0,1.082-.877,1.959-1.959,1.959h-16.407v46.412c0,1.082-.877,1.959-1.959,1.959h-9.446c-1.082,0-1.959-.877-1.959-1.959v-46.412Z" fill="#2ed9c3"/>
    <path d="M213.833,254.051c1.082,0,1.959,.877,1.959,1.959v31.755c0,17.934-10.001,27.505-25.867,28.022-15.779,.517-29.143-8.536-29.143-28.022v-31.755c0-1.082,.877-1.959,1.959-1.959h9.446c1.082,0,1.959,.877,1.959,1.959v31.755c0,10.778,6.036,16.383,15.865,15.95,9.139-.603,12.416-6.898,12.416-15.95v-31.755c0-1.082,.877-1.959,1.959-1.959h9.446Z" fill="#2ed9c3"/>
    <path d="M274.673,253.965c20.78,0,30.005,13.968,30.005,29.748s-8.881,30.609-30.005,30.609h-22.787c-1.082,0-1.959-.877-1.959-1.959v-56.438c0-1.082,.877-1.959,1.959-1.959h22.787Zm-11.468,47.941h11.468c13.106,0,16.727-9.657,16.727-18.365s-4.139-17.418-16.727-17.418h-11.468v35.783Z" fill="#2ed9c3"/>
    <path d="M336.398,312.362v-56.438c0-1.082,.877-1.959,1.959-1.959h9.446c1.082,0,1.959,.877,1.959,1.959v56.438c0,1.082-.877,1.959-1.959,1.959h-9.446c-1.082,0-1.959-.877-1.959-1.959Z" fill="#2ed9c3"/>
    <path d="M413.907,315.787c-19.314,0-32.592-11.986-32.592-31.644s13.278-31.644,32.592-31.644,32.592,11.986,32.592,31.644-13.278,31.644-32.592,31.644Zm0-51.216c-11.468,0-19.4,8.622-19.4,19.572,0,11.295,7.932,19.486,19.4,19.486,11.726,0,19.4-8.277,19.4-19.486,0-11.037-7.674-19.572-19.4-19.572Z" fill="#2ed9c3"/>
  </g>
</svg>`;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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
  const statusLabel = post.status === 'approved' ? 'Approved' : post.status === 'review' ? 'In Review' : 'Draft';
  const statusColor = post.status === 'approved' ? '#16a34a' : post.status === 'review' ? '#b45309' : '#64748b';

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
<title>${esc(titleTag)} — ${STUDIO_NAME}</title>
<style>
  @page {
    size: letter;
    margin: 0.75in 0.75in 1in 0.75in;
    @bottom-center {
      content: "${STUDIO_NAME}  ·  Content Post  ·  ${esc(post.targetKeyword).replace(/'/g, "\\'")}";
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
    <span class="info">${STUDIO_NAME} &mdash; Content Post</span>
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
    <div style="margin-bottom:8px;filter:brightness(0) saturate(100%) invert(25%) sepia(10%) saturate(500%) hue-rotate(180deg)">${LOGO_SVG.replace('width="160" height="51"', 'width="100" height="32"')}</div>
    Prepared by <a href="${STUDIO_URL}">${STUDIO_NAME}</a> &mdash; ${date}
    <div class="disclaimer">This content is proprietary and prepared exclusively for the intended recipient. It has been crafted with SEO best practices and optimized for search performance. Please review all content for accuracy before publishing.</div>
  </div>
</div>
<script>document.getElementById('print-btn').addEventListener('click',function(){window.print()});</script>
</body>
</html>`;
}
