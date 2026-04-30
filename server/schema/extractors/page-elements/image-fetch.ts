/**
 * Fetches a remote image URL and returns a `data:<mime>;base64,...` URL
 * suitable for OpenAI vision message content (`{ type: 'image_url',
 * image_url: { url: <data-url> } }`).
 *
 * Contract: never throws. Returns null on any failure (network, timeout,
 * non-2xx response, unsupported content-type). Callers fall through to
 * rule-based classification when null is returned.
 *
 * Used by image-ai-classifier.ts (PR2). Future: alttext.ts could be
 * refactored to use this once it migrates from raw openai SDK to callAI.
 */
import { createLogger } from '../../../logger.js';

const log = createLogger('schema/extractors/image-fetch');

const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const DEFAULT_TIMEOUT_MS = 5000;

export interface FetchImageOpts {
  /** Abort fetch after this many ms. Default 5000. */
  timeoutMs?: number;
}

export async function fetchImageAsBase64(
  url: string,
  opts: FetchImageOpts = {},
): Promise<string | null> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { signal: controller.signal });
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
  } catch (err) { // catch-ok: fetch may throw for DNS/ECONNREFUSED/AbortError — degrade gracefully
    log.debug({ err, url }, 'image fetch failed; returning null');
    return null;
  } finally {
    clearTimeout(timer);
  }
}
