import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SemanticPageData } from '../../../../shared/types/page-elements.js';

vi.mock('../../../../server/anthropic-helpers.js', () => ({
  callAnthropicWithTools: vi.fn(),
}));

import { callAnthropicWithTools } from '../../../../server/anthropic-helpers.js';
import { extractSemanticData } from '../../../../server/schema/extractors/semantic.js';

const MOCK_HTML = `
<html>
<body>
<nav>Nav content to strip</nav>
<main>
  <h1>North Austin Dentist</h1>
  <p>Call us: (512) 555-1234</p>
  <p>123 Main St, Austin, TX 78701</p>
  <p>Mon-Fri: 9am-5pm</p>
  <p>4.7 stars from 10,234 reviews</p>
  <a href="https://facebook.com/swishdental">Facebook</a>
  <a href="https://www.yelp.com/biz/swish-dental-austin">Yelp</a>
</main>
<footer>Footer content to strip</footer>
</body>
</html>`;

const MOCK_SEMANTICS: SemanticPageData = {
  phone: '(512) 555-1234',
  address: { street: '123 Main St', city: 'Austin', state: 'TX', postalCode: '78701' },
  aggregateRating: { ratingValue: 4.7, reviewCount: 10234, platform: 'Google' },
  sameAs: ['https://facebook.com/swishdental', 'https://www.yelp.com/biz/swish-dental-austin'],
  hours: [{ dayOfWeek: ['Monday','Tuesday','Wednesday','Thursday','Friday'], opens: '09:00', closes: '17:00' }],
};

describe('extractSemanticData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(callAnthropicWithTools).mockResolvedValue({
      toolInput: MOCK_SEMANTICS as unknown as Record<string, unknown>,
      promptTokens: 500,
      completionTokens: 200,
    });
  });

  it('returns SemanticPageData from Haiku tool_use response', async () => {
    const result = await extractSemanticData(MOCK_HTML, {
      pageBaseUrl: 'https://swishsmiles.com/location/north-austin',
    });
    expect(result.phone).toBe('(512) 555-1234');
    expect(result.address?.city).toBe('Austin');
    expect(result.aggregateRating?.ratingValue).toBe(4.7);
    expect(result.sameAs).toContain('https://facebook.com/swishdental');
  });

  it('passes social hrefs and stripped text to Haiku', async () => {
    await extractSemanticData(MOCK_HTML, {
      pageBaseUrl: 'https://swishsmiles.com/location/north-austin',
    });
    expect(callAnthropicWithTools).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(callAnthropicWithTools).mock.calls[0][0];
    expect(callArgs.userMessage).toContain('facebook.com/swishdental');
    expect(callArgs.userMessage).toContain('yelp.com');
  });

  it('nulls out phone that does not appear verbatim in stripped text', async () => {
    vi.mocked(callAnthropicWithTools).mockResolvedValue({
      toolInput: { phone: '(999) 999-9999' } as Record<string, unknown>,
      promptTokens: 100, completionTokens: 50,
    });
    const result = await extractSemanticData('<main><p>No phone here</p></main>', {
      pageBaseUrl: 'https://example.com/page',
    });
    expect(result.phone).toBeUndefined();
  });

  it('nulls out aggregateRating.ratingValue above 5.0', async () => {
    vi.mocked(callAnthropicWithTools).mockResolvedValue({
      toolInput: { aggregateRating: { ratingValue: 6.5, reviewCount: 100 } } as Record<string, unknown>,
      promptTokens: 100, completionTokens: 50,
    });
    const result = await extractSemanticData('<main><p>text</p></main>', {
      pageBaseUrl: 'https://example.com/page',
    });
    expect(result.aggregateRating).toBeUndefined();
  });

  it('returns empty object when callAnthropicWithTools throws', async () => {
    vi.mocked(callAnthropicWithTools).mockRejectedValue(new Error('API error'));
    const result = await extractSemanticData(MOCK_HTML, {
      pageBaseUrl: 'https://swishsmiles.com/page',
    });
    expect(result).toEqual({});
  });
});
