import { STUDIO_BOT_UA } from './constants.js';
import { createLogger } from './logger.js';

const log = createLogger('external-fetch');

export type ExternalFetchErrorKind = 'invalid_url' | 'timeout' | 'network' | 'http';

export class ExternalFetchError extends Error {
  readonly kind: ExternalFetchErrorKind;
  readonly url: string;
  readonly status?: number;
  readonly statusText?: string;
  readonly responseBodySnippet?: string;

  constructor(params: {
    kind: ExternalFetchErrorKind;
    message: string;
    url: string;
    status?: number;
    statusText?: string;
    responseBodySnippet?: string;
    cause?: unknown;
  }) {
    super(params.message);
    this.name = 'ExternalFetchError';
    this.kind = params.kind;
    this.url = params.url;
    this.status = params.status;
    this.statusText = params.statusText;
    this.responseBodySnippet = params.responseBodySnippet;
    if (params.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = params.cause;
    }
  }
}

export function isExternalFetchError(value: unknown): value is ExternalFetchError {
  return value instanceof ExternalFetchError;
}

export function normalizeExternalUrl(rawUrl: string): string {
  const input = rawUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch (err) {
    throw new ExternalFetchError({
      kind: 'invalid_url',
      message: `Invalid URL: ${input}`,
      url: input,
      cause: err,
    });
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ExternalFetchError({
      kind: 'invalid_url',
      message: `Unsupported URL protocol for external fetch: ${parsed.protocol}`,
      url: input,
    });
  }

  // Normalize consistently (trim, strip hash noise, preserve query/path).
  parsed.hash = '';
  return parsed.toString();
}

type ExternalFetchHeaders = Record<string, string> | Array<[string, string]>;
type ExternalFetchBody = string | Uint8Array | ArrayBuffer | URLSearchParams;
type ExternalFetchRedirect = 'follow' | 'error' | 'manual';

export type ExternalFetchOptions = {
  url: string;
  method?: string;
  headers?: ExternalFetchHeaders;
  body?: ExternalFetchBody | null;
  timeoutMs?: number;
  redirect?: ExternalFetchRedirect;
  signal?: AbortSignal;
  userAgent?: string;
  defaultHeaders?: Record<string, string>;
  logContext?: Record<string, unknown>;
};

function isAbortLikeError(err: unknown): boolean {
  if (typeof err === 'object' && err !== null && 'name' in err && (err as { name?: unknown }).name === 'AbortError') {
    return true;
  }
  if (!(err instanceof Error)) return false;
  return err.name === 'AbortError' || /aborted|timed out|timeout/i.test(err.message);
}

function composeTimeoutSignal(timeoutMs: number | undefined, outerSignal: AbortSignal | undefined): {
  signal: AbortSignal | undefined;
  cleanup: () => void;
} {
  if (!timeoutMs && !outerSignal) return { signal: undefined, cleanup: () => {} };
  if (!timeoutMs) return { signal: outerSignal, cleanup: () => {} };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromOuter = (): void => controller.abort();

  if (outerSignal) {
    if (outerSignal.aborted) controller.abort();
    else outerSignal.addEventListener('abort', abortFromOuter, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      if (outerSignal) outerSignal.removeEventListener('abort', abortFromOuter);
    },
  };
}

function buildHeaders(options: ExternalFetchOptions): Headers {
  const headers = new Headers(options.headers);
  const defaults = options.defaultHeaders ?? {};
  for (const [key, value] of Object.entries(defaults)) {
    if (!headers.has(key)) headers.set(key, value);
  }
  if (!headers.has('User-Agent')) {
    headers.set('User-Agent', options.userAgent ?? STUDIO_BOT_UA);
  }
  return headers;
}

export async function fetchExternal(options: ExternalFetchOptions): Promise<Response> {
  const normalizedUrl = normalizeExternalUrl(options.url);
  const headers = buildHeaders(options);
  const { signal, cleanup } = composeTimeoutSignal(options.timeoutMs, options.signal);

  try {
    const response = await fetch(normalizedUrl, {
      method: options.method,
      headers,
      body: options.body,
      redirect: options.redirect ?? 'follow',
      signal,
    });

    if (!response.ok) {
      let snippet = '';
      try {
        snippet = (await response.clone().text()).slice(0, 300);
      } catch (_err) {
        snippet = '';
      }
      throw new ExternalFetchError({
        kind: 'http',
        message: `HTTP ${response.status} from ${normalizedUrl}`,
        url: normalizedUrl,
        status: response.status,
        statusText: response.statusText,
        responseBodySnippet: snippet,
      });
    }

    return response;
  } catch (err) {
    if (isExternalFetchError(err)) {
      log.debug({ ...options.logContext, url: normalizedUrl, kind: err.kind, status: err.status }, 'External fetch failed');
      throw err;
    }

    const classified = isAbortLikeError(err)
      ? new ExternalFetchError({
        kind: 'timeout',
        message: `Timed out fetching ${normalizedUrl}`,
        url: normalizedUrl,
        cause: err,
      })
      : new ExternalFetchError({
        kind: 'network',
        message: `Network error fetching ${normalizedUrl}`,
        url: normalizedUrl,
        cause: err,
      });

    log.debug({ ...options.logContext, url: normalizedUrl, kind: classified.kind, detail: err instanceof Error ? err.message : String(err) }, 'External fetch failed');
    throw classified;
  } finally {
    cleanup();
  }
}

export async function fetchExternalText(options: ExternalFetchOptions): Promise<string> {
  const response = await fetchExternal(options);
  return response.text();
}

export async function fetchExternalJson<T>(options: ExternalFetchOptions): Promise<T> {
  const response = await fetchExternal(options);
  return response.json() as Promise<T>;
}
