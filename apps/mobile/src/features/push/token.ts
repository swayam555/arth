import { api } from "@/data/api";
import { prefs } from "@/data/storage";

const KEY = "push.token";

export const pushToken = {
  get: (): string | undefined => prefs.getString(KEY),
  set: (token: string): void => prefs.set(KEY, token),
  clear: (): void => void prefs.remove(KEY),
};

export async function unregisterPush(): Promise<void> {
  const token = pushToken.get();
  if (!token) return;
  await api.POST("/v1/me/devices/unregister", { body: { expoPushToken: token } }).catch(() => undefined);
  pushToken.clear();
}
