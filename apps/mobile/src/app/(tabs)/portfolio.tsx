import { router } from "expo-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { formatPct, formatPrice } from "@/features/market/format";
import { useWatchSymbols } from "@/features/market/hooks";
import { StatusPill } from "@/features/market/StatusPill";
import { useTicks } from "@/features/market/tickStore";
import { Donut } from "@/features/portfolio/Donut";
import { HistoryChart } from "@/features/portfolio/HistoryChart";
import { formatInr, formatQty, formatSignedInr, sliceLabel, type AllocationBy } from "@/features/portfolio/labels";
import { livePortfolio, topSlices, type Holding } from "@/features/portfolio/live";
import { usePortfolio, usePortfolioHistory } from "@/features/portfolio/queries";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";
import { Segmented } from "@/ui/Segmented";
import { Text } from "@/ui/Text";
import { radius, spacing, useTheme, type Colors } from "@/ui/theme";

const RANGES = ["30", "90", "365"] as const;
type Range = (typeof RANGES)[number];
const MAX_SLICES = 6;

export default function PortfolioScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { data: server, isLoading, isError, refetch, isRefetching } = usePortfolio();
  const [by, setBy] = useState<AllocationBy>("sector");
  const [range, setRange] = useState<Range>("90");
  const history = usePortfolioHistory(Number(range));

  const symbols = useMemo(() => server?.holdings.map((h) => h.symbol) ?? [], [server]);
  useWatchSymbols(symbols);
  const quotes = useTicks((s) => s.quotes);
  const summary = useMemo(() => (server ? livePortfolio(server, quotes) : undefined), [server, quotes]);

  const slices = useMemo(
    () => (summary ? topSlices(summary.allocation[by], MAX_SLICES, t("portfolio.other")) : []),
    [summary, by, t],
  );
  const label = (key: string) => (key === t("portfolio.other") ? key : sliceLabel(t, by, key));
  const points = history.data?.points ?? [];
  const last = points.at(-1);

  const header = (
    <View style={styles.header}>
      <Text variant="title" accessibilityRole="header">{t("portfolio.title")}</Text>
      <StatusPill />
    </View>
  );

  if (isError && !server) {
    return (
      <Screen edges={["top"]}>
        {header}
        <Text muted>{t("common.somethingWrong")}</Text>
        <Button label={t("common.retry")} variant="secondary" onPress={() => void refetch()} />
      </Screen>
    );
  }

  if (!summary) return <Screen edges={["top"]}>{header}</Screen>;

  const actions = (
    <View style={styles.actions}>
      <Button testID="portfolio-import" label={t("portfolio.import")} variant="secondary" onPress={() => router.push("/portfolio/import")} />
      <Button testID="portfolio-add" label={t("portfolio.addTrade")} variant="secondary" onPress={() => router.push("/portfolio/txn")} />
      {summary.txnCount > 0 ? (
        <Button testID="portfolio-txns" label={t("portfolio.transactions")} variant="secondary" onPress={() => router.push("/portfolio/transactions")} />
      ) : null}
    </View>
  );

  return (
    <Screen edges={["top"]} padded={false}>
      <ScrollView
        testID="portfolio"
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching && !isLoading} onRefresh={() => void refetch()} tintColor={colors.textMuted} />}
      >
        {header}
        {summary.holdings.length === 0 ? (
          <View testID="portfolio-empty" style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text variant="heading">{t("portfolio.emptyTitle")}</Text>
            <Text muted>{t("portfolio.emptyDesc")}</Text>
            {actions}
          </View>
        ) : (
          <>
            <SummaryCard summary={summary} colors={colors} />
            {actions}

            <Card colors={colors} title={t("portfolio.allocation")}>
              <Segmented
                testID="alloc-by"
                value={by}
                onChange={setBy}
                options={(["sector", "mcap", "asset"] as const).map((v) => ({ value: v, label: t(`portfolio.by.${v}`) }))}
              />
              <Donut
                slices={slices}
                label={label}
                a11yLabel={t("portfolio.donutA11y", {
                  by: t(`portfolio.by.${by}`),
                  slices: slices.map((s) => `${label(s.key)} ${Math.round(s.weight * 100)}%`).join(", "),
                })}
              />
            </Card>

            <Card colors={colors} title={t("portfolio.history")}>
              <Segmented testID="history-range" value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r, label: t(`portfolio.range.${r}`) }))} />
              <HistoryChart
                points={points}
                colors={colors}
                a11yLabel={t("portfolio.historyA11y", { days: range, value: formatInr(last?.value ?? 0), invested: formatInr(last?.invested ?? 0) })}
              />
              {history.data && history.data.estimatedShare > 0 ? (
                <Text variant="caption" muted>{t("portfolio.historyEstimated", { pct: `${Math.round(history.data.estimatedShare * 100)}%` })}</Text>
              ) : null}
            </Card>

            {summary.gainers.length || summary.losers.length ? (
              <View style={styles.movers}>
                <Movers title={t("portfolio.gainers")} holdings={summary.gainers} colors={colors} />
                <Movers title={t("portfolio.losers")} holdings={summary.losers} colors={colors} />
              </View>
            ) : null}

            <Card colors={colors} title={t("portfolio.holdings")}>
              {summary.holdings.map((h) => (
                <HoldingRow key={h.symbol} h={h} colors={colors} />
              ))}
            </Card>
          </>
        )}
        <Text variant="caption" muted style={styles.disclaimer} testID="portfolio-disclaimer">{t("portfolio.disclaimer")}</Text>
      </ScrollView>
    </Screen>
  );
}

function SummaryCard({ summary, colors }: { summary: NonNullable<ReturnType<typeof livePortfolio>>; colors: Colors }) {
  const { t } = useTranslation();
  const tone = (n: number) => (n > 0 ? colors.up : n < 0 ? colors.down : colors.textMuted);
  return (
    <View testID="portfolio-summary" style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text variant="caption" muted>{t("portfolio.value")}</Text>
      <Text variant="title" style={styles.num} testID="portfolio-value">{formatInr(summary.value, true)}</Text>
      <Text style={styles.num} color={tone(summary.dayChange)}>
        {t("portfolio.today")} {formatSignedInr(summary.dayChange)} ({formatPct(summary.dayChangePct)})
      </Text>
      <View style={styles.grid}>
        <Stat label={t("portfolio.invested")} value={formatInr(summary.invested)} />
        <Stat label={t("portfolio.pnl")} value={`${formatSignedInr(summary.pnl)} (${formatPct(summary.pnlPct)})`} color={tone(summary.pnl)} />
        <Stat label={t("portfolio.realized")} value={formatSignedInr(summary.realized)} color={tone(summary.realized)} />
        <Stat
          label={t("portfolio.xirr")}
          value={summary.xirr === undefined ? t("portfolio.xirrNa") : formatPct(summary.xirr * 100)}
          color={summary.xirr === undefined ? undefined : tone(summary.xirr)}
        />
      </View>
    </View>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.stat}>
      <Text variant="caption" muted>{label}</Text>
      <Text style={styles.num} color={color} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

function Card({ title, colors, children }: { title: string; colors: Colors; children: React.ReactNode }) {
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text variant="heading" accessibilityRole="header">{title}</Text>
      {children}
    </View>
  );
}

function Movers({ title, holdings, colors }: { title: string; holdings: Holding[]; colors: Colors }) {
  return (
    <View style={[styles.card, styles.flex, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text variant="caption" muted>{title}</Text>
      {holdings.map((h) => (
        <View key={h.symbol} style={styles.moverRow}>
          <Text numberOfLines={1} style={styles.flex}>{h.symbol}</Text>
          <Text style={styles.num} color={h.dayChangePct >= 0 ? colors.up : colors.down}>{formatPct(h.dayChangePct)}</Text>
        </View>
      ))}
    </View>
  );
}

function HoldingRow({ h, colors }: { h: Holding; colors: Colors }) {
  const { t } = useTranslation();
  return (
    <Pressable
      testID={`holding-${h.symbol}`}
      accessibilityRole="button"
      onPress={() => router.push(`/instrument/${h.symbol}`)}
      style={[styles.holding, { borderBottomColor: colors.border }]}
    >
      <View style={styles.flex}>
        <Text style={styles.symbol}>{h.symbol}</Text>
        <Text variant="caption" muted numberOfLines={1}>{t("portfolio.holdingRow", { qty: formatQty(h.qty), avg: formatPrice(h.avgCost) })}</Text>
      </View>
      <View style={styles.right}>
        <Text style={styles.num}>{formatInr(h.value)}</Text>
        <Text variant="caption" style={styles.num} color={h.pnl >= 0 ? colors.up : colors.down}>
          {formatSignedInr(h.pnl)} ({formatPct(h.pnlPct)})
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  card: { padding: spacing.lg, gap: spacing.sm, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  actions: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  grid: { flexDirection: "row", flexWrap: "wrap", rowGap: spacing.md, marginTop: spacing.sm },
  stat: { width: "50%", gap: 2 },
  num: { fontVariant: ["tabular-nums"] },
  movers: { flexDirection: "row", gap: spacing.md },
  moverRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  holding: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, gap: spacing.md },
  symbol: { fontWeight: "600" },
  right: { alignItems: "flex-end" },
  flex: { flex: 1 },
  disclaimer: { marginTop: spacing.md, textAlign: "center" },
});
