/** Returns true if the current environment prefers reduced motion.
 *  Queried synchronously at render time — cheap, and the fallback in SSR is
 *  "no motion preference detected" which is the motion-safe default. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
