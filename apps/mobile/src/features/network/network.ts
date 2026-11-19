import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import { DEFAULT_FLUSH_MS, MAX_FLUSH_MS } from "@arth/market";
import { focusManager, onlineManager } from "@tanstack/react-query";
import { AppState, Platform } from "react-native";

export type NetSnapshot = Pick<NetInfoState, "isConnected" | "isInternetReachable" | "type" | "details">;

/** Unknown reachability (null, the first few hundred ms after launch) counts as online; only an explicit false is offline. */
export function isOnline(s: NetSnapshot): boolean {
  return s.isConnected !== false && s.isInternetReachable !== false;
}

/** Slower conflation on slow radios: one frame per 2 s on 2G and 1 s on 3G cuts bytes and wakeups. */
export function flushRateFor(s: NetSnapshot): number {
  if (s.type !== "cellular") return DEFAULT_FLUSH_MS;
  const gen = s.details && "cellularGeneration" in s.details ? s.details.cellularGeneration : null;
  if (gen === "2g") return MAX_FLUSH_MS;
  if (gen === "3g") return 1_000;
  return DEFAULT_FLUSH_MS;
}

let wired = false;

/** React Query pauses while offline, refetches stale queries on reconnect, and treats app foreground as window focus. */
export function wireQueryManagers(): void {
  if (wired) return;
  wired = true;
  onlineManager.setEventListener((setOnline) => NetInfo.addEventListener((s) => setOnline(isOnline(s))));
  if (Platform.OS !== "web") {
    focusManager.setEventListener((setFocused) => {
      const sub = AppState.addEventListener("change", (state) => setFocused(state === "active"));
      return () => sub.remove();
    });
  }
}
