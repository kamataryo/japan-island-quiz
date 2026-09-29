/** 「難問！」を出すのに必要な回答数。数件だと1人の誤答で0%になり、おにの島が難問だらけになるため */
export const HARD_MIN_ANSWERS = 5;

/** 「難問！」とする正答率の上限。4択なので当てずっぽうでも25%前後になり、10%以下は多くの人がひっかかる島 */
export const HARD_MAX_RATE = 0.1;

/** みんなの回答から、その島を「難問！」とするか */
export function isHard(
  s: { answers: number; correct: number } | undefined,
): boolean {
  if (!s || s.answers < HARD_MIN_ANSWERS) return false;
  return s.correct / s.answers <= HARD_MAX_RATE;
}
