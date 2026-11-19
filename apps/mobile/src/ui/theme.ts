import { useColorScheme } from "react-native";
import { create } from "zustand";
import { prefs } from "@/data/storage";

export type ThemePreference = "system" | "light" | "dark";

const palette = {
  dark: {
    bg: "#0B0F14",
    surface: "#121821",
    surfaceAlt: "#1A2230",
    border: "#243042",
    text: "#E8EDF4",
    textMuted: "#8A97AB",
    accent: "#5B8CFF",
    up: "#22C55E",
    down: "#F04438",
    upFlash: "rgba(34,197,94,0.22)",
    downFlash: "rgba(240,68,56,0.22)",
    onAccent: "#FFFFFF",
    danger: "#F04438",
  },
  light: {
    bg: "#F6F8FB",
    surface: "#FFFFFF",
    surfaceAlt: "#EEF2F7",
    border: "#DCE3EC",
    text: "#0E1621",
    textMuted: "#5B6878",
    accent: "#2F6BFF",
    up: "#0F9D58",
    down: "#D92D20",
    upFlash: "rgba(15,157,88,0.16)",
    downFlash: "rgba(217,45,32,0.16)",
    onAccent: "#FFFFFF",
    danger: "#D92D20",
  },
} as const;

export type Colors = { [K in keyof (typeof palette)["dark"]]: string };

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 6, md: 10, lg: 16 } as const;

interface ThemeState {
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
}

export const useThemePreference = create<ThemeState>((set) => ({
  preference: (prefs.getString("theme") as ThemePreference | undefined) ?? "system",
  setPreference: (preference) => {
    prefs.set("theme", preference);
    set({ preference });
  },
}));

export function useTheme(): { colors: Colors; scheme: "light" | "dark" } {
  const system = useColorScheme();
  const preference = useThemePreference((s) => s.preference);
  const scheme = preference === "system" ? (system === "light" ? "light" : "dark") : preference;
  return { colors: palette[scheme], scheme };
}
