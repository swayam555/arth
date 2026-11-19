import * as LocalAuthentication from "expo-local-authentication";
import { AppState } from "react-native";
import { create } from "zustand";
import { prefs } from "@/data/storage";

const RELOCK_AFTER_MS = 60_000;

interface LockState {
  enabled: boolean;
  locked: boolean;
  setEnabled: (enabled: boolean) => Promise<boolean>;
  unlock: (reason: string) => Promise<boolean>;
}

export const useBiometricLock = create<LockState>((set, get) => ({
  enabled: prefs.getBoolean("biometric") ?? false,
  locked: prefs.getBoolean("biometric") ?? false,

  setEnabled: async (enabled) => {
    if (enabled) {
      const available = (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
      if (!available) return false;
    }
    prefs.set("biometric", enabled);
    set({ enabled });
    return true;
  },

  unlock: async (reason) => {
    if (!get().enabled) {
      set({ locked: false });
      return true;
    }
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: reason, disableDeviceFallback: false });
    if (result.success) set({ locked: false });
    return result.success;
  },
}));

let backgroundedAt = 0;
AppState.addEventListener("change", (state) => {
  if (state === "background") backgroundedAt = Date.now();
  if (state === "active" && useBiometricLock.getState().enabled && backgroundedAt && Date.now() - backgroundedAt > RELOCK_AFTER_MS) {
    useBiometricLock.setState({ locked: true });
  }
});
