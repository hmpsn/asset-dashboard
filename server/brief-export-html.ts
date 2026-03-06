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
  if (score <= 30) return '#4ade80';
  if (score <= 60) return '#fbbf24';
  return '#f87171';
}

export function renderBriefHTML(brief: ContentBrief): string {
  const b = brief;
  const date = new Date(b.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Content Brief: ${esc(b.targetKeyword)} — HMPSN Studio</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0c10; color: #e4e4e7; line-height: 1.6; }
  .page { max-width: 820px; margin: 0 auto; padding: 48px 40px; }
  @media print { body { background: #fff; color: #18181b; } .page { padding: 24px; } .section { border-color: #e4e4e7 !important; } .tag { background: #f4f4f5 !important; color: #3f3f46 !important; border-color: #d4d4d8 !important; } .metric-card { background: #f9fafb !important; border-color: #e4e4e7 !important; } .outline-card { background: #f9fafb !important; border-color: #e4e4e7 !important; } .summary-box { background: #f0fdfa !important; border-color: #99f6e4 !important; } .no-print { display: none !important; } }
  .print-bar { position: fixed; top: 0; left: 0; right: 0; background: #18181b; border-bottom: 1px solid #27272a; padding: 10px 24px; display: flex; align-items: center; justify-content: space-between; z-index: 100; }
  .print-bar button { background: #2ed9c3; color: #0a0c10; border: none; padding: 8px 24px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .print-bar button:hover { background: #5eead4; }
  .print-bar .info { font-size: 12px; color: #71717a; }
  body { padding-top: 52px; } @media print { body { padding-top: 0; } }

  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 40px; padding-bottom: 24px; border-bottom: 1px solid #27272a; }
  .header-left h1 { font-size: 24px; font-weight: 700; color: #2ed9c3; margin-bottom: 4px; }
  .header-left .subtitle { font-size: 13px; color: #71717a; }
  .logo { opacity: 0.9; }

  .summary-box { background: rgba(46,217,195,0.05); border: 1px solid rgba(46,217,195,0.2); border-radius: 12px; padding: 20px 24px; margin-bottom: 28px; }
  .summary-box .label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #2ed9c3; font-weight: 600; margin-bottom: 8px; }
  .summary-box p { font-size: 14px; color: #d4d4d8; }

  .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 28px; }
  .metric-card { background: #18181b; border: 1px solid #27272a; border-radius: 10px; padding: 14px 16px; }
  .metric-card .mc-label { font-size: 10px; color: #71717a; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .metric-card .mc-value { font-size: 18px; font-weight: 700; }

  .section { margin-bottom: 28px; }
  .section-title { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #71717a; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
  .section-title::after { content: ''; flex: 1; height: 1px; background: #27272a; }

  .field { background: #18181b; border: 1px solid #27272a; border-radius: 10px; padding: 14px 18px; margin-bottom: 10px; }
  .field .fl { font-size: 10px; color: #71717a; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .field .fv { font-size: 13px; color: #d4d4d8; }
  .field .fv.highlight { color: #2ed9c3; font-weight: 600; }

  .tags { display: flex; flex-wrap: wrap; gap: 6px; }
  .tag { display: inline-block; font-size: 11px; padding: 4px 12px; border-radius: 20px; background: #27272a; color: #a1a1aa; border: 1px solid #3f3f46; }
  .tag.entity { background: rgba(139,92,246,0.1); border-color: rgba(139,92,246,0.3); color: #a78bfa; }
  .tag.kw-section { background: rgba(46,217,195,0.08); border-color: rgba(46,217,195,0.2); color: #5eead4; font-size: 10px; }

  .outline-card { background: #18181b; border: 1px solid #27272a; border-radius: 10px; padding: 16px 18px; margin-bottom: 10px; }
  .outline-card .oh { font-size: 14px; font-weight: 600; color: #e4e4e7; display: flex; align-items: center; justify-content: space-between; }
  .outline-card .oh .wc { font-size: 10px; background: #27272a; color: #71717a; padding: 3px 10px; border-radius: 6px; font-weight: 500; }
  .outline-card .on { font-size: 12px; color: #a1a1aa; margin-top: 6px; line-height: 1.5; }
  .outline-card .okw { margin-top: 8px; }

  .question { display: flex; gap: 10px; align-items: flex-start; background: #18181b; border: 1px solid #27272a; border-radius: 10px; padding: 12px 16px; margin-bottom: 6px; }
  .question .qn { color: #fbbf24; font-weight: 700; font-size: 12px; flex-shrink: 0; }
  .question .qt { font-size: 13px; color: #d4d4d8; }

  .serp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 10px; }
  .gap-item { display: flex; gap: 8px; align-items: flex-start; font-size: 12px; color: #86efac; margin-bottom: 4px; }
  .gap-item .arrow { color: #4ade80; flex-shrink: 0; }

  .cta-item { display: flex; gap: 10px; align-items: flex-start; background: #18181b; border: 1px solid #27272a; border-radius: 10px; padding: 12px 16px; margin-bottom: 6px; }
  .cta-badge { font-size: 9px; padding: 3px 10px; border-radius: 6px; font-weight: 600; flex-shrink: 0; }
  .cta-badge.primary { background: rgba(46,217,195,0.15); color: #2ed9c3; }
  .cta-badge.secondary { background: #27272a; color: #71717a; }

  .footer { margin-top: 48px; padding-top: 20px; border-top: 1px solid #27272a; text-align: center; font-size: 11px; color: #52525b; }
  .footer a { color: #2ed9c3; text-decoration: none; }
</style>
</head>
<body>
<div class="print-bar no-print">
  <span class="info">HMPSN Studio &mdash; Content Brief Preview</span>
  <button onclick="window.print()">Save as PDF</button>
</div>
<div class="page">
  <div class="header">
    <div class="header-left">
      <h1>${esc(b.targetKeyword)}</h1>
      <div class="subtitle">Content Brief &mdash; ${date}</div>
    </div>
    <div class="logo">${LOGO_SVG}</div>
  </div>

  ${b.executiveSummary ? `<div class="summary-box"><div class="label">Executive Summary</div><p>${esc(b.executiveSummary)}</p></div>` : ''}

  <div class="section">
    <div class="field"><div class="fl">Suggested Title</div><div class="fv highlight">${esc(b.suggestedTitle)}</div></div>
    <div class="field"><div class="fl">Meta Description</div><div class="fv">${esc(b.suggestedMetaDesc)}</div></div>
  </div>

  <div class="metrics">
    <div class="metric-card"><div class="mc-label">Word Count</div><div class="mc-value" style="color:#60a5fa">${b.wordCountTarget.toLocaleString()}</div></div>
    <div class="metric-card"><div class="mc-label">Intent</div><div class="mc-value" style="color:#d4d4d8;font-size:14px;text-transform:capitalize">${esc(b.intent)}</div></div>
    ${b.contentFormat ? `<div class="metric-card"><div class="mc-label">Format</div><div class="mc-value" style="color:#fbbf24;font-size:14px;text-transform:capitalize">${esc(b.contentFormat)}</div></div>` : ''}
    ${b.difficultyScore != null ? `<div class="metric-card"><div class="mc-label">Difficulty</div><div class="mc-value" style="color:${diffColor(b.difficultyScore)}">${b.difficultyScore}/100</div></div>` : ''}
  </div>

  ${b.trafficPotential ? `<div class="field" style="margin-bottom:28px"><div class="fl">Traffic Potential</div><div class="fv">${esc(b.trafficPotential)}</div></div>` : ''}

  <div class="section">
    <div class="section-title">Audience & Tone</div>
    <div class="field"><div class="fl">Target Audience</div><div class="fv">${esc(b.audience)}</div></div>
    ${b.toneAndStyle ? `<div class="field"><div class="fl">Tone & Style</div><div class="fv">${esc(b.toneAndStyle)}</div></div>` : ''}
  </div>

  ${b.secondaryKeywords.length > 0 ? `<div class="section"><div class="section-title">Keywords</div><div class="tags">${b.secondaryKeywords.map(k => `<span class="tag">${esc(k)}</span>`).join('')}</div></div>` : ''}

  ${b.topicalEntities?.length ? `<div class="section"><div class="section-title">Topical Entities to Cover</div><div class="tags">${b.topicalEntities.map(e => `<span class="tag entity">${esc(e)}</span>`).join('')}</div></div>` : ''}

  ${b.peopleAlsoAsk?.length ? `<div class="section"><div class="section-title">Questions to Answer</div>${b.peopleAlsoAsk.map((q, i) => `<div class="question"><span class="qn">Q${i + 1}.</span><span class="qt">${esc(q)}</span></div>`).join('')}</div>` : ''}

  ${b.serpAnalysis ? `<div class="section">
    <div class="section-title">SERP Analysis</div>
    <div class="serp-grid">
      <div class="field"><div class="fl">Content Type</div><div class="fv">${esc(b.serpAnalysis.contentType)}</div></div>
      <div class="field"><div class="fl">Avg Word Count</div><div class="fv">${b.serpAnalysis.avgWordCount.toLocaleString()}</div></div>
    </div>
    ${b.serpAnalysis.commonElements.length ? `<div class="field"><div class="fl">Common Elements</div><div class="tags" style="margin-top:6px">${b.serpAnalysis.commonElements.map(el => `<span class="tag">${esc(el)}</span>`).join('')}</div></div>` : ''}
    ${b.serpAnalysis.gaps.length ? `<div class="field"><div class="fl" style="color:#86efac">Content Gaps &amp; Opportunities</div><div style="margin-top:6px">${b.serpAnalysis.gaps.map(g => `<div class="gap-item"><span class="arrow">&rarr;</span>${esc(g)}</div>`).join('')}</div></div>` : ''}
  </div>` : ''}

  ${b.outline.length > 0 ? `<div class="section">
    <div class="section-title">Content Outline</div>
    ${b.outline.map(s => `<div class="outline-card">
      <div class="oh">${esc(s.heading)}${s.wordCount ? `<span class="wc">${s.wordCount} words</span>` : ''}</div>
      <div class="on">${esc(s.notes)}</div>
      ${s.keywords?.length ? `<div class="okw"><div class="tags">${s.keywords.map(k => `<span class="tag kw-section">${esc(k)}</span>`).join('')}</div></div>` : ''}
    </div>`).join('')}
  </div>` : ''}

  ${b.ctaRecommendations?.length ? `<div class="section">
    <div class="section-title">Call to Action</div>
    ${b.ctaRecommendations.map((c, i) => `<div class="cta-item"><span class="cta-badge ${i === 0 ? 'primary' : 'secondary'}">${i === 0 ? 'Primary' : 'Secondary'}</span><span class="fv">${esc(c)}</span></div>`).join('')}
  </div>` : ''}

  ${b.competitorInsights ? `<div class="section"><div class="section-title">Competitor Insights</div><div class="field"><div class="fv">${esc(b.competitorInsights)}</div></div></div>` : ''}

  ${b.internalLinkSuggestions.length > 0 ? `<div class="section"><div class="section-title">Internal Link Suggestions</div><div class="tags">${b.internalLinkSuggestions.map(l => `<span class="tag" style="color:#60a5fa">/${esc(l)}</span>`).join('')}</div></div>` : ''}

  <div class="footer">
    <div style="margin-bottom:8px">${LOGO_SVG.replace('width="160" height="51"', 'width="100" height="32"')}</div>
    Prepared by <a href="https://hmpsn.studio">HMPSN Studio</a> &mdash; ${date}
  </div>
</div>
</body>
</html>`;
}

export function renderBriefHTMLForPDF(brief: ContentBrief): string {
  return renderBriefHTML(brief);
}
