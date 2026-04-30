import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import { extractTestimonials } from '../../../../server/schema/extractors/page-elements/testimonials.js';

describe('extractTestimonials', () => {
  it('extracts a <blockquote> with a <cite>', () => {
    const $ = cheerio.load(`
      <article>
        <blockquote>
          "Excellent service from start to finish."
          <cite>— Jane Doe</cite>
        </blockquote>
      </article>
    `);
    const testimonials = extractTestimonials($);
    expect(testimonials).toHaveLength(1);
    expect(testimonials[0].quote).toContain('Excellent service from start to finish.');
    expect(testimonials[0].author).toBe('Jane Doe');
    expect(testimonials[0].selector).toContain('blockquote');
  });

  it('extracts rating from data-rating attribute', () => {
    const $ = cheerio.load(`
      <article>
        <blockquote data-rating="5">
          "5 stars all around."
          <cite>John Smith</cite>
        </blockquote>
      </article>
    `);
    expect(extractTestimonials($)[0].rating).toBe(5);
  });

  it('extracts rating from a child element with star count', () => {
    const $ = cheerio.load(`
      <article>
        <div class="testimonial">
          <div class="rating" aria-label="4 out of 5 stars"></div>
          <blockquote>"Pretty solid experience."</blockquote>
          <cite>Alice</cite>
        </div>
      </article>
    `);
    expect(extractTestimonials($)[0].rating).toBe(4);
  });

  it('handles multiple testimonials', () => {
    const $ = cheerio.load(`
      <article>
        <blockquote>"First quote."<cite>Person A</cite></blockquote>
        <blockquote>"Second quote."<cite>Person B</cite></blockquote>
        <blockquote>"Third quote."<cite>Person C</cite></blockquote>
      </article>
    `);
    const testimonials = extractTestimonials($);
    expect(testimonials).toHaveLength(3);
    expect(testimonials.map(t => t.author)).toEqual(['Person A', 'Person B', 'Person C']);
  });

  it('skips blockquotes with no meaningful text (≥10 chars after trim)', () => {
    const $ = cheerio.load(`
      <article>
        <blockquote>".."</blockquote>
        <blockquote>"This is a real testimonial that meets the minimum length."<cite>X</cite></blockquote>
      </article>
    `);
    expect(extractTestimonials($)).toHaveLength(1);
  });

  it('strips quotes and dashes from author text', () => {
    const $ = cheerio.load(`
      <article>
        <blockquote>"Great work!"<cite>— Bob "The Builder"</cite></blockquote>
      </article>
    `);
    expect(extractTestimonials($)[0].author).toBe('Bob "The Builder"'); // strips leading dash, keeps inner quotes
  });

  it('returns rating as undefined when no rating signal present', () => {
    const $ = cheerio.load(`
      <article>
        <blockquote>"No rating attached."<cite>X</cite></blockquote>
      </article>
    `);
    expect(extractTestimonials($)[0].rating).toBeUndefined();
  });

  it('falls back to whole-document scope when no <article> tag', () => {
    const $ = cheerio.load(`
      <main>
        <blockquote>"Outside an article tag."<cite>Y</cite></blockquote>
      </main>
    `);
    expect(extractTestimonials($)).toHaveLength(1);
  });

  it('returns empty array when no testimonials', () => {
    const $ = cheerio.load('<article><p>Body.</p></article>');
    expect(extractTestimonials($)).toEqual([]);
  });

  it('clamps rating to 1-5 range (ignores out-of-range values)', () => {
    const $ = cheerio.load(`
      <article>
        <blockquote data-rating="10">"Out of range high"<cite>X</cite></blockquote>
        <blockquote data-rating="0">"Out of range low"<cite>Y</cite></blockquote>
      </article>
    `);
    const testimonials = extractTestimonials($);
    expect(testimonials[0].rating).toBeUndefined();
    expect(testimonials[1].rating).toBeUndefined();
  });
});
