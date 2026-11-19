import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { ApiError } from "@/data/api";
import { useDeleteTxn, useSaveTxn, useTransactions, type Txn } from "@/features/portfolio/queries";
import { parseTxn, todayIso, type TxnDraft, type TxnErrors } from "@/features/portfolio/txnForm";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";
import { Segmented } from "@/ui/Segmented";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { spacing, useTheme } from "@/ui/theme";

export default function TxnScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { data, isLoading } = useTransactions();
  if (id && isLoading) return <Screen>{null}</Screen>;
  const existing = id ? data?.find((x) => x.id === id) : undefined;
  return <TxnEditor key={existing?.id ?? "new"} existing={existing} />;
}

function draftOf(x?: Txn): TxnDraft {
  return x
    ? { symbol: x.symbol, side: x.side, qty: String(x.qty), price: String(x.price), date: x.tradeDate }
    : { symbol: "", side: "BUY", qty: "", price: "", date: todayIso() };
}

function TxnEditor({ existing }: { existing?: Txn }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const save = useSaveTxn();
  const remove = useDeleteTxn();
  const [draft, setDraft] = useState(() => draftOf(existing));
  const [errors, setErrors] = useState<TxnErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const set = (k: keyof TxnDraft) => (v: string) => setDraft((d) => ({ ...d, [k]: v }));

  const submit = () => {
    const { body, errors: errs } = parseTxn(draft);
    setErrors(errs);
    setServerError(null);
    if (!body) return;
    save.mutate(
      { id: existing?.id, body },
      {
        onSuccess: () => router.back(),
        onError: (e) => setServerError(e instanceof ApiError ? e.message : t("common.somethingWrong")),
      },
    );
  };

  const confirmDelete = () => {
    if (!existing) return;
    Alert.alert(t("txn.delete"), t("txn.deleteConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("txn.delete"),
        style: "destructive",
        onPress: () =>
          remove.mutate(existing.id, {
            onSuccess: () => router.back(),
            onError: (e) => setServerError(e instanceof ApiError ? e.message : t("common.somethingWrong")),
          }),
      },
    ]);
  };

  const err = (k: keyof TxnErrors) => (errors[k] ? t(`txn.${errors[k]}`) : null);

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={10}>
          <Text color={colors.accent}>{t("common.cancel")}</Text>
        </Pressable>
        <Text variant="heading" accessibilityRole="header">{t(existing ? "txn.editTitle" : "txn.addTitle")}</Text>
        <View style={styles.spacer} />
      </View>
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Segmented
          testID="txn-side"
          value={draft.side}
          onChange={(side) => setDraft((d) => ({ ...d, side }))}
          options={[
            { value: "BUY", label: t("txn.buy") },
            { value: "SELL", label: t("txn.sell") },
          ]}
        />
        <TextField testID="txn-symbol" label={t("txn.symbol")} value={draft.symbol} onChangeText={set("symbol")} autoCapitalize="characters" autoCorrect={false} error={err("symbol")} />
        <TextField testID="txn-qty" label={t("txn.qty")} value={draft.qty} onChangeText={set("qty")} keyboardType="decimal-pad" error={err("qty")} />
        <TextField testID="txn-price" label={t("txn.price")} value={draft.price} onChangeText={set("price")} keyboardType="decimal-pad" prefix="₹" error={err("price")} />
        <TextField testID="txn-date" label={t("txn.date")} value={draft.date} onChangeText={set("date")} keyboardType="numbers-and-punctuation" error={err("date")} />
        {serverError ? <Text testID="txn-error" color={colors.danger} accessibilityLiveRegion="polite">{serverError}</Text> : null}
        <Button testID="txn-save" label={t("txn.save")} loading={save.isPending} onPress={submit} />
        {existing ? <Button testID="txn-delete" label={t("txn.delete")} variant="danger" loading={remove.isPending} onPress={confirmDelete} /> : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg },
  spacer: { width: 48 },
  form: { padding: spacing.lg, gap: spacing.md },
});
