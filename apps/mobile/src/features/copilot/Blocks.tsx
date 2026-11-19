import { Canvas, Path, Skia } from "@shopify/react-native-skia";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { formatPct, formatPrice } from "@/features/market/format";
import { Donut, SLICE_COLORS } from "@/features/portfolio/Donut";
import { formatInr, formatQty } from "@/features/portfolio/labels";
import { Text } from "@/ui/Text";
import { radius, spacing, useTheme } from "@/ui/theme";
import { lineGeometry, seriesReturn } from "./lineGeometry";
import type { RenderBlock } from "./types";

const HEIGHT = 140;

function LineBlock({ block }: { block: Extract<RenderBlock, { kind: "line_chart" }> }) {
  const [width, setWidth] = useState(0);
  const geo = useMemo(() => lineGeometry(block.series, width, HEIGHT), [block.series, width]);
  const paths = useMemo(
    () =>
      geo.lines.map((pts) => {
        if (pts.length < 2) return null;
        const b = Skia.PathBuilder.Make();
        pts.forEach(([x, y], i) => (i === 0 ? b.moveTo(x, y) : b.lineTo(x, y)));
        return b.build();
      }),
    [geo],
  );
  const first = block.series[0]?.points[0]?.[0];
  const last = block.series[0]?.points.at(-1)?.[0];
  return (
    <View style={styles.gapSm}>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: HEIGHT }}>
        {width > 0 ? (
          <Canvas style={{ width, height: HEIGHT }} accessibilityRole="image" accessibilityLabel={block.title}>
            {paths.map((p, i) => (p ? <Path key={i} path={p} color={SLICE_COLORS[i]} style="stroke" strokeWidth={2} /> : null))}
          </Canvas>
        ) : null}
      </View>
      <View style={styles.between}>
        <Text variant="caption" muted>{first ?? ""}</Text>
        <Text variant="caption" muted>{last ?? ""}</Text>
      </View>
      {block.series.map((s, i) => {
        const r = seriesReturn(s);
        return (
          <View key={s.label} style={styles.legendRow}>
            <View style={[styles.swatch, { backgroundColor: SLICE_COLORS[i] }]} />
            <Text variant="caption" style={styles.flex}>{s.label}</Text>
            {r !== null ? <Text variant="caption" muted style={styles.num}>{formatPct(r)}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

function TableBlock({ block }: { block: Extract<RenderBlock, { kind: "holdings_table" }> }) {
  const { colors } = useTheme();
  return (
    <View>
      {block.rows.map((r) => (
        <Pressable
          key={r.symbol}
          onPress={() => router.push(`/instrument/${encodeURIComponent(r.symbol)}`)}
          style={[styles.tableRow, { borderBottomColor: colors.border }]}
          accessibilityRole="button"
        >
          <View style={styles.flex}>
            <Text style={styles.bold}>{r.symbol}</Text>
            <Text variant="caption" muted>{`${formatQty(r.qty)} · ${formatPct(r.weight * 100).replace("+", "")}`}</Text>
          </View>
          <View style={styles.right}>
            <Text variant="mono">{formatInr(r.value)}</Text>
            <Text variant="caption" color={r.pnlPct >= 0 ? colors.up : colors.down} style={styles.num}>{formatPct(r.pnlPct)}</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

function ChipsBlock({ block }: { block: Extract<RenderBlock, { kind: "stock_chips" }> }) {
  const { colors } = useTheme();
  return (
    <View style={styles.chips}>
      {block.chips.map((c) => (
        <Pressable
          key={c.symbol}
          onPress={() => router.push(`/instrument/${encodeURIComponent(c.symbol)}`)}
          style={[styles.chip, { backgroundColor: colors.surfaceAlt }]}
          accessibilityRole="button"
        >
          <Text variant="caption" style={styles.bold}>{c.symbol}</Text>
          {c.ltp != null ? <Text variant="caption" style={styles.num}>{formatPrice(c.ltp)}</Text> : null}
          {c.changePct != null ? (
            <Text variant="caption" color={c.changePct >= 0 ? colors.up : colors.down} style={styles.num}>{formatPct(c.changePct)}</Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

export function BlockView({ block }: { block: RenderBlock }) {
  const { colors } = useTheme();
  return (
    <View testID={`block-${block.kind}`} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text variant="caption" muted style={styles.title}>{block.title}</Text>
      {block.kind === "line_chart" ? <LineBlock block={block} /> : null}
      {block.kind === "allocation_donut" ? (
        <Donut slices={block.slices.map((s) => ({ ...s, value: 0 }))} size={120} thickness={14} label={(k) => k} a11yLabel={block.title} />
      ) : null}
      {block.kind === "holdings_table" ? <TableBlock block={block} /> : null}
      {block.kind === "stock_chips" ? <ChipsBlock block={block} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  title: { textTransform: "uppercase", letterSpacing: 0.6 },
  gapSm: { gap: spacing.xs },
  between: { flexDirection: "row", justifyContent: "space-between" },
  legendRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  swatch: { width: 10, height: 3, borderRadius: 2 },
  flex: { flex: 1 },
  num: { fontVariant: ["tabular-nums"] },
  bold: { fontWeight: "600" },
  right: { alignItems: "flex-end" },
  tableRow: { flexDirection: "row", paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.lg },
});
