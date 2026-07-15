const SERVER_REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Only server-generated UUID v4 request IDs may cross into logs, response
 * headers, traces, or durable activity metadata. Caller X-Request-ID values are
 * deliberately ignored because no finite credential denylist can prove that
 * arbitrary caller text is safe to retain.
 */
export function isServerRequestId(value: unknown): value is string {
  return typeof value === 'string' && SERVER_REQUEST_ID_PATTERN.test(value);
}
