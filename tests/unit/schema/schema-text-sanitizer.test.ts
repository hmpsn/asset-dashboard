import { describe, expect, it } from 'vitest';
import {
  cleanSchemaPublicText,
  isOpaqueSchemaIdentifier,
  normalizeSchemaText,
} from '../../../server/schema/schema-text-sanitizer.js';

describe('schema text sanitizer', () => {
  it('normalizes whitespace and zero-width chars', () => {
    expect(normalizeSchemaText('  Hello\u200B   world  ')).toBe('Hello world');
  });

  it('detects opaque identifiers', () => {
    expect(isOpaqueSchemaIdentifier('507f1f77bcf86cd799439011')).toBe(true);
    expect(isOpaqueSchemaIdentifier('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(isOpaqueSchemaIdentifier('Acme Plumbing')).toBe(false);
  });

  it('drops opaque and empty values from public schema fields', () => {
    expect(cleanSchemaPublicText('507f1f77bcf86cd799439011')).toBeUndefined();
    expect(cleanSchemaPublicText('   ')).toBeUndefined();
    expect(cleanSchemaPublicText(' Acme Plumbing ')).toBe('Acme Plumbing');
  });
});
