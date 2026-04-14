import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { createLogger } from './logger.js';
import type { default as SharpConstructor } from 'sharp';
import { isProgrammingError } from './errors.js';

const log = createLogger('alt-text');

let client: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

// --- Rate limit handling ---
const MIN_DELAY_MS = 500; // GPT-4o mini has generous rate limits
let lastRequestTime = 0;

async function throttle(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  const wait = MIN_DELAY_MS - elapsed;
  if (wait > 0) {
    await new Promise(r => setTimeout(r, wait));
  }
  lastRequestTime = Date.now();
}

async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await throttle();
      return await fn();
    } catch (err: unknown) {
      const status = err instanceof Error && 'status' in err ? (err as { status: number }).status : 0;
      const errMsg = err instanceof Error ? err.message : String(err);

      // Quota exceeded — never retryable
      if (status === 429 && errMsg.includes('insufficient_quota')) {
        log.error('OpenAI quota exceeded — add credits at platform.openai.com/account/billing');
        throw err;
      }

      if (status !== 429 || attempt === maxRetries) throw err;

      const backoffMs = Math.min(60000, 5000 * Math.pow(2, attempt));
      log.info(`Rate limited (429). Retrying in ${Math.round(backoffMs / 1000)}s (attempt ${attempt + 1}/${maxRetries})...`);
      await new Promise(r => setTimeout(r, backoffMs));
    }
  }
  throw new Error('Max retries exceeded');
}

// Use sharp for cross-platform image conversion (works on Linux/Render + handles AVIF/HEIC)
async function prepareImageForApi(filePath: string): Promise<string> {
  const sharp: typeof SharpConstructor = (await import('sharp')).default; // dynamic-import-ok
  const tmp = `/tmp/alttext_small_${Date.now()}.jpg`;
  await sharp(filePath)
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 70 })
    .toFile(tmp);
  return tmp;
}

function buildPrompt(context?: string): string {
  let prompt = 'Write a concise alt text (one sentence, under 125 characters) for this image used on a website. Be descriptive and specific. Do not start with "Image of" or "An image of". Just output the alt text, nothing else.';
  if (context) {
    prompt += `\n\nContext about where this image is used:\n${context}`;
    prompt += '\nUse this context to write more specific, relevant alt text that describes what this image represents in its actual usage.';
  }
  return prompt;
}

export async function generateAltText(filePath: string, context?: string): Promise<string | null> {
  const openai = getClient();
  if (!openai) return null;

  const ext = path.extname(filePath).slice(1).toLowerCase();

  // SVGs: read as text and describe
  if (ext === 'svg') {
    let svgContent = fs.readFileSync(filePath, 'utf-8');
    // Strip verbose path/polygon data to reduce token count — keep structure and text elements
    svgContent = svgContent.replace(/\bd="[^"]{200,}"/g, 'd="..."');
    svgContent = svgContent.replace(/\bpoints="[^"]{200,}"/g, 'points="..."');
    // Truncate if still too large (keep under ~50K chars ≈ ~12K tokens)
    if (svgContent.length > 50000) {
      svgContent = svgContent.slice(0, 50000) + '\n<!-- truncated -->';
    }
    let svgPrompt = `Write a concise alt text (one sentence, under 125 characters) for this SVG image used on a website. Be descriptive and specific. Do not start with "Image of" or "An image of". Just output the alt text, nothing else.\n\n${svgContent}`;
    if (context) svgPrompt += `\n\nContext: ${context}`;
    const response = await callWithRetry(() => openai.chat.completions.create({
      model: 'gpt-4.1-nano',
      max_tokens: 150,
      messages: [{ role: 'user', content: svgPrompt }],
    }));
    return response.choices[0]?.message?.content?.trim() || null;
  }

  // Downsize image to 512px max and convert to JPEG for API efficiency
  // Uses sharp which supports AVIF, HEIC, WebP, PNG, etc. on all platforms
  let tmpFile: string | null = null;
  try {
    tmpFile = await prepareImageForApi(filePath);
  } catch (err) {
    log.error({ err: err }, `Failed to prepare image for alt text:`);
    return null;
  }

  try {
    const data = fs.readFileSync(tmpFile);
    const base64 = data.toString('base64');
    const mimeType = 'image/jpeg' as const;

    const response = await callWithRetry(() => openai.chat.completions.create({
      model: 'gpt-4.1-nano',
      max_tokens: 150,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64}`,
              detail: 'low',
            },
          },
          { type: 'text', text: buildPrompt(context) },
        ],
      }],
    }));

    return response.choices[0]?.message?.content?.trim() || null;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'alttext: programming error'); /* ignore */ }
  }
}
