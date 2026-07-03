// Phase 1 placeholder barrel — Phase 1 agents fill file contents, never edit this barrel
export { Modal } from './Modal';
export { Popover } from './Popover';
export { Tooltip } from './Tooltip';

// F3 — net-new overlay primitive + shared machinery
export { Drawer } from './Drawer';
export type { DrawerProps } from './Drawer';
export {
  FOCUSABLE_SELECTOR,
  getFocusable,
  acquireScrollLock,
  releaseScrollLock,
} from './overlayUtils';
