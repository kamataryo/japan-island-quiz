import type { Island } from "../../scripts/data/pipeline.ts";

export type Rng = () => number;

export function shuffle<T>(xs: readonly T[], rng: Rng): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 重複なしで n 問選ぶ。weight を渡すと重みに比例して出やすくする
 * （Efraimidis–Spirakis の方法: rng()^(1/w) の大きい順に取る）
 */
export function pickQuestions(
  pool: readonly Island[],
  n: number,
  rng: Rng,
  weight: (x: Island) => number = () => 1,
): Island[] {
  return pool
    .map((x) => [rng() ** (1 / weight(x)), x] as const)
    .sort((a, b) => b[0] - a[0])
    .slice(0, n)
    .map(([, x]) => x);
}

/** 点が多角形（[経度, 緯度] の輪）の内側にあるか（交差数判定） */
export function inPolygon(
  [x, y]: readonly number[],
  ring: readonly (readonly number[])[],
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** 地域（config/regions.json）に代表点が入る島 */
export function islandsIn(
  pool: readonly Island[],
  polygon: readonly (readonly number[])[],
): Island[] {
  return pool.filter((x) => inPolygon(x.center, polygon));
}
