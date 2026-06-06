import { useLayoutEffect, type RefObject } from 'react';

/**
 * Locks background scroll while a modal/drawer is open, then restores it on
 * close/unmount.
 *
 * Why this is more than `document.body.style.overflow = 'hidden'`: the app has
 * two scroll models. The client portal scrolls the document (`<body>` /
 * `min-h-screen` shell), while the admin shell scrolls an inner `<main>` — its
 * root is `flex h-screen`, so `<body>` itself never scrolls. Locking only
 * `<body>` would leave the admin page scrollable *behind* an open drawer (you
 * can scroll past the content into empty space). So we lock `documentElement`,
 * `body`, AND the nearest `<main>` ancestor of the drawer — covering both
 * shells. Locking an element that wasn't scrolling is harmless.
 *
 * Pass a ref to any node inside the drawer; even a `position: fixed` drawer
 * stays in the DOM tree under `<main>`, so `closest('main')` resolves the real
 * scroll container.
 */
export function useScrollLock(active: boolean, ref?: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    if (!active || typeof document === 'undefined') return;

    const targets: HTMLElement[] = [document.documentElement, document.body];
    const main = ref?.current?.closest('main');
    if (main instanceof HTMLElement && !targets.includes(main)) targets.push(main);

    const previous = targets.map(el => ({ overflow: el.style.overflow, paddingRight: el.style.paddingRight }));
    for (const el of targets) {
      // Reserve the removed scrollbar's width as padding so the content behind
      // the drawer doesn't jump sideways when its scrollbar disappears. Measured
      // per element (only the actual scroll container shows a scrollbar), and a
      // no-op where there's none. The custom 6px webkit scrollbar (index.css)
      // makes this visible even on macOS, not just classic-scrollbar platforms.
      const scrollbarWidth = el.offsetWidth - el.clientWidth;
      el.style.overflow = 'hidden';
      if (scrollbarWidth > 0) {
        const current = parseFloat(getComputedStyle(el).paddingRight) || 0;
        el.style.paddingRight = `${current + scrollbarWidth}px`;
      }
    }

    return () => {
      targets.forEach((el, index) => {
        el.style.overflow = previous[index].overflow;
        el.style.paddingRight = previous[index].paddingRight;
      });
    };
  }, [active, ref]);
}
