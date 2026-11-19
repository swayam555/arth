import "@/i18n";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { queryClient } from "@/data/queryClient";
import { LockOverlay } from "@/features/auth/LockOverlay";
import { useSession } from "@/features/auth/session";
import { useTheme } from "@/ui/theme";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const status = useSession((s) => s.status);
  const hydrate = useSession((s) => s.hydrate);
  const { colors, scheme } = useTheme();

  useEffect(() => {
    void hydrate().finally(() => SplashScreen.hideAsync());
  }, [hydrate]);

  if (status === "loading") return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style={scheme === "dark" ? "light" : "dark"} />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
            <Stack.Protected guard={status === "signedOut"}>
              <Stack.Screen name="(auth)" />
            </Stack.Protected>
            <Stack.Protected guard={status === "needsConsent"}>
              <Stack.Screen name="consent" />
            </Stack.Protected>
            <Stack.Protected guard={status === "signedIn"}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="search" options={{ presentation: "modal" }} />
              <Stack.Screen name="watchlists" options={{ presentation: "modal" }} />
              <Stack.Screen name="watchlist/[id]" options={{ presentation: "modal" }} />
              <Stack.Screen name="instrument/[symbol]" />
              <Stack.Screen name="portfolio/transactions" />
              <Stack.Screen name="portfolio/txn" options={{ presentation: "modal" }} />
              <Stack.Screen name="portfolio/import" options={{ presentation: "modal" }} />
              <Stack.Screen name="copilot-history" options={{ presentation: "modal" }} />
            </Stack.Protected>
            <Stack.Screen name="privacy" options={{ presentation: "modal" }} />
          </Stack>
          {status === "signedIn" ? <LockOverlay /> : null}
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
