import config from "../../config/difficulty.json";
import regions from "../../config/regions.json";
import type { Island } from "../../scripts/data/pipeline.ts";
import { islandsIn } from "./game.ts";

/** 遊び方（難易度帯か地域）。questions から出題し、choices から選択肢を作る */
export type Mode = {
  name: string;
  questions: Island[];
  choices: Island[];
  weight?: (x: Island) => number;
  /** 地域モードの範囲 */
  polygon?: number[][];
};

export function buildModes(islands: Island[]): {
  bands: Mode[];
  areas: Mode[];
} {
  const bands: Mode[] = config.bands.map((b, i) => ({
    name: b.name,
    questions: islands.filter((x) => x.band === i),
    choices: islands,
  }));
  // 地域モードは難易度を問わず出題し、選択肢も地域内の島から作る
  // （外の島が混ざると、それだけで不正解と分かってしまうため）
  const areas: Mode[] = regions.map((r) => {
    const xs = islandsIn(islands, r.polygon);
    return {
      name: r.name,
      questions: xs,
      choices: xs,
      // 帯を混ぜて出すので、均等だと小さな岩ばかりになる。面積^weightExponent で大きい島を出やすくする
      // （地域ごとに島の大きさの分布が違うので指数も地域ごとに決める）
      weight: (x) => x.areaKm2 ** r.weightExponent,
      polygon: r.polygon,
    };
  });
  return { bands, areas };
}
