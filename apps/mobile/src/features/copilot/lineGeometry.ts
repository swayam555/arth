import type { LineSeries } from "./types";

export interface Geometry {
  lines: [number, number][][];
  min: number;
  max: number;
}

/** Screen points for each series on a shared y-scale; shorter series are right-aligned to the longest. */
export function lineGeometry(series: readonly LineSeries[], width: number, height: number, pad = 4): Geometry {
  const values = series.flatMap((s) => s.points.map((p) => p[1]));
  if (!values.length || width <= 0) return { lines: series.map(() => []), min: 0, max: 0 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const n = Math.max(...series.map((s) => s.points.length));
  const x = (i: number) => (n === 1 ? width / 2 : (i / (n - 1)) * width);
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
  const lines = series.map((s) => s.points.map((p, i): [number, number] => [x(i + n - s.points.length), y(p[1])]));
  return { lines, min, max };
}

export function seriesReturn(s: LineSeries): number | null {
  const first = s.points[0]?.[1];
  const last = s.points.at(-1)?.[1];
  return first && last !== undefined ? ((last - first) / first) * 100 : null;
}
