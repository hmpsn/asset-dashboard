export type GoogleProviderSource = 'ga4' | 'gsc' | 'google-oauth' | 'gbp';

export type GoogleProviderFailureKind = 'http' | 'network' | 'timeout' | 'invalid-json';

interface GoogleProviderErrorOptions {
  source: GoogleProviderSource;
  endpoint: string;
  kind: GoogleProviderFailureKind;
  status?: number;
  body?: string;
  cause?: unknown;
}

export class GoogleProviderError extends Error {
  readonly source: GoogleProviderSource;
  readonly endpoint: string;
  readonly kind: GoogleProviderFailureKind;
  readonly status?: number;
  readonly body?: string;
  readonly retryable: boolean;

  constructor(options: GoogleProviderErrorOptions) {
    super(buildGoogleProviderErrorMessage(options), { cause: options.cause });
    this.name = 'GoogleProviderError';
    this.source = options.source;
    this.endpoint = options.endpoint;
    this.kind = options.kind;
    this.status = options.status;
    this.body = options.body;
    this.retryable = options.kind === 'timeout'
      || options.kind === 'network'
      || options.status === 429
      || (options.status ?? 0) >= 500;
  }
}

function buildGoogleProviderErrorMessage(options: GoogleProviderErrorOptions): string {
  if (options.kind === 'http' && typeof options.status === 'number') {
    return `${options.source} provider http error (${options.status})`;
  }
  return `${options.source} provider ${options.kind} error`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function isBodyInitLike(value: unknown): boolean {
  return typeof value === 'string'
    || value instanceof URLSearchParams
    || value instanceof FormData
    || value instanceof Blob
    || value instanceof ArrayBuffer
    || ArrayBuffer.isView(value);
}

export function isGoogleProviderError(error: unknown): error is GoogleProviderError {
  return error instanceof GoogleProviderError;
}

function headerEntries(headers: RequestInit['headers']): Array<[string, string]> {
  if (!headers) return [];
  if (headers instanceof Headers) {
    return Array.from(headers.entries());
  }
  if (Array.isArray(headers)) {
    return headers.map(([key, value]) => [key, String(value)]);
  }
  return Object.entries(headers).map(([key, value]) => [key, String(value)]);
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const needle = name.toLowerCase();
  return Object.keys(headers).some(key => key.toLowerCase() === needle);
}

interface GoogleJsonOptions {
  endpoint: string;
  source: GoogleProviderSource;
  token?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: RequestInit['headers'];
  body?: unknown;
  timeoutMs?: number;
}

export async function googleJson<T>(options: GoogleJsonOptions): Promise<T> {
  const requestHeaders = Object.fromEntries(headerEntries(options.headers));
  if (options.token) {
    requestHeaders.Authorization = `Bearer ${options.token}`;
  }

  let body: RequestInit['body'] | undefined;
  if (options.body instanceof URLSearchParams) {
    body = options.body;
    if (!hasHeader(requestHeaders, 'Content-Type')) {
      requestHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
    }
  } else if (options.body !== undefined && !isBodyInitLike(options.body)) {
    body = JSON.stringify(options.body);
    if (!hasHeader(requestHeaders, 'Content-Type')) {
      requestHeaders['Content-Type'] = 'application/json';
    }
  } else {
    body = options.body as RequestInit['body'];
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  if (typeof timeout.unref === 'function') timeout.unref();

  try {
    const response = await fetch(options.endpoint, {
      method: options.method ?? (body ? 'POST' : 'GET'),
      headers: requestHeaders,
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      let responseBody = '';
      try {
        responseBody = await response.text();
      } catch (err) {
        void err;
        responseBody = '';
      }

      throw new GoogleProviderError({
        source: options.source,
        endpoint: options.endpoint,
        kind: 'http',
        status: response.status,
        body: responseBody,
      });
    }

    try {
      return await response.json() as T;
    } catch (error) {
      throw new GoogleProviderError({
        source: options.source,
        endpoint: options.endpoint,
        kind: 'invalid-json',
        cause: error,
      });
    }
  } catch (error) {
    if (isGoogleProviderError(error)) throw error;
    if (isAbortError(error)) {
      throw new GoogleProviderError({
        source: options.source,
        endpoint: options.endpoint,
        kind: 'timeout',
        cause: error,
      });
    }

    throw new GoogleProviderError({
      source: options.source,
      endpoint: options.endpoint,
      kind: 'network',
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
  }
}
