import { createMMKV } from "react-native-mmkv";

export const storage = createMMKV({ id: "arth" });

export const prefs = {
  getString: (key: string) => storage.getString(key),
  set: (key: string, value: string | number | boolean) => storage.set(key, value),
  getBoolean: (key: string) => storage.getBoolean(key),
  remove: (key: string) => storage.remove(key),
};
