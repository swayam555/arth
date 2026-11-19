import { useTranslation } from "react-i18next";
import { StyleSheet, Switch, View } from "react-native";
import { formatPrice } from "@/features/market/format";
import { IconButton } from "@/ui/IconButton";
import { Text } from "@/ui/Text";
import { spacing, useTheme } from "@/ui/theme";
import type { PriceAlert } from "./queries";

export function useAlertLabel() {
  const { t } = useTranslation();
  return (a: Pick<PriceAlert, "kind" | "value">) =>
    a.kind === "pct_move" ? t("alerts.desc.pct_move", { value: a.value }) : t(`alerts.desc.${a.kind}`, { value: formatPrice(a.value) });
}

interface Props {
  alert: PriceAlert;
  showSymbol?: boolean;
  onToggle: (active: boolean) => void;
  onDelete: () => void;
}

export function AlertRow({ alert, showSymbol, onToggle, onDelete }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const label = useAlertLabel()(alert);
  const fired = alert.lastFiredAt ? t("alerts.lastFired", { when: new Date(alert.lastFiredAt).toLocaleString() }) : null;
  return (
    <View testID={`alert-${alert.id}`} style={[styles.row, { borderBottomColor: colors.border }]}>
      <View style={styles.text}>
        <Text muted={!alert.active}>{showSymbol ? `${alert.symbol} · ${label}` : label}</Text>
        {fired ? <Text variant="caption" muted>{fired}</Text> : null}
      </View>
      <Switch
        testID={`alert-toggle-${alert.id}`}
        accessibilityLabel={t("alerts.toggleA11y", { alert: label })}
        value={alert.active}
        onValueChange={onToggle}
        trackColor={{ true: colors.accent, false: colors.surfaceAlt }}
      />
      <IconButton testID={`alert-delete-${alert.id}`} glyph="✕" label={t("alerts.deleteA11y", { alert: label })} onPress={onDelete} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  text: { flex: 1, gap: 2 },
});
