import type { ContentBrief } from './content-brief.js';

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

function diffColor(score: number): string {
  if (score <= 30) return '#16a34a';
  if (score <= 60) return '#b45309';
  return '#dc2626';
}

export function renderBriefHTML(brief: ContentBrief): string {
  const b = brief;
  const date = new Date(b.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // Build table of contents entries
  const toc: string[] = [];
  toc.push('Strategic Overview');
  toc.push('Content Direction');
  toc.push('Key Metrics');
  if (b.audience) toc.push('Audience & Tone');
  if (b.secondaryKeywords.length > 0) toc.push('Keywords to Include');
  if (b.topicalEntities?.length) toc.push('Topics to Reference');
  if (b.peopleAlsoAsk?.length) toc.push('Questions to Address');
  if (b.serpAnalysis) toc.push('SERP Analysis');
  if (b.outline.length > 0) toc.push('Content Outline');
  if (b.ctaRecommendations?.length) toc.push('Calls to Action');
  if (b.internalLinkSuggestions.length > 0) toc.push('Internal Links');
  if (b.eeatGuidance) toc.push('E-E-A-T Signals');
  if (b.contentChecklist?.length) toc.push('Content Checklist');
  if (b.schemaRecommendations?.length) toc.push('Schema Markup');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Content Brief: ${esc(b.targetKeyword)} — HMPSN Studio</title>
<style>
  @page {
    size: letter;
    margin: 0.75in 0.75in 1in 0.75in;
    @bottom-center {
      content: "HMPSN Studio  ·  Content Brief  ·  ${esc(b.targetKeyword).replace(/'/g, "\\'")}";
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
  .field { break-inside: avoid; }
  .outline-card { break-inside: avoid; }
  .question { break-inside: avoid; }
  .eeat-card { break-inside: avoid; }
  .checklist-wrap { break-inside: avoid; }
  .schema-card { break-inside: avoid; }
  .cta-item { break-inside: avoid; }
  .metric-card { break-inside: avoid; }
  .page-break { break-before: page; }

  /* Header */
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 32px; padding-bottom: 20px; border-bottom: 2px solid #0d9488; }
  .header-left h1 { font-size: 26px; font-weight: 700; color: #0f172a; margin-bottom: 2px; }
  .header-left .kw { font-size: 14px; color: #0d9488; font-weight: 600; margin-bottom: 6px; }
  .header-left .subtitle { font-size: 13px; color: #475569; }
  .logo { opacity: 0.9; filter: brightness(0) saturate(100%) invert(25%) sepia(10%) saturate(500%) hue-rotate(180deg); }

  /* Guide box */
  .guide-box { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 16px 20px; margin-bottom: 28px; }
  .guide-box .guide-title { font-size: 12px; font-weight: 700; color: #1e40af; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
  .guide-box p { font-size: 13px; color: #334155; line-height: 1.6; }

  /* Table of contents */
  .toc { margin-bottom: 28px; padding: 20px 24px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; }
  .toc-title { font-size: 12px; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; }
  .toc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; }
  .toc-item { font-size: 12px; color: #334155; padding: 2px 0; display: flex; align-items: center; gap: 6px; }
  .toc-dot { width: 4px; height: 4px; border-radius: 50%; background: #0d9488; flex-shrink: 0; }

  /* Summary */
  .summary-box { background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 12px; padding: 20px 24px; margin-bottom: 28px; break-inside: avoid; }
  .summary-box .label { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #0d9488; font-weight: 600; margin-bottom: 8px; }
  .summary-box p { font-size: 14px; color: #334155; }

  /* Metrics */
  .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 28px; }
  .metric-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; }
  .metric-card .mc-label { font-size: 11px; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .metric-card .mc-value { font-size: 18px; font-weight: 700; }

  /* Section titles */
  .section-title { font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: #334155; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
  .section-title::after { content: ''; flex: 1; height: 1px; background: #e2e8f0; }

  /* Fields */
  .field { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 18px; margin-bottom: 10px; }
  .field .fl { font-size: 11px; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .field .fv { font-size: 14px; color: #1e293b; }
  .field .fv.highlight { color: #0d9488; font-weight: 600; }

  /* Tags / pills */
  .tags { display: flex; flex-wrap: wrap; gap: 6px; }
  .tags-label { font-size: 11px; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; margin-bottom: 6px; display: block; }
  .tag { display: inline-block; font-size: 12px; padding: 5px 14px; border-radius: 20px; background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; }
  .tag.entity { background: #f5f3ff; border-color: #c4b5fd; color: #5b21b6; }
  .tag.kw-section { background: #f0fdfa; border-color: #99f6e4; color: #0f766e; font-size: 11px; }
  .tag.link { color: #2563eb; }

  /* Outline */
  .outline-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px 18px; margin-bottom: 10px; }
  .outline-num { font-size: 11px; font-weight: 700; color: #0d9488; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .outline-card .oh { font-size: 15px; font-weight: 600; color: #0f172a; display: flex; align-items: center; justify-content: space-between; }
  .outline-card .oh .wc { font-size: 11px; background: #e2e8f0; color: #475569; padding: 3px 10px; border-radius: 6px; font-weight: 500; }
  .outline-card .on { font-size: 13px; color: #334155; margin-top: 6px; line-height: 1.5; }
  .outline-card .okw { margin-top: 8px; }

  /* Questions */
  .question { display: flex; gap: 10px; align-items: flex-start; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 16px; margin-bottom: 6px; }
  .question .qn { color: #b45309; font-weight: 700; font-size: 13px; flex-shrink: 0; }
  .question .qt { font-size: 14px; color: #1e293b; }

  /* SERP */
  .serp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 10px; }
  .gap-item { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; color: #15803d; margin-bottom: 4px; }
  .gap-item .arrow { color: #16a34a; flex-shrink: 0; }

  /* CTA */
  .cta-item { display: flex; gap: 10px; align-items: flex-start; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 16px; margin-bottom: 6px; }
  .cta-badge { font-size: 11px; padding: 4px 12px; border-radius: 6px; font-weight: 600; flex-shrink: 0; text-transform: uppercase; letter-spacing: 0.3px; }
  .cta-badge.primary { background: #f0fdfa; color: #0d9488; border: 1px solid #99f6e4; }
  .cta-badge.secondary { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }

  /* E-E-A-T */
  .eeat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .eeat-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; }
  .eeat-card .eeat-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; margin-bottom: 6px; }
  .eeat-card .eeat-value { font-size: 13px; color: #334155; line-height: 1.6; }

  /* Checklist */
  .checklist-wrap { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
  .checklist-item { display: flex; align-items: flex-start; gap: 10px; padding: 10px 16px; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #334155; line-height: 1.5; }
  .checklist-item:last-child { border-bottom: none; }
  .checklist-box { width: 15px; height: 15px; border: 2px solid #64748b; border-radius: 3px; flex-shrink: 0; margin-top: 2px; }

  /* Schema */
  .schema-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; margin-bottom: 8px; }
  .schema-badge { display: inline-block; font-size: 12px; padding: 4px 12px; border-radius: 6px; background: #ecfeff; border: 1px solid #a5f3fc; color: #0e7490; font-weight: 600; margin-bottom: 6px; }
  .schema-notes { font-size: 13px; color: #334155; line-height: 1.5; }

  /* Footer */
  .footer { margin-top: 48px; padding-top: 20px; border-top: 2px solid #0d9488; text-align: center; font-size: 12px; color: #475569; break-inside: avoid; }
  .footer a { color: #0d9488; text-decoration: none; font-weight: 600; }
  .footer .disclaimer { font-size: 11px; color: #64748b; margin-top: 8px; max-width: 480px; margin-left: auto; margin-right: auto; line-height: 1.5; }
</style>
</head>
<body>
<div class="print-bar no-print">
  <div style="display:flex;align-items:center;gap:12px">
    <span class="info">HMPSN Studio &mdash; Content Brief</span>
    <span class="tip">Tip: Use &ldquo;Save as PDF&rdquo; in the print dialog for best results</span>
  </div>
  <button onclick="window.print()">Save as PDF</button>
</div>
<div class="page">
  <!-- Header -->
  <div class="header">
    <div class="header-left">
      <div class="kw">${esc(b.targetKeyword)}</div>
      <h1>${esc(b.suggestedTitle)}</h1>
      <div class="subtitle">Content Brief${b.pageType ? ` · <span style="display:inline-block;padding:2px 10px;border-radius:6px;background:#f0fdfa;border:1px solid #99f6e4;color:#0d9488;font-weight:600;font-size:11px;text-transform:capitalize;letter-spacing:0.3px">${esc(b.pageType)} Page</span>` : ''} &mdash; Prepared ${date}</div>
    </div>
    <div class="logo">${LOGO_SVG}</div>
  </div>

  <!-- How to use this brief -->
  <div class="guide-box no-print">
    <div class="guide-title">How to Use This Brief</div>
    <p>This brief is a complete roadmap for creating SEO-optimized content. Share it directly with your copywriter or paste the outline into an AI writing tool. Follow the section-by-section guidance, incorporate the listed keywords naturally, and use the checklist at the end to verify quality before publishing.</p>
  </div>

  <!-- Table of Contents -->
  <div class="toc">
    <div class="toc-title">What&rsquo;s Inside</div>
    <div class="toc-grid">
      ${toc.map(t => `<div class="toc-item"><span class="toc-dot"></span>${esc(t)}</div>`).join('')}
    </div>
  </div>

  <!-- Executive Summary -->
  ${b.executiveSummary ? `<div class="summary-box"><div class="label">Strategic Overview</div><p>${esc(b.executiveSummary)}</p></div>` : ''}

  <!-- Content Direction -->
  <div class="section">
    <div class="section-title">Content Direction</div>
    <div class="field"><div class="fl">Suggested Title Tag</div><div class="fv highlight">${esc(b.suggestedTitle)}</div></div>
    <div class="field"><div class="fl">Meta Description</div><div class="fv">${esc(b.suggestedMetaDesc)}</div></div>
  </div>

  <!-- Key Metrics -->
  <div class="metrics">
    <div class="metric-card"><div class="mc-label">Target Word Count</div><div class="mc-value" style="color:#2563eb">${b.wordCountTarget.toLocaleString()}</div></div>
    <div class="metric-card"><div class="mc-label">Search Intent</div><div class="mc-value" style="color:#334155;font-size:14px;text-transform:capitalize">${esc(b.intent)}</div></div>
    ${b.contentFormat ? `<div class="metric-card"><div class="mc-label">Recommended Format</div><div class="mc-value" style="color:#b45309;font-size:14px;text-transform:capitalize">${esc(b.contentFormat)}</div></div>` : ''}
    ${b.difficultyScore != null ? `<div class="metric-card"><div class="mc-label">Keyword Difficulty</div><div class="mc-value" style="color:${diffColor(b.difficultyScore)}">${b.difficultyScore}/100</div></div>` : ''}
  </div>

  ${b.trafficPotential ? `<div class="field" style="margin-bottom:28px"><div class="fl">Traffic Potential</div><div class="fv">${esc(b.trafficPotential)}</div></div>` : ''}

  <!-- Audience & Tone -->
  <div class="section">
    <div class="section-title">Audience & Tone</div>
    <div class="field"><div class="fl">Target Audience</div><div class="fv">${esc(b.audience)}</div></div>
    ${b.toneAndStyle ? `<div class="field"><div class="fl">Tone & Style</div><div class="fv">${esc(b.toneAndStyle)}</div></div>` : ''}
  </div>

  <!-- Keywords to Include -->
  ${b.secondaryKeywords.length > 0 ? `<div class="section">
    <div class="section-title">Keywords to Include</div>
    <span class="tags-label">Weave these keywords naturally throughout the content</span>
    <div class="tags">${b.secondaryKeywords.map(k => `<span class="tag">${esc(k)}</span>`).join('')}</div>
  </div>` : ''}

  <!-- Topical Entities -->
  ${b.topicalEntities?.length ? `<div class="section">
    <div class="section-title">Topics to Reference</div>
    <span class="tags-label">Mention these concepts to build topical authority</span>
    <div class="tags">${b.topicalEntities.map(e => `<span class="tag entity">${esc(e)}</span>`).join('')}</div>
  </div>` : ''}

  <!-- People Also Ask -->
  ${b.peopleAlsoAsk?.length ? `<div class="section">
    <div class="section-title">Questions to Address</div>
    <span class="tags-label">Answer these directly in the content — they reflect what searchers want to know</span>
    ${b.peopleAlsoAsk.map((q, i) => `<div class="question"><span class="qn">Q${i + 1}.</span><span class="qt">${esc(q)}</span></div>`).join('')}
  </div>` : ''}

  <!-- SERP Analysis -->
  ${b.serpAnalysis ? `<div class="section">
    <div class="section-title">SERP Analysis</div>
    <div class="serp-grid">
      <div class="field"><div class="fl">Dominant Content Type</div><div class="fv">${esc(b.serpAnalysis.contentType)}</div></div>
      <div class="field"><div class="fl">Avg. Competing Word Count</div><div class="fv">${b.serpAnalysis.avgWordCount.toLocaleString()}</div></div>
    </div>
    ${b.serpAnalysis.commonElements.length ? `<div class="field"><div class="fl">Common Elements in Top Results</div><div class="tags" style="margin-top:6px">${b.serpAnalysis.commonElements.map(el => `<span class="tag">${esc(el)}</span>`).join('')}</div></div>` : ''}
    ${b.serpAnalysis.gaps.length ? `<div class="field"><div class="fl" style="color:#15803d">Your Competitive Edge — Content Gaps to Exploit</div><div style="margin-top:6px">${b.serpAnalysis.gaps.map(g => `<div class="gap-item"><span class="arrow">&rarr;</span>${esc(g)}</div>`).join('')}</div></div>` : ''}
  </div>` : ''}

  <!-- Content Outline -->
  ${b.outline.length > 0 ? `<div class="section page-break">
    <div class="section-title">Content Outline</div>
    ${b.outline.map((s, i) => `<div class="outline-card">
      <div class="outline-num">Section ${i + 1} of ${b.outline.length}</div>
      <div class="oh">H2: ${esc(s.heading)}${s.wordCount ? `<span class="wc">${s.wordCount} words</span>` : ''}</div>
      <div class="on">${esc(s.notes)}</div>
      ${s.keywords?.length ? `<div class="okw"><span class="tags-label">Section Keywords</span><div class="tags">${s.keywords.map(k => `<span class="tag kw-section">${esc(k)}</span>`).join('')}</div></div>` : ''}
    </div>`).join('')}
  </div>` : ''}

  <!-- Calls to Action -->
  ${b.ctaRecommendations?.length ? `<div class="section">
    <div class="section-title">Calls to Action</div>
    <span class="tags-label">The content should drive readers toward these actions</span>
    ${b.ctaRecommendations.map((c, i) => `<div class="cta-item"><span class="cta-badge ${i === 0 ? 'primary' : 'secondary'}">${i === 0 ? 'Primary' : 'Secondary'}</span><span class="fv">${esc(c)}</span></div>`).join('')}
  </div>` : ''}

  <!-- Competitor Insights -->
  ${b.competitorInsights ? `<div class="section"><div class="section-title">Competitor Insights</div><div class="field"><div class="fv">${esc(b.competitorInsights)}</div></div></div>` : ''}

  <!-- Internal Links -->
  ${b.internalLinkSuggestions.length > 0 ? `<div class="section">
    <div class="section-title">Internal Links to Include</div>
    <span class="tags-label">Link to these existing pages from within the content</span>
    <div class="tags">${b.internalLinkSuggestions.map(l => `<span class="tag link">/${esc(l)}</span>`).join('')}</div>
  </div>` : ''}

  <!-- E-E-A-T Signals -->
  ${b.eeatGuidance ? `<div class="section page-break">
    <div class="section-title">E-E-A-T Signals</div>
    <span class="tags-label">Incorporate these trust and quality signals to strengthen the content&rsquo;s authority</span>
    <div class="eeat-grid" style="margin-top:8px">
      ${b.eeatGuidance.experience ? `<div class="eeat-card"><div class="eeat-label" style="color:#2563eb">Experience</div><div class="eeat-value">${esc(b.eeatGuidance.experience)}</div></div>` : ''}
      ${b.eeatGuidance.expertise ? `<div class="eeat-card"><div class="eeat-label" style="color:#0d9488">Expertise</div><div class="eeat-value">${esc(b.eeatGuidance.expertise)}</div></div>` : ''}
      ${b.eeatGuidance.authority ? `<div class="eeat-card"><div class="eeat-label" style="color:#7c3aed">Authority</div><div class="eeat-value">${esc(b.eeatGuidance.authority)}</div></div>` : ''}
      ${b.eeatGuidance.trust ? `<div class="eeat-card"><div class="eeat-label" style="color:#b45309">Trust</div><div class="eeat-value">${esc(b.eeatGuidance.trust)}</div></div>` : ''}
    </div>
  </div>` : ''}

  <!-- Content Checklist -->
  ${b.contentChecklist?.length ? `<div class="section">
    <div class="section-title">Content Checklist</div>
    <span class="tags-label">Verify each item before publishing</span>
    <div class="checklist-wrap" style="margin-top:8px">
      ${b.contentChecklist.map(item => `<div class="checklist-item"><div class="checklist-box"></div><span>${esc(item)}</span></div>`).join('')}
    </div>
  </div>` : ''}

  <!-- Schema Markup -->
  ${b.schemaRecommendations?.length ? `<div class="section">
    <div class="section-title">Schema Markup Recommendations</div>
    <span class="tags-label">Add structured data to improve search appearance and click-through rate</span>
    ${b.schemaRecommendations.map(s => `<div class="schema-card"><div class="schema-badge">${esc(s.type)}</div><div class="schema-notes">${esc(s.notes)}</div></div>`).join('')}
  </div>` : ''}

  <!-- Footer -->
  <div class="footer">
    <div style="margin-bottom:8px;filter:brightness(0) saturate(100%) invert(25%) sepia(10%) saturate(500%) hue-rotate(180deg)">${LOGO_SVG.replace('width="160" height="51"', 'width="100" height="32"')}</div>
    Prepared by <a href="https://hmpsn.studio">HMPSN Studio</a> &mdash; ${date}
    <div class="disclaimer">This content brief is proprietary and prepared exclusively for the intended recipient. It contains strategic recommendations based on current search data and competitive analysis. Results may vary based on implementation quality and market conditions.</div>
  </div>
</div>
</body>
</html>`;
}

export function renderBriefHTMLForPDF(brief: ContentBrief): string {
  return renderBriefHTML(brief);
}
