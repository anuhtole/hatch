import type { CSSProperties } from 'react';
import { useLayout, NAV_WIDTH } from './layout-context';

/** Minimum visible content-area width before we fall back to full-viewport modal */
const MIN_CONTENT_WIDTH = 500;

const TRANSITION = '240ms cubic-bezier(0.4, 0, 0.2, 1)';

export interface ModalPositionResult {
  /** Apply to the fixed backdrop/overlay div — positions it over the content area only */
  overlayStyle: CSSProperties;
}

/**
 * Returns a `position: fixed` overlay style that covers the center content area
 * (between the left panel and right panel), so the modal is centered on the
 * visible chat area rather than the full viewport.
 *
 * Falls back to `inset: 0` (full viewport) if the visible area is too narrow.
 *
 * Accounts for: 72px nav sidebar + leftWidth (0 or 260) + rightWidth (0 or 320).
 */
export function useModalPosition(): ModalPositionResult {
  const { leftWidth, rightWidth } = useLayout();

  const left = NAV_WIDTH + leftWidth;
  const right = rightWidth;

  // Narrow fallback: if visible content width < 500px, use full viewport
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const visibleWidth = viewportWidth - left - right;
  const narrow = visibleWidth < MIN_CONTENT_WIDTH;

  if (narrow) {
    return {
      overlayStyle: {
        position: 'fixed',
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        transition: `left ${TRANSITION}, right ${TRANSITION}`,
      },
    };
  }

  return {
    overlayStyle: {
      position: 'fixed',
      top: 0,
      bottom: 0,
      left,
      right,
      transition: `left ${TRANSITION}, right ${TRANSITION}`,
    },
  };
}
