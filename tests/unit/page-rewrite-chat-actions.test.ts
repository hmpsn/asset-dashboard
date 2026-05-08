import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyRewriteToSection } from '../../src/components/page-rewrite-chat/pageRewriteChatActions';

describe('pageRewriteChatActions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('replaces section body content when the target heading exists', () => {
    const dom = new JSDOM(
      '<div id="doc">' +
        '<h2 data-section="intro">Intro</h2>' +
        '<p>Old one</p>' +
        '<p>Old two</p>' +
        '<h2 data-section="next">Next</h2>' +
      '</div>',
    );
    const docBody = dom.window.document.getElementById('doc') as HTMLDivElement;

    const result = applyRewriteToSection(docBody, 'Updated intro copy', 'intro');

    expect(result.foundSection).toBe(true);
    expect(docBody.querySelectorAll('p')).toHaveLength(1);
    expect(docBody.querySelector('h2[data-section="intro"]')?.nextElementSibling?.textContent).toBe('Updated intro copy');

    vi.runAllTimers();
    vi.useRealTimers();
  });

  it('appends content and reports a miss when the section heading is missing', () => {
    const dom = new JSDOM('<div id="doc"><h2 data-section="intro">Intro</h2><p>Intro body</p></div>');
    const docBody = dom.window.document.getElementById('doc') as HTMLDivElement;

    const result = applyRewriteToSection(docBody, 'Fallback copy', 'unknown section');

    expect(result.foundSection).toBe(false);
    expect(docBody.lastElementChild?.textContent).toBe('Fallback copy');

    vi.runAllTimers();
    vi.useRealTimers();
  });
});
