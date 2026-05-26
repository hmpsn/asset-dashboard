import { describe, expect, it } from 'vitest';
import { extractFaq } from '../../server/schema/extractors/faq.js';

describe('extractFaq', () => {
  it('returns empty array when fewer than 2 valid pairs are found', async () => {
    const html = `
      <article class="faq-page">
        <details>
          <summary>What insurance do you take?</summary>
          <div>We accept most major PPO plans.</div>
        </details>
      </article>
    `;

    const result = await extractFaq(html);
    expect(result).toEqual([]);
  });

  it('dedupes duplicate questions (case-insensitive) and keeps unique pairs', async () => {
    const html = `
      <section class="faq-section">
        <details>
          <summary>What insurance do you take?</summary>
          <div>We accept most major PPO plans.</div>
        </details>
        <details>
          <summary>what insurance do you take?</summary>
          <div>Duplicate wording should be ignored.</div>
        </details>
        <details>
          <summary>Do you offer payment plans?</summary>
          <div>Yes. We offer monthly options through approved financing.</div>
        </details>
      </section>
    `;

    const result = await extractFaq(html);
    expect(result).toEqual([
      { question: 'What insurance do you take?', answer: 'We accept most major PPO plans.' },
      { question: 'Do you offer payment plans?', answer: 'Yes. We offer monthly options through approved financing.' },
    ]);
  });

  it('gates extraction when requireDedicatedSection is true and no dedicated FAQ area exists', async () => {
    const html = `
      <main class="resource-index">
        <article class="resource-card">
          <h3>What insurance do you take?</h3>
          <p>Read the full answer in our billing guide.</p>
        </article>
        <article class="resource-card">
          <h3>Do you offer payment plans?</h3>
          <p>Read the full answer in our financing guide.</p>
        </article>
      </main>
    `;

    const result = await extractFaq(html, { requireDedicatedSection: true });
    expect(result).toEqual([]);
  });

  it('allows extraction with requireDedicatedSection when a realistic FAQ section exists', async () => {
    const html = `
      <main>
        <section id="faq" class="faq-block" aria-label="Frequently Asked Questions">
          <h2>Frequently Asked Questions</h2>
          <h3>What insurance do you take?</h3>
          <p>We accept most major PPO plans.</p>
          <h3>Do you offer payment plans?</h3>
          <p>Yes. We offer monthly options through approved financing.</p>
        </section>
      </main>
    `;

    const result = await extractFaq(html, { requireDedicatedSection: true });
    expect(result).toEqual([
      { question: 'What insurance do you take?', answer: 'We accept most major PPO plans.' },
      { question: 'Do you offer payment plans?', answer: 'Yes. We offer monthly options through approved financing.' },
    ]);
  });
});
