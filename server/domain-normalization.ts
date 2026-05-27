export interface NormalizeDomainOptions {
  stripWww?: boolean;
  lowercase?: boolean;
  stripPort?: boolean;
  trimTrailingDot?: boolean;
  allowMalformedFallback?: boolean;
}

const DEFAULT_OPTIONS: Required<NormalizeDomainOptions> = {
  stripWww: true,
  lowercase: true,
  stripPort: true,
  trimTrailingDot: true,
  allowMalformedFallback: true,
};

function applyDomainOptions(host: string, options: Required<NormalizeDomainOptions>): string {
  let next = host.trim();
  if (options.stripPort) next = next.replace(/:\d+$/, '');
  if (options.trimTrailingDot) next = next.replace(/\.$/, '');
  if (options.stripWww) next = next.replace(/^www\./i, '');
  if (options.lowercase) next = next.toLowerCase();
  return next;
}

function parseDomainFallback(input: string): string {
  // Best-effort cleanup for malformed URL-like values.
  return input
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/[?#].*$/, '');
}

function extractRawHostFromInput(input: string): string {
  return input
    .replace(/^[a-z]+:\/\//i, '')
    .split('/')[0]
    .split('?')[0]
    .split('#')[0];
}

export function normalizeDomainHost(
  host: string,
  options: NormalizeDomainOptions = {},
): string {
  const normalized = applyDomainOptions(host, { ...DEFAULT_OPTIONS, ...options });
  return normalized;
}

export function normalizeDomainValue(
  value: string | null | undefined,
  options: NormalizeDomainOptions = {},
): string | undefined {
  if (!value) return undefined;
  const opts: Required<NormalizeDomainOptions> = { ...DEFAULT_OPTIONS, ...options };
  const input = value.trim();
  if (!input) return undefined;

  try {
    const parsed = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    const parsedHost = opts.stripPort ? parsed.hostname : parsed.host;
    const host = opts.lowercase ? parsedHost : (extractRawHostFromInput(input) || parsedHost);
    const normalized = applyDomainOptions(host, opts);
    return normalized || undefined;
  } catch (err) {
    void err;
    if (!opts.allowMalformedFallback) return undefined;
    const fallback = parseDomainFallback(input);
    const normalized = applyDomainOptions(fallback, opts);
    return normalized || undefined;
  }
}
