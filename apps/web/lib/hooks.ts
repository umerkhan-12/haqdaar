'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { getSession, type Session } from './session';

function subscribe(cb: () => void) {
  window.addEventListener('hq:session', cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener('hq:session', cb);
    window.removeEventListener('storage', cb);
  };
}

let cached: { raw: string | null; value: Session | null } = { raw: null, value: null };
function snapshot(): Session | null {
  const raw = localStorage.getItem('hq.session');
  if (raw !== cached.raw) cached = { raw, value: getSession() };
  return cached.value;
}

/** Current session; `undefined` during server render / before hydration. */
export function useSession(): Session | null | undefined {
  return useSyncExternalStore(subscribe, snapshot, () => undefined);
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb);
      window.addEventListener('offline', cb);
      return () => {
        window.removeEventListener('online', cb);
        window.removeEventListener('offline', cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

export interface AsyncState<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

/** Load data for a screen; `deps` change → reload. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean }>({
    loading: true,
  });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    fn().then(
      (data) => alive && setState({ data, loading: false }),
      (error) => alive && setState({ error, loading: false }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);

  return { data: state.data, error: state.error, loading: state.loading, reload };
}
