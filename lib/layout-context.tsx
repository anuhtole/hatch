'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';

export const NAV_WIDTH = 72;    // fixed left nav sidebar
export const LEFT_WIDTH = 260;  // collapsible left panel
export const RIGHT_WIDTH = 320; // collapsible right panel

interface LayoutContextValue {
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  setLeftCollapsed: (v: boolean | ((prev: boolean) => boolean)) => void;
  setRightCollapsed: (v: boolean | ((prev: boolean) => boolean)) => void;
  /** Current pixel width of left panel (0 or LEFT_WIDTH) */
  leftWidth: number;
  /** Current pixel width of right panel (0 or RIGHT_WIDTH) */
  rightWidth: number;
}

const LayoutContext = createContext<LayoutContextValue | null>(null);

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [leftCollapsed, setLeftCollapsedRaw] = useState(false);
  const [rightCollapsed, setRightCollapsedRaw] = useState(false);

  // Restore from localStorage after mount (avoids SSR hydration mismatch)
  useEffect(() => {
    setLeftCollapsedRaw(localStorage.getItem('hatch-left-collapsed') === 'true');
    setRightCollapsedRaw(localStorage.getItem('hatch-right-collapsed') === 'true');
  }, []);

  const setLeftCollapsed = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      setLeftCollapsedRaw((prev) => {
        const next = typeof v === 'function' ? v(prev) : v;
        localStorage.setItem('hatch-left-collapsed', String(next));
        return next;
      });
    },
    [],
  );

  const setRightCollapsed = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      setRightCollapsedRaw((prev) => {
        const next = typeof v === 'function' ? v(prev) : v;
        localStorage.setItem('hatch-right-collapsed', String(next));
        return next;
      });
    },
    [],
  );

  // Global keyboard shortcuts: Cmd+[ / Cmd+]
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === '[') {
        e.preventDefault();
        setLeftCollapsed((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ']') {
        e.preventDefault();
        setRightCollapsed((v) => !v);
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setLeftCollapsed, setRightCollapsed]);

  return (
    <LayoutContext.Provider
      value={{
        leftCollapsed,
        rightCollapsed,
        setLeftCollapsed,
        setRightCollapsed,
        leftWidth: leftCollapsed ? 0 : LEFT_WIDTH,
        rightWidth: rightCollapsed ? 0 : RIGHT_WIDTH,
      }}
    >
      {children}
    </LayoutContext.Provider>
  );
}

export function useLayout(): LayoutContextValue {
  const ctx = useContext(LayoutContext);
  if (!ctx) throw new Error('useLayout must be used within <LayoutProvider>');
  return ctx;
}
