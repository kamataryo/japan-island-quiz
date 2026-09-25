import type { Island } from "../../scripts/data/pipeline.ts";
import { type Rng, shuffle } from "./game.ts";

const SUFFIX = /(島|嶋|じま|しま)$/;

/** 「島/嶋/じま/しま」の接尾辞を除く（除くと空になる場合はそのまま） */
export function stripSuffix(s: string): string {
  return s.replace(SUFFIX, "") || s;
}

export function levenshtein(a: string, b: string): number {
  const A = [...a];
  const B = [...b];
  let prev = Array.from({ length: B.length + 1 }, (_, j) => j);
  for (let i = 1; i <= A.length; i++) {
    const cur = [i];
    for (let j = 1; j <= B.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[B.length];
}

type Named = Pick<Island, "name" | "yomi">;

/** 名前の似ている度合い（0〜1）。共通の文字の割合と、読みの編集距離の近さの大きい方 */
export function nameSimilarity(a: Named, b: Named): number {
  const na = [...stripSuffix(a.name)];
  const nb = [...stripSuffix(b.name)];
  const shared = new Set(na.filter((c) => nb.includes(c))).size;
  const chars = shared / Math.max(na.length, nb.length);
  if (!a.yomi || !b.yomi) return chars;
  const ya = stripSuffix(a.yomi);
  const yb = stripSuffix(b.yomi);
  const yomi =
    1 - levenshtein(ya, yb) / Math.max([...ya].length, [...yb].length);
  return Math.max(chars, yomi);
}

const distSq = (a: Island, b: Island) => {
  const k = Math.cos((a.center[1] * Math.PI) / 180);
  return (
    ((a.center[0] - b.center[0]) * k) ** 2 + (a.center[1] - b.center[1]) ** 2
  );
};

function top(xs: Island[], cost: (x: Island) => number, k = 8): Island[] {
  return xs
    .map((x) => [cost(x), x] as const)
    .sort((a, b) => a[0] - b[0])
    .slice(0, k)
    .map(([, x]) => x);
}

/**
 * 正解 + 不正解 (n-1) 個の選択肢を返す（順番はシャッフル済み）。
 * 不正解は「距離が近い島」「名前が似ている島」「同じ難易度帯の島」から順番に1つずつ選ぶ。
 * 正解と同名の島は入れず、選択肢どうしの名前も重複させない。
 */
export function pickChoices(
  answer: Island,
  pool: readonly Island[],
  rng: Rng,
  n = 4,
): Island[] {
  const candidates = pool.filter(
    (x) => x.id !== answer.id && x.name !== answer.name,
  );
  const sources = [
    top(candidates, (x) => distSq(answer, x)),
    top(candidates, (x) => -nameSimilarity(answer, x)),
    candidates.filter((x) => x.band === answer.band),
  ];
  const picked: Island[] = [];
  const names = new Set([answer.name]);
  for (let k = 0; picked.length < n - 1; k++) {
    // 各候補群を数周しても埋まらなければ全体から選ぶ
    const src =
      k < sources.length * 3 ? sources[k % sources.length] : candidates;
    const options = src.filter((x) => !names.has(x.name));
    if (options.length === 0) {
      if (src === candidates) break;
      continue;
    }
    const x = options[Math.floor(rng() * options.length)];
    picked.push(x);
    names.add(x.name);
  }
  return shuffle([answer, ...picked], rng);
}

export function countNames(pool: readonly Island[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const x of pool) counts.set(x.name, (counts.get(x.name) ?? 0) + 1);
  return counts;
}

/** 同名の島が全国に複数ある名前には都道府県を添える */
export function displayName(
  x: Island,
  nameCounts: Map<string, number>,
): string {
  return (nameCounts.get(x.name) ?? 0) > 1 && x.pref
    ? `${x.name}（${x.pref}）`
    : x.name;
}
