import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { ApiError } from "@/data/api";
import { Button } from "@/ui/Button";
import { Segmented } from "@/ui/Segmented";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { radius, spacing, useTheme } from "@/ui/theme";
import { AlertRow } from "./AlertRow";
import { sortAlerts, useAlerts, useCreateAlert, useDeleteAlert, useToggleAlert } from "./queries";
import { activeCount, ALERT_KINDS, MAX_ACTIVE, parseAlertValue, PCT_MAX, PCT_MIN, type AlertKind } from "./rules";

export function AlertsPanel({ symbol, ltp }: { symbol: string; ltp: number | undefined }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const alerts = useAlerts();
  const create = useCreateAlert();
  const toggle = useToggleAlert();
  const remove = useDeleteAlert();
  const [kind, setKind] = useState<AlertKind>("above");
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);

  const all = useMemo(() => alerts.data ?? [], [alerts.data]);
  const mine = useMemo(() => sortAlerts(all.filter((a) => a.symbol === symbol)), [all, symbol]);
  const full = activeCount(all) >= MAX_ACTIVE;

  const submit = () => {
    const parsed = parseAlertValue(kind, raw, ltp);
    if ("error" in parsed) {
      setError(t(`alerts.error.${parsed.error}`, { min: PCT_MIN, max: PCT_MAX }));
      return;
    }
    setError(null);
    create.mutate(
      { symbol, kind, value: parsed.value },
      {
        onSuccess: () => setRaw(""),
        onError: (e) => setError(e instanceof ApiError && e.code === "alert_limit" ? t("alerts.error.limit", { max: MAX_ACTIVE }) : t("common.somethingWrong")),
      },
    );
  };

  return (
    <View testID="alerts-panel" style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text variant="heading" accessibilityRole="header">{t("alerts.title")}</Text>
      <Segmented testID="alert-kind" value={kind} onChange={setKind} options={ALERT_KINDS.map((k) => ({ value: k, label: t(`alerts.kind.${k}`) }))} />
      <TextField
        testID="alert-value"
        label={kind === "pct_move" ? t("alerts.valuePct") : t("alerts.valuePrice")}
        prefix={kind === "pct_move" ? "%" : "₹"}
        keyboardType="decimal-pad"
        value={raw}
        onChangeText={setRaw}
        error={error}
        onSubmitEditing={submit}
      />
      <Button testID="alert-create" label={t("alerts.create")} onPress={submit} loading={create.isPending} disabled={full} />
      {full ? <Text variant="caption" muted>{t("alerts.error.limit", { max: MAX_ACTIVE })}</Text> : null}
      {mine.map((a) => (
        <AlertRow key={a.id} alert={a} onToggle={(active) => toggle.mutate({ id: a.id, active })} onDelete={() => remove.mutate({ id: a.id })} />
      ))}
      <Text variant="caption" muted>{t("alerts.note")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
});
