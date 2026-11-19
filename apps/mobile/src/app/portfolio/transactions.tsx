import { FlashList } from "@shopify/flash-list";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";
import { formatPrice } from "@/features/market/format";
import { formatInr, formatQty } from "@/features/portfolio/labels";
import { useTransactions } from "@/features/portfolio/queries";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { spacing, useTheme } from "@/ui/theme";

export default function TransactionsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { data } = useTransactions();
  const txns = data ? [...data].sort((a, b) => b.tradeDate.localeCompare(a.tradeDate)) : [];

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={10}>
          <Text color={colors.accent}>{t("instrument.back")}</Text>
        </Pressable>
        <Text variant="heading" accessibilityRole="header">{t("txn.title")}</Text>
        <Pressable testID="txn-add" accessibilityRole="button" onPress={() => router.push("/portfolio/txn")} hitSlop={10}>
          <Text color={colors.accent}>{t("portfolio.addTrade")}</Text>
        </Pressable>
      </View>
      <FlashList
        testID="txn-list"
        data={txns}
        keyExtractor={(x) => x.id}
        ListEmptyComponent={<Text muted style={styles.empty}>{t("txn.empty")}</Text>}
        renderItem={({ item }) => (
          <Pressable
            testID={`txn-${item.id}`}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: "/portfolio/txn", params: { id: item.id } })}
            style={[styles.row, { borderBottomColor: colors.border }]}
          >
            <View style={styles.flex}>
              <Text style={styles.symbol}>{item.symbol}</Text>
              <Text variant="caption" muted>
                {item.tradeDate} · {t(`txn.source.${item.source}`)}
              </Text>
            </View>
            <View style={styles.right}>
              <Text color={item.side === "BUY" ? colors.up : colors.down}>
                {t("txn.row", { side: t(item.side === "BUY" ? "txn.buy" : "txn.sell"), qty: formatQty(item.qty), price: formatPrice(item.price) })}
              </Text>
              <Text variant="caption" muted style={styles.num}>{formatInr(item.qty * item.price)}</Text>
            </View>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  flex: { flex: 1 },
  symbol: { fontWeight: "600" },
  right: { alignItems: "flex-end" },
  num: { fontVariant: ["tabular-nums"] },
  empty: { padding: spacing.lg },
});
