import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { AndroidImportance } from "expo-notifications";
import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { api } from "@/data/api";
import { routeFor } from "./links";
import { pushToken } from "./token";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

async function ensureChannels(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("alerts", {
    name: "Price alerts",
    importance: AndroidImportance.HIGH,
  });
  await Notifications.setNotificationChannelAsync("digest", {
    name: "Daily digest",
    importance: AndroidImportance.DEFAULT,
  });
}

export type RegisterResult = "registered" | "unchanged" | "denied" | "unavailable";

export async function registerForPush(): Promise<RegisterResult> {
  await ensureChannels();
  const current = await Notifications.getPermissionsAsync();
  const granted = current.granted || (current.canAskAgain && (await Notifications.requestPermissionsAsync()).granted);
  if (!granted) return "denied";
  const id = projectId();
  if (!id) return "unavailable";
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
  if (pushToken.get() === token) return "unchanged";
  const { error } = await api.POST("/v1/me/devices", { body: { expoPushToken: token, platform: Platform.OS } });
  if (error) throw new Error("device registration failed");
  pushToken.set(token);
  return "registered";
}

function open(response: Notifications.NotificationResponse | null | undefined): void {
  const route = routeFor(response?.notification.request.content.data?.url);
  if (route) router.push(route);
}

export function usePush(enabled: boolean): void {
  const last = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    registerForPush().catch(() => undefined);
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      handled.current = r.notification.request.identifier;
      open(r);
    });
    return () => sub.remove();
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !last) return;
    const id = last.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    open(last);
  }, [enabled, last]);
}
