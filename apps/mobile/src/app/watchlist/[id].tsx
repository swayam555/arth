import { FlashList } from "@shopify/flash-list";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";
import { moveItem, useRenameWatchlist, useSetItems, useWatchlists, type Watchlist } from "@/features/watchlists/queries";
import { Button } from "@/ui/Button";
import { IconButton } from "@/ui/IconButton";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { spacing, useTheme } from "@/ui/theme";

export default function EditWatchlistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: lists } = useWatchlists();
  const list = lists?.find((l) => l.id === id);
  return list ? <Editor key={`${list.id}:${list.name}`} list={list} /> : null;
}

function Editor({ list }: { list: Watchlist }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const setItems = useSetItems();
  const rename = useRenameWatchlist();
  const [name, setName] = useState(list.name);
  const items = list.items;
  const save = (next: typeof items) => setItems.mutate({ id: list.id, items: next });
  const trimmed = name.trim();

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Text variant="heading" accessibilityRole="header">{t("watchlists.editTitle")}</Text>
        <Pressable testID="edit-done" accessibilityRole="button" onPress={() => router.back()} hitSlop={10}>
          <Text color={colors.accent} style={styles.done}>{t("search.done")}</Text>
        </Pressable>
      </View>
      <View style={styles.rename}>
        <View style={styles.flex}>
          <TextField testID="rename-input" label={t("watchlists.nameLabel")} value={name} onChangeText={setName} maxLength={40} />
        </View>
        <Button
          testID="rename-save"
          label={t("watchlists.save")}
          variant="secondary"
          disabled={!trimmed || trimmed === list.name}
          onPress={() => rename.mutate({ id: list.id, name: trimmed })}
        />
      </View>
      <FlashList
        data={items}
        keyExtractor={(i) => i.symbol}
        ListEmptyComponent={<Text muted style={styles.empty}>{t("markets.emptyDesc")}</Text>}
        renderItem={({ item, index }) => (
          <View testID={`edit-row-${item.symbol}`} style={[styles.row, { borderBottomColor: colors.border }]}>
            <View style={styles.flex}>
              <Text style={styles.symbol}>{item.symbol}</Text>
              <Text variant="caption" muted numberOfLines={1}>{item.name}</Text>
            </View>
            <IconButton glyph="↑" label={t("watchlists.moveUp", { name: item.symbol })} disabled={index === 0} onPress={() => save(moveItem(items, index, index - 1))} />
            <IconButton glyph="↓" label={t("watchlists.moveDown", { name: item.symbol })} disabled={index === items.length - 1} onPress={() => save(moveItem(items, index, index + 1))} />
            <IconButton
              testID={`edit-remove-${item.symbol}`}
              glyph="✕"
              tone="danger"
              label={t("search.remove", { symbol: item.symbol })}
              onPress={() => save(items.filter((i) => i.symbol !== item.symbol))}
            />
          </View>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.lg },
  done: { fontWeight: "600" },
  rename: { flexDirection: "row", alignItems: "flex-end", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  flex: { flex: 1, gap: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  symbol: { fontWeight: "600" },
  empty: { padding: spacing.xl },
});
