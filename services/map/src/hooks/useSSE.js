import { useState, useEffect, useRef, useCallback } from "react";

const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_DELAY_MS = 30000;

/**
 * Custom hook for consuming a Server-Sent Events endpoint.
 *
 * @param {string} url - The SSE endpoint URL.
 * @returns {{ events: Array, connected: boolean, error: string|null }}
 */
export function useSSE(url) {
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);

  const esRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectDelayRef = useRef(RECONNECT_DELAY_MS);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    // Clean up any existing connection
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => {
      if (!mountedRef.current) return;
      setConnected(true);
      setError(null);
      reconnectDelayRef.current = RECONNECT_DELAY_MS;
      console.log("[useSSE] Connected to", url);
    };

    es.onmessage = (evt) => {
      if (!mountedRef.current) return;
      try {
        const data = JSON.parse(evt.data);
        setEvents((prev) => [data, ...prev].slice(0, 200)); // keep last 200 events in memory
      } catch (e) {
        console.warn("[useSSE] Failed to parse event data:", evt.data);
      }
    };

    es.onerror = (evt) => {
      if (!mountedRef.current) return;
      setConnected(false);
      setError("SSE connection lost. Reconnecting...");
      console.warn("[useSSE] Connection error, will reconnect in", reconnectDelayRef.current, "ms");

      es.close();
      esRef.current = null;

      reconnectTimerRef.current = setTimeout(() => {
        reconnectDelayRef.current = Math.min(
          reconnectDelayRef.current * 2,
          MAX_RECONNECT_DELAY_MS
        );
        connect();
      }, reconnectDelayRef.current);
    };
  }, [url]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [connect]);

  return { events, connected, error };
}
