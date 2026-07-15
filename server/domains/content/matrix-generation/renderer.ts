export type MatrixRenderMode = 'slug' | 'prose';

export const MATRIX_PATTERN_ISSUE_CODES = [
  'missing_variable',
  'unknown_variable',
  'blank_variable',
  'empty_slug_value',
  'unresolved_placeholder',
] as const;

export type MatrixPatternIssueCode = (typeof MATRIX_PATTERN_ISSUE_CODES)[number];

export interface MatrixPatternIssue {
  code: MatrixPatternIssueCode;
  variableName?: string;
}

export type MatrixPatternRenderResult =
  | {
      status: 'rendered';
      value: string;
      substitutions: Record<string, string>;
    }
  | {
      status: 'blocked';
      issues: MatrixPatternIssue[];
    };

export const MATRIX_PATH_ISSUE_CODES = [
  'full_url',
  'query_or_fragment',
  'path_traversal',
  'empty_path_segment',
  'unresolved_placeholder',
  'non_absolute_path',
  'invalid_path_encoding',
] as const;

export type MatrixPathIssueCode = (typeof MATRIX_PATH_ISSUE_CODES)[number];

export type MatrixPathValidationResult =
  | { status: 'valid'; canonicalPath: string }
  | { status: 'blocked'; code: MatrixPathIssueCode };

const PLACEHOLDER = /\{([^{}]+)\}/g;
const ANY_BRACE = /[{}]/;
const COMBINING_MARKS = /\p{Mark}+/gu;
const NON_ASCII_ALPHANUMERIC = /[^a-z0-9]+/g;
const UNSAFE_PATH_CHARACTERS = /[\p{Cc}\p{Cf}\p{Z}]/u;
const RESIDUAL_PERCENT_ESCAPE = /%[0-9a-f]{2}/i;

function prototypeSafeStringRecord(): Record<string, string> {
  return Object.create(null) as Record<string, string>;
}

/** Locale-stable slug substitution. A non-empty input may intentionally return empty. */
export function slugifyMatrixVariable(value: string): string {
  return value
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(NON_ASCII_ALPHANUMERIC, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function uniqueIssues(issues: MatrixPatternIssue[]): MatrixPatternIssue[] {
  const seen = new Set<string>();
  return issues.filter(issue => {
    const key = `${issue.code}:${issue.variableName ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Canonical renderer shared by URL, keyword, title, metadata, and headings.
 * Prose mode preserves values byte-for-byte; slug mode normalizes only values.
 */
export function renderMatrixPattern(
  pattern: string,
  variableValues: Readonly<Record<string, string>>,
  mode: MatrixRenderMode,
  allowedVariableNames?: readonly string[],
): MatrixPatternRenderResult {
  if (typeof pattern !== 'string') {
    return { status: 'blocked', issues: [{ code: 'unresolved_placeholder' }] };
  }

  const allowed = allowedVariableNames ? new Set(allowedVariableNames) : null;
  const issues: MatrixPatternIssue[] = [];
  const substitutions = prototypeSafeStringRecord();
  const malformedPattern = ANY_BRACE.test(pattern.replace(PLACEHOLDER, ''));

  const value = pattern.replace(PLACEHOLDER, (placeholder, variableName: string) => {
    if (allowed && !allowed.has(variableName)) {
      issues.push({ code: 'unknown_variable', variableName });
      return placeholder;
    }
    if (!Object.prototype.hasOwnProperty.call(variableValues, variableName)) {
      issues.push({ code: 'missing_variable', variableName });
      return placeholder;
    }

    const rawValue = variableValues[variableName];
    if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
      issues.push({ code: 'blank_variable', variableName });
      return placeholder;
    }
    if (ANY_BRACE.test(rawValue)) {
      issues.push({ code: 'unresolved_placeholder', variableName });
      return placeholder;
    }

    const renderedValue = mode === 'slug' ? slugifyMatrixVariable(rawValue) : rawValue;
    if (mode === 'slug' && renderedValue.length === 0) {
      issues.push({ code: 'empty_slug_value', variableName });
      return placeholder;
    }
    substitutions[variableName] = renderedValue;
    return renderedValue;
  });

  if (malformedPattern || (issues.length === 0 && ANY_BRACE.test(value))) {
    issues.push({ code: 'unresolved_placeholder' });
  }
  if (issues.length > 0) return { status: 'blocked', issues: uniqueIssues(issues) };

  return { status: 'rendered', value, substitutions };
}

function pathFromCollisionSource(value: string): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)) {
    try {
      // Validate the authority without using URL.pathname, which resolves dot
      // segments before our collision policy can reject them.
      new URL(trimmed);
      const authorityStart = trimmed.indexOf('://') + 3;
      const boundaryOffset = trimmed.slice(authorityStart).search(/[/?#]/);
      if (boundaryOffset === -1) return '/';
      const boundary = authorityStart + boundaryOffset;
      if (trimmed[boundary] !== '/') return '/';
      return trimmed.slice(boundary).split(/[?#]/, 1)[0];
    } catch { // catch-ok - malformed legacy collision URLs resolve to a non-match.
      return null;
    }
  }
  return trimmed;
}

/**
 * Canonical comparison key for existing paths. This helper is deliberately
 * permissive about trailing slashes because collision sources may be legacy.
 */
export function canonicalizeMatrixPath(value: string): string | null {
  const sourcePath = pathFromCollisionSource(value);
  if (!sourcePath || !sourcePath.startsWith('/') || sourcePath.startsWith('//')) return null;
  const withoutQuery = sourcePath.split(/[?#]/, 1)[0];
  const collapsedTrailingSlash = withoutQuery.length > 1
    ? withoutQuery.replace(/\/+$/, '')
    : withoutQuery;
  if (!collapsedTrailingSlash) return null;

  const segments = collapsedTrailingSlash.slice(1).split('/');
  if (segments.length === 1 && segments[0] === '') return '/';
  const normalizedSegments: string[] = [];
  for (const segment of segments) {
    if (!segment) return null;
    const normalized = decodeNormalizedPathSegment(segment);
    if (normalized.status === 'blocked') return null;
    normalizedSegments.push(normalized.value.toLowerCase());
  }
  return `/${normalizedSegments.join('/')}`;
}

type NormalizedPathSegmentResult =
  | { status: 'normalized'; value: string }
  | {
      status: 'blocked';
      code:
        | 'query_or_fragment'
        | 'path_traversal'
        | 'empty_path_segment'
        | 'unresolved_placeholder'
        | 'invalid_path_encoding';
    };

function decodeNormalizedPathSegment(segment: string): NormalizedPathSegmentResult {
  let normalized: string;
  try {
    normalized = decodeURIComponent(segment).normalize('NFKC');
  } catch { // catch-ok - invalid path encoding is returned as a typed blocker.
    return { status: 'blocked', code: 'invalid_path_encoding' };
  }
  // A percent escape remaining after one complete decode is layered encoding.
  // Reject it instead of allowing another router/proxy to decode a traversal or
  // separator that this boundary did not inspect.
  if (RESIDUAL_PERCENT_ESCAPE.test(normalized)) {
    return { status: 'blocked', code: 'invalid_path_encoding' };
  }
  if (ANY_BRACE.test(normalized)) {
    return { status: 'blocked', code: 'unresolved_placeholder' };
  }
  if (normalized.includes('?') || normalized.includes('#')) {
    return { status: 'blocked', code: 'query_or_fragment' };
  }
  if (normalized === '.' || normalized === '..' || normalized.includes('/') || normalized.includes('\\')) {
    return { status: 'blocked', code: 'path_traversal' };
  }
  if (!normalized || normalized.trim().length === 0) {
    return { status: 'blocked', code: 'empty_path_segment' };
  }
  if (UNSAFE_PATH_CHARACTERS.test(normalized)) {
    return { status: 'blocked', code: 'invalid_path_encoding' };
  }
  return { status: 'normalized', value: normalized };
}

/** Strict validation for newly rendered page paths. */
export function validateRenderedMatrixPath(path: string): MatrixPathValidationResult {
  if (typeof path !== 'string') return { status: 'blocked', code: 'non_absolute_path' };
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(path) || path.startsWith('//')) {
    return { status: 'blocked', code: 'full_url' };
  }
  if (path.includes('?') || path.includes('#')) {
    return { status: 'blocked', code: 'query_or_fragment' };
  }
  if (ANY_BRACE.test(path)) return { status: 'blocked', code: 'unresolved_placeholder' };
  if (!path.startsWith('/')) return { status: 'blocked', code: 'non_absolute_path' };
  if (path.includes('\\')) return { status: 'blocked', code: 'path_traversal' };

  const segments = path.slice(1).split('/');
  if (segments.length === 0 || segments.some(segment => segment.length === 0)) {
    return { status: 'blocked', code: 'empty_path_segment' };
  }

  const decodedSegments: string[] = [];
  for (const segment of segments) {
    const normalized = decodeNormalizedPathSegment(segment);
    if (normalized.status === 'blocked') return normalized;
    decodedSegments.push(normalized.value.toLowerCase());
  }

  return { status: 'valid', canonicalPath: `/${decodedSegments.join('/')}` };
}
