import NetInfo from "@react-native-community/netinfo";
import { useCallback, useEffect, useRef } from "react";
import type { ViewToken } from "@shopify/flash-list";
import { AppState } from "react-native";
import { flushRateFor, isOnline } from "@/features/network/network";
import { stream } from "./stream";

/** Owns the socket for the signed-in shell: connects on mount, sleeps in background, follows connectivity and radio speed. */
export function useMarketStream(): void {
  useEffect(() => {
    stream.start();
    const app = AppState.addEventListener("change", (state) => {
      if (state === "active") stream.start();
      else if (state === "background") stream.pause();
    });
    let rate: number | null = null;
    const net = NetInfo.addEventListener((s) => {
      stream.setOnline(isOnline(s));
      const next = flushRateFor(s);
      if (next !== rate) {
        rate = next;
        stream.setRate(next);
      }
    });
    return () => {
      app.remove();
      net();
      stream.stop();
    };
  }, []);
}

/** Subscribes the rows on screen plus a small margin, and releases them (after a linger) as they scroll away. */
export function useViewportSubscriptions<T>(data: readonly T[], keyOf: (item: T) => string, overscan = 4) {
  const release = useRef<(() => void) | null>(null);
  const visible = useRef<number[]>([]);
  const latest = useRef({ data, keyOf, overscan });

  const resubscribe = useCallback(() => {
    const { data: rows, keyOf: key, overscan: extra } = latest.current;
    const previous = release.current;
    release.current = null;
    const indexes = visible.current;
    if (indexes.length) {
      const from = Math.max(0, Math.min(...indexes) - extra);
      const to = Math.min(rows.length, Math.max(...indexes) + extra + 1);
      release.current = stream.watch(rows.slice(from, to).map(key));
    }
    previous?.();
  }, []);

  useEffect(() => {
    latest.current = { data, keyOf, overscan };
    if (visible.current.length) resubscribe();
  }, [data, keyOf, overscan, resubscribe]);
  useEffect(() => () => release.current?.(), []);

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<T>[] }) => {
      visible.current = viewableItems.map((v) => v.index).filter((i): i is number => i !== null && i !== undefined);
      resubscribe();
    },
    [resubscribe],
  );
  return { onViewableItemsChanged, viewabilityConfig: VIEWABILITY };
}

const VIEWABILITY = { itemVisiblePercentThreshold: 10, minimumViewTime: 100 };

/** Holds a fixed symbol set subscribed while mounted (detail screens, the add-stock picker). */
export function useWatchSymbols(symbols: string[]): void {
  const key = symbols.join(",");
  useEffect(() => {
    if (!key) return;
    return stream.watch(key.split(","));
  }, [key]);
}
