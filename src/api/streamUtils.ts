/**
 * Low-level stream reader helpers for NDJSON and SSE response bodies.
 * Both helpers accept a ReadableStream and fire an onEvent callback per parsed
 * message. Caller handles fetch, error handling, and abort — these helpers only
 * own the line-splitting and JSON-parsing loop.
 */

/**
 * Read an NDJSON stream line-by-line, parsing each non-empty line as JSON.
 * Flushes any trailing incomplete line after the stream closes.
 */
export async function readNdjsonStream<T>(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: T) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        onEvent(JSON.parse(line) as T);
      } catch (err) {
        console.error('readNdjsonStream parse failed:', err);
      }
    }
  }

  // Flush any multi-byte UTF-8 sequence the decoder held across the last chunk.
  buffer += decoder.decode();
  if (buffer.trim()) {
    try { onEvent(JSON.parse(buffer) as T); } catch { /* ignore malformed trailing fragment */ }
  }
}

/**
 * Read an SSE stream, parsing `data: <json>` lines as JSON.
 * Lines without the `data: ` prefix (comments, event:, id:) are skipped.
 */
export async function readSseStream<T>(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: T) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        onEvent(JSON.parse(line.slice(6)) as T);
      } catch (err) {
        console.error('readSseStream parse failed:', err);
      }
    }
  }
  decoder.decode(); // flush any held multi-byte sequence (SSE frames end with \n\n so buffer is always empty)
}
