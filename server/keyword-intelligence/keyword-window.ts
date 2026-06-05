/**
 * GSC metric-window constants for the keyword surfaces.
 *
 * The single source of truth now lives in `shared/keyword-window.ts` so the
 * client can import the same values (the server module cannot be imported by
 * the client). This module re-exports them for back-compat with existing
 * server-side importers.
 */
export { GSC_METRIC_WINDOW_DAYS, GSC_DATA_LAG_DAYS } from '../../shared/keyword-window.js';
