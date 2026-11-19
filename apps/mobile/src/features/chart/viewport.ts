import type { Candle } from "@arth/market";

/** `offset` = candles hidden to the right of the screen (0 pins the latest bar), `count` = bars across the width. */
export interface Viewport {
  offset: number;
  count: number;
}

export const MIN_BARS = 15;
export const MAX_BARS = 240;

export function clampViewport(v: Viewport, total: number): Viewport {
  "worklet";
  const count = Math.min(MAX_BARS, Math.max(MIN_BARS, v.count));
  const maxOffset = Math.max(0, total - MIN_BARS);
  return { count, offset: Math.min(maxOffset, Math.max(0, v.offset)) };
}

export function slotWidth(v: Viewport, width: number): number {
  "worklet";
  return width / v.count;
}

/** Drag right (dx > 0) reveals older bars. */
export function pan(v: Viewport, dx: number, width: number, total: number): Viewport {
  "worklet";
  return clampViewport({ count: v.count, offset: v.offset + dx / slotWidth(v, width) }, total);
}

/** Pinch keeps the bar under the focal point still. scale > 1 zooms in. */
export function zoom(v: Viewport, scale: number, focalX: number, width: number, total: number): Viewport {
  "worklet";
  if (scale <= 0) return v;
  const next = clampViewport({ count: v.count / scale, offset: v.offset }, total);
  const fromRight = (width - focalX) / width;
  const offset = v.offset + fromRight * v.count - fromRight * next.count;
  return clampViewport({ count: next.count, offset }, total);
}

/** Inclusive index range of bars at least partly on screen. */
export function visibleRange(v: Viewport, total: number): { from: number; to: number } {
  "worklet";
  const right = total - 1 - v.offset;
  const to = Math.min(total - 1, Math.ceil(right));
  const from = Math.max(0, Math.floor(right - v.count + 1));
  return { from, to };
}

export function xOf(i: number, v: Viewport, total: number, width: number): number {
  "worklet";
  const right = total - 1 - v.offset;
  return width - (right - i + 0.5) * slotWidth(v, width);
}

export function indexAt(x: number, v: Viewport, total: number, width: number): number {
  "worklet";
  const right = total - 1 - v.offset;
  const i = Math.round(right - (width - x) / slotWidth(v, width) + 0.5);
  return Math.min(total - 1, Math.max(0, i));
}

export function priceRange(candles: readonly Candle[], from: number, to: number, pad = 0.06): { min: number; max: number } {
  "worklet";
  let min = Infinity;
  let max = -Infinity;
  for (let i = from; i <= to; i++) {
    const c = candles[i];
    if (!c) continue;
    if (c[3] < min) min = c[3];
    if (c[2] > max) max = c[2];
  }
  if (!Number.isFinite(min)) return { min: 0, max: 1 };
  const span = max - min || Math.abs(max) * 0.01 || 1;
  return { min: min - span * pad, max: max + span * pad };
}

export function maxVolume(candles: readonly Candle[], from: number, to: number): number {
  "worklet";
  let m = 0;
  for (let i = from; i <= to; i++) {
    const v = candles[i]?.[5] ?? 0;
    if (v > m) m = v;
  }
  return m || 1;
}

export function yOf(price: number, min: number, max: number, top: number, height: number): number {
  "worklet";
  return top + (1 - (price - min) / (max - min)) * height;
}
