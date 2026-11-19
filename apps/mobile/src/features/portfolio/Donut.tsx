import { Canvas, Path, Skia } from "@shopify/react-native-skia";
import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "@/ui/Text";
import { spacing } from "@/ui/theme";
import { formatPct } from "@/features/market/format";
import type { Slice } from "./live";

export const SLICE_COLORS = ["#5B8CFF", "#22C55E", "#F59E0B", "#A855F7", "#14B8A6", "#F04438", "#EC4899", "#64748B"] as const;

const GAP_DEG = 1.5;

interface Props {
  slices: readonly Slice[];
  size?: number;
  thickness?: number;
  label: (key: string) => string;
  a11yLabel: string;
}

export function Donut({ slices, size = 148, thickness = 18, label, a11yLabel }: Props) {
  const arcs = useMemo(() => {
    const r = (size - thickness) / 2;
    const oval = Skia.XYWHRect(thickness / 2, thickness / 2, r * 2, r * 2);
    const gap = slices.length > 1 ? GAP_DEG : 0;
    const starts = slices.reduce<number[]>((acc, s, i) => [...acc, i === 0 ? -90 : acc[i - 1]! + slices[i - 1]!.weight * 360], []);
    return slices.map((s, i) => ({
      key: s.key,
      path: Skia.PathBuilder.Make().addArc(oval, starts[i]! + gap / 2, Math.max(0, s.weight * 360 - gap)).build(),
      color: SLICE_COLORS[i % SLICE_COLORS.length]!,
    }));
  }, [slices, size, thickness]);

  return (
    <View style={styles.row}>
      <Canvas style={{ width: size, height: size }} accessibilityRole="image" accessibilityLabel={a11yLabel}>
        {arcs.map((a) => (
          <Path key={a.key} path={a.path} color={a.color} style="stroke" strokeWidth={thickness} />
        ))}
      </Canvas>
      <View style={styles.legend}>
        {slices.map((s, i) => (
          <View key={s.key} style={styles.item}>
            <View style={[styles.swatch, { backgroundColor: SLICE_COLORS[i % SLICE_COLORS.length] }]} />
            <Text variant="caption" style={styles.flex} numberOfLines={1}>{label(s.key)}</Text>
            <Text variant="caption" muted style={styles.num}>{formatPct(s.weight * 100).replace("+", "")}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  legend: { flex: 1, gap: spacing.xs },
  item: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  flex: { flex: 1 },
  num: { fontVariant: ["tabular-nums"] },
});
