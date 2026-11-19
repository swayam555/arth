import { Canvas, Path, Skia } from "@shopify/react-native-skia";
import { useMemo, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import type { Colors } from "@/ui/theme";
import type { Point } from "./queries";

const HEIGHT = 160;
const PAD = 6;

export function historyPaths(points: readonly Point[], width: number, height: number) {
  if (points.length < 2 || width <= 0) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    lo = Math.min(lo, p.value, p.invested);
    hi = Math.max(hi, p.value, p.invested);
  }
  if (hi === lo) hi = lo + 1;
  const x = (i: number) => (i / (points.length - 1)) * width;
  const y = (v: number) => PAD + (1 - (v - lo) / (hi - lo)) * (height - PAD * 2);
  const value = Skia.PathBuilder.Make();
  const invested = Skia.PathBuilder.Make();
  const area = Skia.PathBuilder.Make().moveTo(0, height);
  points.forEach((p, i) => {
    if (i === 0) {
      value.moveTo(x(i), y(p.value));
      invested.moveTo(x(i), y(p.invested));
    } else {
      value.lineTo(x(i), y(p.value));
      invested.lineTo(x(i), y(p.invested));
    }
    area.lineTo(x(i), y(p.value));
  });
  area.lineTo(width, height).close();
  return { value: value.build(), invested: invested.build(), area: area.build() };
}

interface Props {
  points: readonly Point[];
  colors: Colors;
  a11yLabel: string;
}

export function HistoryChart({ points, colors, a11yLabel }: Props) {
  const [width, setWidth] = useState(0);
  const paths = useMemo(() => historyPaths(points, width, HEIGHT), [points, width]);
  const last = points.at(-1);
  const tone = last && last.value >= last.invested ? colors.up : colors.down;
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));

  return (
    <View style={styles.box} onLayout={onLayout}>
      {paths ? (
        <Canvas style={styles.box} accessibilityRole="image" accessibilityLabel={a11yLabel}>
          <Path path={paths.area} color={tone} opacity={0.12} />
          <Path path={paths.invested} color={colors.textMuted} style="stroke" strokeWidth={1} opacity={0.7} />
          <Path path={paths.value} color={tone} style="stroke" strokeWidth={2} strokeJoin="round" />
        </Canvas>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ box: { height: HEIGHT, width: "100%" } });
