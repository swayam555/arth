import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { formatPrice } from "@/features/market/format";
import { stream } from "@/features/market/stream";
import { useTicks } from "@/features/market/tickStore";
import { Text } from "@/ui/Text";
import { radius, spacing, useTheme } from "@/ui/theme";

const LEVELS = 5;

/** Top-5 bids/asks for the one symbol the gateway streams depth for; released on unmount. */
export function DepthPanel({ symbol }: { symbol: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const depth = useTicks((s) => (s.depth?.symbol === symbol ? s.depth : null));

  useEffect(() => {
    stream.setDepth(symbol);
    return () => stream.setDepth(null);
  }, [symbol]);

  const bids = depth?.bids.slice(0, LEVELS) ?? [];
  const asks = depth?.asks.slice(0, LEVELS) ?? [];
  const maxQty = Math.max(1, ...bids.map((b) => b[1]), ...asks.map((a) => a[1]));
  const bidTotal = bids.reduce((n, b) => n + b[1], 0);
  const askTotal = asks.reduce((n, a) => n + a[1], 0);

  return (
    <View testID="depth-panel" style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text variant="caption" muted style={styles.title}>{t("instrument.depth")}</Text>
      {depth ? (
        <>
          <View style={styles.head}>
            <Text variant="caption" muted style={styles.cell}>{t("instrument.bid")}</Text>
            <Text variant="caption" muted style={[styles.cell, styles.right]}>{t("instrument.qty")}</Text>
            <Text variant="caption" muted style={styles.cell}>{t("instrument.ask")}</Text>
            <Text variant="caption" muted style={[styles.cell, styles.right]}>{t("instrument.qty")}</Text>
          </View>
          {Array.from({ length: LEVELS }, (_, i) => {
            const b = bids[i];
            const a = asks[i];
            return (
              <View key={i} style={styles.row} accessible accessibilityLabel={t("instrument.depthRow", { bid: b ? formatPrice(b[0]) : "-", ask: a ? formatPrice(a[0]) : "-" })}>
                <View style={styles.side}>
                  {b ? <View style={[styles.bar, styles.barRight, { width: `${(b[1] / maxQty) * 100}%`, backgroundColor: colors.upFlash }]} /> : null}
                  <Text variant="mono" color={colors.up} style={styles.cell}>{b ? formatPrice(b[0]) : "-"}</Text>
                  <Text variant="mono" style={[styles.cell, styles.right]}>{b ? b[1].toLocaleString("en-IN") : ""}</Text>
                </View>
                <View style={styles.side}>
                  {a ? <View style={[styles.bar, styles.barLeft, { width: `${(a[1] / maxQty) * 100}%`, backgroundColor: colors.downFlash }]} /> : null}
                  <Text variant="mono" color={colors.down} style={styles.cell}>{a ? formatPrice(a[0]) : "-"}</Text>
                  <Text variant="mono" style={[styles.cell, styles.right]}>{a ? a[1].toLocaleString("en-IN") : ""}</Text>
                </View>
              </View>
            );
          })}
          <View style={styles.head}>
            <Text variant="caption" muted>{t("instrument.totalBid", { qty: bidTotal.toLocaleString("en-IN") })}</Text>
            <Text variant="caption" muted>{t("instrument.totalAsk", { qty: askTotal.toLocaleString("en-IN") })}</Text>
          </View>
        </>
      ) : (
        <Text muted>{t("instrument.depthWaiting")}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md, gap: spacing.xs },
  title: { textTransform: "uppercase", letterSpacing: 0.6 },
  head: { flexDirection: "row", justifyContent: "space-between" },
  row: { flexDirection: "row", gap: spacing.sm },
  side: { flex: 1, flexDirection: "row", paddingVertical: 3, paddingHorizontal: 4, overflow: "hidden" },
  cell: { flex: 1, fontVariant: ["tabular-nums"], fontSize: 13 },
  right: { textAlign: "right" },
  bar: { position: "absolute", top: 0, bottom: 0, borderRadius: 3 },
  barRight: { right: 0 },
  barLeft: { left: 0 },
});
