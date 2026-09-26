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

/** カタカナをひらがなにする */
const hira = (s: string) =>
  s.replace(/[\u30a1-\u30f6]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0x60),
  );

/** 表記ゆれ（ノ/之、ケ/ヶ、嶋/島、龍/竜 など、カタカナ/ひらがな）をそろえた名前 */
export function nameKey(name: string): string {
  return hira(name.normalize("NFKC"))
    .replace(/[之乃]/g, "の")
    .replace(/[ゖゕ]/g, "け")
    .replace(/[嶋嶌]/g, "島")
    .replace(/龍/g, "竜")
    .replace(/辨/g, "弁");
}

const readingKey = (yomi: string) => stripSuffix(hira(yomi));

/**
 * 選択肢に並べると理不尽な（事実上同じ名前の）島どうしか。
 * 表記ゆれをそろえると同じ名前（沖ノ島 と 沖之島）か、
 * 読みが同じでどちらかの名前にかなが入る（蛸島 と タコ島、猪子島 と 猪ノ子島）もの。
 * 読みが同じでも漢字だけの名前（高島 と 鷹島）は見分けられるので別の島とする
 */
export function sameName(a: Named, b: Named): boolean {
  const ka = nameKey(a.name);
  const kb = nameKey(b.name);
  if (ka === kb) return true;
  if (!a.yomi || !b.yomi) return false;
  const kana = /[\u3041-\u309f\u30fc]/;
  return (
    readingKey(a.yomi) === readingKey(b.yomi) &&
    (kana.test(ka) || kana.test(kb))
  );
}

/** 名前の似ている度合い（0〜1）。共通の文字の割合と、読みの編集距離の近さの大きい方 */
export function nameSimilarity(a: Named, b: Named): number {
  const na = [...stripSuffix(nameKey(a.name))];
  const nb = [...stripSuffix(nameKey(b.name))];
  const shared = new Set(na.filter((c) => nb.includes(c))).size;
  const chars = shared / Math.max(na.length, nb.length);
  if (!a.yomi || !b.yomi) return chars;
  const ya = readingKey(a.yomi);
  const yb = readingKey(b.yomi);
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
 * 名前の似た組は 3/4 の確率で入れ、その半分は正解と、残り半分は不正解どうし（正解の近くの島とそれに似た名前の島）で組ませる。
 * 正解を基準に選ぶだけだと「似た名前の組のどちらかが正解」と絞れてしまうため。
 * 残りは「距離が近い島」「同じ難易度帯の島」からランダムに選ぶ。
 * 不正解は正解と同じか易しい帯の島に限る（かんたんの問題に無名の岩が混ざらないように）。
 * ただし、それで足りないとき（地域で絞った pool など）は難しい帯の島でも埋める。
 * 正解と同名の島は入れず、選択肢どうしの名前も重複させない（sameName で表記ゆれも同名とみなす）。
 */
export function pickChoices(
  answer: Island,
  pool: readonly Island[],
  rng: Rng,
  n = 4,
): Island[] {
  const others = pool.filter(
    (x) => x.id !== answer.id && !sameName(x, answer),
  );
  const candidates = others.filter((x) => x.band <= answer.band);
  const near = top(candidates, (x) => distSq(answer, x));
  const sameBand = candidates.filter((x) => x.band === answer.band);
  const similarTo = (h: Island) =>
    top(candidates, (x) => -nameSimilarity(h, x));
  const picked: Island[] = [];
  const add = (src: readonly Island[]) => {
    const options = src.filter(
      (x) => !picked.some((p) => p.id === x.id || sameName(p, x)),
    );
    if (options.length === 0) return false;
    picked.push(options[Math.floor(rng() * options.length)]);
    return true;
  };
  const r = rng();
  if (r < 0.375) add(similarTo(answer));
  else if (r < 0.75 && add(near)) add(similarTo(picked[0]));
  // 残りを埋める。候補群が空なら候補全体から、それでも足りなければ帯を問わず選ぶ
  while (
    picked.length < n - 1 &&
    (add(rng() < 0.5 ? near : sameBand) || add(candidates) || add(others))
  );
  return shuffle([answer, ...picked], rng);
}
