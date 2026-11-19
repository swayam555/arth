import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { api } from "@/data/api";
import { prefs } from "@/data/storage";
import { CandleChart, type OverlayToggles } from "@/features/chart/CandleChart";
import { DepthPanel } from "@/features/chart/DepthPanel";
import { TIMEFRAMES, type Timeframe } from "@/features/chart/candles";
import { useCandles } from "@/features/chart/useCandles";
import { change, formatChange, formatPct, formatPrice, formatVolume } from "@/features/market/format";
import { useWatchSymbols } from "@/features/market/hooks";
import { StatusPill } from "@/features/market/StatusPill";
import { useQuote } from "@/features/market/tickStore";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { IconButton } from "@/ui/IconButton";
import { Screen } from "@/ui/Screen";
import { Segmented } from "@/ui/Segmented";
import { Text } from "@/ui/Text";
import { spacing, useTheme } from "@/ui/theme";

const TF_KEY = "chart.tf";
const OVERLAY_KEY = "chart.overlays";
const DEFAULT_OVERLAYS: OverlayToggles = { sma20: true, ema50: false, vwap: true, rsi: true };

function readOverlays(): OverlayToggles {
  try {
    return { ...DEFAULT_OVERLAYS, ...(JSON.parse(prefs.getString(OVERLAY_KEY) ?? "{}") as Partial<OverlayToggles>) };
  } catch {
    return DEFAULT_OVERLAYS;
  }
}

export default function InstrumentScreen() {
  const { symbol = "" } = useLocalSearchParams<{ symbol: string }>();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { height } = useWindowDimensions();
  const [tf, setTf] = useState<Timeframe>(() => (prefs.getString(TF_KEY) as Timeframe | undefined) ?? "5m");
  const [overlays, setOverlays] = useState(readOverlays);

  useWatchSymbols(useMemo(() => [symbol], [symbol]));
  const quote = useQuote(symbol);
  const info = useQuery({
    queryKey: ["instrument", symbol],
    queryFn: async () => (await api.GET("/v1/instruments/{symbol}", { params: { path: { symbol } } })).data ?? null,
    staleTime: 3_600_000,
  });
  const { candles, status, fromCache, loadingOlder, loadOlder, reload } = useCandles(symbol, tf);

  const chooseTf = (next: Timeframe) => {
    prefs.set(TF_KEY, next);
    setTf(next);
  };
  const toggle = (key: keyof OverlayToggles) =>
    setOverlays((cur) => {
      const next = { ...cur, [key]: !cur[key] };
      prefs.set(OVERLAY_KEY, JSON.stringify(next));
      return next;
    });
  const onNearStart = useCallback(() => void loadOlder(), [loadOlder]);

  const prevClose = quote?.prevClose ?? info.data?.instrument.prevClose ?? 0;
  const ltp = quote?.ltp ?? prevClose;
  const { abs, pct } = change(ltp, prevClose);
  const tone = pct > 0 ? colors.up : pct < 0 ? colors.down : colors.textMuted;
  const last = candles[candles.length - 1];
  const chartLabel = last
    ? t("instrument.chartA11y", { symbol, tf, count: candles.length, close: formatPrice(last[4]) })
    : t("instrument.chartEmpty");

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <IconButton testID="instrument-back" glyph="‹" label={t("instrument.back")} onPress={() => router.back()} />
        <View style={styles.titles}>
          <Text variant="heading" accessibilityRole="header">{symbol}</Text>
          <Text variant="caption" muted numberOfLines={1}>{info.data?.instrument.name ?? ""}</Text>
        </View>
        <StatusPill />
      </View>

      <ScrollView contentContainerStyle={styles.body} scrollEnabled>
        <View style={styles.price} accessible accessibilityLabel={t("quote.a11y", { name: symbol, price: formatPrice(ltp), change: formatPct(pct), state: quote ? "" : t("quote.delayed") })}>
          <Text testID="instrument-ltp" variant="title" style={styles.tabular}>{formatPrice(ltp)}</Text>
          <Text color={tone} style={styles.tabular}>{`${formatChange(abs)} (${formatPct(pct)})`}</Text>
        </View>
        {quote ? (
          <View style={styles.stats}>
            <Stat label={t("instrument.open")} value={formatPrice(quote.open)} />
            <Stat label={t("instrument.high")} value={formatPrice(quote.high)} />
            <Stat label={t("instrument.low")} value={formatPrice(quote.low)} />
            <Stat label={t("instrument.volume")} value={formatVolume(quote.volume)} />
          </View>
        ) : null}

        <Segmented testID="tf" options={TIMEFRAMES.map((v) => ({ value: v, label: t(`instrument.tf.${v}`) }))} value={tf} onChange={chooseTf} />

        <View style={styles.chips}>
          <Chip testID="ov-sma20" label="SMA 20" selected={overlays.sma20} onPress={() => toggle("sma20")} />
          <Chip testID="ov-ema50" label="EMA 50" selected={overlays.ema50} onPress={() => toggle("ema50")} />
          {tf !== "1d" ? <Chip testID="ov-vwap" label="VWAP" selected={overlays.vwap} onPress={() => toggle("vwap")} /> : null}
          <Chip testID="ov-rsi" label="RSI" selected={overlays.rsi} onPress={() => toggle("rsi")} />
          {loadingOlder ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
        </View>

        {status === "error" ? (
          <View style={styles.center}>
            <Text muted>{t("instrument.chartError")}</Text>
            <Button label={t("common.retry")} variant="secondary" onPress={() => void reload()} />
          </View>
        ) : status === "loading" && candles.length === 0 ? (
          <View style={[styles.center, { height: Math.round(height * 0.5) }]}>
            <ActivityIndicator color={colors.textMuted} />
          </View>
        ) : (
          <>
            <CandleChart
              key={`${symbol}:${tf}`}
              candles={candles}
              daily={tf === "1d"}
              overlays={overlays}
              colors={colors}
              height={Math.round(height * 0.5)}
              accessibilityLabel={chartLabel}
              onNearStart={onNearStart}
            />
            <Text variant="caption" muted>{fromCache ? t("instrument.cached") : t("instrument.hint")}</Text>
          </>
        )}

        <DepthPanel symbol={symbol} />
      </ScrollView>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text variant="caption" muted>{label}</Text>
      <Text variant="mono" style={styles.tabular}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  titles: { flex: 1 },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  price: { gap: 2 },
  tabular: { fontVariant: ["tabular-nums"] },
  stats: { flexDirection: "row", justifyContent: "space-between" },
  stat: { gap: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  center: { alignItems: "center", justifyContent: "center", gap: spacing.md, paddingVertical: spacing.xl },
});
