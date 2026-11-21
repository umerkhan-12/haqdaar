'use client';

import { useEffect } from 'react';

/**
 * Shared phones: after logout (or a switch to another account) a swipe-back must never show the last
 * person's screen. Browsers keep a frozen copy of the previous page and show it instantly on "back";
 * when that happens we hide it before it paints and load the page fresh, so only data the current
 * session is allowed to see can appear.
 */
export function HistoryGuard() {
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      document.documentElement.style.visibility = 'hidden';
      window.location.reload();
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);
  return null;
}

/** Leave the current account: blank the screen first so the frozen copy the browser keeps is empty. */
export function leaveTo(path: string): void {
  document.documentElement.style.visibility = 'hidden';
  window.location.replace(path);
}
