import { initEmailQueue } from './email.js';
import { clearTestModeCustomerIds } from './stripe.js';
import { startAllRegisteredCrons } from './cron-registry.js';
import { runStartupModelCurrencyCheck } from './model-currency.js';

/** Start all background schedulers and queues.
 *
 * Recurring schedulers are started generically via the cron registry
 * (server/cron-registry.ts) — see CRON_METADATA there for the full list.
 * `initEmailQueue`, `clearTestModeCustomerIds`, and
 * `runStartupModelCurrencyCheck` are NOT recurring crons (one-time queue init
 * and one-shot startup checks, respectively) and stay hand-called here rather
 * than in the registry. */
let started = false;

export function startSchedulers() {
  if (started) return;
  started = true;
  initEmailQueue();
  clearTestModeCustomerIds();
  startAllRegisteredCrons();
  // Non-blocking: alerts (Sentry + error log) if any manifest model ID has
  // been retired by its provider; never delays or fails boot.
  runStartupModelCurrencyCheck();
}
