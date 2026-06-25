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
import { escapeHtml, LOGO_SVG } from './export-html-shared.js';
import type { OnePagerExportPayload, NamedLeadView } from '../shared/types/the-issue.js';

function esc(s: string): string {
  return escapeHtml(s, { singleQuote: true });
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
        <div class="stat"><div class="label">Estimated value</div><div class="value">${esc(p.estimatedValueLabel)}</div></div>
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
