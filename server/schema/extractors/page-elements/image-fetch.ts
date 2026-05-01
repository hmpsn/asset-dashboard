/**
 * Fetches a remote image URL and returns a `data:<mime>;base64,...` URL
 * suitable for OpenAI vision message content (`{ type: 'image_url',
 * image_url: { url: <data-url> } }`).
 *
 * Contract: never throws. Returns null on any failure (network, timeout,
 * non-2xx response, unsupported content-type, blocked SSRF target).
 *
 * SSRF defense: only http(s) URLs are accepted; redirects are rejected
 * (`redirect: 'error'`); hostnames that resolve (or look like) loopback,
 * link-local, or RFC1918 private ranges are blocked. The image URL comes
 * from extracted page HTML, which is attacker-controlled, so SSRF is a
 * real risk — an attacker-published page could embed a `<img src>` that
 * makes our server probe internal AWS metadata, Redis, etc.
 *
 * Used by image-ai-classifier.ts (PR2).
 */
import { createLogger } from '../../../logger.js';

const log = createLogger('schema/extractors/image-fetch');

const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Returns true when the literal hostname looks like a private/loopback
 * address that our server should not fetch. This is a string-only
 * pre-check; a full DNS-resolution + private-range check would be
 * stronger (e.g. via dns.lookup + ip-cidr matching) but adds latency
 * and is overkill while the AI-image-classifier feature flag stays off
 * by default. Re-evaluate when the flag flips on for production.
 */
function isPrivateOrLoopbackHost(hostname: string): boolean {
  // WHATWG URL preserves brackets around IPv6 (`new URL('http://[::1]/').hostname`
  // returns `'[::1]'`). Strip them so the IPv6 prefix checks match.
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === 'ip6-localhost' || h.endsWith('.localhost')) return true;
  if (h === '0.0.0.0' || h === '::' || h === '::1') return true;
  if (h === '169.254.169.254') return true; // AWS / GCP / Azure IMDS
  if (h.startsWith('127.')) return true;     // 127.0.0.0/8
  if (h.startsWith('10.')) return true;      // 10.0.0.0/8
  if (h.startsWith('192.168.')) return true; // 192.168.0.0/16
  if (h.startsWith('169.254.')) return true; // link-local
  // 172.16.0.0 — 172.31.255.255
  const m172 = h.match(/^172\.(\d+)\./);
  if (m172) {
    const second = parseInt(m172[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  // IPv6 unique-local / link-local. The `fd` check requires a colon to avoid
  // false-blocking public domains like `fdic.gov`, `fd.io`, etc.
  if (h.startsWith('fe80:') || h.startsWith('fc00:')) return true;
  if (h.startsWith('fd') && h.includes(':')) return true;
  return false;
}

export interface FetchImageOpts {
  /** Abort fetch after this many ms. Default 5000. */
  timeoutMs?: number;
}

export async function fetchImageAsBase64(
  url: string,
  opts: FetchImageOpts = {},
): Promise<string | null> {
  // SSRF pre-checks — bail before issuing any network request.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch { // catch-ok: malformed URL — treat as null
    log.debug({ url }, 'image fetch: malformed URL');
    return null;
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    log.debug({ url, protocol: parsed.protocol }, 'image fetch: blocked non-http(s) protocol');
    return null;
  }
  if (isPrivateOrLoopbackHost(parsed.hostname)) {
    log.warn({ url, hostname: parsed.hostname }, 'image fetch: blocked private/loopback host (SSRF defense)');
    return null;
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // redirect: 'error' prevents an attacker-controlled page from issuing
    // a 302 redirect to an internal host that bypasses our hostname check.
    const res = await fetch(url, { signal: controller.signal, redirect: 'error' });
    if (!res.ok) {
      log.debug({ url, status: res.status }, 'image fetch returned non-2xx');
      return null;
    }
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      log.debug({ url, contentType }, 'image fetch returned unsupported content-type');
      return null;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const base64 = Buffer.from(bytes).toString('base64');
    return `data:${contentType};base64,${base64}`;
  } catch (err) { // catch-ok: fetch may throw for DNS/ECONNREFUSED/AbortError/redirect-blocked — degrade gracefully
    log.debug({ err, url }, 'image fetch failed; returning null');
    return null;
  } finally {
    clearTimeout(timer);
  }
}
