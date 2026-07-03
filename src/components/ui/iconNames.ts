/**
 * The icon registry — semantic name → Font Awesome (Sharp Regular) glyph.
 * Ported verbatim from the design-system kit (which lifted it from the product's
 * icon set) so the design system and the app speak the same icon names. Add new
 * glyphs here; never hard-code fa-classes at call sites — go through <Icon>.
 *
 * Font Awesome Sharp Regular (Pro 7) is the icon system of record (Phase D
 * decision D5, reversed 2026-07-03 from lucide-react). lucide-react remains a
 * supported <Icon as={…}> path during the incremental migration.
 */
export const ICON_NAMES = {
  home: 'house', traffic: 'arrow-trend-up', trophy: 'trophy', star: 'star',
  globe: 'globe', gauge: 'gauge', link: 'link', image: 'image', key: 'key',
  pin: 'location-dot', clipboard: 'clipboard', message: 'comment', chart: 'chart-pie',
  pencil: 'pencil', sparkle: 'sparkles', settings: 'gear', admin: 'user-gear',
  target: 'bullseye', chevronsLeft: 'angle-left', arrowUp: 'arrow-up',
  chevronDown: 'angle-down', chevronUp: 'angle-up', arrowDown: 'arrow-down',
  arrowRight: 'arrow-right', arrowLeft: 'arrow-left', minus: 'minus', check: 'check',
  x: 'xmark', plus: 'plus', copy: 'copy', trash: 'trash-can', search: 'magnifying-glass',
  filter: 'filter', layers: 'layer-group', file: 'file', doc: 'file-lines',
  download: 'download', send: 'paper-plane', eye: 'eye', eyeOff: 'eye-slash',
  bell: 'bell', zap: 'bolt', clock: 'clock', refresh: 'rotate',
  alert: 'triangle-exclamation', user: 'user', grip: 'up-down-left-right',
  info: 'circle-info', external: 'arrow-up-right-from-square', sitemap: 'sitemap',
  lightbulb: 'lightbulb', swords: 'users',
} as const;

export type IconName = keyof typeof ICON_NAMES;
