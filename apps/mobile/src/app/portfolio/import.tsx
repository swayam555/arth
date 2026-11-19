import * as DocumentPicker from "expo-document-picker";
import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { ApiError } from "@/data/api";
import { formatPrice } from "@/features/market/format";
import { formatQty } from "@/features/portfolio/labels";
import { IMPORT_FIELDS, useImport, type ImportField, type ImportReport, type PickedFile } from "@/features/portfolio/queries";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { Screen } from "@/ui/Screen";
import { Segmented } from "@/ui/Segmented";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { radius, spacing, useTheme } from "@/ui/theme";

type Kind = "csv" | "cas";
const MAX_ISSUES = 20;
const MAX_PREVIEW = 10;
const CSV_TYPES = ["text/csv", "text/comma-separated-values", "application/vnd.ms-excel", "text/plain"];

export default function ImportScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const run = useImport();
  const [kind, setKind] = useState<Kind>("csv");
  const [file, setFile] = useState<PickedFile | null>(null);
  const [password, setPassword] = useState("");
  const [mapping, setMapping] = useState<Record<string, string> | undefined>(undefined);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const switchKind = (k: Kind) => {
    setKind(k);
    setFile(null);
    setMapping(undefined);
    setReport(null);
    setError(null);
  };

  const explain = (e: unknown) => {
    if (!(e instanceof ApiError)) return t("common.somethingWrong");
    if (e.code === "duplicate_import") return t("import.duplicate");
    if (e.code === "cas_password") return t("import.badPassword");
    return t("import.failed", { message: e.message });
  };

  const preview = (f: PickedFile, m = mapping) => {
    setError(null);
    run.mutate(
      { kind, file: f, dryRun: true, mapping: m, password },
      {
        onSuccess: (r) => {
          setReport(r);
          if (kind === "csv") setMapping(r.mapping);
        },
        onError: (e) => {
          setReport(null);
          setError(explain(e));
        },
      },
    );
  };

  const pick = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: kind === "csv" ? CSV_TYPES : "application/pdf", copyToCacheDirectory: true });
    if (res.canceled) return;
    const a = res.assets[0]!;
    const f = { uri: a.uri, name: a.name, mimeType: a.mimeType ?? undefined };
    setFile(f);
    setMapping(undefined);
    setReport(null);
    if (kind === "csv") preview(f, undefined);
  };

  const remap = (field: ImportField, header: string) => {
    const next = { ...mapping, [field]: header };
    setMapping(next);
    if (file) preview(file, next);
  };

  const commit = () => {
    if (!file) return;
    run.mutate(
      { kind, file, dryRun: false, mapping, password },
      {
        onSuccess: (r) => {
          setReport(r);
          router.back();
        },
        onError: (e) => setError(explain(e)),
      },
    );
  };

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={10}>
          <Text color={colors.accent}>{t("common.cancel")}</Text>
        </Pressable>
        <Text variant="heading" accessibilityRole="header">{t("import.title")}</Text>
        <View style={styles.spacer} />
      </View>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Segmented
          testID="import-kind"
          value={kind}
          onChange={switchKind}
          options={[
            { value: "csv", label: t("import.csv") },
            { value: "cas", label: t("import.cas") },
          ]}
        />
        <Button testID="import-pick" label={t("import.pick")} variant="secondary" onPress={() => void pick()} />
        {file ? <Text variant="caption" muted testID="import-file">{t("import.picked", { name: file.name })}</Text> : null}

        {kind === "cas" && file ? (
          <>
            <TextField
              testID="import-password"
              label={t("import.password")}
              placeholder={t("import.passwordHint")}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <Button testID="import-preview" label={t("import.preview")} variant="secondary" loading={run.isPending} onPress={() => preview(file)} />
          </>
        ) : null}

        {kind === "csv" && report && report.headers.length ? (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text variant="heading">{t("import.mapping")}</Text>
            <Text variant="caption" muted>{t("import.mappingHint")}</Text>
            {IMPORT_FIELDS.map((field) => (
              <View key={field} style={styles.mapRow}>
                <Text variant="caption" style={styles.mapLabel}>{t(`import.field.${field}`)}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                  {report.headers.map((h) => (
                    <Chip key={h} testID={`map-${field}-${h}`} label={h} selected={mapping?.[field] === h} onPress={() => remap(field, h)} />
                  ))}
                </ScrollView>
              </View>
            ))}
          </View>
        ) : null}

        {error ? <Text testID="import-error" color={colors.danger} accessibilityLiveRegion="polite">{error}</Text> : null}

        {report ? <ReportView report={report} /> : null}

        {report && report.accepted > 0 && !report.committed ? (
          <Button testID="import-commit" label={t("import.commit", { count: report.accepted })} loading={run.isPending} onPress={commit} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function ReportView({ report }: { report: ImportReport }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View testID="import-report" style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {report.provider ? <Text variant="caption" muted>{t("import.statement", { provider: report.provider, date: report.statementDate ?? "" })}</Text> : null}
      {report.pan || report.email ? <Text variant="caption" muted testID="import-masked">{t("import.masked", { pan: report.pan ?? "—", email: report.email ?? "—" })}</Text> : null}
      <Text color={colors.up}>{t("import.accepted", { count: report.accepted })}</Text>
      {report.rejected.length ? <Text color={colors.down}>{t("import.rejected", { count: report.rejected.length })}</Text> : null}
      {report.warnings.map((w) => (
        <Text key={w} variant="caption" muted>{w}</Text>
      ))}
      {report.rejected.slice(0, MAX_ISSUES).map((i) => (
        <Text key={`${i.row}:${i.field}`} variant="caption" color={colors.down}>{t("import.issue", { row: i.row, field: i.field, message: i.message })}</Text>
      ))}
      {report.preview.slice(0, MAX_PREVIEW).map((d, idx) => (
        <View key={idx} style={[styles.previewRow, { borderTopColor: colors.border }]}>
          <Text style={styles.flex}>{d.symbol}</Text>
          <Text variant="caption" color={d.side === "BUY" ? colors.up : colors.down}>
            {t("txn.row", { side: t(d.side === "BUY" ? "txn.buy" : "txn.sell"), qty: formatQty(d.qty), price: formatPrice(d.price) })}
          </Text>
          <Text variant="caption" muted style={styles.date}>{d.tradeDate}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg },
  spacer: { width: 48 },
  body: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  card: { padding: spacing.lg, gap: spacing.sm, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  mapRow: { gap: spacing.xs },
  mapLabel: { fontWeight: "600" },
  chips: { gap: spacing.sm },
  previewRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  flex: { flex: 1 },
  date: { width: 84, textAlign: "right" },
});
