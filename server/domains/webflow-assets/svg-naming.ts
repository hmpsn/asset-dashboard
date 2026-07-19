/**
 * SVG-aware asset renaming.
 *
 * SVGs are XML, not raster pixels — a vision model can't "see" them. Their
 * <title>/<desc>/<text>/aria-label and structure describe what they are, so to name
 * an SVG well we feed its SOURCE to the model rather than skipping to a filename-only
 * guess (which produced generic names for generically-named SVGs). Used by
 * /api/smart-name in routes/misc.ts.
 */

/**
 * Minimal structural type for the OpenAI chat client — keeps this trivially mockable.
 * `create` uses method syntax (bivariant params) so the real, more-strictly-typed
 * OpenAI client is assignable to it under strictFunctionTypes.
 */
export interface ChatCompletionClient {
  chat: {
    completions: {
      create(args: unknown): Promise<{ choices: Array<{ message?: { content?: string | null } }> }>;
    };
  };
}

/**
 * Suggest an SEO filename slug for an SVG by reading its source markup.
 *
 * Returns null on a failed fetch or an empty completion so the caller can fall back
 * to filename-only naming.
 */
export async function suggestSvgFilename(
  client: ChatCompletionClient,
  imageUrl: string,
  promptText: string,
): Promise<string | null> {
  const res = await fetch(imageUrl);
  if (!res.ok) return null;

  let svgText = await res.text();
  // Strip verbose path/polygon data to save tokens — keep structure + text elements.
  svgText = svgText
    .replace(/\bd="[^"]{200,}"/g, 'd="..."')
    .replace(/\bpoints="[^"]{200,}"/g, 'points="..."');
  if (svgText.length > 20000) svgText = svgText.slice(0, 20000) + '\n<!-- truncated -->';

  const completion = await client.chat.completions.create({
    model: 'gpt-5.4-nano',
    max_completion_tokens: 60,
    messages: [{ role: 'user', content: `${promptText}\n\nSVG source:\n${svgText}` }],
  });
  return completion.choices[0]?.message?.content?.trim() || null;
}
