import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { useSession } from "@/features/auth/session";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { radius, spacing, useTheme } from "@/ui/theme";

export default function MarketsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const name = useSession((s) => s.user?.name);
  return (
    <Screen edges={["top"]}>
      <View style={styles.header}>
        <Text variant="caption" muted>{t("markets.greeting", { name: name ? `, ${name}` : "" })}</Text>
        <Text variant="title" accessibilityRole="header">{t("markets.title")}</Text>
      </View>
      <View testID="watchlist-empty" style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text variant="heading">{t("markets.emptyTitle")}</Text>
        <Text muted>{t("markets.emptyDesc")}</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingVertical: spacing.lg, gap: 2 },
  empty: { padding: spacing.xl, gap: spacing.sm, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
});
