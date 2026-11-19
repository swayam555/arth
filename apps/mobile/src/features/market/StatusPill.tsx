import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { Text } from "@/ui/Text";
import { radius, spacing, useTheme } from "@/ui/theme";
import { useTicks } from "./tickStore";

export function StatusPill() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const status = useTicks((s) => s.status);
  const live = status === "live";
  const dot = live ? colors.up : status === "unauthorized" || status === "offline" ? colors.down : colors.textMuted;
  return (
    <View
      testID="stream-status"
      accessibilityRole="text"
      accessibilityLabel={t(`stream.${status}`)}
      accessibilityLiveRegion="polite"
      style={[styles.pill, { backgroundColor: colors.surfaceAlt }]}
    >
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <Text variant="caption" muted>{t(`stream.${status}`)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.lg },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
