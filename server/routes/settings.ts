/**
 * settings routes — extracted from server/index.ts
 */
import { Router } from 'express';

const router = Router();

import { readEnvFile, writeEnvFile } from '../helpers.js';

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

export default router;
