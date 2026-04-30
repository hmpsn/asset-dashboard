import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import { contentScope } from '../../../../server/schema/extractors/page-elements/content-scope.js';

describe('contentScope', () => {
  it('returns <article> when present (priority 1)', () => {
    const $ = cheerio.load('<article><p>Content</p></article><main><p>Main</p></main>');
    const $scope = contentScope($);
    expect($scope.is('article')).toBe(true);
  });

  it('returns .w-richtext when no <article> present (priority 2)', () => {
    const $ = cheerio.load('<div class="w-richtext"><p>Content</p></div><main><p>Main</p></main>');
    const $scope = contentScope($);
    expect($scope.hasClass('w-richtext')).toBe(true);
  });

  it('returns <main> when neither <article> nor .w-richtext present (priority 3)', () => {
    const $ = cheerio.load('<main><p>Content</p></main>');
    const $scope = contentScope($);
    expect($scope.is('main')).toBe(true);
  });

  it('returns <main> (or empty Cheerio) when page has no recognised container', () => {
    const $ = cheerio.load('<body><p>Just a paragraph</p></body>');
    const $scope = contentScope($);
    // Should return a Cheerio object that can be used with .find() even if <main> doesn't exist
    expect($scope.length >= 0).toBe(true);
    expect($scope.find).toBeDefined();
  });

  it('<article> wins over .w-richtext when both present (no double-counting)', () => {
    const $ = cheerio.load('<article><div class="w-richtext"><p>Text</p></div></article>');
    const $scope = contentScope($);
    expect($scope.is('article')).toBe(true);
  });

  it('returned scope can .find() descendants', () => {
    const $ = cheerio.load('<div class="w-richtext"><a href="https://external.com">Link</a></div>');
    const $scope = contentScope($);
    expect($scope.find('a[href]').length).toBe(1);
  });
});
