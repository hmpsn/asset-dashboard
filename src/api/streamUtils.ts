/**
 * Low-level NDJSON stream reader helper.
 * Accepts a ReadableStream and fires an onEvent callback per parsed message.
 * Caller handles fetch, error handling, and abort — this helper only owns the
 * line-splitting and JSON-parsing loop.
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
