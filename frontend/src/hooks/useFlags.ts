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

export function useFlags(): UseFlagsReturn {
  const [count, setCount] = useState<FlagCount>(DEFAULT_COUNT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await flagsApi.getCount();
      setCount(data);
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
