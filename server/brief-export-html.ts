import type { ContentBrief } from './content-brief.js';
import { STUDIO_NAME, STUDIO_URL } from './constants.js';
import { COMPACT_LOGO_SVG, escapeHtml as esc, LOGO_SVG } from './export-html-shared.js';


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
<title>Content Brief: ${esc(b.targetKeyword)} — ${esc(STUDIO_NAME)}</title>
<style>
  @page {
    size: letter;
    margin: 0.75in 0.75in 1in 0.75in;
    @bottom-center {
      content: "${esc(STUDIO_NAME)}  ·  Content Brief  ·  ${esc(b.targetKeyword).replace(/'/g, "\\'")}";
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
    <span class="info">${esc(STUDIO_NAME)} &mdash; Content Brief</span>
    <span class="tip">Tip: Use &ldquo;Save as PDF&rdquo; in the print dialog for best results</span>
  </div>
  <button id="print-btn">Save as PDF</button>
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
    <div style="margin-bottom:8px;filter:brightness(0) saturate(100%) invert(25%) sepia(10%) saturate(500%) hue-rotate(180deg)">${COMPACT_LOGO_SVG}</div>
    Prepared by <a href="${esc(STUDIO_URL)}">${esc(STUDIO_NAME)}</a> &mdash; ${date}
    <div class="disclaimer">This content brief is proprietary and prepared exclusively for the intended recipient. It contains strategic recommendations based on current search data and competitive analysis. Results may vary based on implementation quality and market conditions.</div>
  </div>
</div>
<script>document.getElementById('print-btn').addEventListener('click',function(){window.print()});</script>
</body>
</html>`;
}

export function renderBriefHTMLForPDF(brief: ContentBrief): string {
  return renderBriefHTML(brief);
}
