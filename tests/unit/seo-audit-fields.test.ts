import { describe, expect, it } from 'vitest';

import {
  auditApprovalFieldForCheck,
  auditWritableFieldForCheck,
} from '../../shared/types/seo-audit';

describe('SEO audit approval fields', () => {
  it.each([
    ['title', 'seoTitle'],
    ['title_length', 'seoTitle'],
    ['missing_title', 'seoTitle'],
    ['duplicate-title', 'seoTitle'],
    ['meta-description', 'seoDescription'],
    ['meta_length', 'seoDescription'],
    ['missing_meta', 'seoDescription'],
    ['duplicate-description', 'seoDescription'],
  ])('maps %s to the real writable field', (check, field) => {
    expect(auditWritableFieldForCheck(check)).toBe(field);
    expect(auditApprovalFieldForCheck(check)).toBe(field);
  });

  it('keeps structural and unknown checks reviewable but non-writeable', () => {
    expect(auditWritableFieldForCheck('h1')).toBeNull();
    expect(auditApprovalFieldForCheck('h1')).toBe('audit-h1');
    expect(auditWritableFieldForCheck('structured data')).toBeNull();
    expect(auditApprovalFieldForCheck('structured data')).toBe('audit-structured-data');
    expect(auditApprovalFieldForCheck('')).toBe('audit-issue');
  });
});
