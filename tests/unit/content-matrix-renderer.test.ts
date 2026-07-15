import { describe, expect, it } from 'vitest';
import {
  canonicalizeMatrixPath,
  renderMatrixPattern,
  slugifyMatrixVariable,
  validateRenderedMatrixPath,
} from '../../server/domains/content/matrix-generation/renderer.js';

describe('content matrix deterministic renderer', () => {
  it('preserves prose values while rendering locale-safe slug values', () => {
    const variables = {
      city: '  San José  ',
      service: 'Children’s Dentistry',
    };

    expect(renderMatrixPattern('{service} in {city}', variables, 'prose')).toEqual({
      status: 'rendered',
      value: 'Children’s Dentistry in   San José  ',
      substitutions: variables,
    });
    expect(renderMatrixPattern('/{city}/{service}', variables, 'slug')).toEqual({
      status: 'rendered',
      value: '/san-jose/children-s-dentistry',
      substitutions: {
        city: 'san-jose',
        service: 'children-s-dentistry',
      },
    });
  });

  it('uses NFKD, removes combining marks, and collapses non-ASCII separators', () => {
    expect(slugifyMatrixVariable('Crème  brûlée & Spa')).toBe('creme-brulee-spa');
    expect(slugifyMatrixVariable('São---Paulo')).toBe('sao-paulo');
  });

  it('blocks a non-empty value that normalizes to an empty slug', () => {
    expect(renderMatrixPattern('/locations/{city}', { city: '東京' }, 'slug')).toEqual({
      status: 'blocked',
      issues: [{ code: 'empty_slug_value', variableName: 'city' }],
    });
  });

  it('blocks missing, unknown, blank, and malformed placeholders', () => {
    expect(renderMatrixPattern('/{city}/{service}', { city: 'Austin' }, 'slug')).toEqual({
      status: 'blocked',
      issues: [{ code: 'missing_variable', variableName: 'service' }],
    });
    expect(renderMatrixPattern('/{city}/{unknown}', { city: 'Austin' }, 'slug', ['city'])).toEqual({
      status: 'blocked',
      issues: [{ code: 'unknown_variable', variableName: 'unknown' }],
    });
    expect(renderMatrixPattern('/{city}', { city: '   ' }, 'slug')).toEqual({
      status: 'blocked',
      issues: [{ code: 'blank_variable', variableName: 'city' }],
    });
    expect(renderMatrixPattern('/{city', { city: 'Austin' }, 'slug')).toEqual({
      status: 'blocked',
      issues: [{ code: 'unresolved_placeholder' }],
    });
  });

  it.each([
    ['keyword', '{service} in Austin', 'prose'],
    ['title', 'Austin {service} Specialists', 'prose'],
    ['meta description', 'Compare trusted {service} options in Austin.', 'prose'],
    ['slug', '/services/{service}', 'slug'],
  ] as const)('blocks brace-bearing substitution values in a %s pattern', (_label, pattern, mode) => {
    expect(renderMatrixPattern(pattern, { service: 'Roofing {Premium}' }, mode)).toEqual({
      status: 'blocked',
      issues: [{ code: 'unresolved_placeholder', variableName: 'service' }],
    });
  });

  it('renders repeated placeholders without treating regex characters in names as syntax', () => {
    expect(renderMatrixPattern('/{city.name}/{city.name}', { 'city.name': 'St. Paul' }, 'slug')).toEqual({
      status: 'rendered',
      value: '/st-paul/st-paul',
      substitutions: { 'city.name': 'st-paul' },
    });
  });

  it('uses prototype-safe substitution maps for special variable names', () => {
    const variables = Object.create(null) as Record<string, string>;
    variables.__proto__ = 'Clinic';

    const result = renderMatrixPattern('/{__proto__}', variables, 'slug', ['__proto__']);
    expect(result.status).toBe('rendered');
    if (result.status !== 'rendered') return;
    expect(Object.getPrototypeOf(result.substitutions)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(result.substitutions, '__proto__')).toBe(true);
    expect(result.substitutions.__proto__).toBe('clinic');
  });

  it.each([
    ['https://elsewhere.test/austin', 'full_url'],
    ['//elsewhere.test/austin', 'full_url'],
    ['/austin?preview=true', 'query_or_fragment'],
    ['/austin#hours', 'query_or_fragment'],
    ['/safe/%3fadmin', 'query_or_fragment'],
    ['/safe/%23fragment', 'query_or_fragment'],
    ['/services/../admin', 'path_traversal'],
    ['/services/%2e%2e/admin', 'path_traversal'],
    ['/services/%EF%BC%8E%EF%BC%8E/admin', 'path_traversal'],
    ['/services/%EF%BC%8Fadmin', 'path_traversal'],
    ['/services/%EF%BC%BCadmin', 'path_traversal'],
    ['/safe/%252e%252e/admin', 'invalid_path_encoding'],
    ['/safe/%252fadmin', 'invalid_path_encoding'],
    ['/safe/%255cadmin', 'invalid_path_encoding'],
    ['/safe/%253fadmin', 'invalid_path_encoding'],
    ['/safe/%2523fragment', 'invalid_path_encoding'],
    ['/services/%E2%80%AEadmin', 'invalid_path_encoding'],
    ['/services/%00admin', 'invalid_path_encoding'],
    ['/services//austin', 'empty_path_segment'],
    ['/services/austin/', 'empty_path_segment'],
    ['/services/{city}', 'unresolved_placeholder'],
    ['/services/%7Bcity%7D', 'unresolved_placeholder'],
    ['/services/%257Bcity%257D', 'invalid_path_encoding'],
    ['services/austin', 'non_absolute_path'],
  ] as const)('blocks invalid rendered path %s', (path, code) => {
    expect(validateRenderedMatrixPath(path)).toEqual({ status: 'blocked', code });
  });

  it('canonicalizes equivalent collision paths without changing the rendered path', () => {
    expect(validateRenderedMatrixPath('/Services/San-Jose')).toEqual({
      status: 'valid',
      canonicalPath: '/services/san-jose',
    });
    expect(canonicalizeMatrixPath('/services/san-jose/')).toBe('/services/san-jose');
  });

  it('preserves legitimate single-pass UTF-8 percent decoding', () => {
    expect(validateRenderedMatrixPath('/services/caf%C3%A9')).toEqual({
      status: 'valid',
      canonicalPath: '/services/café',
    });
    expect(canonicalizeMatrixPath('/services/caf%C3%A9/')).toBe('/services/café');
  });

  it('rejects traversal and separator variants in collision sources before canonicalizing', () => {
    expect(canonicalizeMatrixPath('/safe/%2e%2e/admin')).toBeNull();
    expect(canonicalizeMatrixPath('/safe/%EF%BC%8E%EF%BC%8E/admin')).toBeNull();
    expect(canonicalizeMatrixPath('/safe/%EF%BC%8Fadmin')).toBeNull();
    expect(canonicalizeMatrixPath('https://example.test/safe/%2e%2e/admin')).toBeNull();
  });

  it('rejects layered traversal and separator encodings in collision sources', () => {
    expect(canonicalizeMatrixPath('/safe/%252e%252e/admin')).toBeNull();
    expect(canonicalizeMatrixPath('/safe/%252fadmin')).toBeNull();
    expect(canonicalizeMatrixPath('/safe/%255cadmin')).toBeNull();
    expect(canonicalizeMatrixPath('/safe/%253fadmin')).toBeNull();
    expect(canonicalizeMatrixPath('/safe/%2523fragment')).toBeNull();
  });

  it('rejects single-encoded and layered placeholders in collision sources', () => {
    expect(canonicalizeMatrixPath('/services/%7Bcity%7D')).toBeNull();
    expect(canonicalizeMatrixPath('/services/%257Bcity%257D')).toBeNull();
  });

  it('rejects encoded query and fragment delimiters in collision sources', () => {
    expect(canonicalizeMatrixPath('/safe/%3fadmin')).toBeNull();
    expect(canonicalizeMatrixPath('/safe/%23fragment')).toBeNull();
  });
});
