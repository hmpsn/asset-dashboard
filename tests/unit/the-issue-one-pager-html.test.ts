/**
 * The Issue (Client) P1b — one-pager print HTML renderer (Lane A, A3 renderer).
 *
 * renderOnePagerHTML mirrors server/brief-export-html.ts: a standalone print-optimized HTML document
 * (@page + @media print + a .no-print "Save as PDF" bar) the client opens in a new tab and prints
 * via the browser. There is NO PDF library (DR-4). This is a standalone print document (not an
 * src/components/ component) so the print stylesheet uses literal hex — still teal action, no purple.
 */
import { describe, it, expect } from 'vitest';
import { renderOnePagerHTML } from '../../server/the-issue-one-pager-html.js';
import { STUDIO_NAME } from '../../server/constants.js';
import type { OnePagerExportPayload, NamedLeadView } from '../../shared/types/the-issue.js';

function basePayload(over: Partial<OnePagerExportPayload> = {}): OnePagerExportPayload {
  return {
    exportProfile: 'board_one_pager',
    workspaceName: 'Acme Dental',
    outcomeNoun: 'qualified leads',
    verdictSentence: '14 qualified leads ≈ $11,200 in value vs. a $1,500 retainer',
    estimatedValue: 11200,
    monthlyRetainer: 1500,
    adSpendEquivalent: 420,
    valueVsRetainerRatio: 7.4667,
    outcomeCount: 14,
    outcomeUnitLabel: 'qualified lead',
    outcomeCountSinceStart: 9,
    baselineCapturedAt: '2026-01-01T00:00:00.000Z',
    outcomeTypeBreakdown: [],
    topMoves: [{ title: 'Recover decaying landing page', estimatedGain: '+15% clicks' }],
    methodologyLine: 'Counts are estimated from GA4 key events; named-lead capture sharpens this.',
    provenance: 'estimate_ga4',
    generatedAt: '2026-06-20T00:00:00.000Z',
    ...over,
  };
}

describe('renderOnePagerHTML', () => {
  it('renders the dollar verdict + retainer ratio + ad-spend equivalent', () => {
    const html = renderOnePagerHTML(basePayload());
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('@media print');
    expect(html).toContain('14 qualified leads');
    expect(html).toContain('$11,200');
    expect(html).toContain('1,500'); // retainer in the verdict
    expect(html).toMatch(/420/); // ad-spend equivalent
  });

  it('renders the outcome-count-with-N band + the "since we started" baseline label', () => {
    const html = renderOnePagerHTML(basePayload());
    expect(html).toContain('14');
    // baseline delta "since we started" frame
    expect(html).toMatch(/since (we )?started|9/i);
  });

  it('renders the methodology line verbatim', () => {
    const html = renderOnePagerHTML(basePayload());
    expect(html).toContain('Counts are estimated from GA4 key events; named-lead capture sharpens this.');
  });

  it('renders a leads table when leads are present, none when absent', () => {
    const leads: NamedLeadView[] = [
      { id: 'l1', formName: 'Contact', leadName: 'Jane Doe', leadEmail: 'jane@acme.test', outcomeType: 'form_fill', submittedAt: '2026-06-19T00:00:00.000Z' },
    ];
    const withLeads = renderOnePagerHTML(basePayload({ leads }));
    expect(withLeads).toContain('Jane Doe');
    expect(withLeads).toContain('jane@acme.test');

    const withoutLeads = renderOnePagerHTML(basePayload());
    expect(withoutLeads).not.toContain('Jane Doe');
    expect(withoutLeads).not.toContain('jane@acme.test');
  });

  it('escapes a <script>-bearing lead value (XSS guard on a forwardable doc)', () => {
    const leads: NamedLeadView[] = [
      { id: 'l1', formName: 'Contact', leadName: '<script>alert(1)</script>', leadEmail: null, outcomeType: 'form_fill', submittedAt: '2026-06-19T00:00:00.000Z' },
    ];
    const html = renderOnePagerHTML(basePayload({ leads }));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('emits data-export-profile and renders the compact sms_recap vs full board layout', () => {
    const sms = renderOnePagerHTML(basePayload({ exportProfile: 'sms_recap' }));
    expect(sms).toContain('data-export-profile="sms_recap"');
    const board = renderOnePagerHTML(basePayload({ exportProfile: 'board_one_pager' }));
    expect(board).toContain('data-export-profile="board_one_pager"');
  });

  it('uses STUDIO_NAME, never a hard-coded studio name', () => {
    const html = renderOnePagerHTML(basePayload());
    expect(html).toContain(STUDIO_NAME);
  });

  it('contains no purple/violet/indigo in the print stylesheet', () => {
    const html = renderOnePagerHTML(basePayload());
    expect(html).not.toMatch(/purple|violet|indigo/i);
  });
});
