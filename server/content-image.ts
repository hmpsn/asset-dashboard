/**
 * Content Image Generation — generates featured images for content posts
 * using DALL-E 3 and uploads them to Webflow via the existing asset pipeline.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { uploadAsset } from './webflow.js';
import { createLogger } from './logger.js';
import type { GeneratedPost } from '../shared/types/content.ts';

const log = createLogger('content-image');

interface ImageResult {
  success: boolean;
  assetId?: string;
  hostedUrl?: string;
  error?: string;
}

/**
 * Generate a featured image for a content post using DALL-E 3,
 * then upload it to Webflow as a site asset.
 */
export async function generateFeaturedImage(
  post: GeneratedPost,
  siteId: string,
  tokenOverride?: string,
): Promise<ImageResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { success: false, error: 'OPENAI_API_KEY not configured' };

  try {
    // Generate image via DALL-E 3
    const prompt = buildImagePrompt(post.title, post.targetKeyword);
    log.info(`Generating featured image for "${post.title}"`);

    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size: '1792x1024',
        quality: 'standard',
        response_format: 'url',
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { success: false, error: `DALL-E error ${res.status}: ${errText.slice(0, 200)}` };
    }

    const data = await res.json() as { data?: Array<{ url?: string }> };
    const imageUrl = data.data?.[0]?.url;
    if (!imageUrl) return { success: false, error: 'No image URL in DALL-E response' };

    // Download to temp file
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) return { success: false, error: 'Failed to download generated image' };
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    const tmpFile = path.join(os.tmpdir(), `featured-${Date.now()}.png`);
    fs.writeFileSync(tmpFile, buffer);

    // Upload to Webflow
    const slug = post.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
    const fileName = `${slug}-featured.png`;
    const altText = `Featured image for: ${post.title}`;

    let uploadResult: { success: boolean; assetId?: string; hostedUrl?: string; error?: string };
    try {
      uploadResult = await uploadAsset(siteId, tmpFile, fileName, altText, tokenOverride);
    } finally {
      // Clean up temp file regardless of success/failure
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }

    if (!uploadResult.success) {
      return { success: false, error: uploadResult.error || 'Asset upload failed' };
    }

    log.info(`Featured image uploaded: ${uploadResult.assetId}`);
    return {
      success: true,
      assetId: uploadResult.assetId,
      hostedUrl: uploadResult.hostedUrl,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function buildImagePrompt(title: string, keyword: string): string {
  return `Create a professional, modern blog header image for an article titled "${title}" about "${keyword}". The image should be:
- Clean, minimalist design with a professional color palette
- Abstract or conceptual (no text, no faces, no logos)
- Suitable as a hero/featured image for a business blog post
- High contrast, visually striking composition
- Modern and sophisticated aesthetic`;
}
