"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type { RealtimeEvent } from "./events";

type Listener = (e: RealtimeEvent) => void;

interface RealtimeContextValue {
  subscribe: (l: Listener) => () => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

/**
 * Opens ONE EventSource per surface (admin / manufacturer / customer / track)
 * and fans incoming events out to component-level listeners. EventSource
 * reconnects automatically on drop (honoring the server's `retry:` hint), so
 * no manual reconnection logic is needed here.
 */
export function RealtimeProvider({
  url,
  children,
}: {
  url: string;
  children: ReactNode;
}) {
  const listenersRef = useRef<Set<Listener>>(null as unknown as Set<Listener>);
  if (listenersRef.current === null) listenersRef.current = new Set();

  useEffect(() => {
    const es = new EventSource(url, { withCredentials: true });
    es.onmessage = (ev: MessageEvent<string>) => {
      let parsed: RealtimeEvent;
      try {
        parsed = JSON.parse(ev.data);
      } catch {
        return;
      }
      for (const l of listenersRef.current) {
        try {
          l(parsed);
        } catch {
          /* a bad listener must not break the others */
        }
      }
    };
    return () => es.close();
  }, [url]);

  const value = useMemo<RealtimeContextValue>(
    () => ({
      subscribe: (l: Listener) => {
        listenersRef.current.add(l);
        return () => {
          listenersRef.current.delete(l);
        };
      },
    }),
    []
  );

  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtimeContext() {
  return useContext(RealtimeContext);
}
