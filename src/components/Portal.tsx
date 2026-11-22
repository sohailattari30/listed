import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Renders children at the document root. Pages fade in with a CSS transform, which would
 * otherwise trap `position: fixed` modals inside the page (below the bottom nav).
 */
export function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}
