// ── Base API client ────────────────────────────────────────────────
// Centralizes fetch calls with typed helpers, consistent error handling,
// and automatic Content-Type headers.

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let body: unknown;
    try { body = await res.json(); } catch { /* non-JSON error body */ }
    const msg = (body && typeof body === 'object' && 'error' in body)
      ? String((body as { error: unknown }).error)
      : res.statusText || `HTTP ${res.status}`;
    throw new ApiError(res.status, msg, body);
  }
  // 204 No Content — nothing to parse
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

/** GET with JSON parsing */
export async function get<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  return handleResponse<T>(res);
}

/** POST with JSON body */
export async function post<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });
  return handleResponse<T>(res);
}

/** PATCH with JSON body */
export async function patch<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
    signal,
  });
  return handleResponse<T>(res);
}

/** PUT with JSON body */
export async function put<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
    signal,
  });
  return handleResponse<T>(res);
}

/** DELETE (with optional JSON body) */
export async function del<T = void>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: 'DELETE',
    ...(body !== undefined ? { headers: JSON_HEADERS, body: JSON.stringify(body) } : {}),
    signal,
  });
  return handleResponse<T>(res);
}

/** POST with FormData (file uploads — no Content-Type header, browser sets boundary) */
export async function postForm<T>(url: string, formData: FormData, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { method: 'POST', body: formData, signal });
  return handleResponse<T>(res);
}

/**
 * GET that returns `null` on non-ok responses instead of throwing.
 * Useful for optional data where a 404 is expected.
 */
export async function getOptional<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  return res.json() as Promise<T>;
}

/**
 * GET that returns a fallback value on failure (network error or non-ok).
 * Useful in Promise.all where partial failures are acceptable.
 */
export async function getSafe<T>(url: string, fallback: T, signal?: AbortSignal): Promise<T> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return fallback;
    return await res.json() as T;
  } catch {
    return fallback;
  }
}
