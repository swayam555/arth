import { FlashList } from "@shopify/flash-list";
import { router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { prefs } from "@/data/storage";
import { useSession } from "@/features/auth/session";
import { useViewportSubscriptions } from "@/features/market/hooks";
import { QuoteRow } from "@/features/market/QuoteRow";
import { StatusPill } from "@/features/market/StatusPill";
import { useWatchlists, type WatchlistItem } from "@/features/watchlists/queries";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { radius, spacing, useTheme } from "@/ui/theme";

const SELECTED = "watchlist.selected";
const keyOf = (i: WatchlistItem) => i.symbol;
const NONE: WatchlistItem[] = [];

export default function MarketsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const name = useSession((s) => s.user?.name);
  const { data: lists, isLoading, isError, refetch, isRefetching } = useWatchlists();
  const [selectedId, setSelectedId] = useState(() => prefs.getString(SELECTED));

  const active = useMemo(() => lists?.find((l) => l.id === selectedId) ?? lists?.[0], [lists, selectedId]);
  const items = active?.items ?? NONE;
  const viewport = useViewportSubscriptions(items, keyOf);

  const select = useCallback((id: string) => {
    prefs.set(SELECTED, id);
    setSelectedId(id);
  }, []);

  const addStocks = () => active && router.push({ pathname: "/search", params: { list: active.id } });

  return (
    <Screen edges={["top"]} padded={false}>
      <View style={styles.header}>
        <View style={styles.titles}>
          <Text variant="caption" muted>{t("markets.greeting", { name: name ? `, ${name}` : "" })}</Text>
          <Text variant="title" accessibilityRole="header">{t("markets.title")}</Text>
        </View>
        <StatusPill />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipBar}>
        {lists?.map((l) => (
          <Chip key={l.id} testID={`watchlist-tab-${l.position}`} label={l.name} selected={l.id === active?.id} onPress={() => select(l.id)} />
        ))}
        <Chip testID="watchlist-add" label={t("markets.add")} onPress={addStocks} />
        <Chip testID="watchlist-manage" label={t("markets.manage")} onPress={() => router.push("/watchlists")} />
      </ScrollView>

      {isError && !lists ? (
        <View style={styles.pad}>
          <Text muted>{t("common.somethingWrong")}</Text>
          <Button label={t("common.retry")} variant="secondary" onPress={() => void refetch()} />
        </View>
      ) : !isLoading && items.length === 0 ? (
        <View testID="watchlist-empty" style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text variant="heading">{t("markets.emptyTitle")}</Text>
          <Text muted>{t("markets.emptyDesc")}</Text>
          <Button testID="watchlist-empty-add" label={t("markets.add")} onPress={addStocks} />
        </View>
      ) : (
        <FlashList
          testID="watchlist"
          data={items}
          keyExtractor={keyOf}
          extraData={active?.id}
          renderItem={({ item }) => <QuoteRow symbol={item.symbol} name={item.name} prevClose={item.prevClose} onPress={() => router.push(`/instrument/${item.symbol}`)} />}
          onViewableItemsChanged={viewport.onViewableItemsChanged}
          viewabilityConfig={viewport.viewabilityConfig}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.textMuted} />}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  titles: { gap: 2 },
  chipBar: { flexGrow: 0 },
  chips: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  pad: { padding: spacing.lg, gap: spacing.md },
  empty: { margin: spacing.lg, padding: spacing.xl, gap: spacing.sm, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
});
