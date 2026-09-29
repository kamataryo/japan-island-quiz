/** /api/modes の1行（モードごとのプレイ数と、正解数・出題数の合計） */
export type ModeStat = {
  mode: string;
  n: number;
  score: number;
  questions: number;
};

/** これより少ないプレイ数では正答率を出さない。問題文の下の島の正答率と同じく、1プレイでもあれば出す（数が少ないとぶれるが、何も出ないより興味を惹くため） */
export const MIN_PLAYS = 1;

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
