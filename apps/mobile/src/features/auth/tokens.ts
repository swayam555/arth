import * as SecureStore from "expo-secure-store";

const REFRESH_KEY = "arth.refresh";

let accessToken: string | null = null;

export const tokens = {
  access: () => accessToken,
  setAccess: (token: string | null) => {
    accessToken = token;
  },
  refresh: () => SecureStore.getItemAsync(REFRESH_KEY),
  setRefresh: (token: string) =>
    SecureStore.setItemAsync(REFRESH_KEY, token, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }),
  clear: async () => {
    accessToken = null;
    await SecureStore.deleteItemAsync(REFRESH_KEY);
  },
};
