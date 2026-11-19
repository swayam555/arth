import type { Candle } from "@arth/market";
import { Canvas, Group, Line, Path, Rect, Skia, Text as SkText, matchFont, vec, type SkPath } from "@shopify/react-native-skia";
import * as Haptics from "expo-haptics";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import {
  GestureDetector,
  useCompetingGestures,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
} from "react-native-gesture-handler";
import { cancelAnimation, useAnimatedReaction, useDerivedValue, useSharedValue, withDecay } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import type { Colors } from "@/ui/theme";
import { compactVolume, computeOverlays, formatBarTime, type OverlaySet } from "./overlays";
import { clampViewport, indexAt, maxVolume, pan, priceRange, slotWidth, visibleRange, xOf, yOf, zoom, type Viewport } from "./viewport";

export interface OverlayToggles {
  sma20: boolean;
  ema50: boolean;
  vwap: boolean;
  rsi: boolean;
}

interface Props {
  candles: readonly Candle[];
  daily: boolean;
  overlays: OverlayToggles;
  colors: Colors;
  height: number;
  accessibilityLabel: string;
  onNearStart?: () => void;
}

const AXIS_W = 56;
const PAD_TOP = 22;
const GAP = 8;
const OLDER_THRESHOLD = 40;
const GRID = [0.1, 0.37, 0.63, 0.9];
const OVERLAY_COLORS = { sma20: "#F5A524", ema50: "#A78BFA", vwap: "#38BDF8", rsi: "#F472B6" } as const;

const font = matchFont({ fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }), fontSize: 10 });

interface Panes {
  priceH: number;
  volTop: number;
  volH: number;
  rsiTop: number;
  rsiH: number;
}

function layout(height: number, withRsi: boolean): Panes {
  "worklet";
  const rsiH = withRsi ? Math.round(height * 0.2) : 0;
  const volH = Math.round(height * 0.14);
  const priceH = height - PAD_TOP - volH - rsiH - GAP * (withRsi ? 2 : 1) - 14;
  const volTop = PAD_TOP + priceH + GAP;
  return { priceH, volTop, volH, rsiTop: volTop + volH + GAP, rsiH };
}

function linePath(series: readonly (number | null)[], from: number, to: number, v: Viewport, total: number, w: number, map: (y: number) => number): SkPath {
  "worklet";
  const p = Skia.PathBuilder.Make();
  let pen = false;
  for (let i = from; i <= to; i++) {
    const val = series[i];
    if (val === null || val === undefined) {
      pen = false;
      continue;
    }
    const x = xOf(i, v, total, w);
    const y = map(val);
    if (pen) p.lineTo(x, y);
    else p.moveTo(x, y);
    pen = true;
  }
  return p.build();
}

export function CandleChart({ candles, daily, overlays, colors, height, accessibilityLabel, onNearStart }: Props) {
  const [width, setWidth] = useState(0);
  const plotW = Math.max(0, width - AXIS_W);
  const data = useSharedValue<Candle[]>([]);
  const lines = useSharedValue<OverlaySet>({ sma20: [], ema50: [], vwap: [], rsi14: [] });
  const offset = useSharedValue(0);
  const count = useSharedValue(80);
  const cross = useSharedValue({ x: -1, y: -1 });
  const prev = useRef({ len: 0, first: 0 });

  const computed = useMemo(() => computeOverlays(candles, !daily), [candles, daily]);

  useEffect(() => {
    const len = candles.length;
    const first = candles[0]?.[0] ?? 0;
    const p = prev.current;
    const prepended = p.len > 0 && first < p.first;
    const appended = !prepended && p.len > 0 ? len - p.len : 0;
    if (appended > 0 && offset.value > 0.5) offset.value += appended;
    if (p.len === 0 || (len > 0 && first !== p.first && !prepended)) offset.value = 0;
    prev.current = { len, first };
    data.value = candles as Candle[];
    lines.value = computed;
  }, [candles, computed, data, lines, offset]);

  const panes = useMemo(() => layout(height, overlays.rsi), [height, overlays.rsi]);

  const vp = useDerivedValue<Viewport>(() => ({ offset: offset.value, count: count.value }));

  const geom = useDerivedValue(() => {
    const d = data.value;
    const total = d.length;
    const { from, to } = visibleRange(vp.value, total);
    const { min, max } = priceRange(d, from, to);
    return { total, from, to, min, max, vmax: maxVolume(d, from, to) };
  });

  useAnimatedReaction(
    () => geom.value.total > 0 && geom.value.from < OLDER_THRESHOLD,
    (near, was) => {
      if (near && !was && onNearStart) scheduleOnRN(onNearStart);
    },
    [onNearStart],
  );

  const paths = useDerivedValue(() => {
    const d = data.value;
    const { total, from, to, min, max, vmax } = geom.value;
    const v = vp.value;
    const upBody = Skia.PathBuilder.Make();
    const downBody = Skia.PathBuilder.Make();
    const upWick = Skia.PathBuilder.Make();
    const downWick = Skia.PathBuilder.Make();
    const upVol = Skia.PathBuilder.Make();
    const downVol = Skia.PathBuilder.Make();
    const done = () => ({
      upBody: upBody.build(),
      downBody: downBody.build(),
      upWick: upWick.build(),
      downWick: downWick.build(),
      upVol: upVol.build(),
      downVol: downVol.build(),
    });
    if (plotW <= 0 || total === 0) return done();
    const slot = slotWidth(v, plotW);
    const bw = Math.max(1, slot * 0.7);
    const y = (p: number) => yOf(p, min, max, PAD_TOP, panes.priceH);
    for (let i = from; i <= to; i++) {
      const c = d[i];
      if (!c) continue;
      const x = xOf(i, v, total, plotW);
      const up = c[4] >= c[1];
      const top = y(Math.max(c[1], c[4]));
      const bottom = y(Math.min(c[1], c[4]));
      (up ? upBody : downBody).addRect(Skia.XYWHRect(x - bw / 2, top, bw, Math.max(1, bottom - top)));
      const wick = up ? upWick : downWick;
      wick.moveTo(x, y(c[2]));
      wick.lineTo(x, y(c[3]));
      const vh = (c[5] / vmax) * panes.volH;
      (up ? upVol : downVol).addRect(Skia.XYWHRect(x - bw / 2, panes.volTop + panes.volH - vh, bw, vh));
    }
    return done();
  });

  const overlayPaths = useDerivedValue(() => {
    const { total, from, to, min, max } = geom.value;
    const v = vp.value;
    const o = lines.value;
    const price = (p: number) => yOf(p, min, max, PAD_TOP, panes.priceH);
    const osc = (p: number) => yOf(p, 0, 100, panes.rsiTop, panes.rsiH);
    return {
      sma20: linePath(o.sma20, from, to, v, total, plotW, price),
      ema50: linePath(o.ema50, from, to, v, total, plotW, price),
      vwap: linePath(o.vwap, from, to, v, total, plotW, price),
      rsi: linePath(o.rsi14, from, to, v, total, plotW, osc),
    };
  });

  const upBody = useDerivedValue(() => paths.value.upBody);
  const downBody = useDerivedValue(() => paths.value.downBody);
  const upWick = useDerivedValue(() => paths.value.upWick);
  const downWick = useDerivedValue(() => paths.value.downWick);
  const upVol = useDerivedValue(() => paths.value.upVol);
  const downVol = useDerivedValue(() => paths.value.downVol);
  const smaPath = useDerivedValue(() => overlayPaths.value.sma20);
  const emaPath = useDerivedValue(() => overlayPaths.value.ema50);
  const vwapPath = useDerivedValue(() => overlayPaths.value.vwap);
  const rsiPath = useDerivedValue(() => overlayPaths.value.rsi);

  const labels = useDerivedValue(() => {
    const { min, max } = geom.value;
    return GRID.map((f) => (max - (max - min) * f).toFixed(2));
  });
  const g0 = useDerivedValue(() => labels.value[0]!);
  const g1 = useDerivedValue(() => labels.value[1]!);
  const g2 = useDerivedValue(() => labels.value[2]!);
  const g3 = useDerivedValue(() => labels.value[3]!);
  const gridLabels = [g0, g1, g2, g3];

  const last = useDerivedValue(() => {
    const d = data.value;
    const c = d[d.length - 1];
    if (!c) return { y: -100, label: "", up: true };
    const { min, max } = geom.value;
    const y = yOf(c[4], min, max, PAD_TOP, panes.priceH);
    return { y: Math.min(PAD_TOP + panes.priceH, Math.max(PAD_TOP, y)), label: c[4].toFixed(2), up: c[4] >= c[1] };
  });
  const lastRectY = useDerivedValue(() => last.value.y - 8);
  const lastP1 = useDerivedValue(() => vec(0, last.value.y));
  const lastP2 = useDerivedValue(() => vec(plotW, last.value.y));
  const lastLabel = useDerivedValue(() => last.value.label);
  const lastLabelY = useDerivedValue(() => last.value.y + 4);
  const lastColor = useDerivedValue(() => (last.value.up ? colors.up : colors.down));

  const hover = useDerivedValue(() => {
    const { x, y } = cross.value;
    const { total, min, max } = geom.value;
    if (x < 0 || total === 0) return null;
    const i = indexAt(x, vp.value, total, plotW);
    const c = data.value[i];
    if (!c) return null;
    const cx = xOf(i, vp.value, total, plotW);
    const priceAtY = min + (1 - (y - PAD_TOP) / panes.priceH) * (max - min);
    return { cx, y, c, priceAtY };
  });
  const crossOpacity = useDerivedValue(() => (hover.value ? 1 : 0));
  const vP1 = useDerivedValue(() => vec(hover.value?.cx ?? -10, PAD_TOP));
  const vP2 = useDerivedValue(() => vec(hover.value?.cx ?? -10, height - 14));
  const hP1 = useDerivedValue(() => vec(0, hover.value?.y ?? -10));
  const hP2 = useDerivedValue(() => vec(plotW, hover.value?.y ?? -10));
  const tooltip = useDerivedValue(() => {
    const h = hover.value;
    if (!h) return "";
    const [t, o, hi, lo, c, v] = h.c;
    const pct = o ? ((c - o) / o) * 100 : 0;
    return `${formatBarTime(t, daily)}  O ${o.toFixed(2)}  H ${hi.toFixed(2)}  L ${lo.toFixed(2)}  C ${c.toFixed(2)}  ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%  V ${compactVolume(v)}`;
  });
  const crossPrice = useDerivedValue(() => (hover.value ? hover.value.priceAtY.toFixed(2) : ""));
  const crossPriceY = useDerivedValue(() => (hover.value?.y ?? -10) + 4);

  const firstLabel = useDerivedValue(() => {
    const c = data.value[geom.value.from];
    return c ? formatBarTime(c[0], daily) : "";
  });
  const lastTimeLabel = useDerivedValue(() => {
    const c = data.value[geom.value.to];
    return c ? formatBarTime(c[0], daily) : "";
  });

  const scroll = usePanGesture({
    minDistance: 6,
    onBegin: () => {
      "worklet";
      cancelAnimation(offset);
    },
    onUpdate: (e) => {
      "worklet";
      const next = pan(vp.value, e.changeX, plotW, data.value.length);
      offset.set(next.offset);
    },
    onDeactivate: (e) => {
      "worklet";
      const total = data.value.length;
      const slot = slotWidth(vp.value, plotW);
      if (slot <= 0) return;
      offset.set(withDecay({ velocity: e.velocityX / slot, clamp: [0, Math.max(0, total - 15)], deceleration: 0.994 }));
    },
  });

  const pinch = usePinchGesture({
    onUpdate: (e) => {
      "worklet";
      const next = zoom(vp.value, e.scaleChange, Math.min(plotW, e.focalX), plotW, data.value.length);
      count.set(next.count);
      offset.set(next.offset);
    },
  });

  const crosshair = usePanGesture({
    activateAfterLongPress: 280,
    onActivate: (e) => {
      "worklet";
      cross.set({ x: Math.min(plotW, e.x), y: Math.min(PAD_TOP + panes.priceH, Math.max(PAD_TOP, e.y)) });
      scheduleOnRN(Haptics.selectionAsync);
    },
    onUpdate: (e) => {
      "worklet";
      cross.set({ x: Math.min(plotW, Math.max(0, e.x)), y: Math.min(PAD_TOP + panes.priceH, Math.max(PAD_TOP, e.y)) });
    },
    onFinalize: () => {
      "worklet";
      cross.set({ x: -1, y: -1 });
    },
  });

  const gesture = useCompetingGestures(crosshair, useSimultaneousGestures(scroll, pinch));

  useEffect(() => {
    const v = clampViewport({ offset: offset.value, count: count.value }, candles.length);
    count.set(v.count);
  }, [candles.length, count, offset]);

  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));

  return (
    <GestureDetector gesture={gesture}>
      <View
        testID="candle-chart"
        style={[styles.box, { height }]}
        onLayout={onLayout}
        accessible
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
      >
        {width > 0 ? (
          <Canvas style={StyleSheet.absoluteFill}>
            {GRID.map((f, i) => {
              const y = PAD_TOP + panes.priceH * f;
              return (
                <Group key={f}>
                  <Line p1={vec(0, y)} p2={vec(plotW, y)} color={colors.border} strokeWidth={StyleSheet.hairlineWidth} />
                  <SkText x={plotW + 6} y={y + 4} text={gridLabels[i]!} font={font} color={colors.textMuted} />
                </Group>
              );
            })}
            <Path path={upWick} color={colors.up} style="stroke" strokeWidth={1} />
            <Path path={downWick} color={colors.down} style="stroke" strokeWidth={1} />
            <Path path={upBody} color={colors.up} />
            <Path path={downBody} color={colors.down} />
            <Group opacity={0.45}>
              <Path path={upVol} color={colors.up} />
              <Path path={downVol} color={colors.down} />
            </Group>
            {overlays.sma20 ? <Path path={smaPath} color={OVERLAY_COLORS.sma20} style="stroke" strokeWidth={1.25} /> : null}
            {overlays.ema50 ? <Path path={emaPath} color={OVERLAY_COLORS.ema50} style="stroke" strokeWidth={1.25} /> : null}
            {overlays.vwap && !daily ? <Path path={vwapPath} color={OVERLAY_COLORS.vwap} style="stroke" strokeWidth={1.25} /> : null}
            {overlays.rsi ? (
              <Group>
                <Rect x={0} y={panes.rsiTop} width={plotW} height={panes.rsiH} color={colors.surfaceAlt} opacity={0.4} />
                {[30, 70].map((lvl) => {
                  const y = yOf(lvl, 0, 100, panes.rsiTop, panes.rsiH);
                  return (
                    <Group key={lvl}>
                      <Line p1={vec(0, y)} p2={vec(plotW, y)} color={colors.border} strokeWidth={1} />
                      <SkText x={plotW + 6} y={y + 4} text={String(lvl)} font={font} color={colors.textMuted} />
                    </Group>
                  );
                })}
                <SkText x={4} y={panes.rsiTop + 11} text="RSI 14" font={font} color={OVERLAY_COLORS.rsi} />
                <Path path={rsiPath} color={OVERLAY_COLORS.rsi} style="stroke" strokeWidth={1.25} />
              </Group>
            ) : null}
            <Line p1={lastP1} p2={lastP2} color={lastColor} strokeWidth={1} opacity={0.6} />
            <Rect x={plotW} y={lastRectY} width={AXIS_W} height={16} color={lastColor} />
            <SkText x={plotW + 6} y={lastLabelY} text={lastLabel} font={font} color="#FFFFFF" />
            <SkText x={4} y={height - 2} text={firstLabel} font={font} color={colors.textMuted} />
            <SkText x={plotW - 44} y={height - 2} text={lastTimeLabel} font={font} color={colors.textMuted} />
            <Group opacity={crossOpacity}>
              <Line p1={vP1} p2={vP2} color={colors.textMuted} strokeWidth={1} />
              <Line p1={hP1} p2={hP2} color={colors.textMuted} strokeWidth={1} />
              <Rect x={0} y={0} width={width} height={PAD_TOP - 4} color={colors.surface} />
              <SkText x={4} y={12} text={tooltip} font={font} color={colors.text} />
              <SkText x={plotW + 6} y={crossPriceY} text={crossPrice} font={font} color={colors.text} />
            </Group>
          </Canvas>
        ) : null}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  box: { width: "100%" },
});
