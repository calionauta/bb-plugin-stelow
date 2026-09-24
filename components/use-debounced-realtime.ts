import { useCallback, useEffect, useRef } from "react";
import { useRealtime } from "@get-bb/plugin-sdk/app";

const DEFAULT_DEBOUNCE_MS = 250;

export function useDebouncedRealtime(channels: readonly string[], handler: () => void, delayMs = DEFAULT_DEBOUNCE_MS) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);
  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      handlerRef.current();
    }, delayMs);
  }, [delayMs]);
  for (const channel of channels) useRealtime(channel, schedule);
}
