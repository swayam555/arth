import { FlashList } from "@shopify/flash-list";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { useViewportSubscriptions } from "@/features/market/hooks";
import { QuoteRow } from "@/features/market/QuoteRow";
import { MAX_ITEMS, useInstrumentSearch, useSetItems, useWatchlists, type Instrument } from "@/features/watchlists/queries";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { radius, spacing, useTheme } from "@/ui/theme";

const keyOf = (i: Instrument) => i.symbol;

export default function SearchScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { list } = useLocalSearchParams<{ list?: string }>();
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setQuery(text.trim()), 200);
    return () => clearTimeout(id);
  }, [text]);

  const search = useInstrumentSearch(query);
  const results = useMemo(() => search.data?.pages.flatMap((p) => p.items ?? []) ?? [], [search.data]);
  const viewport = useViewportSubscriptions(results, keyOf);

  const { data: lists } = useWatchlists();
  const target = lists?.find((l) => l.id === list) ?? lists?.[0];
  const inList = useMemo(() => new Set(target?.items.map((i) => i.symbol)), [target]);
  const setItems = useSetItems();

  const toggle = (inst: Instrument) => {
    if (!target) return;
    const items = inList.has(inst.symbol)
      ? target.items.filter((i) => i.symbol !== inst.symbol)
      : target.items.length >= MAX_ITEMS
        ? null
        : [...target.items, { symbol: inst.symbol, name: inst.name, prevClose: inst.prevClose, tickSize: inst.tickSize }];
    if (items) setItems.mutate({ id: target.id, items });
  };

  return (
    <Screen edges={["top", "bottom"]} padded={false}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text variant="heading" accessibilityRole="header">{target ? t("search.titleFor", { name: target.name }) : t("search.title")}</Text>
          <Pressable testID="search-done" accessibilityRole="button" onPress={() => router.back()} hitSlop={10}>
            <Text color={colors.accent} style={styles.done}>{t("search.done")}</Text>
          </Pressable>
        </View>
        <TextField
          testID="search-input"
          label={t("search.label")}
          placeholder={t("search.placeholder")}
          value={text}
          onChangeText={setText}
          autoFocus
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>
      <FlashList
        testID="search-results"
        data={results}
        keyExtractor={keyOf}
        extraData={inList}
        keyboardShouldPersistTaps="handled"
        onEndReached={() => search.hasNextPage && !search.isFetchingNextPage && void search.fetchNextPage()}
        onEndReachedThreshold={0.5}
        onViewableItemsChanged={viewport.onViewableItemsChanged}
        viewabilityConfig={viewport.viewabilityConfig}
        ListEmptyComponent={
          search.isFetching ? <ActivityIndicator style={styles.pad} color={colors.textMuted} /> : <Text muted style={styles.pad}>{t("search.none")}</Text>
        }
        renderItem={({ item }) => {
          const added = inList.has(item.symbol);
          return (
            <QuoteRow
              symbol={item.symbol}
              name={item.name}
              prevClose={item.prevClose}
              trailing={
                <Pressable
                  testID={`toggle-${item.symbol}`}
                  accessibilityRole="button"
                  accessibilityLabel={t(added ? "search.remove" : "search.add", { symbol: item.symbol })}
                  accessibilityState={{ checked: added }}
                  onPress={() => toggle(item)}
                  hitSlop={8}
                  style={[styles.toggle, { backgroundColor: added ? colors.accent : colors.surfaceAlt }]}
                >
                  <Text color={added ? colors.onAccent : colors.text} style={styles.toggleText}>{added ? "✓" : "+"}</Text>
                </Pressable>
              }
            />
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  done: { fontWeight: "600" },
  pad: { padding: spacing.xl },
  toggle: { width: 32, height: 32, borderRadius: radius.lg, alignItems: "center", justifyContent: "center" },
  toggleText: { fontWeight: "700", fontSize: 16 },
});
