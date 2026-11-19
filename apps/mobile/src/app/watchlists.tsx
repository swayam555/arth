import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import {
  MAX_LISTS,
  moveItem,
  useCreateWatchlist,
  useDeleteWatchlist,
  useReorderWatchlists,
  useWatchlists,
} from "@/features/watchlists/queries";
import { Button } from "@/ui/Button";
import { IconButton } from "@/ui/IconButton";
import { Section } from "@/ui/ListRow";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { spacing, useTheme } from "@/ui/theme";

export default function ManageWatchlistsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { data: lists = [] } = useWatchlists();
  const create = useCreateWatchlist();
  const remove = useDeleteWatchlist();
  const reorder = useReorderWatchlists();
  const [name, setName] = useState("");

  const move = (from: number, to: number) => reorder.mutate({ ids: moveItem(lists, from, to).map((l) => l.id) });
  const confirmDelete = (id: string, listName: string) =>
    Alert.alert(t("watchlists.deleteTitle", { name: listName }), t("watchlists.deleteBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("watchlists.delete"), style: "destructive", onPress: () => remove.mutate({ id }) },
    ]);
  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate({ name: trimmed }, { onSuccess: () => setName("") });
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Text variant="heading" accessibilityRole="header">{t("watchlists.title")}</Text>
        <Pressable testID="watchlists-done" accessibilityRole="button" onPress={() => router.back()} hitSlop={10}>
          <Text color={colors.accent} style={styles.done}>{t("search.done")}</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Section>
          {lists.map((l, i) => (
            <View key={l.id} testID={`manage-${i}`} style={[styles.row, { borderBottomColor: colors.border }]}>
              <Pressable
                style={styles.name}
                accessibilityRole="button"
                accessibilityLabel={t("watchlists.edit", { name: l.name })}
                onPress={() => router.push({ pathname: "/watchlist/[id]", params: { id: l.id } })}
              >
                <Text numberOfLines={1}>{l.name}</Text>
                <Text variant="caption" muted>{t("watchlists.count", { count: l.items.length })}</Text>
              </Pressable>
              <IconButton glyph="↑" label={t("watchlists.moveUp", { name: l.name })} disabled={i === 0} onPress={() => move(i, i - 1)} />
              <IconButton glyph="↓" label={t("watchlists.moveDown", { name: l.name })} disabled={i === lists.length - 1} onPress={() => move(i, i + 1)} />
              <IconButton
                testID={`manage-delete-${i}`}
                glyph="✕"
                tone="danger"
                label={t("watchlists.deleteTitle", { name: l.name })}
                disabled={lists.length <= 1}
                onPress={() => confirmDelete(l.id, l.name)}
              />
            </View>
          ))}
        </Section>
        {lists.length < MAX_LISTS ? (
          <View style={styles.create}>
            <TextField testID="watchlist-name" label={t("watchlists.newLabel")} value={name} onChangeText={setName} maxLength={40} onSubmitEditing={submit} />
            <Button testID="watchlist-create" label={t("watchlists.create")} onPress={submit} loading={create.isPending} disabled={!name.trim()} />
          </View>
        ) : (
          <Text muted>{t("watchlists.limit", { max: MAX_LISTS })}</Text>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: spacing.md },
  done: { fontWeight: "600" },
  body: { gap: spacing.xl, paddingBottom: spacing.xxl },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  name: { flex: 1, gap: 2, paddingVertical: spacing.xs },
  create: { gap: spacing.md },
});
