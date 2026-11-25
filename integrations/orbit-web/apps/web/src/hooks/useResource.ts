// Loads a resource, and loads it again on demand (and, optionally, every few seconds).
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, errorText } from "../services/api";

export interface Resource<T> {
  data: T | null;
  error: string | null;
  errorCode: string | null;
  loading: boolean;
  // When the data shown was read (ISO): what a page says as "Data as of".
  loadedAt: string | null;
  reload: () => Promise<void>;
  set: (value: T) => void;
}

export function useResource<T>(load: (() => Promise<T>) | null, deps: unknown[], pollMs?: number): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(load !== null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const loader = useRef(load);
  useEffect(() => {
    loader.current = load;
  });
  const fetchNow = useCallback(async () => {
    if (!loader.current) return;
    try {
      setData(await loader.current());
      setLoadedAt(new Date().toISOString());
      setError(null);
      setErrorCode(null);
    } catch (err) {
      setError(errorText(err));
      setErrorCode(err instanceof ApiError ? err.code : null);
    } finally {
      setLoading(false);
    }
  }, []);
  const reload = useCallback(async () => {
    setLoading(true);
    await fetchNow();
  }, [fetchNow]);
  const set = useCallback((value: T) => {
    setData(value);
    setError(null);
    setErrorCode(null);
    setLoadedAt(new Date().toISOString());
  }, []);
  useEffect(() => {
    loader.current = load;
    void fetchNow();
    if (!pollMs) return undefined;
    const timer = setInterval(() => void fetchNow(), pollMs);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller names what the load depends on
  }, deps);
  return { data, error, errorCode, loading, loadedAt, reload, set };
}
