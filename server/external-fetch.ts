import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

import { STUDIO_BOT_UA } from './constants.js';
import { createLogger } from './logger.js';

const log = createLogger('external-fetch');

export type ExternalFetchErrorKind = 'invalid_url' | 'unsafe_url' | 'timeout' | 'network' | 'http';
export type ExternalUrlSafetyMode = 'allow-private' | 'public-web';

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

function isPrivateIpv4(host: string): boolean {
  const parsed = parseIpv4(host);
  if (parsed === null) return false;
  const parts = [
    (parsed >>> 24) & 0xff,
    (parsed >>> 16) & 0xff,
    (parsed >>> 8) & 0xff,
    parsed & 0xff,
  ];
  if (parts[0] === 0) return true;
  if (parts[0] === 10) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
  return false;
}

function parseIpv4(host: string): number | null {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255 || !Number.isInteger(part))) {
    return null;
  }
  return ((parts[0] << 24) >>> 0) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
}

function parseIpv6(host: string): bigint | null {
  let normalized = host.toLowerCase();
  const zoneIndex = normalized.indexOf('%');
  if (zoneIndex !== -1) normalized = normalized.slice(0, zoneIndex);
  if (!normalized) return null;

  // Convert trailing dotted-quad to two hextets when present.
  if (normalized.includes('.')) {
    const lastColon = normalized.lastIndexOf(':');
    if (lastColon === -1) return null;
    const ipv4 = parseIpv4(normalized.slice(lastColon + 1));
    if (ipv4 === null) return null;
    const high = ((ipv4 >>> 16) & 0xffff).toString(16);
    const low = (ipv4 & 0xffff).toString(16);
    normalized = `${normalized.slice(0, lastColon)}:${high}:${low}`;
  }

  const pieces = normalized.split('::');
  if (pieces.length > 2) return null;

  const left = pieces[0] ? pieces[0].split(':').filter(Boolean) : [];
  const right = pieces.length === 2 && pieces[1] ? pieces[1].split(':').filter(Boolean) : [];
  const hasCompression = pieces.length === 2;

  if (!left.every((part) => /^[0-9a-f]{1,4}$/.test(part))) return null;
  if (!right.every((part) => /^[0-9a-f]{1,4}$/.test(part))) return null;

  const totalExplicit = left.length + right.length;
  if ((!hasCompression && totalExplicit !== 8) || (hasCompression && totalExplicit >= 8)) return null;

  const zeroFill = hasCompression ? 8 - totalExplicit : 0;
  const segments = [
    ...left.map((part) => parseInt(part, 16)),
    ...Array.from({ length: zeroFill }, () => 0),
    ...right.map((part) => parseInt(part, 16)),
  ];
  if (segments.length !== 8) return null;

  let value = 0n;
  for (const segment of segments) {
    value = (value << 16n) | BigInt(segment);
  }
  return value;
}

function isPrivateIpv6(host: string): boolean {
  const parsed = parseIpv6(host);
  if (parsed === null) return false;

  // Unspecified and loopback.
  if (parsed === 0n || parsed === 1n) return true;

  // fe80::/10 (link-local).
  if ((parsed & 0xffc00000000000000000000000000000n) === 0xfe800000000000000000000000000000n) return true;

  // fc00::/7 (unique local).
  if ((parsed & 0xfe000000000000000000000000000000n) === 0xfc000000000000000000000000000000n) return true;

  // ::ffff:0:0/96 (IPv4-mapped) including hex tails (e.g. ::ffff:7f00:1).
  if ((parsed & 0xffffffffffffffffffffffff00000000n) === 0x00000000000000000000ffff00000000n) {
    const mappedIpv4 = Number(parsed & 0xffffffffn);
    const octets = [
      (mappedIpv4 >>> 24) & 0xff,
      (mappedIpv4 >>> 16) & 0xff,
      (mappedIpv4 >>> 8) & 0xff,
      mappedIpv4 & 0xff,
    ];
    return isPrivateIpv4(octets.join('.'));
  }

  return false;
}

function isUnsafePublicHostname(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;

  const ipVersion = isIP(host);
  if (ipVersion === 4) return isPrivateIpv4(host);
  if (ipVersion === 6) return isPrivateIpv6(host);
  return false;
}

function isUnsafePublicIp(address: string): boolean {
  const normalized = normalizeHostname(address);
  const ipVersion = isIP(normalized);
  if (ipVersion === 4) return isPrivateIpv4(normalized);
  if (ipVersion === 6) return isPrivateIpv6(normalized);
  return false;
}

function normalizeHostname(hostname: string): string {
  const host = hostname.trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) {
    return host.slice(1, -1);
  }
  return host;
}

export function normalizeExternalUrl(rawUrl: string, options?: { safety?: ExternalUrlSafetyMode }): string {
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

  if (parsed.username || parsed.password) {
    throw new ExternalFetchError({
      kind: 'invalid_url',
      message: 'External fetch URL must not include embedded credentials',
      url: input,
    });
  }

  if ((options?.safety ?? 'allow-private') === 'public-web' && isUnsafePublicHostname(parsed.hostname)) {
    throw new ExternalFetchError({
      kind: 'unsafe_url',
      message: `Unsafe host for public web fetch: ${parsed.hostname}`,
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
  urlSafety?: ExternalUrlSafetyMode;
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

async function assertPublicWebHostSafety(url: string): Promise<void> {
  const parsed = new URL(url);
  const normalizedHost = normalizeHostname(parsed.hostname);

  if (isUnsafePublicHostname(normalizedHost)) {
    throw new ExternalFetchError({
      kind: 'unsafe_url',
      message: `Unsafe host for public web fetch: ${normalizedHost}`,
      url,
    });
  }

  // For hostname targets, guard against DNS rebinding/SSRF by resolving and
  // rejecting private/link-local/loopback addresses.
  if (isIP(normalizedHost) === 0) {
    let resolved: Array<{ address: string }>;
    try {
      resolved = await lookup(normalizedHost, { all: true, verbatim: true });
    } catch (err) {
      throw new ExternalFetchError({
        kind: 'network',
        message: `DNS lookup failed for ${normalizedHost}`,
        url,
        cause: err,
      });
    }
    if (!resolved.length) {
      throw new ExternalFetchError({
        kind: 'network',
        message: `DNS lookup returned no addresses for ${normalizedHost}`,
        url,
      });
    }
    for (const entry of resolved) {
      if (isUnsafePublicIp(entry.address)) {
        throw new ExternalFetchError({
          kind: 'unsafe_url',
          message: `Unsafe resolved address for public web fetch: ${entry.address}`,
          url,
        });
      }
    }
  }
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function fetchPublicWebWithValidatedRedirects(
  normalizedUrl: string,
  options: ExternalFetchOptions,
  headers: Headers,
  signal: AbortSignal | undefined,
): Promise<Response> {
  const maxRedirects = 5;
  let currentUrl = normalizedUrl;

  for (let hops = 0; hops <= maxRedirects; hops++) {
    await assertPublicWebHostSafety(currentUrl);

    const response = await fetch(currentUrl, {
      method: options.method,
      headers,
      body: options.body,
      redirect: 'manual',
      signal,
    });

    if (isRedirectStatus(response.status)) {
      const location = response.headers.get('location');
      if (!location) {
        throw new ExternalFetchError({
          kind: 'http',
          message: `HTTP ${response.status} from ${currentUrl} (missing redirect location)`,
          url: currentUrl,
          status: response.status,
          statusText: response.statusText,
        });
      }
      if (hops >= maxRedirects) {
        throw new ExternalFetchError({
          kind: 'http',
          message: `Too many redirects fetching ${normalizedUrl}`,
          url: currentUrl,
          status: response.status,
          statusText: response.statusText,
        });
      }
      currentUrl = normalizeExternalUrl(new URL(location, currentUrl).toString(), { safety: 'allow-private' });
      continue;
    }

    if (!response.ok) {
      let snippet = '';
      try {
        snippet = (await response.clone().text()).slice(0, 300);
      } catch (_err) {
        snippet = '';
      }
      throw new ExternalFetchError({
        kind: 'http',
        message: `HTTP ${response.status} from ${currentUrl}`,
        url: currentUrl,
        status: response.status,
        statusText: response.statusText,
        responseBodySnippet: snippet,
      });
    }

    return response;
  }

  throw new ExternalFetchError({
    kind: 'http',
    message: `Too many redirects fetching ${normalizedUrl}`,
    url: normalizedUrl,
  });
}

export async function fetchExternal(options: ExternalFetchOptions): Promise<Response> {
  const normalizedUrl = normalizeExternalUrl(options.url, { safety: options.urlSafety });
  const headers = buildHeaders(options);
  const { signal, cleanup } = composeTimeoutSignal(options.timeoutMs, options.signal);

  try {
    const response = options.urlSafety === 'public-web'
      ? await fetchPublicWebWithValidatedRedirects(normalizedUrl, options, headers, signal)
      : await fetch(normalizedUrl, {
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

export async function fetchExternalBytes(options: ExternalFetchOptions): Promise<Uint8Array> {
  const response = await fetchExternal(options);
  const data = await response.arrayBuffer();
  return new Uint8Array(data);
}

export async function fetchPublicWeb(options: ExternalFetchOptions): Promise<Response> {
  return fetchExternal({
    ...options,
    timeoutMs: options.timeoutMs ?? 10_000,
    redirect: options.redirect ?? 'follow',
    urlSafety: 'public-web',
  });
}

export async function fetchPublicWebText(options: ExternalFetchOptions): Promise<string> {
  const response = await fetchPublicWeb(options);
  return response.text();
}

export async function fetchProviderJson<T>(options: ExternalFetchOptions): Promise<T> {
  const response = await fetchExternal({
    ...options,
    timeoutMs: options.timeoutMs ?? 20_000,
    redirect: options.redirect ?? 'follow',
    urlSafety: options.urlSafety ?? 'allow-private',
  });
  return response.json() as Promise<T>;
}

export async function fetchProviderText(options: ExternalFetchOptions): Promise<string> {
  const response = await fetchExternal({
    ...options,
    timeoutMs: options.timeoutMs ?? 20_000,
    redirect: options.redirect ?? 'follow',
    urlSafety: options.urlSafety ?? 'allow-private',
  });
  return response.text();
}
