import type { Island } from "../../scripts/data/pipeline.ts";

export type Rng = () => number;

/**
 * シードから決まった列を返す乱数（mulberry32）。stream を変えると別の列になる。
 * 1ゲームの出題は stream 0、q 問目の選択肢と地図の位置は stream q+1 から作る
 * （問題ごとに列を分けておけば、乱数を呼ぶ回数が変わっても他の問題に響かない）
 */
export function seededRng(seed: number, stream = 0): Rng {
  let a = (seed ^ Math.imul(stream, 0x9e3779b9)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

/** 新しいゲームのシード（32bit）。URL には36進数で入れる */
export const newSeed = () => Math.floor(Math.random() * 2 ** 32);

export const formatSeed = (seed: number) => seed.toString(36);

/** URL のシードを読む。36進数で 32bit に収まるものだけ受け付ける */
export function parseSeed(s: string | null): number | undefined {
  if (!s || !/^[0-9a-z]{1,7}$/.test(s)) return;
  const n = Number.parseInt(s, 36);
  return n < 2 ** 32 ? n : undefined;
}

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
