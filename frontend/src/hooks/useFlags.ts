import { useState, useEffect, useCallback, useRef } from 'react';
import { flagsApi } from '../api/flags';

interface FlagCount {
  total: number;
  critical: number;
  warning: number;
  info: number;
}

interface UseFlagsReturn {
  count: FlagCount;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const DEFAULT_COUNT: FlagCount = { total: 0, critical: 0, warning: 0, info: 0 };
const REFRESH_INTERVAL_MS = 30_000;

/**
 * UC-008 E2 (Chad) — push-notification fallback: when new CRITICAL flags
 * appear and the exceptions panel may not be open, fire a browser
 * notification so the admin still sees them. Permission is requested once,
 * lazily, the first time a critical flag is observed.
 */
function notifyCriticalFlags(newCritical: number): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;

  const fire = () => {
    try {
      new Notification('EFAR — critical scheduling flags', {
        body: `${newCritical} new critical flag(s) need attention in the Exceptions panel.`,
        tag: 'efar-critical-flags', // collapse repeats into one notification
      });
    } catch {
      /* notification blocked mid-flight — the dashboard badge still shows the count */
    }
  };

  if (Notification.permission === 'granted') fire();
  else if (Notification.permission === 'default') {
    Notification.requestPermission().then((p) => {
      if (p === 'granted') fire();
    });
  }
}

export function useFlags(): UseFlagsReturn {
  const [count, setCount] = useState<FlagCount>(DEFAULT_COUNT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevCriticalRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await flagsApi.getCount();
      setCount(data);
      // Fallback push when criticals INCREASE (skip the very first load so a
      // page refresh doesn't re-notify about flags the admin already saw).
      const prev = prevCriticalRef.current;
      if (prev != null && data.critical > prev) {
        notifyCriticalFlags(data.critical - prev);
      }
      prevCriticalRef.current = data.critical;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load flag count';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();

    intervalRef.current = setInterval(refresh, REFRESH_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refresh]);

  return { count, loading, error, refresh };
}
