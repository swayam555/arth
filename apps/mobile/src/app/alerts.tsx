import { router } from "expo-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { AlertRow } from "@/features/alerts/AlertRow";
import { sortAlerts, useAlerts, useDeleteAlert, useToggleAlert } from "@/features/alerts/queries";
import { activeCount, MAX_ACTIVE } from "@/features/alerts/rules";
import { Button } from "@/ui/Button";
import { IconButton } from "@/ui/IconButton";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { spacing, useTheme } from "@/ui/theme";

export default function AlertsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { data, isLoading, isError, refetch } = useAlerts();
  const toggle = useToggleAlert();
  const remove = useDeleteAlert();
  const alerts = useMemo(() => sortAlerts(data ?? []), [data]);

  return (
    <Screen>
      <View style={styles.header}>
        <IconButton testID="alerts-close" glyph="✕" label={t("common.cancel")} onPress={() => router.back()} />
        <Text variant="heading" accessibilityRole="header" style={styles.flex}>{t("alerts.manage")}</Text>
        <Text variant="caption" muted>{t("alerts.count", { active: activeCount(alerts), max: MAX_ACTIVE })}</Text>
      </View>
      {isLoading ? (
        <ActivityIndicator color={colors.textMuted} />
      ) : isError ? (
        <View style={styles.center}>
          <Text muted>{t("common.somethingWrong")}</Text>
          <Button label={t("common.retry")} variant="secondary" onPress={() => void refetch()} />
        </View>
      ) : alerts.length === 0 ? (
        <Text testID="alerts-empty" muted>{t("alerts.empty")}</Text>
      ) : (
        <ScrollView testID="alerts-list">
          {alerts.map((a) => (
            <Pressable key={a.id} onPress={() => router.push({ pathname: "/instrument/[symbol]", params: { symbol: a.symbol } })} accessibilityRole="button">
              <AlertRow alert={a} showSymbol onToggle={(active) => toggle.mutate({ id: a.id, active })} onDelete={() => remove.mutate({ id: a.id })} />
            </Pressable>
          ))}
        </ScrollView>
      )}
      <Text variant="caption" muted>{t("alerts.note")}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingBottom: spacing.md },
  flex: { flex: 1 },
  center: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.xl },
});
