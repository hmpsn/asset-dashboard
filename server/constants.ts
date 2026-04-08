/**
 * Studio / agency name used in server-side copy (emails, exports, etc.).
 * SYNC: Must match src/constants.ts — pr-check validates they're identical.
 * Future: make per-workspace for agency resale (ws.studioName || STUDIO_NAME).
 */
export const STUDIO_NAME = 'hmpsn studio';
export const STUDIO_URL = 'https://hmpsn.studio';
export const STUDIO_BOT_UA = `Mozilla/5.0 (compatible; HmpsnStudioBot/1.0; +${STUDIO_URL})`;
