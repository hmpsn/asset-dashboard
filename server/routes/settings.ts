/**
 * settings routes — extracted from server/index.ts
 */
import { Router } from 'express';
import { getBookingUrl, setBookingUrl, clearBookingUrl } from '../studio-config.js';

const router = Router();

import { readEnvFile, writeEnvFile } from '../helpers.js';
import { isProgrammingError } from '../errors.js';
import { createLogger } from '../logger.js';


const log = createLogger('settings');
router.get('/api/settings', (_req, res) => {
  const vars = readEnvFile();
  res.json({
    webflowToken: vars.WEBFLOW_API_TOKEN ? '••••' + vars.WEBFLOW_API_TOKEN.slice(-4) : '',
    hasWebflowToken: !!vars.WEBFLOW_API_TOKEN,
    hasAnthropicKey: !!vars.ANTHROPIC_API_KEY,
  });
});

router.post('/api/settings/webflow-token', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token required' });

  const vars = readEnvFile();
  vars.WEBFLOW_API_TOKEN = token;
  writeEnvFile(vars);

  // Update runtime env
  process.env.WEBFLOW_API_TOKEN = token;

  res.json({ ok: true });
});

// ── Studio-level config ───────────────────────────────────────────────────────

router.get('/api/studio-config', (_req, res) => {
  res.json({ bookingUrl: getBookingUrl() ?? '' });
});

router.patch('/api/studio-config', (req, res) => {
  const { bookingUrl } = req.body as { bookingUrl?: string };
  if (bookingUrl === undefined) return res.status(400).json({ error: 'bookingUrl required' });
  if (bookingUrl === '') {
    clearBookingUrl();
  } else {
    // Basic URL validation — must be http(s)
    try { new URL(bookingUrl); } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'settings: PATCH /api/studio-config: programming error'); return res.status(400).json({ error: 'Invalid URL' }); }
    setBookingUrl(bookingUrl);
  }
  res.json({ ok: true, bookingUrl: bookingUrl || null });
});

export default router;
