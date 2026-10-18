import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// Poll a loader while the tab is visible; keep the last good value
// (and show its error) instead of flashing empty states.
export function usePoll<T>(load: () => Promise<T>, intervalMs: number, enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const loadRef = useRef(load);
  useLayoutEffect(() => {
    loadRef.current = load;
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const value = await loadRef.current();
      setData(value);
      setError(null);
      return value;
    } catch (e) {
      setError(e);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();

    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [enabled, intervalMs, refresh]);

  return { data, setData, error, loading, refresh };
}
