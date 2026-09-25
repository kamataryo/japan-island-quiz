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

/** 指定した難易度帯から重複なしで n 問選ぶ */
export function pickQuestions(
  pool: readonly Island[],
  band: number,
  n: number,
  rng: Rng,
): Island[] {
  return shuffle(
    pool.filter((x) => x.band === band),
    rng,
  ).slice(0, n);
}
