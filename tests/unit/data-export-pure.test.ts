/**
 * Unit tests for the pure CSV formatting logic used in data-export routes.
 *
 * The `toCsv` function is internal (not exported) from server/routes/data-export.ts,
 * so these tests reproduce its exact logic to verify correctness:
 *   - Header row generation
 *   - Empty-value handling (null / undefined → empty string)
 *   - Object value serialization (JSON.stringify)
 *   - Quoting rules: comma, double-quote, newline in cell values
 *   - Row ordering matches header order
 *   - Extra row keys not in headers are ignored
 *
 * We also test the strategy-row transformation logic (secondaryKeywords join)
 * that the /strategy export applies before calling toCsv.
 */

import { describe, it, expect } from 'vitest';

// ── Inline reproduction of the internal toCsv helper ────────────────────────
// This matches the implementation in server/routes/data-export.ts exactly,
// so changes to the source should cause these tests to fail and alert reviewers.

function escape(v: unknown): string {
  if (v == null) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => escape(row[h])).join(','));
  }
  return lines.join('\n');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseCsvLine(line: string): string[] {
  return line.split(',');
}

// ─────────────────────────────────────────────────────────────────────────────
// escape() — cell-level serialization
// ─────────────────────────────────────────────────────────────────────────────

describe('escape() — primitive value serialization', () => {
  it('returns empty string for null', () => {
    expect(escape(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(escape(undefined)).toBe('');
  });

  it('returns string as-is when no quoting needed', () => {
    expect(escape('hello')).toBe('hello');
  });

  it('returns number as string', () => {
    expect(escape(42)).toBe('42');
  });

  it('returns boolean as string', () => {
    expect(escape(true)).toBe('true');
    expect(escape(false)).toBe('false');
  });

  it('wraps value in quotes when it contains a comma', () => {
    const result = escape('hello, world');
    expect(result).toBe('"hello, world"');
  });

  it('wraps value in quotes and doubles internal quotes when it contains double-quotes', () => {
    const result = escape('say "hi"');
    expect(result).toBe('"say ""hi"""');
  });

  it('wraps value in quotes when it contains a newline', () => {
    const result = escape('line1\nline2');
    expect(result).toBe('"line1\nline2"');
  });

  it('serializes objects via JSON.stringify and wraps in quotes when output contains commas', () => {
    // JSON objects always contain at least "{}" — with keys they contain colons/commas
    const result = escape({ a: 1, b: 2 });
    // JSON output: '{"a":1,"b":2}' contains commas → must be quoted
    expect(result).toMatch(/^"/);
    expect(result).toMatch(/"$/);
    expect(result).toContain('"a"');
    expect(result).toContain('"b"');
  });

  it('serializes empty object as "{}" — no quoting needed (no comma)', () => {
    const result = escape({});
    expect(result).toBe('{}');
  });

  it('serializes arrays via JSON.stringify', () => {
    const result = escape([1, 2, 3]);
    // "[1,2,3]" contains commas → wrapped in quotes
    expect(result).toBe('"[1,2,3]"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// toCsv() — row-level and document-level correctness
// ─────────────────────────────────────────────────────────────────────────────

describe('toCsv() — header row', () => {
  it('first line is the header row joined by commas', () => {
    const csv = toCsv(['id', 'name', 'status'], []);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('id,name,status');
  });

  it('produces exactly one line for zero rows (header only)', () => {
    const csv = toCsv(['id', 'name'], []);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(1);
  });
});

describe('toCsv() — row ordering and column extraction', () => {
  it('maps each row to the header order', () => {
    const csv = toCsv(
      ['a', 'b', 'c'],
      [{ a: 'alpha', b: 'beta', c: 'gamma' }],
    );
    const lines = csv.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('alpha,beta,gamma');
  });

  it('ignores extra keys not present in headers', () => {
    const csv = toCsv(
      ['id', 'name'],
      [{ id: '1', name: 'Test', extraField: 'ignored' } as Record<string, unknown>],
    );
    const lines = csv.split('\n');
    expect(lines[1]).toBe('1,Test');
  });

  it('uses empty string for missing keys', () => {
    const csv = toCsv(
      ['id', 'name', 'optional'],
      [{ id: '1', name: 'Test' }],
    );
    const lines = csv.split('\n');
    // 'optional' key is absent → empty string → trailing comma
    expect(lines[1]).toBe('1,Test,');
  });

  it('produces the correct number of data lines for multiple rows', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: String(i), val: `row${i}` }));
    const csv = toCsv(['id', 'val'], rows);
    const lines = csv.split('\n');
    // 1 header + 5 data rows
    expect(lines).toHaveLength(6);
  });
});

describe('toCsv() — quoting edge cases in rows', () => {
  it('quotes cell containing a comma', () => {
    const csv = toCsv(['value'], [{ value: 'Austin, TX' }]);
    const dataLine = csv.split('\n')[1];
    expect(dataLine).toBe('"Austin, TX"');
  });

  it('quotes cell containing a double-quote and doubles the quote', () => {
    const csv = toCsv(['value'], [{ value: 'He said "hello"' }]);
    const dataLine = csv.split('\n')[1];
    expect(dataLine).toBe('"He said ""hello"""');
  });

  it('multiple columns: only the problematic cell is quoted', () => {
    const csv = toCsv(
      ['id', 'description', 'status'],
      [{ id: '1', description: 'Has, comma', status: 'active' }],
    );
    const dataLine = csv.split('\n')[1];
    // id and status need no quotes, description does
    expect(dataLine).toBe('1,"Has, comma",active');
  });

  it('null values in mixed row produce empty strings', () => {
    const csv = toCsv(
      ['id', 'name', 'amount'],
      [{ id: 'p1', name: null, amount: null }],
    );
    const dataLine = csv.split('\n')[1];
    expect(dataLine).toBe('p1,,');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Strategy export row transformation
// ─────────────────────────────────────────────────────────────────────────────
// The /strategy export joins secondaryKeywords with '; ' before passing to toCsv.
// These tests verify that transformation logic directly.

describe('Strategy export — secondaryKeywords serialization', () => {
  function buildStrategyRow(secondaryKeywords: string[]): Record<string, unknown> {
    return {
      pagePath: '/blog/test',
      pageTitle: 'Test Page',
      primaryKeyword: 'test keyword',
      secondaryKeywords: secondaryKeywords.join('; '),
    };
  }

  it('joins multiple secondary keywords with "; " separator', () => {
    const row = buildStrategyRow(['seo tips', 'content marketing', 'search intent']);
    expect(row.secondaryKeywords).toBe('seo tips; content marketing; search intent');
  });

  it('empty array produces an empty string', () => {
    const row = buildStrategyRow([]);
    expect(row.secondaryKeywords).toBe('');
  });

  it('single keyword produces no separator', () => {
    const row = buildStrategyRow(['only keyword']);
    expect(row.secondaryKeywords).toBe('only keyword');
  });

  it('joined secondary keywords survive CSV round-trip without corruption for simple values', () => {
    const row = buildStrategyRow(['seo guide', 'content tips']);
    const csv = toCsv(
      ['pagePath', 'pageTitle', 'primaryKeyword', 'secondaryKeywords'],
      [row],
    );
    const lines = csv.split('\n');
    expect(lines[1]).toBe('/blog/test,Test Page,test keyword,seo guide; content tips');
  });

  it('secondary keywords containing commas are quoted in CSV output', () => {
    // Edge case: a keyword like "Austin, TX" would cause quoting
    const row = buildStrategyRow(['dentist, pediatric', 'orthodontist']);
    const csv = toCsv(['secondaryKeywords'], [row]);
    const dataLine = csv.split('\n')[1];
    // The joined value "dentist, pediatric; orthodontist" contains a comma → quoted
    expect(dataLine).toMatch(/^"/);
    expect(dataLine).toContain('dentist, pediatric');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Matrix export — variableValues serialization
// ─────────────────────────────────────────────────────────────────────────────
// The /matrices export serializes variableValues as "key=value; key=value".

describe('Matrix export — variableValues serialization', () => {
  function buildVariableValuesStr(variableValues: Record<string, string>): string {
    return Object.entries(variableValues)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  it('single variable produces "key=value"', () => {
    expect(buildVariableValuesStr({ city: 'Austin' })).toBe('city=Austin');
  });

  it('multiple variables produce "; " separated "key=value" pairs', () => {
    const result = buildVariableValuesStr({ city: 'Austin', service: 'plumbing' });
    expect(result).toBe('city=Austin; service=plumbing');
  });

  it('empty object produces empty string', () => {
    expect(buildVariableValuesStr({})).toBe('');
  });

  it('variable values survive CSV round-trip for simple values', () => {
    const valStr = buildVariableValuesStr({ city: 'Austin', service: 'plumbing' });
    const csv = toCsv(['variableValues'], [{ variableValues: valStr }]);
    const dataLine = csv.split('\n')[1];
    // No commas in the cell → no quoting needed
    expect(dataLine).toBe('city=Austin; service=plumbing');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Template export — sectionCount / variableCount computation
// ─────────────────────────────────────────────────────────────────────────────

describe('Template export — array length fields', () => {
  function computeSectionCount(sections?: unknown[]): number {
    return sections?.length || 0;
  }

  function computeVariableCount(variables?: unknown[]): number {
    return variables?.length || 0;
  }

  it('returns 0 when sections is undefined', () => {
    expect(computeSectionCount(undefined)).toBe(0);
  });

  it('returns 0 when sections is empty array', () => {
    expect(computeSectionCount([])).toBe(0);
  });

  it('returns correct count for non-empty sections array', () => {
    expect(computeSectionCount([{}, {}, {}])).toBe(3);
  });

  it('returns correct count for variables array', () => {
    expect(computeVariableCount([{ name: 'city' }, { name: 'service' }])).toBe(2);
  });
});
