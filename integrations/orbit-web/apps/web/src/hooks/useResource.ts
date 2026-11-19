// Loads a resource, and loads it again on demand (and, optionally, every few seconds).
import { useCallback, useEffect, useRef, useState } from "react";
import { errorText } from "../services/api";

export interface Resource<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
  set: (value: T) => void;
}

export function useResource<T>(load: (() => Promise<T>) | null, deps: unknown[], pollMs?: number): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(load !== null);
  const loader = useRef(load);
  loader.current = load;
  const reload = useCallback(async () => {
    if (!loader.current) return;
    setLoading(true);
    try {
      setData(await loader.current());
      setError(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    setData(null);
    void reload();
    if (!pollMs) return undefined;
    const timer = setInterval(() => void reload(), pollMs);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading, reload, set: setData };
}
