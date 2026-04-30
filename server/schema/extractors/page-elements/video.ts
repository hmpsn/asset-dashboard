/**
 * Video element extractor. Detects YouTube + Vimeo + native <video>.
 * Other iframe providers are skipped (we don't synthesize VideoObject
 * schema for unknown providers — too high false-positive rate).
 *
 * Per audit §2.1 — convention: inline `cheerio.load`, fail-soft (return
 * empty array on missing matches).
 */
import type * as cheerio from 'cheerio';
import type { Video } from '../../../../shared/types/page-elements.js';
import { contentScope } from './content-scope.js';

const YOUTUBE_RE = /(?:youtube\.com\/embed\/|youtu\.be\/|youtube\.com\/watch\?v=)([\w-]{11})/i;
const VIMEO_RE = /vimeo\.com\/(?:video\/)?(\d+)/i;

export function extractVideos($: cheerio.CheerioAPI): Video[] {
  const $scope = contentScope($);
  const videos: Video[] = [];

  // iframe-based: YouTube + Vimeo
  $scope.find('iframe[src]').each((_, el) => {
    const $el = $(el);
    const src = $el.attr('src') ?? '';
    const title = $el.attr('title') ?? undefined;

    const yt = src.match(YOUTUBE_RE);
    if (yt) {
      videos.push({
        provider: 'youtube',
        embedUrl: src,
        thumbnailUrl: `https://img.youtube.com/vi/${yt[1]}/maxresdefault.jpg`,
        title,
      });
      return;
    }

    const vm = src.match(VIMEO_RE);
    if (vm) {
      videos.push({
        provider: 'vimeo',
        embedUrl: src,
        title,
      });
      return;
    }

    // Unknown providers — skip (don't emit VideoObject without enough metadata)
  });

  // Native <video>
  $scope.find('video').each((_, el) => {
    const $el = $(el);
    // <video src="..."> OR <video><source src="..."></video>
    const src = $el.attr('src') ?? $el.find('source[src]').first().attr('src');
    if (!src) return;
    const poster = $el.attr('poster') ?? undefined;
    const title = $el.attr('title') ?? undefined;
    videos.push({
      provider: 'native',
      embedUrl: src,
      thumbnailUrl: poster,
      title,
    });
  });

  return videos;
}
