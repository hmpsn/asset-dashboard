/**
 * The Issue (Client) P1b — one-pager print HTML renderer (Lane A, A3 renderer).
 *
 * Mirrors server/brief-export-html.ts exactly: a standalone print-optimized HTML document
 * (@page + @media print + a .no-print "Save as PDF" bar) the client opens in a new tab and prints
 * via the browser's native print-to-PDF. There is NO PDF library and NO server PDF renderer (DR-4).
 *
 * This is a standalone print document (NOT an src/components/ component), so the print stylesheet
 * uses literal hex — the Four-Laws token rule does not apply. Still: teal action button, NO
 * purple/violet/indigo.
 *
 * D7: leads (NamedLeadView[]) are embedded ONLY when payload.leads is present — the route attaches
 * them on the authed surface only. esc() neutralizes every interpolated value (XSS guard on a
 * forwardable document). The root carries data-export-profile="<profile>" for segment assertions.
 */
import { STUDIO_NAME, STUDIO_URL } from './constants.js';
import type { OnePagerExportPayload, NamedLeadView } from '../shared/types/the-issue.js';

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="51" viewBox="0 0 1000 320">
  <g>
    <path d="M47.235,5.654V89.544c13.786-17.858,30.704-23.185,48.25-23.185,43.865,0,63.29,29.765,63.29,75.196v79.502c0,1.082-.877,1.959-1.959,1.959h-34.306c-1.082,0-1.959-.877-1.959-1.959v-79.189c0-28.2-14.726-40.104-35.091-40.104-22.56,0-38.224,19.111-38.224,42.297v76.997c0,1.082-.877,1.959-1.959,1.959H10.97c-1.082,0-1.959-.877-1.959-1.959V5.654c0-1.082,.877-1.959,1.959-1.959H45.276c1.082,0,1.959,.877,1.959,1.959Z" fill="#2ed9c3"/>
    <path d="M303.05,223.016c-1.082,0-1.959-.877-1.959-1.959v-80.755c0-20.366-10.653-38.852-31.645-38.852-20.679,0-32.898,18.486-32.898,38.852v80.755c0,1.082-.877,1.959-1.959,1.959h-34.306c-1.082,0-1.959-.877-1.959-1.959V70.198c0-1.082,.877-1.959,1.959-1.959h31.757c.97,0,1.794,.709,1.938,1.669l2.571,17.129c8.146-15.665,26.004-21.305,40.73-21.305,18.486,0,36.971,7.52,45.745,28.825,13.786-21.932,31.645-28.198,51.697-28.198,43.865,0,65.483,26.945,65.483,73.316v81.382c0,1.082-.877,1.959-1.959,1.959h-34.306c-1.082,0-1.959-.877-1.959-1.959v-81.382c0-20.366-8.46-37.599-29.139-37.599s-33.525,17.86-33.525,38.226v80.755c0,1.082-.877,1.959-1.959,1.959h-34.306Z" fill="#2ed9c3"/>
    <path d="M480.221,310.401V70.51c0-1.082,.877-1.959,1.959-1.959h32.015c.994,0,1.83,.744,1.946,1.73l2.304,19.577c11.906-17.233,32.584-24.754,50.13-24.754,47.623,0,79.268,35.405,79.268,80.836,0,45.117-28.512,80.836-78.015,80.836-16.292,0-40.418-5.013-51.383-21.933v105.558c0,1.082-.877,1.959-1.959,1.959h-34.306c-1.082,0-1.959-.877-1.959-1.959Zm129.398-164.461c0-24.124-16.292-43.865-43.865-43.865s-43.863,19.74-43.863,43.865,17.858,43.865,43.863,43.865,43.865-19.739,43.865-43.865Z" fill="#2ed9c3"/>
    <path d="M781.403,108.059c-.718,.845-1.968,.908-2.802,.177-10.606-9.285-22.666-12.427-36.728-12.427-18.172,0-28.198,5.64-28.198,15.353,0,10.026,9.087,15.666,28.825,16.919,29.139,1.88,66.109,8.46,66.109,49.503,0,27.259-22.244,50.758-66.423,50.758-24.026,0-48.053-3.938-70.293-26.4-.663-.67-.755-1.735-.22-2.51l16.543-23.985c.694-1.007,2.113-1.119,2.994-.27,14.636,14.119,35.008,19.652,51.604,19.954,14.412,.312,27.885-5.64,27.885-16.919,0-10.653-8.773-16.606-30.706-17.858-29.137-2.194-63.915-12.847-63.915-47.938,0-35.717,36.971-48.25,65.17-48.25,23.453,0,41.281,4.442,58.666,19.084,.827,.697,.923,1.95,.223,2.774l-18.732,22.037Z" fill="#2ed9c3"/>
    <path d="M958.735,223.016c-1.082,0-1.959-.877-1.959-1.959v-78.877c0-23.356-12.69-41.14-36.841-41.355-21.958-.196-39.922,18.489-39.922,40.448v79.784c0,1.082-.877,1.959-1.959,1.959h-33.992c-1.082,0-1.959-.877-1.959-1.959V70.198c0-1.082,.877-1.959,1.959-1.959h30.452c.992,0,1.828,.742,1.946,1.727l2.301,19.264c15.665-15.353,31.331-23.185,50.756-23.185,36.346,0,65.483,27.259,65.483,75.823v79.189c0,1.082-.877,1.959-1.959,1.959h-34.306Z" fill="#2ed9c3"/>
  </g>
</svg>`;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

const PROFILE_FRAME: Record<OnePagerExportPayload['exportProfile'], string> = {
  sms_recap: 'Quick recap',
  board_one_pager: 'Board summary',
  partner_summary: 'Partner summary',
  owner_portfolio: 'Owner portfolio',
};

function renderLeadsTable(leads: NamedLeadView[]): string {
  if (!leads.length) return '';
  const rows = leads
    .map(
      (l) => `<tr>
        <td>${esc(l.leadName ?? '—')}</td>
        <td>${esc(l.leadEmail ?? '—')}</td>
        <td>${esc(l.formName)}</td>
        <td>${esc(fmtDate(l.submittedAt))}</td>
      </tr>`,
    )
    .join('');
  return `<div class="section leads-section">
    <div class="section-title">Your captured leads</div>
    <table class="leads-table">
      <thead><tr><th>Name</th><th>Email</th><th>Form</th><th>Date</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function renderTopMoves(moves: OnePagerExportPayload['topMoves']): string {
  if (!moves.length) return '';
  const items = moves
    .map(
      (m) => `<div class="move"><span class="move-title">${esc(m.title)}</span><span class="move-gain">${esc(m.estimatedGain)}</span></div>`,
    )
    .join('');
  return `<div class="section">
    <div class="section-title">Top moves underway</div>
    ${items}
  </div>`;
}

export function renderOnePagerHTML(payload: OnePagerExportPayload): string {
  const p = payload;
  const frame = PROFILE_FRAME[p.exportProfile] ?? PROFILE_FRAME.board_one_pager;
  const ratioLine =
    p.valueVsRetainerRatio != null
      ? `${(Math.round(p.valueVsRetainerRatio * 10) / 10).toLocaleString('en-US')}× your retainer`
      : '';
  const sinceLabel = p.baselineCapturedAt ? ` since ${esc(fmtDate(p.baselineCapturedAt))}` : ' since we started';
  const sinceBand =
    p.outcomeCountSinceStart != null
      ? `<div class="since">+${p.outcomeCountSinceStart.toLocaleString('en-US')} ${esc(p.outcomeNoun)}${sinceLabel}</div>`
      : '';
  const compact = p.exportProfile === 'sms_recap';

  const sharedStyles = `
  @page { size: letter; margin: 0.75in; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #ffffff; color: #1e293b; line-height: 1.6; -webkit-print-color-adjust: exact; print-color-adjust: exact; padding-top: 52px; }
  @media print { .no-print { display: none !important; } body { padding-top: 0; } .page { padding: 0; max-width: none; } }
  .print-bar { position: fixed; top: 0; left: 0; right: 0; background: #0f172a; border-bottom: 1px solid #1e293b; padding: 10px 24px; display: flex; align-items: center; justify-content: space-between; z-index: 100; }
  .print-bar button { background: #0d9488; color: #fff; border: none; padding: 8px 24px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .print-bar button:hover { background: #0f766e; }
  .print-bar .info { font-size: 12px; color: #94a3b8; }
  .print-bar .tip { font-size: 10px; color: #64748b; margin-left: 16px; }
  .page { max-width: 760px; margin: 0 auto; padding: 40px; }
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; padding-bottom: 18px; border-bottom: 2px solid #0d9488; }
  .header h1 { font-size: 22px; font-weight: 700; color: #0f172a; }
  .header .frame { font-size: 12px; color: #0d9488; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
  .logo { opacity: 0.9; filter: brightness(0) saturate(100%) invert(25%) sepia(10%) saturate(500%) hue-rotate(180deg); }
  .verdict { background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 12px; padding: 24px; margin-bottom: 24px; break-inside: avoid; }
  .verdict .sentence { font-size: 20px; font-weight: 700; color: #0f172a; line-height: 1.4; }
  .verdict .ratio { font-size: 14px; color: #0d9488; font-weight: 600; margin-top: 8px; }
  .stat-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px; }
  .stat { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; }
  .stat .label { font-size: 11px; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .stat .value { font-size: 20px; font-weight: 700; color: #2563eb; }
  .count-band { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 16px 20px; margin-bottom: 24px; break-inside: avoid; }
  .count-band .count { font-size: 28px; font-weight: 800; color: #0f172a; }
  .count-band .since { font-size: 13px; color: #15803d; font-weight: 600; margin-top: 4px; }
  .section { margin-bottom: 22px; break-inside: avoid; }
  .section-title { font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: #334155; font-weight: 600; margin-bottom: 12px; }
  .move { display: flex; justify-content: space-between; align-items: center; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 16px; margin-bottom: 8px; }
  .move-title { font-size: 14px; color: #1e293b; font-weight: 600; }
  .move-gain { font-size: 13px; color: #2563eb; font-weight: 600; }
  .leads-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .leads-table th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #475569; padding: 8px 12px; border-bottom: 2px solid #e2e8f0; }
  .leads-table td { padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #334155; }
  .methodology { margin-top: 28px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; line-height: 1.5; }
  .footer { margin-top: 24px; text-align: center; font-size: 12px; color: #475569; }
  .footer a { color: #0d9488; text-decoration: none; font-weight: 600; }
  /* sms_recap compact variant */
  .compact .page { max-width: 480px; padding: 28px; }
  .compact .verdict .sentence { font-size: 17px; }
  .compact .stat-row { display: none; }
  `;

  const statRow = compact
    ? ''
    : `<div class="stat-row">
        <div class="stat"><div class="label">Estimated value</div><div class="value">$${p.estimatedValue.toLocaleString('en-US')}</div></div>
        <div class="stat"><div class="label">Ad-spend equivalent</div><div class="value">$${p.adSpendEquivalent.toLocaleString('en-US')}</div></div>
        <div class="stat"><div class="label">${p.monthlyRetainer != null ? 'Monthly retainer' : 'Outcomes'}</div><div class="value">${p.monthlyRetainer != null ? '$' + p.monthlyRetainer.toLocaleString('en-US') : p.outcomeCount.toLocaleString('en-US')}</div></div>
      </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(p.workspaceName)} — ${esc(frame)} — ${esc(STUDIO_NAME)}</title>
<style>${sharedStyles}</style>
</head>
<body data-export-profile="${esc(p.exportProfile)}"${compact ? ' class="compact"' : ''}>
<div class="print-bar no-print">
  <div style="display:flex;align-items:center;gap:12px">
    <span class="info">${esc(STUDIO_NAME)} &mdash; ${esc(frame)}</span>
    <span class="tip">Tip: Use &ldquo;Save as PDF&rdquo; in the print dialog to forward this</span>
  </div>
  <button id="print-btn">Print / Save as PDF</button>
</div>
<div class="page">
  <div class="header">
    <div>
      <div class="frame">${esc(frame)}</div>
      <h1>${esc(p.workspaceName)}</h1>
    </div>
    <div class="logo">${LOGO_SVG}</div>
  </div>

  <div class="verdict">
    <div class="sentence">${esc(p.verdictSentence)}</div>
    ${ratioLine ? `<div class="ratio">${esc(ratioLine)}</div>` : ''}
  </div>

  ${statRow}

  <div class="count-band">
    <div class="count">${p.outcomeCount.toLocaleString('en-US')} ${esc(p.outcomeNoun)}</div>
    ${sinceBand}
  </div>

  ${renderTopMoves(p.topMoves)}

  ${p.leads ? renderLeadsTable(p.leads) : ''}

  <div class="methodology">${esc(p.methodologyLine)}</div>

  <div class="footer">
    Prepared by <a href="${esc(STUDIO_URL)}">${esc(STUDIO_NAME)}</a> &mdash; ${esc(fmtDate(p.generatedAt))}
  </div>
</div>
<script>document.getElementById('print-btn').addEventListener('click',function(){window.print()});</script>
</body>
</html>`;
}
