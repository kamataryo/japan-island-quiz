/** /api/modes の1行（モードごとのプレイ数と、正解数・出題数の合計） */
export type ModeStat = {
  mode: string;
  n: number;
  score: number;
  questions: number;
};

/** これより少ないプレイ数では正答率を出さない（数人の結果で大きくぶれるため） */
export const MIN_PLAYS = 30;

/** みんなの正答率（0〜1）。プレイ数が足りない・集計がないときは undefined */
export function modeRate(s: ModeStat | undefined): number | undefined {
  if (!s || s.n < MIN_PLAYS || s.questions <= 0) return;
  return s.score / s.questions;
}

/** ゲージのマスの数 */
export const GAUGE_CELLS = 5;

/** 正答率を5マスのゲージにしたときに塗るマスの数 */
export function gaugeFilled(rate: number): number {
  return Math.min(GAUGE_CELLS, Math.max(0, Math.round(rate * GAUGE_CELLS)));
}
